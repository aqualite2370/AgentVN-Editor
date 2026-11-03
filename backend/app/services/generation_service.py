"""Generation application service."""

from collections.abc import Iterator
from datetime import datetime, timezone
import logging

from app.ai.generator import AIGenerator
from app.ai.context_budget import pack_text_context
from app.ai.provider import AIProvider
from app.ai.runtime_event_policy import (
    AIOperationGuardResult,
    RuntimeControlGuardResult,
    guard_scene_ai_operations,
    guard_scene_runtime_controls,
)
from app.memory.manager import MemoryManager
from app.schemas.requests import ExtractMemoryRequest, GenerateSceneRequest
from app.models.memory import GenerationMemoryContext, MemoryUpdate
from app.models.scene import SceneBeat
from app.core.error_logging import log_exception


logger = logging.getLogger("agentvn.backend.generation")


class GenerationService:
    """Builds memory context and delegates structured AI generation."""

    def __init__(self, manager: MemoryManager, generator: AIGenerator, provider: AIProvider) -> None:
        self.manager = manager
        self.generator = generator
        self.provider = provider

    def _build_context(self, request: GenerateSceneRequest) -> tuple[GenerationMemoryContext, str | None]:
        embedding_error: str | None = None
        try:
            query_embedding = self.provider.embed_text(
                f"{request.current_scene}\n{request.author_goal}\n{(request.editor_context or '')[:3000]}"
            )
        except Exception as exc:
            log_exception(logger, "生成上下文的向量检索失败，已降级为无向量上下文", exc)
            query_embedding = []
            embedding_error = str(exc)
        context = self.manager.build_generation_context(
            request.memory_mode,
            request.chapter,
            query_embedding=query_embedding,
            character_id=request.character_id,
        )
        return context, embedding_error

    def generate_scene(self, request: GenerateSceneRequest) -> SceneBeat:
        context, _embedding_error = self._build_context(request)
        packed_editor_context = pack_text_context(
            request.editor_context,
            request.provider_selection,
            note="Backend packed editor blueprint context for non-streaming scene generation.",
        )
        generated = self.generator.generate_scene(
            current_scene=request.current_scene,
            target_scene_stub=request.target_scene_stub,
            previous_summary=request.previous_summary,
            author_goal=request.author_goal,
            generation_outline=request.generation_outline,
            editor_context=packed_editor_context.text,
            memory_mode=request.memory_mode,
            active_relations=context.active_relations,
            emotional_memories=context.emotional_memories,
            character_profiles=context.character_profiles,
            chapter=request.chapter,
            provider_selection=request.provider_selection,
        )
        operation_guard = self._guard_ai_operations(request, generated)
        guarded = self._guard_runtime_controls(request, operation_guard.scene)
        if operation_guard.changed:
            logger.warning(
                "Removed or restored AI-protected operations: removed=%s restored=%s stripped=%s scene_id=%s",
                operation_guard.removed_commands,
                operation_guard.restored_commands,
                operation_guard.stripped_fields,
                operation_guard.scene.scene_id,
            )
        if guarded.changed:
            logger.warning(
                "Removed or restored unauthorized rollback controls: removed=%s restored=%s scene_id=%s",
                guarded.removed_commands,
                guarded.restored_commands,
                guarded.scene.scene_id,
            )
        return guarded.scene

    @staticmethod
    def _guard_ai_operations(
        request: GenerateSceneRequest,
        scene: SceneBeat,
    ) -> AIOperationGuardResult:
        return guard_scene_ai_operations(
            scene,
            baseline_scene_json=request.current_scene,
        )

    @staticmethod
    def _guard_runtime_controls(
        request: GenerateSceneRequest,
        scene: SceneBeat,
    ) -> RuntimeControlGuardResult:
        return guard_scene_runtime_controls(
            scene,
            author_goal=request.author_goal,
            generation_outline=request.generation_outline,
            baseline_scene_json=request.current_scene,
        )

    @staticmethod
    def _runtime_control_trace(result: RuntimeControlGuardResult) -> dict[str, object]:
        return {
            "id": "runtime_control_guard",
            "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "phase": "runtime_control_guard",
            "level": "warning",
            "title": "Runtime control guard applied",
            "message": (
                "Rollback controls require an explicit author instruction. "
                "Unauthorized additions were removed and existing same-scene controls were preserved."
            ),
            "details": {
                "scene_id": result.scene.scene_id,
                "removed_commands": result.removed_commands,
                "restored_commands": result.restored_commands,
                "authorized": result.authorized,
            },
        }

    @staticmethod
    def _ai_operation_trace(result: AIOperationGuardResult) -> dict[str, object]:
        return {
            "id": "ai_operation_guard",
            "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "phase": "ai_operation_guard",
            "level": "warning",
            "title": "Protected editor operations preserved",
            "message": (
                "AI cannot create or modify asset-reference events, camera commands, or choice button styles. "
                "Unauthorized changes were removed and existing same-scene author settings were restored."
            ),
            "details": {
                "scene_id": result.scene.scene_id,
                "removed_commands": result.removed_commands,
                "restored_commands": result.restored_commands,
                "stripped_fields": result.stripped_fields,
                "restored_fields": result.restored_fields,
            },
        }

    def stream_generate_scene(self, request: GenerateSceneRequest) -> Iterator[tuple[str, object]]:
        context, embedding_error = self._build_context(request)
        packed_editor_context = pack_text_context(
            request.editor_context,
            request.provider_selection,
            note="Backend packed editor blueprint context for streaming scene generation.",
        )

        def events() -> Iterator[tuple[str, object]]:
            yield ("trace", {
                "id": "context_budget",
                "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "phase": "context_budget",
                "level": "warning" if packed_editor_context.report["compression_triggered"] else "info",
                "title": "Context budget prepared",
                "message": "Editor context was packed before sending it to the model.",
                "details": {
                    **packed_editor_context.report,
                    "memory_mode": request.memory_mode.value if hasattr(request.memory_mode, "value") else str(request.memory_mode),
                    "embedding_available": embedding_error is None,
                },
            })
            yield ("trace", {
                "id": "memory_context",
                "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "phase": "memory_context",
                "level": "warning" if embedding_error else "info",
                "title": "Memory context prepared",
                "message": "Generation will use the selected memory mode with available context.",
                "details": {
                    "memory_mode": request.memory_mode.value if hasattr(request.memory_mode, "value") else str(request.memory_mode),
                    "character_profiles": len(context.character_profiles),
                    "active_relations": len(context.active_relations),
                    "emotional_memories": len(context.emotional_memories),
                    "editor_context_chars": len(packed_editor_context.text or ""),
                    "embedding_available": embedding_error is None,
                    "embedding_error": embedding_error[:500] if embedding_error else None,
                },
            })
            for event, payload in self.generator.stream_generate_scene(
                current_scene=request.current_scene,
                target_scene_stub=request.target_scene_stub,
                previous_summary=request.previous_summary,
                author_goal=request.author_goal,
                generation_outline=request.generation_outline,
                editor_context=packed_editor_context.text,
                memory_mode=request.memory_mode,
                active_relations=context.active_relations,
                emotional_memories=context.emotional_memories,
                character_profiles=context.character_profiles,
                chapter=request.chapter,
                provider_selection=request.provider_selection,
            ):
                if event != "final" or not isinstance(payload, SceneBeat):
                    yield (event, payload)
                    continue
                operation_guard = self._guard_ai_operations(request, payload)
                if operation_guard.changed:
                    yield ("trace", self._ai_operation_trace(operation_guard))
                guarded = self._guard_runtime_controls(request, operation_guard.scene)
                if guarded.changed:
                    yield ("trace", self._runtime_control_trace(guarded))
                yield ("final", guarded.scene)

        return events()

    def extract_memory_updates(self, request: ExtractMemoryRequest) -> MemoryUpdate:
        return self.generator.extract_memory_updates(
            request.scene,
            request.memory_mode,
            request.chapter,
            provider_selection=request.provider_selection,
        )

    def stream_extract_memory_updates(self, request: ExtractMemoryRequest) -> Iterator[tuple[str, object]]:
        return self.generator.stream_extract_memory_updates(
            request.scene,
            request.memory_mode,
            request.chapter,
            provider_selection=request.provider_selection,
        )
