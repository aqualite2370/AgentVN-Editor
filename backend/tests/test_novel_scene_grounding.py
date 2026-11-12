from copy import deepcopy
import json
from types import SimpleNamespace
from contextvars import copy_context
from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError

from app.ai.provider import AIProvider
from app.models.novel_import import ChapterCandidate, NovelAiChapterScenePlan, NovelAiPlanChapterRequest
from app.services.novel_scene_grounding import chapter_scene_source, stream_chapter_source
from app.core.errors import AIProviderError
from app.schemas.requests import ProviderSelectionParameters, ProviderSelectionRequest


def request_for(text="甲在窗前。\n\n乙走进房间。"):
    return NovelAiPlanChapterRequest(
        document_id="test", chapter=ChapterCandidate(
            chapter_id="chapter", title="当前章", index=0, start_offset=100,
            end_offset=100 + len(text), summary="测试"),
        text=text, outline_summary="测试", min_scene_count=1)


def plan(excerpt="乙走进房间。", start=23200, end=22800):
    return {"chapter_id": "chapter", "scenes": [{
        "scene_candidate_id": "scene", "chapter_id": "chapter", "title": "窗前",
        "index": 0, "start_offset": start, "end_offset": end,
        "source_span": {"start_offset": start, "end_offset": end},
        "source_excerpt": excerpt, "summary": "片段", "commands": [],
    }]}


def test_invalid_model_offsets_reanchor_only_to_unique_authoritative_excerpt():
    request = request_for()
    payload = plan()
    original = deepcopy(payload)
    with chapter_scene_source(request):
        result = AIProvider()._validate_structured_content(NovelAiChapterScenePlan, json.dumps(payload))
    start = 100 + request.text.index("乙")
    assert result.scenes[0].start_offset == start
    assert result.scenes[0].end_offset == start + len("乙走进房间。")
    assert result.scenes[0].source_span.start_offset == start
    assert result.needs_review and result.warnings
    assert payload == original
    with pytest.raises(ValidationError):
        NovelAiChapterScenePlan.model_validate(payload)


def test_whitespace_normalization_retains_actual_source_coordinates_and_text():
    request = request_for()
    with chapter_scene_source(request):
        result = NovelAiChapterScenePlan.model_validate(plan("甲在窗前。乙走进房间。"))
    assert result.scenes[0].source_excerpt == request.text
    assert result.scenes[0].source_span.end_offset == 100 + len(request.text)


@pytest.mark.parametrize("text,excerpt", [
    ("甲。乙。", "不存在。"), ("甲。甲。", "甲。"), ("甲。", ""),
])
def test_invalid_ranges_without_unambiguous_source_match_remain_rejected(text, excerpt):
    with chapter_scene_source(request_for(text)), pytest.raises(ValidationError):
        NovelAiChapterScenePlan.model_validate(plan(excerpt))


def test_existing_valid_range_is_unchanged_and_strict_global_contract_is_retained():
    payload = plan("甲在窗前。", 100, 105)
    with chapter_scene_source(request_for()):
        result = NovelAiChapterScenePlan.model_validate(payload)
    assert result.scenes[0].start_offset == 100
    assert not result.needs_review and not result.warnings
    with pytest.raises(ValidationError):
        NovelAiChapterScenePlan.model_validate(plan())


def test_unknown_ranges_still_report_one_based_scene_location_without_source_text():
    with chapter_scene_source(request_for()), pytest.raises(ValidationError) as exc:
        NovelAiChapterScenePlan.model_validate(plan("不存在。"))
    assert "场景 1" in str(exc.value)
    assert "未自动重试" in str(exc.value)


def test_stream_error_shows_safe_field_reason_and_does_not_retry(monkeypatch):
    calls = []
    payload = plan("private-source-sentinel")
    def create(**kwargs):
        calls.append(kwargs)
        return iter([SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content=json.dumps(payload)), finish_reason="stop")])])
    monkeypatch.setattr("app.ai.provider.OpenAI", lambda **kwargs: SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    selection = ProviderSelectionRequest(
        connection_id="fixture", model_id="fake", base_url="http://127.0.0.1:9",
        api_key="test-key", parameters=ProviderSelectionParameters(structured_mode="json_object"))
    with chapter_scene_source(request_for()), pytest.raises(AIProviderError) as error:
        list(AIProvider().stream_structured_json(
            NovelAiChapterScenePlan, "system", "user", selection=selection))
    assert len(calls) == 1
    message = str(error.value)
    assert "场景 1" in message and "校验明细" in message
    assert "private-source-sentinel" not in message
    assert "请检查 Base URL" not in message
    assert "未自动重试" in message


def test_stream_steps_can_resume_across_asgi_contexts_without_leaking_source():
    request = request_for()
    def events():
        yield "status", "ready"
        result = NovelAiChapterScenePlan.model_validate(plan())
        return result
    iterator = stream_chapter_source(request, events())
    assert copy_context().run(next, iterator) == ("status", "ready")
    with pytest.raises(StopIteration) as finished:
        copy_context().run(next, iterator)
    assert finished.value.value.scenes[0].start_offset == 100 + request.text.index("乙")
    with pytest.raises(ValidationError):
        NovelAiChapterScenePlan.model_validate(plan())


def test_parallel_chapter_requests_never_share_grounding_source():
    def call(text):
        request = request_for(text)
        with chapter_scene_source(request):
            return NovelAiChapterScenePlan.model_validate(plan("乙。")).scenes[0].start_offset
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(call, ["甲。乙。", "甲甲甲。乙。"])) == [102, 104]


def test_real_sse_route_grounds_model_json_before_emitting_checkpoint_and_final(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.api import routes_novel_import
    from app.models.novel_import import NovelAiConflictAnalysisResponse
    from app.services.novel_import_service import NovelImportService
    calls = []
    source = request_for().text
    payload = {"scenes": [{"title": "窗前", "summary": "两人见面",
        "start_offset": 23200, "end_offset": 22800,
        "start_quote": source[:5], "end_quote": source[-6:]}]}
    def create(**kwargs):
        calls.append(kwargs)
        return iter([SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content=json.dumps(payload)), finish_reason="stop")])])
    monkeypatch.setattr("app.ai.provider.OpenAI", lambda **kwargs: SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    service = NovelImportService()
    stream = service.provider.stream_with_tools
    def controlled(model, *args, **kwargs):
        if model is NovelAiConflictAnalysisResponse:
            yield "final", NovelAiConflictAnalysisResponse(conflict_points=[], warnings=[])
        else:
            yield from stream(model, *args, **kwargs)
    monkeypatch.setattr(service.provider, "stream_with_tools", controlled)
    monkeypatch.setattr(routes_novel_import, "service", service)
    request = request_for()
    body = request.model_dump(mode="json")
    body["provider_selection"] = {
        "connection_id": "fixture", "model_id": "fake", "base_url": "http://127.0.0.1:9",
        "api_key": "test-key", "parameters": {"structured_mode": "json_object"}}
    response = TestClient(create_app()).post("/api/novel/import/ai_plan_chapter_stream", json=body)
    assert response.status_code == 200
    assert "event: error" not in response.text
    assert response.text.index("event: checkpoint") < response.text.index("event: final")
    assert len(calls) == 1
    assert "23200" not in response.text.split("event: final")[-1]
    assert "原文坐标" in response.text
