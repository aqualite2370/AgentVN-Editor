"""Editor project/shared state routes."""

from __future__ import annotations

from typing import Any

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from app.api.deps import get_project_state_service
from app.services.project_state_service import ProjectStateService
from app.core.error_logging import log_exception

router = APIRouter(prefix="/project", tags=["project"])
logger = logging.getLogger("agentvn.backend.project")

_LOCAL_EDITOR_ORIGIN = re.compile(r"^https?://(?:localhost|127\.0\.0\.1)(?::\d+)?$|^https?://tauri\.localhost(?::\d+)?$")


@router.get("/state")
async def load_project_state(
    include_project: bool = Query(True),
    include_recent_projects: bool = Query(True),
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Return structured shared editor state."""

    try:
        return {"ok": True, "data": service.load_state(include_project=include_project, include_recent_projects=include_recent_projects)}
    except Exception as exc:
        log_exception(logger, "读取工程状态失败，已返回默认状态", exc)
        return {"ok": True, "data": service.default_state(), "warning": f"Project state was reset after a read error: {exc}"}


@router.post("/state")
async def save_project_state(
    payload: dict[str, Any],
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Merge and persist structured shared editor state."""

    return {"ok": True, "data": service.save_state(payload)}


@router.get("/catalog")
async def load_project_catalog(
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Return lightweight project summaries for the home screen."""

    return {"ok": True, "data": service.load_catalog()}


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
    project_id: str,
    payload: dict[str, Any],
    service: ProjectStateService = Depends(get_project_state_service),
) -> dict[str, Any]:
    """Persist one full project and update its catalog summary."""

    project = {**payload, "project_id": project_id}
    return {"ok": True, "data": service.save_project(project)}


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
    return FileResponse(asset_file, headers=headers)
