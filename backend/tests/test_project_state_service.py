import json
import sqlite3
from pathlib import Path

from app.db.init_db import init_db
from app.services import project_state_service as service_module
from app.services.project_state_service import ProjectStateService


def build_service(asset_root: Path | None = None) -> ProjectStateService:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    return ProjectStateService(conn, asset_root=asset_root)


def test_project_state_service_saves_structured_state() -> None:
    service = build_service()

    state = service.save_state(
        {
            "project_graph": {
                "nodes": [{"id": "start"}],
                "edges": [],
                "viewport": {"x": 10, "y": 20, "zoom": 1.2},
                "memoryMode": "hybrid",
            },
            "provider_connections": [{"connection_id": "conn_1"}],
            "provider_models": [{"provider_id": "provider_1"}],
            "provider_selections": {"text_generation": "provider_1"},
            "provider_secrets": {"conn_1": "sk-test"},
        }
    )

    assert state["project_graph"]["nodes"] == [{"id": "start"}]
    assert state["provider_connections"] == [{"connection_id": "conn_1"}]
    assert state["provider_models"] == [{"provider_id": "provider_1"}]
    assert state["provider_selections"] == {"text_generation": "provider_1"}
    assert state["provider_secrets"] == {"conn_1": "sk-test"}


def test_project_state_service_preserves_more_than_ten_recent_projects() -> None:
    service = build_service()
    projects = [
        {
            "project_id": f"project_{index:02d}",
            "title": f"Project {index:02d}",
            "author": "Retention QA",
            "nodes": [],
            "edges": [],
            "updated_at": f"2026-01-01T00:{index:02d}:00.000Z",
        }
        for index in range(12)
    ]

    state = service.save_state({"recent_projects": projects})

    assert len(state["recent_projects"]) == 12
    assert [project["project_id"] for project in state["recent_projects"]] == [f"project_{index:02d}" for index in range(12)]


def test_project_catalog_and_detail_are_split_from_recent_projects() -> None:
    service = build_service()
    projects = [
        {
            "project_id": "large_project",
            "title": "Large Project",
            "author": "Catalog QA",
            "nodes": [{"id": "start", "data": {"nodeKind": "start"}}],
            "edges": [{"id": "edge_1"}],
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "memory_mode": "hybrid",
            "asset_manifest": [],
            "editor_settings": {"novelPersistence": {"jobs": ["full detail only"]}},
            "created_at": "2026-01-01T00:00:00.000Z",
            "updated_at": "2026-01-02T00:00:00.000Z",
            "schema_version": "1.0.0",
        }
    ]

    service.save_state({"recent_projects": projects})

    catalog = service.load_catalog()
    assert catalog == [
        {
            "project_id": "large_project",
            "title": "Large Project",
            "author": "Catalog QA",
            "created_at": "2026-01-01T00:00:00.000Z",
            "updated_at": "2026-01-02T00:00:00.000Z",
            "node_count": 1,
            "edge_count": 1,
            "schema_version": "1.0.0",
            "has_detail": True,
        }
    ]
    detail = service.load_project("large_project")
    assert detail is not None
    assert detail["editor_settings"]["novelPersistence"] == {"jobs": ["full detail only"]}


def test_project_state_can_skip_huge_legacy_recent_projects() -> None:
    service = build_service()
    huge_invalid_recent_projects = "[" + ("x" * 256)
    service.conn.execute(
        "INSERT INTO editor_shared_state (key, value) VALUES (?, ?)",
        ("recent_projects", huge_invalid_recent_projects),
    )
    service.conn.commit()

    state = service.load_state(include_project=False, include_recent_projects=False)

    assert state["recent_projects"] == []
    assert state["project_graph"]["nodes"] == []


def test_catalog_does_not_parse_oversized_legacy_recent_projects(monkeypatch) -> None:
    service = build_service()
    huge_legacy_recent_projects = json.dumps([
        {
            "project_id": "too_large_to_migrate_on_startup",
            "title": "Too Large",
            "author": "",
            "nodes": [],
            "edges": [],
        }
    ])
    service.conn.execute(
        "INSERT INTO editor_shared_state (key, value) VALUES (?, ?)",
        ("recent_projects", huge_legacy_recent_projects),
    )
    service.conn.commit()
    monkeypatch.setattr(service_module, "LEGACY_CATALOG_MIGRATION_MAX_CHARS", 8)

    assert service.load_catalog() == []


def test_catalog_recovers_summary_from_huge_legacy_current_project(monkeypatch) -> None:
    service = build_service()
    graph = {
        "nodes": [{"id": "start"}, {"id": "scene_1"}],
        "edges": [{"id": "edge_1"}],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "memoryMode": "hybrid",
    }
    metadata = {
        "projectId": "legacy_big_project",
        "title": "Legacy Big Project",
        "author": "Catalog Recovery",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-02T00:00:00.000Z",
        "schemaVersion": "1.0.0",
        "settings": {"large": "x" * 256},
    }
    recent_projects = [
        {
            "schema_version": "1.0.0",
            "project_id": "legacy_big_project",
            "title": "Legacy Big Project",
            "author": "Catalog Recovery",
            "nodes": graph["nodes"],
            "edges": graph["edges"],
            "editor_settings": {"detail": "y" * 256},
        }
    ]
    service.conn.executemany(
        "INSERT INTO editor_shared_state (key, value) VALUES (?, ?)",
        [
            ("project_graph", json.dumps(graph)),
            ("project_metadata", json.dumps(metadata)),
            ("recent_projects", json.dumps(recent_projects)),
        ],
    )
    service.conn.commit()
    monkeypatch.setattr(service_module, "LEGACY_CATALOG_MIGRATION_MAX_CHARS", 8)

    assert service.load_catalog() == [
        {
            "project_id": "legacy_big_project",
            "title": "Legacy Big Project",
            "author": "Catalog Recovery",
            "created_at": "2026-01-01T00:00:00.000Z",
            "updated_at": "2026-01-02T00:00:00.000Z",
            "node_count": 2,
            "edge_count": 1,
            "schema_version": "1.0.0",
            "has_detail": False,
        }
    ]
    assert service.conn.execute("SELECT count(*) AS n FROM editor_project_details").fetchone()["n"] == 0

    detail = service.load_project("legacy_big_project")
    assert detail is not None
    assert detail["title"] == "Legacy Big Project"
    assert detail["editor_settings"] == {"detail": "y" * 256}
    assert service.conn.execute("SELECT count(*) AS n FROM editor_project_details").fetchone()["n"] == 1


def test_project_state_service_externalizes_embedded_asset_payloads(tmp_path: Path) -> None:
    service = build_service(tmp_path / "project_assets")
    data_url = "data:image/png;base64,aGVsbG8="

    state = service.save_state(
        {
            "project_metadata": {
                "projectId": "project_with_assets",
                "assetManifest": [
                    {
                        "asset_id": "hero_portrait",
                        "asset_type": "portrait",
                        "metadata": {
                            "filename": "hero.png",
                            "data_url": data_url,
                            "blob_url": data_url,
                        },
                    }
                ],
            }
        }
    )

    metadata = state["project_metadata"]["assetManifest"][0]["metadata"]
    assert "data_url" not in metadata
    assert "blob_url" not in metadata
    assert metadata["mime_type"] == "image/png"
    assert metadata["size_bytes"] == 5
    assert metadata["url"].startswith("http://127.0.0.1:8278/api/project/assets/")
    assert Path(metadata["filePath"]).read_bytes() == b"hello"
    assert service.resolve_asset_file(metadata["backend_asset_path"]) == Path(metadata["filePath"])

    stored = service.conn.execute("SELECT value FROM editor_shared_state WHERE key = ?", ("project_metadata",)).fetchone()["value"]
    assert "data:" not in stored


def test_project_asset_resolution_falls_back_to_detail_file_path(tmp_path: Path) -> None:
    service = build_service(tmp_path / "missing_project_assets")
    legacy_asset = tmp_path / "legacy" / "project" / "background" / "asset-old.png"
    legacy_asset.parent.mkdir(parents=True)
    legacy_asset.write_bytes(b"legacy")
    service.save_project(
        {
            "project_id": "legacy_asset_project",
            "title": "Legacy Asset Project",
            "asset_manifest": [
                {
                    "asset_id": "bg",
                    "asset_type": "background",
                    "metadata": {
                        "backend_asset_path": "project/background/asset-old.png",
                        "filePath": str(legacy_asset),
                    },
                }
            ],
        }
    )

    assert service.resolve_asset_file("project/background/asset-old.png") == legacy_asset.resolve()


def test_project_state_service_externalizes_recent_project_assets(tmp_path: Path) -> None:
    service = build_service(tmp_path / "project_assets")
    data_url = "data:text/plain;base64,aGVsbG8="

    state = service.save_state(
        {
            "recent_projects": [
                {
                    "project_id": "recent_project",
                    "title": "Recent",
                    "asset_manifest": [
                        {
                            "asset_id": "note",
                            "asset_type": "ui",
                            "metadata": {"data_url": data_url},
                        }
                    ],
                }
            ]
        }
    )

    metadata = state["recent_projects"][0]["asset_manifest"][0]["metadata"]
    assert "data_url" not in metadata
    assert Path(metadata["filePath"]).read_bytes() == b"hello"
    stored = service.conn.execute("SELECT value FROM editor_shared_state WHERE key = ?", ("recent_projects",)).fetchone()["value"]
    assert "data:" not in stored


def test_project_state_service_externalizes_inline_data_url_settings(tmp_path: Path) -> None:
    service = build_service(tmp_path / "project_assets")
    data_url = "data:image/png;base64,aGVsbG8="

    state = service.save_state(
        {
            "project_metadata": {
                "projectId": "project_with_inline_settings",
                "settings": {
                    "editorAppearance": {
                        "canvasBackgroundImage": {
                            "dataUrl": data_url,
                            "fileName": "canvas.png",
                            "mimeType": "image/png",
                            "sizeBytes": 5,
                            "updatedAt": "2026-01-01T00:00:00.000Z",
                        }
                    }
                },
            }
        }
    )

    image = state["project_metadata"]["settings"]["editorAppearance"]["canvasBackgroundImage"]
    assert "dataUrl" not in image
    assert image["url"].startswith("http://127.0.0.1:8278/api/project/assets/")
    assert Path(image["filePath"]).read_bytes() == b"hello"
    stored = service.conn.execute("SELECT value FROM editor_shared_state WHERE key = ?", ("project_metadata",)).fetchone()["value"]
    assert "data:" not in stored


def test_project_state_service_copies_file_path_assets_into_served_storage(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    source.write_bytes(b"asset-bytes")
    service = build_service(tmp_path / "project_assets")

    state = service.save_state(
        {
            "project_metadata": {
                "projectId": "project_with_file_paths",
                "assetManifest": [
                    {
                        "asset_id": "forest",
                        "asset_type": "background",
                        "metadata": {
                            "filename": "forest.png",
                            "mime_type": "image/png",
                            "filePath": str(source),
                        },
                    }
                ],
            }
        }
    )

    metadata = state["project_metadata"]["assetManifest"][0]["metadata"]
    assert metadata["url"].startswith("http://127.0.0.1:8278/api/project/assets/")
    assert Path(metadata["filePath"]).read_bytes() == b"asset-bytes"
    assert Path(metadata["filePath"]) != source
    assert service.resolve_asset_file(metadata["backend_asset_path"]) == Path(metadata["filePath"])


def test_project_state_service_rejects_asset_path_traversal(tmp_path: Path) -> None:
    service = build_service(tmp_path / "project_assets")

    assert service.resolve_asset_file("../secret.txt") is None


def test_project_state_service_migrates_legacy_editor_state(tmp_path: Path, monkeypatch) -> None:
    legacy_file = tmp_path / "editor_state.json"
    legacy_file.write_text(
        json.dumps(
            {
                "nodes": [{"id": "legacy"}],
                "edges": [{"id": "edge_1"}],
                "viewport": {"x": 5, "y": 6, "zoom": 1.1},
                "memoryMode": "hybrid",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service_module, "LEGACY_PROJECT_STATE_FILE", legacy_file)

    service = build_service()
    state = service.load_state()

    assert state["project_graph"]["nodes"] == [{"id": "legacy"}]
    assert state["project_graph"]["edges"] == [{"id": "edge_1"}]
    assert state["project_graph"]["viewport"] == {"x": 5, "y": 6, "zoom": 1.1}
