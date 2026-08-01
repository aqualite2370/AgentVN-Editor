"""Prompt builders for structured visual novel generation."""

from app.models.common import MemoryMode
from app.models.memory import CharacterProfile, RelationEdge, RetrievedMemory


SCENE_SYSTEM_PROMPT = """
You are a structured visual novel scenario generation engine.
You are not a chatbot and not a prose continuation assistant.
Use the required AgentVN MCP tool to create the final SceneBeat.
Do not put JSON in assistant text; ordinary text is only for brief reasoning or debug notes.

[Frozen character profiles] Character profiles describe stable character identity and speaking style.
[Objective world facts] ChronicleGraph relations are objective world state and should not be contradicted.
[Subjective memories] EmotionTrace items are character-specific perceptions and may be mistaken.
[Author goal] Follow the author goal while keeping all commands legal GameCommand objects.

Output rules:
1. Finish by calling the provided create_scene_beat MCP tool.
2. scene_id / choice_id / animation_id and similar *_id fields are stable indexes only.
3. scene_display_name / choice_display_name / animation_display_name / transition_display_name are human-readable Chinese aliases.
4. Human-facing titles, summaries, aliases, and descriptions must be in Chinese.
5. BackgroundCommand.transition and SpriteCommand.animation are 过场动画.
6. AnimationCommand(type="animation") is 演出动画.
7. Use ShowImageCommand(type="show_image") for key items, clues, photos, letters, and props that should temporarily fill the player's attention. It blocks until the player dismisses it.
8. Legal command types are exactly: dialog, narration, hide_dialog, background, show_image, video, sprite, choice, state_update, conditional_jump, jump, animation, bgm, sfx, camera, wait.
9. CameraCommand may use either structured `motion` or legacy `action`/`params`, but never mix the two formats in one command. Prefer structured `motion` for new camera work.
10. Preserve existing legal commands and their rich fields when editing or enriching an existing scene unless the author explicitly asks to replace them.
""".strip()


MEMORY_SYSTEM_PROMPT = """
You extract structured long-term memory updates from a visual novel scene.
Finish by calling the provided extract_memory_update MCP tool.
Create objective relation changes only when the scene clearly changes world state.
Create subjective emotion snapshots for character-specific recall.
summary_100 must be no more than 100 Chinese characters or 100 English characters.
Use only these top-level keys: summary_100, invalidated_relations, new_relations, emotion_snapshots.
Do not use objective_relations or subjective_snapshots.
""".strip()


def _memory_mode_value(memory_mode: MemoryMode | str) -> str:
    return memory_mode.value if isinstance(memory_mode, MemoryMode) else memory_mode


def build_scene_user_prompt(
    current_scene: str,
    previous_summary: str | None,
    author_goal: str,
    memory_mode: MemoryMode | str,
    active_relations: list[RelationEdge],
    emotional_memories: list[RetrievedMemory],
    character_profiles: list[CharacterProfile],
    chapter: int,
    target_scene_stub: str | None = None,
    generation_outline: str | None = None,
    editor_context: str | None = None,
) -> str:
    """Build the user prompt with strict context partitioning."""

    outline = generation_outline.strip() if generation_outline else ""
    blueprint_context = editor_context.strip() if editor_context else ""
    target_stub_block = f"[Target scene stub JSON] {target_scene_stub}" if target_scene_stub else "[Target scene stub JSON] None. Generate a successor scene after the current scene."
    outline_block = (
        f"[Author next-step outline] {outline}\nPriority: high. Follow this outline unless it directly conflicts with schema legality or established story facts."
        if outline
        else "[Author next-step outline] None provided. Decide the next beat yourself while staying consistent with context."
    )
    editor_context_block = (
        "[Editor blueprint context JSON]\n"
        f"{blueprint_context}\n"
        "Use this global blueprint context to maintain scene continuity, chapter order, tags, branch targets, character usage, asset IDs, and existing graph structure. "
        "Do not copy editor-only positions or node IDs into player-facing prose unless they are explicit stable scene IDs."
        if blueprint_context
        else "[Editor blueprint context JSON] None provided."
    )

    return f"""
Target chapter chosen by author: {chapter}
Chapter guidance: treat this number as the intended chapter for the generated SceneBeat. If it advances beyond the context scene's chapter, consider a new act, time jump, or later narrative phase when appropriate.
Memory mode: {_memory_mode_value(memory_mode)}

[Frozen character profiles] {[profile.model_dump(mode="json") for profile in character_profiles]}
[Objective world facts] {[relation.model_dump(mode="json") for relation in active_relations]}
[Subjective memories] {[memory.model_dump(mode="json", exclude={"embedding"}) for memory in emotional_memories]}
[Current/context scene JSON] {current_scene}
{target_stub_block}
[Editor-global reference]
{editor_context_block}
[Previous summary] {previous_summary or ""}
[Author goal] {author_goal}
{outline_block}
""".strip()


def build_memory_user_prompt(scene_json: str, memory_mode: MemoryMode | str, chapter: int) -> str:
    """Build prompt for memory extraction."""

    return f"""
Chapter: {chapter}
Memory mode: {_memory_mode_value(memory_mode)}

SceneBeat JSON:
{scene_json}
""".strip()
