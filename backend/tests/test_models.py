from pydantic import TypeAdapter

from app.models.commands import BackgroundFit, GameCommand
from app.models.common import MemoryMode
from app.models.memory import MemoryUpdate
from app.models.scene import SceneBeat


def test_scene_serialization() -> None:
    scene = SceneBeat(
        scene_id="scene_1",
        title="Opening",
        summary="Alice enters.",
        chapter=1,
        commands=[
            {"type": "narration", "text": "Rain taps on the window."},
            {"type": "dialog", "character_id": "alice", "text": "Are you there?", "side": "left"},
        ],
    )
    payload = scene.model_dump(mode="json")
    assert payload["commands"][0]["type"] == "narration"
    assert scene.model_validate_json(scene.model_dump_json()).scene_id == "scene_1"


def test_game_command_discriminated_union() -> None:
    adapter = TypeAdapter(GameCommand)
    command = adapter.validate_python({"type": "wait", "duration_ms": 500})
    assert command.type == "wait"


def test_hide_dialog_command_has_no_payload() -> None:
    adapter = TypeAdapter(GameCommand)
    command = adapter.validate_python({"type": "hide_dialog"})
    assert command.type == "hide_dialog"
    assert command.model_dump(mode="json") == {"type": "hide_dialog"}


def test_background_command_accepts_fit_mode() -> None:
    adapter = TypeAdapter(GameCommand)
    command = adapter.validate_python({"type": "background", "background_id": "hallway", "background_fit": "contain"})
    assert command.type == "background"
    assert command.background_fit == BackgroundFit.CONTAIN
    assert command.model_dump(mode="json")["background_fit"] == "contain"


def test_camera_command_accepts_structured_motion_without_legacy_fields() -> None:
    adapter = TypeAdapter(GameCommand)
    command = adapter.validate_python(
        {
            "type": "camera",
            "motion": {
                "schema_version": 1,
                "kind": "reframe",
                "to": {"center_x": 0.5, "center_y": 0.5, "zoom": 1.4},
                "duration_ms": 1400,
                "easing": "cubic-bezier(0.22, 1, 0.36, 1)",
            },
            "blocking": True,
        }
    )
    payload = command.model_dump(mode="json")
    assert payload["motion"]["kind"] == "reframe"
    assert "action" not in payload
    assert "params" not in payload


def test_camera_command_accepts_blocking_sequence_and_rejects_invalid_shapes() -> None:
    adapter = TypeAdapter(GameCommand)
    payload = {
        "type": "camera",
        "motion": {
            "schema_version": 1,
            "kind": "sequence",
            "shots": [
                {
                    "to": {"center_x": 0.5, "center_y": 0.5, "zoom": 1.2},
                    "duration_ms": 500,
                    "easing": "linear",
                },
                {
                    "to": {"center_x": 0.6, "center_y": 0.5, "zoom": 1.5},
                    "duration_ms": 900,
                    "easing": "ease-out",
                },
            ],
        },
        "blocking": True,
    }
    command = adapter.validate_python(payload)
    assert command.model_dump(mode="json", exclude_none=True) == payload

    for invalid in (
        {**payload, "blocking": False},
        {
            **payload,
            "motion": {
                **payload["motion"],
                "shots": payload["motion"]["shots"][:1],
            },
        },
    ):
        try:
            adapter.validate_python(invalid)
        except ValueError:
            continue
        raise AssertionError("invalid camera sequence must be rejected")


def test_camera_command_rejects_mixed_new_and_legacy_fields() -> None:
    adapter = TypeAdapter(GameCommand)
    try:
        adapter.validate_python(
            {
                "type": "camera",
                "action": "shake",
                "params": {},
                "motion": {
                    "schema_version": 1,
                    "kind": "shake",
                    "direction": "omni",
                    "intensity": 0.45,
                    "duration_ms": 520,
                },
                "blocking": False,
            }
        )
    except ValueError:
        return
    raise AssertionError("camera command must reject mixed new and legacy fields")


def test_show_image_command_accepts_focus_fields() -> None:
    adapter = TypeAdapter(GameCommand)
    command = adapter.validate_python(
        {
            "type": "show_image",
            "image_id": "clue_photo",
            "image_fit": "cover",
            "image_display_name": "沾血的钥匙",
            "caption": "背面刻着旧宿舍编号。",
            "alt": "一把带编号的旧钥匙",
            "backdrop_opacity": 0.7,
            "backdrop_blur_px": 16,
        }
    )
    assert command.type == "show_image"
    assert command.image_fit == BackgroundFit.COVER
    assert command.model_dump(mode="json")["backdrop_blur_px"] == 16


def test_game_command_contract_accepts_every_editor_event_and_rich_fields() -> None:
    adapter = TypeAdapter(GameCommand)
    commands = [
        {
            "type": "dialog",
            "character_id": "alice",
            "text": "Hello.",
            "dialog_style": {"theme_color": "#112233", "font_size": 24},
            "dialog_style_mode": "manual",
        },
        {
            "type": "narration",
            "text": "Night falls.",
            "dialog_style": {"text_color": "#f8fafc"},
            "dialog_style_mode": "inherit",
        },
        {"type": "hide_dialog"},
        {
            "type": "background",
            "background_id": "station",
            "transition_config": {"kind": "crossfade", "duration_ms": 500, "easing": "ease-out"},
        },
        {"type": "show_image", "image_id": "letter"},
        {"type": "video", "video_id": "opening"},
        {
            "type": "sprite",
            "character_id": "alice",
            "sprite_id": "alice_calm",
            "visible": True,
            "layer": 3,
            "scale": 1.1,
            "animation_config": {"kind": "fade", "phase": "enter", "duration_ms": 300},
            "switch_transition": {"kind": "fade", "duration_ms": 240},
        },
        {
            "type": "choice",
            "choices": [
                {
                    "choice_id": "ask",
                    "text": "Ask",
                    "target_scene_id": "scene_answer",
                    "conditions": [{"key": "trust", "operator": "greater_or_equal", "value": 2}],
                }
            ],
        },
        {
            "type": "state_update",
            "key": "met_alice",
            "operation": "set_if_unset",
            "value": True,
            "value_type": "boolean",
        },
        {
            "type": "conditional_jump",
            "condition": {"key": "met_alice", "operator": "truthy"},
            "target_scene_id": "scene_answer",
            "else_target_scene_id": "scene_wait",
        },
        {"type": "jump", "target_scene_id": "scene_answer"},
        {"type": "animation", "animation_id": "flash", "target": "screen", "params": {}, "blocking": True},
        {"type": "bgm", "bgm_id": "theme", "action": "play"},
        {"type": "sfx", "sfx_id": "bell"},
        {
            "type": "camera",
            "motion": {"schema_version": 1, "kind": "reset", "duration_ms": 200, "easing": "ease"},
            "blocking": True,
        },
        {"type": "wait", "duration_ms": 300},
    ]

    validated = [adapter.validate_python(command).model_dump(mode="json", exclude_none=True) for command in commands]

    assert [command["type"] for command in validated] == [command["type"] for command in commands]
    assert validated[0]["dialog_style"]["theme_color"] == "#112233"
    assert validated[3]["transition_config"]["kind"] == "crossfade"
    assert validated[6]["layer"] == 3
    assert validated[7]["choices"][0]["conditions"][0]["operator"] == "greater_or_equal"
    assert validated[8]["operation"] == "set_if_unset"


def test_memory_mode_values() -> None:
    assert MemoryMode("none") == MemoryMode.NONE
    assert MemoryMode("hybrid").value == "hybrid"


def test_memory_update_accepts_model_variant_keys() -> None:
    update = MemoryUpdate.model_validate(
        {
            "summary_100": "主角得知必须当面告知真相。",
            "objective_relations": [
                {
                    "entity1_id": "protagonist",
                    "entity2_id": "alice",
                    "relation_type": "需要当面说明真相",
                    "evidence": "爱丽丝要求主角当面说清楚。",
                    "change": "add",
                }
            ],
            "subjective_snapshots": [
                {
                    "character_id": "protagonist",
                    "emotion": "紧张",
                    "summary": "主角意识到这件事不能继续拖延，必须当面告知。",
                }
            ],
        }
    )

    assert update.new_relations[0].source == "protagonist"
    assert update.new_relations[0].target == "alice"
    assert update.new_relations[0].relation == "需要当面说明真相"
    assert update.emotion_snapshots[0].current_emotion == "紧张"
