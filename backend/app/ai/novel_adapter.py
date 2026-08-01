"""Heuristic novel adapter with an AI-provider-ready boundary."""

import re

from app.models.commands import BackgroundCommand, DialogCommand, NarrationCommand
from app.models.novel_import import (
    AdaptSceneRequest,
    AdaptSceneResponse,
    AdaptedScene,
    AssetSuggestion,
    SourceMapping,
)
from app.models.scene import SceneBeat
from app.utils.ids import new_id


SPEECH_VERBS = (
    "低声道",
    "轻声道",
    "低声说",
    "轻声说",
    "喃喃道",
    "答道",
    "笑道",
    "说道",
    "回答",
    "问道",
    "喊道",
    "叫道",
    "说",
    "问",
    "喊",
)
SPEECH_VERB_PATTERN = "|".join(re.escape(verb) for verb in SPEECH_VERBS)
SPEAKER_PATTERN = re.compile(
    rf"(?:^|[\n。！？!?，,、\s])([A-Za-z][A-Za-z0-9_ -]{{0,31}}|[\u4e00-\u9fff]{{1,6}})(?:{SPEECH_VERB_PATTERN})\s*[：:，,」』\"“‘]"
)
DIALOGUE_PATTERN = re.compile(r"[“「『\"](.+?)[”」』\"]")


def extract_speaker(line: str) -> str | None:
    match = SPEAKER_PATTERN.search(line)
    return match.group(1).strip() if match else None


def extract_dialogue_text(line: str) -> str | None:
    quoted = DIALOGUE_PATTERN.search(line)
    if quoted:
        return quoted.group(1).strip()
    colon = re.search(r"[：:]\s*(.+)$", line)
    return colon.group(1).strip() if colon else None


class NovelAdapter:
    """Converts one scene candidate into a reviewable SceneBeat."""

    def adapt_scene(self, request: AdaptSceneRequest) -> AdaptSceneResponse:
        candidate = request.scene_candidate
        scene_display_name = candidate.display_name or candidate.title or f"第 {candidate.index + 1} 场"
        commands = [
            BackgroundCommand(
                background_id=f"bg_{candidate.location_hint or 'unknown'}",
                background_fit="stretch",
                transition="fade",
                transition_display_name="淡入过场",
            )
        ]
        warnings: list[str] = []
        for line in [item.strip() for item in candidate.source_excerpt.splitlines() if item.strip()][:12]:
            dialogue_text = extract_dialogue_text(line)
            if dialogue_text:
                speaker = extract_speaker(line) or (candidate.characters[0] if candidate.characters else "unknown_speaker")
                if speaker == "unknown_speaker":
                    warnings.append("无法确定说话人。")
                commands.append(DialogCommand(character_id=speaker, text=dialogue_text, emotion="neutral"))
            else:
                commands.append(NarrationCommand(text=line[:180]))
        scene = SceneBeat(
            scene_id=new_id("scene"),
            scene_display_name=scene_display_name,
            title=candidate.title,
            summary=candidate.summary,
            commands=commands,
            tags=["novel_import"],
            chapter=1,
        )
        mapping = SourceMapping(
            document_id="unknown",
            start_offset=candidate.start_offset,
            end_offset=candidate.end_offset,
            source_excerpt=candidate.source_excerpt,
            adapted_command_ids=[f"{scene.scene_id}_cmd_{index}" for index, _ in enumerate(scene.commands)],
        )
        adapted = AdaptedScene(
            adapted_scene_id=new_id("adapted"),
            source_scene_candidate_id=candidate.scene_candidate_id,
            scene_beat=scene,
            source_mapping=mapping,
            warnings=warnings,
            needs_review=bool(warnings),
        )
        asset_suggestions = []
        if request.import_options.generate_background_hints:
            asset_suggestions.append(
                AssetSuggestion(
                    suggestion_id=new_id("asset_suggestion"),
                    asset_type="background",
                    description=candidate.location_hint or "未知地点背景",
                    suggested_asset_id=f"bg_{candidate.location_hint or 'unknown'}",
                    prompt_hint=f"visual novel background, {candidate.location_hint or 'unknown location'}",
                    source_scene_id=scene.scene_id,
                    source_scene_display_name=scene.scene_display_name,
                )
            )
        return AdaptSceneResponse(
            adapted_scene=adapted,
            asset_suggestions=asset_suggestions,
            warnings=warnings,
        )
