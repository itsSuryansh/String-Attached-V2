from fastapi.testclient import TestClient

import backend.main as main_mod
from backend.gemini_client import GeminiUnconfigured
from backend.main import app

client = TestClient(app)


def test_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_status_unconfigured(monkeypatch):
    monkeypatch.setattr(main_mod, "GEMINI_API_KEY", "")
    res = client.get("/api/gemini/status")
    assert res.status_code == 200
    assert res.json() == {"configured": False}


def test_status_configured(monkeypatch):
    monkeypatch.setattr(main_mod, "GEMINI_API_KEY", "test-key")
    res = client.get("/api/gemini/status")
    assert res.json() == {"configured": True}


def test_session_created():
    res = client.post("/api/gemini/session")
    assert res.status_code == 200
    data = res.json()
    assert data["sessionId"]
    assert data["token"]


def test_coach_requires_token():
    res = client.post("/api/gemini/coach", json={})
    assert res.status_code == 401


def test_coach_unconfigured(monkeypatch):
    token = client.post("/api/gemini/session").json()["token"]

    async def boom(_request):
        raise GeminiUnconfigured("no key")

    monkeypatch.setattr(main_mod, "call_gemini", boom)
    res = client.post(
        "/api/gemini/coach",
        json={"mode": "squats", "priority": "squat_form"},
        headers={"X-Session-Token": token},
    )
    assert res.status_code == 503


def test_coach_success(monkeypatch):
    token = client.post("/api/gemini/session").json()["token"]

    async def ok(_request):
        return {
            "priority": "hand_configuration",
            "correction": "Adjust your grip",
            "noIntervention": False,
        }

    monkeypatch.setattr(main_mod, "call_gemini", ok)
    res = client.post(
        "/api/gemini/coach",
        json={"mode": "ukulele", "priority": "hand_configuration"},
        headers={"X-Session-Token": token},
    )
    assert res.status_code == 200
    assert res.json()["correction"] == "Adjust your grip"
    assert res.json()["noIntervention"] is False


def test_websocket_unknown_message():
    with client.websocket_connect("/api/gemini/live/ws") as ws:
        ws.send_json({"type": "bogus"})
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert msg["message"] == "unknown message type"


def test_websocket_coach_unconfigured(monkeypatch):
    async def boom(_request):
        raise GeminiUnconfigured("no key")

    monkeypatch.setattr(main_mod, "call_gemini", boom)
    with client.websocket_connect("/api/gemini/live/ws") as ws:
        ws.send_json({"type": "coach", "id": "c1", "request": {"mode": "ukulele"}})
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert msg["id"] == "c1"
        assert msg["message"] == "gemini not configured"


def test_websocket_coach_success(monkeypatch):
    async def ok(_request):
        return {
            "priority": "hand_configuration",
            "correction": "Grip",
            "noIntervention": False,
        }

    monkeypatch.setattr(main_mod, "call_gemini", ok)
    with client.websocket_connect("/api/gemini/live/ws") as ws:
        ws.send_json({"type": "coach", "id": "c2", "request": {"mode": "ukulele"}})
        msg = ws.receive_json()
        assert msg["type"] == "coaching"
        assert msg["id"] == "c2"
        assert msg["correction"] == "Grip"

