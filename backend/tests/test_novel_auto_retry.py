"""Controlled provider calls only. No network, credentials or paid generation."""
from contextvars import Context
from threading import Event
from types import SimpleNamespace

import pytest
from pydantic import BaseModel, ValidationError

from app.core.errors import AIProviderError
from app.models.novel_import import NovelAiChunkRequest
from app.models.scene import SceneBeat
from app.schemas.requests import ProviderSelectionRequest
from app.services.novel_import_service import NovelImportService
from app.services import novel_retry


class Result(BaseModel):
    ok: bool


@pytest.fixture(autouse=True)
def no_wait(monkeypatch):
    monkeypatch.setattr(novel_retry.time, "sleep", lambda _: None)


def run(service, limit):
    token = novel_retry.retry_budget.set(limit)
    try:
        stream = service._stream_structured_result(
            Result, "system", "source", temperature=.2, selection=None, phase="test")
        events = []
        while True:
            try:
                events.append(next(stream))
            except StopIteration as result:
                return events, result.value
    finally:
        novel_retry.retry_budget.reset(token)


@pytest.mark.parametrize("limit", [0, 1, 3, 5])
def test_retry_limit_exactly_initial_plus_retries(monkeypatch, limit):
    service = NovelImportService()
    calls = []
    def fail(*args, **kwargs):
        calls.append(1)
        raise AIProviderError("模型连接中断")
        yield
    monkeypatch.setattr(service.provider, "stream_with_tools", fail)
    with pytest.raises(AIProviderError, match=f"已自动重试 {limit}/{limit}"):
        run(service, limit)
    assert len(calls) == limit + 1


def test_success_after_two_failures(monkeypatch):
    service = NovelImportService()
    calls = []
    def stream(*args, **kwargs):
        calls.append(1)
        yield "delta", '{"ok":'
        if len(calls) <= 2:
            raise AIProviderError("模型连接中断")
        yield "final", Result(ok=True)
    monkeypatch.setattr(service.provider, "stream_with_tools", stream)
    events, result = run(service, 5)
    assert result.ok and len(calls) == 3
    assert len([p for e, p in events if e == "trace" and p.get("title") == "自动重试"]) == 2


@pytest.mark.parametrize("error", ["401 unauthorized", "invalid api key", "maximum context exceeded", "解析已取消"])
def test_permanent_error_does_not_spend_retry_budget(monkeypatch, error):
    service = NovelImportService()
    calls = []
    def stream(*args, **kwargs):
        calls.append(1)
        raise AIProviderError(error)
        yield
    monkeypatch.setattr(service.provider, "stream_with_tools", stream)
    with pytest.raises(AIProviderError):
        run(service, 5)
    assert len(calls) == 1


def test_cancel_during_backoff_prevents_another_request(monkeypatch):
    service = NovelImportService()
    cancelled, calls = Event(), []
    def stream(*args, **kwargs):
        calls.append(1)
        raise AIProviderError("connection reset")
        yield
    monkeypatch.setattr(service.provider, "stream_with_tools", stream)
    monkeypatch.setattr(novel_retry.time, "sleep", lambda _: cancelled.set())
    token = novel_retry.retry_cancelled.set(cancelled.is_set)
    try:
        with pytest.raises(AIProviderError, match="已取消"):
            run(service, 5)
    finally:
        novel_retry.retry_cancelled.reset(token)
    assert len(calls) == 1


def test_scope_survives_generator_context_switches_and_does_not_leak():
    class Fake:
        @novel_retry.retry_scope
        def stream(self, request):
            yield novel_retry.retry_budget.get()
            yield novel_retry.retry_budget.get()
    one = Fake().stream(type("R", (), {"max_retries": 1})())
    two = Fake().stream(type("R", (), {"max_retries": 3})())
    assert Context().run(next, one) == 1
    assert Context().run(next, two) == 3
    assert Context().run(next, one) == 1
    assert novel_retry.retry_budget.get() == 5
    one.close(); two.close()


def test_request_default_and_bounds():
    data = dict(document_id="d", chunk_id="c", index=0, text="原文", start_offset=0, end_offset=2)
    assert NovelAiChunkRequest(**data).max_retries == 5
    assert NovelAiChunkRequest(**data, max_retries=0).max_retries == 0
    for value in [-1, 11]:
        with pytest.raises(ValidationError):
            NovelAiChunkRequest(**data, max_retries=value)


def test_completed_scan_phase_is_not_repeated(monkeypatch):
    service = NovelImportService()
    calls = []
    def stream(model, *args, **kwargs):
        calls.append(model.__name__)
        if model.__name__ == "NovelAiChunkSummary":
            yield "final", model(chunk_id="c", index=0, summary="摘要", confidence=.8)
        elif model.__name__ == "NovelAiChunkEntityIndex":
            if calls.count(model.__name__) == 1:
                raise AIProviderError("模型连接中断")
            yield "final", model(characters=[], chapter_candidates=[], locations=[])
        else:
            yield "final", model(timeline=[], foreshadowing=[])
    monkeypatch.setattr(service.provider, "stream_with_tools", stream)
    request = NovelAiChunkRequest(document_id="d", chunk_id="c", index=0, text="原文", start_offset=0, end_offset=2)
    events = list(service.stream_ai_scan_chunk(request))
    assert calls.count("NovelAiChunkSummary") == 1
    assert calls.count("NovelAiChunkEntityIndex") == 2
    assert len([1 for e, _ in events if e == "checkpoint"]) == 3
    assert events[-1][0] == "final"


@pytest.mark.parametrize("mode", ["json_object", "tools"])
@pytest.mark.parametrize("limit", [0, 2])
def test_scene_beat_provider_requests_use_only_novel_budget(monkeypatch, mode, limit):
    """A shared SceneBeat type must not select non-novel transport recovery."""
    service = NovelImportService()
    calls, events = [], []
    selection = ProviderSelectionRequest(connection_id="local",
        base_url="http://127.0.0.1:1/v1", api_key="not-real", model_id="local",
        parameters={"structured_mode": mode})

    def create(**kwargs):
        calls.append(kwargs)
        raise TimeoutError("controlled scene transport timeout")

    monkeypatch.setattr("app.ai.provider.OpenAI", lambda **_: SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))))

    class Runner:
        @novel_retry.retry_scope
        def stream(self, request):
            yield from service._stream_structured_result(SceneBeat, "system", "source",
                temperature=.2, selection=selection, phase="scene_adaptation")

    stream = Runner().stream(SimpleNamespace(max_retries=limit))
    with pytest.raises(AIProviderError, match=f"已自动重试 {limit}/{limit}"):
        while True:
            events.append(Context().run(next, stream))
    assert len(calls) == 1 + limit
    assert all("response_format" in c if mode == "json_object" else "tools" in c for c in calls)
    assert all(c.get("stream") is True for c in calls) if mode == "json_object" else all("stream" not in c for c in calls)
    assert sum(e == "trace" and p.get("title") == "自动重试" for e, p in events) == limit
