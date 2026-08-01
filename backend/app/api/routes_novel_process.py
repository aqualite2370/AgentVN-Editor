"""Concurrent novel process job routes."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.ai.context_budget import estimate_tokens
from app.models.novel_process import (
    AgentTask,
    JobEventLog,
    NovelProcessJob,
    NovelProcessJobCreateRequest,
    NovelProcessJobResults,
    SceneLinkPolishRequest,
    SceneLinkPolishResponse,
)
from app.core.config import get_settings
from app.services.novel_process_service import NovelProcessJobRepository, NovelProcessService


router = APIRouter()
service = NovelProcessService(repository=NovelProcessJobRepository(get_settings().resolved_database_path))
PHASE_LABELS = {
    "chunk_parse": "切片解析",
    "chapter_merge": "章节合并",
    "continuity_review": "连续性复核",
    "import_write": "写入蓝图",
    "validation": "结构校验",
}
PHASE_ORDER = ["chunk_parse", "chapter_merge", "continuity_review", "import_write", "validation"]
STALE_AGENT_SECONDS = 90


def _not_found(exc: KeyError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


@router.post("/novel/process/jobs", response_model=NovelProcessJob)
def create_novel_process_job(request: NovelProcessJobCreateRequest) -> NovelProcessJob:
    return service.create_job(request)


@router.get("/novel/process/jobs/{job_id}", response_model=NovelProcessJob)
def get_novel_process_job(job_id: str) -> NovelProcessJob:
    try:
        return service.get_job(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/novel/process/jobs/{job_id}/pause", response_model=NovelProcessJob)
def pause_novel_process_job(job_id: str) -> NovelProcessJob:
    try:
        return service.pause_job(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/novel/process/jobs/{job_id}/resume", response_model=NovelProcessJob)
def resume_novel_process_job(job_id: str) -> NovelProcessJob:
    try:
        return service.resume_job(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/novel/process/jobs/{job_id}/cancel", response_model=NovelProcessJob)
def cancel_novel_process_job(job_id: str) -> NovelProcessJob:
    try:
        return service.cancel_job(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/novel/process/jobs/{job_id}/rerun_failed", response_model=NovelProcessJob)
def rerun_failed_novel_process_chunks(job_id: str) -> NovelProcessJob:
    try:
        return service.rerun_failed(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get("/novel/process/jobs/{job_id}/results", response_model=NovelProcessJobResults)
def get_novel_process_job_results(job_id: str) -> NovelProcessJobResults:
    try:
        return service.get_results(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/novel/process/link_polish", response_model=SceneLinkPolishResponse)
def polish_novel_process_scene_links(request: SceneLinkPolishRequest) -> SceneLinkPolishResponse:
    return service.polish_scene_links(request)


@router.get("/novel/process_jobs/{job_id}")
def get_novel_process_job_panel_snapshot(job_id: str) -> dict[str, object]:
    try:
        return _panel_job(service.get_job(job_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get("/novel/process_jobs/{job_id}/events")
def get_novel_process_job_panel_events(job_id: str, limit: int = 50) -> list[dict[str, object]]:
    try:
        job = service.get_job(job_id)
    except KeyError as exc:
        raise _not_found(exc) from exc
    events = [_panel_event(job, event) for event in job.eventLogs]
    return list(reversed(events))[: max(0, min(limit, 200))]


@router.post("/novel/process_jobs/{job_id}/pause")
def pause_novel_process_job_panel(job_id: str) -> dict[str, object]:
    try:
        return _panel_job(service.pause_job(job_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/novel/process_jobs/{job_id}/resume")
def resume_novel_process_job_panel(job_id: str) -> dict[str, object]:
    try:
        return _panel_job(service.resume_job(job_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/novel/process_jobs/{job_id}/cancel")
def cancel_novel_process_job_panel(job_id: str) -> dict[str, object]:
    try:
        return _panel_job(service.cancel_job(job_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.post("/novel/process_jobs/{job_id}/retry_failed_chunks")
def retry_failed_novel_process_chunks_panel(job_id: str) -> dict[str, object]:
    try:
        return _panel_job(service.rerun_failed(job_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


def _panel_status(status: str) -> str:
    if status == "created":
        return "waiting"
    return status


def _panel_event_type(event_type: str) -> str:
    mapping = {
        "agent_task_started": "agent_started",
        "agent_task_partial": "agent_output_updated",
        "agent_task_completed": "agent_completed",
        "agent_task_failed": "agent_failed",
        "agent_task_cancelled": "agent_failed",
        "agent_task_retrying": "job_retry",
        "job_failed_partial": "job_completed",
        "chapter_merge_completed": "result_merged",
        "continuity_review_completed": "result_merged",
    }
    return mapping.get(event_type, event_type)


def _panel_event_level(event_type: str) -> str:
    if "failed" in event_type:
        return "error"
    if "warning" in event_type:
        return "warning"
    if "retry" in event_type or "cancel" in event_type or "pause" in event_type:
        return "warning"
    if "completed" in event_type or "merged" in event_type:
        return "success"
    return "info"


def _panel_event(job: NovelProcessJob, event: JobEventLog) -> dict[str, object]:
    return {
        "eventId": event.eventId,
        "jobId": job.jobId,
        "type": _panel_event_type(event.eventType),
        "level": _panel_event_level(event.eventType),
        "createdAt": event.createdAt,
        "title": event.eventType,
        "message": event.message,
        "agentTaskId": event.taskId,
        "chunkId": event.chunkId,
        "payload": event.details,
    }


def _task_progress(task: AgentTask | None) -> int:
    if task is None:
        return 0
    if task.status in {"completed", "failed", "cancelled"}:
        return 100
    if task.status == "retrying":
        return 15
    if task.status == "waiting":
        return 0
    phase = (task.phase or "").lower()
    if phase == "assigned":
        return 10
    if phase == "chunk_parse":
        return 25
    if phase == "status":
        return 30
    if phase == "streaming":
        return max(40, min(90, 40 + task.partialChars // 300))
    return 25


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        # error-log-ignore: 任务时间字段是可选统计信息，旧记录格式不兼容时不参与耗时计算。
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _milliseconds_between(start: str | None, end: str | None = None) -> int:
    parsed_start = _parse_time(start)
    if parsed_start is None:
        return 0
    parsed_end = _parse_time(end) or datetime.now(timezone.utc)
    return max(0, int((parsed_end - parsed_start).total_seconds() * 1000))


def _task_progress_basis(task: AgentTask | None) -> str:
    if task is None:
        return "idle"
    if task.status in {"completed", "failed", "cancelled"}:
        return f"terminal:{task.status}"
    if task.status == "retrying":
        return "retry_backoff"
    if task.status == "waiting":
        return "queued"
    if task.phase == "streaming":
        return "streaming_partial_chars"
    return f"phase:{task.phase or task.status}"


def _task_stale_reason(task: AgentTask | None) -> str | None:
    if task is None or task.status not in {"running", "retrying"}:
        return None
    heartbeat = _parse_time(task.lastHeartbeatAt or task.startedAt)
    if heartbeat is None:
        return "没有心跳时间。"
    age_seconds = (datetime.now(timezone.utc) - heartbeat).total_seconds()
    if age_seconds > STALE_AGENT_SECONDS:
        return f"超过 {STALE_AGENT_SECONDS} 秒没有新的模型状态或输出。"
    return None


def _phase_progress(job: NovelProcessJob, finished: int) -> list[dict[str, object]]:
    chunk_percent = round((finished / max(1, job.totalChunks)) * 100)
    merge_done = any(event.eventType == "chapter_merge_completed" for event in job.eventLogs)
    review_done = any(event.eventType == "continuity_review_completed" for event in job.eventLogs)
    imported = job.status in {"completed", "failed_partial", "cancelled"}
    failed = job.status in {"failed", "failed_partial"}
    validation_done = imported and not failed
    status_by_phase = {
        "chunk_parse": "completed" if chunk_percent >= 100 else ("running" if job.status in {"running", "retrying"} else job.status),
        "chapter_merge": "completed" if merge_done else ("running" if job.activePhase == "chapter_merge" else "waiting"),
        "continuity_review": "completed" if review_done else ("running" if job.activePhase == "continuity_review" else "waiting"),
        "import_write": "completed" if imported else "waiting",
        "validation": "completed" if validation_done else ("blocked" if failed else "waiting"),
    }
    percent_by_phase = {
        "chunk_parse": chunk_percent,
        "chapter_merge": 100 if merge_done else 0,
        "continuity_review": 100 if review_done else 0,
        "import_write": 100 if imported else 0,
        "validation": 100 if validation_done else 0,
    }
    blocking_by_phase = {
        "chunk_parse": next((chunk.errorMessage for chunk in job.chunks if chunk.errorMessage), None),
        "chapter_merge": None if merge_done or chunk_percent >= 100 else "等待全部可用切片完成。",
        "continuity_review": None if review_done or merge_done else "等待章节合并完成。",
        "import_write": "存在失败切片，写入前需要重跑或接受风险。" if failed else None,
        "validation": "存在失败切片或质量阻断项。" if failed else None,
    }
    started_at = job.startedAt or job.createdAt
    updated_at = job.updatedAt
    average_ms = 0
    completed_tasks = [task for task in job.agentTasks if task.status == "completed" and task.startedAt and task.completedAt]
    if completed_tasks:
        average_ms = round(sum(_milliseconds_between(task.startedAt, task.completedAt) for task in completed_tasks) / len(completed_tasks))
    remaining_chunks = max(0, job.totalChunks - finished)
    eta_ms = round((remaining_chunks * average_ms) / max(1, job.maxConcurrency)) if average_ms else None
    rows: list[dict[str, object]] = []
    for phase in PHASE_ORDER:
        rows.append({
            "phase": phase,
            "label": PHASE_LABELS[phase],
            "status": status_by_phase[phase],
            "current": finished if phase == "chunk_parse" else (1 if percent_by_phase[phase] >= 100 else 0),
            "total": job.totalChunks if phase == "chunk_parse" else 1,
            "percent": percent_by_phase[phase],
            "startedAt": started_at if phase == "chunk_parse" else None,
            "updatedAt": updated_at,
            "etaMs": eta_ms if phase == "chunk_parse" and percent_by_phase[phase] < 100 else None,
            "blockingReason": blocking_by_phase[phase],
        })
    return rows


def _quality_dimensions(job: NovelProcessJob) -> list[dict[str, object]]:
    completed_results = [result for result in job.chunkResults if result.status == "completed"]
    scene_results = [result for result in completed_results if result.sceneCount > 0 and not result.usedFallbackScene]
    issue_count = sum(len(result.qualityIssues) or len(result.qualityWarnings) for result in job.chunkResults)
    blocked_issue_count = sum(
        1
        for result in job.chunkResults
        for issue in result.qualityIssues
        if issue.severity == "blocked"
    )
    total = max(1, job.totalChunks)
    dimensions = [
        ("source_coverage", "原文覆盖", round((job.completedChunks / total) * 100), job.completedChunks, total),
        ("structured_scenes", "结构化场景", round((len(scene_results) / max(1, len(completed_results) or job.completedChunks)) * 100), len(scene_results), max(1, len(completed_results) or job.completedChunks)),
        ("continuity", "连续性", 100 if any(event.eventType == "continuity_review_completed" for event in job.eventLogs) and issue_count == 0 else max(30, 100 - issue_count * 12), max(0, issue_count), 0),
        ("low_quality_text", "低质文本风险", 100 if blocked_issue_count == 0 else 0, blocked_issue_count, 0),
        ("asset_readiness", "素材就绪", 100, 1, 1),
    ]
    rows = []
    for key, label, score, current, target in dimensions:
        bounded = max(0, min(100, score))
        rows.append({
            "key": key,
            "label": label,
            "score": bounded,
            "status": "good" if bounded >= 85 else "warning" if bounded >= 60 else "danger",
            "value": f"{current}/{target}" if target else str(current),
        })
    return rows


def _quality_issues(job: NovelProcessJob) -> list[dict[str, object]]:
    rows = []
    for result in job.chunkResults:
        for issue in result.qualityIssues:
            rows.append(issue.model_dump(mode="json"))
        if not result.qualityIssues:
            for warning in result.qualityWarnings:
                rows.append({
                    "code": "legacy_quality_warning",
                    "severity": "warning",
                    "message": warning,
                    "evidence": result.chunkId,
                    "action": "查看对应切片输出并决定是否重跑。",
                    "sourceChunkId": result.chunkId,
                })
    return rows[:80]


def _panel_job(job: NovelProcessJob) -> dict[str, object]:
    finished = job.completedChunks + job.failedChunks + job.cancelledChunks
    selected_chapter_count = len({chunk.chapterIndex for chunk in job.chunks}) or len(job.chapterResults)
    estimated_tokens = sum(max(1, estimate_tokens(chunk.chunkText)) for chunk in job.chunks)
    agent_rows = []
    tasks_by_agent: dict[int, list[AgentTask]] = {}
    for task in job.agentTasks:
        tasks_by_agent.setdefault(task.agentIndex, []).append(task)
    chunks_by_id = {chunk.chunkId: chunk for chunk in job.chunks}
    result_by_chunk = {result.chunkId: result for result in job.chunkResults}
    queued_chunk_ids = [
        chunk.chunkId
        for chunk in sorted(job.chunks, key=lambda item: (item.chapterIndex, item.chunkIndex))
        if chunk.status in {"pending", "waiting", "retrying"}
    ]
    for index in range(max(1, job.maxConcurrency)):
        agent_tasks = sorted(tasks_by_agent.get(index, []), key=lambda item: item.startedAt or "")
        task = next((item for item in reversed(agent_tasks) if item.status == "running"), agent_tasks[-1] if agent_tasks else None)
        elapsed_ms = 0
        if task and task.startedAt:
            from datetime import datetime, timezone

            start = datetime.fromisoformat(task.startedAt)
            end = datetime.fromisoformat(task.completedAt) if task.completedAt else datetime.now(timezone.utc)
            elapsed_ms = max(0, int((end - start).total_seconds() * 1000))
        current_chunk = chunks_by_id.get(task.chunkId) if task else None
        current_result = result_by_chunk.get(task.chunkId) if task else None
        completed_agent_chunks = [item for item in agent_tasks if item.status == "completed"]
        failed_agent_chunks = [item for item in agent_tasks if item.status == "failed"]
        task_events = [event for event in job.eventLogs if task and event.taskId == task.taskId][-5:]
        progress_basis = _task_progress_basis(task)
        queue_position = queued_chunk_ids.index(task.chunkId) + 1 if task and task.chunkId in queued_chunk_ids else None
        stale_reason = _task_stale_reason(task)
        completed_durations = [
            _milliseconds_between(item.startedAt, item.completedAt)
            for item in agent_tasks
            if item.status == "completed" and item.startedAt and item.completedAt
        ]
        avg_duration = round(sum(completed_durations) / len(completed_durations)) if completed_durations else 0
        remaining_agent_chunks = max(0, len(agent_tasks) - len(completed_agent_chunks) - len(failed_agent_chunks))
        agent_rows.append({
            "agentTaskId": task.taskId if task else f"agent_idle_{job.jobId}_{index}",
            "agentIndex": index,
            "agentRole": task.agentRole if task else "chunk_parser",
            "attemptId": task.attemptId if task else None,
            "runAttempt": task.runAttempt if task else 0,
            "status": _panel_status(task.status) if task else "waiting",
            "phase": task.phase if task else "idle",
            "currentChunkId": task.chunkId if task else None,
            "currentChapterTitle": task.chapterTitle if task else "Waiting for assignment",
            "currentChunkIndex": task.chunkIndex + 1 if task else max(1, len(completed_agent_chunks)),
            "currentChunkTotal": max(1, len([chunk for chunk in job.chunks if task and chunk.chapterIndex == task.chapterIndex]) or len(agent_tasks) or 1),
            "inputTokens": sum(item.inputTokens for item in agent_tasks),
            "outputTokens": sum(item.outputTokens for item in agent_tasks),
            "totalTokens": sum(item.totalTokens for item in agent_tasks),
            "tokenSource": task.tokenSource if task else job.tokenSource,
            "elapsedMs": elapsed_ms,
            "retryCount": sum(item.retryCount for item in agent_tasks),
            "completedTaskCount": len(completed_agent_chunks),
            "failedTaskCount": len(failed_agent_chunks),
            "outputPreview": (task.resultPreview or task.partialResult or task.errorMessage or "") if task else "No chunk assigned yet.",
            "progressPercent": _task_progress(task),
            "progressBasis": progress_basis,
            "queuePosition": queue_position,
            "estimatedRemainingMs": avg_duration * remaining_agent_chunks if avg_duration else None,
            "lastMeaningfulEventAt": (task.lastHeartbeatAt or task.completedAt or task.startedAt) if task else job.updatedAt,
            "staleReason": stale_reason,
            "heartbeatAt": (task.lastHeartbeatAt or task.completedAt or task.startedAt) if task else job.updatedAt,
            "lastHeartbeatAt": (task.lastHeartbeatAt or task.completedAt or task.startedAt) if task else job.updatedAt,
            "leaseExpiresAt": task.leaseExpiresAt if task else None,
            "cancelRequestedAt": task.cancelRequestedAt if task else None,
            "assignedChunkIds": [item.chunkId for item in agent_tasks],
            "currentStepLabel": task.currentStepLabel if task else "Waiting for scheduler",
            "partialPreview": (task.partialResult or task.resultPreview or "") if task else "",
            "assignmentReason": task.assignmentReason if task else f"Agent {index + 1} is idle and waiting for queued chunks.",
            "inputChunkChars": task.inputChunkChars if task else 0,
            "contextChars": task.contextChars if task else (current_chunk.contextChars if current_chunk else 0),
            "schemaRepairCount": task.schemaRepairCount if task else 0,
            "failureCategory": task.failureCategory if task else None,
            "retryBackoffMs": task.retryBackoffMs if task else 0,
            "sceneCount": current_result.sceneCount if current_result else 0,
            "usedFallbackScene": current_result.usedFallbackScene if current_result else False,
            "qualityWarnings": current_result.qualityWarnings if current_result else [],
            "qualityIssues": [issue.model_dump(mode="json") for issue in current_result.qualityIssues] if current_result else [],
            "mergeStatus": current_result.mergeStatus if current_result else "pending",
            "chunkStartOffset": current_chunk.startOffset if current_chunk else None,
            "chunkEndOffset": current_chunk.endOffset if current_chunk else None,
            "currentChunkExcerpt": (current_chunk.chunkText[:220] if current_chunk else ""),
            "previousContextSummary": (current_chunk.previousContextSummary if current_chunk else ""),
            "nextContextHint": (current_chunk.nextContextHint if current_chunk else ""),
            "taskStartedAt": task.startedAt if task else None,
            "taskCompletedAt": task.completedAt if task else None,
            "recentEvents": [_panel_event(job, event) for event in task_events],
        })
    by_agent = [
        {
            "id": f"agent_{index}",
            "label": f"Agent {index + 1}",
            "inputTokens": sum(task.inputTokens for task in tasks),
            "outputTokens": sum(task.outputTokens for task in tasks),
            "totalTokens": sum(task.totalTokens for task in tasks),
            "estimatedTokens": sum(task.totalTokens for task in tasks),
            "retryExtraTokens": sum(max(0, task.retryCount) * max(1, task.totalTokens) for task in tasks),
            "chunkCount": len(tasks),
        }
        for index, tasks in ((index, tasks_by_agent.get(index, [])) for index in range(max(1, job.maxConcurrency)))
    ]
    by_chapter = [
        {
            "id": f"chapter_{chapter.chapterIndex}",
            "label": chapter.chapterTitle or f"Chapter {chapter.chapterIndex + 1}",
            "inputTokens": chapter.tokens.inputTokens,
            "outputTokens": chapter.tokens.outputTokens,
            "totalTokens": chapter.tokens.totalTokens,
            "estimatedTokens": chapter.tokens.totalTokens,
            "retryExtraTokens": 0,
            "chunkCount": chapter.completedChunks + chapter.failedChunks + chapter.cancelledChunks,
        }
        for chapter in job.chapterResults
    ]
    return {
        "jobId": job.jobId,
        "bookId": job.bookId,
        "novelTitle": job.title or job.bookId,
        "status": _panel_status(job.status),
        "selectedChapterCount": selected_chapter_count,
        "totalChunks": job.totalChunks,
        "completedChunks": job.completedChunks,
        "failedChunks": job.failedChunks,
        "cancelledChunks": job.cancelledChunks,
        "runningAgentCount": job.runningTasks,
        "estimatedRemainingChunks": max(0, job.totalChunks - finished),
        "maxConcurrency": job.maxConcurrency,
        "queueDepth": len([chunk for chunk in job.chunks if chunk.status in {"pending", "waiting", "retrying"}]),
        "activePhase": job.activePhase,
        "phaseProgress": _phase_progress(job, finished),
        "progressPercent": round((finished / max(1, job.totalChunks)) * 100),
        "qualityDimensions": _quality_dimensions(job),
        "qualityIssues": _quality_issues(job),
        "tokenStats": {
            "totalInputTokens": job.actualInputTokens,
            "totalOutputTokens": job.actualOutputTokens,
            "totalTokens": job.actualTotalTokens,
            "estimatedTokens": estimated_tokens,
            "actualTokens": job.actualTotalTokens,
            "averageChunkTokens": round(job.actualTotalTokens / max(1, job.completedChunks)),
            "retryExtraTokens": sum(max(0, task.retryCount) * max(1, task.totalTokens) for task in job.agentTasks),
            "byAgent": by_agent,
            "byChapter": by_chapter,
        },
        "agents": agent_rows,
        "chapters": [
            {
                "chapterId": f"chapter_{chapter.chapterIndex}",
                "chapterIndex": chapter.chapterIndex,
                "title": chapter.chapterTitle or f"Chapter {chapter.chapterIndex + 1}",
                "totalChunks": len([chunk for chunk in job.chunks if chunk.chapterIndex == chapter.chapterIndex]),
                "completedChunks": chapter.completedChunks,
                "failedChunks": chapter.failedChunks,
                "inputTokens": chapter.tokens.inputTokens,
                "outputTokens": chapter.tokens.outputTokens,
                "estimatedTokens": chapter.tokens.totalTokens,
            }
            for chapter in job.chapterResults
        ],
        "source": "api",
        "createdAt": job.createdAt,
        "updatedAt": job.updatedAt,
        "completedAt": job.completedAt,
        "failureReason": next((chunk.errorMessage for chunk in job.chunks if chunk.errorMessage), None),
    }
