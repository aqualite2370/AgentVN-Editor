"""Shared editor/project state persistence."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import mimetypes
import re
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote_to_bytes

logger = logging.getLogger("agentvn.backend.project_state")

LEGACY_PROJECT_STATE_FILE = Path("data/editor_state.json")
DEFAULT_ASSET_STORAGE_DIR = Path("data/project_assets")
DEFAULT_ASSET_PUBLIC_URL_PREFIX = "http://127.0.0.1:8278/api/project/assets"
LEGACY_CATALOG_MIGRATION_MAX_CHARS = 8 * 1024 * 1024
LEGACY_CATALOG_SUMMARY_PREFIX_CHARS = 64 * 1024

PROJECT_GRAPH_KEY = "project_graph"
PROJECT_METADATA_KEY = "project_metadata"
RECENT_PROJECTS_KEY = "recent_projects"
PROVIDER_CONNECTIONS_KEY = "provider_connections"
PROVIDER_MODELS_KEY = "provider_models"
PROVIDER_SELECTIONS_KEY = "provider_selections"
PROVIDER_SECRETS_KEY = "provider_secrets"

EDITOR_SHARED_STATE_KEYS = {
    PROJECT_GRAPH_KEY,
    PROJECT_METADATA_KEY,
    RECENT_PROJECTS_KEY,
    PROVIDER_CONNECTIONS_KEY,
    PROVIDER_MODELS_KEY,
    PROVIDER_SELECTIONS_KEY,
    PROVIDER_SECRETS_KEY,
}


def _json_clone(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _safe_path_segment(value: Any, fallback: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    normalized = normalized.strip("._-")
    return normalized[:80] or fallback


def _decode_data_url(value: str) -> tuple[str, bytes] | None:
    match = re.match(r"^data:([^;,]+)?(;base64)?,(.*)$", value, flags=re.DOTALL)
    if not match:
        return None
    mime_type = match.group(1) or "application/octet-stream"
    payload = match.group(3) or ""
    try:
        if match.group(2):
            return mime_type, base64.b64decode(payload, validate=False)
        return mime_type, unquote_to_bytes(payload)
    except (binascii.Error, ValueError):
        # error-log-ignore: 内联素材解析失败后保留原引用，调用方会继续按普通素材路径处理。
        return None


def _extension_for_mime(mime_type: str) -> str:
    known = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/svg+xml": ".svg",
        "audio/mpeg": ".mp3",
        "audio/ogg": ".ogg",
        "audio/wav": ".wav",
        "font/ttf": ".ttf",
        "font/otf": ".otf",
        "font/woff": ".woff",
        "font/woff2": ".woff2",
    }
    return known.get(mime_type.lower()) or mimetypes.guess_extension(mime_type) or ".bin"


def _default_project_graph() -> dict[str, Any]:
    return {
        "nodes": [],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "memoryMode": "hybrid",
    }


def _default_project_summary(project_id: str) -> dict[str, Any]:
    now = "1970-01-01T00:00:00.000Z"
    return {
        "project_id": project_id,
        "title": "Untitled Visual Novel",
        "author": "",
        "created_at": now,
        "updated_at": now,
        "node_count": 0,
        "edge_count": 0,
        "schema_version": "1.0.0",
        "has_detail": False,
    }


class ProjectStateService:
    """Load and save structured editor shared state in SQLite."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        asset_root: Path | None = None,
        asset_public_url_prefix: str = DEFAULT_ASSET_PUBLIC_URL_PREFIX,
    ) -> None:
        self.conn = conn
        self.asset_root = (asset_root or DEFAULT_ASSET_STORAGE_DIR).expanduser().resolve()
        self.asset_public_url_prefix = asset_public_url_prefix.rstrip("/")

    @staticmethod
    def default_state() -> dict[str, Any]:
        return {
            PROJECT_GRAPH_KEY: _default_project_graph(),
            PROJECT_METADATA_KEY: {},
            RECENT_PROJECTS_KEY: [],
            PROVIDER_CONNECTIONS_KEY: [],
            PROVIDER_MODELS_KEY: [],
            PROVIDER_SELECTIONS_KEY: {},
            PROVIDER_SECRETS_KEY: {},
        }

    def load_state(self, include_project: bool = True, include_recent_projects: bool = True) -> dict[str, Any]:
        keys = {
            PROVIDER_CONNECTIONS_KEY,
            PROVIDER_MODELS_KEY,
            PROVIDER_SELECTIONS_KEY,
            PROVIDER_SECRETS_KEY,
        }
        if include_project:
            keys.update({PROJECT_GRAPH_KEY, PROJECT_METADATA_KEY})
        if include_recent_projects:
            keys.add(RECENT_PROJECTS_KEY)
        placeholders = ",".join("?" for _ in keys)
        rows = self.conn.execute(
            f"SELECT key, value FROM editor_shared_state WHERE key IN ({placeholders})",
            tuple(keys),
        ).fetchall()
        raw_state = {row["key"]: self._decode_value(row["value"]) for row in rows}

        if include_project and PROJECT_GRAPH_KEY not in raw_state:
            legacy_graph = self._load_legacy_project_graph()
            if legacy_graph is not None:
                raw_state[PROJECT_GRAPH_KEY] = legacy_graph
                self._write_value(PROJECT_GRAPH_KEY, legacy_graph)

        state = {
            PROJECT_GRAPH_KEY: self._normalize_project_graph(raw_state.get(PROJECT_GRAPH_KEY)),
            PROJECT_METADATA_KEY: self._normalize_object(raw_state.get(PROJECT_METADATA_KEY)),
            RECENT_PROJECTS_KEY: self._normalize_list(raw_state.get(RECENT_PROJECTS_KEY)),
            PROVIDER_CONNECTIONS_KEY: self._normalize_list(raw_state.get(PROVIDER_CONNECTIONS_KEY)),
            PROVIDER_MODELS_KEY: self._normalize_list(raw_state.get(PROVIDER_MODELS_KEY)),
            PROVIDER_SELECTIONS_KEY: self._normalize_object(raw_state.get(PROVIDER_SELECTIONS_KEY)),
            PROVIDER_SECRETS_KEY: self._normalize_object(raw_state.get(PROVIDER_SECRETS_KEY)),
        }
        return state

    def save_state(self, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = self._normalize_payload(payload)
        recent_projects = normalized.get(RECENT_PROJECTS_KEY)
        if isinstance(recent_projects, list):
            self.save_projects(recent_projects)
        current_project = self._project_from_normalized_payload(normalized)
        if current_project is not None:
            self.save_project(current_project)
        for key, value in normalized.items():
            self._write_value(key, value)
        self.conn.commit()
        include_project = PROJECT_GRAPH_KEY in normalized or PROJECT_METADATA_KEY in normalized
        include_recent_projects = RECENT_PROJECTS_KEY in normalized
        state = self.load_state(include_project=include_project, include_recent_projects=include_recent_projects)
        for key, value in normalized.items():
            state[key] = value
        return state

    def load_catalog(self) -> list[dict[str, Any]]:
        self._ensure_catalog_from_legacy()
        rows = self.conn.execute(
            """
            SELECT project_id, title, author, created_at, updated_at, node_count, edge_count,
                   schema_version, has_detail, summary_json
            FROM editor_project_summaries
            ORDER BY display_order ASC, updated_at DESC, project_id ASC
            """
        ).fetchall()
        return [self._summary_from_row(row) for row in rows]

    def load_project(self, project_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT project_json FROM editor_project_details WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        if row is not None:
            project = self._decode_value(row["project_json"])
            return project if isinstance(project, dict) else None

        legacy_project = self._load_legacy_project(project_id)
        if legacy_project is not None:
            return self.save_project(legacy_project)
        return None

    def save_project(self, project: dict[str, Any]) -> dict[str, Any]:
        normalized = self._normalize_project_file(project)
        project_id = normalized["project_id"]
        externalized = self._externalize_embedded_asset_payloads(normalized, project_id)
        self._upsert_project_summary(externalized, has_detail=True)
        self.conn.execute(
            """
            INSERT INTO editor_project_details (project_id, project_json, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(project_id) DO UPDATE SET
                project_json = excluded.project_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (project_id, json.dumps(externalized, ensure_ascii=False)),
        )
        self.conn.commit()
        return externalized

    def save_projects(self, projects: list[Any]) -> list[dict[str, Any]]:
        saved: list[dict[str, Any]] = []
        for index, project in enumerate(projects):
            if not isinstance(project, dict):
                continue
            normalized = self._normalize_project_file(project)
            externalized = self._externalize_embedded_asset_payloads(normalized, normalized["project_id"])
            self._upsert_project_summary(externalized, has_detail=True, display_order=index)
            self.conn.execute(
                """
                INSERT INTO editor_project_details (project_id, project_json, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(project_id) DO UPDATE SET
                    project_json = excluded.project_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (externalized["project_id"], json.dumps(externalized, ensure_ascii=False)),
            )
            saved.append(externalized)
        self.conn.commit()
        return saved

    def delete_project(self, project_id: str) -> bool:
        cursor = self.conn.execute("DELETE FROM editor_project_summaries WHERE project_id = ?", (project_id,))
        self.conn.execute("DELETE FROM editor_project_details WHERE project_id = ?", (project_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def resolve_asset_file(self, asset_path: str) -> Path | None:
        normalized = asset_path.replace("\\", "/")
        if not normalized or normalized.startswith("/") or "\0" in normalized:
            return None
        parts = [part for part in normalized.split("/") if part]
        if any(part == ".." for part in parts):
            return None
        candidate = (self.asset_root.joinpath(*parts)).resolve()
        try:
            candidate.relative_to(self.asset_root)
        except ValueError:
            # error-log-ignore: 拒绝越过素材根目录的输入路径属于正常安全校验。
            return None
        if candidate.is_file():
            return candidate

        indexed = self._resolve_asset_file_from_project_details(normalized)
        if indexed is not None:
            return indexed

        for root in self._legacy_asset_roots():
            legacy_candidate = (root.joinpath(*parts)).resolve()
            try:
                legacy_candidate.relative_to(root)
            except ValueError:
                # error-log-ignore: 旧素材候选不在当前兼容目录中时继续检查下一个目录。
                continue
            if legacy_candidate.is_file():
                return legacy_candidate
        return None

    def _resolve_asset_file_from_project_details(self, asset_path: str) -> Path | None:
        rows = self.conn.execute("SELECT project_json FROM editor_project_details").fetchall()
        for row in rows:
            project = self._decode_value(row["project_json"])
            if not isinstance(project, dict):
                continue
            found = self._find_asset_file_path(project.get("asset_manifest"), asset_path)
            if found is not None:
                return found
        return None

    def _find_asset_file_path(self, value: Any, asset_path: str) -> Path | None:
        if isinstance(value, list):
            for item in value:
                found = self._find_asset_file_path(item, asset_path)
                if found is not None:
                    return found
            return None
        if not isinstance(value, dict):
            return None
        metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else value
        backend_asset_path = metadata.get("backend_asset_path")
        if backend_asset_path != asset_path:
            return None
        file_path = metadata.get("filePath")
        if not isinstance(file_path, str) or not file_path.strip():
            return None
        candidate = Path(file_path).expanduser().resolve()
        return candidate if candidate.is_file() else None

    def _legacy_asset_roots(self) -> list[Path]:
        candidates = [
            Path("data/project_assets"),
            Path.cwd() / "data" / "project_assets",
            Path.cwd() / "backend" / "data" / "project_assets",
        ]
        unique: list[Path] = []
        seen: set[str] = set()
        for candidate in candidates:
            resolved = candidate.expanduser().resolve()
            key = str(resolved).lower()
            if key not in seen:
                seen.add(key)
                unique.append(resolved)
        return unique

    def _project_from_normalized_payload(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        graph = payload.get(PROJECT_GRAPH_KEY)
        metadata = payload.get(PROJECT_METADATA_KEY)
        if not isinstance(graph, dict) or not isinstance(metadata, dict):
            return None
        if not isinstance(graph.get("nodes"), list):
            return None
        project_id = metadata.get("projectId")
        if not isinstance(project_id, str) or not project_id.strip():
            return None
        return {
            "schema_version": metadata.get("schemaVersion") if isinstance(metadata.get("schemaVersion"), str) else "1.0.0",
            "project_id": project_id,
            "title": metadata.get("title") if isinstance(metadata.get("title"), str) else "Untitled Visual Novel",
            "author": metadata.get("author") if isinstance(metadata.get("author"), str) else "",
            "nodes": self._normalize_list(graph.get("nodes")),
            "edges": self._normalize_list(graph.get("edges")),
            "viewport": self._normalize_object(graph.get("viewport")) or {"x": 0, "y": 0, "zoom": 1},
            "memory_mode": graph.get("memoryMode") if isinstance(graph.get("memoryMode"), str) else "hybrid",
            "asset_manifest": self._normalize_list(metadata.get("assetManifest")),
            "editor_settings": self._normalize_object(metadata.get("settings")),
            "created_at": metadata.get("createdAt") if isinstance(metadata.get("createdAt"), str) else None,
            "updated_at": metadata.get("updatedAt") if isinstance(metadata.get("updatedAt"), str) else None,
        }

    def _normalize_project_file(self, project: dict[str, Any]) -> dict[str, Any]:
        project_id = project.get("project_id")
        if not isinstance(project_id, str) or not project_id.strip():
            project_id = "project_local"
        summary = _default_project_summary(project_id)
        created_at = project.get("created_at") if isinstance(project.get("created_at"), str) else summary["created_at"]
        updated_at = project.get("updated_at") if isinstance(project.get("updated_at"), str) else created_at
        return {
            "schema_version": project.get("schema_version") if isinstance(project.get("schema_version"), str) else summary["schema_version"],
            "project_id": project_id,
            "title": project.get("title") if isinstance(project.get("title"), str) else summary["title"],
            "author": project.get("author") if isinstance(project.get("author"), str) else "",
            "nodes": self._normalize_list(project.get("nodes")),
            "edges": self._normalize_list(project.get("edges")),
            "viewport": self._normalize_object(project.get("viewport")) or {"x": 0, "y": 0, "zoom": 1},
            "memory_mode": project.get("memory_mode") if isinstance(project.get("memory_mode"), str) else "hybrid",
            "asset_manifest": self._normalize_list(project.get("asset_manifest")),
            "editor_settings": self._normalize_object(project.get("editor_settings")),
            "created_at": created_at,
            "updated_at": updated_at,
        }

    def _project_summary_from_project(self, project: dict[str, Any], has_detail: bool) -> dict[str, Any]:
        normalized = self._normalize_project_file(project)
        return {
            "project_id": normalized["project_id"],
            "title": normalized["title"],
            "author": normalized["author"],
            "created_at": normalized["created_at"],
            "updated_at": normalized["updated_at"],
            "node_count": len(normalized["nodes"]),
            "edge_count": len(normalized["edges"]),
            "schema_version": normalized["schema_version"],
            "has_detail": has_detail,
        }

    def _upsert_project_summary(
        self,
        project: dict[str, Any],
        *,
        has_detail: bool,
        display_order: int | None = None,
    ) -> None:
        summary = self._project_summary_from_project(project, has_detail)
        self._upsert_project_summary_data(summary, has_detail=has_detail, display_order=display_order)

    def _upsert_project_summary_data(
        self,
        summary: dict[str, Any],
        *,
        has_detail: bool,
        display_order: int | None = None,
    ) -> None:
        existing = self.conn.execute(
            "SELECT display_order FROM editor_project_summaries WHERE project_id = ?",
            (summary["project_id"],),
        ).fetchone()
        next_display_order = display_order if display_order is not None else (existing["display_order"] if existing else 0)
        self.conn.execute(
            """
            INSERT INTO editor_project_summaries (
                project_id, title, author, created_at, updated_at, node_count, edge_count,
                schema_version, has_detail, display_order, summary_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                title = excluded.title,
                author = excluded.author,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                node_count = excluded.node_count,
                edge_count = excluded.edge_count,
                schema_version = excluded.schema_version,
                has_detail = excluded.has_detail,
                display_order = excluded.display_order,
                summary_json = excluded.summary_json
            """,
            (
                summary["project_id"],
                summary["title"],
                summary["author"],
                summary["created_at"],
                summary["updated_at"],
                summary["node_count"],
                summary["edge_count"],
                summary["schema_version"],
                1 if has_detail else 0,
                next_display_order,
                json.dumps(summary, ensure_ascii=False),
            ),
        )

    def _summary_from_row(self, row: sqlite3.Row) -> dict[str, Any]:
        summary = self._decode_value(row["summary_json"])
        if not isinstance(summary, dict):
            summary = _default_project_summary(row["project_id"])
        summary.update(
            {
                "project_id": row["project_id"],
                "title": row["title"],
                "author": row["author"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "node_count": int(row["node_count"] or 0),
                "edge_count": int(row["edge_count"] or 0),
                "schema_version": row["schema_version"],
                "has_detail": bool(row["has_detail"]),
            }
        )
        return summary

    def _shared_value_length(self, key: str) -> int:
        row = self.conn.execute(
            "SELECT length(value) AS value_length FROM editor_shared_state WHERE key = ?",
            (key,),
        ).fetchone()
        return int(row["value_length"] or 0) if row else 0

    def _read_shared_value_if_small(self, key: str, max_chars: int) -> Any:
        if self._shared_value_length(key) > max_chars:
            return None
        row = self.conn.execute("SELECT value FROM editor_shared_state WHERE key = ?", (key,)).fetchone()
        return self._decode_value(row["value"]) if row else None

    def _read_shared_value(self, key: str) -> Any:
        row = self.conn.execute("SELECT value FROM editor_shared_state WHERE key = ?", (key,)).fetchone()
        return self._decode_value(row["value"]) if row else None

    def _read_shared_value_prefix(self, key: str, max_chars: int = LEGACY_CATALOG_SUMMARY_PREFIX_CHARS) -> str:
        row = self.conn.execute(
            "SELECT substr(value, 1, ?) AS value_prefix FROM editor_shared_state WHERE key = ?",
            (max_chars, key),
        ).fetchone()
        return str(row["value_prefix"] or "") if row else ""

    def _ensure_catalog_from_legacy(self) -> None:
        existing = self.conn.execute("SELECT 1 FROM editor_project_summaries LIMIT 1").fetchone()
        if existing is not None:
            return
        legacy_recent = self._read_shared_value_if_small(RECENT_PROJECTS_KEY, LEGACY_CATALOG_MIGRATION_MAX_CHARS)
        if isinstance(legacy_recent, list) and legacy_recent:
            self.save_projects([project for project in legacy_recent if isinstance(project, dict)])
            return

        graph = self._read_shared_value_if_small(PROJECT_GRAPH_KEY, LEGACY_CATALOG_MIGRATION_MAX_CHARS)
        metadata = self._read_shared_value_if_small(PROJECT_METADATA_KEY, LEGACY_CATALOG_MIGRATION_MAX_CHARS)
        project = self._project_from_normalized_payload(
            {
                PROJECT_GRAPH_KEY: self._normalize_project_graph(graph),
                PROJECT_METADATA_KEY: self._normalize_object(metadata),
            }
        )
        if project is not None and project["nodes"]:
            self.save_project(project)
            return

        summary = self._legacy_summary_from_current_project_prefix()
        if summary is not None:
            self._upsert_project_summary_data(summary, has_detail=False)
            self.conn.commit()

    def _load_legacy_project(self, project_id: str) -> dict[str, Any] | None:
        legacy_recent = self._read_shared_value_if_small(RECENT_PROJECTS_KEY, LEGACY_CATALOG_MIGRATION_MAX_CHARS)
        if isinstance(legacy_recent, list):
            for project in legacy_recent:
                if isinstance(project, dict) and project.get("project_id") == project_id:
                    return self.save_project(project)

        legacy_recent = self._read_shared_value(RECENT_PROJECTS_KEY)
        if isinstance(legacy_recent, list):
            for project in legacy_recent:
                if isinstance(project, dict) and project.get("project_id") == project_id:
                    return self.save_project(project)

        graph = self._read_shared_value_if_small(PROJECT_GRAPH_KEY, LEGACY_CATALOG_MIGRATION_MAX_CHARS)
        metadata = self._read_shared_value_if_small(PROJECT_METADATA_KEY, LEGACY_CATALOG_MIGRATION_MAX_CHARS)
        candidate = self._project_from_normalized_payload(
            {
                PROJECT_GRAPH_KEY: self._normalize_project_graph(graph),
                PROJECT_METADATA_KEY: self._normalize_object(metadata),
            }
        )
        if candidate is not None and candidate.get("project_id") == project_id:
            return self.save_project(candidate)

        graph = self._read_shared_value(PROJECT_GRAPH_KEY)
        metadata = self._read_shared_value(PROJECT_METADATA_KEY)
        candidate = self._project_from_normalized_payload(
            {
                PROJECT_GRAPH_KEY: self._normalize_project_graph(graph),
                PROJECT_METADATA_KEY: self._normalize_object(metadata),
            }
        )
        if candidate is not None and candidate.get("project_id") == project_id:
            return self.save_project(candidate)
        return None

    def _legacy_summary_from_current_project_prefix(self) -> dict[str, Any] | None:
        metadata_prefix = self._read_shared_value_prefix(PROJECT_METADATA_KEY)
        recent_prefix = self._read_shared_value_prefix(RECENT_PROJECTS_KEY)
        project_id = self._extract_json_string_prefix(metadata_prefix, "projectId")
        if not project_id:
            return None

        graph = self._read_shared_value_if_small(PROJECT_GRAPH_KEY, LEGACY_CATALOG_MIGRATION_MAX_CHARS) or self._read_shared_value_if_small(PROJECT_GRAPH_KEY, 8 * 1024 * 1024)
        normalized_graph = self._normalize_project_graph(graph)
        title = self._extract_json_string_prefix(metadata_prefix, "title") or self._extract_json_string_prefix(recent_prefix, "title") or project_id
        author = self._extract_json_string_prefix(metadata_prefix, "author") or self._extract_json_string_prefix(recent_prefix, "author") or ""
        created_at = (
            self._extract_json_string_prefix(metadata_prefix, "createdAt")
            or self._extract_json_string_prefix(recent_prefix, "created_at")
            or "1970-01-01T00:00:00.000Z"
        )
        updated_at = (
            self._extract_json_string_prefix(metadata_prefix, "updatedAt")
            or self._extract_json_string_prefix(recent_prefix, "updated_at")
            or created_at
        )
        schema_version = (
            self._extract_json_string_prefix(metadata_prefix, "schemaVersion")
            or self._extract_json_string_prefix(recent_prefix, "schema_version")
            or "1.0.0"
        )
        return {
            "project_id": project_id,
            "title": title,
            "author": author,
            "created_at": created_at,
            "updated_at": updated_at,
            "node_count": len(normalized_graph["nodes"]),
            "edge_count": len(normalized_graph["edges"]),
            "schema_version": schema_version,
            "has_detail": False,
        }

    @staticmethod
    def _extract_json_string_prefix(raw: str, key: str) -> str | None:
        match = re.search(rf'"{re.escape(key)}"\s*:\s*"((?:\\.|[^"\\])*)"', raw)
        if not match:
            return None
        try:
            value = json.loads(f'"{match.group(1)}"')
        except json.JSONDecodeError:
            # error-log-ignore: 这是损坏工程的尽力恢复候选，单个字符串无法挽救时放弃该字段。
            return None
        return value if isinstance(value, str) and value.strip() else None

    def _normalize_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self._looks_like_legacy_graph_payload(payload):
            payload = {PROJECT_GRAPH_KEY: payload}

        project_id = self._project_id_from_payload(payload)
        normalized: dict[str, Any] = {}
        for key in EDITOR_SHARED_STATE_KEYS:
            if key not in payload:
                continue
            value = payload[key]
            if key == PROJECT_GRAPH_KEY:
                normalized[key] = self._externalize_embedded_asset_payloads(
                    self._normalize_project_graph(value),
                    project_id,
                )
            elif key in {RECENT_PROJECTS_KEY, PROVIDER_CONNECTIONS_KEY, PROVIDER_MODELS_KEY}:
                normalized_list = self._normalize_list(value)
                normalized[key] = (
                    self._externalize_recent_projects(normalized_list)
                    if key == RECENT_PROJECTS_KEY
                    else normalized_list
                )
            else:
                normalized_object = self._normalize_object(value)
                normalized[key] = (
                    self._externalize_embedded_asset_payloads(normalized_object, project_id)
                    if key == PROJECT_METADATA_KEY
                    else normalized_object
                )
        return normalized

    def _externalize_recent_projects(self, projects: list[Any]) -> list[Any]:
        externalized: list[Any] = []
        for index, project in enumerate(projects):
            if not isinstance(project, dict):
                externalized.append(project)
                continue
            project_id = project.get("project_id") if isinstance(project.get("project_id"), str) else f"recent_{index}"
            externalized.append(self._externalize_embedded_asset_payloads(project, project_id))
        return externalized

    def _externalize_embedded_asset_payloads(self, value: Any, project_id: str | None) -> Any:
        cloned = _json_clone(value)

        def visit(item: Any, asset_id: str | None = None, asset_type: str | None = None) -> None:
            if isinstance(item, list):
                for child in item:
                    visit(child, asset_id, asset_type)
                return
            if not isinstance(item, dict):
                return

            next_asset_id = item.get("asset_id") if isinstance(item.get("asset_id"), str) else asset_id
            next_asset_type = item.get("asset_type") if isinstance(item.get("asset_type"), str) else asset_type

            data_url = item.get("data_url")
            blob_url = item.get("blob_url")
            embedded_url = data_url if isinstance(data_url, str) and data_url.startswith("data:") else None
            if embedded_url is None and isinstance(blob_url, str) and blob_url.startswith("data:"):
                embedded_url = blob_url
            if embedded_url is not None:
                self._externalize_metadata_payload(item, embedded_url, project_id, next_asset_id, next_asset_type)
            elif not item.get("url") and not item.get("backend_asset_path"):
                self._copy_file_asset_reference(item, project_id, next_asset_id, next_asset_type)

            inline_data_url = item.get("dataUrl")
            if isinstance(inline_data_url, str) and inline_data_url.startswith("data:"):
                self._externalize_inline_payload(item, inline_data_url, project_id, next_asset_id, next_asset_type)

            for child in item.values():
                visit(child, next_asset_id, next_asset_type)

        visit(cloned)
        return cloned

    def _externalize_metadata_payload(
        self,
        metadata: dict[str, Any],
        data_url: str,
        project_id: str | None,
        asset_id: str | None,
        asset_type: str | None,
    ) -> None:
        decoded = _decode_data_url(data_url)
        if decoded is None:
            metadata.pop("data_url", None)
            if isinstance(metadata.get("blob_url"), str) and metadata["blob_url"].startswith("data:"):
                metadata.pop("blob_url", None)
            return

        mime_type, payload = decoded
        digest = hashlib.sha256(payload).hexdigest()[:16]
        safe_project_id = _safe_path_segment(project_id, "project")
        safe_asset_type = _safe_path_segment(asset_type, "asset")
        safe_asset_id = _safe_path_segment(asset_id or metadata.get("display_name") or metadata.get("filename"), "asset")
        extension = _extension_for_mime(mime_type)
        relative_path = Path(safe_project_id) / safe_asset_type / f"{safe_asset_id}-{digest}{extension}"
        absolute_path = self.asset_root / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        if not absolute_path.exists():
            absolute_path.write_bytes(payload)

        public_path = relative_path.as_posix()
        metadata["mime_type"] = metadata.get("mime_type") or mime_type
        metadata["size_bytes"] = metadata.get("size_bytes") or len(payload)
        metadata["filePath"] = str(absolute_path)
        metadata["url"] = f"{self.asset_public_url_prefix}/{quote(public_path, safe='/')}"
        metadata["backend_asset_path"] = public_path
        metadata.pop("data_url", None)
        if isinstance(metadata.get("blob_url"), str) and metadata["blob_url"].startswith("data:"):
            metadata.pop("blob_url", None)

    def _copy_file_asset_reference(
        self,
        metadata: dict[str, Any],
        project_id: str | None,
        asset_id: str | None,
        asset_type: str | None,
    ) -> None:
        raw_file_path = metadata.get("filePath")
        if not isinstance(raw_file_path, str) or not raw_file_path.strip():
            return
        source_path = Path(raw_file_path).expanduser()
        if not source_path.is_file():
            backend_asset_path = metadata.get("backend_asset_path")
            resolved_asset = self.resolve_asset_file(backend_asset_path) if isinstance(backend_asset_path, str) else None
            if resolved_asset is None:
                return
            source_path = resolved_asset

        try:
            payload = source_path.read_bytes()
        except OSError as exc:
            logger.warning(
                "工程素材读取失败，已保留原引用：project_id=%s asset_id=%s path=%s error=%s",
                project_id,
                asset_id,
                source_path,
                exc,
            )
            return

        mime_type = (
            metadata.get("mime_type")
            if isinstance(metadata.get("mime_type"), str)
            else mimetypes.guess_type(source_path.name)[0] or "application/octet-stream"
        )
        digest = hashlib.sha256(payload).hexdigest()[:16]
        safe_project_id = _safe_path_segment(project_id, "project")
        safe_asset_type = _safe_path_segment(asset_type, "asset")
        safe_asset_id = _safe_path_segment(asset_id or metadata.get("display_name") or source_path.stem, "asset")
        extension = source_path.suffix or _extension_for_mime(mime_type)
        relative_path = Path(safe_project_id) / safe_asset_type / f"{safe_asset_id}-{digest}{extension}"
        absolute_path = self.asset_root / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        if not absolute_path.exists():
            absolute_path.write_bytes(payload)

        public_path = relative_path.as_posix()
        metadata["mime_type"] = metadata.get("mime_type") or mime_type
        metadata["size_bytes"] = metadata.get("size_bytes") or len(payload)
        metadata["filePath"] = str(absolute_path)
        metadata["url"] = f"{self.asset_public_url_prefix}/{quote(public_path, safe='/')}"
        metadata["backend_asset_path"] = public_path

    def _externalize_inline_payload(
        self,
        payload_owner: dict[str, Any],
        data_url: str,
        project_id: str | None,
        asset_id: str | None,
        asset_type: str | None,
    ) -> None:
        decoded = _decode_data_url(data_url)
        if decoded is None:
            payload_owner.pop("dataUrl", None)
            return

        mime_type, payload = decoded
        digest = hashlib.sha256(payload).hexdigest()[:16]
        safe_project_id = _safe_path_segment(project_id, "project")
        safe_asset_type = _safe_path_segment(asset_type or "inline", "inline")
        safe_asset_id = _safe_path_segment(asset_id or payload_owner.get("fileName") or "payload", "payload")
        extension = _extension_for_mime(mime_type)
        relative_path = Path(safe_project_id) / safe_asset_type / f"{safe_asset_id}-{digest}{extension}"
        absolute_path = self.asset_root / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        if not absolute_path.exists():
            absolute_path.write_bytes(payload)

        public_path = relative_path.as_posix()
        payload_owner["mimeType"] = payload_owner.get("mimeType") or mime_type
        payload_owner["sizeBytes"] = payload_owner.get("sizeBytes") or len(payload)
        payload_owner["filePath"] = str(absolute_path)
        payload_owner["url"] = f"{self.asset_public_url_prefix}/{quote(public_path, safe='/')}"
        payload_owner["backendAssetPath"] = public_path
        payload_owner.pop("dataUrl", None)

    @staticmethod
    def _project_id_from_payload(payload: dict[str, Any]) -> str | None:
        metadata = payload.get(PROJECT_METADATA_KEY)
        if isinstance(metadata, dict) and isinstance(metadata.get("projectId"), str):
            return metadata["projectId"]
        recent_projects = payload.get(RECENT_PROJECTS_KEY)
        if isinstance(recent_projects, list) and recent_projects:
            first = recent_projects[0]
            if isinstance(first, dict) and isinstance(first.get("project_id"), str):
                return first["project_id"]
        return None

    def _write_value(self, key: str, value: Any) -> None:
        encoded = json.dumps(value, ensure_ascii=False)
        self.conn.execute(
            """
            INSERT INTO editor_shared_state (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
            """,
            (key, encoded),
        )

    @staticmethod
    def _decode_value(raw: str) -> Any:
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.warning("工程数据库中的 JSON 数据损坏，已忽略该字段：length=%s error=%s", len(raw), exc)
            return None

    @staticmethod
    def _normalize_object(value: Any) -> dict[str, Any]:
        return _json_clone(value) if isinstance(value, dict) else {}

    @staticmethod
    def _normalize_list(value: Any) -> list[Any]:
        return _json_clone(value) if isinstance(value, list) else []

    def _normalize_project_graph(self, value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return {
                "nodes": self._normalize_list(value.get("nodes")),
                "edges": self._normalize_list(value.get("edges")),
                "viewport": self._normalize_object(value.get("viewport")) or {"x": 0, "y": 0, "zoom": 1},
                "memoryMode": value.get("memoryMode") if isinstance(value.get("memoryMode"), str) else "hybrid",
            }
        return _default_project_graph()

    @staticmethod
    def _looks_like_legacy_graph_payload(payload: dict[str, Any]) -> bool:
        return any(key in payload for key in ("nodes", "edges", "viewport", "memoryMode"))

    def _load_legacy_project_graph(self) -> dict[str, Any] | None:
        if not LEGACY_PROJECT_STATE_FILE.exists():
            return None
        try:
            legacy = json.loads(LEGACY_PROJECT_STATE_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning(
                "旧版工程状态读取失败，已按空状态恢复：path=%s error=%s",
                LEGACY_PROJECT_STATE_FILE,
                exc,
            )
            return None
        if not isinstance(legacy, dict):
            return None
        return self._normalize_project_graph(legacy)
