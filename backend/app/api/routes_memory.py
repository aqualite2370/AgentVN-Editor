"""Memory routes."""

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_memory_manager, get_memory_service
from app.memory.manager import MemoryManager
from app.models.memory import EpisodicMemory, MemoryUpdate, RelationEdge
from app.schemas.requests import SetMemoryModeRequest
from app.schemas.responses import ApplyMemoryUpdateResponse, MemoryModeResponse
from app.services.memory_service import MemoryService

router = APIRouter()


@router.post("/memory/apply_update", response_model=ApplyMemoryUpdateResponse)
def apply_update(
    update: MemoryUpdate,
    chapter: int = Query(default=0, ge=0),
    service: MemoryService = Depends(get_memory_service),
) -> ApplyMemoryUpdateResponse:
    return service.apply_update(update, chapter)


@router.get("/relations", response_model=list[RelationEdge])
def relations(
    source: str | None = None,
    target: str | None = None,
    manager: MemoryManager = Depends(get_memory_manager),
) -> list[RelationEdge]:
    return manager.get_active_relations(source=source, target=target)


@router.get("/relations/history", response_model=list[RelationEdge])
def relation_history(
    source: str | None = None,
    target: str | None = None,
    manager: MemoryManager = Depends(get_memory_manager),
) -> list[RelationEdge]:
    return manager.get_relation_history(source=source, target=target)


@router.get("/memories", response_model=list[EpisodicMemory])
def memories(
    character_id: str | None = Query(default=None),
    manager: MemoryManager = Depends(get_memory_manager),
) -> list[EpisodicMemory]:
    return manager.list_memories(character_id=character_id)


@router.get("/memory/mode", response_model=MemoryModeResponse)
def get_memory_mode(manager: MemoryManager = Depends(get_memory_manager)) -> MemoryModeResponse:
    return MemoryModeResponse(memory_mode=manager.get_memory_mode())


@router.post("/memory/mode", response_model=MemoryModeResponse)
def set_memory_mode(
    request: SetMemoryModeRequest,
    manager: MemoryManager = Depends(get_memory_manager),
) -> MemoryModeResponse:
    return MemoryModeResponse(memory_mode=manager.set_memory_mode(request.memory_mode))
