"""No network: bounded outline work, durable checkpoints and safe resume."""
import json

import pytest

from app.core.errors import AIProviderError
from app.models.novel_import import (
    ChapterCandidate, NovelAiChunkAnalysis, NovelAiOutlineIndex,
    NovelAiOutlineMainline, NovelAiOutlineRequest, NovelAiOutlineStructure,
)
from app.schemas.requests import ProviderSelectionRequest
from app.services.novel_import_service import NovelImportService


def request(count=13, **overrides):
    values = dict(document_id="doc_recovery", title="长篇测试", total_chars=count * 100,
        analyses=[NovelAiChunkAnalysis(chunk_id=f"chunk_{i}", index=i, summary=f"第{i}段剧情。",
            chapter_candidates=[ChapterCandidate(chapter_id=f"ch_{i}", title=f"第{i}章",
                index=i, start_offset=i*100, end_offset=(i+1)*100, summary=f"剧情{i}")])
            for i in range(count)],
        provider_selection=ProviderSelectionRequest(connection_id="qa", model_id="deepseek-flash",
            api_key="synthetic-only", base_url="http://127.0.0.1:1/v1",
            parameters={"structured_mode": "json_object", "max_tokens": 3000,
                "context_budget_tokens": 24000}))
    values.update(overrides)
    return NovelAiOutlineRequest(**values)


def fake_model(calls, fail_at=None):
    def stream(model, system, user, **kwargs):
        data = json.loads(user.split("分块分析数据:\n", 1)[1].strip())
        rows = data["analyses"]
        calls.append((model.__name__, [r["chunk_id"] for r in rows]))
        if fail_at and len(calls) == fail_at:
            yield "delta", '{"chapters":['
            raise AIProviderError("finish_reason=length, output length limit reached")
        if model is NovelAiOutlineMainline:
            result = model(document_id=data["document_id"], title=data["title"],
                summary="起承转合。", main_plot="剧情完整推进。", coverage_confidence=1)
        elif model is NovelAiOutlineStructure:
            result = model(chapters=[ChapterCandidate(**c) for r in rows for c in r["chapter_candidates"]])
        elif model is NovelAiOutlineIndex:
            result = model()
        else:
            raise AssertionError(model)
        yield "final", result
    return stream


def test_long_outline_bounds_every_call_and_keeps_all_chapters(monkeypatch):
    service, calls = NovelImportService(), []
    monkeypatch.setattr(service.provider, "stream_with_tools", fake_model(calls))
    events = list(service.stream_ai_build_outline(request(85)))
    assert max(len(ids) for _, ids in calls) <= 4
    final = next(value for event, value in events if event == "final")
    assert len(final.chapters) == 85
    assert [c.chapter_id for c in final.chapters] == [f"ch_{i}" for i in range(85)]
    assert [(c.start_offset, c.end_offset) for c in final.chapters] == [(i*100, (i+1)*100) for i in range(85)]


def test_failed_batch_resume_reuses_successful_calls(monkeypatch):
    service, calls, saved = NovelImportService(), [], []
    monkeypatch.setattr(service.provider, "stream_with_tools", fake_model(calls, fail_at=4))
    with pytest.raises(AIProviderError, match="length"):
        for event, value in service.stream_ai_build_outline(request()):
            if event == "checkpoint" and value["stage"] == "batch":
                saved.append(value["payload"])
    assert len(saved) == 3
    finished_calls = calls[:-1]
    resumed = []
    monkeypatch.setattr(service.provider, "stream_with_tools", fake_model(resumed))
    events = list(service.stream_ai_build_outline(request(partial_batches=saved)))
    assert not any(call in resumed for call in finished_calls)
    assert len(next(v for e, v in events if e == "final").chapters) == 13


def test_changed_input_does_not_reuse_wrong_batch(monkeypatch):
    service, calls = NovelImportService(), []
    monkeypatch.setattr(service.provider, "stream_with_tools", fake_model(calls))
    original = request()
    events = list(service.stream_ai_build_outline(original))
    saved = [v["payload"] for e, v in events if e == "checkpoint" and v["stage"] == "batch"]
    original.analyses[0].summary = "作者更正了第一段。"
    changed_calls = []
    monkeypatch.setattr(service.provider, "stream_with_tools", fake_model(changed_calls))
    list(service.stream_ai_build_outline(NovelAiOutlineRequest.model_validate(
        {**original.model_dump(), "partial_batches": saved})))
    assert any("chunk_0" in ids for _, ids in changed_calls)
    assert len(changed_calls) < len(calls)


def test_input_over_budget_stops_before_model_call(monkeypatch):
    service, calls = NovelImportService(), []
    monkeypatch.setattr(service.provider, "stream_with_tools", fake_model(calls))
    payload = request(1)
    payload.analyses[0].summary = "长" * 25000
    with pytest.raises(AIProviderError, match="预算|budget"):
        list(service.stream_ai_build_outline(payload))
    assert calls == []


def test_uncovered_or_out_of_batch_chapters_are_not_silently_repaired(monkeypatch):
    service = NovelImportService()
    normal = fake_model([])
    def missing(model, system, user, **kwargs):
        if model is NovelAiOutlineStructure:
            yield "final", model(chapters=[])
        else:
            yield from normal(model, system, user, **kwargs)
    monkeypatch.setattr(service.provider, "stream_with_tools", missing)
    with pytest.raises(AIProviderError, match="覆盖|coverage|章节"):
        list(service.stream_ai_build_outline(request(9)))


def test_complete_checkpoints_skip_all_model_calls_in_both_entries(monkeypatch):
    service, calls = NovelImportService(), []
    monkeypatch.setattr(service.provider, "stream_with_tools", fake_model(calls))
    events = list(service.stream_ai_build_outline(request()))
    complete = {v["stage"]: v["payload"] for e, v in events
                if e == "checkpoint" and v["stage"] != "batch"}
    payload = request(partial_mainline=complete["mainline"], partial_structure=complete["structure"],
        partial_index=complete["index"], partial_source_hash=complete["source"])
    def forbidden(*args, **kwargs):
        raise AssertionError("Completed work must not be billed again")
    monkeypatch.setattr(service.provider, "stream_with_tools", forbidden)
    monkeypatch.setattr(service.provider, "create_with_tools", forbidden)
    assert len(list(service.stream_ai_build_outline(payload))[-1][1].chapters) == 13
    assert len(service.ai_build_outline(payload).chapters) == 13


def test_one_scan_with_many_chapters_is_partitioned(monkeypatch):
    service, calls = NovelImportService(), []
    payload = request(1, total_chars=1300)
    payload.analyses[0].chapter_candidates = [request(13).analyses[i].chapter_candidates[0] for i in range(13)]
    counts = []
    normal = fake_model(calls)
    def bounded(model, system, user, **kwargs):
        data = json.loads(user.split("分块分析数据:\n", 1)[1].strip())
        if model is NovelAiOutlineStructure:
            counts.append(sum(len(r["chapter_candidates"]) for r in data["analyses"]))
        yield from normal(model, system, user, **kwargs)
    monkeypatch.setattr(service.provider, "stream_with_tools", bounded)
    final = list(service.stream_ai_build_outline(payload))[-1][1]
    assert len(final.chapters) == 13
    assert len(counts) > 1 and max(counts) <= 8


def test_overlap_scans_compose_without_repeated_source_text(monkeypatch):
    service = NovelImportService()
    payload = request(13)
    for i, analysis in enumerate(payload.analyses):
        analysis.chapter_candidates[0].start_offset = max(0, i * 100 - 20)
    monkeypatch.setattr(service.provider, "stream_with_tools", fake_model([]))
    chapters = list(service.stream_ai_build_outline(payload))[-1][1].chapters
    assert chapters[0].start_offset == 0 and chapters[-1].end_offset == 1300
    assert all(a.end_offset == b.start_offset for a, b in zip(chapters, chapters[1:]))
    assert sum(c.end_offset - c.start_offset for c in chapters) == 1300
    assert len({c.chapter_id for c in chapters}) == len(chapters)


def test_corrupt_checkpoint_is_not_reused_and_secrets_stay_out_of_prompts(monkeypatch):
    service, calls = NovelImportService(), []
    original = fake_model(calls)
    def check(model, system, user, **kwargs):
        assert "synthetic-only" not in system + user
        assert "partial_batches" not in user
        yield from original(model, system, user, **kwargs)
    monkeypatch.setattr(service.provider, "stream_with_tools", check)
    events = list(service.stream_ai_build_outline(request()))
    batches = [v["payload"] for e, v in events if e == "checkpoint" and v["stage"] == "batch"]
    batches[0]["payload"] = {"invalid": True}
    calls.clear()
    list(service.stream_ai_build_outline(request(partial_batches=batches)))
    assert len(calls) == 1


def test_index_batch_bounds_character_output(monkeypatch):
    from app.models.novel_import import CharacterCandidate
    service = NovelImportService()
    payload = request(9)
    for i, analysis in enumerate(payload.analyses):
        analysis.characters = [CharacterCandidate(character_id=f"person_{i}_{j}", name=f"人物{i}-{j}")
                               for j in range(25)]
    counts = []
    normal = fake_model([])
    def bounded(model, system, user, **kwargs):
        if model is NovelAiOutlineIndex:
            data = json.loads(user.split("分块分析数据:\n", 1)[1].strip())
            counts.append(sum(len(r["characters"]) for r in data["analyses"]))
        yield from normal(model, system, user, **kwargs)
    monkeypatch.setattr(service.provider, "stream_with_tools", bounded)
    list(service.stream_ai_build_outline(payload))
    assert sum(counts) == 225 and max(counts) <= 16
