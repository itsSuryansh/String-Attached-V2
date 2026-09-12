import pytest

from backend.gemini_schema import ValidationError, build_prompt, validate_response


def test_valid_response():
    raw = {
        "priority": "hand_configuration",
        "correction": "Adjust your finger placement",
        "noIntervention": False,
    }
    out = validate_response(raw)
    assert out["priority"] == "hand_configuration"
    assert out["correction"] == "Adjust your finger placement"
    assert out["noIntervention"] is False


def test_valid_no_intervention():
    raw = {"priority": "none", "correction": "", "noIntervention": True}
    out = validate_response(raw)
    assert out["noIntervention"] is True
    assert out["correction"] == ""


def test_rejects_non_object():
    with pytest.raises(ValidationError):
        validate_response(["not", "an", "object"])


def test_rejects_invalid_priority():
    raw = {"priority": "magic_fix", "correction": "Try harder", "noIntervention": False}
    with pytest.raises(ValidationError):
        validate_response(raw)


def test_rejects_missing_correction():
    raw = {"priority": "squat_form", "correction": "", "noIntervention": False}
    with pytest.raises(ValidationError):
        validate_response(raw)


def test_rejects_too_long_correction():
    raw = {
        "priority": "basketball_form",
        "correction": "This correction is far too long and verbose to render",
        "noIntervention": False,
    }
    with pytest.raises(ValidationError):
        validate_response(raw)


def test_rejects_too_many_words():
    raw = {
        "priority": "transition_speed",
        "correction": "one two three four five six seven",
        "noIntervention": False,
    }
    with pytest.raises(ValidationError):
        validate_response(raw)


def test_rejects_none_without_no_intervention():
    raw = {"priority": "none", "correction": "Do stuff", "noIntervention": False}
    with pytest.raises(ValidationError):
        validate_response(raw)


def test_build_prompt_includes_measurements_and_history():
    request = {
        "mode": "squats",
        "state": "COMPLETED",
        "priority": "squat_form",
        "trackingStatus": "tracking",
        "metrics": [
            {"key": "depth", "label": "Depth", "value": 45, "valid": True},
            {"key": "knee", "label": "Knee alignment", "value": 80, "valid": False},
        ],
        "history": [
            {
                "priority": "squat_form",
                "correction": "Keep knees out",
                "delta": -8,
                "outcome": "WORSE",
            }
        ],
    }
    prompt = build_prompt(request)
    assert "Depth: 45" in prompt
    assert "Keep knees out" in prompt
    assert "Knee alignment" not in prompt  # invalid metric excluded
