"""Ephemeral, in-memory session/token store.

Tokens are short-lived and never expose the Gemini API key. All session data
lives in memory only and disappears when the process restarts.
"""

import secrets
import threading
import time

from .config import SESSION_TOKEN_TTL_SECONDS


class Session:
    def __init__(self, session_id: str, token: str, expires_at: float):
        self.session_id = session_id
        self.token = token
        self.expires_at = expires_at

    def is_valid(self, token: str) -> bool:
        return secrets.compare_digest(self.token, token) and time.time() < self.expires_at


class SessionStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: dict[str, Session] = {}

    def create(self, ttl_seconds: int | None = None) -> Session:
        ttl = ttl_seconds if ttl_seconds is not None else SESSION_TOKEN_TTL_SECONDS
        session_id = secrets.token_urlsafe(16)
        token = secrets.token_urlsafe(32)
        session = Session(session_id, token, time.time() + ttl)
        with self._lock:
            self._prune_locked()
            self._sessions[token] = session
        return session

    def validate(self, token: str) -> bool:
        with self._lock:
            self._prune_locked()
            session = self._sessions.get(token)
            if session is None:
                return False
            if time.time() >= session.expires_at:
                self._sessions.pop(token, None)
                return False
            return True

    def _prune_locked(self) -> None:
        now = time.time()
        expired = [t for t, s in self._sessions.items() if now >= s.expires_at]
        for t in expired:
            self._sessions.pop(t, None)


store = SessionStore()
