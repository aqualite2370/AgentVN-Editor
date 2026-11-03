"""Durable FIFO with an OS-owned execution lock, shared by local editor processes.

A lease is diagnostic, not permission to replay an AI request. Recovery is only
possible after the OS releases the old worker's lock, and abandoned work fails
explicitly instead of making another potentially billable model call.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import sqlite3
import time
from typing import Any
from app.services.process_presence import process_is_alive


TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})


@dataclass(frozen=True)
class CreationProcess:
    id: str
    project_id: str
    project_title: str
    conversation_id: str
    status: str
    submitted_at: int
    started_at: int | None
    finished_at: int | None
    worker_id: str | None
    lease_until: int | None
    error_code: str | None
    error_message: str | None
    result: dict[str, Any] | None

    def public(self) -> dict[str, Any]:
        # Never expose worker tokens, request payloads or provider credentials.
        return {
            "id": self.id,
            "projectId": self.project_id,
            "projectTitle": self.project_title,
            "conversationId": self.conversation_id,
            "status": self.status,
            "submittedAt": self.submitted_at,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "errorCode": self.error_code,
            "errorMessage": self.error_message,
        }


class AssistantCreationQueue:
    def __init__(self, conn: sqlite3.Connection, *, lease_seconds: float = 30) -> None:
        self.conn = conn
        self.lease_ms = int(lease_seconds * 1000)
        database_path = conn.execute("PRAGMA database_list").fetchone()[2]
        if not database_path:
            raise ValueError("Creation queue requires a shared on-disk database.")
        self.lock_path = Path(database_path).resolve().with_suffix(".creation-worker.lock")
        self._lock_file = None
        self._active_id: str | None = None
        self._worker_id: str | None = None

    @staticmethod
    def _now() -> int:
        return int(time.time() * 1000)

    @staticmethod
    def _process(row: sqlite3.Row) -> CreationProcess:
        return CreationProcess(
            **{key: row[key] for key in (
                "id", "project_id", "project_title", "conversation_id", "status",
                "submitted_at", "started_at", "finished_at", "worker_id",
                "lease_until", "error_code", "error_message",
            )},
            result=json.loads(row["result_json"]) if row["result_json"] else None,
        )

    def enqueue(
        self, *, process_id: str, project_id: str, project_title: str,
        conversation_id: str, payload: dict[str, Any],
    ) -> CreationProcess:
        # Payloads are prepared by the typed API; explicit secrets cannot enter it.
        def reject_credentials(value: Any) -> None:
            if isinstance(value, dict):
                for key, child in value.items():
                    if key.lower() in {"api_key", "authorization", "password", "token", "secret"}:
                        raise ValueError("Credentials must not be persisted in creation tasks.")
                    reject_credentials(child)
            elif isinstance(value, list):
                for child in value:
                    reject_credentials(child)
        reject_credentials(payload)
        with self.conn:
            self.conn.execute(
                """INSERT INTO assistant_creation_processes
                   (id, project_id, project_title, conversation_id, status, submitted_at, lease_until, payload_json)
                   VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)""",
                (process_id, project_id, project_title, conversation_id, self._now(), self._now() + self.lease_ms,
                 json.dumps(payload, ensure_ascii=False)),
            )
        return self.get_process(process_id)

    def list_processes(self) -> list[CreationProcess]:
        # Always include active tasks; history is bounded without deleting evidence.
        rows = self.conn.execute(
            """SELECT * FROM assistant_creation_processes WHERE
               status IN ('queued', 'running', 'cancelling') OR sequence IN (
                   SELECT sequence FROM assistant_creation_processes
                   WHERE status IN ('completed', 'failed', 'cancelled')
                   ORDER BY sequence DESC LIMIT 100
               ) ORDER BY sequence"""
        ).fetchall()
        return [self._process(row) for row in rows]

    def get_process(self, process_id: str) -> CreationProcess:
        row = self.conn.execute(
            "SELECT * FROM assistant_creation_processes WHERE id = ?", (process_id,),
        ).fetchone()
        if row is None:
            raise KeyError(process_id)
        return self._process(row)

    def _try_execution_lock(self) -> bool:
        if self._lock_file is not None:
            return False
        # A one-byte lock works across independently launched Windows backends.
        handle = self.lock_path.open("a+b")
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self._lock_file = handle
        return True

    def _release_execution_lock(self) -> None:
        handle, self._lock_file = self._lock_file, None
        self._active_id = None
        self._worker_id = None
        if handle is not None:
            # Closing the descriptor releases its lock, including on process exit.
            handle.close()

    def _recover_expired_queued(self) -> None:
        # A long request blocks the runner's queued heartbeat. Do not discard
        # that owner's queued tasks merely because the preceding request ended.
        rows = self.conn.execute(
            "SELECT id, payload_json FROM assistant_creation_processes WHERE status = 'queued' AND lease_until < ?",
            (self._now(),),
        ).fetchall()
        for row in rows:
            try:
                pid = json.loads(row["payload_json"]).get("_creation_owner_pid")
            except (ValueError, AttributeError):
                pid = None
            if type(pid) is int and pid > 0 and process_is_alive(pid):
                continue
            self.conn.execute(
                """UPDATE assistant_creation_processes SET status = 'failed', finished_at = ?,
                   payload_json = '{}', error_code = 'worker_lost',
                   error_message = '排队任务所属后端已停止；未重复调用模型，请重新提交。'
                   WHERE id = ? AND status = 'queued'""", (self._now(), row["id"]),
            )

    def claim_next(self, worker_id: str, *, eligible_ids: set[str] | None = None) -> CreationProcess | None:
        if not self._try_execution_lock():
            return None
        claimed = False
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            # Holding the OS lock proves any old running worker no longer owns it.
            self.conn.execute(
                """UPDATE assistant_creation_processes SET
                   status = CASE WHEN status = 'cancelling' THEN 'cancelled' ELSE 'failed' END,
                   finished_at = ?, lease_until = NULL, payload_json = '{}',
                   error_code = 'worker_lost',
                   error_message = '创造执行进程已停止；未自动重复模型调用，请重新提交。'
                   WHERE status IN ('running', 'cancelling')""",
                (self._now(),),
            )
            self._recover_expired_queued()
            row = self.conn.execute(
                "SELECT id FROM assistant_creation_processes WHERE status = 'queued' ORDER BY sequence LIMIT 1"
            ).fetchone()
            if row is None or (eligible_ids is not None and row["id"] not in eligible_ids):
                self.conn.commit()
                return None
            self._active_id, self._worker_id = row["id"], worker_id
            now = self._now()
            self.conn.execute(
                """UPDATE assistant_creation_processes SET
                   status = 'running', worker_id = ?, started_at = ?, lease_until = ? WHERE id = ?""",
                (worker_id, now, now + self.lease_ms, self._active_id),
            )
            self.conn.commit()
            claimed = True
            return self.get_process(self._active_id)
        except Exception:
            self.conn.rollback()
            raise
        finally:
            if not claimed:
                self._release_execution_lock()

    def recover_abandoned(self) -> None:
        """Read-side crash recovery, never starts or repeats a provider request.

        A stale timestamp is not evidence of a dead worker. Only acquisition of
        the same OS execution lock permits finalizing abandoned running rows.
        """
        if not self._try_execution_lock():
            return
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            self.conn.execute(
                """UPDATE assistant_creation_processes SET
                   status = CASE WHEN status = 'cancelling' THEN 'cancelled' ELSE 'failed' END,
                   finished_at = ?, lease_until = NULL, payload_json = '{}',
                   error_code = 'worker_lost',
                   error_message = '创造执行进程已停止；未自动重复模型调用，请重新提交。'
                   WHERE status IN ('running', 'cancelling')""", (self._now(),),
            )
            self._recover_expired_queued()
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        finally:
            self._release_execution_lock()

    def request_cancel(self, process_id: str) -> str:
        with self.conn:
            self.conn.execute(
                """UPDATE assistant_creation_processes SET
                   status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE 'cancelling' END,
                   finished_at = CASE WHEN status = 'queued' THEN ? ELSE finished_at END,
                   payload_json = CASE WHEN status = 'queued' THEN '{}' ELSE payload_json END
                   WHERE id = ? AND status IN ('queued', 'running')""",
                (self._now(), process_id),
            )
        return self.get_process(process_id).status

    def heartbeat(self, process_id: str, worker_id: str) -> bool:
        with self.conn:
            cursor = self.conn.execute(
                """UPDATE assistant_creation_processes SET lease_until = ?
                   WHERE id = ? AND (
                       (worker_id = ? AND status IN ('running', 'cancelling'))
                       OR (worker_id IS NULL AND status = 'queued')
                   )""",
                (self._now() + self.lease_ms, process_id, worker_id),
            )
        return cursor.rowcount == 1

    def payload(self, process_id: str) -> dict[str, Any]:
        row = self.conn.execute(
            "SELECT payload_json FROM assistant_creation_processes WHERE id = ?", (process_id,),
        ).fetchone()
        if row is None:
            raise KeyError(process_id)
        return json.loads(row["payload_json"])

    def complete(self, process_id: str, worker_id: str, result: dict[str, Any]) -> str:
        return self._finish(process_id, worker_id, "completed", result=result)

    def fail(self, process_id: str, worker_id: str, code: str, message: str) -> str:
        return self._finish(process_id, worker_id, "failed", code=code, message=message)

    def _finish(
        self, process_id: str, worker_id: str, status: str, *,
        result: dict[str, Any] | None = None, code: str | None = None, message: str | None = None,
    ) -> str:
        if self._active_id != process_id or self._worker_id != worker_id or self._lock_file is None:
            raise ValueError("Creation result does not own the execution lock.")
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            process = self.get_process(process_id)
            if process.worker_id != worker_id or process.status not in {"running", "cancelling"}:
                raise ValueError("Creation result has a stale lease.")
            final_status = "cancelled" if process.status == "cancelling" else status
            self.conn.execute(
                """UPDATE assistant_creation_processes SET status = ?, finished_at = ?,
                   lease_until = NULL, payload_json = '{}', result_json = ?,
                   error_code = ?, error_message = ? WHERE id = ? AND worker_id = ?""",
                (final_status, self._now(),
                 json.dumps(result, ensure_ascii=False) if final_status == "completed" else None,
                 code, message, process_id, worker_id),
            )
            self.conn.commit()
            return final_status
        except Exception:
            self.conn.rollback()
            raise
        finally:
            self._release_execution_lock()

    def close(self) -> None:
        self._release_execution_lock()
        self.conn.close()

    def public_process(self, process_id: str) -> dict[str, Any]:
        process = self.get_process(process_id)
        public = process.public()
        if process.status == "completed" and process.result is not None:
            public["result"] = process.result
        return public
