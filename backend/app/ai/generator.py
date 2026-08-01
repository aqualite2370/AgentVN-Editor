"""AI generation orchestration."""

from app.ai.prompts import (
    MEMORY_SYSTEM_PROMPT,
    SCENE_SYSTEM_PROMPT,
    build_memory_user_prompt,
    build_scene_user_prompt,
)
from app.ai.provider import AIProvider
from app.models.common import MemoryMode
from app.models.memory import CharacterProfile, MemoryUpdate, RelationEdge, RetrievedMemory
from collections.abc import Iterator

from app.models.scene import SceneBeat
from app.schemas.requests import ProviderSelectionRequest


class AIGenerator:
    """Structured generation facade."""

    def __init__(self, provider: AIProvider) -> None:
        self.provider = provider

    def generate_scene(
        self,
        current_scene: str,
        previous_summary: str | None,
        author_goal: str,
        memory_mode: MemoryMode,
        active_relations: list[RelationEdge],
        emotional_memories: list[RetrievedMemory],
        character_profiles: list[CharacterProfile],
        chapter: int,
        target_scene_stub: str | None = None,
        generation_outline: str | None = None,
        editor_context: str | None = None,
        provider_selection: ProviderSelectionRequest | None = None,
    ) -> SceneBeat:
        """Generate a SceneBeat with legal GameCommand entries."""

        prompt = build_scene_user_prompt(
            current_scene,
            previous_summary,
            author_goal,
            memory_mode,
            active_relations,
            emotional_memories,
            character_profiles,
            chapter,
            target_scene_stub=target_scene_stub,
            generation_outline=generation_outline,
            editor_context=editor_context,
        )
        return self.provider.create_with_tools(SceneBeat, SCENE_SYSTEM_PROMPT, prompt, selection=provider_selection)

    def stream_generate_scene(
        self,
        current_scene: str,
        previous_summary: str | None,
        author_goal: str,
        memory_mode: MemoryMode,
        active_relations: list[RelationEdge],
        emotional_memories: list[RetrievedMemory],
        character_profiles: list[CharacterProfile],
        chapter: int,
        target_scene_stub: str | None = None,
        generation_outline: str | None = None,
        editor_context: str | None = None,
        provider_selection: ProviderSelectionRequest | None = None,
    ) -> Iterator[tuple[str, object]]:
        prompt = build_scene_user_prompt(
            current_scene,
            previous_summary,
            author_goal,
            memory_mode,
            active_relations,
            emotional_memories,
            character_profiles,
            chapter,
            target_scene_stub=target_scene_stub,
            generation_outline=generation_outline,
            editor_context=editor_context,
        )
        return self.provider.stream_with_tools(SceneBeat, SCENE_SYSTEM_PROMPT, prompt, selection=provider_selection)

    def extract_memory_updates(
        self,
        scene: SceneBeat,
        memory_mode: MemoryMode,
        chapter: int,
        provider_selection: ProviderSelectionRequest | None = None,
    ) -> MemoryUpdate:
        """Extract objective and subjective memory deltas from a scene."""

        prompt = build_memory_user_prompt(scene.model_dump_json(), memory_mode, chapter)
        return self.provider.create_with_tools(MemoryUpdate, MEMORY_SYSTEM_PROMPT, prompt, temperature=0.1, selection=provider_selection)

    def stream_extract_memory_updates(
        self,
        scene: SceneBeat,
        memory_mode: MemoryMode,
        chapter: int,
        provider_selection: ProviderSelectionRequest | None = None,
    ) -> Iterator[tuple[str, object]]:
        prompt = build_memory_user_prompt(scene.model_dump_json(), memory_mode, chapter)
        return self.provider.stream_with_tools(MemoryUpdate, MEMORY_SYSTEM_PROMPT, prompt, temperature=0.1, selection=provider_selection)
