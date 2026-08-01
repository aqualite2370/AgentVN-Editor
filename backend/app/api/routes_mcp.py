"""HTTP JSON-RPC MCP endpoint for AgentVN domain tools."""

from typing import Any

from fastapi import APIRouter

from app.mcp.jsonrpc import handle_mcp_jsonrpc

router = APIRouter()


@router.post("/mcp")
def agentvn_mcp_rpc(payload: dict[str, Any]) -> dict[str, object] | None:
    """Expose AgentVN tools with MCP-compatible JSON-RPC method names."""
    return handle_mcp_jsonrpc(payload)
