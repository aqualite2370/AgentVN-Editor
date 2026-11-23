"""One-time migration from legacy editor SQLite databases into shared storage."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.db.init_db import init_db

MIGRATION_RECORD_FILE = "database-migration-record.json"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _decode(value: str) -> Any:
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value


def _encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _read_record(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _backup(path: Path, timestamp: str) -> str:
    backup = path.with_name(f"{path.name}.agentvn-backup-{timestamp.replace(':', '').replace('+', '-')}")
    shutil.copy2(path, backup)
    return str(backup)


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone() is not None


def _merge_projects(target: sqlite3.Connection, source: sqlite3.Connection) -> list[str]:
    conflicts: list[str] = []
    columns = {
        row[1]
        for row in source.execute("PRAGMA table_info(editor_project_summaries)").fetchall()
    }
    size_expression = "size_bytes" if "size_bytes" in columns else "0"
    source_rows = source.execute(
        f"""
        SELECT project_id, title, author, created_at, updated_at, node_count,
               edge_count, schema_version, has_detail, display_order, summary_json,
               {size_expression}
        FROM editor_project_summaries
        """
    ).fetchall()
    for row in source_rows:
        project_id = row[0]
        existing = target.execute(
            "SELECT 1 FROM editor_project_summaries WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        if existing is not None:
            conflicts.append(project_id)
            continue
        target.execute(
            """
            INSERT INTO editor_project_summaries
              (project_id, title, author, created_at, updated_at, node_count,
               edge_count, schema_version, has_detail, display_order, summary_json,
               size_bytes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            tuple(row),
        )
        detail = None
        if _table_exists(source, "editor_project_details"):
            detail = source.execute(
                "SELECT project_json, updated_at FROM editor_project_details WHERE project_id = ?",
                (project_id,),
            ).fetchone()
        if detail is not None:
            target.execute(
                """
                INSERT INTO editor_project_details(project_id, project_json, updated_at)
                VALUES (?, ?, ?)
                """,
                (project_id, detail[0], detail[1]),
            )
    return conflicts


def _merge_shared_state(target: sqlite3.Connection, source: sqlite3.Connection) -> None:
    if not _table_exists(source, "editor_shared_state"):
        return
    for key, value, updated_at in source.execute(
        "SELECT key, value, updated_at FROM editor_shared_state"
    ):
        if target.execute("SELECT 1 FROM editor_shared_state WHERE key = ?", (key,)).fetchone():
            continue
        target.execute(
            "INSERT INTO editor_shared_state(key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, updated_at),
        )


def migrate_legacy_databases(target_path: Path, legacy_paths: list[Path]) -> dict[str, Any]:
    """Merge legacy databases once, preserving the existing shared database on conflicts."""

    target_path = target_path.expanduser().resolve()
    sources = []
    seen: set[str] = set()
    for candidate in legacy_paths:
        source = candidate.expanduser().resolve()
        if source == target_path or not source.is_file() or str(source).lower() in seen:
            continue
        seen.add(str(source).lower())
        sources.append(source)
    if not sources:
        return {"status": "SKIPPED", "reason": "no-legacy-database"}

    target_path.parent.mkdir(parents=True, exist_ok=True)
    record_path = target_path.parent / MIGRATION_RECORD_FILE
    record = _read_record(record_path)
    fingerprints = {str(path): _sha256(path) for path in sources}
    completed = record.get("completedFingerprints", {})
    if isinstance(completed, dict) and all(completed.get(path) == digest for path, digest in fingerprints.items()):
        return {"status": "SKIPPED", "reason": "already-migrated", "fingerprints": fingerprints}

    timestamp = _utc_now()
    backups: list[str] = []
    if target_path.is_file():
        backups.append(_backup(target_path, timestamp))
    backups.extend(_backup(source, timestamp) for source in sources)

    target = sqlite3.connect(target_path)
    target.row_factory = sqlite3.Row
    try:
        init_db(target)
        target.execute("BEGIN IMMEDIATE")
        conflicts: list[str] = []
        for source_path in sources:
            source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
            try:
                source.row_factory = sqlite3.Row
                if _table_exists(source, "editor_project_summaries"):
                    conflicts.extend(_merge_projects(target, source))
                _merge_shared_state(target, source)
            finally:
                source.close()
        target.commit()
    except Exception:
        target.rollback()
        raise
    finally:
        target.close()

    result = {
        "status": "MERGED",
        "completedAt": timestamp,
        "sources": [str(path) for path in sources],
        "fingerprints": fingerprints,
        "backups": backups,
        "conflicts": sorted(set(conflicts)),
    }
    merged_fingerprints = dict(completed) if isinstance(completed, dict) else {}
    merged_fingerprints.update(fingerprints)
    result["completedFingerprints"] = merged_fingerprints
    record_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def migrate_from_environment() -> dict[str, Any]:
    """Run migration configured by the desktop host before uvicorn starts."""

    target = os.environ.get("DATABASE_PATH", "").strip()
    raw_sources = os.environ.get("AGENTVN_LEGACY_DATABASE_PATHS", "")
    if not target or not raw_sources:
        return {"status": "SKIPPED", "reason": "not-configured"}
    sources = [Path(value) for value in raw_sources.split(os.pathsep) if value.strip()]
    return migrate_legacy_databases(Path(target), sources)
