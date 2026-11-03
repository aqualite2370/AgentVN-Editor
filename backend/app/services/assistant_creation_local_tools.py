"""Durable, task-owned rendezvous for shared Editor validation/Runtime results."""
import json
import time
from uuid import uuid4
from pydantic import Field
from app.models.common import StrictBaseModel
from typing import Literal
from app.core.errors import AIProviderError


class PreviewDiagnostic(StrictBaseModel):
    screen: Literal["title", "player", "game_menu", "save_load", "preferences", "history", "gallery", "about", "help"]
    width: int = Field(ge=1, le=7680)
    height: int = Field(ge=1, le=4320)
    components: int = Field(ge=0, le=1000)
    images: int = Field(ge=0, le=4096)
    missing_images: int = Field(ge=0, le=4096)
    overflow: bool
    clipped: bool


class LocalToolResult(StrictBaseModel):
    ok: bool
    status: Literal["validated", "rendered", "invalid", "unavailable", "error"]
    issues: list[str] = Field(default_factory=list, max_length=16)
    component_count: int = Field(default=0, ge=0, le=16)
    preview: list[PreviewDiagnostic] = Field(default_factory=list, max_length=16)


def event(conn, process_id, tool, status):
    with conn:
        conn.execute("INSERT INTO assistant_creation_tool_events (process_id,tool,status,time) VALUES (?,?,?,?)",
            (process_id, tool, status, int(time.time() * 1000)))


def public_tools(conn, process_id, *, include_request=True):
    rows = conn.execute("SELECT tool,status,time FROM assistant_creation_tool_events WHERE process_id=? ORDER BY sequence",
        (process_id,)).fetchall()
    output = {"toolEvents": [dict(row) for row in rows]}
    if include_request:
        row = conn.execute("""SELECT local.* FROM assistant_creation_local_tools local
            JOIN assistant_creation_processes process ON process.id=local.process_id
            WHERE local.process_id=? AND local.status='pending' AND process.status='running'
            ORDER BY local.created_at DESC LIMIT 1""",
            (process_id,)).fetchone()
        if row:
            output["localToolRequest"] = {"id": row["id"], "action": row["action"],
                "draft": json.loads(row["draft_json"]), "createdAt": row["created_at"]}
    return output


def wait_local_tool(queue, process_id, action, draft, *, timeout_seconds=40):
    request_id = uuid4().hex
    with queue.conn:
        queue.conn.execute("INSERT INTO assistant_creation_local_tools (id,process_id,action,status,draft_json,created_at) VALUES (?,?,?,'pending',?,?)",
            (request_id, process_id, action, draft.model_dump_json(exclude_none=True), int(time.time() * 1000)))
    deadline = time.monotonic() + timeout_seconds
    try:
        while time.monotonic() < deadline:
            process = queue.get_process(process_id)
            if process.status != "running": raise AIProviderError("创造任务已取消；本机工具停止等待。")
            row = queue.conn.execute("SELECT status,result_json FROM assistant_creation_local_tools WHERE id=?", (request_id,)).fetchone()
            if row["status"] == "completed": return json.loads(row["result_json"])
            queue.heartbeat(process_id, process.worker_id)
            time.sleep(0.05)
        return {"ok": False, "status": "unavailable", "issues": ["本机编辑器校验/Runtime预览没有在期限内完成。"]}
    finally:
        with queue.conn:
            queue.conn.execute("UPDATE assistant_creation_local_tools SET status=CASE WHEN status='pending' THEN 'expired' ELSE status END,draft_json='{}' WHERE id=?",
                (request_id,))


def accept_local_result(conn, process_id, payload):
    # Only bounded diagnostics; no arbitrary response data goes back to the model.
    if set(payload) != {"request_id", "project_id", "conversation_id", "result"}: raise ValueError("Invalid result envelope")
    result = LocalToolResult.model_validate(payload["result"])
    if any(len(issue) > 300 for issue in result.issues) or len(json.dumps(result.model_dump())) > 10000:
        raise ValueError("Diagnostics too large")
    conn.execute("BEGIN IMMEDIATE")
    try:
        process = conn.execute("SELECT * FROM assistant_creation_processes WHERE id=?", (process_id,)).fetchone()
        row = conn.execute("SELECT * FROM assistant_creation_local_tools WHERE id=? AND process_id=?", (payload["request_id"], process_id)).fetchone()
        if (not process or not row or process["status"] != "running" or row["status"] != "pending"
            or payload["project_id"] != process["project_id"] or payload["conversation_id"] != process["conversation_id"]):
            raise LookupError("Stale local result")
        if result.ok and result.status != ("validated" if row["action"] == "validate_assistant_draft" else "rendered"):
            raise ValueError("Inconsistent success status")
        conn.execute("UPDATE assistant_creation_local_tools SET status='completed',result_json=? WHERE id=?",
            (result.model_dump_json(), row["id"]))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
