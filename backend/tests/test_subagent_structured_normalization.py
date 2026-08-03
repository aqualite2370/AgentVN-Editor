from app.ai.structured_normalization import normalize_structured_payload
from app.models.novel_process import SubagentModelOutput


def test_subagent_output_normalizes_common_camel_case_scene_shape() -> None:
    payload = {
        "status": "completed",
        "resultText": "Parsed one chunk.",
        "summary": "The protagonist meets Alice.",
        "continuityNotes": "Alice now trusts the protagonist.",
        "scenes": [
            {
                "sceneId": "scene_2_1",
                "sceneTitle": "Station meeting",
                "sceneType": "dialogue",
                "location": "station",
                "characters": ["alice"],
                "description": "They meet at the station.",
                "dialogue": [{"speaker": "alice", "text": "You came."}],
                "actions": ["The protagonist closes the umbrella."],
                "choices": [],
            }
        ],
        "inputTokens": 3500,
        "outputTokens": 1200,
        "warnings": [],
        "errorMessage": None,
    }

    normalized = normalize_structured_payload(SubagentModelOutput, payload)
    output = SubagentModelOutput.model_validate(normalized)

    assert output.continuityNotes == ["Alice now trusts the protagonist."]
    assert output.scenes[0].scene_id == "scene_2_1"
    assert output.scenes[0].title == "Station meeting"
    assert output.scenes[0].summary == "They meet at the station."
    assert [command.type for command in output.scenes[0].commands] == ["dialog", "narration"]


def test_subagent_output_wraps_a_single_scene_payload() -> None:
    payload = {
        "sceneId": "scene_2_0",
        "sceneTitle": "Morning",
        "sceneType": "daily_life",
        "location": "dorm",
        "characters": ["hero"],
        "beats": [
            {"beatType": "dialogue", "speaker": "hero", "content": "Good morning."},
            {"beatType": "action", "content": "The hero opens the curtains."},
        ],
    }

    normalized = normalize_structured_payload(SubagentModelOutput, payload)
    output = SubagentModelOutput.model_validate(normalized)

    assert output.status == "completed"
    assert output.scenes[0].scene_id == "scene_2_0"
    assert [command.type for command in output.scenes[0].commands] == ["dialog", "narration"]


def test_subagent_output_normalizes_deepseek_command_aliases_and_sprite_animation() -> None:
    payload = {
        "status": "completed",
        "scenes": [
            {
                "scene_id": "scene_1",
                "title": "科学边界",
                "summary": "汪淼与来访者交谈。",
                "chapter": "第一章 科学边界",
                "commands": [
                    {"type": "show_background", "background": "汪淼家门厅"},
                    {
                        "type": "show_character",
                        "character": "汪淼",
                        "sprite": "汪淼",
                        "position": "left",
                        "animation": {"kind": "fade", "phase": "enter"},
                    },
                    {"type": "dialogue", "character": "汪淼", "text": "请进。"},
                    {"type": "hide_character", "character": "汪淼"},
                ],
            }
        ],
    }

    normalized = normalize_structured_payload(SubagentModelOutput, payload)
    output = SubagentModelOutput.model_validate(normalized)

    scene = output.scenes[0]
    assert scene.chapter == 1
    assert [command.type for command in scene.commands] == ["background", "sprite", "dialog", "sprite"]
    assert scene.commands[1].animation_config is not None
    assert scene.commands[1].animation_config.kind == "fade"
    assert scene.commands[1].animation_config.phase == "enter"
    assert scene.commands[3].visible is False


def test_subagent_output_preserves_and_normalizes_v3_fragment_commands() -> None:
    payload = {
        "status": "completed",
        "summary": "片段摘要",
        "fragment": {
            "summary": "片段摘要",
            "tags": ["chapter_fragment"],
            "commands": [
                {"type": "show_background", "background": "作战中心"},
                {"type": "dialogue", "speaker": "常伟思", "text": "开始吧。"},
            ],
            "continuityNotes": "常伟思主持会议。",
        },
    }

    normalized = normalize_structured_payload(SubagentModelOutput, payload)
    output = SubagentModelOutput.model_validate(normalized)

    assert output.fragment is not None
    assert [command.type for command in output.fragment.commands] == ["background", "dialog"]
    assert output.fragment.continuityNotes == ["常伟思主持会议。"]
