from __future__ import annotations

import json
import stat
import zipfile
from pathlib import Path
from typing import Any

ZIP_MAGIC = b"PK\x03\x04"
MAX_ZIP_ENTRY_COUNT = 100_000
MAX_COMPRESSION_RATIO = 1_000


def is_safe_project_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\x00" in value:
        return False
    normalized = value.replace("\\", "/")
    return not normalized.startswith("/") and not Path(normalized).drive and ".." not in normalized.split("/")


def detect_project_container(path: Path) -> str:
    try:
        with path.open("rb") as handle:
            prefix = handle.read(4)
    except OSError as exc:
        raise ValueError("PROJECT_CONTAINER_INVALID") from exc
    if prefix == ZIP_MAGIC:
        return "zip"
    try:
        json.loads(path.read_text(encoding="utf-8-sig"))
        return "json"
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("PROJECT_CONTAINER_INVALID") from exc


def _validate_zip_entries(archive: zipfile.ZipFile) -> None:
    entries = archive.infolist()
    if len(entries) > MAX_ZIP_ENTRY_COUNT:
        raise ValueError("PROJECT_CONTAINER_INVALID: excessive ZIP entry count")
    seen: set[str] = set()
    for info in entries:
        name = info.filename.replace("\\", "/")
        if not is_safe_project_path(name) or "\\" in info.filename:
            raise ValueError(f"PROJECT_ZIP_PATH_UNSAFE: {info.filename}")
        if name in seen:
            raise ValueError(f"PROJECT_ZIP_PATH_UNSAFE: duplicate entry {name}")
        seen.add(name)
        unix_mode = (info.external_attr >> 16) & 0xFFFF
        if unix_mode and stat.S_ISLNK(unix_mode):
            raise ValueError(f"PROJECT_ZIP_PATH_UNSAFE: symbolic link {name}")
        if info.file_size > 0 and info.compress_size > 0:
            if info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                raise ValueError(f"PROJECT_CONTAINER_INVALID: suspicious compression ratio {name}")


def load_project_container(path: Path) -> tuple[str, dict[str, Any], zipfile.ZipFile | None]:
    container = detect_project_container(path)
    if container == "json":
        try:
            project = json.loads(path.read_text(encoding="utf-8-sig"))
            if not isinstance(project, dict):
                raise ValueError("PROJECT_CONTAINER_INVALID: project root must be an object")
            return "json", project, None
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("PROJECT_CONTAINER_INVALID") from exc

    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise ValueError("PROJECT_CONTAINER_INVALID") from exc
    try:
        _validate_zip_entries(archive)
        try:
            project_bytes = archive.read("project.json")
        except KeyError as exc:
            archive.close()
            raise ValueError("PROJECT_CONTAINER_INVALID: missing project.json") from exc
        try:
            project = json.loads(project_bytes.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            archive.close()
            raise ValueError("PROJECT_CONTAINER_INVALID: invalid project.json") from exc
        if not isinstance(project, dict):
            archive.close()
            raise ValueError("PROJECT_CONTAINER_INVALID: project root must be an object")
        for asset in project.get("asset_manifest", []):
            project_path = asset.get("metadata", {}).get("project_path") if isinstance(asset, dict) else None
            if not is_safe_project_path(project_path) or not project_path.startswith("assets/"):
                archive.close()
                raise ValueError(f"PROJECT_ZIP_PATH_UNSAFE: {project_path}")
            try:
                archive.getinfo(project_path)
            except KeyError as exc:
                archive.close()
                raise ValueError(f"PROJECT_ASSET_MISSING: {project_path}") from exc
        return "zip", project, archive
    except Exception:
        if archive.fp is not None:
            archive.close()
        raise
