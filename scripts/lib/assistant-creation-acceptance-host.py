"""Owned isolated production API with a controlled external HTTP model.

No browser API mocks, real keys or user databases. stdin EOF requests cleanup.
"""
import json
import os
from pathlib import Path
import socket
import sys
from threading import Thread
import time

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "backend"))

database = Path(sys.argv[1]).resolve()
database.parent.mkdir(parents=True, exist_ok=True)
os.environ["AGENTVN_BACKEND_LOG"] = str(database.parent / "backend-errors.log")
# Some production dependencies call get_app_settings directly rather than using
# FastAPI's dependency override. Bind those callers before importing the app.
os.environ["DATABASE_PATH"] = str(database)
os.environ["AGENTVN_BACKEND_DATA_DIR"] = str(database.parent)
os.environ["AGENTVN_EDITOR_DATA_DIR"] = str(database.parent)
os.environ["AGENTVN_LEGACY_DATABASE_PATHS"] = ""

import uvicorn
from app.ai.provider import AIProvider
from app.api.deps import get_ai_provider, get_app_settings
from app.core.config import Settings
from app.main import create_app
from controlled_assistant_model import model_endpoint, agent_endpoint
assert get_app_settings().resolved_database_path == database, "Every production dependency must use the owned database"

proposal = {"edits": [{
    "target_id": "target-1", "screen_id": "title", "label": "进入故事",
    "rect": {"x": 44, "y": 66, "width": 18, "height": 9},
}]}
if os.environ.get("AGENTVN_CREATION_PROPOSAL_REPORT"):
    from app.models.assistant_creation import AssistantComponentDraftBatch
    with Path(os.environ["AGENTVN_CREATION_PROPOSAL_REPORT"]).open(encoding="utf-8") as source:
        recorded = json.load(source)["process"]["result"]
    proposal = AssistantComponentDraftBatch.model_validate(recorded).model_dump(exclude_none=True)

if os.environ.get("AGENTVN_CREATION_AGENT_TEST") == "1":
    batch_size = int(os.environ.get("AGENTVN_CREATION_AGENT_BATCH_SIZE", "1"))
    tool_page = os.environ.get("AGENTVN_CREATION_AGENT_PAGE", "title")
    if tool_page not in {"title", "game_menu", "preferences", "save_load", "history", "about", "help", "gallery", "player"}:
        raise ValueError("Invalid controlled agent page")
    proposal = {"components": [{"name": "Agent工具徽章", "description": "隔离工程授权组件",
        "html": '<div class="root"><img class="icon" data-asset="project-asset-1" aria-label="Agent徽章"/></div>',
        "css": ".root { display: flex; padding: 4px; } .icon { width: 24px; height: 24px; }", "screen_id": tool_page}], "edits": []}
    endpoint = agent_endpoint([("read_assistant_context", {}), ("build_assistant_draft", proposal),
        ("validate_assistant_draft", {}), ("preview_assistant_draft", {}), ("read_assistant_draft", {}),
        ("submit_assistant_component_draft", proposal)], batch_size=batch_size)
else:
    endpoint = model_endpoint(proposal)

with endpoint as (model_url, requests):
    settings = Settings(
        _env_file=None, DATABASE_PATH=str(database), LLM_API_KEY="test-only-secret",
        LLM_BASE_URL=model_url, LLM_MODEL="controlled-model",
        EMBEDDING_API_KEY="test-only-secret", EMBEDDING_BASE_URL=model_url,
    )
    provider = AIProvider(settings)
    app = create_app()
    app.dependency_overrides[get_app_settings] = lambda: settings
    app.dependency_overrides[get_ai_provider] = lambda: provider
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    api_url = f"http://127.0.0.1:{sock.getsockname()[1]}"
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False))
    thread = Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 20
        while not server.started:
            if not thread.is_alive() or time.monotonic() > deadline:
                raise RuntimeError("Isolated creation API failed readiness")
            time.sleep(0.02)
        print("AGENTVN_CREATION_HOST_READY " + json.dumps({
            "pid": os.getpid(), "apiUrl": api_url, "modelUrl": model_url,
            "database": str(database), "globalDatabase": str(get_app_settings().resolved_database_path),
            "mode": "production-api-controlled-external-model",
        }), flush=True)
        sys.stdin.readline()
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()
        print("AGENTVN_CREATION_HOST_CLEANUP " + json.dumps({
            "modelRequestCount": len(requests), "apiStopped": not thread.is_alive(),
            "tools": sorted({tool["function"]["name"] for request in requests
                             for tool in request.get("body", request).get("tools", [])}),
            # Only new receipts trailing the last assistant call batch, rather
            # than the complete repeated conversation or only its final tool.
            "localToolResults": [json.loads(message["content"]) for request in requests
                for message in request.get("body", request).get("messages", [])[
                    1 + max((index for index, item in enumerate(request.get("body", request).get("messages", []))
                             if item.get("role") == "assistant"), default=-1):]
                if message.get("role") == "tool"],
            "requestToolCounts": [sum(message.get("role") == "tool"
                for message in request.get("body", request).get("messages", [])) for request in requests],
        }), flush=True)
        if thread.is_alive():
            raise RuntimeError("Isolated creation API did not stop")
