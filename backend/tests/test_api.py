import json
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.deps import get_project_state_service
from app.core.errors import AIProviderError
from app.db.init_db import init_db
from app.main import create_app
from app.services import project_state_service
from app.services.project_state_service import ProjectStateService


def project_state_service_override(tmp_path: Path):
    db_path = tmp_path / "project_state.db"

    async def override():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        init_db(conn)
        try:
            yield ProjectStateService(conn)
        finally:
            conn.close()

    return override


def test_health() -> None:
    client = TestClient(create_app())
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_project_asset_route_preserves_local_editor_cors(tmp_path: Path, monkeypatch) -> None:
    asset = tmp_path / "asset.png"
    asset.write_bytes(b"asset-bytes")

    monkeypatch.setattr(ProjectStateService, "resolve_asset_file", lambda self, _path: asset)
    app = create_app()
    app.dependency_overrides[get_project_state_service] = project_state_service_override(tmp_path)
    client = TestClient(app)

    response = client.get(
        "/api/project/assets/project/sprite/asset.png",
        headers={"Origin": "http://127.0.0.1:6767"},
    )

    assert response.status_code == 200
    assert response.content == b"asset-bytes"
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:6767"


def test_project_state_routes_read_and_write(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(project_state_service, "LEGACY_PROJECT_STATE_FILE", tmp_path / "missing_legacy_state.json")
    app = create_app()
    app.dependency_overrides[get_project_state_service] = project_state_service_override(tmp_path)
    client = TestClient(app)

    initial = client.get("/api/project/state")
    assert initial.status_code == 200
    assert initial.json()["ok"] is True
    assert initial.json()["data"]["project_graph"]["nodes"] == []

    payload = {
        "project_graph": {
            "nodes": [{"id": "start"}],
            "edges": [],
            "viewport": {"x": 1, "y": 2, "zoom": 1},
            "memoryMode": "hybrid",
        },
        "project_metadata": {"title": "State test"},
    }
    saved = client.post("/api/project/state", json=payload)
    assert saved.status_code == 200
    assert saved.json()["data"]["project_graph"]["nodes"] == [{"id": "start"}]
    assert saved.json()["data"]["project_metadata"] == {"title": "State test"}

    loaded = client.get("/api/project/state")
    assert loaded.status_code == 200
    assert loaded.json()["data"]["project_graph"]["nodes"] == [{"id": "start"}]


def test_project_catalog_and_detail_routes(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(project_state_service, "LEGACY_PROJECT_STATE_FILE", tmp_path / "missing_legacy_state.json")
    app = create_app()
    app.dependency_overrides[get_project_state_service] = project_state_service_override(tmp_path)
    client = TestClient(app)
    project = {
        "schema_version": "1.0.0",
        "project_id": "route_project",
        "title": "Route Project",
        "author": "API QA",
        "nodes": [{"id": "start", "data": {"nodeKind": "start"}}],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "memory_mode": "hybrid",
        "asset_manifest": [],
        "editor_settings": {"detail": "loaded on demand"},
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-02T00:00:00.000Z",
    }

    saved = client.put("/api/project/projects/route_project", json=project)
    assert saved.status_code == 200
    assert saved.json()["data"]["editor_settings"] == {"detail": "loaded on demand"}

    catalog = client.get("/api/project/catalog")
    assert catalog.status_code == 200
    assert catalog.json()["data"] == [
        {
            "project_id": "route_project",
            "title": "Route Project",
            "author": "API QA",
            "created_at": "2026-01-01T00:00:00.000Z",
            "updated_at": "2026-01-02T00:00:00.000Z",
            "node_count": 1,
            "edge_count": 0,
            "schema_version": "1.0.0",
            "has_detail": True,
        }
    ]

    detail = client.get("/api/project/projects/route_project")
    assert detail.status_code == 200
    assert detail.json()["data"]["nodes"] == project["nodes"]


def test_project_api_round_trip_preserves_structured_camera_motion(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(project_state_service, "LEGACY_PROJECT_STATE_FILE", tmp_path / "missing_legacy_state.json")
    app = create_app()
    app.dependency_overrides[get_project_state_service] = project_state_service_override(tmp_path)
    client = TestClient(app)
    motion = {
        "schema_version": 1,
        "kind": "reframe",
        "to": {"center_x": 0.58, "center_y": 0.44, "zoom": 1.6},
        "duration_ms": 1400,
        "easing": "cubic-bezier(0.22, 1, 0.36, 1)",
    }
    project = {
        "schema_version": "1.1.0",
        "project_id": "camera_round_trip",
        "title": "Camera Round Trip",
        "author": "API QA",
        "nodes": [
            {"id": "start", "data": {"nodeKind": "start"}},
            {
                "id": "scene-camera",
                "data": {
                    "nodeKind": "scene",
                    "scene": {
                        "scene_id": "scene_camera",
                        "commands": [{"type": "camera", "motion": motion, "blocking": True}],
                    },
                },
            },
        ],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "memory_mode": "hybrid",
        "asset_manifest": [],
        "editor_settings": {},
        "created_at": "2026-07-27T00:00:00.000Z",
        "updated_at": "2026-07-27T00:00:00.000Z",
    }

    saved = client.put("/api/project/projects/camera_round_trip", json=project)
    assert saved.status_code == 200
    loaded = client.get("/api/project/projects/camera_round_trip")
    assert loaded.status_code == 200
    command = loaded.json()["data"]["nodes"][1]["data"]["scene"]["commands"][0]
    assert command == {"type": "camera", "motion": motion, "blocking": True}

    sequence_motion = {
        "schema_version": 1,
        "kind": "sequence",
        "shots": [
            {
                "to": {"center_x": 0.5, "center_y": 0.5, "zoom": 1.2},
                "duration_ms": 500,
                "easing": "linear",
            },
            {
                "to": {"center_x": 0.58, "center_y": 0.44, "zoom": 1.6},
                "duration_ms": 1400,
                "easing": "cubic-bezier(0.22, 1, 0.36, 1)",
            },
        ],
    }
    project["project_id"] = "camera_sequence_round_trip"
    project["nodes"][1]["data"]["scene"]["commands"] = [
        {"type": "camera", "motion": sequence_motion, "blocking": True}
    ]
    saved_sequence = client.put("/api/project/projects/camera_sequence_round_trip", json=project)
    assert saved_sequence.status_code == 200
    loaded_sequence = client.get("/api/project/projects/camera_sequence_round_trip")
    assert loaded_sequence.status_code == 200
    sequence_command = loaded_sequence.json()["data"]["nodes"][1]["data"]["scene"]["commands"][0]
    assert sequence_command == {"type": "camera", "motion": sequence_motion, "blocking": True}


def test_project_state_route_can_skip_project_payload(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(project_state_service, "LEGACY_PROJECT_STATE_FILE", tmp_path / "missing_legacy_state.json")
    app = create_app()
    app.dependency_overrides[get_project_state_service] = project_state_service_override(tmp_path)
    client = TestClient(app)

    saved = client.post(
        "/api/project/state",
        json={
            "recent_projects": [
                {
                    "project_id": "recent_route_project",
                    "title": "Recent Route Project",
                    "author": "",
                    "nodes": [{"id": "start"}],
                    "edges": [],
                }
            ],
            "provider_secrets": {"conn": "secret"},
        },
    )
    assert saved.status_code == 200

    loaded = client.get("/api/project/state?include_project=false&include_recent_projects=false")
    assert loaded.status_code == 200
    payload = loaded.json()["data"]
    assert payload["recent_projects"] == []
    assert payload["project_graph"]["nodes"] == []
    assert payload["provider_secrets"] == {"conn": "secret"}


def test_ai_provider_error_is_structured_json_with_cors() -> None:
    app = create_app()

    @app.get("/probe-ai-error")
    def probe_ai_error() -> None:
        raise AIProviderError("provider rejected token sk-secret1234567890")

    client = TestClient(app)
    response = client.get("/probe-ai-error", headers={"Origin": "http://127.0.0.1:6767"})

    assert response.status_code == 502
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:6767"
    assert response.json() == {
        "code": "ai_provider_error",
        "message": "provider rejected token sk-***",
    }


def test_ai_provider_error_inside_exception_group_is_structured_json_with_cors() -> None:
    app = create_app()

    @app.get("/probe-ai-error-group")
    def probe_ai_error_group() -> None:
        raise ExceptionGroup("task group failed", [AIProviderError("provider rejected token sk-groupsecret123456")])

    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/probe-ai-error-group", headers={"Origin": "http://127.0.0.1:6767"})

    assert response.status_code == 502
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:6767"
    assert response.json() == {
        "code": "ai_provider_error",
        "message": "provider rejected token sk-***",
    }


def test_ai_provider_failed_attempts_are_summarized() -> None:
    app = create_app()

    @app.get("/probe-ai-failed-attempts")
    def probe_ai_failed_attempts() -> None:
        raise AIProviderError(
            """
<failed_attempts>
<generation number="1"><exception>Error code: 502</exception></generation>
</failed_attempts>
<last_exception>Error code: 502</last_exception>
""".strip()
        )

    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/probe-ai-failed-attempts", headers={"Origin": "http://127.0.0.1:6767"})

    assert response.status_code == 502
    payload = response.json()
    assert payload["code"] == "ai_provider_error"
    assert "Error code: 502" in payload["message"]


def test_unexpected_error_is_structured_json_with_cors() -> None:
    app = create_app()

    @app.get("/probe-unexpected-error")
    def probe_unexpected_error() -> None:
        raise RuntimeError("boom")

    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/probe-unexpected-error", headers={"Origin": "http://127.0.0.1:6767"})

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:6767"
    assert response.json() == {
        "code": "internal_error",
        "message": "后端服务异常，请查看后端日志。",
    }


def test_mcp_tools_list_and_call() -> None:
    client = TestClient(create_app())

    listed = client.post("/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert listed.status_code == 200
    tool_names = {tool["name"] for tool in listed.json()["result"]["tools"]}
    assert {"create_scene_beat", "extract_memory_update"}.issubset(tool_names)
    scene_tool = next(tool for tool in listed.json()["result"]["tools"] if tool["name"] == "create_scene_beat")
    assert '"show_image"' in json.dumps(scene_tool["inputSchema"])

    called = client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "create_scene_beat",
                "arguments": {
                    "scene_id": "scene_mcp",
                    "title": "MCP 场景",
                    "summary": "通过 MCP 工具校验。",
                    "chapter": 1,
                    "commands": [
                        {
                            "type": "show_image",
                            "image_id": "clue_photo",
                            "caption": "钥匙背面刻着旧宿舍编号。",
                        }
                    ],
                    "tags": [],
                },
            },
        },
    )

    assert called.status_code == 200
    payload = called.json()["result"]
    assert payload["isError"] is False
    assert payload["structuredContent"]["scene_id"] == "scene_mcp"
    assert payload["structuredContent"]["commands"][0]["type"] == "show_image"
