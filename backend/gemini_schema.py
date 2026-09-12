"""Gemini coaching contract + response validation (server side).

Mirrors the frontend contract in src/gemini/coaching-schema.ts. Every Gemini
response is validated before it is returned to the browser. Malformed output
is rejected and surfaced as an explicit failure (never silently replaced).
"""

from typing import Any

VALID_PRIORITIES = {
    "hand_configuration",
    "transition_speed",
    "strum_form",
    "basketball_form",
    "squat_form",
    "none",
}

MAX_CORRECTION_WORDS = 6
MAX_CORRECTION_CHARS = 80


class ValidationError(Exception):
    pass


def validate_response(raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise ValidationError("response is not an object")

    priority = raw.get("priority")
    if priority not in VALID_PRIORITIES:
        raise ValidationError(f"invalid priority: {priority!r}")

    no_intervention = raw.get("noIntervention")
    if not isinstance(no_intervention, bool):
        raise ValidationError("missing noIntervention flag")

    correction = (raw.get("correction") or "").strip()

    if not no_intervention:
        if not correction:
            raise ValidationError("missing correction text")
        if len(correction) > MAX_CORRECTION_CHARS:
            raise ValidationError("correction too long")
        if len(correction.split()) > MAX_CORRECTION_WORDS:
            raise ValidationError("correction exceeds 6 words")

    if priority == "none" and not no_intervention:
        raise ValidationError("none priority must be NO INTERVENTION")

    result = {
        "priority": priority,
        "correction": correction if not no_intervention else "",
        "noIntervention": no_intervention,
    }
    reason = raw.get("reason")
    if isinstance(reason, str):
        result["reason"] = reason
    return result


def build_prompt(request: dict) -> str:
    metrics = request.get("metrics") or []
    metric_text = ", ".join(
        f"{m.get('label', m.get('key', '?'))}: {m.get('value', '?')}"
        for m in metrics
        if m.get("valid")
    )

    history = request.get("history") or []
    history_text = "; ".join(
        f"{h.get('priority')} -> \"{h.get('correction', '')}\" "
        f"(delta {h.get('delta') if h.get('delta') is not None else 'n/a'}, "
        f"{h.get('outcome') or 'pending'})"
        for h in history[-5:]
    )

    return (
        "You are the coach in a motor-skill training app. You receive local "
        "measurements from the computer-vision system. You do NOT invent "
        "measurements; you only interpret the evidence you are given.\n\n"
        f"Mode: {request.get('mode')}\n"
        f"State: {request.get('state')}\n"
        f"Suggested priority: {request.get('priority')}\n"
        f"Tracking status: {request.get('trackingStatus')}\n"
        f"Measurements: {metric_text or 'none'}\n"
        f"Recent interventions: {history_text or 'none'}\n\n"
        "Decide whether the learner needs a correction right now. If the "
        "evidence does not justify one, return NO INTERVENTION.\n\n"
        "Return STRICT JSON only, with exactly these fields:\n"
        '{ "priority": "<hand_configuration|transition_speed|strum_form|'
        'basketball_form|squat_form|none>", "correction": "<max 6 words, '
        'actionable>", "noIntervention": <bool>, "reason": "<short internal '
        'reason>" }\n\n'
        "If noIntervention is true, set priority to none and correction to "
        "empty."
    )
