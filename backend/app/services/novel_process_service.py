"""Concurrent subagent-style novel processing orchestration."""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from pathlib import Path
import logging
import os
import sqlite3
from threading import Event, RLock, Thread
import json
import time
from datetime import datetime, timedelta, timezone

from app.ai.context_budget import estimate_tokens
from app.ai.provider import AIProvider
from app.core.error_logging import log_exception
from app.models.novel_process import (
    AgentTask,
    BookGlobalMemory,
    ChapterResult,
    ChunkRecord,
    ChunkResult,
    JobEventLog,
    NovelProcessChunkInput,
    NovelProcessJob,
    NovelProcessJobCreateRequest,
    NovelProcessJobResults,
    SceneLinkPolishPatch,
    SceneLinkPolishItem,
    SceneLinkPolishRequest,
    SceneLinkPolishResponse,
    SubagentModelInput,
    SubagentModelOutput,
    QualityIssue,
    TokenUsage,
)
from app.schemas.requests import ProviderSelectionParameters, ProviderSelectionRequest
from app.db.init_db import init_db
from app.utils.ids import new_id


logger = logging.getLogger("agentvn.backend.novel_process")


TERMINAL_JOB_STATUSES = {"completed", "failed", "failed_partial", "cancelled"}
ELIGIBLE_CHUNK_STATUSES = {"pending", "waiting", "retrying"}
RECENT_EVENT_LIMIT = 200
SUMMARY_LIMIT = 800
CHAPTER_SUMMARY_LIMIT = 1500
NEXT_HINT_LIMIT = 800
STALE_RUNNING_TASK_SECONDS = 90
TASK_LEASE_SECONDS = 90
BASE_RETRY_BACKOFF_SECONDS = 0.2
MAX_RETRY_BACKOFF_SECONDS = 3.0


class TaskCancelled(RuntimeError):
    """Raised when a task is cancelled before its model call starts."""


@dataclass
class AgentExecutionResult:
    output: SubagentModelOutput
    raw_output: str
    input_tokens: int
    output_tokens: int
    token_source: str
    cancelled_after_start: bool = False


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        # error-log-ignore: 旧任务的可选时间字段无法解析时按没有时间信息处理。
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def utc_after(seconds: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def clip_text(value: str | None, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def default_storage_dir() -> Path:
    data_dir = Path(
        os.environ.get(
            "AGENTVN_BACKEND_DATA_DIR",
            Path(__file__).resolve().parents[2] / "data",
        )
    )
    return data_dir / "novel_process_jobs"


def default_database_path() -> Path:
    configured = os.environ.get("DATABASE_PATH")
    if configured:
        return Path(configured)
    return Path(
        os.environ.get(
            "AGENTVN_BACKEND_DATA_DIR",
            Path(__file__).resolve().parents[2] / "data",
        )
    ) / "vn_engine.db"


class NovelProcessJobRepository:
    """Persist executor jobs into the shared novel_processing_records table."""

    def __init__(self, database_path: Path | str) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.database_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        init_db(conn)
        return conn

    def load_job(self, job_id: str) -> NovelProcessJob | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value FROM novel_processing_records WHERE kind = ? AND id = ?",
                ("executor_job", job_id),
            ).fetchone()
            if row is None:
                return None
            return NovelProcessJob.model_validate(json.loads(row["value"]))

    def save_job(self, job: NovelProcessJob) -> None:
        payload = json.dumps(job.model_dump(mode="json"), ensure_ascii=False)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO novel_processing_records (kind, id, book_id, job_id, value, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(kind, id) DO UPDATE SET
                    book_id = excluded.book_id,
                    job_id = excluded.job_id,
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP
                """,
                ("executor_job", job.jobId, job.bookId, job.jobId, payload),
            )
            for chunk in job.chunks:
                conn.execute(
                    """
                    INSERT INTO novel_processing_records (kind, id, book_id, job_id, chapter_id, chunk_id, value, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(kind, id) DO UPDATE SET
                        book_id = excluded.book_id,
                        job_id = excluded.job_id,
                        chapter_id = excluded.chapter_id,
                        chunk_id = excluded.chunk_id,
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        "executor_chunk",
                        chunk.chunkId,
                        job.bookId,
                        job.jobId,
                        f"chapter_{chunk.chapterIndex}",
                        chunk.chunkId,
                        json.dumps(chunk.model_dump(mode="json"), ensure_ascii=False),
                    ),
                )
            for task in job.agentTasks:
                conn.execute(
                    """
                    INSERT INTO novel_processing_records (kind, id, book_id, job_id, chapter_id, chunk_id, value, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(kind, id) DO UPDATE SET
                        book_id = excluded.book_id,
                        job_id = excluded.job_id,
                        chapter_id = excluded.chapter_id,
                        chunk_id = excluded.chunk_id,
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        "executor_agent_task",
                        task.taskId,
                        job.bookId,
                        job.jobId,
                        f"chapter_{task.chapterIndex}",
                        task.chunkId,
                        json.dumps(task.model_dump(mode="json"), ensure_ascii=False),
                    ),
                )
            for result in job.chunkResults:
                conn.execute(
                    """
                    INSERT INTO novel_processing_records (kind, id, book_id, job_id, chapter_id, chunk_id, value, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(kind, id) DO UPDATE SET
                        book_id = excluded.book_id,
                        job_id = excluded.job_id,
                        chapter_id = excluded.chapter_id,
                        chunk_id = excluded.chunk_id,
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        "executor_chunk_result",
                        result.resultId,
                        job.bookId,
                        job.jobId,
                        f"chapter_{result.chapterIndex}",
                        result.chunkId,
                        json.dumps(result.model_dump(mode="json"), ensure_ascii=False),
                    ),
                )
            for event in job.eventLogs:
                conn.execute(
                    """
                    INSERT INTO novel_processing_records (kind, id, book_id, job_id, chunk_id, value, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(kind, id) DO UPDATE SET
                        book_id = excluded.book_id,
                        job_id = excluded.job_id,
                        chunk_id = excluded.chunk_id,
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        "executor_event",
                        event.eventId,
                        job.bookId,
                        job.jobId,
                        event.chunkId,
                        json.dumps(event.model_dump(mode="json"), ensure_ascii=False),
                    ),
                )
            conn.commit()


class NovelProcessService:
    """Run one model subagent per chunk while the job owns scheduling state."""

    def __init__(
        self,
        provider: AIProvider | None = None,
        storage_dir: Path | None = None,
        repository: NovelProcessJobRepository | None = None,
    ) -> None:
        self.provider = provider or AIProvider()
        self.storage_dir = storage_dir or default_storage_dir()
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.repository = repository
        self._jobs: dict[str, NovelProcessJob] = {}
        self._locks: dict[str, RLock] = {}
        self._cancel_events: dict[str, Event] = {}
        self._runners: dict[str, Thread] = {}

    def create_job(self, request: NovelProcessJobCreateRequest) -> NovelProcessJob:
        now = utc_now()
        job_id = new_id("novel_job")
        chunks = [
            self._chunk_from_input(item, now)
            for item in sorted(request.chunks, key=lambda chunk: (chunk.chapterIndex, chunk.chunkIndex))
        ]
        job = NovelProcessJob(
            jobId=job_id,
            bookId=request.bookId,
            title=request.title,
            status="created",
            userInstruction=request.userInstruction,
            outputFormat=request.outputFormat,
            promptVersion=request.promptVersion,
            maxConcurrency=request.maxConcurrency,
            maxRetries=request.maxRetries,
            providerSelection=request.providerSelection,
            chunks=chunks,
            totalChunks=len(chunks),
            createdAt=now,
            updatedAt=now,
        )
        lock = self._lock_for(job_id)
        with lock:
            self._jobs[job_id] = job
            self._cancel_events[job_id] = Event()
            self._append_event(job, "job_created", f"Job created with {len(chunks)} chunks.")
            self._refresh_progress(job)
            self._save_job_unlocked(job)
        self.start_job(job_id)
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> NovelProcessJob:
        lock = self._lock_for(job_id)
        with lock:
            job = self._load_job_unlocked(job_id)
            if self._recover_interrupted_job_unlocked(job):
                self._save_job_unlocked(job)
            return self._public_job(job)

    def start_job(self, job_id: str) -> NovelProcessJob:
        lock = self._lock_for(job_id)
        with lock:
            job = self._load_job_unlocked(job_id)
            if job.status in TERMINAL_JOB_STATUSES:
                return self._public_job(job)
            now = utc_now()
            was_paused = job.status == "paused"
            job.status = "running"
            job.activePhase = "chunk_parse"
            job.startedAt = job.startedAt or now
            job.updatedAt = now
            self._cancel_events.setdefault(job_id, Event()).clear()
            self._append_event(job, "job_resumed" if was_paused else "job_started", "Job scheduler is running.")
            self._save_job_unlocked(job)
            self._ensure_runner_unlocked(job_id)
            return self._public_job(job)

    def pause_job(self, job_id: str) -> NovelProcessJob:
        lock = self._lock_for(job_id)
        with lock:
            job = self._load_job_unlocked(job_id)
            if job.status in {"running", "retrying"}:
                job.status = "paused"
                job.updatedAt = utc_now()
                self._append_event(job, "job_paused", "Pause requested; no new agent tasks will be started.")
                self._save_job_unlocked(job)
            return self._public_job(job)

    def resume_job(self, job_id: str) -> NovelProcessJob:
        return self.start_job(job_id)

    def cancel_job(self, job_id: str) -> NovelProcessJob:
        lock = self._lock_for(job_id)
        with lock:
            job = self._load_job_unlocked(job_id)
            if job.status in TERMINAL_JOB_STATUSES and job.status != "cancelled":
                return self._public_job(job)
            job.status = "cancelled"
            job.updatedAt = utc_now()
            cancel_event = self._cancel_events.setdefault(job_id, Event())
            cancel_event.set()
            for task in job.agentTasks:
                if task.status == "running":
                    task.cancelRequestedAt = job.updatedAt
                    task.currentStepLabel = "Cancel requested; waiting for model stream to stop"
                    task.leaseExpiresAt = job.updatedAt
            for chunk in job.chunks:
                if chunk.status in ELIGIBLE_CHUNK_STATUSES:
                    chunk.status = "cancelled"
                    chunk.updatedAt = job.updatedAt
            self._append_event(job, "job_cancelled", "Cancel requested; queued chunks were marked cancelled.")
            self._refresh_progress(job)
            self._save_job_unlocked(job)
            return self._public_job(job)

    def rerun_failed(self, job_id: str) -> NovelProcessJob:
        lock = self._lock_for(job_id)
        with lock:
            job = self._load_job_unlocked(job_id)
            now = utc_now()
            failed_ids = {chunk.chunkId for chunk in job.chunks if chunk.status == "failed"}
            for chunk in job.chunks:
                if chunk.chunkId in failed_ids:
                    chunk.status = "pending"
                    chunk.retryCount = 0
                    chunk.errorMessage = None
                    chunk.resultId = None
                    chunk.nextAttemptAt = None
                    chunk.updatedAt = now
            job.chunkResults = [
                result for result in job.chunkResults
                if not (result.chunkId in failed_ids and result.status == "failed")
            ]
            job.status = "running"
            job.completedAt = None
            job.updatedAt = now
            self._cancel_events.setdefault(job_id, Event()).clear()
            self._append_event(job, "job_resumed", f"Rerunning {len(failed_ids)} failed chunks.")
            self._refresh_progress(job)
            self._save_job_unlocked(job)
            self._ensure_runner_unlocked(job_id)
            return self._public_job(job)

    def get_results(self, job_id: str) -> NovelProcessJobResults:
        lock = self._lock_for(job_id)
        with lock:
            job = self._load_job_unlocked(job_id)
            ordered = sorted(job.chunkResults, key=lambda item: (item.chapterIndex, item.chunkIndex, item.completedAt))
            warnings = [
                f"{result.chapterTitle or ('Chapter ' + str(result.chapterIndex + 1))} chunk {result.chunkIndex + 1}: {result.errorMessage}"
                for result in ordered
                if result.status == "failed" and result.errorMessage
            ]
            return NovelProcessJobResults(
                jobId=job.jobId,
                status=job.status,
                completedResults=[result for result in ordered if result.status == "completed"],
                failedResults=[result for result in ordered if result.status == "failed"],
                warnings=warnings,
            )

    def polish_scene_links(self, request: SceneLinkPolishRequest) -> SceneLinkPolishResponse:
        if not request.links:
            return SceneLinkPolishResponse()
        fallback = [self._fallback_polish_patch(item) for item in request.links]
        try:
            response = self.provider.create_with_tools(
                SceneLinkPolishResponse,
                self._link_polish_system_prompt(),
                self._link_polish_user_prompt(request),
                temperature=0.2,
                selection=self._json_mode_selection(request.providerSelection),
            )
            polished = response if isinstance(response, SceneLinkPolishResponse) else SceneLinkPolishResponse.model_validate(response)
            by_choice = {patch.choiceId: patch for patch in polished.patches}
            use_positional_fallback = len(polished.patches) == len(request.links)
            patches = [
                self._sanitize_polish_patch(
                    by_choice.get(item.choiceId) or (polished.patches[index] if use_positional_fallback else None),
                    fallback_patch,
                )
                for index, (item, fallback_patch) in enumerate(zip(request.links, fallback))
            ]
            return SceneLinkPolishResponse(patches=patches, warnings=polished.warnings)
        except Exception as exc:  # noqa: BLE001 - polish is best-effort and must not block import.
            log_exception(logger, "小说处理的场景衔接润色失败，已使用原文本", exc)
            return SceneLinkPolishResponse(
                patches=[patch.model_copy(update={"warnings": [*patch.warnings, "润色失败，已保留原文本。"]}) for patch in fallback],
                warnings=[clip_text(str(exc), 400)],
            )

    def _run_job(self, job_id: str) -> None:
        with ThreadPoolExecutor(max_workers=10, thread_name_prefix=f"agentvn-{job_id[:8]}") as executor:
            futures: dict[Future[AgentExecutionResult], str] = {}
            while True:
                with self._lock_for(job_id):
                    job = self._load_job_unlocked(job_id)
                    self._refresh_progress(job)
                    if job.status == "cancelled":
                        self._mark_queued_cancelled_unlocked(job)
                    if job.status in {"running", "retrying"}:
                        free_agents = self._free_agent_indexes(job)
                        for agent_index, chunk in zip(free_agents, self._eligible_chunks(job)[:len(free_agents)]):
                            task, model_input = self._start_agent_task_unlocked(job, chunk, agent_index)
                            futures[executor.submit(self._execute_agent_task, job_id, task.taskId, model_input, job.providerSelection)] = task.taskId
                    self._save_job_unlocked(job)

                if not futures:
                    with self._lock_for(job_id):
                        job = self._load_job_unlocked(job_id)
                        if self._finish_or_pause_unlocked(job):
                            self._save_job_unlocked(job)
                            return
                    time.sleep(0.05)
                    continue

                done, _pending = wait(futures.keys(), timeout=0.1, return_when=FIRST_COMPLETED)
                for future in done:
                    task_id = futures.pop(future)
                    try:
                        result = future.result()
                    except TaskCancelled as exc:
                        # error-log-ignore: 这是用户主动取消或任务被上层明确撤销，不属于执行失败。
                        self._handle_task_cancelled(job_id, task_id, str(exc))
                    except Exception as exc:  # noqa: BLE001 - every agent failure must be recorded and retried.
                        log_exception(
                            logger,
                            f"小说处理子任务失败：job={job_id} task={task_id}",
                            exc,
                        )
                        self._handle_task_failed(job_id, task_id, str(exc))
                    else:
                        self._handle_task_completed(job_id, task_id, result)

    def _execute_agent_task(
        self,
        job_id: str,
        task_id: str,
        model_input: SubagentModelInput,
        provider_selection: ProviderSelectionRequest | None,
    ) -> AgentExecutionResult:
        cancel_event = self._cancel_events.setdefault(job_id, Event())
        if cancel_event.is_set():
            raise TaskCancelled("Task was cancelled before the model call started.")

        system_prompt, user_prompt = self._agent_prompts(model_input)
        input_tokens = estimate_tokens(f"{system_prompt}\n{user_prompt}")
        selection = self._json_mode_selection(provider_selection)
        partial: list[str] = []
        final_output: SubagentModelOutput | None = None

        for event, payload in self.provider.stream_with_tools(
            SubagentModelOutput,
            system_prompt,
            user_prompt,
            temperature=0.2,
            selection=selection,
        ):
            if event == "delta" and isinstance(payload, str):
                partial.append(payload)
                self._record_partial(job_id, task_id, payload)
            elif event == "status" and isinstance(payload, str):
                self._record_task_status(job_id, task_id, payload)
            elif event == "final":
                final_output = payload if isinstance(payload, SubagentModelOutput) else SubagentModelOutput.model_validate(payload)
            if cancel_event.is_set():
                if final_output is None:
                    raise TaskCancelled("Task was cancelled while the model stream was active.")
                break

        raw_output = "".join(partial)
        if final_output is None:
            raise RuntimeError(f"Subagent did not return a structured final payload. Raw output: {raw_output[:2000]}")
        if final_output.status == "failed":
            raise RuntimeError(final_output.errorMessage or f"Subagent returned failed status. Raw output: {raw_output[:2000]}")

        output_text = "\n".join([
            final_output.resultText,
            final_output.summary,
            final_output.model_dump_json(include={"scenes"}) if final_output.scenes else "",
            "\n".join(final_output.continuityNotes),
        ])
        output_tokens = estimate_tokens(output_text)
        final_output.inputTokens = input_tokens
        final_output.outputTokens = output_tokens
        if not raw_output:
            raw_output = final_output.model_dump_json()
        return AgentExecutionResult(
            output=final_output,
            raw_output=raw_output,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            token_source="estimated",
            cancelled_after_start=cancel_event.is_set(),
        )

    def _handle_task_completed(self, job_id: str, task_id: str, result: AgentExecutionResult) -> None:
        with self._lock_for(job_id):
            job = self._load_job_unlocked(job_id)
            task = self._find_task(job, task_id)
            chunk = self._find_chunk(job, task.chunkId)
            now = utc_now()
            scenes = result.output.scenes
            quality_issues = self._quality_issues(result.output, chunk.chunkId)
            quality_warnings = [issue.message for issue in quality_issues]
            tokens = TokenUsage(
                inputTokens=result.input_tokens,
                outputTokens=result.output_tokens,
                totalTokens=result.input_tokens + result.output_tokens,
                tokenSource=result.token_source,  # type: ignore[arg-type]
            )
            if result.cancelled_after_start or job.status == "cancelled" or self._cancel_events.setdefault(job_id, Event()).is_set():
                result_id = new_id("chunk_result")
                task.status = "cancelled"
                task.phase = "cancelled"
                task.currentStepLabel = "Cancelled after model output; result kept for review"
                task.completedAt = now
                task.lastHeartbeatAt = now
                task.leaseExpiresAt = now
                task.cancelRequestedAt = task.cancelRequestedAt or now
                task.inputTokens = tokens.inputTokens
                task.outputTokens = tokens.outputTokens
                task.totalTokens = tokens.totalTokens
                task.tokenSource = tokens.tokenSource
                task.rawOutput = result.raw_output[:12000]
                task.resultPreview = clip_text(result.output.resultText or result.output.summary, 600)
                task.warnings = [*result.output.warnings, *quality_warnings, "Cancelled result was not merged."]
                task.errorMessage = "Cancelled after model output; result was not merged."

                chunk.status = "cancelled"
                chunk.summary = clip_text(result.output.summary, SUMMARY_LIMIT)
                chunk.resultId = result_id
                chunk.errorMessage = task.errorMessage
                chunk.updatedAt = now
                job.chunkResults.append(
                    ChunkResult(
                        resultId=result_id,
                        chunkId=chunk.chunkId,
                        chapterTitle=chunk.chapterTitle,
                        chapterIndex=chunk.chapterIndex,
                        chunkIndex=chunk.chunkIndex,
                        status="cancelled",
                        resultText=result.output.resultText,
                        summary=chunk.summary,
                        scenes=scenes,
                        sceneCount=len(scenes),
                        usedFallbackScene=len(scenes) == 0,
                        schemaRepairCount=task.schemaRepairCount,
                        mergeStatus="discarded_cancelled",
                        continuityNotes=[clip_text(note, 240) for note in result.output.continuityNotes[:20]],
                        warnings=[*result.output.warnings, "Cancelled result was not merged."],
                        qualityWarnings=quality_warnings,
                        qualityIssues=quality_issues,
                        rawOutput=result.raw_output[:12000],
                        tokens=tokens,
                        completedAt=now,
                    )
                )
                self._append_event(job, "agent_task_cancelled", "Agent output arrived after cancel and was kept out of the merged result.", task.taskId, chunk.chunkId)
                self._refresh_progress(job)
                self._save_job_unlocked(job)
                return

            task.status = "completed"
            task.phase = "completed"
            task.currentStepLabel = "已完成并合并"
            task.completedAt = now
            task.lastHeartbeatAt = now
            task.leaseExpiresAt = now
            task.inputTokens = tokens.inputTokens
            task.outputTokens = tokens.outputTokens
            task.totalTokens = tokens.totalTokens
            task.tokenSource = tokens.tokenSource
            task.rawOutput = result.raw_output[:12000]
            task.resultPreview = clip_text(result.output.resultText or result.output.summary, 600)
            task.warnings = [*result.output.warnings, *quality_warnings]
            task.errorMessage = None

            result_id = new_id("chunk_result")
            chunk.status = "completed"
            chunk.summary = clip_text(result.output.summary, SUMMARY_LIMIT)
            chunk.resultId = result_id
            chunk.errorMessage = None
            chunk.updatedAt = now
            job.chunkResults.append(
                ChunkResult(
                    resultId=result_id,
                    chunkId=chunk.chunkId,
                    chapterTitle=chunk.chapterTitle,
                    chapterIndex=chunk.chapterIndex,
                    chunkIndex=chunk.chunkIndex,
                    status="completed",
                    resultText=result.output.resultText,
                    summary=chunk.summary,
                    scenes=scenes,
                    sceneCount=len(scenes),
                    usedFallbackScene=len(scenes) == 0,
                    schemaRepairCount=task.schemaRepairCount,
                    mergeStatus="merged",
                    continuityNotes=[clip_text(note, 240) for note in result.output.continuityNotes[:20]],
                    warnings=result.output.warnings,
                    qualityWarnings=quality_warnings,
                    qualityIssues=quality_issues,
                    rawOutput=result.raw_output[:12000],
                    tokens=tokens,
                    completedAt=now,
                )
            )
            self._merge_global_memory(job.bookGlobalMemory, result.output.continuityNotes)
            self._append_event(job, "agent_task_completed", "Agent task completed.", task.taskId, chunk.chunkId)
            self._append_event(job, "result_merged", "Chunk result saved and merged into job state.", task.taskId, chunk.chunkId)
            self._refresh_progress(job)
            self._save_job_unlocked(job)

    def _handle_task_failed(self, job_id: str, task_id: str, message: str) -> None:
        with self._lock_for(job_id):
            job = self._load_job_unlocked(job_id)
            task = self._find_task(job, task_id)
            chunk = self._find_chunk(job, task.chunkId)
            now = utc_now()
            failure_category = self._failure_category(message)
            task.status = "failed"
            task.phase = "failed"
            task.currentStepLabel = "Failed; retry scheduled" if chunk.retryCount < job.maxRetries else "Failed"
            task.completedAt = now
            task.lastHeartbeatAt = now
            task.leaseExpiresAt = now
            task.errorMessage = message
            task.failureCategory = failure_category
            task.rawOutput = task.partialResult[:12000]
            self._append_event(job, "agent_task_failed", clip_text(message, 800), task.taskId, chunk.chunkId)

            if job.status == "cancelled" or self._cancel_events.setdefault(job_id, Event()).is_set():
                chunk.status = "cancelled"
                chunk.updatedAt = now
                task.status = "cancelled"
                self._refresh_progress(job)
                self._save_job_unlocked(job)
                return

            if chunk.retryCount < job.maxRetries:
                chunk.retryCount += 1
                backoff_seconds = self._retry_backoff_seconds(chunk.retryCount)
                chunk.status = "retrying"
                chunk.errorMessage = message
                chunk.nextAttemptAt = utc_after(backoff_seconds)
                chunk.updatedAt = now
                task.retryBackoffMs = int(backoff_seconds * 1000)
                self._append_event(
                    job,
                    "agent_task_retrying",
                    f"Retry {chunk.retryCount}/{job.maxRetries} scheduled after {task.retryBackoffMs}ms.",
                    task.taskId,
                    chunk.chunkId,
                    {"failureCategory": failure_category, "retryBackoffMs": task.retryBackoffMs},
                )
            else:
                chunk.status = "failed"
                chunk.errorMessage = message
                chunk.nextAttemptAt = None
                chunk.updatedAt = now
                result_id = new_id("chunk_result")
                chunk.resultId = result_id
                job.chunkResults.append(
                    ChunkResult(
                        resultId=result_id,
                        chunkId=chunk.chunkId,
                        chapterTitle=chunk.chapterTitle,
                        chapterIndex=chunk.chapterIndex,
                        chunkIndex=chunk.chunkIndex,
                        status="failed",
                        errorMessage=message,
                        rawOutput=task.partialResult[:12000],
                        schemaRepairCount=task.schemaRepairCount,
                        mergeStatus="failed",
                        qualityWarnings=[f"{failure_category}: {clip_text(message, 240)}"],
                        qualityIssues=[
                            QualityIssue(
                                code=failure_category,
                                severity="danger",
                                message=clip_text(message, 240),
                                evidence=task.chunkId,
                                action="修复模型连接或结构化输出后重试该切片。",
                                sourceChunkId=task.chunkId,
                            )
                        ],
                        tokens=TokenUsage(
                            inputTokens=task.inputTokens,
                            outputTokens=task.outputTokens,
                            totalTokens=task.totalTokens,
                            tokenSource=task.tokenSource,
                        ),
                        completedAt=now,
                    )
                )
            self._refresh_progress(job)
            self._save_job_unlocked(job)

    def _handle_task_cancelled(self, job_id: str, task_id: str, message: str) -> None:
        with self._lock_for(job_id):
            job = self._load_job_unlocked(job_id)
            task = self._find_task(job, task_id)
            chunk = self._find_chunk(job, task.chunkId)
            now = utc_now()
            task.status = "cancelled"
            task.phase = "cancelled"
            task.currentStepLabel = "已取消"
            task.completedAt = now
            task.lastHeartbeatAt = now
            task.leaseExpiresAt = now
            task.cancelRequestedAt = task.cancelRequestedAt or now
            task.errorMessage = message
            chunk.status = "cancelled"
            chunk.errorMessage = message
            chunk.updatedAt = now
            self._append_event(job, "agent_task_cancelled", message, task.taskId, chunk.chunkId)
            self._refresh_progress(job)
            self._save_job_unlocked(job)

    def _record_partial(self, job_id: str, task_id: str, delta: str) -> None:
        with self._lock_for(job_id):
            job = self._load_job_unlocked(job_id)
            task = self._find_task(job, task_id)
            task.partialResult = (task.partialResult + delta)[-12000:]
            previous_chars = task.partialChars
            task.partialChars += len(delta)
            task.resultPreview = clip_text(task.partialResult, 600)
            task.phase = "streaming"
            task.currentStepLabel = "模型正在输出"
            task.lastHeartbeatAt = utc_now()
            task.leaseExpiresAt = utc_after(TASK_LEASE_SECONDS)
            job.updatedAt = utc_now()
            if previous_chars == 0 or task.partialChars // 800 > previous_chars // 800:
                self._append_event(job, "agent_task_partial", "Agent task emitted partial output.", task.taskId, task.chunkId, {"deltaChars": len(delta), "partialChars": task.partialChars})
            self._save_job_unlocked(job)

    def _record_task_status(self, job_id: str, task_id: str, status: str) -> None:
        with self._lock_for(job_id):
            job = self._load_job_unlocked(job_id)
            task = self._find_task(job, task_id)
            task.resultPreview = clip_text(status, 600)
            task.phase = "status"
            task.currentStepLabel = clip_text(status, 120)
            task.lastHeartbeatAt = utc_now()
            task.leaseExpiresAt = utc_after(TASK_LEASE_SECONDS)
            job.updatedAt = utc_now()
            self._save_job_unlocked(job)

    def _start_agent_task_unlocked(self, job: NovelProcessJob, chunk: ChunkRecord, agent_index: int) -> tuple[AgentTask, SubagentModelInput]:
        now = utc_now()
        model_input = self._model_input_for_chunk(job, chunk)
        task = AgentTask(
            taskId=new_id("agent_task"),
            jobId=job.jobId,
            chunkId=chunk.chunkId,
            chapterTitle=chunk.chapterTitle,
            chapterIndex=chunk.chapterIndex,
            chunkIndex=chunk.chunkIndex,
            agentIndex=agent_index,
            agentRole="chunk_parser",
            attemptId=new_id("attempt"),
            runAttempt=chunk.retryCount + 1,
            status="running",
            phase="chunk_parse",
            assignmentReason=f"Agent {agent_index + 1} claimed the earliest eligible chunk from the queue.",
            currentStepLabel="Preparing structured model request",
            lastHeartbeatAt=now,
            leaseExpiresAt=utc_after(TASK_LEASE_SECONDS),
            retryCount=chunk.retryCount,
            startedAt=now,
            inputKeys=list(model_input.model_dump().keys()),
            inputChunkChars=len(model_input.chunkText),
            contextChars=len(model_input.previousContextSummary) + len(model_input.nextContextHint),
        )
        chunk.status = "running"
        chunk.nextAttemptAt = None
        chunk.previousContextSummary = model_input.previousContextSummary
        chunk.nextContextHint = model_input.nextContextHint
        chunk.contextChars = task.contextChars
        chunk.updatedAt = now
        job.agentTasks.append(task)
        self._append_event(job, "agent_task_started", "Agent task started.", task.taskId, chunk.chunkId, {
            "chapterIndex": chunk.chapterIndex,
            "chunkIndex": chunk.chunkIndex,
            "retryCount": chunk.retryCount,
            "inputKeys": task.inputKeys,
            "inputChunkChars": task.inputChunkChars,
            "contextChars": task.contextChars,
            "agentIndex": agent_index,
            "agentRole": task.agentRole,
            "attemptId": task.attemptId,
            "runAttempt": task.runAttempt,
            "assignmentReason": task.assignmentReason,
        })
        return task, model_input

    def _model_input_for_chunk(self, job: NovelProcessJob, chunk: ChunkRecord) -> SubagentModelInput:
        return SubagentModelInput(
            bookId=job.bookId,
            chapterTitle=chunk.chapterTitle,
            chapterIndex=chunk.chapterIndex,
            chunkIndex=chunk.chunkIndex,
            chunkText=chunk.chunkText,
            previousContextSummary=clip_text(chunk.previousContextSummary or self._previous_context_summary(job, chunk), SUMMARY_LIMIT),
            nextContextHint=clip_text(chunk.nextContextHint or self._next_context_hint(job, chunk), NEXT_HINT_LIMIT),
            userInstruction=job.userInstruction,
            outputFormat=job.outputFormat,
            promptVersion=job.promptVersion,
        )

    def _agent_prompts(self, model_input: SubagentModelInput) -> tuple[str, str]:
        system_prompt = (
            "You are an AgentVN chunk_parser subagent in the chunk_parse phase. Process exactly one novel chunk and return one structured JSON object. "
            "Never request or rely on the full novel, the full chapter list, full conversation history, or uncompressed prior chunks. "
            "Use previousContextSummary and nextContextHint only as compressed continuity/context, never as source text to transform or repeat. "
            "Keep summary concise."
        )
        user_prompt = (
            "Subagent input JSON follows. The only source text you may transform is chunkText in this object.\n"
            f"{model_input.model_dump_json()}\n\n"
            "Return JSON matching SubagentModelOutput with fields: status, resultText, summary, continuityNotes, "
            "scenes, inputTokens, outputTokens, warnings, errorMessage. "
            "When possible, include one or more complete AgentVN SceneBeat objects in scenes. "
            "Use these exact snake_case SceneBeat fields only: scene_id, scene_display_name, title, summary, commands, tags, chapter. "
            "Every commands item must be a legal AgentVN GameCommand with a type discriminator; do not return sceneId, sceneTitle, "
            "sceneType, dialogue, actions, beats, location, characters, or other prose-planner fields inside scenes. "
            "continuityNotes and warnings must always be JSON arrays of strings, even when there is only one item. "
            "Set status to completed unless the chunk cannot be processed."
        )
        return system_prompt, user_prompt

    def _previous_context_summary(self, job: NovelProcessJob, chunk: ChunkRecord) -> str:
        previous = [
            item for item in job.chunks
            if (item.chapterIndex, item.chunkIndex) < (chunk.chapterIndex, chunk.chunkIndex) and item.summary
        ]
        if not previous:
            return ""
        snippets = [item.summary for item in previous[-3:]]
        return clip_text("\n".join(snippets), SUMMARY_LIMIT)

    def _next_context_hint(self, job: NovelProcessJob, chunk: ChunkRecord) -> str:
        future = [
            item for item in job.chunks
            if (item.chapterIndex, item.chunkIndex) > (chunk.chapterIndex, chunk.chunkIndex)
        ]
        if not future:
            return ""
        next_chunk = sorted(future, key=lambda item: (item.chapterIndex, item.chunkIndex))[0]
        if next_chunk.chapterIndex != chunk.chapterIndex:
            return clip_text(f"Next chapter: {next_chunk.chapterTitle}", NEXT_HINT_LIMIT)
        return clip_text(f"Next chunk begins: {next_chunk.chunkText[:360]}", NEXT_HINT_LIMIT)

    def _eligible_chunks(self, job: NovelProcessJob) -> list[ChunkRecord]:
        completed_ids = {result.chunkId for result in job.chunkResults if result.status == "completed"}
        running_ids = {task.chunkId for task in job.agentTasks if task.status == "running"}
        now = datetime.now(timezone.utc)
        return [
            chunk for chunk in sorted(job.chunks, key=lambda item: (item.chapterIndex, item.chunkIndex))
            if chunk.status in ELIGIBLE_CHUNK_STATUSES and chunk.chunkId not in completed_ids and chunk.chunkId not in running_ids
            and (parse_utc(chunk.nextAttemptAt) is None or parse_utc(chunk.nextAttemptAt) <= now)
        ]

    def _free_agent_indexes(self, job: NovelProcessJob) -> list[int]:
        max_concurrency = min(job.maxConcurrency, 10)
        busy = {task.agentIndex for task in job.agentTasks if task.status == "running"}
        return [index for index in range(max_concurrency) if index not in busy]

    def _finish_or_pause_unlocked(self, job: NovelProcessJob) -> bool:
        self._refresh_progress(job)
        if job.status == "paused":
            return True
        if job.status == "cancelled":
            self._mark_queued_cancelled_unlocked(job)
            job.completedAt = job.completedAt or utc_now()
            self._refresh_progress(job)
            return True
        if job.status not in {"running", "retrying"}:
            return job.status in TERMINAL_JOB_STATUSES
        if self._eligible_chunks(job):
            return False
        if any(chunk.status in ELIGIBLE_CHUNK_STATUSES for chunk in job.chunks):
            return False
        if any(task.status == "running" for task in job.agentTasks):
            return False
        now = utc_now()
        self._run_merge_review_unlocked(job)
        if any(chunk.status == "failed" for chunk in job.chunks):
            job.status = "failed_partial" if any(chunk.status == "completed" for chunk in job.chunks) else "failed"
            self._append_event(job, "job_failed_partial", "Job finished with failed chunks.")
        elif all(chunk.status in {"completed", "cancelled"} for chunk in job.chunks):
            job.status = "completed"
            self._append_event(job, "job_completed", "Job completed.")
        job.completedAt = now
        job.updatedAt = now
        self._refresh_progress(job)
        return job.status in TERMINAL_JOB_STATUSES

    def _refresh_progress(self, job: NovelProcessJob) -> None:
        job.totalChunks = len(job.chunks)
        job.completedChunks = sum(1 for chunk in job.chunks if chunk.status == "completed")
        job.failedChunks = sum(1 for chunk in job.chunks if chunk.status == "failed")
        job.cancelledChunks = sum(1 for chunk in job.chunks if chunk.status == "cancelled")
        job.runningTasks = sum(1 for task in job.agentTasks if task.status == "running")
        job.actualInputTokens = sum(result.tokens.inputTokens for result in job.chunkResults)
        job.actualOutputTokens = sum(result.tokens.outputTokens for result in job.chunkResults)
        job.actualTotalTokens = job.actualInputTokens + job.actualOutputTokens
        sources = {result.tokens.tokenSource for result in job.chunkResults if result.tokens.tokenSource != "none"}
        job.tokenSource = "mixed" if len(sources) > 1 else next(iter(sources), "none")  # type: ignore[assignment]
        job.chapterResults = self._chapter_results(job)
        job.updatedAt = utc_now()

    def _chapter_results(self, job: NovelProcessJob) -> list[ChapterResult]:
        chapters: dict[tuple[int, str], list[ChunkRecord]] = {}
        for chunk in job.chunks:
            chapters.setdefault((chunk.chapterIndex, chunk.chapterTitle), []).append(chunk)
        result_by_chunk = {result.chunkId: result for result in job.chunkResults}
        chapter_results: list[ChapterResult] = []
        now = utc_now()
        for (chapter_index, chapter_title), chunks in sorted(chapters.items()):
            summaries = [chunk.summary for chunk in sorted(chunks, key=lambda item: item.chunkIndex) if chunk.summary]
            chapter_token_results = [result_by_chunk[chunk.chunkId] for chunk in chunks if chunk.chunkId in result_by_chunk]
            input_tokens = sum(result.tokens.inputTokens for result in chapter_token_results)
            output_tokens = sum(result.tokens.outputTokens for result in chapter_token_results)
            sources = {result.tokens.tokenSource for result in chapter_token_results if result.tokens.tokenSource != "none"}
            chapter_results.append(
                ChapterResult(
                    chapterTitle=chapter_title,
                    chapterIndex=chapter_index,
                    summary=clip_text("\n".join(summaries), CHAPTER_SUMMARY_LIMIT),
                    completedChunks=sum(1 for chunk in chunks if chunk.status == "completed"),
                    failedChunks=sum(1 for chunk in chunks if chunk.status == "failed"),
                    cancelledChunks=sum(1 for chunk in chunks if chunk.status == "cancelled"),
                    tokens=TokenUsage(
                        inputTokens=input_tokens,
                        outputTokens=output_tokens,
                        totalTokens=input_tokens + output_tokens,
                        tokenSource=("mixed" if len(sources) > 1 else next(iter(sources), "none")),  # type: ignore[arg-type]
                    ),
                    updatedAt=now,
                )
            )
        return chapter_results

    def _run_merge_review_unlocked(self, job: NovelProcessJob) -> None:
        if not any(event.eventType == "chapter_merge_completed" for event in job.eventLogs):
            job.activePhase = "chapter_merge"
            job.chapterResults = self._chapter_results(job)
            merged_results = [result for result in job.chunkResults if result.status == "completed"]
            self._append_event(
                job,
                "chapter_merge_completed",
                f"Chapter merge summarized {len(job.chapterResults)} chapters from {len(merged_results)} completed chunks.",
                details={
                    "chapterCount": len(job.chapterResults),
                    "completedChunkResults": len(merged_results),
                    "failedChunks": sum(1 for chunk in job.chunks if chunk.status == "failed"),
                    "cancelledChunks": sum(1 for chunk in job.chunks if chunk.status == "cancelled"),
                },
            )
        if not any(event.eventType == "continuity_review_completed" for event in job.eventLogs):
            job.activePhase = "continuity_review"
            review_issues = [
                issue
                for result in job.chunkResults
                for issue in result.qualityIssues
            ]
            fallback_count = sum(1 for result in job.chunkResults if result.usedFallbackScene)
            if fallback_count:
                review_issues.append(
                    QualityIssue(
                        code="fallback_scene_chunks",
                        severity="danger",
                        message=f"{fallback_count} 个切片没有返回结构化场景，结果只能进入作者复核。",
                        evidence=str(fallback_count),
                        action="重跑对应切片或补齐结构化场景，避免把复核文本导入玩家可见内容。",
                    )
                )
            self._append_event(
                job,
                "continuity_review_completed",
                f"Continuity review completed with {len(review_issues)} quality issues.",
                details={
                    "warningCount": len(review_issues),
                    "fallbackSceneChunks": fallback_count,
                    "warnings": [issue.message for issue in review_issues[:20]],
                },
            )

    @staticmethod
    def _quality_warnings(output: SubagentModelOutput) -> list[str]:
        return [issue.message for issue in NovelProcessService._quality_issues(output)]

    @staticmethod
    def _quality_issues(output: SubagentModelOutput, source_chunk_id: str | None = None) -> list[QualityIssue]:
        issues: list[QualityIssue] = []
        if not output.scenes:
            issues.append(
                QualityIssue(
                    code="missing_structured_scenes",
                    severity="danger",
                    message="该切片没有返回结构化场景，不能作为最终玩家内容直接导入。",
                    evidence=clip_text(output.resultText or output.summary, 180),
                    action="重跑该切片，或在编辑器中补齐 SceneBeat 后再导入。",
                    sourceChunkId=source_chunk_id,
                )
            )
        if not output.summary.strip():
            issues.append(
                QualityIssue(
                    code="missing_chunk_summary",
                    severity="warning",
                    message="该切片缺少摘要，后续连续性判断会变弱。",
                    evidence=clip_text(output.resultText, 180),
                    action="重跑或手动补充切片摘要。",
                    sourceChunkId=source_chunk_id,
                )
            )
        if not output.resultText.strip() and not output.scenes:
            issues.append(
                QualityIssue(
                    code="empty_chunk_output",
                    severity="blocked",
                    message="该切片没有可用文本或结构化场景。",
                    evidence="empty resultText and scenes",
                    action="必须重跑该切片，不能写入玩家可见结果。",
                    sourceChunkId=source_chunk_id,
                )
            )
        low_quality_markers = (
            "章节原文缺失",
            "原文内容缺失",
            "原文缺失",
            "原文不可用",
            "原文未提供",
            "未返回结构化 scenes",
            "fallback scene",
            "source text is incomplete",
            "source is incomplete",
        )
        visible_text = "\n".join(
            [
                output.resultText,
                output.summary,
                *[scene.title for scene in output.scenes],
                *[scene.summary for scene in output.scenes],
            ]
        )
        for marker in low_quality_markers:
            if marker.lower() in visible_text.lower():
                issues.append(
                    QualityIssue(
                        code="player_visible_diagnostic_text",
                        severity="blocked",
                        message=f"玩家可见内容包含诊断/低质话术：{marker}",
                        evidence=clip_text(visible_text, 240),
                        action="从正文、标题、摘要和对白中移除该话术；必要时重跑切片。",
                        sourceChunkId=source_chunk_id,
                    )
                )
                break
        return issues

    @staticmethod
    def _failure_category(message: str) -> str:
        lower = message.lower()
        if "cancel" in lower:
            return "cancelled"
        if "timeout" in lower or "timed out" in lower or "abort" in lower or "超时" in message:
            return "provider_timeout"
        if "429" in lower or "rate limit" in lower or "quota" in lower:
            return "rate_limited"
        if "structured" in lower or "json" in lower or "validation" in lower or "not_valid" in lower:
            return "structured_output"
        return "provider_error"

    @staticmethod
    def _retry_backoff_seconds(retry_count: int) -> float:
        return min(MAX_RETRY_BACKOFF_SECONDS, BASE_RETRY_BACKOFF_SECONDS * (2 ** max(0, retry_count - 1)))

    def _mark_queued_cancelled_unlocked(self, job: NovelProcessJob) -> None:
        now = utc_now()
        for chunk in job.chunks:
            if chunk.status in ELIGIBLE_CHUNK_STATUSES:
                chunk.status = "cancelled"
                chunk.updatedAt = now

    def _merge_global_memory(self, memory: BookGlobalMemory, notes: list[str]) -> None:
        buckets: dict[str, list[str]] = {
            "character": memory.characters,
            "characters": memory.characters,
            "location": memory.locations,
            "locations": memory.locations,
            "setting": memory.settings,
            "settings": memory.settings,
            "term": memory.terms,
            "terms": memory.terms,
        }
        for note in notes:
            if ":" not in note:
                continue
            key, value = note.split(":", 1)
            bucket = buckets.get(key.strip().lower())
            item = clip_text(value, 80)
            if bucket is not None and item and item not in bucket:
                bucket.append(item)
                del bucket[80:]

    def _append_event(
        self,
        job: NovelProcessJob,
        event_type: str,
        message: str,
        task_id: str | None = None,
        chunk_id: str | None = None,
        details: dict[str, object] | None = None,
    ) -> None:
        safe_details = {
            key: value
            for key, value in (details or {}).items()
            if isinstance(value, (str, int, float, bool)) or value is None or isinstance(value, list) or isinstance(value, dict)
        }
        job.eventLogs.append(
            JobEventLog(
                eventId=new_id("event"),
                eventType=event_type,
                message=message,
                taskId=task_id,
                chunkId=chunk_id,
                details=safe_details,  # type: ignore[arg-type]
                createdAt=utc_now(),
            )
        )
        if len(job.eventLogs) > RECENT_EVENT_LIMIT:
            job.eventLogs = job.eventLogs[-RECENT_EVENT_LIMIT:]

    def _chunk_from_input(self, item: NovelProcessChunkInput, now: str) -> ChunkRecord:
        chunk_id = item.chunkId or new_id("chunk")
        end_offset = item.endOffset or item.startOffset + len(item.chunkText)
        return ChunkRecord(
            chunkId=chunk_id,
            chapterTitle=item.chapterTitle,
            chapterIndex=item.chapterIndex,
            chunkIndex=item.chunkIndex,
            chunkText=item.chunkText,
            startOffset=item.startOffset,
            endOffset=end_offset,
            previousContextSummary=clip_text(item.previousContextSummary, SUMMARY_LIMIT),
            nextContextHint=clip_text(item.nextContextHint, NEXT_HINT_LIMIT),
            contextChars=len(item.previousContextSummary or "") + len(item.nextContextHint or ""),
            updatedAt=now,
        )

    def _json_mode_selection(self, selection: ProviderSelectionRequest | None) -> ProviderSelectionRequest | None:
        if selection is None:
            return None
        payload = selection.model_dump()
        parameters = dict(payload.get("parameters") or {})
        parameters["structured_mode"] = (
            "json_object" if parameters.get("structured_mode") == "json_object" else "tools"
        )
        parameters["temperature"] = min(float(parameters.get("temperature") or 0.2), 0.2)
        parameters["top_p"] = min(float(parameters.get("top_p") or 0.9), 0.9)
        parameters["thinking_mode"] = False
        payload["parameters"] = ProviderSelectionParameters(**parameters).model_dump(exclude_none=True)
        return ProviderSelectionRequest(**payload)

    def _ensure_runner_unlocked(self, job_id: str) -> None:
        runner = self._runners.get(job_id)
        if runner and runner.is_alive():
            return
        thread = Thread(target=self._run_job, args=(job_id,), name=f"novel-process-{job_id}", daemon=True)
        self._runners[job_id] = thread
        thread.start()

    def _find_task(self, job: NovelProcessJob, task_id: str) -> AgentTask:
        for task in job.agentTasks:
            if task.taskId == task_id:
                return task
        raise KeyError(f"Agent task not found: {task_id}")

    def _find_chunk(self, job: NovelProcessJob, chunk_id: str) -> ChunkRecord:
        for chunk in job.chunks:
            if chunk.chunkId == chunk_id:
                return chunk
        raise KeyError(f"Chunk not found: {chunk_id}")

    def _lock_for(self, job_id: str) -> RLock:
        lock = self._locks.get(job_id)
        if lock is None:
            lock = RLock()
            self._locks[job_id] = lock
        return lock

    def _job_path(self, job_id: str) -> Path:
        return self.storage_dir / f"{job_id}.json"

    def _load_job_unlocked(self, job_id: str) -> NovelProcessJob:
        job = self._jobs.get(job_id)
        if job is not None:
            return job
        if self.repository is not None:
            repo_job = self.repository.load_job(job_id)
            if repo_job is not None:
                self._jobs[job_id] = repo_job
                self._cancel_events.setdefault(job_id, Event())
                return repo_job
        path = self._job_path(job_id)
        if not path.exists():
            raise KeyError(f"Novel process job not found: {job_id}")
        payload = json.loads(path.read_text(encoding="utf-8"))
        job = NovelProcessJob.model_validate(payload)
        self._jobs[job_id] = job
        self._cancel_events.setdefault(job_id, Event())
        return job

    def _save_job_unlocked(self, job: NovelProcessJob) -> None:
        path = self._job_path(job.jobId)
        payload = self._public_job(job).model_dump(mode="json")
        if self.repository is not None:
            self.repository.save_job(job)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _public_job(self, job: NovelProcessJob) -> NovelProcessJob:
        public = job.model_copy(deep=True)
        if public.providerSelection is not None:
            public.providerSelection = public.providerSelection.model_copy(update={"api_key": ""})
        return public

    def _recover_interrupted_job_unlocked(self, job: NovelProcessJob) -> bool:
        if job.status not in {"running", "retrying", "failed_partial"}:
            return False
        runner = self._runners.get(job.jobId)
        if runner and runner.is_alive():
            return False
        changed = False
        now = utc_now()
        completed_ids = {result.chunkId for result in job.chunkResults if result.status == "completed"}
        for chunk in job.chunks:
            if chunk.chunkId in completed_ids and chunk.status != "completed":
                chunk.status = "completed"
                chunk.updatedAt = now
                changed = True
            if chunk.status == "running":
                chunk.status = "retrying"
                chunk.errorMessage = chunk.errorMessage or "Recovered after interrupted backend process."
                chunk.nextAttemptAt = None
                chunk.updatedAt = now
                changed = True
        for task in job.agentTasks:
            if task.status == "running":
                task.status = "retrying"
                task.phase = "recovered"
                task.currentStepLabel = "Recovered after backend restart"
                task.errorMessage = task.errorMessage or "Task was running when the backend stopped."
                task.failureCategory = task.failureCategory or "backend_interrupted"
                task.completedAt = task.completedAt or now
                task.lastHeartbeatAt = task.lastHeartbeatAt or now
                task.leaseExpiresAt = task.leaseExpiresAt or now
                changed = True
        if changed:
            job.status = "retrying"
            job.completedAt = None
            job.updatedAt = now
            self._cancel_events.setdefault(job.jobId, Event()).clear()
            self._append_event(job, "job_recovered", "Recovered unfinished subagent job from persistent storage.")
            self._refresh_progress(job)
        self._ensure_runner_unlocked(job.jobId)
        return changed

    @staticmethod
    def _link_polish_system_prompt() -> str:
        return (
            "You polish visual novel branch/link text. Only improve user-facing Chinese text. "
            "Never change choiceId, targetSceneId, scene_id, choice_id, ordering, or graph structure."
        )

    @staticmethod
    def _link_polish_user_prompt(request: SceneLinkPolishRequest) -> str:
        payload = request.model_dump(exclude={"providerSelection"}, mode="json")
        return (
            "Polish each link between sourceScene and targetScene.\n"
            "For every item return one patch with the same choiceId and targetSceneId.\n"
            "Improve choiceText, choiceDisplayName, targetTitle, targetSummary, and optional openingText.\n"
            "openingText should be a concise first narration/dialog line that naturally continues from the choice.\n"
            f"{json.dumps(payload, ensure_ascii=False)}"
        )

    @staticmethod
    def _fallback_polish_patch(item: SceneLinkPolishItem) -> SceneLinkPolishPatch:
        label = item.choiceDisplayName or item.choiceText
        return SceneLinkPolishPatch(
            choiceId=item.choiceId,
            choiceText=item.choiceText,
            choiceDisplayName=item.choiceDisplayName,
            targetSceneId=item.targetScene.scene_id,
            targetTitle=item.targetScene.title,
            targetSummary=item.targetScene.summary or f"玩家选择“{label}”后的直接后续场景。",
        )

    @staticmethod
    def _sanitize_polish_patch(patch: SceneLinkPolishPatch | None, fallback: SceneLinkPolishPatch) -> SceneLinkPolishPatch:
        if patch is None:
            return fallback
        return SceneLinkPolishPatch(
            choiceId=fallback.choiceId,
            choiceText=clip_text(patch.choiceText or fallback.choiceText, 120),
            choiceDisplayName=clip_text(patch.choiceDisplayName or fallback.choiceDisplayName, 80) or None,
            targetSceneId=fallback.targetSceneId,
            targetTitle=clip_text(patch.targetTitle or fallback.targetTitle, 80),
            targetSummary=clip_text(patch.targetSummary or fallback.targetSummary, 400),
            openingText=clip_text(patch.openingText, 240) or None,
            warnings=patch.warnings,
        )


def wait_for_job(
    service: NovelProcessService,
    job_id: str,
    *,
    timeout_seconds: float = 5.0,
    predicate: Callable[[NovelProcessJob], bool] | None = None,
) -> NovelProcessJob:
    """Small test helper for polling a background job to a desired state."""

    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        job = service.get_job(job_id)
        if predicate is None:
            if job.status in TERMINAL_JOB_STATUSES:
                return job
        elif predicate(job):
            return job
        time.sleep(0.02)
    return service.get_job(job_id)
