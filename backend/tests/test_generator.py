from typing import Any

from pydantic import BaseModel

from app.ai.generator import AIGenerator
from app.models.common import MemoryMode
from app.models.memory import MemoryUpdate
from app.models.scene import SceneBeat
from app.schemas.requests import ProviderSelectionRequest


class MockProvider:
    last_selection: ProviderSelectionRequest | None = None
    last_user_prompt: str = ""

    def create_with_tools(
        self,
        response_model: type[BaseModel],
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.4,
        selection: ProviderSelectionRequest | None = None,
    ) -> Any:
        self.last_selection = selection
        self.last_user_prompt = user_prompt
        if response_model is SceneBeat:
            return SceneBeat(
                scene_id="scene_mock",
                title="Mock",
                summary="Mock scene.",
                chapter=1,
                commands=[{"type": "narration", "text": "A quiet room."}],
            )
        if response_model is MemoryUpdate:
            return MemoryUpdate(
                summary_100="Alice remembers the quiet room.",
                invalidated_relations=[],
                new_relations=[],
                emotion_snapshots=[],
            )
        raise AssertionError("Unexpected response model")

    def stream_with_tools(
        self,
        response_model: type[BaseModel],
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.4,
        selection: ProviderSelectionRequest | None = None,
    ) -> Any:
        self.last_selection = selection
        self.last_user_prompt = user_prompt
        yield ("status", "streaming")
        yield ("delta", '{"scene_id":"scene_stream"')
        if response_model is SceneBeat:
            yield (
                "final",
                SceneBeat(
                    scene_id="scene_stream",
                    title="Stream",
                    summary="Streamed scene.",
                    chapter=1,
                    commands=[{"type": "narration", "text": "A streamed room."}],
                ),
            )
            return
        if response_model is MemoryUpdate:
            yield (
                "final",
                MemoryUpdate(
                    summary_100="Alice remembers the streamed room.",
                    invalidated_relations=[],
                    new_relations=[],
                    emotion_snapshots=[],
                ),
            )
            return
        raise AssertionError("Unexpected response model")


def test_generate_scene_mock() -> None:
    generator = AIGenerator(MockProvider())  # type: ignore[arg-type]
    scene = generator.generate_scene(
        current_scene="Alice enters.",
        previous_summary=None,
        author_goal="Create a tense beat.",
        memory_mode=MemoryMode.NONE,
        active_relations=[],
        emotional_memories=[],
        character_profiles=[],
        chapter=1,
    )
    assert scene.commands[0].type == "narration"


def test_generate_scene_accepts_string_memory_mode_from_request_schema() -> None:
    generator = AIGenerator(MockProvider())  # type: ignore[arg-type]
    scene = generator.generate_scene(
        current_scene="Alice enters.",
        previous_summary=None,
        author_goal="Create a tense beat.",
        memory_mode="none",  # type: ignore[arg-type]
        active_relations=[],
        emotional_memories=[],
        character_profiles=[],
        chapter=1,
    )
    assert scene.scene_id == "scene_mock"


def test_extract_memory_updates_mock() -> None:
    generator = AIGenerator(MockProvider())  # type: ignore[arg-type]
    update = generator.extract_memory_updates(
        SceneBeat(
            scene_id="scene_mock",
            title="Mock",
            summary="Mock scene.",
            chapter=1,
            commands=[{"type": "narration", "text": "A quiet room."}],
        ),
        MemoryMode.HYBRID,
        1,
    )
    assert update.summary_100


def test_generate_scene_passes_provider_selection() -> None:
    provider = MockProvider()
    generator = AIGenerator(provider)  # type: ignore[arg-type]
    selection = ProviderSelectionRequest(
        connection_id="conn_1",
        model_id="gpt-4o-mini",
        base_url="https://example.com/v1",
        api_key="test-key",
    )
    generator.generate_scene(
        current_scene="Alice enters.",
        previous_summary=None,
        author_goal="Create a tense beat.",
        memory_mode=MemoryMode.NONE,
        active_relations=[],
        emotional_memories=[],
        character_profiles=[],
        chapter=1,
        provider_selection=selection,
    )
    assert provider.last_selection == selection


def test_generate_scene_includes_editor_blueprint_context() -> None:
    provider = MockProvider()
    generator = AIGenerator(provider)  # type: ignore[arg-type]
    generator.generate_scene(
        current_scene="Alice enters.",
        previous_summary=None,
        author_goal="Create a tense beat.",
        memory_mode=MemoryMode.NONE,
        active_relations=[],
        emotional_memories=[],
        character_profiles=[],
        chapter=1,
        editor_context='{"tag_index":{"rain":["scene_opening"]},"scenes":[{"scene":{"tags":["rain"]}}]}',
    )

    assert "[Editor blueprint context JSON]" in provider.last_user_prompt
    assert '"tag_index"' in provider.last_user_prompt
    assert "scene_opening" in provider.last_user_prompt


def test_stream_generate_scene_passes_provider_selection() -> None:
    provider = MockProvider()
    generator = AIGenerator(provider)  # type: ignore[arg-type]
    selection = ProviderSelectionRequest(
        connection_id="conn_1",
        model_id="gpt-4o-mini",
        base_url="https://example.com/v1",
        api_key="test-key",
    )
    events = list(generator.stream_generate_scene(
        current_scene="Alice enters.",
        previous_summary=None,
        author_goal="Create a tense beat.",
        memory_mode=MemoryMode.NONE,
        active_relations=[],
        emotional_memories=[],
        character_profiles=[],
        chapter=1,
        provider_selection=selection,
    ))

    assert provider.last_selection == selection
    assert events[0] == ("status", "streaming")
    assert isinstance(events[-1][1], SceneBeat)
