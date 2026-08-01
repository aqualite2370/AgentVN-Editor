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
