"""stdio MCP launcher for AgentVN domain tools.

Run with:
    python agentvn_mcp_server.py
"""

from __future__ import annotations

import json
import sys
from typing import Any

from app.mcp.jsonrpc import handle_mcp_jsonrpc


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload: dict[str, Any] = json.loads(line)
            response = handle_mcp_jsonrpc(payload)
        except Exception as exc:
            response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32603, "message": str(exc)},
            }
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
