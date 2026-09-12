"""Server-side Gemini REST client.

The browser never talks to Gemini directly and never holds credentials. This
module calls the Gemini API with the server's key and returns a validated
coaching decision.
"""

import json
import re

import httpx

from .config import GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TIMEOUT_SECONDS
from .gemini_schema import ValidationError, build_prompt, validate_response


class GeminiUnconfigured(Exception):
    pass


class GeminiError(Exception):
    pass


def _extract_json(text: str) -> dict:
    """Extract the first JSON object from a (possibly fenced) response."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise GeminiError("Gemini did not return a JSON object")
    return json.loads(text[start : end + 1])


async def call_gemini(request: dict) -> dict:
    if not GEMINI_API_KEY:
        raise GeminiUnconfigured("Gemini API key is not configured")

    prompt = build_prompt(request)
    parts: list[dict] = [{"text": prompt}]

    evidence = request.get("evidenceImage")
    if evidence and isinstance(evidence, str) and evidence.startswith("data:image/"):
        try:
            data = evidence.split(",", 1)[1]
            parts.append(
                {"inline_data": {"mime_type": "image/jpeg", "data": data}}
            )
        except Exception:
            pass  # ignore bad evidence frames; text evidence still stands

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent"
    )
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0.4},
    }

    try:
        async with httpx.AsyncClient(timeout=GEMINI_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, params={"key": GEMINI_API_KEY}, json=payload)
    except httpx.HTTPError as exc:
        raise GeminiError(f"Gemini network error: {exc}") from exc

    if resp.status_code >= 400:
        raise GeminiError(f"Gemini API error ({resp.status_code})")

    try:
        data = resp.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, ValueError) as exc:
        raise GeminiError("Unexpected Gemini response shape") from exc

    try:
        parsed = _extract_json(text)
    except (json.JSONDecodeError, GeminiError) as exc:
        raise GeminiError("Gemini returned malformed JSON") from exc

    try:
        return validate_response(parsed)
    except ValidationError as exc:
        raise GeminiError(f"Invalid coaching response: {exc}") from exc
