import json
import re
import threading
import time

from fastapi.testclient import TestClient

from app.api import routes_novel_process, routes_novel_processing
from app.main import create_app
from app.models.commands import ChoiceCommand, NarrationCommand
from app.models.novel_process import AgentTask, ChunkRecord, NovelProcessJob, NovelProcessJobCreateRequest, SceneLinkPolishRequest, SceneLinkPolishResponse, SceneLinkPolishPatch, SubagentModelOutput
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
