import json
import re
import threading
import time

from fastapi.testclient import TestClient

from app.api import routes_novel_process, routes_novel_processing
from app.main import create_app
from app.models.commands import ChoiceCommand, DialogCommand, NarrationCommand
from app.models.novel_process import AgentTask, ChunkRecord, NovelProcessJob, NovelProcessJobCreateRequest, SceneFragment, SceneLinkPolishRequest, SceneLinkPolishResponse, SceneLinkPolishPatch, SubagentModelOutput
from app.models.scene import SceneBeat
from app.services.novel_process_service import NovelProcessJobRepository, NovelProcessService, utc_now, wait_for_job


def _request(chunk_count: int = 3, *, max_concurrency: int = 3, max_retries: int = 2) -> NovelProcessJobCreateRequest:
    return NovelProcessJobCreateRequest(
        bookId="book_test",
        title="Test Novel",
        chunks=[
            {
                "chunkId": f"chunk_{index}",
                "chapterTitle": "Chapter One",
                "chapterIndex": 0,
                "chunkIndex": index,
                "chunkText": f"chunk-{index}-text-" + ("x" * 900),
                "startOffset": index * 1000,
                "endOffset": index * 1000 + 912,
            }
            for index in range(chunk_count)
        ],
        userInstruction="Rewrite as concise VN prose.",
        outputFormat="markdown",
        promptVersion="test-v1",
        maxConcurrency=max_concurrency,
        maxRetries=max_retries,
    )


def _input_from_prompt(prompt: str) -> dict[str, object]:
    match = re.search(r"Subagent input JSON follows\..*?\n(\{.*\})\n\nReturn", prompt, re.S)
    assert match, prompt
    return json.loads(match.group(1))


class CapturingProvider:
    def __init__(self, delay: float = 0.0) -> None:
        self.delay = delay
        self.inputs: list[dict[str, object]] = []
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
        payload = _input_from_prompt(user_prompt)
        with self.lock:
            self.inputs.append(payload)
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            yield ("delta", f"partial-{payload['chunkIndex']}")
            if self.delay:
                time.sleep(self.delay)
            yield (
                "final",
                SubagentModelOutput(
                    status="completed",
                    resultText=f"result for {payload['chunkIndex']}",
                    summary=f"summary for {payload['chunkIndex']}",
                    continuityNotes=["character: Alice"],
                    warnings=[],
                ),
            )
        finally:
            with self.lock:
                self.active -= 1


def test_subagent_input_contains_only_one_chunk_and_required_fields(tmp_path) -> None:
    provider = CapturingProvider()
    service = NovelProcessService(provider=provider, storage_dir=tmp_path)

    job = service.create_job(_request(2, max_concurrency=2))
    completed = wait_for_job(service, job.jobId)

    assert completed.status == "completed"
    assert len(provider.inputs) == 2
    required_keys = {
        "bookId",
        "chapterTitle",
        "chapterIndex",
        "chunkIndex",
        "chunkText",
        "previousContextSummary",
        "nextContextHint",
        "userInstruction",
        "outputFormat",
        "promptVersion",
    }
    for payload in provider.inputs:
        assert set(payload) == required_keys
        own_index = payload["chunkIndex"]
        assert payload["chunkText"] == f"chunk-{own_index}-text-" + ("x" * 900)
        assert "上文重叠" not in str(payload["chunkText"])
        assert "下文提示" not in str(payload["chunkText"])
        other_index = 1 - int(own_index)
        assert payload["chunkText"] != f"chunk-{other_index}-text-" + ("x" * 900)
        assert len(str(payload["previousContextSummary"])) <= 800
        assert len(str(payload["nextContextHint"])) <= 800


def test_context_fields_are_not_folded_into_chunk_text(tmp_path) -> None:
    provider = CapturingProvider()
    request = _request(1, max_concurrency=1)
    request.chunks[0].chunkText = "ONLY_PRIMARY_CHUNK_BODY"
    request.chunks[0].startOffset = 100
    request.chunks[0].endOffset = 123
    request.chunks[0].previousContextSummary = "PREVIOUS_CONTEXT_MARKER_SHOULD_NOT_BE_REWRITTEN"
    request.chunks[0].nextContextHint = "NEXT_CONTEXT_MARKER_SHOULD_NOT_BE_REWRITTEN"
    service = NovelProcessService(provider=provider, storage_dir=tmp_path)

    job = service.create_job(request)
    completed = wait_for_job(service, job.jobId)

    assert completed.status == "completed"
    assert len(provider.inputs) == 1
    payload = provider.inputs[0]
    assert payload["chunkText"] == "ONLY_PRIMARY_CHUNK_BODY"
    assert "PREVIOUS_CONTEXT_MARKER" not in str(payload["chunkText"])
    assert "NEXT_CONTEXT_MARKER" not in str(payload["chunkText"])
    assert payload["previousContextSummary"] == "PREVIOUS_CONTEXT_MARKER_SHOULD_NOT_BE_REWRITTEN"
    assert payload["nextContextHint"] == "NEXT_CONTEXT_MARKER_SHOULD_NOT_BE_REWRITTEN"
    assert completed.chunks[0].chunkText == "ONLY_PRIMARY_CHUNK_BODY"
    assert completed.chunks[0].previousContextSummary == "PREVIOUS_CONTEXT_MARKER_SHOULD_NOT_BE_REWRITTEN"
    assert completed.chunks[0].nextContextHint == "NEXT_CONTEXT_MARKER_SHOULD_NOT_BE_REWRITTEN"
    assert completed.chunks[0].contextChars == len("PREVIOUS_CONTEXT_MARKER_SHOULD_NOT_BE_REWRITTEN") + len("NEXT_CONTEXT_MARKER_SHOULD_NOT_BE_REWRITTEN")
    assert completed.agentTasks[0].inputKeys == [
        "bookId",
        "chapterTitle",
        "chapterIndex",
        "chunkIndex",
        "chunkText",
        "previousContextSummary",
        "nextContextHint",
        "userInstruction",
        "outputFormat",
        "promptVersion",
    ]
    assert completed.agentTasks[0].inputChunkChars == len("ONLY_PRIMARY_CHUNK_BODY")
    assert completed.agentTasks[0].contextChars == completed.chunks[0].contextChars


def test_v2_prompt_detects_chat_speakers_and_requires_individual_dialog_commands(tmp_path) -> None:
    provider = CapturingProvider()
    request = _request(1, max_concurrency=1)
    request.promptVersion = "novel-process-v2"
    request.chunks[0].chunkText = (
        "战斗暴龙兽：额。\n"
        "战斗暴龙兽：感觉没什么好聊的。\n"
        "牙猎犬：……好直接汪。\n"
        "牙猎犬：[小猪爱心.jpg]"
    )
    service = NovelProcessService(provider=provider, storage_dir=tmp_path)

    job = service.create_job(request)
    completed = wait_for_job(service, job.jobId)

    assert completed.status == "completed"
    assert provider.inputs[0]["speakerCandidates"] == ["战斗暴龙兽", "牙猎犬"]


def test_v2_semantic_retry_accepts_corrected_dialog_commands(tmp_path) -> None:
    calls = 0

    class SemanticRetryProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            nonlocal calls
            calls += 1
            if calls == 1:
                yield (
                    "final",
                    SubagentModelOutput(
                        summary="聊天",
                        scenes=[
                            SceneBeat(
                                scene_id="chat",
                                title="聊天",
                                summary="聊天",
                                chapter=0,
                                commands=[
                                    {
                                        "type": "narration",
                                        "text": "战斗暴龙兽：额。牙猎犬：……好直接汪。",
                                    }
                                ],
                            )
                        ],
                    ),
                )
                return
            assert "speaker_prefixed_narration" in user_prompt
            yield (
                "final",
                SubagentModelOutput(
                    summary="聊天",
                    scenes=[
                        SceneBeat(
                            scene_id="chat",
                            title="聊天",
                            summary="聊天",
                            chapter=0,
                            commands=[
                                {"type": "dialog", "character_id": "战斗暴龙兽", "text": "额。"},
                                {"type": "dialog", "character_id": "牙猎犬", "text": "……好直接汪。"},
                            ],
                        )
                    ],
                ),
            )

    request = _request(1, max_concurrency=1)
    request.promptVersion = "novel-process-v2"
    request.chunks[0].chunkText = "战斗暴龙兽：额。\n牙猎犬：……好直接汪。"
    service = NovelProcessService(provider=SemanticRetryProvider(), storage_dir=tmp_path)

    completed = wait_for_job(service, service.create_job(request).jobId)
    result = completed.chunkResults[0]

    assert calls == 2
    assert result.semanticValidationStatus == "passed"
    assert result.semanticRepairCount == 0
    assert [command.type for command in result.scenes[0].commands] == ["dialog", "dialog"]


def test_v3_prose_semantic_retry_rejects_attribution_phrase_and_accepts_model_regeneration(tmp_path) -> None:
    calls = 0

    class ProseSemanticRetryProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            nonlocal calls
            calls += 1
            if calls == 1:
                yield (
                    "final",
                    SubagentModelOutput(
                        summary="作战会议",
                        fragment=SceneFragment(
                            summary="作战会议",
                            commands=[
                                {
                                    "type": "dialog",
                                    "character_id": "常将军讲道",
                                    "text": "同志们，会议开始。",
                                }
                            ],
                        ),
                    ),
                )
                return
            assert "untrusted_dialogue_speaker" in user_prompt
            assert "Infer prose speakers from quotation attribution" in user_prompt
            yield (
                "final",
                SubagentModelOutput(
                    summary="作战会议",
                    fragment=SceneFragment(
                        summary="作战会议",
                        commands=[
                            {
                                "type": "dialog",
                                "character_id": "常将军",
                                "text": "同志们，会议开始。",
                            }
                        ],
                    ),
                ),
            )

    request = _request(1, max_concurrency=1)
    request.promptVersion = "novel-process-v3"
    request.chunks[0].chunkText = "“同志们，会议开始。”常将军讲道。"
    service = NovelProcessService(provider=ProseSemanticRetryProvider(), storage_dir=tmp_path)

    completed = wait_for_job(service, service.create_job(request).jobId)
    result = completed.chunkResults[0]

    assert calls == 2
    assert completed.status == "completed"
    assert result.semanticValidationStatus == "passed"
    assert result.fragment is not None
    assert isinstance(result.fragment.commands[0], DialogCommand)
    assert result.fragment.commands[0].character_id == "常将军"


def test_v3_prose_semantic_retry_requires_narration_for_unquoted_prose(tmp_path) -> None:
    calls = 0
    prose = (
        "杨冬和总工程师走过来，在经过时她对他们微笑着点点头，没说一句话，"
        "但汪淼记住了她那清澈的眼睛。当天晚上汪淼坐在书房里，"
        "欣赏着挂在墙上的自己最得意的几幅风景摄影作品。"
    )

    class NarrationRetryProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            nonlocal calls
            calls += 1
            if calls == 1:
                yield (
                    "final",
                    SubagentModelOutput(
                        summary="汪淼回忆杨冬",
                        fragment=SceneFragment(
                            summary="汪淼回忆杨冬",
                            commands=[
                                {
                                    "type": "dialog",
                                    "character_id": "汪淼",
                                    "text": f"（内心独白）{prose}",
                                }
                            ],
                        ),
                    ),
                )
                return
            assert "narration_disguised_as_dialogue" in user_prompt
            assert "missing_narration_commands" in user_prompt
            yield (
                "final",
                SubagentModelOutput(
                    summary="汪淼回忆杨冬",
                    fragment=SceneFragment(
                        summary="汪淼回忆杨冬",
                        commands=[{"type": "narration", "text": prose}],
                    ),
                ),
            )

    request = _request(1, max_concurrency=1)
    request.promptVersion = "novel-process-v3"
    request.chunks[0].chunkText = prose
    service = NovelProcessService(provider=NarrationRetryProvider(), storage_dir=tmp_path)

    completed = wait_for_job(service, service.create_job(request).jobId)
    result = completed.chunkResults[0]

    assert calls == 2
    assert completed.status == "completed"
    assert result.fragment is not None
    assert [command.type for command in result.fragment.commands] == ["narration"]


def test_v2_does_not_locally_repair_invalid_model_dialogue_output(tmp_path) -> None:
    calls = 0

    class AlwaysMergedProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            nonlocal calls
            calls += 1
            yield (
                "final",
                SubagentModelOutput(
                    summary="网友聊天",
                    scenes=[
                        SceneBeat(
                            scene_id="chat",
                            title="网友聊天",
                            summary="网友聊天",
                            chapter=0,
                            commands=[
                                {
                                    "type": "narration",
                                    "text": (
                                        "战斗暴龙兽：额。"
                                        "战斗暴龙兽：感觉没什么好聊的。"
                                        "牙猎犬：……好直接汪。"
                                        "牙猎犬：如果尊不好意思的话也可以留下号码让我加！"
                                        "牙猎犬：[小猪爱心.jpg]"
                                    ),
                                    "font_asset_id": "font_chat",
                                }
                            ],
                        )
                    ],
                ),
            )

    request = _request(1, max_concurrency=1)
    request.promptVersion = "novel-process-v2"
    request.chunks[0].chunkText = (
        "战斗暴龙兽：额。\n"
        "战斗暴龙兽：感觉没什么好聊的。\n"
        "牙猎犬：……好直接汪。\n"
        "牙猎犬：如果尊不好意思的话也可以留下号码让我加！\n"
        "牙猎犬：[小猪爱心.jpg]"
    )
    service = NovelProcessService(provider=AlwaysMergedProvider(), storage_dir=tmp_path)

    completed = wait_for_job(service, service.create_job(request).jobId)
    results = service.get_results(completed.jobId)

    assert calls == 2
    assert completed.status == "failed"
    assert results.completedResults == []
    assert results.failedResults[0].semanticValidationStatus == "blocked"
    assert results.failedResults[0].semanticRepairCount == 0


def test_v2_does_not_treat_reserved_colon_labels_as_speakers(tmp_path) -> None:
    provider = CapturingProvider()
    request = _request(1, max_concurrency=1)
    request.promptVersion = "novel-process-v2"
    request.chunks[0].chunkText = "时间：晚上\n地点：宿舍\n提示：保持安静"
    service = NovelProcessService(provider=provider, storage_dir=tmp_path)

    completed = wait_for_job(service, service.create_job(request).jobId)

    assert completed.status == "completed"
    assert provider.inputs[0]["speakerCandidates"] == []


def test_v2_detects_multiple_inline_chat_speakers(tmp_path) -> None:
    provider = CapturingProvider()
    request = _request(1, max_concurrency=1)
    request.promptVersion = "novel-process-v2"
    request.chunks[0].chunkText = "牙猎犬：晚上好。 战斗暴龙兽：你终于上线了。"
    service = NovelProcessService(provider=provider, storage_dir=tmp_path)

    completed = wait_for_job(service, service.create_job(request).jobId)

    assert completed.status == "completed"
    assert provider.inputs[0]["speakerCandidates"] == ["牙猎犬", "战斗暴龙兽"]


def test_v2_unresolved_speaker_semantics_are_blocked_and_not_completed(tmp_path) -> None:
    class EmptySpeakerProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            yield (
                "final",
                SubagentModelOutput(
                    summary="聊天",
                    scenes=[
                        SceneBeat(
                            scene_id="chat",
                            title="聊天",
                            summary="聊天",
                            chapter=0,
                            commands=[{"type": "dialog", "character_id": "", "text": "无法确认说话人"}],
                        )
                    ],
                ),
            )

    request = _request(1, max_concurrency=1, max_retries=2)
    request.promptVersion = "novel-process-v2"
    request.chunks[0].chunkText = "牙猎犬：无法确认说话人"
    service = NovelProcessService(provider=EmptySpeakerProvider(), storage_dir=tmp_path)

    completed = wait_for_job(service, service.create_job(request).jobId)
    results = service.get_results(completed.jobId)

    assert completed.status == "failed"
    assert completed.chunks[0].retryCount == 0
    assert results.completedResults == []
    assert results.failedResults[0].semanticValidationStatus == "blocked"
    assert results.failedResults[0].qualityIssues[0].code == "speaker_structure_unresolved"


def test_concurrency_never_exceeds_configured_limit(tmp_path) -> None:
    provider = CapturingProvider(delay=0.08)
    service = NovelProcessService(provider=provider, storage_dir=tmp_path)

    job = service.create_job(_request(6, max_concurrency=2))
    completed = wait_for_job(service, job.jobId, timeout_seconds=5)

    assert completed.status == "completed"
    assert provider.max_active <= 2
    assert completed.completedChunks == 6


def test_failed_chunk_retries_and_completed_chunks_are_not_rerun(tmp_path) -> None:
    attempts: dict[int, int] = {}

    class RetryProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            payload = _input_from_prompt(user_prompt)
            chunk_index = int(payload["chunkIndex"])
            attempts[chunk_index] = attempts.get(chunk_index, 0) + 1
            self.inputs.append(payload)
            if chunk_index == 0 and attempts[chunk_index] == 1:
                yield ("delta", "bad-json")
                raise RuntimeError("temporary model failure")
            yield (
                "final",
                SubagentModelOutput(
                    status="completed",
                    resultText=f"ok {chunk_index}",
                    summary=f"summary {chunk_index}",
                ),
            )

    service = NovelProcessService(provider=RetryProvider(), storage_dir=tmp_path)
    job = service.create_job(_request(3, max_concurrency=3, max_retries=2))
    completed = wait_for_job(service, job.jobId)

    assert completed.status == "completed"
    assert attempts == {0: 2, 1: 1, 2: 1}
    assert completed.chunks[0].retryCount == 1
    assert [task.status for task in completed.agentTasks].count("failed") == 1
    assert [task.status for task in completed.agentTasks].count("completed") == 3
    assert any(event.eventType == "agent_task_retrying" for event in completed.eventLogs)


def test_interrupted_provider_connection_is_classified_and_only_failed_chunk_is_retried(tmp_path) -> None:
    attempts: dict[int, int] = {}

    class InterruptedProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            payload = _input_from_prompt(user_prompt)
            chunk_index = int(payload["chunkIndex"])
            attempts[chunk_index] = attempts.get(chunk_index, 0) + 1
            self.inputs.append(payload)
            if chunk_index == 0 and attempts[chunk_index] == 1:
                raise RuntimeError(
                    "模型服务请求失败（host: api.example.test, model: model-test）："
                    "peer closed connection without sending complete message body (incomplete chunked read)"
                )
            yield (
                "final",
                SubagentModelOutput(
                    status="completed",
                    resultText=f"ok {chunk_index}",
                    summary=f"summary {chunk_index}",
                ),
            )

    service = NovelProcessService(provider=InterruptedProvider(), storage_dir=tmp_path)
    completed = wait_for_job(
        service,
        service.create_job(_request(2, max_concurrency=2, max_retries=1)).jobId,
    )

    assert completed.status == "completed"
    assert attempts == {0: 2, 1: 1}
    failed_task = next(task for task in completed.agentTasks if task.status == "failed")
    assert failed_task.failureCategory == "provider_connection_interrupted"
    assert completed.chunks[0].retryCount == 1
    assert completed.chunks[1].retryCount == 0


def test_invalid_structured_output_is_saved_and_marks_partial_failure(tmp_path) -> None:
    class InvalidProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            yield ("delta", "raw invalid output")
            yield ("final", {"status": "not_valid"})

    service = NovelProcessService(provider=InvalidProvider(), storage_dir=tmp_path)
    job = service.create_job(_request(1, max_concurrency=1, max_retries=0))
    completed = wait_for_job(service, job.jobId)

    assert completed.status == "failed"
    assert completed.failedChunks == 1
    assert completed.agentTasks[0].status == "failed"
    assert "raw invalid output" in completed.agentTasks[0].rawOutput
    assert completed.chunkResults[0].status == "failed"


def test_cancel_marks_unstarted_chunks_cancelled_and_discards_late_merge(tmp_path) -> None:
    release = threading.Event()

    class BlockingProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            payload = _input_from_prompt(user_prompt)
            self.inputs.append(payload)
            yield ("delta", "running")
            release.wait(2)
            yield (
                "final",
                SubagentModelOutput(
                    status="completed",
                    resultText="completed before stop",
                    summary="finished running chunk",
                ),
            )

    service = NovelProcessService(provider=BlockingProvider(), storage_dir=tmp_path)
    job = service.create_job(_request(3, max_concurrency=1))
    wait_for_job(service, job.jobId, predicate=lambda item: item.runningTasks == 1)
    cancelled = service.cancel_job(job.jobId)
    release.set()
    final = wait_for_job(service, job.jobId, predicate=lambda item: item.status == "cancelled" and item.runningTasks == 0)

    assert cancelled.status == "cancelled"
    assert final.status == "cancelled"
    assert sum(1 for chunk in final.chunks if chunk.status == "cancelled") == 3
    assert final.completedChunks == 0
    assert final.chunkResults[0].status == "cancelled"
    assert final.chunkResults[0].mergeStatus == "discarded_cancelled"
    assert final.chunkResults[0].resultText == "completed before stop"


def test_job_status_and_events_are_readable_by_task_panel_routes(tmp_path, monkeypatch) -> None:
    service = NovelProcessService(provider=CapturingProvider(), storage_dir=tmp_path)
    monkeypatch.setattr(routes_novel_process, "service", service)
    client = TestClient(create_app())

    created = client.post("/api/novel/process/jobs", json=_request(2, max_concurrency=2).model_dump(mode="json"))
    assert created.status_code == 200
    job_id = created.json()["jobId"]
    wait_for_job(service, job_id)

    panel_job = client.get(f"/api/novel/process_jobs/{job_id}")
    events = client.get(f"/api/novel/process_jobs/{job_id}/events?limit=20")

    assert panel_job.status_code == 200
    assert panel_job.json()["source"] == "api"
    assert panel_job.json()["status"] == "completed"
    assert panel_job.json()["tokenStats"]["totalTokens"] > 0
    assert panel_job.json()["activePhase"] == "continuity_review"
    assert events.status_code == 200
    assert any(event["type"] in {"agent_output_updated", "agent_completed", "result_merged"} for event in events.json())


def test_panel_snapshot_uses_fixed_agent_slots(tmp_path, monkeypatch) -> None:
    service = NovelProcessService(provider=CapturingProvider(delay=0.5), storage_dir=tmp_path)
    monkeypatch.setattr(routes_novel_process, "service", service)
    client = TestClient(create_app())

    created = client.post("/api/novel/process/jobs", json=_request(5, max_concurrency=3).model_dump(mode="json"))
    assert created.status_code == 200
    job_id = created.json()["jobId"]
    wait_for_job(service, job_id, predicate=lambda item: item.runningTasks == 3, timeout_seconds=2)

    panel_job = client.get(f"/api/novel/process_jobs/{job_id}")
    payload = panel_job.json()

    assert panel_job.status_code == 200
    assert payload["maxConcurrency"] == 3
    assert len(payload["agents"]) == 3
    assert {agent["agentIndex"] for agent in payload["agents"]} == {0, 1, 2}
    assert all("assignedChunkIds" in agent for agent in payload["agents"])
    assert all("agentRole" in agent and "attemptId" in agent and "leaseExpiresAt" in agent for agent in payload["agents"])
    active_agents = [agent for agent in payload["agents"] if agent["status"] == "running"]
    assert len(active_agents) == 3
    assert len({agent["agentTaskId"] for agent in active_agents}) == 3
    assert len({agent["currentChunkId"] for agent in active_agents}) == 3
    for agent in active_agents:
        chunk_index = agent["currentChunkIndex"] - 1
        assert agent["currentChunkId"] == f"chunk_{chunk_index}"
        assert agent["currentChunkId"] in agent["assignedChunkIds"]
        assert agent["currentChunkExcerpt"].startswith(f"chunk-{chunk_index}-text-")
        assert agent["inputChunkChars"] == len(f"chunk-{chunk_index}-text-" + ("x" * 900))
        assert agent["heartbeatAt"] == agent["lastHeartbeatAt"]
        assert 25 <= agent["progressPercent"] <= 90
        assert all(event["agentTaskId"] == agent["agentTaskId"] for event in agent["recentEvents"])
    wait_for_job(service, job_id, timeout_seconds=5)


def test_partial_updates_refresh_heartbeat_without_flooding_events(tmp_path) -> None:
    class ChattyProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            payload = _input_from_prompt(user_prompt)
            for index in range(30):
                yield ("delta", f"{index:02d}-")
            yield ("final", SubagentModelOutput(status="completed", resultText="done", summary=f"summary {payload['chunkIndex']}"))

    service = NovelProcessService(provider=ChattyProvider(), storage_dir=tmp_path)
    job = service.create_job(_request(1, max_concurrency=1))
    completed = wait_for_job(service, job.jobId)
    partial_events = [event for event in completed.eventLogs if event.eventType == "agent_task_partial"]

    assert completed.agentTasks[0].partialChars > 0
    assert completed.agentTasks[0].lastHeartbeatAt is not None
    assert completed.agentTasks[0].leaseExpiresAt is not None
    assert len(partial_events) < 30


def test_sqlite_recovery_retries_interrupted_running_task(tmp_path) -> None:
    repo = NovelProcessJobRepository(tmp_path / "jobs.db")
    now = utc_now()
    job = NovelProcessJob(
        jobId="novel_job_recover",
        bookId="book_test",
        title="Recover",
        status="running",
        userInstruction="Rewrite.",
        outputFormat="markdown",
        promptVersion="test-v1",
        maxConcurrency=1,
        maxRetries=1,
        chunks=[
            ChunkRecord(
                chunkId="chunk_recover",
                chapterTitle="Chapter One",
                chapterIndex=0,
                chunkIndex=0,
                chunkText="recover me",
                status="running",
                updatedAt=now,
            )
        ],
        agentTasks=[
            AgentTask(
                taskId="agent_task_interrupted",
                jobId="novel_job_recover",
                chunkId="chunk_recover",
                chapterTitle="Chapter One",
                chapterIndex=0,
                chunkIndex=0,
                agentIndex=0,
                status="running",
                phase="streaming",
                startedAt=now,
                lastHeartbeatAt=now,
            )
        ],
        totalChunks=1,
        runningTasks=1,
        createdAt=now,
        updatedAt=now,
        startedAt=now,
    )
    repo.save_job(job)

    service = NovelProcessService(provider=CapturingProvider(), storage_dir=tmp_path, repository=repo)
    recovered = service.get_job(job.jobId)
    completed = wait_for_job(service, recovered.jobId, timeout_seconds=5)

    assert any(task.taskId == "agent_task_interrupted" and task.status == "retrying" for task in completed.agentTasks)
    assert completed.status == "completed"
    assert completed.completedChunks == 1
    assert len([task for task in completed.agentTasks if task.status == "completed"]) == 1


def test_canonical_execute_routes_share_executor_service(tmp_path, monkeypatch) -> None:
    service = NovelProcessService(provider=CapturingProvider(), storage_dir=tmp_path)
    monkeypatch.setattr(routes_novel_process, "service", service)
    monkeypatch.setattr(routes_novel_processing, "executor_service", service)
    client = TestClient(create_app())

    request_payload = _request(2, max_concurrency=2).model_dump(mode="json")
    request_payload["providerSelection"] = {
        "connection_id": "provider_test",
        "model_id": "model_test",
        "base_url": "https://example.invalid/v1",
        "api_key": "secret-api-key",
        "parameters": {
            "structured_mode": "json_object",
            "request_timeout_seconds": 60,
        },
    }
    created = client.post("/api/novel/processing/execute/jobs", json=request_payload)
    assert created.status_code == 200
    assert created.json()["providerSelection"]["api_key"] == ""
    assert "secret-api-key" not in json.dumps(created.json())
    job_id = created.json()["jobId"]
    wait_for_job(service, job_id)

    detail = client.get(f"/api/novel/processing/execute/jobs/{job_id}")
    panel = client.get(f"/api/novel/processing/execute/jobs/{job_id}/panel")
    results = client.get(f"/api/novel/processing/execute/jobs/{job_id}/results")

    assert detail.status_code == 200
    assert detail.json()["providerSelection"]["api_key"] == ""
    assert "secret-api-key" not in json.dumps(detail.json())
    assert panel.status_code == 200
    assert panel.json()["status"] == "completed"
    assert len(panel.json()["agents"]) == 2
    assert all("currentChunkId" in agent and "phase" in agent and "sceneCount" in agent and "usedFallbackScene" in agent for agent in panel.json()["agents"])
    assert results.status_code == 200
    assert len(results.json()["completedResults"]) == 2


def test_link_polish_sanitizes_ids_and_falls_back_to_text_only(tmp_path) -> None:
    source = SceneBeat(
        scene_id="scene_source",
        title="源场景",
        summary="源摘要",
        chapter=0,
        commands=[ChoiceCommand(choices=[{"choice_id": "choice_a", "text": "走过去", "target_scene_id": "scene_target"}])],
    )
    target = SceneBeat(
        scene_id="scene_target",
        title="目标场景",
        summary="目标摘要",
        chapter=0,
        commands=[NarrationCommand(text="原始开场")],
    )

    class PolishProvider(CapturingProvider):
        def create_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            return SceneLinkPolishResponse(
                patches=[
                    SceneLinkPolishPatch(
                        choiceId="wrong_choice",
                        choiceText="向那道微光走去",
                        choiceDisplayName="追随微光",
                        targetSceneId="wrong_target",
                        targetTitle="微光之后",
                        targetSummary="选择微光后的承接。",
                        openingText="她向微光迈出第一步。",
                    )
                ]
            )

    service = NovelProcessService(provider=PolishProvider(), storage_dir=tmp_path)
    response = service.polish_scene_links(
        SceneLinkPolishRequest(
            links=[{
                "sourceScene": source,
                "targetScene": target,
                "choiceId": "choice_a",
                "choiceText": "走过去",
            }]
        )
    )

    patch = response.patches[0]
    assert patch.choiceId == "choice_a"
    assert patch.targetSceneId == "scene_target"
    assert patch.choiceText == "向那道微光走去"
    assert patch.targetTitle == "微光之后"


def test_v3_merges_chunk_fragments_into_one_chapter_scene_and_deduplicates_exact_boundary(tmp_path) -> None:
    class FragmentProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            payload = _input_from_prompt(user_prompt)
            index = int(payload["chunkIndex"])
            commands = (
                [
                    {"type": "narration", "text": "章节开头"},
                    {"type": "dialog", "character_id": "甲", "text": "边界对白"},
                ]
                if index == 0
                else [
                    {"type": "dialog", "character_id": "甲", "text": "边界对白"},
                    {"type": "narration", "text": "章节结尾"},
                ]
            )
            yield (
                "final",
                SubagentModelOutput(
                    summary=f"片段 {index + 1}",
                    fragment=SceneFragment(
                        summary=f"片段 {index + 1}",
                        tags=["chapter", f"part_{index + 1}"],
                        commands=commands,
                    ),
                ),
            )

    request = _request(2, max_concurrency=1, max_retries=0)
    request.promptVersion = "novel-process-v3"
    request.chunks[0].chunkText = "章节开头\n甲：边界对白"
    request.chunks[1].chunkText = "甲：边界对白\n章节结尾"
    service = NovelProcessService(provider=FragmentProvider(), storage_dir=tmp_path)

    completed = wait_for_job(service, service.create_job(request).jobId)
    results = service.get_results(completed.jobId)

    assert completed.status == "completed"
    assert len(results.completedChapterResults) == 1
    chapter = results.completedChapterResults[0]
    assert chapter.scene is not None
    assert chapter.scene.scene_id == "novel_book_test_chapter_1"
    assert chapter.sourceChunkIds == ["chunk_0", "chunk_1"]
    assert [command.type for command in chapter.scene.commands] == ["narration", "dialog", "narration"]
    assert [getattr(command, "text", "") for command in chapter.scene.commands] == ["章节开头", "边界对白", "章节结尾"]


def test_v3_truncated_structured_output_splits_chunk_and_retries_only_children(tmp_path) -> None:
    class SplitProvider(CapturingProvider):
        def __init__(self) -> None:
            super().__init__()
            self.seen_lengths: list[int] = []

        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            payload = _input_from_prompt(user_prompt)
            text = str(payload["chunkText"])
            self.seen_lengths.append(len(text))
            if len(text) > 4000:
                raise RuntimeError("Unexpected EOF while parsing JSON response")
            yield (
                "final",
                SubagentModelOutput(
                    summary=text[:20],
                    fragment=SceneFragment(
                        summary=text[:20],
                        commands=[{"type": "narration", "text": text[:20]}],
                    ),
                ),
            )

    provider = SplitProvider()
    request = _request(1, max_concurrency=1, max_retries=0)
    request.promptVersion = "novel-process-v3"
    request.chunks[0].chunkText = ("第一段正文。" * 420) + "\n\n" + ("第二段正文。" * 420)
    request.chunks[0].startOffset = 0
    request.chunks[0].endOffset = len(request.chunks[0].chunkText)
    service = NovelProcessService(provider=provider, storage_dir=tmp_path)

    completed = wait_for_job(service, service.create_job(request).jobId)
    results = service.get_results(completed.jobId)

    assert completed.status == "completed"
    assert completed.totalChunks == 2
    assert completed.completedChunks == 2
    assert sum(chunk.status == "superseded" for chunk in completed.chunks) == 1
    assert all(chunk.parentChunkId == "chunk_0" for chunk in completed.chunks if chunk.status != "superseded")
    assert provider.seen_lengths[0] > 4000
    assert all(length <= 4000 for length in provider.seen_lengths[1:])
    assert len(results.completedChapterResults) == 1


def test_v3_failed_chunk_blocks_only_its_chapter_scene(tmp_path) -> None:
    class PartialFailureProvider(CapturingProvider):
        def stream_with_tools(self, response_model, system_prompt, user_prompt, **kwargs):  # type: ignore[no-untyped-def]
            payload = _input_from_prompt(user_prompt)
            if int(payload["chapterIndex"]) == 1:
                raise RuntimeError("400 invalid structured field")
            yield (
                "final",
                SubagentModelOutput(
                    summary="完整章节",
                    fragment=SceneFragment(
                        summary="完整章节",
                        commands=[{"type": "narration", "text": "可导入内容"}],
                    ),
                ),
            )

    request = NovelProcessJobCreateRequest(
        bookId="book_partial",
        title="Partial Novel",
        chunks=[
            {
                "chunkId": "chapter_ok",
                "chapterTitle": "完整章",
                "chapterIndex": 0,
                "chunkIndex": 0,
                "chunkText": "完整内容",
            },
            {
                "chunkId": "chapter_failed",
                "chapterTitle": "失败章",
                "chapterIndex": 1,
                "chunkIndex": 0,
                "chunkText": "失败内容",
            },
        ],
        userInstruction="改编",
        outputFormat="visual_novel_blueprint",
        promptVersion="novel-process-v3",
        maxConcurrency=2,
        maxRetries=0,
    )
    service = NovelProcessService(provider=PartialFailureProvider(), storage_dir=tmp_path)

    completed = wait_for_job(service, service.create_job(request).jobId)
    results = service.get_results(completed.jobId)

    assert completed.status == "failed_partial"
    assert [result.chapterTitle for result in results.completedChapterResults] == ["完整章"]
    assert [result.chapterTitle for result in results.failedChapterResults] == ["失败章"]
    assert results.failedChapterResults[0].scene is None
