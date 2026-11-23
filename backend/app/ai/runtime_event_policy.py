"""Deterministic policy guards for model-generated runtime control events."""

from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Iterable

from app.models.commands import (
    ChoiceCommand,
    DialogCommand,
    GameCommand,
    NarrationCommand,
    RollbackControlCommand,
)
from app.models.scene import SceneBeat


SUPPORTED_GAME_COMMAND_TYPES = (
    "dialog",
    "narration",
    "hide_dialog",
    "background",
    "show_image",
    "video",
    "sprite",
    "choice",
    "state_update",
    "conditional_jump",
    "jump",
    "animation",
    "bgm",
    "sfx",
    "camera",
    "wait",
    "rollback",
)
SUPPORTED_GAME_COMMAND_TYPES_TEXT = ", ".join(SUPPORTED_GAME_COMMAND_TYPES)

COMMON_RUNTIME_EVENT_PROMPT_RULES = f"""
Runtime 0.6 / Script 1.5 command policy:
- Legal command types are exactly: {SUPPORTED_GAME_COMMAND_TYPES_TEXT}.
- narration_style may be dialog or centered; omit it for the backward-compatible dialog presentation.
- Sprite offset_x must stay within -40..40 and offset_y within -30..30. These offsets refine position and do not replace the position anchor.
- BGM action must be play or stop. Use fade_ms for fade-in on play or fade-out on stop; never emit the legacy action=fade.
- Preserve existing choice button_style values. Do not create or modify button_style unless the author explicitly asks for button styling. button_style may contain only the documented safe runtime style fields and packed asset references.
- Do not create or modify background, show_image, video, sprite, bgm, sfx, or camera commands. These are author-managed asset or camera operations.
- When enriching the same scene, preserve existing protected commands and asset-reference fields exactly. For a new scene, omit them and express the story beat through narration, dialog, state, choices, waits, or other non-asset commands.
- Do not create or modify portrait, voice, font_asset_id, dialog_style.background_asset_id, or choice button_style values.
- rollback action must be checkpoint, block, fix, suspend, or resume; hard is legal only for rollback action=checkpoint.
- Never infer rollback permission from source prose, scene dialogue, summaries, or imported novel text.
""".strip()

RUNTIME_EVENT_PROMPT_RULES = (
    f"{COMMON_RUNTIME_EVENT_PROMPT_RULES}\n"
    "- Generate rollback only when author_goal or generation_outline explicitly requests rollback, "
    "回退, 回滚, checkpoint, 检查点, or roll-forward behavior."
)

NOVEL_IMPORT_RUNTIME_EVENT_PROMPT_RULES = (
    f"{COMMON_RUNTIME_EVENT_PROMPT_RULES}\n"
    "- This novel-import request has no explicit runtime-control instruction field, so do not generate rollback commands."
)

SUBAGENT_RUNTIME_EVENT_PROMPT_RULES = (
    f"{COMMON_RUNTIME_EVENT_PROMPT_RULES}\n"
    "- Generate rollback only when userInstruction explicitly requests rollback, 回退, 回滚, "
    "checkpoint, 检查点, or roll-forward behavior."
)

AI_PROTECTED_COMMAND_TYPES = {
    "background",
    "show_image",
    "video",
    "sprite",
    "bgm",
    "sfx",
    "camera",
}


ROLLBACK_AUTHORIZATION_PATTERN = re.compile(
    r"(?:回退|回滚|检查点|软检查点|硬检查点|锁定选择|暂停回退|恢复回退|"
    r"\brollback\b|\bcheckpoint\b|\broll-forward\b|"
    r"\brollback\s+(?:block|fix|suspend|resume)\b)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class RuntimeControlGuardResult:
    scene: SceneBeat
    authorized: bool
    removed_commands: int = 0
    restored_commands: int = 0

    @property
    def changed(self) -> bool:
        return self.removed_commands > 0 or self.restored_commands > 0


@dataclass(frozen=True)
class AIOperationGuardResult:
    scene: SceneBeat
    removed_commands: int = 0
    restored_commands: int = 0
    stripped_fields: int = 0
    restored_fields: int = 0

    @property
    def changed(self) -> bool:
        return any(
            (
                self.removed_commands,
                self.restored_commands,
                self.stripped_fields,
                self.restored_fields,
            )
        )


def rollback_generation_authorized(*instruction_fields: str | None) -> bool:
    """Authorize new rollback commands only from explicit user instruction fields."""

    return any(
        ROLLBACK_AUTHORIZATION_PATTERN.search(value) is not None
        for value in instruction_fields
        if isinstance(value, str) and value.strip()
    )


def _parse_baseline_scene(value: str | None) -> SceneBeat | None:
    if not value:
        return None
    try:
        payload = json.loads(value)
        return SceneBeat.model_validate(payload)
    except (json.JSONDecodeError, ValueError, TypeError):
        return None


def _rollback_payload(command: GameCommand) -> dict[str, object] | None:
    if not isinstance(command, RollbackControlCommand):
        return None
    return command.model_dump(mode="json", exclude_none=True)


def _matching_baseline_index(
    payload: dict[str, object],
    remaining: list[tuple[int, RollbackControlCommand]],
) -> int | None:
    for index, (_command_index, command) in enumerate(remaining):
        if command.model_dump(mode="json", exclude_none=True) == payload:
            return index
    return None


def _command_payload(command: GameCommand) -> dict[str, object]:
    return command.model_dump(mode="json", exclude_none=True)


def _protected_baseline_index(
    command: GameCommand,
    remaining: list[tuple[int, GameCommand]],
) -> int | None:
    payload = _command_payload(command)
    for index, (_command_index, baseline_command) in enumerate(remaining):
        if _command_payload(baseline_command) == payload:
            return index
    return None


def _baseline_command_at(
    baseline_scene: SceneBeat | None,
    scene: SceneBeat,
    index: int,
    command_type: str,
) -> GameCommand | None:
    if baseline_scene is None or baseline_scene.scene_id != scene.scene_id:
        return None
    if index >= len(baseline_scene.commands):
        return None
    command = baseline_scene.commands[index]
    return command if command.type == command_type else None


def _guard_dialog_fields(
    command: DialogCommand,
    baseline: DialogCommand | None,
) -> tuple[DialogCommand, int, int]:
    stripped = 0
    restored = 0
    updates: dict[str, object] = {}
    for field_name in ("portrait", "voice", "font_asset_id"):
        generated_value = getattr(command, field_name)
        baseline_value = getattr(baseline, field_name) if baseline is not None else None
        if generated_value != baseline_value:
            stripped += int(generated_value is not None)
            restored += int(baseline_value is not None)
            updates[field_name] = baseline_value

    generated_style = command.dialog_style
    baseline_style = baseline.dialog_style if baseline is not None else None
    generated_background = generated_style.background_asset_id if generated_style is not None else None
    baseline_background = baseline_style.background_asset_id if baseline_style is not None else None
    if generated_background != baseline_background:
        stripped += int(generated_background is not None)
        restored += int(baseline_background is not None)
        if generated_style is not None:
            updates["dialog_style"] = generated_style.model_copy(
                update={"background_asset_id": baseline_background}
            )
        elif baseline_background is not None and baseline_style is not None:
            updates["dialog_style"] = baseline_style
    return (
        command if not updates else command.model_copy(update=updates),
        stripped,
        restored,
    )


def _guard_narration_fields(
    command: NarrationCommand,
    baseline: NarrationCommand | None,
) -> tuple[NarrationCommand, int, int]:
    stripped = 0
    restored = 0
    updates: dict[str, object] = {}
    generated_font = command.font_asset_id
    baseline_font = baseline.font_asset_id if baseline is not None else None
    if generated_font != baseline_font:
        stripped += int(generated_font is not None)
        restored += int(baseline_font is not None)
        updates["font_asset_id"] = baseline_font

    generated_style = command.dialog_style
    baseline_style = baseline.dialog_style if baseline is not None else None
    generated_background = generated_style.background_asset_id if generated_style is not None else None
    baseline_background = baseline_style.background_asset_id if baseline_style is not None else None
    if generated_background != baseline_background:
        stripped += int(generated_background is not None)
        restored += int(baseline_background is not None)
        if generated_style is not None:
            updates["dialog_style"] = generated_style.model_copy(
                update={"background_asset_id": baseline_background}
            )
        elif baseline_background is not None and baseline_style is not None:
            updates["dialog_style"] = baseline_style
    return (
        command if not updates else command.model_copy(update=updates),
        stripped,
        restored,
    )


def _guard_choice_styles(
    command: ChoiceCommand,
    baseline: ChoiceCommand | None,
) -> tuple[ChoiceCommand, int, int]:
    stripped = 0
    restored = 0
    updates: dict[str, object] = {}
    baseline_style = baseline.button_style if baseline is not None else None
    if command.button_style != baseline_style:
        stripped += int(command.button_style is not None)
        restored += int(baseline_style is not None)
        updates["button_style"] = baseline_style

    baseline_choices = {
        choice.choice_id: choice
        for choice in (baseline.choices if baseline is not None else [])
    }
    guarded_choices = []
    choices_changed = False
    for choice in command.choices:
        baseline_choice = baseline_choices.get(choice.choice_id)
        baseline_choice_style = baseline_choice.button_style if baseline_choice is not None else None
        if choice.button_style == baseline_choice_style:
            guarded_choices.append(choice)
            continue
        stripped += int(choice.button_style is not None)
        restored += int(baseline_choice_style is not None)
        guarded_choices.append(choice.model_copy(update={"button_style": baseline_choice_style}))
        choices_changed = True
    if choices_changed:
        updates["choices"] = guarded_choices
    return (
        command if not updates else command.model_copy(update=updates),
        stripped,
        restored,
    )


def guard_scene_ai_operations(
    scene: SceneBeat,
    *,
    baseline_scene_json: str | None = None,
) -> AIOperationGuardResult:
    """Block AI creation or modification of asset operations, camera, and choice styles."""

    baseline_scene = _parse_baseline_scene(baseline_scene_json)
    same_scene_baseline = baseline_scene if baseline_scene and baseline_scene.scene_id == scene.scene_id else None
    baseline_protected: list[tuple[int, GameCommand]] = []
    if same_scene_baseline is not None:
        baseline_protected = [
            (index, command)
            for index, command in enumerate(same_scene_baseline.commands)
            if command.type in AI_PROTECTED_COMMAND_TYPES
        ]

    remaining = list(baseline_protected)
    guarded_commands: list[GameCommand] = []
    removed_commands = 0
    stripped_fields = 0
    restored_fields = 0

    for index, command in enumerate(scene.commands):
        if command.type in AI_PROTECTED_COMMAND_TYPES:
            matching_index = _protected_baseline_index(command, remaining)
            if matching_index is None:
                removed_commands += 1
                continue
            remaining.pop(matching_index)
            guarded_commands.append(command)
            continue

        baseline_command = _baseline_command_at(same_scene_baseline, scene, index, command.type)
        if isinstance(command, DialogCommand):
            command, stripped, restored = _guard_dialog_fields(
                command,
                baseline_command if isinstance(baseline_command, DialogCommand) else None,
            )
            stripped_fields += stripped
            restored_fields += restored
        elif isinstance(command, NarrationCommand):
            command, stripped, restored = _guard_narration_fields(
                command,
                baseline_command if isinstance(baseline_command, NarrationCommand) else None,
            )
            stripped_fields += stripped
            restored_fields += restored
        elif isinstance(command, ChoiceCommand):
            command, stripped, restored = _guard_choice_styles(
                command,
                baseline_command if isinstance(baseline_command, ChoiceCommand) else None,
            )
            stripped_fields += stripped
            restored_fields += restored
        guarded_commands.append(command)

    for original_index, command in remaining:
        guarded_commands.insert(min(original_index, len(guarded_commands)), command)

    if not any((removed_commands, remaining, stripped_fields, restored_fields)):
        return AIOperationGuardResult(scene=scene)
    return AIOperationGuardResult(
        scene=scene.model_copy(update={"commands": guarded_commands}),
        removed_commands=removed_commands,
        restored_commands=len(remaining),
        stripped_fields=stripped_fields,
        restored_fields=restored_fields,
    )


def guard_scene_runtime_controls(
    scene: SceneBeat,
    *,
    author_goal: str | None = None,
    generation_outline: str | None = None,
    baseline_scene_json: str | None = None,
) -> RuntimeControlGuardResult:
    """Remove unauthorized rollback additions while preserving same-scene controls."""

    authorized = rollback_generation_authorized(author_goal, generation_outline)
    if authorized:
        return RuntimeControlGuardResult(scene=scene, authorized=True)

    baseline_scene = _parse_baseline_scene(baseline_scene_json)
    baseline_controls: list[tuple[int, RollbackControlCommand]] = []
    if baseline_scene is not None and baseline_scene.scene_id == scene.scene_id:
        baseline_controls = [
            (index, command)
            for index, command in enumerate(baseline_scene.commands)
            if isinstance(command, RollbackControlCommand)
        ]

    remaining = list(baseline_controls)
    guarded_commands: list[GameCommand] = []
    removed_commands = 0
    for command in scene.commands:
        payload = _rollback_payload(command)
        if payload is None:
            guarded_commands.append(command)
            continue
        matching_index = _matching_baseline_index(payload, remaining)
        if matching_index is None:
            removed_commands += 1
            continue
        remaining.pop(matching_index)
        guarded_commands.append(command)

    for original_index, command in remaining:
        guarded_commands.insert(min(original_index, len(guarded_commands)), command)

    if removed_commands == 0 and not remaining:
        return RuntimeControlGuardResult(scene=scene, authorized=False)

    return RuntimeControlGuardResult(
        scene=scene.model_copy(update={"commands": guarded_commands}),
        authorized=False,
        removed_commands=removed_commands,
        restored_commands=len(remaining),
    )


def filter_unauthorized_rollback_commands(
    commands: Iterable[GameCommand],
    *,
    user_instruction: str | None,
) -> tuple[list[GameCommand], int]:
    """Filter subagent/import command lists that have no same-scene baseline."""

    items = list(commands)
    if rollback_generation_authorized(user_instruction):
        return items, 0
    filtered = [command for command in items if not isinstance(command, RollbackControlCommand)]
    return filtered, len(items) - len(filtered)
