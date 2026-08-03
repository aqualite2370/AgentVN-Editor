"""Targeted compatibility repairs for model-produced structured payloads."""

from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

from pydantic import BaseModel

from app.models.novel_import import (
    AdaptSceneResponse,
    NovelAiChapterScenePlan,
    NovelAiBranchSuggestionResponse,
    NovelAiChunkAnalysis,
    NovelAiChunkEntityIndex,
    NovelAiChunkSummary,
    NovelAiChunkTimelineNotes,
    NovelAiConflictAnalysisResponse,
    NovelAiOutlineIndex,
    NovelAiOutlineMainline,
    NovelAiOutlineResponse,
    NovelAiOutlineStructure,
    NovelAiScenePlanResponse,
)
from app.models.novel_process import SubagentModelOutput
from app.models.scene import SceneBeat


ANIMATION_PARAM_ALIASES = (
    "duration",
    "duration_ms",
    "loop",
    "repeat",
    "delay",
    "delay_ms",
    "easing",
    "direction",
    "intensity",
    "x",
    "y",
    "scale",
    "opacity",
    "rotation",
)


def normalize_structured_payload(response_model: type[BaseModel], payload: Any) -> Any:
    """Repair known near-miss model payloads before strict Pydantic validation."""

    model_name = response_model.__name__

    if response_model is SceneBeat or model_name == "SceneBeat":
        return _normalize_scene_beat_payload(payload)
    if response_model is SubagentModelOutput or model_name == "SubagentModelOutput":
        return _normalize_subagent_model_output(payload)
    if response_model is NovelAiChunkAnalysis or model_name == "NovelAiChunkAnalysis":
        return _normalize_novel_chunk_analysis(payload)
    if response_model is NovelAiChunkSummary or model_name == "NovelAiChunkSummary":
        return _normalize_novel_chunk_summary(payload)
    if response_model is NovelAiChunkEntityIndex or model_name == "NovelAiChunkEntityIndex":
        return _normalize_novel_chunk_entities(payload)
    if response_model is NovelAiChunkTimelineNotes or model_name == "NovelAiChunkTimelineNotes":
        return _normalize_novel_chunk_timeline(payload)
    if response_model is NovelAiOutlineResponse or model_name == "NovelAiOutlineResponse":
        return _normalize_novel_outline(payload)
    if response_model is NovelAiOutlineMainline or model_name == "NovelAiOutlineMainline":
        return _normalize_novel_outline_mainline(payload)
    if response_model is NovelAiOutlineStructure or model_name == "NovelAiOutlineStructure":
        return _normalize_novel_outline_structure(payload)
    if response_model is NovelAiOutlineIndex or model_name == "NovelAiOutlineIndex":
        return _normalize_novel_outline_index(payload)
    if response_model is NovelAiScenePlanResponse or model_name == "NovelAiScenePlanResponse":
        return _normalize_novel_scene_plan(payload)
    if response_model is NovelAiChapterScenePlan or model_name == "NovelAiChapterScenePlan":
        return _normalize_novel_chapter_scene_plan(payload)
    if response_model is AdaptSceneResponse or model_name == "AdaptSceneResponse":
        return _normalize_adapt_scene_response(payload)
    if response_model is NovelAiConflictAnalysisResponse or model_name == "NovelAiConflictAnalysisResponse":
        return _normalize_conflict_analysis_response(payload)
    if response_model is NovelAiBranchSuggestionResponse or model_name == "NovelAiBranchSuggestionResponse":
        return _normalize_branch_suggestion_response(payload)
    return payload


def _rename_first(payload: dict[str, Any], target: str, aliases: tuple[str, ...]) -> None:
    if target in payload:
        return
    for alias in aliases:
        if alias in payload:
            payload[target] = payload.pop(alias)
            return


def _ensure_list(payload: dict[str, Any], key: str) -> None:
    value = payload.get(key)
    if value is None:
        payload[key] = []
    elif not isinstance(value, list):
        payload[key] = [value]


def _stringify_compact(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return "；".join(filter(None, (_stringify_compact(item) for item in value)))
    if isinstance(value, dict):
        primary = None
        for key in ("name", "title", "location", "place", "id", "value"):
            if value.get(key) not in (None, ""):
                primary = str(value[key])
                break
        detail = None
        for key in ("description", "summary", "detail", "text", "note"):
            if value.get(key) not in (None, ""):
                detail = str(value[key])
                break
        if primary and detail and detail != primary:
            return f"{primary}：{detail}"
        if primary:
            return primary
        if detail:
            return detail
        return "；".join(
            f"{key}={_stringify_compact(item)}"
            for key, item in value.items()
            if item not in (None, "", [])
        )
    return str(value)


def _normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    return [text for text in (_stringify_compact(item) for item in items) if text]


def _normalize_chapter(value: Any, index: int = 0) -> Any:
    if not isinstance(value, dict):
        return value
    chapter = deepcopy(value)
    _rename_first(chapter, "chapter_id", ("id", "chapterId"))
    _rename_first(chapter, "title", ("name", "chapter_title"))
    _rename_first(chapter, "summary", ("description", "outline"))
    chapter.setdefault("chapter_id", f"chapter_{index + 1}")
    chapter.setdefault("title", f"章节 {index + 1}")
    chapter.setdefault("index", index)
    chapter.setdefault("start_offset", 0)
    chapter.setdefault("end_offset", chapter.get("start_offset", 0))
    chapter.setdefault("summary", "")
    chapter.setdefault("confidence", 0.5)
    return chapter


def _normalize_character(value: Any, index: int = 0) -> Any:
    if not isinstance(value, dict):
        return None
    character = deepcopy(value)
    explicit_name = next(
        (
            str(character[key]).strip()
            for key in ("name", "display_name", "character_name")
            if character.get(key) not in (None, "")
        ),
        "",
    )
    _rename_first(character, "character_id", ("id", "characterId"))
    _rename_first(character, "name", ("display_name", "character_name"))
    _rename_first(character, "description", ("summary", "profile"))
    alias = character.pop("alias", None)
    character.setdefault("name", f"角色 {index + 1}")
    character.setdefault("character_id", str(character["name"]).lower().replace(" ", "_") or f"character_{index + 1}")
    aliases = character.get("aliases", [])
    if aliases is None:
        aliases = []
    elif not isinstance(aliases, list):
        aliases = [aliases]
    aliases = _normalize_string_list(aliases)
    if alias not in (None, ""):
        for alias_item in _normalize_string_list(alias):
            if alias_item not in aliases and alias_item != character.get("name"):
                aliases.append(alias_item)
    character["aliases"] = aliases
    character.setdefault("first_seen_offset", 0)
    character.setdefault("description", "")
    character.setdefault("confidence", 0.5)
    character["character_id"] = str(character.get("character_id") or "").strip()
    character["name"] = explicit_name or str(character.get("name") or "").strip()
    character["description"] = str(character.get("description") or "").strip()
    if (
        not character["character_id"]
        or not character["name"]
        or not explicit_name
        or not character["description"]
        or _looks_like_character_description(character["name"])
    ):
        return None
    for key in list(character.keys()):
        if key not in {
            "character_id",
            "name",
            "aliases",
            "first_seen_offset",
            "description",
            "speaking_style_hint",
            "confidence",
        }:
            character.pop(key, None)
    return character


def _looks_like_character_description(value: str) -> bool:
    text = value.strip()
    if not text:
        return True
    if len(text) > 24:
        return True
    return any(mark in text for mark in ("\uFF0C", "\u3002", "\uFF1B", "\uFF1A", ",", ".", ";", ":"))


def _normalize_characters(values: list[Any]) -> list[Any]:
    return [
        character
        for idx, item in enumerate(values)
        if (character := _normalize_character(item, idx)) is not None
    ]


def _normalize_scene_candidate(value: Any, index: int = 0) -> Any:
    if not isinstance(value, dict):
        return value
    scene = deepcopy(value)
    _rename_first(scene, "scene_candidate_id", ("id", "scene_id", "sceneCandidateId"))
    _rename_first(scene, "display_name", ("scene_display_name", "displayName"))
    _rename_first(scene, "summary", ("description", "outline"))
    _rename_first(scene, "source_span", ("sourceSpan", "span", "source_range", "sourceRange"))
    scene.setdefault("scene_candidate_id", f"scene_candidate_{index + 1}")
    scene.setdefault("chapter_id", "chapter_1")
    scene.setdefault("title", scene.get("display_name") or f"场景 {index + 1}")
    scene.setdefault("index", index)
    scene.setdefault("start_offset", 0)
    scene.setdefault("end_offset", scene.get("start_offset", 0))
    if isinstance(scene.get("source_span"), dict):
        span = scene["source_span"]
        _rename_first(span, "start_offset", ("start", "startOffset", "from"))
        _rename_first(span, "end_offset", ("end", "endOffset", "to"))
        span.setdefault("start_offset", scene.get("start_offset", 0))
        span.setdefault("end_offset", scene.get("end_offset", span.get("start_offset", 0)))
        scene["start_offset"] = span.get("start_offset", scene["start_offset"])
        scene["end_offset"] = span.get("end_offset", scene["end_offset"])
    else:
        scene["source_span"] = {
            "start_offset": scene.get("start_offset", 0),
            "end_offset": scene.get("end_offset", scene.get("start_offset", 0)),
        }
    scene.setdefault("characters", [])
    scene.setdefault("source_excerpt", "")
    scene.setdefault("summary", "")
    if not isinstance(scene.get("commands"), list) or not scene["commands"]:
        text = str(scene.get("summary") or scene.get("source_excerpt") or "")
        scene["commands"] = [{"type": "narration", "text": text[:180] or "待改编场景"}]
    else:
        command_holder = _normalize_scene_beat_payload({"commands": scene["commands"]})
        scene["commands"] = command_holder.get("commands", scene["commands"])
    scene.setdefault("confidence", 0.5)
    return scene


def _normalize_novel_chunk_analysis(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "chunk_id", ("id", "chunkId", "text_chunk_id"))
    _rename_first(normalized, "index", ("chunk_index", "chunkIndex"))
    _rename_first(normalized, "chapter_candidates", ("chapters", "chapterCandidates"))
    _rename_first(normalized, "characters", ("character_candidates", "characterCandidates"))
    _rename_first(normalized, "locations", ("location", "places"))
    _rename_first(normalized, "timeline", ("times", "time_points", "events"))
    _rename_first(normalized, "foreshadowing", ("foreshadows", "hints"))
    plot_elements = normalized.pop("plot_elements", None)
    for key in ("chapter_candidates", "characters", "locations", "timeline", "foreshadowing", "warnings"):
        _ensure_list(normalized, key)
    if plot_elements not in (None, "", []):
        normalized["foreshadowing"].extend(_normalize_string_list(plot_elements))
        normalized["warnings"].append("模型返回了 plot_elements，已按伏笔/事件提示归入 foreshadowing。")
    normalized["chapter_candidates"] = [_normalize_chapter(item, idx) for idx, item in enumerate(normalized["chapter_candidates"])]
    normalized["characters"] = _normalize_characters(normalized["characters"])
    normalized["locations"] = _normalize_string_list(normalized["locations"])
    normalized["timeline"] = _normalize_string_list(normalized["timeline"])
    normalized["foreshadowing"] = _normalize_string_list(normalized["foreshadowing"])
    normalized["warnings"] = _normalize_string_list(normalized["warnings"])
    normalized.setdefault("chunk_id", "chunk_1")
    normalized.setdefault("index", 0)
    normalized.setdefault("summary", "")
    normalized.setdefault("confidence", 0.5)
    for key in list(normalized.keys()):
        if key not in {
            "chunk_id",
            "index",
            "summary",
            "chapter_candidates",
            "characters",
            "locations",
            "timeline",
            "foreshadowing",
            "warnings",
            "confidence",
        }:
            normalized.pop(key, None)
    return normalized


def _normalize_novel_chunk_summary(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "chunk_id", ("id", "chunkId", "text_chunk_id", "document_id"))
    _rename_first(normalized, "index", ("chunk_index", "chunkIndex", "chunk_order"))
    _rename_first(normalized, "summary", ("description", "outline", "main_summary"))
    _rename_first(normalized, "confidence", ("coverage_confidence", "score"))
    _ensure_list(normalized, "warnings")
    normalized["warnings"] = _normalize_string_list(normalized["warnings"])
    normalized.setdefault("chunk_id", "chunk_1")
    normalized.setdefault("index", 0)
    normalized.setdefault("summary", "")
    normalized.setdefault("confidence", 0.5)
    for key in list(normalized.keys()):
        if key not in {"chunk_id", "index", "summary", "confidence", "warnings"}:
            normalized.pop(key, None)
    return normalized


def _normalize_novel_chunk_entities(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "chapter_candidates", ("chapters", "chapterCandidates"))
    _rename_first(normalized, "characters", ("character_candidates", "characterCandidates"))
    _rename_first(normalized, "locations", ("location", "places"))
    for key in ("chapter_candidates", "characters", "locations", "warnings"):
        _ensure_list(normalized, key)
    normalized["chapter_candidates"] = [
        _normalize_chapter(item, idx)
        for idx, item in enumerate(normalized["chapter_candidates"])
    ]
    normalized["characters"] = _normalize_characters(normalized["characters"])
    normalized["locations"] = _normalize_string_list(normalized["locations"])
    normalized["warnings"] = _normalize_string_list(normalized["warnings"])
    for key in list(normalized.keys()):
        if key not in {"chapter_candidates", "characters", "locations", "warnings"}:
            normalized.pop(key, None)
    return normalized


def _normalize_novel_chunk_timeline(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "timeline", ("times", "time_points", "events"))
    _rename_first(normalized, "foreshadowing", ("foreshadows", "hints", "plot_elements", "conflicts"))
    for key in ("timeline", "foreshadowing", "warnings"):
        _ensure_list(normalized, key)
    normalized["timeline"] = _normalize_string_list(normalized["timeline"])
    normalized["foreshadowing"] = _normalize_string_list(normalized["foreshadowing"])
    normalized["warnings"] = _normalize_string_list(normalized["warnings"])
    for key in list(normalized.keys()):
        if key not in {"timeline", "foreshadowing", "warnings"}:
            normalized.pop(key, None)
    return normalized


def _normalize_novel_outline(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "document_id", ("doc_id", "documentId"))
    _rename_first(normalized, "main_plot", ("plot", "mainPlot"))
    _rename_first(normalized, "branch_or_foreshadowing", ("foreshadowing", "branches", "hints"))
    _rename_first(normalized, "coverage_confidence", ("confidence", "coverageConfidence"))
    for key in ("chapters", "characters", "timeline", "locations", "branch_or_foreshadowing", "conflict_points", "warnings"):
        _ensure_list(normalized, key)
    normalized["chapters"] = [_normalize_chapter(item, idx) for idx, item in enumerate(normalized["chapters"])]
    normalized["characters"] = _normalize_characters(normalized["characters"])
    normalized["timeline"] = _normalize_string_list(normalized["timeline"])
    normalized["locations"] = _normalize_string_list(normalized["locations"])
    normalized["branch_or_foreshadowing"] = _normalize_string_list(normalized["branch_or_foreshadowing"])
    normalized["warnings"] = _normalize_string_list(normalized["warnings"])
    normalized.setdefault("document_id", "document_1")
    normalized.setdefault("title", "未命名小说")
    normalized.setdefault("summary", "")
    normalized.setdefault("main_plot", normalized.get("summary", ""))
    normalized.setdefault("needs_review", False)
    normalized.setdefault("coverage_confidence", 0.5)
    return normalized


def _normalize_novel_outline_mainline(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "document_id", ("doc_id", "documentId"))
    _rename_first(normalized, "main_plot", ("plot", "mainPlot"))
    _rename_first(normalized, "coverage_confidence", ("confidence", "coverageConfidence"))
    _ensure_list(normalized, "warnings")
    normalized["warnings"] = _normalize_string_list(normalized["warnings"])
    normalized.setdefault("document_id", "document_1")
    normalized.setdefault("title", "未命名小说")
    normalized.setdefault("summary", "")
    normalized.setdefault("main_plot", normalized.get("summary", ""))
    normalized.setdefault("needs_review", False)
    normalized.setdefault("coverage_confidence", 0.5)
    for key in list(normalized.keys()):
        if key not in {"document_id", "title", "summary", "main_plot", "needs_review", "coverage_confidence", "warnings"}:
            normalized.pop(key, None)
    return normalized


def _normalize_novel_outline_structure(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "branch_or_foreshadowing", ("foreshadowing", "branches", "hints", "plot_elements"))
    _rename_first(normalized, "conflict_points", ("conflicts", "issues", "conflictPoints"))
    for key in ("chapters", "timeline", "branch_or_foreshadowing", "conflict_points", "warnings"):
        _ensure_list(normalized, key)
    normalized["chapters"] = [_normalize_chapter(item, idx) for idx, item in enumerate(normalized["chapters"])]
    normalized["timeline"] = _normalize_string_list(normalized["timeline"])
    normalized["branch_or_foreshadowing"] = _normalize_string_list(normalized["branch_or_foreshadowing"])
    normalized["conflict_points"] = [
        _normalize_conflict_point(item, idx)
        for idx, item in enumerate(normalized["conflict_points"])
    ]
    normalized["warnings"] = _normalize_string_list(normalized["warnings"])
    for key in list(normalized.keys()):
        if key not in {"chapters", "timeline", "branch_or_foreshadowing", "conflict_points", "warnings"}:
            normalized.pop(key, None)
    return normalized


def _normalize_novel_outline_index(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "characters", ("character_candidates", "characterCandidates"))
    _rename_first(normalized, "locations", ("location", "places"))
    for key in ("characters", "locations", "warnings"):
        _ensure_list(normalized, key)
    normalized["characters"] = _normalize_characters(normalized["characters"])
    normalized["locations"] = _normalize_string_list(normalized["locations"])
    normalized["warnings"] = _normalize_string_list(normalized["warnings"])
    for key in list(normalized.keys()):
        if key not in {"characters", "locations", "warnings"}:
            normalized.pop(key, None)
    return normalized


def _normalize_novel_scene_plan(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "chapter_id", ("id", "chapterId"))
    _rename_first(normalized, "scenes", ("scene_candidates", "sceneCandidates"))
    _rename_first(normalized, "branch_suggestions", ("branches", "branchSuggestions", "suggestions"))
    for key in ("scenes", "conflict_points", "branch_suggestions", "warnings"):
        _ensure_list(normalized, key)
    normalized["scenes"] = [_normalize_scene_candidate(item, idx) for idx, item in enumerate(normalized["scenes"])]
    normalized["conflict_points"] = [
        _normalize_conflict_point(item, idx)
        for idx, item in enumerate(normalized["conflict_points"])
    ]
    normalized["branch_suggestions"] = [
        _normalize_branch_suggestion(item, idx)
        for idx, item in enumerate(normalized["branch_suggestions"])
    ]
    normalized.setdefault("chapter_id", "chapter_1")
    normalized.setdefault("needs_review", False)
    return normalized


def _normalize_novel_chapter_scene_plan(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "chapter_id", ("id", "chapterId"))
    _rename_first(normalized, "scenes", ("scene_candidates", "sceneCandidates"))
    for key in ("scenes", "warnings"):
        _ensure_list(normalized, key)
    normalized["scenes"] = [_normalize_scene_candidate(item, idx) for idx, item in enumerate(normalized["scenes"])]
    normalized["warnings"] = _normalize_string_list(normalized["warnings"])
    normalized.setdefault("chapter_id", "chapter_1")
    normalized.setdefault("needs_review", False)
    for key in list(normalized.keys()):
        if key not in {"chapter_id", "scenes", "warnings", "needs_review"}:
            normalized.pop(key, None)
    return normalized


def _normalize_adapt_scene_response(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "adapted_scene", ("adaptedScene", "scene"))
    if "adapted_scene" not in normalized and _looks_like_adapted_scene_payload(normalized):
        normalized["adapted_scene"] = _take_adapted_scene_fields(normalized)
    adapted = normalized.get("adapted_scene")
    if isinstance(adapted, list):
        if adapted and isinstance(adapted[0], dict) and _looks_like_adapted_scene_payload(adapted[0]):
            adapted = adapted[0]
        else:
            adapted = {"scene_beat": adapted}
        normalized["adapted_scene"] = adapted
    if isinstance(adapted, dict):
        for key in ("branch_suggestions", "conflict_points"):
            value = adapted.pop(key, None)
            if value is not None and key not in normalized:
                normalized[key] = value
        review_notes = adapted.pop("review_notes", None)
        if review_notes not in (None, "", []):
            warnings = adapted.setdefault("warnings", [])
            if isinstance(warnings, list):
                warnings.append(str(review_notes))
    for key in ("character_updates", "asset_suggestions", "branch_suggestions", "conflict_points", "warnings"):
        _ensure_list(normalized, key)
    normalized["conflict_points"] = [
        _normalize_conflict_point(item, idx)
        for idx, item in enumerate(normalized["conflict_points"])
    ]
    normalized["branch_suggestions"] = [
        _normalize_branch_suggestion(item, idx)
        for idx, item in enumerate(normalized["branch_suggestions"])
    ]
    if isinstance(adapted, dict):
        _normalize_adapted_scene(adapted)
    allowed_keys = {
        "adapted_scene",
        "character_updates",
        "asset_suggestions",
        "branch_suggestions",
        "conflict_points",
        "warnings",
    }
    for key in list(normalized.keys()):
        if key not in allowed_keys:
            normalized.pop(key, None)
    return normalized


def _looks_like_adapted_scene_payload(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    markers = {
        "adapted_scene_id",
        "adaptedSceneId",
        "id",
        "source_scene_candidate_id",
        "sourceSceneCandidateId",
        "source_id",
        "scene_candidate_id",
        "scene_beat",
        "sceneBeat",
        "source_mapping",
        "sourceMapping",
        "mapping",
        "commands",
        "title",
        "summary",
        "scene_id",
    }
    return any(key in value for key in markers)


def _take_adapted_scene_fields(payload: dict[str, Any]) -> dict[str, Any]:
    adapted_keys = {
        "adapted_scene_id",
        "adaptedSceneId",
        "id",
        "source_scene_candidate_id",
        "sourceSceneCandidateId",
        "source_id",
        "scene_candidate_id",
        "scene_beat",
        "sceneBeat",
        "beat",
        "source_mapping",
        "sourceMapping",
        "mapping",
        "warnings",
        "needs_review",
        "needsReview",
        "review_notes",
        "title",
        "summary",
        "commands",
        "scene_id",
        "sceneId",
        "scene_display_name",
        "sceneDisplayName",
        "tags",
        "chapter",
    }
    return {key: payload.pop(key) for key in list(payload.keys()) if key in adapted_keys}


def _normalize_conflict_analysis_response(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "conflict_points", ("conflicts", "conflictPoints", "issues"))
    _ensure_list(normalized, "conflict_points")
    _ensure_list(normalized, "warnings")
    normalized["conflict_points"] = [
        _normalize_conflict_point(item, idx)
        for idx, item in enumerate(normalized["conflict_points"])
    ]
    return normalized


def _normalize_branch_suggestion_response(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    _rename_first(normalized, "branch_suggestions", ("branches", "branchSuggestions", "suggestions"))
    _ensure_list(normalized, "branch_suggestions")
    _ensure_list(normalized, "warnings")
    normalized["branch_suggestions"] = [
        _normalize_branch_suggestion(item, idx)
        for idx, item in enumerate(normalized["branch_suggestions"])
    ]
    return normalized


def _normalize_scene_beat_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload

    normalized = deepcopy(payload)
    allowed_keys = {"scene_id", "scene_display_name", "title", "summary", "commands", "tags", "chapter"}
    for key in list(normalized.keys()):
        if key not in allowed_keys:
            normalized.pop(key, None)
    commands = normalized.get("commands")
    if not isinstance(commands, list):
        return normalized

    for command in commands:
        if not isinstance(command, dict):
            continue
        _normalize_command(command)
        if command.get("type") == "animation":
            _normalize_animation_command(command)
        _strip_unknown_command_fields(command)

    return normalized


def _scene_commands_from_near_miss(scene: dict[str, Any]) -> list[dict[str, Any]]:
    commands: list[dict[str, Any]] = []
    beats = scene.get("beats")
    if isinstance(beats, list):
        for beat in beats:
            if not isinstance(beat, dict):
                continue
            beat_type = str(beat.get("beatType") or beat.get("beat_type") or beat.get("type") or "").lower()
            speaker = str(beat.get("speaker") or beat.get("character") or "").strip()
            text = str(beat.get("text") or beat.get("content") or beat.get("action") or "").strip()
            if not text:
                continue
            if speaker and beat_type in {"dialog", "dialogue", "say", "speech"}:
                commands.append({"type": "dialog", "character_id": speaker, "text": text})
            else:
                commands.append({"type": "narration", "text": text})

    dialogue = scene.get("dialogue") or scene.get("dialog")
    if isinstance(dialogue, list):
        for line in dialogue:
            if not isinstance(line, dict):
                continue
            speaker = str(line.get("speaker") or line.get("character_id") or line.get("character") or "unknown_speaker").strip()
            text = str(line.get("text") or line.get("content") or line.get("line") or "").strip()
            if text:
                commands.append({"type": "dialog", "character_id": speaker or "unknown_speaker", "text": text})

    actions = scene.get("actions")
    if isinstance(actions, list):
        for action in actions:
            if isinstance(action, dict):
                text = str(action.get("action") or action.get("content") or action.get("text") or "").strip()
            else:
                text = str(action).strip()
            if text:
                commands.append({"type": "narration", "text": text})

    narrative = scene.get("narrative") or scene.get("narration") or scene.get("internalThoughts")
    if not commands and isinstance(narrative, str) and narrative.strip():
        commands.append({"type": "narration", "text": narrative.strip()})
    return commands


def _normalize_subagent_scene(value: Any, index: int) -> Any:
    if not isinstance(value, dict):
        return value
    scene = deepcopy(value)
    _rename_first(scene, "scene_id", ("sceneId", "id"))
    _rename_first(scene, "scene_display_name", ("sceneDisplayName", "sceneTitle", "displayName"))
    _rename_first(scene, "title", ("sceneTitle", "name"))
    _rename_first(scene, "summary", ("description", "narrative", "narration"))
    _rename_first(scene, "chapter", ("chapterIndex", "chapter_number"))
    if "commands" not in scene or not isinstance(scene.get("commands"), list):
        scene["commands"] = _scene_commands_from_near_miss(scene)
    scene_type = scene.get("sceneType") or scene.get("scene_type")
    tags = scene.get("tags")
    if not isinstance(tags, list):
        tags = []
    if scene_type not in (None, "") and str(scene_type) not in tags:
        tags.append(str(scene_type))
    scene["tags"] = tags
    scene.setdefault("scene_id", f"scene_{index + 1}")
    scene.setdefault("title", scene.get("scene_display_name") or f"Scene {index + 1}")
    scene.setdefault("summary", str(scene.get("title") or ""))
    chapter = scene.get("chapter")
    if not isinstance(chapter, int):
        chapter_text = str(chapter or "")
        digit_match = re.search(r"\d+", chapter_text)
        if digit_match:
            scene["chapter"] = max(1, int(digit_match.group()))
        else:
            chinese_digits = {
                "一": 1,
                "二": 2,
                "三": 3,
                "四": 4,
                "五": 5,
                "六": 6,
                "七": 7,
                "八": 8,
                "九": 9,
                "十": 10,
            }
            chinese_match = re.search(r"第([一二三四五六七八九十]+)章", chapter_text)
            chinese_value = chinese_match.group(1) if chinese_match else ""
            if chinese_value == "十":
                scene["chapter"] = 10
            elif chinese_value.startswith("十") and len(chinese_value) == 2:
                scene["chapter"] = 10 + chinese_digits.get(chinese_value[1], 0)
            elif chinese_value.endswith("十") and len(chinese_value) == 2:
                scene["chapter"] = chinese_digits.get(chinese_value[0], 1) * 10
            elif "十" in chinese_value and len(chinese_value) == 3:
                scene["chapter"] = (
                    chinese_digits.get(chinese_value[0], 1) * 10
                    + chinese_digits.get(chinese_value[2], 0)
                )
            else:
                scene["chapter"] = chinese_digits.get(chinese_value, index + 1)
    scene.setdefault("chapter", index + 1)
    return _normalize_scene_beat_payload(scene)


def _normalize_subagent_fragment(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    fragment = deepcopy(value)
    _rename_first(fragment, "continuityNotes", ("continuity_notes", "continuity"))
    _rename_first(fragment, "errorMessage", ("error_message", "error"))
    for key in ("tags", "commands", "continuityNotes", "warnings"):
        _ensure_list(fragment, key)
    fragment["tags"] = _normalize_string_list(fragment["tags"])
    fragment["continuityNotes"] = _normalize_string_list(fragment["continuityNotes"])
    fragment["warnings"] = _normalize_string_list(fragment["warnings"])
    command_holder = _normalize_scene_beat_payload({"commands": fragment["commands"]})
    fragment["commands"] = command_holder.get("commands", fragment["commands"])
    fragment.setdefault("summary", "")
    fragment.setdefault("errorMessage", None)
    for key in list(fragment.keys()):
        if key not in {"summary", "tags", "commands", "continuityNotes", "warnings", "errorMessage"}:
            fragment.pop(key, None)
    return fragment


def _normalize_subagent_model_output(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = deepcopy(payload)
    if "scenes" not in normalized and any(key in normalized for key in ("sceneId", "scene_id", "sceneTitle", "beats")):
        normalized = {"status": "completed", "scenes": [normalized]}
    _rename_first(normalized, "resultText", ("result_text", "result", "text"))
    _rename_first(normalized, "continuityNotes", ("continuity_notes", "continuity"))
    _rename_first(normalized, "inputTokens", ("input_tokens",))
    _rename_first(normalized, "outputTokens", ("output_tokens",))
    _rename_first(normalized, "errorMessage", ("error_message", "error"))
    _ensure_list(normalized, "scenes")
    _ensure_list(normalized, "continuityNotes")
    _ensure_list(normalized, "warnings")
    normalized["continuityNotes"] = _normalize_string_list(normalized["continuityNotes"])
    normalized["warnings"] = _normalize_string_list(normalized["warnings"])
    if normalized.get("fragment") is not None:
        normalized["fragment"] = _normalize_subagent_fragment(normalized["fragment"])
    normalized["scenes"] = [_normalize_subagent_scene(scene, index) for index, scene in enumerate(normalized["scenes"])]
    normalized.setdefault("status", "completed")
    normalized.setdefault("resultText", "")
    normalized.setdefault("summary", "")
    normalized.setdefault("inputTokens", 0)
    normalized.setdefault("outputTokens", 0)
    normalized.setdefault("errorMessage", None)
    for key in list(normalized.keys()):
        if key not in {
            "status",
            "resultText",
            "summary",
            "fragment",
            "scenes",
            "continuityNotes",
            "inputTokens",
            "outputTokens",
            "warnings",
            "errorMessage",
        }:
            normalized.pop(key, None)
    return normalized


def _normalize_adapted_scene(adapted: dict[str, Any]) -> None:
    _rename_first(adapted, "adapted_scene_id", ("id", "adaptedSceneId", "scene_id"))
    _rename_first(adapted, "source_scene_candidate_id", ("source_id", "sourceSceneCandidateId", "scene_candidate_id"))
    _rename_first(adapted, "source_mapping", ("mapping", "sourceMapping"))
    _rename_first(adapted, "scene_beat", ("sceneBeat", "beat"))
    _rename_first(adapted, "needs_review", ("needsReview",))
    scene_beat = adapted.get("scene_beat")
    if isinstance(scene_beat, list):
        scene_beat = {"commands": scene_beat}
    elif isinstance(scene_beat, str):
        scene_beat = {
            "summary": scene_beat,
            "commands": [{"type": "narration", "text": scene_beat}],
        }
    elif not isinstance(scene_beat, dict):
        scene_beat = {}
    for key in ("scene_id", "scene_display_name", "title", "summary", "commands", "tags", "chapter"):
        if key in adapted and key not in scene_beat:
            scene_beat[key] = adapted.pop(key)
    if isinstance(adapted.get("commands"), list):
        scene_beat["commands"] = adapted.pop("commands")
    notes = adapted.pop("notes", None)
    if notes not in (None, "", []):
        warnings = adapted.setdefault("warnings", [])
        if isinstance(warnings, list):
            warnings.append(str(notes))
    scene_beat.setdefault("scene_id", adapted.get("adapted_scene_id") or "scene_adapted")
    scene_beat.setdefault("title", str(adapted.get("title") or "导入场景"))
    if not isinstance(scene_beat.get("summary"), str):
        scene_beat["summary"] = str(scene_beat.get("scene_beat") or scene_beat.get("title") or "")
    scene_beat.setdefault("commands", [])
    scene_beat.setdefault("tags", [])
    scene_beat.setdefault("chapter", 1)
    adapted["scene_beat"] = _normalize_scene_beat_payload(scene_beat)
    adapted.setdefault("adapted_scene_id", f"adapted_{scene_beat.get('scene_id') or 'scene'}")
    adapted.setdefault("source_scene_candidate_id", adapted.get("adapted_scene_id"))
    mapping = adapted.get("source_mapping")
    if not isinstance(mapping, dict):
        mapping = {}
    mapping.setdefault("document_id", "novel_import")
    mapping.setdefault("start_offset", 0)
    mapping.setdefault("end_offset", mapping["start_offset"])
    mapping.setdefault("source_excerpt", "")
    mapping.setdefault("adapted_command_ids", [])
    adapted["source_mapping"] = mapping
    adapted.setdefault("warnings", [])
    adapted.setdefault("needs_review", False)
    allowed_keys = {
        "adapted_scene_id",
        "source_scene_candidate_id",
        "scene_beat",
        "source_mapping",
        "warnings",
        "needs_review",
    }
    for key in list(adapted.keys()):
        if key not in allowed_keys:
            adapted.pop(key, None)


def _normalize_conflict_point(value: Any, index: int) -> Any:
    if isinstance(value, dict):
        conflict = deepcopy(value)
        _rename_first(conflict, "conflict_id", ("id", "conflictId"))
        _rename_first(conflict, "source_scene_id", ("scene_id", "sourceSceneId"))
        _rename_first(conflict, "description", ("point", "issue", "summary", "detail"))
        _rename_first(conflict, "mainline_resolution", ("resolution", "mainlineResolution", "fix", "handling"))
        _rename_first(conflict, "conflict_type", ("type", "category", "conflictType"))
        conflict.setdefault("conflict_id", f"conflict_{index + 1}")
        conflict.setdefault("source_scene_id", "unknown_scene")
        conflict.setdefault("description", "")
        conflict.setdefault("mainline_resolution", "")
        conflict.setdefault("suggests_branch", False)
        conflict.setdefault("confidence", 0.0)
        conflict.setdefault("branch_suggestion_ids", [])
        for key in list(conflict.keys()):
            if key not in {
                "conflict_id",
                "source_scene_id",
                "source_scene_display_name",
                "conflict_type",
                "description",
                "mainline_resolution",
                "suggests_branch",
                "confidence",
                "branch_suggestion_ids",
            }:
                conflict.pop(key, None)
        return conflict
    return {
        "conflict_id": f"conflict_{index + 1}",
        "source_scene_id": "unknown_scene",
        "description": str(value),
        "mainline_resolution": "模型返回了文本型冲突说明，已作为待复核提示保留。",
        "suggests_branch": False,
        "confidence": 0.3,
        "branch_suggestion_ids": [],
    }


def _normalize_branch_suggestion(value: Any, index: int) -> Any:
    if not isinstance(value, dict):
        return {
            "suggestion_id": f"branch_{index + 1}",
            "source_scene_id": "unknown_scene",
            "choice_text": str(value) or "探索另一种选择",
            "branch_summary": str(value) or "AI 推测的潜在分支，等待作者继续开发。",
            "confidence": 0.3,
            "enabled_by_default": False,
        }
    branch = deepcopy(value)
    _rename_first(branch, "suggestion_id", ("id", "branch_id", "branchId"))
    _rename_first(branch, "source_scene_id", ("scene_id", "sourceSceneId", "source_scene_candidate_id"))
    _rename_first(branch, "choice_text", ("choice", "choice_title", "choiceText", "title"))
    _rename_first(branch, "branch_summary", ("summary", "description", "branchSummary"))
    branch.setdefault("suggestion_id", f"branch_{index + 1}")
    branch.setdefault("source_scene_id", "unknown_scene")
    branch.setdefault("choice_text", branch.get("choice_display_name") or f"探索分支 {index + 1}")
    branch.setdefault("branch_summary", "")
    if "confidence" not in branch:
        has_actionable_branch = (
            branch.get("source_scene_id") != "unknown_scene"
            and bool(str(branch.get("choice_text") or "").strip())
            and bool(str(branch.get("branch_summary") or "").strip())
        )
        branch["confidence"] = 0.65 if has_actionable_branch else 0.3
    branch["enabled_by_default"] = False
    for key in list(branch.keys()):
        if key not in {
            "suggestion_id",
            "source_scene_id",
            "source_scene_display_name",
            "choice_display_name",
            "choice_text",
            "branch_summary",
            "confidence",
            "enabled_by_default",
        }:
            branch.pop(key, None)
    return branch


def _normalize_command(command: dict[str, Any]) -> None:
    if "type" not in command:
        for wrapped_type in (
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
        ):
            wrapped_value = command.get(wrapped_type)
            if isinstance(wrapped_value, dict):
                command.clear()
                command.update(wrapped_value)
                command.setdefault("type", wrapped_type)
                break
    _rename_first(command, "type", ("command", "action", "command_type"))
    command_type = str(command.get("type") or "").strip().lower()
    hides_character = command_type in {"hide_character", "remove_character"}
    command["type"] = {
        "set_background": "background",
        "show_background": "background",
        "display_background": "background",
        "show_character": "sprite",
        "display_character": "sprite",
        "show_sprite": "sprite",
        "hide_character": "sprite",
        "remove_character": "sprite",
        "dialogue": "dialog",
        "speech": "dialog",
        "say": "dialog",
    }.get(command_type, command_type)
    if command.get("type") in {"focus_image", "display_image", "item_image"}:
        command["type"] = "show_image"
    if command.get("type") == "narration":
        _rename_first(command, "text", ("content", "line", "narration"))
        command.setdefault("text", "")
    if command.get("type") == "dialog":
        _rename_first(command, "text", ("content", "line", "dialogue"))
        _rename_first(command, "character_id", ("speaker", "character", "name"))
        command.setdefault("character_id", "unknown_speaker")
        command.setdefault("text", "")
    if command.get("type") == "background":
        _rename_first(command, "background_id", ("background", "asset_id", "id"))
        command.setdefault("background_id", "bg_unknown")
    if command.get("type") == "show_image":
        _rename_first(command, "image_id", ("asset_id", "id", "image"))
        command.setdefault("image_id", "image_unknown")
        if command.get("image_fit") not in {"contain", "cover", "stretch"}:
            command["image_fit"] = "contain"
        for field, minimum, maximum, fallback in (
            ("backdrop_opacity", 0.0, 0.9, 0.62),
            ("backdrop_blur_px", 0.0, 24.0, 12.0),
        ):
            try:
                numeric = float(command.get(field, fallback))
            except (TypeError, ValueError):
                # error-log-ignore: 模型结构化结果的数值规范化失败时使用字段默认值，最终结果仍会继续校验。
                numeric = fallback
            command[field] = max(minimum, min(maximum, numeric))
    if command.get("type") == "video":
        _rename_first(command, "video_id", ("asset_id", "id", "video"))
        command.setdefault("video_id", "video_unknown")
    if command.get("type") == "sprite" and "sprite_id" not in command:
        for alias in ("sprite", "asset_id", "portrait", "character_id", "character"):
            value = command.get(alias)
            if value not in (None, ""):
                command["sprite_id"] = str(value)
                break
        else:
            command["sprite_id"] = "unknown_sprite"
    if command.get("type") == "sprite":
        _rename_first(command, "character_id", ("character", "name", "speaker"))
        command.setdefault("character_id", str(command.get("sprite_id") or "unknown_character"))
        if hides_character:
            command["visible"] = False
        animation = command.get("animation")
        if isinstance(animation, dict):
            command["animation_config"] = command.pop("animation")
    if command.get("type") == "wait" and "duration_ms" not in command and "duration" in command:
        value = command.pop("duration")
        try:
            numeric = float(value)
            command["duration_ms"] = int(numeric * 1000 if numeric < 1000 else numeric)
        except (TypeError, ValueError):
            # error-log-ignore: 旧版等待时长无法转换时使用兼容默认值，最终命令仍会继续校验。
            command["duration_ms"] = 1000
    if command.get("type") == "wait":
        command.setdefault("duration_ms", 1000)
    if command.get("type") == "choice":
        _ensure_list(command, "choices")
    if command.get("type") == "state_update":
        command.setdefault("key", "novel_import_review")
        command.setdefault("operation", "set")
        command.setdefault("value", True)
    if command.get("type") in {"conditional_jump", "jump"}:
        _rename_first(command, "target_scene_id", ("target", "targetSceneId"))
    if command.get("type") == "animation":
        command.setdefault("animation_id", "import_scene_emphasis")
        command.setdefault("target", "screen")
        command.setdefault("params", {})
        command.setdefault("blocking", True)
    if command.get("type") == "bgm":
        command.setdefault("action", "play")
    if command.get("type") == "sfx":
        command.setdefault("sfx_id", "unknown_sfx")
    if command.get("type") == "camera":
        if command.get("motion") is None:
            command.setdefault("action", "hold")
            command.setdefault("params", {})
        command.setdefault("blocking", True)


def _strip_unknown_command_fields(command: dict[str, Any]) -> None:
    allowed_by_type = {
        "dialog": {"type", "character_id", "text", "emotion", "portrait", "voice", "side", "font_asset_id", "dialog_style", "dialog_style_mode"},
        "narration": {"type", "text", "font_asset_id", "dialog_style", "dialog_style_mode"},
        "hide_dialog": {"type"},
        "background": {"type", "background_id", "background_fit", "transition", "transition_display_name", "transition_config"},
        "show_image": {
            "type",
            "image_id",
            "image_fit",
            "image_display_name",
            "caption",
            "alt",
            "backdrop_opacity",
            "backdrop_blur_px",
        },
        "video": {"type", "video_id", "video_fit", "fade_in_ms", "fade_out_ms"},
        "sprite": {"type", "character_id", "sprite_id", "position", "layer", "animation", "animation_display_name", "animation_config", "switch_transition", "scale", "visible"},
        "choice": {"type", "choices"},
        "state_update": {"type", "key", "operation", "value", "value_type"},
        "conditional_jump": {"type", "condition", "target_scene_id", "else_target_scene_id"},
        "jump": {"type", "target_scene_id"},
        "animation": {"type", "animation_id", "animation_display_name", "target", "params", "blocking"},
        "bgm": {"type", "bgm_id", "action", "volume", "fade_ms"},
        "sfx": {"type", "sfx_id", "volume"},
        "camera": {"type", "action", "params", "motion", "blocking"},
        "wait": {"type", "duration_ms"},
    }
    allowed = allowed_by_type.get(command.get("type"))
    if not allowed:
        return
    for key in list(command.keys()):
        if key not in allowed:
            command.pop(key, None)
    if command.get("type") == "choice" and isinstance(command.get("choices"), list):
        for index, choice in enumerate(command["choices"]):
            if not isinstance(choice, dict):
                continue
            _rename_first(choice, "choice_id", ("id", "choiceId"))
            _rename_first(choice, "text", ("label", "title", "choice_text"))
            _rename_first(choice, "target_scene_id", ("target", "targetSceneId"))
            choice.setdefault("choice_id", f"choice_{index + 1}")
            choice.setdefault("text", f"选项 {index + 1}")
            choice.setdefault("target_scene_id", "")
            choice.setdefault("conditions", [])
            for key in list(choice.keys()):
                if key not in {"choice_id", "choice_display_name", "text", "target_scene_id", "conditions"}:
                    choice.pop(key, None)


def _normalize_animation_command(command: dict[str, Any]) -> None:
    explicit_target = command.get("target")
    alias_target: str | None = None
    for alias in ("target_sprite", "target_character", "character_id", "sprite_id"):
        alias_value = command.pop(alias, None)
        if alias_target is None and alias_value not in (None, ""):
            alias_target = str(alias_value)

    if explicit_target in (None, "") or (explicit_target == "screen" and alias_target is not None):
        command["target"] = alias_target or "screen"
    else:
        command["target"] = str(explicit_target)

    params = command.get("params")
    if not isinstance(params, dict):
        params = {}
    else:
        params = dict(params)

    for key in ANIMATION_PARAM_ALIASES:
        if key in command:
            params.setdefault(key, command.pop(key))

    command["params"] = params
