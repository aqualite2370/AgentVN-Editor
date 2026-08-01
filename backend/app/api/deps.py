"""FastAPI dependency providers."""

from collections.abc import AsyncIterator
from functools import lru_cache

from app.ai.generator import AIGenerator
from app.ai.provider import AIProvider
from app.core.config import Settings, get_settings
from app.db.database import get_connection
from app.memory.manager import MemoryManager
from app.services.generation_service import GenerationService
from app.services.memory_service import MemoryService
from app.services.novel_processing_service import NovelProcessingService
from app.services.project_state_service import ProjectStateService


@lru_cache
def get_app_settings() -> Settings:
    return get_settings()


@lru_cache
def get_ai_provider() -> AIProvider:
    return AIProvider(get_app_settings())


@lru_cache
def get_memory_manager() -> MemoryManager:
    return MemoryManager(get_connection(get_app_settings()), get_app_settings())


@lru_cache
def get_ai_generator() -> AIGenerator:
    return AIGenerator(get_ai_provider())


def get_generation_service() -> GenerationService:
    return GenerationService(get_memory_manager(), get_ai_generator(), get_ai_provider())


def get_memory_service() -> MemoryService:
    return MemoryService(get_memory_manager(), get_ai_provider())


async def get_project_state_service() -> AsyncIterator[ProjectStateService]:
    settings = get_app_settings()
    conn = get_connection(settings)
    try:
        yield ProjectStateService(conn, asset_root=settings.resolved_database_path.parent / "project_assets")
    finally:
        conn.close()


async def get_novel_processing_service() -> AsyncIterator[NovelProcessingService]:
    settings = get_app_settings()
    conn = get_connection(settings)
    try:
        yield NovelProcessingService(conn, settings.novel)
    finally:
        conn.close()
