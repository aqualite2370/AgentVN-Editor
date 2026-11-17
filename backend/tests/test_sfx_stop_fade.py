"""Stop commands survive the same strict contracts used for project persistence."""
import pytest
from pydantic import ValidationError

from app.ai.structured_normalization import _normalize_command, _strip_unknown_command_fields
from app.models.commands import SfxCommand


def test_old_sound_effect_defaults_to_play():
    assert SfxCommand.model_validate({"type": "sfx", "sfx_id": "door"}).action == "play"


@pytest.mark.parametrize("target", ["", "door"])
def test_stop_roundtrip_keeps_action_target_and_duration(target):
    command = {"type": "sfx", "action": "stop", "sfx_id": target, "fade_ms": 750}
    _normalize_command(command)
    _strip_unknown_command_fields(command)
    restored = SfxCommand.model_validate_json(SfxCommand.model_validate(command).model_dump_json())
    assert restored.action == "stop"
    assert restored.sfx_id == target
    assert restored.fade_ms == 750


def test_model_stop_without_target_means_all():
    command = {"type": "sfx", "action": "stop", "fade_ms": 500}
    _normalize_command(command)
    assert command["sfx_id"] == ""
    assert SfxCommand.model_validate(command).action == "stop"


@pytest.mark.parametrize("duration", [-1, 60001, 1.5, float("inf"), float("nan")])
def test_invalid_fade_rejected(duration):
    with pytest.raises(ValidationError):
        SfxCommand.model_validate({"type": "sfx", "action": "stop", "fade_ms": duration})


@pytest.mark.parametrize("duration", [0, 500, 60000, None])
def test_valid_fade(duration):
    assert SfxCommand.model_validate({"type": "sfx", "action": "stop", "fade_ms": duration}).fade_ms == duration


def test_invalid_action_rejected():
    with pytest.raises(ValidationError):
        SfxCommand.model_validate({"type": "sfx", "action": "execute"})
