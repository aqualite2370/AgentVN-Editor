"""In-memory WebSocket event hub for novel AI streams."""

from __future__ import annotations

import asyncio
import logging
import re
import traceback
from collections import deque
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Event, Lock, Thread
from typing import Any

from pydantic import BaseModel
from app.core.errors import AIProviderError


NovelStreamFactory = Callable[[], Iterator[tuple[str, object]]]
logger = logging.getLogger(__name__)


def _sanitize_error_message(message: str, max_length: int | None = 1200) -> str:
    sanitized = re.sub(r"sk-[A-Za-z0-9_\-]{6,}", "sk-***", message)
    sanitized = re.sub(r"(Bearer\s+)[^\s\"']+", r"\1***", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r'("api_key"\s*:\s*")[^"]+(")', r"\1***\2", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r"([?&](?:api[_-]?key|token)=)[^&\s]+", r"\1***", sanitized, flags=re.IGNORECASE)
    if max_length is not None:
        sanitized = sanitized[:max_length]
    return sanitized or "Novel AI stream failed."


def _jsonable(value: object) -> object:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, tuple):
        return [_jsonable(item) for item in value]
    return value


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _legacy_event_type(event: str) -> str:
    if event == "delta":
        return "message_delta"
    if event == "status":
        return "lifecycle"
    if event == "trace":
        return "tool_event"
    if event == "checkpoint":
        return "checkpoint"
    if event == "final":
        return "final"
    if event == "error":
        return "error"
    return event


@dataclass
class NovelRealtimeSubscriber:
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue[dict[str, Any]]


@dataclass
class NovelRealtimeJob:
    job_id: str
    request_id: str
    phase: str
    agent_id: str
    operation: str
    buffer_limit: int = 600
    seq: int = 0
    status: str = "queued"
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    events: deque[dict[str, Any]] = field(default_factory=deque)
    subscribers: list[NovelRealtimeSubscriber] = field(default_factory=list)
    cancel_requested: Event = field(default_factory=Event)
    lock: Lock = field(default_factory=Lock)

    def next_event(self, event_type: str, payload: object | None = None, **extra: object) -> dict[str, Any]:
        with self.lock:
            self.seq += 1
            event = {
                "type": event_type,
                "seq": self.seq,
                "jobId": self.job_id,
                "requestId": self.request_id,
                "phase": self.phase,
                "agentId": self.agent_id,
                "timestamp": _now(),
                "payload": _jsonable(payload or {}),
                **{key: value for key, value in extra.items() if value is not None},
            }
            self.updated_at = event["timestamp"]
            self.events.append(event)
            while len(self.events) > self.buffer_limit:
                self.events.popleft()
            subscribers = list(self.subscribers)
        for subscriber in subscribers:
            subscriber.loop.call_soon_threadsafe(self._put_for_subscriber, subscriber.queue, event)
        return event

    def _put_for_subscriber(self, queue: asyncio.Queue[dict[str, Any]], event: dict[str, Any]) -> None:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            # error-log-ignore: 慢订阅者的队列背压会进入既定的事件合并流程，不是任务失败。
            self._coalesce_slow_queue(queue, event)

    @staticmethod
    def _coalesce_slow_queue(queue: asyncio.Queue[dict[str, Any]], event: dict[str, Any]) -> None:
        if event["type"] not in {"message_delta", "agent_delta"}:
            try:
                _ = queue.get_nowait()
            except asyncio.QueueEmpty:
                # error-log-ignore: 清理慢订阅队列时队列已空是正常竞态。
                pass
            queue.put_nowait(event)
            return
        merged = str(event.get("payload", {}).get("delta", ""))
        retained: list[dict[str, Any]] = []
        while True:
            try:
                existing = queue.get_nowait()
            except asyncio.QueueEmpty:
                # error-log-ignore: 已读完待合并事件，用空队列作为循环结束条件。
                break
            if existing["type"] in {"message_delta", "agent_delta"}:
                merged = f"{existing.get('payload', {}).get('delta', '')}{merged}"
            else:
                retained.append(existing)
        for existing in retained[-max(0, queue.maxsize - 1):]:
            queue.put_nowait(existing)
        queue.put_nowait({**event, "payload": {**event.get("payload", {}), "delta": merged}})

    def replay_after(self, last_seq: int) -> list[dict[str, Any]] | None:
        with self.lock:
            if not self.events:
                return []
            oldest = self.events[0]["seq"]
            if last_seq and last_seq < oldest - 1:
                return None
            return [event for event in self.events if event["seq"] > last_seq]

    def subscribe(self) -> NovelRealtimeSubscriber:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=120)
        subscriber = NovelRealtimeSubscriber(asyncio.get_running_loop(), queue)
        with self.lock:
            self.subscribers.append(subscriber)
        return subscriber

    def unsubscribe(self, subscriber: NovelRealtimeSubscriber) -> None:
        with self.lock:
            self.subscribers = [item for item in self.subscribers if item is not subscriber]


class NovelRealtimeHub:
    def __init__(self) -> None:
        self._jobs: dict[str, NovelRealtimeJob] = {}
        self._lock = Lock()

    def get(self, job_id: str) -> NovelRealtimeJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if not job:
            return False
        job.cancel_requested.set()
        job.status = "cancelling"
        job.next_event("lifecycle", {"status": "cancelling", "message": "Cancel requested."})
        return True

    def start(
        self,
        *,
        job_id: str,
        request_id: str,
        operation: str,
        phase: str,
        agent_id: str,
        stream_factory: NovelStreamFactory,
    ) -> NovelRealtimeJob:
        job = NovelRealtimeJob(
            job_id=job_id,
            request_id=request_id,
            operation=operation,
            phase=phase,
            agent_id=agent_id,
        )
        with self._lock:
            self._jobs[job_id] = job
        thread = Thread(target=self._run_stream, args=(job, stream_factory), name=f"novel-ws-{job_id}", daemon=True)
        thread.start()
        return job

    def _run_stream(self, job: NovelRealtimeJob, stream_factory: NovelStreamFactory) -> None:
        started_at = datetime.now(UTC)
        try:
            job.status = "running"
            job.next_event("lifecycle", {"status": "running", "operation": job.operation})
            job.next_event("agent_started", {"operation": job.operation})
            final_seen = False
            for legacy_event, payload in stream_factory():
                if job.cancel_requested.is_set():
                    job.status = "cancelled"
                    job.next_event("lifecycle", {"status": "cancelled", "message": "Job cancelled."})
                    job.next_event("agent_completed", {"status": "cancelled"})
                    return
                event_type = _legacy_event_type(legacy_event)
                if event_type == "message_delta":
                    payload = {"delta": str(payload)}
                elif event_type == "lifecycle" and isinstance(payload, str):
                    payload = {"status": "running", "message": payload}
                elif event_type == "final":
                    final_seen = True
                job.next_event(event_type, payload)
            elapsed_ms = int((datetime.now(UTC) - started_at).total_seconds() * 1000)
            job.next_event("metric", {"elapsedMs": elapsed_ms, "finalSeen": final_seen})
            job.status = "completed"
            job.next_event("agent_completed", {"status": "completed", "elapsedMs": elapsed_ms})
        except Exception as exc:
            logger.error(
                "Novel realtime job failed: job_id=%s operation=%s phase=%s\n%s",
                job.job_id,
                job.operation,
                job.phase,
                _sanitize_error_message(traceback.format_exc(), None),
            )
            code = "ai_provider_error" if isinstance(exc, AIProviderError) else "novel_stream_error"
            message = _sanitize_error_message(str(exc))
            error_payload = {
                "code": code,
                "message": message,
                "operation": job.operation,
                "phase": job.phase,
                "exceptionType": type(exc).__name__,
            }
            job.status = "failed"
            job.next_event("error", error_payload)
            job.next_event("agent_completed", {"status": "failed", **error_payload})


novel_realtime_hub = NovelRealtimeHub()
