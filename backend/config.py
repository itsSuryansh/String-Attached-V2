"""Server-side configuration.

The Gemini API key lives ONLY here (and in the environment). It is never sent
to the browser: the browser exchanges a session id for a short-lived token.
"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    _here = Path(__file__).resolve().parent
    load_dotenv(_here / ".env")  # backend/.env
    load_dotenv(_here.parent / ".env")  # repo-root .env
except Exception:  # dotenv is optional
    pass

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()
SESSION_TOKEN_TTL_SECONDS = int(os.getenv("SESSION_TOKEN_TTL_SECONDS", "3600"))
GEMINI_TIMEOUT_SECONDS = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "20"))
