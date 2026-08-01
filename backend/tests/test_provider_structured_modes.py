import json
from types import SimpleNamespace

import pytest
from pydantic import BaseModel, ValidationError

from app.ai.provider import AIProvider
from app.ai.prompts import SCENE_SYSTEM_PROMPT
from app.ai.structured_normalization import normalize_structured_payload
from app.core.errors import AIProviderError
from app.mcp.tools import agentvn_tool_registry
from app.models.memory import MemoryUpdate
from app.models.novel_import import NovelAiBranchSuggestionResponse, NovelAiChapterScenePlan
from app.models.novel_process import SubagentModelOutput
from app.models.scene import SceneBeat
from app.schemas.requests import ProviderSelectionParameters, ProviderSelectionRequest


class ProbeModel(BaseModel):
    ok: bool
    message: str


def make_selection(
    mode: str | None = None,
    request_timeout_seconds: float | None = None,
    thinking_mode: bool | None = None,
    base_url: str = "https://example.com/v1",
    model_id: str = "test-model",
    system_prompt: str | None = None,
) -> ProviderSelectionRequest:
    parameters = None
    if mode or request_timeout_seconds is not None or thinking_mode is not None or system_prompt is not None:
        parameters = ProviderSelectionParameters(
            structured_mode=mode,
            request_timeout_seconds=request_timeout_seconds,
            thinking_mode=thinking_mode,
            system_prompt=system_prompt,
        )
    return ProviderSelectionRequest(
        connection_id="conn_1",
        model_id=model_id,
        base_url=base_url,
        api_key="test-key",
        parameters=parameters,
    )


def test_tools_mode_can_fallback_to_json_object(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_tools(*args, **kwargs):
        calls.append("tools")
        error = RuntimeError("Error code: 400 - unsupported tool call")
        setattr(error, "status_code", 400)
        raise error

    def fake_json(*args, **kwargs):
        calls.append("json")
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr(provider, "_create_tool_structured", fake_tools)
    monkeypatch.setattr(provider, "_create_json_structured", fake_json)

    result = provider.create_structured(SceneBeat, "system", "user", selection=make_selection("tools"))

    assert result.scene_id == "scene_tool"
    assert calls == ["tools", "json"]


def test_json_object_mode_skips_tools(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_tools(*args, **kwargs):
        calls.append("tools")
        raise AssertionError("tools mode should not run")

    def fake_json(*args, **kwargs):
        calls.append("json")
        return ProbeModel(ok=True, message="ready")

    monkeypatch.setattr(provider, "_create_tool_structured", fake_tools)
    monkeypatch.setattr(provider, "_create_json_structured", fake_json)

    result = provider.create_structured(ProbeModel, "system", "user", selection=make_selection("json_object"))

    assert result.ok is True
    assert calls == ["json"]


def test_tools_mode_rejects_unregistered_structured_model() -> None:
    provider = AIProvider()

    with pytest.raises(AIProviderError, match="No AgentVN tool is registered"):
        provider.create_structured(ProbeModel, "system", "user", selection=make_selection("tools"))


def test_json_object_mode_repairs_invalid_structured_json() -> None:
    provider = AIProvider()
    invalid = '{"ok": true, "wrong": "field"}'
    repaired = '{"ok": true, "message": "ready"}'
    client = FakeLLMClient([FakeToolMessage(content=invalid), FakeToolMessage(content=repaired)])

    result = provider._create_json_structured(  # type: ignore[attr-defined]
        client,
        ProbeModel,
        "system",
        "user",
        {"model": "test-model", "temperature": 0},
    )

    assert result.message == "ready"
    assert len(client.chat.completions.calls) == 2


def test_structured_json_parser_accepts_common_model_wrappers() -> None:
    provider = AIProvider()
    content = 'Here is the JSON:\n```json\n{"ok": true, "message": "ready"}\n```\n'

    result = provider._validate_structured_content(ProbeModel, content)  # type: ignore[attr-defined]

    assert result.message == "ready"


def test_branch_suggestion_missing_confidence_defaults_to_usable_review_stub() -> None:
    payload = {
        "branch_suggestions": [
            {
                "suggestion_id": "branch_accept",
                "source_scene_id": "scene_candidate_1",
                "choice_text": "接受推荐",
                "branch_summary": "主角接受好友推荐并进入网聊路线。",
            }
        ]
    }

    normalized = normalize_structured_payload(NovelAiBranchSuggestionResponse, payload)
    response = NovelAiBranchSuggestionResponse(**normalized)

    assert response.branch_suggestions[0].confidence == 0.65
    assert response.branch_suggestions[0].enabled_by_default is False


def test_scene_generation_tool_schema_includes_structured_camera_motion() -> None:
    tools = {item["name"]: item for item in agentvn_tool_registry.list_tools()}
    for tool_name in ("create_scene_beat", "adapt_novel_scene"):
        schema = tools[tool_name]["inputSchema"]
        assert isinstance(schema, dict)
        camera_schema = schema["$defs"]["CameraCommand"]
        assert "motion" in camera_schema["properties"]
        assert "CameraResetMotionV1" in schema["$defs"]


def test_tool_registry_covers_every_production_structured_output() -> None:
    names = {item["name"] for item in agentvn_tool_registry.list_tools()}
    assert names == {
        "create_scene_beat",
        "extract_memory_update",
        "analyze_novel_chunk",
        "build_novel_outline",
        "plan_novel_chapter",
        "adapt_novel_scene",
        "summarize_novel_chunk",
        "index_novel_chunk_entities",
        "extract_novel_chunk_timeline",
        "build_novel_outline_mainline",
        "build_novel_outline_structure",
        "build_novel_outline_index",
        "plan_novel_chapter_scenes",
        "analyze_novel_conflicts",
        "suggest_novel_branches",
        "polish_scene_links",
        "submit_subagent_output",
    }
    assert all(isinstance(item["inputSchema"], dict) and item["inputSchema"] for item in agentvn_tool_registry.list_tools())


def test_ai_scene_normalization_preserves_structured_camera_motion() -> None:
    payload = {
        "scene_id": "scene_camera",
        "title": "镜头草稿",
        "summary": "模型尝试输出新版运镜。",
        "commands": [
            {
                "type": "camera",
                "motion": {
                    "schema_version": 1,
                    "kind": "reset",
                    "duration_ms": 1200,
                    "easing": "ease-out",
                },
                "blocking": True,
            }
        ],
        "tags": [],
        "chapter": 1,
    }

    normalized = normalize_structured_payload(SceneBeat, payload)
    scene = SceneBeat(**normalized)
    camera = scene.commands[0]

    assert camera.type == "camera"
    assert camera.motion is not None
    assert camera.motion.kind == "reset"
    assert camera.action is None
    assert camera.params is None


def test_subagent_structured_output_uses_large_token_floor() -> None:
    request_kwargs: dict[str, object] = {"model": "deepseek-v4-flash", "max_tokens": 4096}

    AIProvider()._apply_structured_token_floor(SubagentModelOutput, request_kwargs)  # type: ignore[attr-defined]

    assert request_kwargs["max_tokens"] == 6500


@pytest.mark.parametrize(
    ("model_id", "expected_max_tokens", "expected_context"),
    [
        ("deepseek-v4-flash", 4096, 24000),
        ("deepseek-v4-pro", 8192, 48000),
    ],
)
def test_deepseek_v4_backend_defaults_to_tools(
    model_id: str,
    expected_max_tokens: int,
    expected_context: int,
) -> None:
    parameters: dict[str, object] = {}

    AIProvider()._apply_deepseek_generation_defaults(parameters, model_id)  # type: ignore[attr-defined]

    assert parameters["structured_mode"] == "tools"
    assert parameters["thinking_mode"] is False
    assert parameters["max_tokens"] == expected_max_tokens
    assert parameters["context_budget_tokens"] == expected_context


def test_ai_scene_prompt_covers_every_editor_event_type() -> None:
    expected = {
        "dialog",
        "narration",
        "hide_dialog",
        "background",
        "show_image",
        "video",
        "sprite",
        "choice",
        "state_update",
        "conditional_jump",
        "jump",
        "animation",
        "bgm",
        "sfx",
        "camera",
        "wait",
    }

    assert all(command_type in SCENE_SYSTEM_PROMPT for command_type in expected)
    assert "Do not generate structured camera motion" not in SCENE_SYSTEM_PROMPT


def test_deepseek_flash_json_repair_uses_short_repair_budget() -> None:
    provider = AIProvider()
    invalid = '{"ok": true, "wrong": "field"}'
    repaired = '{"ok": true, "message": "ready"}'
    client = FakeLLMClient([FakeToolMessage(content=invalid), FakeToolMessage(content=repaired)])

    result = provider._create_json_structured(  # type: ignore[attr-defined]
        client,
        ProbeModel,
        "system",
        "user",
        {"model": "deepseek-v4-flash", "temperature": 0, "max_tokens": 4096},
    )

    assert result.message == "ready"
    assert client.chat.completions.calls[1]["max_tokens"] == 2048


def test_deepseek_flash_json_repair_keeps_complex_schema_token_floor() -> None:
    provider = AIProvider()
    invalid = '{"chapter_id": "chapter_1", "scenes": [{"bad": true}]}'
    repaired = json.dumps(
        {
            "chapter_id": "chapter_1",
            "scenes": [
                {
                    "scene_candidate_id": "scene_1",
                    "chapter_id": "chapter_1",
                    "title": "雨夜开场",
                    "index": 0,
                    "start_offset": 0,
                    "end_offset": 120,
                    "source_span": {"start_offset": 0, "end_offset": 120},
                    "source_excerpt": "雨声落下。",
                    "summary": "雨夜开场。",
                    "commands": [{"type": "narration", "text": "雨声落下。"}],
                    "characters": [],
                    "confidence": 0.8,
                }
            ],
            "warnings": [],
            "needs_review": False,
        },
        ensure_ascii=False,
    )
    client = FakeLLMClient([FakeToolMessage(content=invalid), FakeToolMessage(content=repaired)])

    result = provider._create_json_structured(  # type: ignore[attr-defined]
        client,
        NovelAiChapterScenePlan,
        "system",
        "user",
        {"model": "deepseek-v4-flash", "temperature": 0, "max_tokens": 4096},
    )

    assert result.scenes[0].commands[0].type == "narration"
    assert client.chat.completions.calls[1]["max_tokens"] == 5200


def test_deepseek_pro_json_repair_uses_pro_repair_budget() -> None:
    provider = AIProvider()
    invalid = '{"ok": true, "wrong": "field"}'
    repaired = '{"ok": true, "message": "ready"}'
    client = FakeLLMClient([FakeToolMessage(content=invalid), FakeToolMessage(content=repaired)])

    result = provider._create_json_structured(  # type: ignore[attr-defined]
        client,
        ProbeModel,
        "system",
        "user",
        {"model": "deepseek-v4-pro", "temperature": 0, "max_tokens": 8192},
    )

    assert result.message == "ready"
    assert client.chat.completions.calls[1]["max_tokens"] == 3072


def test_memory_update_json_failure_returns_partial_update() -> None:
    provider = AIProvider()
    invalid = '{"new_relations":["Alice is a conductor"]'
    broken_repair = '{"summary_100": "broken"'
    client = FakeLLMClient([FakeToolMessage(content=invalid), FakeToolMessage(content=broken_repair)])

    result = provider._create_json_structured(  # type: ignore[attr-defined]
        client,
        MemoryUpdate,
        "system",
        'SceneBeat JSON: {"summary":"Rain station promise","title":"Station"}',
        {"model": "test-model", "temperature": 0},
    )

    assert isinstance(result, MemoryUpdate)
    assert result.summary_100 == "Rain station promise"
    assert result.new_relations == []


class FakeToolMessage:
    def __init__(self, tool_calls=None, content: str = "", finish_reason: str = "tool_calls") -> None:
        self.tool_calls = tool_calls or []
        self.content = content
        self.finish_reason = finish_reason

    def model_dump(self, exclude_none: bool = True):
        return {
            "role": "assistant",
            "content": self.content,
            "tool_calls": [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {"name": call.function.name, "arguments": call.function.arguments},
                }
                for call in self.tool_calls
            ],
        }


class FakeCompletions:
    def __init__(self, messages: list[FakeToolMessage]) -> None:
        self.messages = messages
        self.calls: list[dict[str, object]] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        message = self.messages.pop(0)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message, finish_reason=message.finish_reason)]
        )


class FakeLLMClient:
    def __init__(self, messages: list[FakeToolMessage]) -> None:
        self.chat = SimpleNamespace(completions=FakeCompletions(messages))


def make_tool_call(name: str, arguments: dict[str, object], call_id: str = "call_1"):
    return SimpleNamespace(
        id=call_id,
        function=SimpleNamespace(name=name, arguments=json.dumps(arguments)),
    )


def valid_scene_payload() -> dict[str, object]:
    return {
        "scene_id": "scene_tool",
        "title": "工具生成",
        "summary": "通过工具调用生成的场景。",
        "chapter": 1,
        "commands": [{"type": "narration", "text": "房间里安静下来。"}],
        "tags": ["tool"],
    }


def test_mcp_tool_call_returns_validated_scene() -> None:
    provider = AIProvider()
    client = FakeLLMClient([FakeToolMessage([make_tool_call("create_scene_beat", valid_scene_payload())])])

    result = provider._create_tool_structured(  # type: ignore[attr-defined]
        client,
        SceneBeat,
        {
            "model": "test-model",
            "temperature": 0,
            "messages": [{"role": "system", "content": "system"}, {"role": "user", "content": "user"}],
        },
    )

    assert result.scene_id == "scene_tool"
    call_kwargs = client.chat.completions.calls[0]
    assert call_kwargs["tool_choice"] == {"type": "function", "function": {"name": "create_scene_beat"}}
    assert call_kwargs["tools"][0]["function"]["name"] == "create_scene_beat"


def test_scene_beat_normalizes_common_animation_aliases_from_tool_call() -> None:
    payload = valid_scene_payload()
    payload["commands"] = [
        *payload["commands"],  # type: ignore[list-item]
        {
            "type": "animation",
            "animation_id": "sprite_breathe",
            "target_sprite": "alice",
            "duration": 2.5,
            "loop": False,
            "blocking": False,
        },
    ]

    result = agentvn_tool_registry.validate_tool_arguments("create_scene_beat", payload)
    assert isinstance(result, SceneBeat)

    animation = result.commands[-1]
    assert animation.type == "animation"
    assert animation.target == "alice"
    assert animation.params["duration"] == 2.5
    assert animation.params["loop"] is False
    assert animation.blocking is False


def test_scene_beat_normalizes_show_image_aliases_and_clamps_backdrop() -> None:
    payload = valid_scene_payload()
    payload["commands"] = [
        {
            "type": "focus_image",
            "asset_id": "clue_photo",
            "image_fit": "invalid",
            "caption": "钥匙背面刻着编号。",
            "backdrop_opacity": 2,
            "backdrop_blur_px": -4,
        }
    ]

    normalized = normalize_structured_payload(SceneBeat, payload)
    result = SceneBeat.model_validate(normalized)
    command = result.commands[0]

    assert command.type == "show_image"
    assert command.image_id == "clue_photo"
    assert command.image_fit == "contain"
    assert command.backdrop_opacity == 0.9
    assert command.backdrop_blur_px == 0


def test_mcp_scene_schema_and_call_include_show_image() -> None:
    tool = next(item for item in agentvn_tool_registry.list_tools() if item["name"] == "create_scene_beat")
    assert '"show_image"' in json.dumps(tool["inputSchema"])

    payload = valid_scene_payload()
    payload["commands"] = [{"type": "display_image", "image": "letter_scan"}]
    result = agentvn_tool_registry.validate_tool_arguments("create_scene_beat", payload)

    assert isinstance(result, SceneBeat)
    assert result.commands[0].type == "show_image"
    assert result.commands[0].image_id == "letter_scan"


def test_scene_beat_normalizes_common_animation_aliases_from_json_mode() -> None:
    provider = AIProvider()
    payload = valid_scene_payload()
    payload["commands"] = [
        {
            "type": "animation",
            "animation_id": "screen_shake",
            "duration_ms": 500,
            "intensity": 0.4,
        }
    ]

    result = provider._validate_structured_content(SceneBeat, json.dumps(payload))  # type: ignore[attr-defined]
    animation = result.commands[0]

    assert animation.type == "animation"
    assert animation.target == "screen"
    assert animation.params["duration_ms"] == 500
    assert animation.params["intensity"] == 0.4


def test_mcp_tool_call_retries_after_invalid_arguments() -> None:
    provider = AIProvider()
    invalid_payload = {"scene_id": "missing_required_fields"}
    client = FakeLLMClient(
        [
            FakeToolMessage([make_tool_call("create_scene_beat", invalid_payload, "call_bad")]),
            FakeToolMessage([make_tool_call("create_scene_beat", valid_scene_payload(), "call_good")]),
        ]
    )

    result = provider._create_tool_structured(  # type: ignore[attr-defined]
        client,
        SceneBeat,
        {
            "model": "test-model",
            "temperature": 0,
            "messages": [{"role": "system", "content": "system"}, {"role": "user", "content": "user"}],
        },
    )

    assert result.title == "工具生成"
    assert len(client.chat.completions.calls) == 2
    retry_messages = client.chat.completions.calls[1]["messages"]
    assert any(message.get("role") == "tool" for message in retry_messages)


def test_tool_call_retries_truncated_finish_reason_without_accepting_partial_arguments() -> None:
    provider = AIProvider()
    client = FakeLLMClient(
        [
            FakeToolMessage(
                [make_tool_call("create_scene_beat", {"scene_id": "partial"}, "call_partial")],
                finish_reason="length",
            ),
            FakeToolMessage([make_tool_call("create_scene_beat", valid_scene_payload(), "call_complete")]),
        ]
    )

    result = provider._create_tool_structured(  # type: ignore[attr-defined]
        client,
        SceneBeat,
        {
            "model": "test-model",
            "temperature": 0,
            "messages": [{"role": "system", "content": "system"}, {"role": "user", "content": "user"}],
        },
    )

    assert result.scene_id == "scene_tool"
    assert len(client.chat.completions.calls) == 2
    assert "truncated" in client.chat.completions.calls[1]["messages"][-1]["content"]


def test_mcp_tool_call_rejects_plain_text_response() -> None:
    provider = AIProvider()
    client = FakeLLMClient([
        FakeToolMessage(content="Here is JSON as text."),
        FakeToolMessage(content="Still text."),
        FakeToolMessage(content="Still text."),
    ])

    with pytest.raises(AIProviderError, match="did not call"):
        provider._create_tool_structured(  # type: ignore[attr-defined]
            client,
            SceneBeat,
            {
                "model": "test-model",
                "temperature": 0,
                "messages": [{"role": "system", "content": "system"}, {"role": "user", "content": "user"}],
            },
        )


def test_auto_mode_rejects_plain_text_when_model_skips_required_mcp_tool(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_mcp_tool(*args, **kwargs):
        calls.append("mcp")
        raise AIProviderError("Model did not call the required AgentVN MCP tool `create_scene_beat`.")

    def fake_json(*args, **kwargs):
        calls.append("json")
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr(provider, "_create_tool_structured", fake_mcp_tool)
    monkeypatch.setattr(provider, "_create_json_structured", fake_json)

    with pytest.raises(AIProviderError, match="did not call"):
        provider.create_structured(SceneBeat, "system", "user", selection=make_selection("auto"))

    assert calls == ["mcp"]


def test_mcp_tools_mode_falls_back_when_provider_rejects_tool_choice(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_mcp_tool(*args, **kwargs):
        calls.append("mcp")
        error = RuntimeError("Thinking mode does not support this tool_choice")
        setattr(error, "status_code", 400)
        raise error

    def fake_json(*args, **kwargs):
        calls.append("json")
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr(provider, "_create_tool_structured", fake_mcp_tool)
    monkeypatch.setattr(provider, "_create_json_structured", fake_json)

    result = provider.create_structured(SceneBeat, "system", "user", selection=make_selection("tools"))

    assert result.scene_id == "scene_tool"
    assert calls == ["mcp", "json"]


def test_tools_mode_does_not_fall_back_for_generic_bad_request(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_tool(*args, **kwargs):
        calls.append("tool")
        error = RuntimeError("Error code: 400 - invalid schema arguments")
        setattr(error, "status_code", 400)
        raise error

    def fake_json(*args, **kwargs):
        calls.append("json")
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr(provider, "_create_tool_structured", fake_tool)
    monkeypatch.setattr(provider, "_create_json_structured", fake_json)

    with pytest.raises(AIProviderError, match="invalid schema arguments"):
        provider.create_structured(SceneBeat, "system", "user", selection=make_selection("tools"))

    assert calls == ["tool"]


def test_model_plain_text_claiming_tools_are_unsupported_does_not_trigger_json_fallback(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_tool(*args, **kwargs):
        calls.append("tool")
        raise AIProviderError(
            "Model did not call the required AgentVN tool `create_scene_beat`. "
            "Assistant text cannot be used as project data: function calling is not supported"
        )

    def fake_json(*args, **kwargs):
        calls.append("json")
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr(provider, "_create_tool_structured", fake_tool)
    monkeypatch.setattr(provider, "_create_json_structured", fake_json)

    with pytest.raises(AIProviderError, match="did not call"):
        provider.create_structured(SceneBeat, "system", "user", selection=make_selection("auto"))

    assert calls == ["tool"]


def test_stream_mcp_tools_mode_falls_back_when_provider_rejects_tool_choice(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_mcp_tool(*args, **kwargs):
        calls.append("mcp")
        error = RuntimeError("Thinking mode does not support this tool_choice")
        setattr(error, "status_code", 400)
        raise error

    def fake_json(*args, **kwargs):
        calls.append("json")
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr(provider, "_create_tool_structured", fake_mcp_tool)
    monkeypatch.setattr(provider, "_create_json_structured", fake_json)

    events = list(provider.stream_with_tools(SceneBeat, "system", "user", selection=make_selection("tools")))

    assert calls == ["mcp", "json"]
    assert any(kind == "final" for kind, _payload in events)


def test_stream_tools_mode_does_not_fall_back_when_tool_request_times_out(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_mcp_tool(*args, **kwargs):
        calls.append("mcp")
        raise TimeoutError("Request timed out.")

    def fake_json(*args, **kwargs):
        calls.append("json")
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr(provider, "_create_tool_structured", fake_mcp_tool)
    monkeypatch.setattr(provider, "_create_json_structured", fake_json)

    with pytest.raises(AIProviderError, match="timed out"):
        list(provider.stream_with_tools(SceneBeat, "system", "user", selection=make_selection("tools")))

    assert calls == ["mcp"]


def test_stream_mcp_auto_mode_rejects_plain_text_when_model_skips_required_tool(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_mcp_tool(*args, **kwargs):
        calls.append("mcp")
        raise AIProviderError("Model did not call the required AgentVN MCP tool `create_scene_beat`.")

    def fake_json(*args, **kwargs):
        calls.append("json")
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr(provider, "_create_tool_structured", fake_mcp_tool)
    monkeypatch.setattr(provider, "_create_json_structured", fake_json)

    with pytest.raises(AIProviderError, match="did not call"):
        list(provider.stream_with_tools(SceneBeat, "system", "user", selection=make_selection("auto")))

    assert calls == ["mcp"]


def test_scene_generation_defaults_to_mcp_tools_when_mode_is_missing(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_mcp_tool(*args, **kwargs):
        calls.append("mcp")
        return SceneBeat(**valid_scene_payload())

    def fake_json(*args, **kwargs):
        calls.append("json")
        raise AssertionError("JSON mode should not be the default for SceneBeat")

    monkeypatch.setattr(provider, "_create_tool_structured", fake_mcp_tool)
    monkeypatch.setattr(provider, "_create_json_structured", fake_json)

    result = provider.create_structured(SceneBeat, "system", "user", selection=make_selection(None))

    assert result.scene_id == "scene_tool"
    assert calls == ["mcp"]


def test_provider_generation_probe_uses_mcp_tool_call(monkeypatch) -> None:
    provider = AIProvider()

    def fake_create_with_tools(response_model, *args, **kwargs):
        if response_model is SceneBeat:
            return SceneBeat(**valid_scene_payload())
        if response_model is MemoryUpdate:
            return SimpleNamespace(summary_100="memory ok")
        if response_model is NovelAiChapterScenePlan:
            return SimpleNamespace(chapter_id="provider_probe_chapter")
        raise AssertionError(response_model)

    def fake_create_structured(response_model, *args, **kwargs):
        if response_model is SceneBeat:
            return SceneBeat(**valid_scene_payload())
        return SimpleNamespace(summary_100="memory ok")

    monkeypatch.setattr(provider, "create_with_tools", fake_create_with_tools)
    monkeypatch.setattr(provider, "create_structured", fake_create_structured)

    result = provider.test_generation(make_selection("tools"))

    assert result.ok is True
    assert result.tool_calling_ok is True
    assert result.json_mode_ok is None
    assert result.scene_schema_ok is True
    assert result.memory_schema_ok is True
    assert result.complex_schema_ok is True
    assert result.recommended_structured_mode == "tools"


def test_provider_generation_probe_runs_json_only_after_explicit_tool_unsupported(monkeypatch) -> None:
    provider = AIProvider()
    calls: list[str] = []

    def fake_create_with_tools(*args, **kwargs):
        calls.append("tool")
        raise RuntimeError("function calling is not supported")

    def fake_create_structured(*args, **kwargs):
        calls.append("json")
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr(provider, "create_with_tools", fake_create_with_tools)
    monkeypatch.setattr(provider, "create_structured", fake_create_structured)

    result = provider.test_generation(make_selection("tools"))

    assert result.ok is True
    assert result.tool_calling_ok is False
    assert result.tool_unsupported is True
    assert result.json_mode_ok is True
    assert result.recommended_structured_mode == "json_object"
    assert calls == ["tool", "json"]


def test_provider_selection_timeout_validates_range() -> None:
    assert ProviderSelectionParameters(request_timeout_seconds=30).request_timeout_seconds == 30
    assert ProviderSelectionParameters(request_timeout_seconds=900).request_timeout_seconds == 900
    with pytest.raises(ValidationError):
        ProviderSelectionParameters(request_timeout_seconds=29)
    with pytest.raises(ValidationError):
        ProviderSelectionParameters(request_timeout_seconds=901)


def test_provider_selection_system_prompt_validates_length() -> None:
    assert ProviderSelectionParameters(system_prompt="保持克制文风").system_prompt == "保持克制文风"
    with pytest.raises(ValidationError):
        ProviderSelectionParameters(system_prompt="x" * 8001)


class CapturingOpenAI:
    calls: list[dict[str, object]] = []
    completion_calls: list[dict[str, object]] = []

    def __init__(self, **kwargs) -> None:
        self.__class__.calls.append(kwargs)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.__class__.completion_calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="assistant ready"))])


def test_structured_calls_use_default_request_timeout(monkeypatch) -> None:
    provider = AIProvider()
    CapturingOpenAI.calls = []

    def fake_tools(*args, **kwargs):
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr("app.ai.provider.OpenAI", CapturingOpenAI)
    monkeypatch.setattr(provider, "_create_tool_structured", fake_tools)

    result = provider.create_structured(SceneBeat, "system", "user", selection=make_selection(None))

    assert result.scene_id == "scene_tool"
    assert CapturingOpenAI.calls[-1]["timeout"].read == 300.0
    assert CapturingOpenAI.calls[-1]["timeout"].write == 300.0
    assert CapturingOpenAI.calls[-1]["timeout"].connect == 300.0
    assert CapturingOpenAI.calls[-1]["max_retries"] == 0


def test_structured_stream_and_chat_use_selection_request_timeout(monkeypatch) -> None:
    provider = AIProvider()
    CapturingOpenAI.calls = []

    def fake_mcp_tool(*args, **kwargs):
        return SceneBeat(**valid_scene_payload())

    monkeypatch.setattr("app.ai.provider.OpenAI", CapturingOpenAI)
    monkeypatch.setattr(provider, "_create_tool_structured", fake_mcp_tool)

    selection = make_selection("tools", request_timeout_seconds=600)
    events = list(provider.stream_with_tools(SceneBeat, "system", "user", selection=selection))
    answer = provider.create_chat("system", [{"role": "user", "content": "hello"}], selection=selection)

    assert events[-1][0] == "final"
    assert answer == "assistant ready"
    timeouts = [call["timeout"] for call in CapturingOpenAI.calls if "timeout" in call]
    assert [timeout.read for timeout in timeouts] == [600.0, 600.0]
    assert [timeout.write for timeout in timeouts] == [600.0, 600.0]
    assert [timeout.connect for timeout in timeouts] == [600.0, 600.0]


def test_deepseek_thinking_mode_false_is_sent_as_extra_body(monkeypatch) -> None:
    provider = AIProvider()
    CapturingOpenAI.calls = []
    CapturingOpenAI.completion_calls = []

    monkeypatch.setattr("app.ai.provider.OpenAI", CapturingOpenAI)

    selection = make_selection(
        thinking_mode=False,
        base_url="https://api.deepseek.com",
        model_id="deepseek-v4-pro",
    )
    answer = provider.create_chat("system", [{"role": "user", "content": "hello"}], selection=selection)

    assert answer == "assistant ready"
    assert CapturingOpenAI.completion_calls[-1]["extra_body"] == {"thinking": {"type": "disabled"}}


def test_text_calls_append_custom_system_prompt(monkeypatch) -> None:
    provider = AIProvider()
    CapturingOpenAI.calls = []
    CapturingOpenAI.completion_calls = []

    monkeypatch.setattr("app.ai.provider.OpenAI", CapturingOpenAI)

    selection = make_selection(system_prompt="请保持酒馆式角色约束。")
    answer = provider.create_chat("AgentVN base system.", [{"role": "user", "content": "hello"}], selection=selection)

    system_message = CapturingOpenAI.completion_calls[-1]["messages"][0]["content"]
    assert answer == "assistant ready"
    assert "AgentVN base system." in system_message
    assert "[用户模型系统提示词]" in system_message
    assert "请保持酒馆式角色约束。" in system_message
    assert "不得覆盖 AgentVN 的结构化 schema" in system_message
