"""WebSocket routes for realtime novel AI processing."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.models.novel_import import (
    NovelAiAdaptSceneRequest,
    NovelAiChunkRequest,
    NovelAiOutlineRequest,
    NovelAiPlanChapterRequest,
)
from app.services.novel_import_service import NovelImportService
from app.services.novel_realtime import NovelRealtimeJob, NovelRealtimeSubscriber, novel_realtime_hub
from app.core.error_logging import log_exception
from app.utils.ids import new_id


router = APIRouter()
service = NovelImportService()
logger = logging.getLogger("agentvn.backend.novel_ws")


OperationSpec = tuple[type, str, str]

OPERATIONS: dict[str, OperationSpec] = {
    "scan_chunk": (NovelAiChunkRequest, "scan", "chunk_analyzer"),
    "build_outline": (NovelAiOutlineRequest, "outline", "outline_builder"),
    "plan_chapter": (NovelAiPlanChapterRequest, "planning", "chapter_planner"),
    "adapt_scene": (NovelAiAdaptSceneRequest, "blueprint", "scene_adapter"),
}


def _stream_factory(operation: str, request: object):
    if operation == "scan_chunk":
        return lambda: service.stream_ai_scan_chunk(request)  # type: ignore[arg-type]
    if operation == "build_outline":
        return lambda: service.stream_ai_build_outline(request)  # type: ignore[arg-type]
    if operation == "plan_chapter":
        return lambda: service.stream_ai_plan_chapter(request)  # type: ignore[arg-type]
    if operation == "adapt_scene":
        return lambda: service.stream_ai_adapt_scene(request)  # type: ignore[arg-type]
    raise ValueError(f"Unsupported novel websocket operation: {operation}")


async def _send_event(websocket: WebSocket, event: dict[str, Any]) -> None:
    await websocket.send_json(event)


async def _replay_or_snapshot(websocket: WebSocket, job: NovelRealtimeJob, last_seq: int) -> None:
    events = job.replay_after(last_seq)
    if events is None:
        await _send_event(
            websocket,
            job.next_event(
                "snapshot_required",
                {
                    "message": "Event buffer no longer contains the requested resume point.",
                    "oldestSeq": job.events[0]["seq"] if job.events else 0,
                    "latestSeq": job.seq,
                    "status": job.status,
                },
            ),
        )
        return
    for event in events:
        await _send_event(websocket, event)


async def _pump_subscription(websocket: WebSocket, job: NovelRealtimeJob, queue: asyncio.Queue[dict[str, Any]]) -> None:
    while True:
        event = await queue.get()
        await _send_event(websocket, event)
        if event["type"] in {"final", "error"}:
            # Keep the socket open for late metric/agent_completed events; the client can close when ready.
            continue


@router.websocket("/ws/novel")
async def novel_realtime_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    connection_id = new_id("novel_ws")
    subscribed_job: NovelRealtimeJob | None = None
    subscription: NovelRealtimeSubscriber | None = None
    pump_task: asyncio.Task[None] | None = None
    last_ack = 0
    await websocket.send_json(
        {
            "type": "connected",
            "seq": 0,
            "jobId": None,
            "requestId": connection_id,
            "phase": "connection",
            "agentId": "realtime_hub",
            "timestamp": None,
            "payload": {"connectionId": connection_id, "protocol": "agentvn.novel.ws.v1"},
        }
    )

    def unsubscribe() -> None:
        nonlocal subscribed_job, subscription, pump_task
        if pump_task:
            pump_task.cancel()
            pump_task = None
        if subscribed_job and subscription:
            subscribed_job.unsubscribe(subscription)
        subscribed_job = None
        subscription = None

    async def subscribe(job: NovelRealtimeJob, last_seq: int = 0) -> None:
        nonlocal subscribed_job, subscription, pump_task
        unsubscribe()
        subscribed_job = job
        subscription = job.subscribe()
        await _replay_or_snapshot(websocket, job, last_seq)
        pump_task = asyncio.create_task(_pump_subscription(websocket, job, subscription.queue))

    try:
        while True:
            message = await websocket.receive_json()
            command = str(message.get("command") or message.get("type") or "")
            if command == "ping":
                await websocket.send_json(
                    {
                        "type": "pong",
                        "seq": subscribed_job.seq if subscribed_job else 0,
                        "jobId": subscribed_job.job_id if subscribed_job else None,
                        "requestId": str(message.get("requestId") or connection_id),
                        "phase": subscribed_job.phase if subscribed_job else "connection",
                        "agentId": "realtime_hub",
                        "timestamp": None,
                        "payload": {"ack": last_ack},
                    }
                )
                continue
            if command == "ack":
                last_ack = max(last_ack, int(message.get("seq") or 0))
                continue
            if command == "cancel_job":
                job_id = str(message.get("jobId") or "")
                if not novel_realtime_hub.cancel(job_id):
                    logger.warning(
                        "小说长连接取消任务失败，任务不存在：connection_id=%s job_id=%s",
                        connection_id,
                        job_id,
                    )
                    await websocket.send_json({"type": "error", "seq": 0, "jobId": job_id, "requestId": connection_id, "phase": "connection", "agentId": "realtime_hub", "timestamp": None, "payload": {"message": "Job not found."}})
                continue
            if command in {"subscribe_job", "resume_job"}:
                job_id = str(message.get("jobId") or "")
                job = novel_realtime_hub.get(job_id)
                if not job:
                    logger.warning(
                        "小说长连接订阅任务失败，任务不存在：connection_id=%s job_id=%s",
                        connection_id,
                        job_id,
                    )
                    await websocket.send_json({"type": "error", "seq": 0, "jobId": job_id, "requestId": connection_id, "phase": "connection", "agentId": "realtime_hub", "timestamp": None, "payload": {"message": "Job not found."}})
                    continue
                await subscribe(job, int(message.get("lastSeq") or 0))
                continue
            if command == "start_novel_job":
                operation = str(message.get("operation") or "")
                spec = OPERATIONS.get(operation)
                if not spec:
                    logger.warning(
                        "小说长连接启动失败，不支持该操作：connection_id=%s operation=%s",
                        connection_id,
                        operation,
                    )
                    await websocket.send_json({"type": "error", "seq": 0, "jobId": None, "requestId": connection_id, "phase": "connection", "agentId": "realtime_hub", "timestamp": None, "payload": {"message": f"Unsupported operation: {operation}"}})
                    continue
                model, phase, agent_id = spec
                payload = message.get("payload") or {}
                request = model(**payload)
                job_id = str(message.get("jobId") or new_id("novel_job"))
                request_id = str(message.get("requestId") or job_id)
                job = novel_realtime_hub.start(
                    job_id=job_id,
                    request_id=request_id,
                    operation=operation,
                    phase=phase,
                    agent_id=agent_id,
                    stream_factory=_stream_factory(operation, request),
                )
                await subscribe(job, int(message.get("lastSeq") or 0))
                continue
            logger.warning(
                "小说长连接收到不支持的命令：connection_id=%s command=%s",
                connection_id,
                command,
            )
            await websocket.send_json({"type": "error", "seq": 0, "jobId": None, "requestId": connection_id, "phase": "connection", "agentId": "realtime_hub", "timestamp": None, "payload": {"message": f"Unsupported command: {command}"}})
    except WebSocketDisconnect:
        # error-log-ignore: 用户关闭页面或主动断开长连接属于正常生命周期。
        pass
    except Exception as exc:
        log_exception(
            logger,
            f"小说长连接处理失败：connection_id={connection_id} job_id={subscribed_job.job_id if subscribed_job else ''}",
            exc,
        )
        try:
            await websocket.send_json(
                {
                    "type": "error",
                    "seq": 0,
                    "jobId": subscribed_job.job_id if subscribed_job else None,
                    "requestId": connection_id,
                    "phase": subscribed_job.phase if subscribed_job else "connection",
                    "agentId": "realtime_hub",
                    "timestamp": None,
                    "payload": {"message": "小说处理连接发生错误，请重新连接后重试。"},
                }
            )
        except Exception:
            # error-log-ignore: 连接损坏后无法再回传提示，触发本分支的原始异常已经写入日志。
            pass
    finally:
        unsubscribe()
