from app.models.memory import GenerationMemoryContext
from app.models.scene import SceneBeat
from app.schemas.requests import GenerateSceneRequest
from app.services.generation_service import GenerationService


class FakeProvider:
    def embed_text(self, text: str) -> list[float]:
        raise RuntimeError("embedding endpoint unavailable")


class FakeManager:
    def build_generation_context(self, memory_mode, chapter, query_embedding, character_id=None):
        assert query_embedding == []
        return GenerationMemoryContext(
            memory_mode=memory_mode,
            character_profiles=[],
            active_relations=[],
            emotional_memories=[],
        )


class FakeGenerator:
    def stream_generate_scene(self, **kwargs):
        yield (
            "final",
            SceneBeat(
                scene_id="scene_generated",
                title="Generated",
                summary="Generated scene.",
                chapter=1,
                commands=[{"type": "narration", "text": "Continue."}],
            ),
        )


def test_stream_generate_scene_reports_memory_context_when_memory_mode_is_string() -> None:
    service = GenerationService(FakeManager(), FakeGenerator(), FakeProvider())  # type: ignore[arg-type]
    request = GenerateSceneRequest(
        current_scene="{}",
        author_goal="continue",
        memory_mode="hybrid",
        chapter=1,
    )

    events = list(service.stream_generate_scene(request))

    assert events[0][0] == "trace"
    assert events[0][1]["details"]["memory_mode"] == "hybrid"  # type: ignore[index]
    assert events[0][1]["details"]["embedding_available"] is False  # type: ignore[index]
    assert events[-1][0] == "final"
