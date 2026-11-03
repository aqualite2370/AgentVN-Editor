"""Credential boundaries exercised with synthetic keys, never user settings."""

import json
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_project_state_service
from app.api import deps
from app.core.config import Settings
from app.db.init_db import init_db
from app.main import create_app
from app.models.novel_import import NovelAiOutlineMainline, NovelAiOutlineRequest
from app.services.novel_import_service import NovelImportService
from app.services.project_state_service import ProjectStateService


SENTINEL = "qa-credential-boundary-only-not-a-real-token"


def test_credential_channel_with_real_sqlite_dependency(tmp_path, monkeypatch):
    # Do not disable SQLite's production thread check as the service fixture does.
    settings = Settings(DATABASE_PATH=str(tmp_path / "real-dependency.sqlite"), _env_file=None)
    monkeypatch.setattr(deps, "get_app_settings", lambda: settings)
    with TestClient(create_app()) as client:
        saved = client.post("/api/project/state", json={"provider_secrets": {"qa": SENTINEL}})
        assert saved.status_code == 200 and SENTINEL not in saved.text
        restored = client.get("/api/providers/secrets")
        assert restored.status_code == 200
        assert restored.json()["data"] == {"qa": SENTINEL}
        assert "no-store" in restored.headers["cache-control"]


@pytest.fixture
def boundary_client(tmp_path):
    conn = sqlite3.connect(tmp_path / "isolated.sqlite", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    init_db(conn)
    service = ProjectStateService(conn, asset_root=tmp_path / "assets")
    service.save_state({"provider_secrets": {"qa_connection": SENTINEL}})
    app = create_app()
    app.dependency_overrides[get_project_state_service] = lambda: service
    with TestClient(app) as client:
        yield client, service
    conn.close()


@pytest.mark.parametrize("query", ["", "?include_project=false&include_recent_projects=false"])
def test_public_state_never_returns_saved_credentials(boundary_client, query):
    client, service = boundary_client
    response = client.get(f"/api/project/state{query}")
    assert response.status_code == 200
    assert SENTINEL not in response.text
    assert response.json()["data"]["provider_secrets"] == {}
    assert "no-store" in response.headers.get("cache-control", "")
    # Public reads must not erase persisted credentials.
    assert service.load_state()["provider_secrets"] == {"qa_connection": SENTINEL}


def test_state_write_does_not_echo_credentials_or_erase_on_unrelated_save(boundary_client):
    client, service = boundary_client
    response = client.post("/api/project/state", json={
        "provider_secrets": {"qa_connection": SENTINEL},
        "provider_selections": {"text_generation": "qa_model"},
    })
    assert response.status_code == 200
    assert SENTINEL not in response.text
    assert "no-store" in response.headers.get("cache-control", "")
    response = client.post("/api/project/state", json={"project_metadata": {"title": "测试"}})
    assert response.status_code == 200
    assert SENTINEL not in response.text
    assert service.load_state()["provider_secrets"] == {"qa_connection": SENTINEL}


def test_explicit_credential_channel_restores_updates_and_clears_keys(boundary_client):
    client, _service = boundary_client
    response = client.get("/api/providers/secrets")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "data": {"qa_connection": SENTINEL}}
    assert "no-store" in response.headers.get("cache-control", "")
    assert response.headers.get("pragma") == "no-cache"
    client.post("/api/project/state", json={"provider_secrets": {}})
    assert client.get("/api/providers/secrets").json()["data"] == {}


def test_state_read_failure_returns_no_exception_contents(boundary_client, monkeypatch, caplog):
    client, service = boundary_client
    def fail(**_kwargs):
        raise RuntimeError(f"read failed with {SENTINEL}")
    monkeypatch.setattr(service, "load_state", fail)
    response = client.get("/api/project/state")
    assert response.status_code == 200
    assert SENTINEL not in response.text
    assert response.json()["data"]["provider_secrets"] == {}
    assert "no-store" in response.headers.get("cache-control", "")
    assert SENTINEL not in caplog.text


@pytest.mark.parametrize("path", ["/api/providers/missing", "/api/project/projects/missing"])
def test_api_error_responses_cannot_be_cached(boundary_client, path):
    client, _service = boundary_client
    response = client.get(path)
    assert response.status_code == 404
    assert "no-store" in response.headers.get("cache-control", "")


@pytest.mark.parametrize("method", [
    "_outline_mainline_user_prompt",
    "_outline_structure_user_prompt",
    "_outline_index_user_prompt",
    "_outline_user_prompt",
])
def test_outline_prompts_only_serialize_story_fields(method):
    request = NovelAiOutlineRequest(
        document_id="document_安全测试", title="保留剧情数据", total_chars=100,
        analyses=[], allow_branch_suggestions=True,
        provider_selection={
            "connection_id": "qa_connection", "model_id": "qa_model",
            "base_url": "https://not-used.invalid/v1", "api_key": SENTINEL,
            "parameters": {"system_prompt": "AUTH-CONFIG-MUST-NOT-BECOME-STORY"},
        },
    )
    mainline = NovelAiOutlineMainline(
        document_id=request.document_id, title=request.title,
        summary="故事摘要保留", main_plot="原有主线保留",
    )
    request.partial_mainline = mainline
    original = request.model_dump_json()
    build_prompt = getattr(NovelImportService, method)
    prompt = (build_prompt(request, mainline) if method in {
        "_outline_structure_user_prompt", "_outline_index_user_prompt",
    } else build_prompt(request))
    assert SENTINEL not in prompt
    assert "provider_selection" not in prompt
    assert "AUTH-CONFIG-MUST-NOT-BECOME-STORY" not in prompt
    assert "not-used.invalid" not in prompt
    assert request.title in prompt and request.document_id in prompt
    assert "原有主线保留" in prompt
    assert '"allow_branch_suggestions":true' in prompt
    assert request.model_dump_json() == original
    assert json.loads(original)["provider_selection"]["api_key"] == SENTINEL


@pytest.mark.parametrize("streaming", [False, True])
def test_real_outline_http_transport_keeps_auth_out_of_model_messages(boundary_client, streaming):
    """Actual OpenAI transport to a loopback-only synthetic provider."""
    client, _service = boundary_client
    received = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append({
                "path": self.path,
                "authenticated": self.headers.get("Authorization") == "Bearer " + SENTINEL,
                "credential_in_body": SENTINEL in json.dumps(data),
                "provider_config_in_messages": "provider_selection" in json.dumps(data["messages"]),
            })
            prompt = data["messages"][-1]["content"]
            if "summary 是全书短摘要" in prompt:
                result = {"document_id": "http-boundary", "title": "两章来源",
                          "summary": "两章摘要", "main_plot": "连续主线"}
            elif "章节结构和冲突提示" in prompt:
                result = {"chapters": [
                    {"chapter_id": "ch1", "title": "第一章", "index": 0,
                     "start_offset": 0, "end_offset": 50, "summary": "前半"},
                    {"chapter_id": "ch2", "title": "第二章", "index": 1,
                     "start_offset": 50, "end_offset": 100, "summary": "后半"},
                ]}
            else:
                result = {"characters": [], "locations": ["车站"]}
            content = json.dumps(result, ensure_ascii=False)
            if data.get("stream"):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                chunk = {"id": "synthetic", "object": "chat.completion.chunk", "created": 1,
                         "model": "qa-model", "choices": [{"index": 0,
                         "delta": {"content": content}, "finish_reason": None}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                chunk["choices"] = [{"index": 0, "delta": {}, "finish_reason": "stop"}]
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode())
            else:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"id": "synthetic", "object": "chat.completion",
                    "created": 1, "model": "qa-model", "choices": [{"index": 0,
                    "finish_reason": "stop", "message": {"role": "assistant", "content": content}}]
                }).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        response = client.post("/api/novel/import/ai_build_outline" + ("_stream" if streaming else ""), json={
            "document_id": "http-boundary", "title": "两章来源", "total_chars": 100,
            "analyses": [], "provider_selection": {
                "connection_id": "qa_connection", "model_id": "qa-model",
                "base_url": f"http://127.0.0.1:{server.server_port}/v1", "api_key": SENTINEL,
                "parameters": {"structured_mode": "json_object"},
            },
        })
        assert response.status_code == 200
        assert SENTINEL not in response.text
        assert "no-store" in response.headers.get("cache-control", "")
        assert len(received) == 3, "No hidden retry or extra model request"
        assert all(item == {
            "path": "/v1/chat/completions", "authenticated": True,
            "credential_in_body": False, "provider_config_in_messages": False,
        } for item in received)
        if streaming:
            events = [line[6:] for line in response.text.splitlines() if line.startswith("data: ")]
            assert any(isinstance(value, dict) and value.get("chapters")
                       for value in map(json.loads, events))
            assert json.loads(events[-1]) == {"ok": True}
        else:
            assert [chapter["chapter_id"] for chapter in response.json()["chapters"]] == ["ch1", "ch2"]
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)
        assert not worker.is_alive()
