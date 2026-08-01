"""Shared JSON-RPC handlers for AgentVN MCP transports."""

import logging
from typing import Any

from app.core.errors import AgentVNError
from app.mcp.tools import agentvn_tool_registry

logger = logging.getLogger("agentvn.backend.mcp")


def _result(request_id: object, result: object) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: object, code: int, message: str) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def handle_mcp_jsonrpc(payload: dict[str, Any]) -> dict[str, object] | None:
    """Handle MCP-compatible JSON-RPC requests for the built-in AgentVN tools."""

    request_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params") or {}

    if method == "notifications/initialized":
        return None

    if method == "initialize":
        return _result(
            request_id,
            {
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": "agentvn-backend", "version": "0.1.0"},
                "capabilities": {"tools": {}},
            },
        )

    if method == "ping":
        return _result(request_id, {})

    if method == "tools/list":
        return _result(request_id, {"tools": agentvn_tool_registry.list_tools()})

    if method == "tools/call":
        name = str(params.get("name") or "")
        arguments = params.get("arguments") or {}
        try:
            value = agentvn_tool_registry.call_tool(name, arguments)
        except AgentVNError as exc:
            logger.warning("模型工具调用失败：tool=%s request_id=%s error=%s", name, request_id, exc)
            return _result(
                request_id,
                {
                    "isError": True,
                    "content": [{"type": "text", "text": str(exc)}],
                },
            )
        return _result(
            request_id,
            {
                "isError": False,
                "structuredContent": value.model_dump(mode="json"),
                "content": [{"type": "text", "text": value.model_dump_json()}],
            },
        )

    return _error(request_id, -32601, f"Unsupported MCP method: {method}")
