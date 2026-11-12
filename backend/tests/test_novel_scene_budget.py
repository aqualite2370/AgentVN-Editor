"""Controlled planning calls: no real model, credentials, or user database."""
import json
from copy import deepcopy

import pytest

from app.core.errors import AIProviderError
from app.models.novel_import import NovelAiPlanChapterRequest
from app.services.novel_import_service import NovelImportService


def request_for(size=4047, **updates):
    text = ("窗前传来脚步声。他看向门口。\n" * size)[:size]
    return NovelAiPlanChapterRequest.model_validate({
        "max_retries": 0,  # Test explicit no-retry checkpoint behavior.
        "document_id": "budget-fixture",
        "chapter": {"chapter_id": "ch39", "title": "第39章", "index": 38,
                    "start_offset": 20000, "end_offset": 20000 + size, "summary": "来访"},
        "text": text, "outline_summary": "故事大纲。" * 112,
        "known_characters": [
            {"character_id": f"person{i}", "name": f"角色{i}",
             "description": "已知角色。", "confidence": .8} for i in range(54)],
        "min_scene_count": 2, "suggested_scene_count": 2,
        "provider_selection": {"connection_id": "controlled", "model_id": "deepseek-v4-flash",
            "base_url": "http://127.0.0.1:9", "api_key": "not-a-real-key",
            "parameters": {"context_budget_tokens": 24000, "structured_mode": "json_object"}},
        **updates,
    })


def compact_result(model, prompt):
    data = json.loads(prompt.split("本批输入 JSON:\n", 1)[1])
    text, start = data["text"], data["start_offset"]
    count = data["min_scene_count"]
    cuts = [round(len(text) * i / count) for i in range(count + 1)]
    return model.model_validate({"scenes": [
        {"title": f"来访{i}", "summary": "角色回应来访者。",
         "start_offset": start + cuts[i], "end_offset": start + cuts[i + 1],
         "start_quote": text[cuts[i]:cuts[i + 1]][:24],
         "end_quote": text[cuts[i]:cuts[i + 1]][-24:],
         "characters": ["角色0"], "confidence": .8}
        for i in range(count)], "warnings": [], "needs_review": False})


def controlled(service, monkeypatch, *, fail_at=None):
    calls = []
    def stream(model, system, prompt, **kwargs):
        assert model.__name__ == "NovelAiChapterSceneBatch"
        calls.append((system, prompt, kwargs))
        if fail_at and len(calls) == fail_at:
            raise AIProviderError("finish_reason=length; output limit reached")
        yield "delta", '{"scenes":'
        yield "final", compact_result(model, prompt)
    monkeypatch.setattr(service.provider, "stream_with_tools", stream)
    monkeypatch.setattr(service, "_stream_ai_chapter_conflict_points",
                        lambda *args: iter_with_result([]))
    monkeypatch.setattr(service, "_stream_ai_chapter_branch_suggestions",
                        lambda *args: iter_with_result([]))
    return calls


def iter_with_result(result):
    yield from ()
    return result


def finish(events):
    rows = list(events)
    return rows, next(value for event, value in rows if event == "final")


def test_real_failure_size_is_bounded_before_call_and_source_is_not_repeated(monkeypatch):
    from app.services.novel_scene_pipeline import ScenePlanningPipeline
    from app.services.novel_outline_pipeline import tokens
    service, request = NovelImportService(), request_for()
    calls = controlled(service, monkeypatch)
    rows, result = finish(service.stream_ai_plan_chapter(request))
    assert 1 < len(calls) <= 5
    assert "".join(s.source_excerpt for s in result.scenes) == request.text
    assert len({s.scene_candidate_id for s in result.scenes}) == len(result.scenes)
    assert all(s.commands for s in result.scenes)
    assert result.chapter_id == request.chapter.chapter_id
    batches = [p for e, p in rows if e == "checkpoint" and p["stage"] == "scene_batch"]
    assert len(batches) == len(calls)
    pipeline = ScenePlanningPipeline(service, request)
    for system, prompt, kwargs in calls:
        assert "GameCommand" not in system + prompt
        assert "api_key" not in prompt and "not-a-real-key" not in prompt
        assert "source_excerpt" not in json.dumps(pipeline.model.model_json_schema())
        assert tokens(system + prompt + json.dumps(pipeline.model.model_json_schema())) <= pipeline.input_budget
        assert pipeline.maximum_output_tokens <= kwargs["selection"].parameters.max_tokens


def test_successful_subbatch_survives_length_failure_and_only_missing_calls_resume(monkeypatch):
    service, request = NovelImportService(), request_for()
    calls = controlled(service, monkeypatch, fail_at=2)
    rows = []
    with pytest.raises(AIProviderError, match="第39章.*2/"):
        for row in service.stream_ai_plan_chapter(request):
            rows.append(row)
    assert len(calls) == 2  # No automatic paid retry.
    partials = [p["payload"] for e, p in rows if e == "checkpoint" and p["stage"] == "scene_batch"]
    assert len(partials) == 1
    restored = request.model_copy(update={"partial_batches": partials})
    resumed = controlled(service, monkeypatch)
    _, result = finish(service.stream_ai_plan_chapter(restored))
    assert calls[0][1] not in [c[1] for c in resumed]
    assert "".join(s.source_excerpt for s in result.scenes) == request.text


@pytest.mark.parametrize("field", ["text", "outline_summary", "known_characters", "document_id"])
def test_resume_cache_is_bound_to_authoritative_input(monkeypatch, field):
    service, request = NovelImportService(), request_for(120)
    controlled(service, monkeypatch)
    rows, _ = finish(service.stream_ai_plan_chapter(request))
    partials = [p["payload"] for e, p in rows if e == "checkpoint" and p["stage"] == "scene_batch"]
    value = getattr(request, field)
    change = (value[:-1] + "新" if field == "text" else value + "新") if isinstance(value, str) else []
    changed = request.model_copy(update={field: change, "partial_batches": partials})
    calls = controlled(service, monkeypatch)
    finish(service.stream_ai_plan_chapter(changed))
    assert calls, "Never reuse a result from a different input."


def test_bad_cache_is_rejected_before_any_model_request(monkeypatch):
    service, request = NovelImportService(), request_for()
    controlled(service, monkeypatch)
    rows, _ = finish(service.stream_ai_plan_chapter(request))
    partials = [deepcopy(p["payload"]) for e, p in rows if e == "checkpoint" and p["stage"] == "scene_batch"]
    partials[0]["payload"]["scenes"][0]["end_offset"] = 1
    calls = controlled(service, monkeypatch)
    with pytest.raises(AIProviderError, match="断点"):
        finish(service.stream_ai_plan_chapter(request.model_copy(update={"partial_batches": partials})))
    assert not calls


def test_fixed_context_too_large_is_rejected_without_trimming_source_or_calling(monkeypatch):
    service = NovelImportService()
    request = request_for(outline_summary="中" * 30000)
    calls = controlled(service, monkeypatch)
    with pytest.raises(AIProviderError, match="输入.*预算"):
        finish(service.stream_ai_plan_chapter(request))
    assert not calls


def test_bounded_generation_schema_and_registry_reject_verbose_or_executable_output():
    from app.models.novel_import import NovelAiChapterSceneBatch
    from app.mcp.tools import agentvn_tool_registry
    from pydantic import ValidationError
    assert agentvn_tool_registry.has_model(NovelAiChapterSceneBatch)
    model = compact_result(NovelAiChapterSceneBatch, "本批输入 JSON:\n" + json.dumps({
        "text": "来访者推开房门。", "start_offset": 100, "min_scene_count": 1}))
    for patch in [{"summary": "中" * 161}, {"commands": []}, {"source_excerpt": "不能复制正文"}]:
        payload = model.model_dump()
        payload["scenes"][0].update(patch)
        with pytest.raises(ValidationError):
            NovelAiChapterSceneBatch.model_validate(payload)


def test_length_error_does_not_suggest_replacing_keys_or_base_url():
    from app.ai.provider import AIProvider
    message = AIProvider()._format_provider_error(
        AIProviderError("Structured output truncated (finish_reason=length, output limit reached)"),
        "http://127.0.0.1:9", "controlled")
    assert "输出" in message and "单批" in message
    assert "请检查 Base URL" not in message


def test_character_memory_keeps_all_identities_and_only_relevant_bounded_notes(monkeypatch):
    service, request = NovelImportService(), request_for()
    original = request.model_dump()
    request.known_characters[0].name = "窗前"
    request.known_characters[0].description = "人物经历。" * 5000
    from app.services.novel_scene_pipeline import ScenePlanningPipeline
    pipeline = ScenePlanningPipeline(service, request)
    calls = controlled(service, monkeypatch)
    finish(service.stream_ai_plan_chapter(request))
    for _, prompt, _ in calls:
        data = json.loads(prompt.split("本批输入 JSON:\n", 1)[1])
        context = data["known_characters"]
        assert len(context["identities"]) == 54
        assert all(len(row["description"]) <= 160 for row in context["relevant"])
        assert len(context["relevant"]) == 1
    assert request.text == original["text"]
    assert len(request.known_characters[0].description) == 25000
    assert pipeline.fits((0, 0, 1))


@pytest.mark.parametrize("reuse", [False, True])
def test_scene_wire_spans_use_utf16_without_changing_paid_checkpoint_keys(monkeypatch, reuse):
    # Browser offsets count surrogate pairs as two code units. Python slicing
    # counts them as one character, including before a later subbatch boundary.
    text = ("来访者🌙走过庭院。𠮷看向窗边。\n" * 210) + "结尾🪴。"
    base = 12345
    units = lambda value: len(value.encode("utf-16-le")) // 2
    request = request_for(text=text, chapter={"chapter_id": "unicode-source",
        "title": "异体字与表情", "index": 1, "start_offset": base,
        "end_offset": base + units(text), "summary": "场景范围"})
    service = NovelImportService()
    controlled(service, monkeypatch)
    rows, result = finish(service.stream_ai_plan_chapter(request))
    partials = [p["payload"] for e, p in rows if e == "checkpoint" and p["stage"] == "scene_batch"]
    assert len(partials) > 1
    if reuse:
        request = request.model_copy(update={"partial_batches": partials})
        calls = controlled(service, monkeypatch)
        _, result = finish(service.stream_ai_plan_chapter(request))
        assert not calls, "The coordinate repair must not regenerate paid subbatches"
    cursor = base
    for scene in result.scenes:
        assert scene.start_offset == cursor
        cursor += units(scene.source_excerpt)
        assert scene.end_offset == cursor
        assert scene.source_span.start_offset == scene.start_offset
        assert scene.source_span.end_offset == scene.end_offset
        start, end = 2 * (scene.start_offset - base), 2 * (scene.end_offset - base)
        assert text.encode("utf-16-le")[start:end].decode("utf-16-le") == scene.source_excerpt
    assert cursor == request.chapter.end_offset
    assert "".join(scene.source_excerpt for scene in result.scenes) == text


@pytest.mark.parametrize("mode", ["tools", "json_object"])
@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("failure", ["length", "invalid", "transport", "unsupported"])
def test_actual_provider_never_retries_paid_novel_failure(monkeypatch, mode, streaming, failure):
    from types import SimpleNamespace
    from app.ai.provider import AIProvider
    from app.models.novel_import import NovelAiChapterSceneBatch
    from app.schemas.requests import ProviderSelectionRequest
    calls = []
    def create(**kwargs):
        calls.append(kwargs)
        if failure == "transport":
            raise ConnectionError("connection reset")
        if failure == "unsupported":
            raise RuntimeError("function calling is not supported")
        finish_reason = "length" if failure == "length" else "stop"
        if kwargs.get("stream"):
            return iter([SimpleNamespace(choices=[SimpleNamespace(
                delta=SimpleNamespace(content='{"scenes": []}'), finish_reason=finish_reason)])])
        tool = SimpleNamespace(id="one", function=SimpleNamespace(
            name="plan_novel_scene_batch", arguments='{"scenes": []}'))
        return SimpleNamespace(choices=[SimpleNamespace(finish_reason=finish_reason,
            message=SimpleNamespace(content='{"scenes": []}', tool_calls=[tool]))])
    monkeypatch.setattr("app.ai.provider.OpenAI", lambda **kwargs: SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    provider = AIProvider()
    selection = ProviderSelectionRequest.model_validate({
        **request_for().provider_selection.model_dump(),
        "parameters": {"structured_mode": mode}})
    with pytest.raises(AIProviderError):
        if streaming:
            list(provider.stream_with_tools(NovelAiChapterSceneBatch, "system", "user", selection=selection))
        else:
            provider.create_with_tools(NovelAiChapterSceneBatch, "system", "user", selection=selection)
    assert len(calls) == 1
