"""Memory application service."""

from app.ai.provider import AIProvider
from app.memory.manager import MemoryManager
from app.models.memory import MemoryUpdate
from app.schemas.responses import ApplyMemoryUpdateResponse


class MemoryService:
    """Coordinates memory mutations and embedding creation."""

    def __init__(self, manager: MemoryManager, provider: AIProvider) -> None:
        self.manager = manager
        self.provider = provider

    def apply_update(self, update: MemoryUpdate, chapter: int) -> ApplyMemoryUpdateResponse:
        embeddings = [self.provider.embed_text(snapshot.summary) for snapshot in update.emotion_snapshots]
        result = self.manager.apply_update(update, chapter, embeddings)
        return ApplyMemoryUpdateResponse(**result)
