"""Editor project/shared state routes."""

from __future__ import annotations

from typing import Any

import json
import logging
import mimetypes
import re
import time
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from app.api.deps import get_project_state_service
from app.services.project_state_service import ProjectImportError, ProjectStateService

router = APIRouter(prefix="/project", tags=["project"])
logger = logging.getLogger("agentvn.backend.project")

_LOCAL_EDITOR_ORIGIN = re.compile(r"^https?://(?:localhost|127\.0\.0\.1)(?::\d+)?$|^https?://tauri\.localhost(?::\d+)?$")
PROJECT_IMPORT_MAX_BYTES: int | None = None
LEGACY_JSON_IMPORT_MAX_BYTES = 512 * 1024 * 1024
PROJECT_IMPORT_TICKET_MAX_AGE_SECONDS = 15 * 60
_PROJECT_IMPORT_TICKET_TOKEN = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


@router.get("/state")
async def load_project_state(
    include_project: bool = Query(True),
    include_recent_projects: bool = Query(True),
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Return structured shared editor state."""

    try:
        state = service.load_state(include_project=include_project, include_recent_projects=include_recent_projects)
        return {"ok": True, "data": service.public_state(state)}
    except Exception as exc:
        # A storage/decoding exception may itself contain stored credentials.
        logger.error("读取工程状态失败，已返回默认状态（%s）", type(exc).__name__)
        return {"ok": True, "data": service.default_state(), "warning": "Project state could not be read; default state returned."}


@router.post("/state")
async def save_project_state(
    payload: dict[str, Any],
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Merge and persist structured shared editor state."""

    try:
        return {"ok": True, "data": service.public_state(service.save_state(payload))}
    except ProjectImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/catalog")
async def load_project_catalog(
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Return lightweight project summaries for the home screen."""

    return {"ok": True, "data": service.load_catalog()}


@router.post("/projects/import")
async def import_project_file(
    request: Request,
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Stream a .vnproj file to disk, then externalize and persist it."""

    content_length_header = request.headers.get("content-length")
    if content_length_header:
        try:
            content_length = int(content_length_header)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid Content-Length header.") from exc

    encoded_filename = request.headers.get("x-agentvn-filename", "import.vnproj")
    source_filename = unquote(encoded_filename).strip()[:255] or "import.vnproj"
    temporary_path: Path | None = None
    received_bytes = 0
    prefix = bytearray()
    try:
        with NamedTemporaryFile(prefix="agentvn-import-", suffix=".vnproj", delete=False) as temporary_file:
            temporary_path = Path(temporary_file.name)
            async for chunk in request.stream():
                if not chunk:
                    continue
                received_bytes += len(chunk)
                if len(prefix) < 4:
                    prefix.extend(chunk[: 4 - len(prefix)])
                if PROJECT_IMPORT_MAX_BYTES is not None and received_bytes > PROJECT_IMPORT_MAX_BYTES:
                    raise HTTPException(status_code=413, detail="Project file exceeds the configured backend import limit.")
                if (
                    PROJECT_IMPORT_MAX_BYTES is None
                    and len(prefix) >= 4
                    and bytes(prefix) != b"PK\x03\x04"
                    and received_bytes > LEGACY_JSON_IMPORT_MAX_BYTES
                ):
                    raise HTTPException(status_code=413, detail="LEGACY_JSON_SIZE_LIMIT")
                temporary_file.write(chunk)

        if received_bytes == 0:
            raise HTTPException(status_code=400, detail="Project file is empty.")
        imported = service.import_project_file(temporary_path, source_size_bytes=received_bytes)
        return {
            "ok": True,
            "data": imported,
            "source_filename": source_filename,
            "source_size_bytes": received_bytes,
        }
    except ProjectImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=507, detail="Insufficient local storage for project import.") from exc
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Failed to remove temporary project import file: %s", temporary_path)


@router.post("/projects/import-ticket")
async def import_project_ticket(
    payload: dict[str, Any],
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Consume a one-time desktop ticket and import its selected .vnproj path."""

    token = payload.get("token")
    if not isinstance(token, str) or not _PROJECT_IMPORT_TICKET_TOKEN.fullmatch(token):
        raise HTTPException(status_code=400, detail="Invalid project import ticket.")
    ticket_root = (service.asset_root.parent / "project-import-tickets").resolve()
    ticket_path = (ticket_root / f"{token}.json").resolve()
    try:
        ticket_path.relative_to(ticket_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid project import ticket path.") from exc
    try:
        ticket = json.loads(ticket_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project import ticket was not found or was already used.") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Project import ticket is unreadable.") from exc
    finally:
        try:
            ticket_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Failed to consume project import ticket: %s", ticket_path)

    created_at = ticket.get("created_at")
    source_path_value = ticket.get("path")
    expected_size = ticket.get("size_bytes")
    now = int(time.time())
    if not isinstance(created_at, int) or created_at > now + 60 or now - created_at > PROJECT_IMPORT_TICKET_MAX_AGE_SECONDS:
        raise HTTPException(status_code=410, detail="Project import ticket has expired.")
    if not isinstance(source_path_value, str) or not source_path_value.strip():
        raise HTTPException(status_code=422, detail="Project import ticket has no source path.")
    source_path = Path(source_path_value).expanduser().resolve()
    if source_path.suffix.lower() not in {".vnproj", ".json"} or not source_path.is_file():
        raise HTTPException(status_code=422, detail="Selected project file no longer exists.")
    source_size = source_path.stat().st_size
    if isinstance(expected_size, int) and expected_size != source_size:
        raise HTTPException(status_code=409, detail="Selected project file changed after it was chosen.")
    if PROJECT_IMPORT_MAX_BYTES is not None and source_size > PROJECT_IMPORT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Project file exceeds the configured backend import limit.")
    with source_path.open("rb") as source_file:
        prefix = source_file.read(4)
    if (
        PROJECT_IMPORT_MAX_BYTES is None
        and prefix != b"PK\x03\x04"
        and source_size > LEGACY_JSON_IMPORT_MAX_BYTES
    ):
        raise HTTPException(status_code=413, detail="LEGACY_JSON_SIZE_LIMIT")
    try:
        imported = service.import_project_file(source_path, source_size_bytes=source_size)
    except ProjectImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "ok": True,
        "data": imported,
        "source_filename": source_path.name,
        "source_size_bytes": source_size,
    }


@router.get("/projects/{project_id}")
async def load_project_detail(
    project_id: str,
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Return one full project only after the user chooses it."""

    project = service.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return {"ok": True, "data": project}


@router.put("/projects/{project_id}")
async def save_project_detail(
    request: Request,
    project_id: str,
    payload: dict[str, Any],
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Persist one full project and update its catalog summary."""

    project = {**payload, "project_id": project_id}
    raw_size = request.headers.get("x-agentvn-source-size-bytes")
    size_bytes_override: int | None = None
    if raw_size:
        try:
            parsed_size = int(raw_size)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid source size header.") from exc
        if parsed_size < 0:
            raise HTTPException(status_code=400, detail="Invalid source size header.")
        size_bytes_override = parsed_size
    try:
        saved = service.save_project(
            project,
            size_bytes_override=size_bytes_override,
            size_source="container" if size_bytes_override is not None else None,
        )
    except ProjectImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True, "data": saved}


@router.delete("/projects/{project_id}")
async def delete_project_detail(
    project_id: str,
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Remove a project from the lightweight catalog and detail store."""

    return {"ok": True, "deleted": service.delete_project(project_id)}


@router.get("/assets/{asset_path:path}")
async def load_project_asset(
    asset_path: str,
    request: Request,
    service: ProjectStateService = Depends(get_project_state_service),
) -> FileResponse:
    """Serve asset payloads externalized from shared editor state."""

    asset_file = service.resolve_asset_file(asset_path)
    if asset_file is None:
        raise HTTPException(status_code=404, detail="Project asset not found.")
    headers = {"Vary": "Origin"}
    origin = request.headers.get("origin", "")
    # FileResponse is intentionally returned from the route instead of a
    # static mount.  Keep the local editor origins explicit here as a belt-
    # and-suspenders guarantee for WebView/Playwright asset fetches; the app
    # level CORSMiddleware remains the policy gate for all other routes.
    if _LOCAL_EDITOR_ORIGIN.fullmatch(origin):
        headers["Access-Control-Allow-Origin"] = origin
    suffix = asset_file.suffix.lower()
    media_type = {
        ".otf": "font/otf",
        ".ttf": "font/ttf",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
    }.get(suffix) or mimetypes.guess_type(asset_file.name)[0]
    return FileResponse(asset_file, headers=headers, media_type=media_type)
