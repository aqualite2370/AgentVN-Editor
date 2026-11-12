"""Source grounding and semantic retries share one bounded attempt budget."""
from threading import Event

import pytest

from app.core.errors import AIProviderError
from app.services import novel_retry
from app.services.novel_import_service import NovelImportService
from app.services.novel_scene_pipeline import ScenePlanningPipeline
from test_novel_scene_budget import compact_result, finish, iter_with_result, request_for


@pytest.fixture(autouse=True)
def no_wait(monkeypatch):
    monkeypatch.setattr(novel_retry.time, "sleep", lambda _: None)


def payload(pipeline, text, scenes):
    return pipeline.model.model_validate({"scenes": [
        {"title": "边界测试", "summary": "角色交谈。", "start_offset": start + 20000,
         "end_offset": end + 20000, "start_quote": first, "end_quote": last}
        for start, end, first, last in scenes], "warnings": [], "needs_review": False})


@pytest.mark.parametrize("gap", ["”\n", "。\n", "？！\n", "\n", "」\n"])
def test_unique_quotes_retain_boundary_punctuation_and_whitespace(gap):
    text = gap + "甲走向门外。乙留在窗前。"
    pipeline = ScenePlanningPipeline(NovelImportService(), request_for(
        size=len(text), text=text, min_scene_count=1, suggested_scene_count=1))
    value = payload(pipeline, text, [(2, 8, "甲走向", "窗前。")])
    scenes, warnings = pipeline.restore((0, len(text), 1), value, "key")
    assert "".join(s.source_excerpt for s in scenes) == text
    assert scenes[0].start_offset == 20000
    assert warnings


@pytest.mark.parametrize("gap", ["未规划的情节", "1", "ABC", "🙂", "，" * 33])
def test_real_missing_prose_and_unbounded_punctuation_still_rejected(gap):
    text = "甲离开。" + gap + "乙留下。"
    pipeline = ScenePlanningPipeline(NovelImportService(), request_for(
        size=len(text), text=text, min_scene_count=2, suggested_scene_count=2))
    split = len("甲离开。")
    value = payload(pipeline, text, [
        (0, split, "甲离", "离开。"),
        (split + len(gap), len(text), "乙留", "留下。")])
    with pytest.raises(ValueError, match="覆盖"):
        pipeline.restore((0, len(text), 2), value, "key")


def test_punctuation_at_tail_is_preserved_but_not_missing_prose():
    text = "甲说完了。”\n"
    pipeline = ScenePlanningPipeline(NovelImportService(), request_for(
        size=len(text), text=text, min_scene_count=1, suggested_scene_count=1))
    scenes, warnings = pipeline.restore((0, len(text), 1),
        payload(pipeline, text, [(0, 5, "甲说", "完了。")]), "key")
    assert scenes[0].source_excerpt == text and warnings
    pipeline.request.text = text + "漏掉的事情"
    with pytest.raises(ValueError, match="末尾"):
        pipeline.restore((0, len(pipeline.request.text), 1),
            payload(pipeline, text, [(0, 5, "甲说", "完了。")]), "key")


@pytest.mark.parametrize("heading", ["第37章：新的来访", "第 三十七 章 新的来访", "Chapter 37: A new visitor"])
def test_trailing_standalone_chapter_heading_kept_as_source_with_review(heading):
    text = "他结束了一天的旅程。\n\n" + heading + "\n\n"
    pipeline = ScenePlanningPipeline(NovelImportService(), request_for(
        size=len(text), text=text, min_scene_count=1, suggested_scene_count=1))
    scenes, warnings = pipeline.restore((0, len(text), 1),
        payload(pipeline, text, [(0, len(text), "他结束", "旅程。")]), "key")
    assert scenes[0].source_excerpt == text
    assert any("章标题" in warning for warning in warnings)


@pytest.mark.parametrize("tail", ["\n第37章：来访\n真正的后续正文", "第37章：来访",
                                  "\n只是普通的一句旁白", "\n第37章：" + "长" * 70])
def test_header_rule_does_not_swallow_prose_or_nonisolated_heading(tail):
    text = "他结束了一天的旅程。" + tail
    pipeline = ScenePlanningPipeline(NovelImportService(), request_for(
        size=len(text), text=text, min_scene_count=1, suggested_scene_count=1))
    with pytest.raises(ValueError, match="末尾"):
        pipeline.restore((0, len(text), 1),
            payload(pipeline, text, [(0, len(text), "他结束", "旅程。")]), "key")


def test_ambiguous_anchors_and_overlap_remain_rejected():
    text = "甲留下。甲留下。"
    pipeline = ScenePlanningPipeline(NovelImportService(), request_for(
        size=len(text), text=text, min_scene_count=1, suggested_scene_count=1))
    with pytest.raises(ValueError, match="唯一"):
        pipeline.restore((0, len(text), 1),
            payload(pipeline, text, [(1, 4, "甲", "下。")]), "key")
    value = payload(pipeline, text, [(0, 4, "甲", "下。"), (0, 4, "甲", "下。")])
    with pytest.raises(ValueError, match="覆盖"):
        pipeline.restore((0, len(text), 2), value, "key")


@pytest.mark.parametrize("streaming", [True, False])
@pytest.mark.parametrize("limit", [0, 2, 5])
def test_semantic_failure_uses_same_retry_budget(monkeypatch, streaming, limit):
    service, request = NovelImportService(), request_for(size=300, max_retries=limit)
    calls, events = [], []
    def result(model, system, prompt, **kwargs):
        calls.append(prompt)
        value = compact_result(model, prompt.split("\n\n上次结果校验未通过", 1)[0]).model_dump()
        value["scenes"][0]["start_quote"] = "根本不存在的引文"
        return model.model_validate(value)
    def stream(*args, **kwargs):
        yield "delta", "{}"
        yield "final", result(*args, **kwargs)
    monkeypatch.setattr(service.provider, "stream_with_tools", stream)
    monkeypatch.setattr(service.provider, "create_with_tools", result)
    with pytest.raises(AIProviderError, match=f"已自动重试 {limit}/{limit}"):
        if streaming:
            for row in service.stream_ai_plan_chapter(request):
                events.append(row)
        else:
            service.ai_plan_chapter(request)
    assert len(calls) == limit + 1
    assert not [p for e, p in events if e == "checkpoint"]
    if limit:
        assert "校验" in calls[1], "Retry feedback must explain the actual validation failure"


def test_transport_then_semantic_failure_then_success_share_total_budget(monkeypatch):
    service, request = NovelImportService(), request_for(size=4000, max_retries=2)
    calls, batches = [], []
    def stream(model, system, prompt, **kwargs):
        data = compact_result(model, prompt.split("\n\n上次结果校验未通过", 1)[0])
        calls.append(prompt)
        if len(calls) == 2:
            raise AIProviderError("connection reset")
        if len(calls) == 3:
            value = data.model_dump()
            value["scenes"][0]["start_quote"] = "不存在的内容"
            data = model.model_validate(value)
        yield "delta", "{}"
        yield "final", data
    monkeypatch.setattr(service.provider, "stream_with_tools", stream)
    monkeypatch.setattr(service, "_stream_ai_chapter_conflict_points", lambda *args: iter_with_result([]))
    monkeypatch.setattr(service, "_stream_ai_chapter_branch_suggestions", lambda *args: iter_with_result([]))
    rows, result = finish(service.stream_ai_plan_chapter(request))
    batches = [p for e, p in rows if e == "checkpoint" and p["stage"] == "scene_batch"]
    assert len(calls) == len(batches) + 2
    assert len({p["payload"]["key"] for p in batches}) == len(batches)
    assert "".join(s.source_excerpt for s in result.scenes) == request.text
    retry = [p for e, p in rows if e == "trace" and p.get("title") == "自动重试"]
    assert [p["details"]["retry"] for p in retry] == [1, 2]
    attempts = [p for e, p in rows if e == "trace" and p.get("title") == "模型请求开始"]
    assert len(attempts) == len(calls)
    resume = request.model_copy(update={"partial_batches": [p["payload"] for p in batches]})
    before = len(calls)
    finish(service.stream_ai_plan_chapter(resume))
    assert len(calls) == before


def test_cancel_in_semantic_backoff_stops_before_next_paid_attempt(monkeypatch):
    service, request = NovelImportService(), request_for(size=300, max_retries=5)
    cancelled, calls = Event(), []
    def stream(model, system, prompt, **kwargs):
        calls.append(prompt)
        value = compact_result(model, prompt.split("\n\n上次结果校验未通过", 1)[0]).model_dump()
        value["scenes"][0]["end_quote"] = "不存在"
        yield "final", model.model_validate(value)
    monkeypatch.setattr(service.provider, "stream_with_tools", stream)
    monkeypatch.setattr(novel_retry.time, "sleep", lambda _: cancelled.set())
    token = novel_retry.retry_cancelled.set(cancelled.is_set)
    try:
        with pytest.raises(AIProviderError, match="已取消"):
            list(service.stream_ai_plan_chapter(request))
    finally:
        novel_retry.retry_cancelled.reset(token)
    assert len(calls) == 1


@pytest.mark.parametrize("streaming", [True, False])
def test_cross_heading_prose_requires_actual_tail_and_bounded_corrective_anchors(monkeypatch, streaming):
    text = "甲结束了旅程。\n\n第九章：重逢\n乙走进车站，发现列车已经"
    service = NovelImportService()
    request = request_for(size=len(text), text=text, min_scene_count=1,
                          suggested_scene_count=1, max_retries=2)
    calls = []
    def result(model, system, prompt, **kwargs):
        if model.__name__ == "NovelAiConflictAnalysisResponse":
            return model.model_validate({"conflict_points": [], "warnings": []})
        calls.append((system, prompt))
        assert "乙走进车站，发现列车已经" in system
        assert "跨章" in system and "半句" in system
        value = compact_result(model, prompt.split("\n\n上次结果校验未通过", 1)[0]).model_dump()
        if len(calls) == 1:
            value["scenes"][0]["start_quote"] = "甲结束了旅程。"
            value["scenes"][0]["end_quote"] = "甲结束了旅程。"
        else:
            feedback = prompt.split("\n\n上次结果校验未通过", 1)[1]
            assert "乙走进车站，发现列车已经" in feedback
            assert "末尾" in feedback
            from app.services.novel_outline_pipeline import tokens
            assert tokens(feedback) <= 512
        return model.model_validate(value)
    def stream(*args, **kwargs):
        yield "delta", "{}"
        yield "final", result(*args, **kwargs)
    monkeypatch.setattr(service.provider, "stream_with_tools", stream)
    monkeypatch.setattr(service.provider, "create_with_tools", result)
    monkeypatch.setattr(service, "_stream_ai_chapter_conflict_points", lambda *args: iter_with_result([]))
    monkeypatch.setattr(service, "_stream_ai_chapter_branch_suggestions", lambda *args: iter_with_result([]))
    if streaming:
        rows, plan = finish(service.stream_ai_plan_chapter(request))
    else:
        plan = service.ai_plan_chapter(request)
    assert len(calls) == 2
    assert "".join(scene.source_excerpt for scene in plan.scenes) == text
    pipeline = ScenePlanningPipeline(service, request)
    part = pipeline.parts()[0]
    # Boundary guidance strengthens the same source contract, not cache identity.
    from app.services.novel_outline_pipeline import digest, tokens
    from app.services.novel_scene_pipeline import SYSTEM
    assert pipeline.key(part) == digest({"source": pipeline.source_key, "prompt": pipeline.prompt(part),
        "system": SYSTEM, "schema": pipeline.schema, "extra": pipeline.extra_system})
    assert tokens(calls[-1][0] + calls[-1][1] + pipeline.schema + pipeline.extra_system) <= pipeline.input_budget


def test_provider_failure_trace_leaves_retry_decision_to_outer_budget(monkeypatch):
    service = NovelImportService()
    def stream(*args, **kwargs):
        yield "trace", {"phase": "validation", "level": "error", "title": "结构化生成失败",
            "message": "小说模型连接中断；成功断点已保留，未自动重试。"}
        raise AIProviderError("connection reset")
    monkeypatch.setattr(service.provider, "stream_with_tools", stream)
    rows = []
    with pytest.raises(AIProviderError):
        for row in service._stream_structured_result(
                object, "system", "user", temperature=.2, selection=None, phase="test"):
            rows.append(row)
    errors = [p for e, p in rows if e == "trace" and p.get("level") == "error"]
    assert errors and all("未自动重试" not in p["message"] for p in errors)
