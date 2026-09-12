"""StringsAttached backend — FastAPI.

Routes:
  GET  /api/health          — liveness
  GET  /api/gemini/status   — whether Gemini is configured (never exposes key)
  POST /api/gemini/session  — ephemeral session token exchange
  POST /api/gemini/coach    — validated Gemini coaching decision
  WS   /api/gemini/live/ws  — streaming telemetry/evidence + coaching channel
"""

import time

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import GEMINI_API_KEY
from .gemini_client import GeminiError, GeminiUnconfigured, call_gemini
from .sessions import store

app = FastAPI(title="StringsAttached API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local prototype; no cookies/auth on these routes
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "stringsattached", "time": time.time()}


@app.get("/api/gemini/status")
async def gemini_status():
    return {"configured": bool(GEMINI_API_KEY)}


@app.post("/api/gemini/session")
async def create_session():
    session = store.create()
    return {
        "sessionId": session.session_id,
        "token": session.token,
        "expiresIn": int(session.expires_at - time.time()),
    }


@app.post("/api/gemini/coach")
async def coach(request: dict, x_session_token: str = Header(default="")):
    if not store.validate(x_session_token):
        raise HTTPException(status_code=401, detail="invalid or expired session")
    try:
        decision = await call_gemini(request)
    except GeminiUnconfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except GeminiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # defensive: never leak internals
        raise HTTPException(status_code=502, detail="Gemini request failed") from exc
    return decision


@app.websocket("/api/gemini/live/ws")
async def live(ws: WebSocket):
    await ws.accept()
    latest: dict = {}
    try:
        while True:
            msg = await ws.receive_json()
            mtype = msg.get("type")
            if mtype == "telemetry":
                latest["telemetry"] = msg
            elif mtype == "frame":
                latest["frame"] = msg.get("jpeg")
            elif mtype == "coach":
                request = msg.get("request") or {}
                if latest.get("frame"):
                    request["evidenceImage"] = latest["frame"]
                call_id = msg.get("id")
                try:
                    decision = await call_gemini(request)
                    await ws.send_json({"type": "coaching", "id": call_id, **decision})
                except (GeminiUnconfigured, GeminiError, Exception) as exc:
                    message = (
                        "gemini not configured"
                        if isinstance(exc, GeminiUnconfigured)
                        else "gemini request failed"
                    )
                    await ws.send_json(
                        {"type": "error", "id": call_id, "message": message}
                    )
            else:
                await ws.send_json({"type": "error", "message": "unknown message type"})
    except WebSocketDisconnect:
        pass
    except Exception:
        # The connection is gone or the payload was invalid; nothing to leak.
        pass


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    return JSONResponse(
        status_code=500, content={"detail": "internal error"}
    )
