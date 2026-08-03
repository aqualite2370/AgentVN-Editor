"""Novel import service."""

import logging
import math
import re
from collections.abc import Iterable, Iterator
from typing import TypeVar

from app.ai.novel_adapter import NovelAdapter
from app.ai.provider import AIProvider
from app.core.errors import AIProviderError
from app.core.error_logging import log_exception
from app.models.commands import BackgroundCommand, DialogCommand, NarrationCommand, SpriteCommand
from app.models.novel_import import (
    AdaptSceneRequest,
    AdaptSceneResponse,
    AdaptedScene,
    AnalyzeChunkRequest,
    AnalyzeChunkResponse,
    BatchAdaptRequest,
    BatchAdaptResponse,
    BranchSuggestion,
    ChapterCandidate,
    CharacterCandidate,
    ConflictPoint,
    ExtractCharactersRequest,
    ExtractCharactersResponse,
    NovelAiAdaptSceneRequest,
    NovelAiBranchSuggestionResponse,
    NovelAiChapterScenePlan,
    NovelAiChunkAnalysis,
    NovelAiChunkEntityIndex,
    NovelAiChunkRequest,
    NovelAiChunkSummary,
    NovelAiChunkTimelineNotes,
    NovelAiConflictAnalysisResponse,
    NovelAiOutlineIndex,
    NovelAiOutlineMainline,
    NovelAiOutlineRequest,
    NovelAiOutlineResponse,
    NovelAiOutlineStructure,
    NovelAiPlanChapterRequest,
    NovelAiScenePlanResponse,
    SceneCandidate,
    SplitSceneRequest,
    SplitSceneResponse,
    SourceMapping,
    SourceSpan,
)
from app.models.scene import SceneBeat
from app.schemas.requests import ProviderSelectionRequest
from app.utils.ids import new_id


logger = logging.getLogger("agentvn.backend.novel_import_service")


T = TypeVar("T")


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
    rf"(?:^|[\n。！？?!，,\s])([A-Za-z][A-Za-z0-9_ -]{{0,31}}|[\u4e00-\u9fff]{{1,6}})(?:{SPEECH_VERB_PATTERN})\s*[：:，,。！？?!“\"']?"
)
DIALOGUE_PATTERN = re.compile(r"[“「『\"'](.+?)[”」』\"']")
LOCATION_KEYWORDS = (
    "车站",
    "站台",
    "教室",
    "房间",
    "街道",
    "门外",
    "仓库",
    "雨棚",
    "走廊",
    "咖啡馆",
    "医院",
    "学校",
    "地下通道",
    "地铁",
    "家门",
    "店",
    "电脑",
    "商店",
)
TIME_KEYWORDS = (
    "清晨",
    "早晨",
    "上午",
    "中午",
    "午后",
    "下午",
    "黄昏",
    "傍晚",
    "夜里",
    "深夜",
    "凌晨",
    "当晚",
    "第二天",
    "情人节",
)
PRONOUNS = {
    "我",
    "你",
    "他",
    "她",
    "它",
    "我们",
    "你们",
    "他们",
    "她们",
    "少年",
    "少女",
    "男人",
    "女人",
}


def unique_in_order(items: Iterable[str], limit: int) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        value = item.strip()
        if not value or value in PRONOUNS or value in seen:
            continue
        seen.add(value)
        result.append(value)
        if len(result) >= limit:
            break
    return result


def extract_speakers(text: str, limit: int = 60) -> list[str]:
    return unique_in_order((match.group(1) for match in SPEAKER_PATTERN.finditer(text)), limit)


def find_keywords(text: str, keywords: Iterable[str]) -> list[str]:
    return [word for word in keywords if word in text]


def count_dialogue_blocks(text: str) -> int:
    quoted = len(DIALOGUE_PATTERN.findall(text))
    if quoted:
        return quoted
    return len(SPEAKER_PATTERN.findall(text))


def suggested_scene_count_for_text(text_length: int, max_scene_chars: int = 2200) -> int:
    if text_length <= 0:
        return 1
    return max(1, math.ceil(text_length / max(900, max_scene_chars)))


class NovelImportService:
    def __init__(self) -> None:
        self.adapter = NovelAdapter()
        self.provider = AIProvider()

    @staticmethod
    def _json_mode_selection(selection: ProviderSelectionRequest | None, stage: str = "default") -> ProviderSelectionRequest | None:
        if selection is None:
            return None
        payload = selection.model_dump()
        parameters = dict(payload.get("parameters") or {})
        parameters["structured_mode"] = (
            "json_object" if parameters.get("structured_mode") == "json_object" else "tools"
        )
        parameters["temperature"] = 0.2
        parameters["top_p"] = 0.9
        parameters["thinking_mode"] = False
        model_id = str(payload.get("model_id") or "").lower()
        if "deepseek-v4-flash" in model_id:
            parameters["temperature"] = min(float(parameters.get("temperature") or 0.2), 0.1)
            parameters["top_p"] = min(float(parameters.get("top_p") or 0.9), 0.8)
            parameters["context_budget_tokens"] = max(int(parameters.get("context_budget_tokens") or 0), 24000)
            parameters["max_tokens"] = {
                "scene": 4096,
                "outline": 6144,
                "analysis": 2048,
            }.get(stage, 4096)
        elif "deepseek-v4-pro" in model_id:
            parameters["context_budget_tokens"] = max(int(parameters.get("context_budget_tokens") or 0), 48000)
            parameters["max_tokens"] = {
                "scene": 6144,
                "outline": 10000,
                "analysis": 3072,
            }.get(stage, 8192)
        elif "gemini-3-flash-preview" in model_id:
            parameters["context_budget_tokens"] = max(int(parameters.get("context_budget_tokens") or 0), 24000)
            parameters["max_tokens"] = {
                "scene": 4096,
                "outline": 6144,
                "analysis": 2048,
            }.get(stage, 4096)
        payload["parameters"] = parameters
        return ProviderSelectionRequest(**payload)

    def _stream_structured_result(
        self,
        response_model: type[T],
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float,
        selection: ProviderSelectionRequest | None,
        phase: str,
    ) -> Iterator[tuple[str, object]]:
        final_payload: T | None = None
        saw_delta = False
        for event, payload in self.provider.stream_with_tools(
            response_model,
            system_prompt,
            user_prompt,
            temperature=temperature,
            selection=selection,
        ):
            if event == "final":
                final_payload = payload  # type: ignore[assignment]
                continue
            if event == "delta":
                saw_delta = True
            yield (event, payload)
        if final_payload is None:
            raise AIProviderError(f"{response_model.__name__} stream finished without a final structured payload.")
        if not saw_delta:
            message = "Current provider did not emit token deltas for this structured call; using the validated final payload."
            yield ("status", message)
            yield (
                "trace",
                {
                    "phase": phase,
                    "level": "warning",
                    "title": "Structured stream fallback",
                    "message": message,
                },
            )
        return final_payload

    def analyze_chunk(self, request: AnalyzeChunkRequest) -> AnalyzeChunkResponse:
        text = request.text
        return AnalyzeChunkResponse(
            summary=text[:160],
            characters=extract_speakers(text, limit=20),
            locations=find_keywords(text, LOCATION_KEYWORDS),
            times=find_keywords(text, TIME_KEYWORDS),
            dialogue_count=count_dialogue_blocks(text),
        )

    def split_scene(self, request: SplitSceneRequest) -> SplitSceneResponse:
        parts = [part.strip() for part in re.split(r"\n{2,}", request.text) if part.strip()]
        scenes: list[SceneCandidate] = []
        offset = 0
        buffer = ""
        start = 0
        for part in parts:
            if buffer and len(buffer) + len(part) > request.max_scene_chars:
                scenes.append(self._scene(request.chapter_id, len(scenes), start, offset, buffer))
                start = offset
                buffer = part
            else:
                buffer = f"{buffer}\n\n{part}" if buffer else part
            offset += len(part) + 2
        if buffer:
            scenes.append(self._scene(request.chapter_id, len(scenes), start, offset, buffer))
        return SplitSceneResponse(scenes=scenes)

    def adapt_scene(self, request: AdaptSceneRequest) -> AdaptSceneResponse:
        if request.provider_selection:
            return self.ai_adapt_scene(NovelAiAdaptSceneRequest(**request.model_dump()))
        return self.adapter.adapt_scene(request)

    def ai_scan_chunk(self, request: NovelAiChunkRequest) -> NovelAiChunkAnalysis:
        summary = request.partial_summary or self.provider.create_with_tools(
            NovelAiChunkSummary,
            self._scan_summary_system_prompt(),
            self._scan_summary_user_prompt(request),
            temperature=0.2,
            selection=self._json_mode_selection(request.provider_selection),
        )
        entities = request.partial_entities or self.provider.create_with_tools(
            NovelAiChunkEntityIndex,
            self._scan_entities_system_prompt(),
            self._scan_entities_user_prompt(request, summary),
            temperature=0.2,
            selection=self._json_mode_selection(request.provider_selection),
        )
        timeline = request.partial_timeline or self.provider.create_with_tools(
            NovelAiChunkTimelineNotes,
            self._scan_timeline_system_prompt(),
            self._scan_timeline_user_prompt(request, summary),
            temperature=0.2,
            selection=self._json_mode_selection(request.provider_selection, "analysis"),
        )
        return self._compose_chunk_analysis(summary, entities, timeline)

    def stream_ai_scan_chunk(self, request: NovelAiChunkRequest) -> Iterator[tuple[str, object]]:
        summary = request.partial_summary
        if summary is None:
            yield ("status", "Generating chunk summary...")
            summary = yield from self._stream_structured_result(
                NovelAiChunkSummary,
                self._scan_summary_system_prompt(),
                self._scan_summary_user_prompt(request),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection),
                phase="chunk_summary",
            )
            yield ("checkpoint", {"stage": "summary", "payload": summary.model_dump(mode="json")})
        else:
            yield ("trace", {"phase": "chunk_summary", "level": "info", "title": "Resume checkpoint reused", "message": summary.summary})
        yield ("trace", {"phase": "chunk_summary", "level": "success", "title": "Chunk summary complete", "message": summary.summary})

        entities = request.partial_entities
        if entities is None:
            yield ("status", "Extracting characters, chapter candidates, and locations...")
            entities = yield from self._stream_structured_result(
                NovelAiChunkEntityIndex,
                self._scan_entities_system_prompt(),
                self._scan_entities_user_prompt(request, summary),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection),
                phase="chunk_entities",
            )
            yield ("checkpoint", {"stage": "entities", "payload": entities.model_dump(mode="json")})
        else:
            yield ("trace", {"phase": "chunk_entities", "level": "info", "title": "Resume checkpoint reused", "message": f"Characters {len(entities.characters)}, locations {len(entities.locations)}"})
        yield ("trace", {"phase": "chunk_entities", "level": "success", "title": "Chunk entities complete", "message": f"Characters {len(entities.characters)}, locations {len(entities.locations)}"})

        timeline = request.partial_timeline
        if timeline is None:
            yield ("status", "Extracting timeline and foreshadowing...")
            timeline = yield from self._stream_structured_result(
                NovelAiChunkTimelineNotes,
                self._scan_timeline_system_prompt(),
                self._scan_timeline_user_prompt(request, summary),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "analysis"),
                phase="chunk_timeline",
            )
            yield ("checkpoint", {"stage": "timeline", "payload": timeline.model_dump(mode="json")})
        else:
            yield ("trace", {"phase": "chunk_timeline", "level": "info", "title": "Resume checkpoint reused", "message": f"Timeline {len(timeline.timeline)}, foreshadowing {len(timeline.foreshadowing)}"})
        yield ("trace", {"phase": "chunk_timeline", "level": "success", "title": "Chunk timeline complete", "message": f"Timeline {len(timeline.timeline)}, foreshadowing {len(timeline.foreshadowing)}"})
        yield ("final", self._compose_chunk_analysis(summary, entities, timeline))

    def ai_build_outline(self, request: NovelAiOutlineRequest) -> NovelAiOutlineResponse:
        mainline = request.partial_mainline or self.provider.create_with_tools(
            NovelAiOutlineMainline,
            self._outline_mainline_system_prompt(),
            self._outline_mainline_user_prompt(request),
            temperature=0.2,
            selection=self._json_mode_selection(request.provider_selection, "outline"),
        )
        structure = request.partial_structure or self.provider.create_with_tools(
            NovelAiOutlineStructure,
            self._outline_structure_system_prompt(),
            self._outline_structure_user_prompt(request, mainline),
            temperature=0.2,
            selection=self._json_mode_selection(request.provider_selection, "outline"),
        )
        index = request.partial_index or self.provider.create_with_tools(
            NovelAiOutlineIndex,
            self._outline_index_system_prompt(),
            self._outline_index_user_prompt(request, mainline),
            temperature=0.2,
            selection=self._json_mode_selection(request.provider_selection),
        )
        return self._compose_outline_response(request, mainline, structure, index)

    def stream_ai_build_outline(self, request: NovelAiOutlineRequest) -> Iterator[tuple[str, object]]:
        mainline = request.partial_mainline
        if mainline is None:
            yield ("status", "Building full-book mainline...")
            mainline = yield from self._stream_structured_result(
                NovelAiOutlineMainline,
                self._outline_mainline_system_prompt(),
                self._outline_mainline_user_prompt(request),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "outline"),
                phase="outline_mainline",
            )
            yield ("checkpoint", {"stage": "mainline", "payload": mainline.model_dump(mode="json")})
        else:
            yield ("trace", {"phase": "outline_mainline", "level": "info", "title": "Resume checkpoint reused", "message": mainline.summary})

        structure = request.partial_structure
        if structure is None:
            yield ("status", "Building chapter structure...")
            structure = yield from self._stream_structured_result(
                NovelAiOutlineStructure,
                self._outline_structure_system_prompt(),
                self._outline_structure_user_prompt(request, mainline),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "outline"),
                phase="outline_structure",
            )
            yield ("checkpoint", {"stage": "structure", "payload": structure.model_dump(mode="json")})
        else:
            yield ("trace", {"phase": "outline_structure", "level": "info", "title": "Resume checkpoint reused", "message": f"Chapters {len(structure.chapters)}"})

        index = request.partial_index
        if index is None:
            yield ("status", "Building character and location index...")
            index = yield from self._stream_structured_result(
                NovelAiOutlineIndex,
                self._outline_index_system_prompt(),
                self._outline_index_user_prompt(request, mainline),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection),
                phase="outline_index",
            )
            yield ("checkpoint", {"stage": "index", "payload": index.model_dump(mode="json")})
        else:
            yield ("trace", {"phase": "outline_index", "level": "info", "title": "Resume checkpoint reused", "message": f"Characters {len(index.characters)}, locations {len(index.locations)}"})
        yield ("final", self._compose_outline_response(request, mainline, structure, index))

    @staticmethod
    def _compose_outline_response(
        request: NovelAiOutlineRequest,
        mainline: NovelAiOutlineMainline,
        structure: NovelAiOutlineStructure,
        index: NovelAiOutlineIndex,
    ) -> NovelAiOutlineResponse:
        chapters = NovelImportService._repair_outline_chapter_ranges(request, structure.chapters)
        return NovelAiOutlineResponse(
            document_id=mainline.document_id,
            title=mainline.title,
            summary=mainline.summary,
            main_plot=mainline.main_plot,
            chapters=chapters,
            characters=index.characters,
            timeline=structure.timeline,
            locations=index.locations,
            branch_or_foreshadowing=structure.branch_or_foreshadowing,
            conflict_points=structure.conflict_points,
            warnings=[*mainline.warnings, *structure.warnings, *index.warnings],
            needs_review=mainline.needs_review,
            coverage_confidence=mainline.coverage_confidence,
        )

    @staticmethod
    def _repair_outline_chapter_ranges(
        request: NovelAiOutlineRequest,
        chapters: list[ChapterCandidate],
    ) -> list[ChapterCandidate]:
        if not chapters or request.total_chars <= 0:
            return chapters

        total_chars = request.total_chars
        ordered = sorted(chapters, key=lambda chapter: chapter.index)
        model_ranges_are_valid = all(
            0 <= chapter.start_offset < chapter.end_offset <= total_chars
            and (index == 0 or chapter.start_offset >= ordered[index - 1].end_offset)
            for index, chapter in enumerate(ordered)
        )
        if model_ranges_are_valid:
            return ordered

        source_candidates = sorted(
            (
                candidate
                for analysis in request.analyses
                for candidate in analysis.chapter_candidates
                if 0 <= candidate.start_offset < candidate.end_offset <= total_chars
            ),
            key=lambda candidate: (candidate.start_offset, candidate.end_offset, candidate.index),
        )
        if not source_candidates:
            raise ValueError("AI outline chapters have no valid source ranges, and scan results contain no source-aligned chapter candidates.")

        repaired: list[ChapterCandidate] = []
        cursor = 0
        for candidate in source_candidates:
            if candidate.end_offset <= cursor:
                continue
            start = cursor
            end = candidate.end_offset
            metadata = dict(candidate.metadata)
            metadata["source_range_repaired"] = True
            metadata["source_range_origin"] = "scan_chapter_candidate"
            repaired.append(
                candidate.model_copy(
                    update={
                        "chapter_id": f"chapter_{len(repaired) + 1}",
                        "index": len(repaired),
                        "start_offset": start,
                        "end_offset": end,
                        "char_count": end - start,
                        "metadata": metadata,
                    }
                )
            )
            cursor = end
        if not repaired:
            raise ValueError("Scan chapter candidates did not yield any non-empty source ranges.")
        if cursor < total_chars:
            last = repaired[-1]
            metadata = dict(last.metadata)
            metadata["source_range_extended_to_document_end"] = True
            repaired[-1] = last.model_copy(
                update={
                    "end_offset": total_chars,
                    "char_count": total_chars - last.start_offset,
                    "metadata": metadata,
                }
            )
        return repaired

    @staticmethod
    def _scene_plan_quality_error(
        request: NovelAiPlanChapterRequest,
        scene_plan: NovelAiChapterScenePlan,
        min_scene_count: int,
    ) -> str | None:
        missing_source_markers = (
            "章节原文缺失",
            "原文内容缺失",
            "原文缺失",
            "原文未提供",
            "后续内容未提供",
            "后续原文未提供",
            "章节原文不完整",
            "原文不完整",
            "仅包含注释和开头部分",
            "chapter source is incomplete",
            "source text is incomplete",
            "source is incomplete",
        )
        contradictory = [
            warning
            for warning in scene_plan.warnings
            if any(marker in warning for marker in missing_source_markers)
        ]
        if request.text.strip() and contradictory:
            return (
                "The previous plan incorrectly claimed source text was missing, incomplete, partial, or not provided although a complete authoritative chapter source was supplied. "
                "Use only the supplied chapter source and remove every missing-source or incomplete-source claim. "
                + " | ".join(contradictory)
            )
        if len(scene_plan.scenes) < min_scene_count:
            warning_context = " | ".join(scene_plan.warnings[:6]).strip()
            return (
                f"The previous plan returned {len(scene_plan.scenes)} scenes, but at least {min_scene_count} source-grounded scenes are required. "
                "Do not omit the chapter because it contains mature or sensitive material. Convert explicit details into non-graphic "
                "relationship, motivation, consequence, and transition beats, then return the required playable scenes."
                + (f" Previous warnings: {warning_context}" if warning_context else "")
            )
        return None

    def ai_plan_chapter(self, request: NovelAiPlanChapterRequest) -> NovelAiScenePlanResponse:
        min_scene_count = self._min_scene_count_for_request(request)
        scene_plan = self.provider.create_with_tools(
            NovelAiChapterScenePlan,
            self._chapter_scene_plan_system_prompt(),
            self._chapter_scene_plan_user_prompt(request),
            temperature=0.25,
            selection=self._json_mode_selection(request.provider_selection, "outline"),
        )
        quality_error = self._scene_plan_quality_error(request, scene_plan, min_scene_count)
        for _corrective_attempt in range(2):
            if not quality_error:
                break
            scene_plan = self.provider.create_with_tools(
                NovelAiChapterScenePlan,
                self._chapter_scene_plan_system_prompt(),
                self._chapter_scene_plan_user_prompt(request, quality_error),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "outline"),
            )
            quality_error = self._scene_plan_quality_error(request, scene_plan, min_scene_count)
        if quality_error:
            scene_plan = self._plan_chapter_source_segments(request, min_scene_count, quality_error)
        scene_plan = self._repair_scene_plan(request, scene_plan, min_scene_count)
        warnings = list(scene_plan.warnings)
        conflict_points = self._safe_ai_chapter_conflict_points(request, scene_plan, warnings)
        branch_suggestions = self._safe_ai_chapter_branch_suggestions(request, scene_plan, conflict_points, warnings)
        return NovelAiScenePlanResponse(
            chapter_id=scene_plan.chapter_id,
            scenes=scene_plan.scenes,
            conflict_points=conflict_points,
            branch_suggestions=branch_suggestions,
            warnings=warnings,
            needs_review=scene_plan.needs_review or bool(warnings),
        )

    def stream_ai_plan_chapter(self, request: NovelAiPlanChapterRequest) -> Iterator[tuple[str, object]]:
        min_scene_count = self._min_scene_count_for_request(request)
        yield ("status", "Planning chapter scenes...")
        scene_plan = yield from self._stream_structured_result(
            NovelAiChapterScenePlan,
            self._chapter_scene_plan_system_prompt(),
            self._chapter_scene_plan_user_prompt(request),
            temperature=0.25,
            selection=self._json_mode_selection(request.provider_selection, "outline"),
            phase="chapter_scene_plan",
        )
        quality_error = self._scene_plan_quality_error(request, scene_plan, min_scene_count)
        for corrective_attempt in range(2):
            if not quality_error:
                break
            yield ("status", "Retrying chapter scene plan after source-grounding quality gate...")
            yield (
                "trace",
                {
                    "phase": "chapter_scene_plan_quality_retry",
                    "level": "warning",
                    "title": "Chapter scene plan quality retry",
                    "message": quality_error[:1200],
                    "details": {"attempt": corrective_attempt + 1, "maximum_attempts": 2},
                },
            )
            scene_plan = yield from self._stream_structured_result(
                NovelAiChapterScenePlan,
                self._chapter_scene_plan_system_prompt(),
                self._chapter_scene_plan_user_prompt(request, quality_error),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "outline"),
                phase="chapter_scene_plan_quality_retry",
            )
            quality_error = self._scene_plan_quality_error(request, scene_plan, min_scene_count)
        if quality_error:
            scene_plan = yield from self._stream_plan_chapter_source_segments(request, min_scene_count, quality_error)
        scene_plan = self._repair_scene_plan(request, scene_plan, min_scene_count)
        yield ("checkpoint", {"stage": "scene_plan", "payload": scene_plan.model_dump(mode="json")})
        warnings = list(scene_plan.warnings)
        conflict_points = yield from self._stream_ai_chapter_conflict_points(request, scene_plan, warnings)
        branch_suggestions = yield from self._stream_ai_chapter_branch_suggestions(request, scene_plan, conflict_points, warnings)
        response = NovelAiScenePlanResponse(
            chapter_id=scene_plan.chapter_id,
            scenes=scene_plan.scenes,
            conflict_points=conflict_points,
            branch_suggestions=branch_suggestions,
            warnings=warnings,
            needs_review=scene_plan.needs_review or bool(warnings),
        )
        yield ("final", response)

    @staticmethod
    def _compose_chunk_analysis(
        summary: NovelAiChunkSummary,
        entities: NovelAiChunkEntityIndex,
        timeline: NovelAiChunkTimelineNotes,
    ) -> NovelAiChunkAnalysis:
        return NovelAiChunkAnalysis(
            chunk_id=summary.chunk_id,
            index=summary.index,
            summary=summary.summary,
            chapter_candidates=entities.chapter_candidates,
            characters=entities.characters,
            locations=entities.locations,
            timeline=timeline.timeline,
            foreshadowing=timeline.foreshadowing,
            warnings=[*summary.warnings, *entities.warnings, *timeline.warnings],
            confidence=summary.confidence,
        )

    @staticmethod
    def _min_scene_count_for_request(request: NovelAiPlanChapterRequest) -> int:
        suggested = request.suggested_scene_count or suggested_scene_count_for_text(len(request.text))
        explicit_min = request.min_scene_count or suggested
        return max(1, suggested, explicit_min)

    @staticmethod
    def _has_explicit_scene_shortfall_reason(warnings: list[str]) -> bool:
        reason_markers = ("reason", "because", "cannot", "unable", "too short", "原因", "无法", "不足", "不适合")
        return any(any(marker in warning.lower() for marker in reason_markers) for warning in warnings if len(warning.strip()) >= 12)

    def _repair_scene_plan(
        self,
        request: NovelAiPlanChapterRequest,
        scene_plan: NovelAiChapterScenePlan,
        min_scene_count: int,
    ) -> NovelAiChapterScenePlan:
        warnings = list(scene_plan.warnings)
        if len(scene_plan.scenes) < min_scene_count:
            raise ValueError(f"Scene plan returned {len(scene_plan.scenes)} scenes, below required minimum {min_scene_count}.")

        repaired = [
            self._repair_scene_candidate_contract(request, scene, index)
            for index, scene in enumerate(scene_plan.scenes)
        ]
        if len(repaired) < min_scene_count:
            warnings.append(
                f"Scene plan kept {len(repaired)} scenes because the model supplied an explicit shortfall reason; review coverage manually."
            )
        return NovelAiChapterScenePlan(
            chapter_id=scene_plan.chapter_id,
            scenes=repaired,
            warnings=warnings,
            needs_review=scene_plan.needs_review or len(repaired) < min_scene_count,
        )

    @staticmethod
    def _chapter_source_segments(request: NovelAiPlanChapterRequest, count: int) -> list[tuple[int, int, str]]:
        text = request.text
        if not text.strip():
            raise ValueError("Cannot segment an empty chapter source.")
        count = max(1, min(count, len(text)))
        boundaries = [0]
        for index in range(1, count):
            target = round(len(text) * index / count)
            window_start = max(boundaries[-1] + 1, target - 240)
            window_end = min(len(text) - 1, target + 240)
            candidates = [
                position + 1
                for position in range(window_start, window_end)
                if text[position:position + 1] in "\n。！？!?；;"
            ]
            boundary = min(candidates, key=lambda position: abs(position - target)) if candidates else target
            boundaries.append(max(boundaries[-1] + 1, boundary))
        boundaries.append(len(text))
        return [
            (
                request.chapter.start_offset + boundaries[index],
                request.chapter.start_offset + boundaries[index + 1],
                text[boundaries[index]:boundaries[index + 1]],
            )
            for index in range(len(boundaries) - 1)
            if text[boundaries[index]:boundaries[index + 1]].strip()
        ]

    @staticmethod
    def _segment_request(
        request: NovelAiPlanChapterRequest,
        segment_index: int,
        segment_count: int,
        start_offset: int,
        end_offset: int,
        text: str,
    ) -> NovelAiPlanChapterRequest:
        chapter = request.chapter.model_copy(
            update={
                "chapter_id": f"{request.chapter.chapter_id}_segment_{segment_index + 1}",
                "title": f"{request.chapter.title} · source segment {segment_index + 1}/{segment_count}",
                "index": segment_index,
                "start_offset": start_offset,
                "end_offset": end_offset,
                "summary": request.chapter.summary,
            }
        )
        return request.model_copy(
            update={
                "chapter": chapter,
                "text": text,
                "suggested_scene_count": 1,
                "min_scene_count": 1,
                "min_branch_suggestion_count": 0,
                "allow_branch_suggestions": False,
            }
        )

    def _plan_chapter_source_segments(
        self,
        request: NovelAiPlanChapterRequest,
        min_scene_count: int,
        previous_error: str,
    ) -> NovelAiChapterScenePlan:
        segments = self._chapter_source_segments(request, min_scene_count)
        scenes: list[SceneCandidate] = []
        warnings = ["Whole-chapter scene planning returned no usable scenes; the same model planned continuous source segments instead."]
        for index, (start, end, text) in enumerate(segments):
            segment_request = self._segment_request(request, index, len(segments), start, end, text)
            instruction = (
                f"This is continuous source segment {index + 1}/{len(segments)} after whole-chapter planning failed. "
                "Return at least one non-graphic playable scene grounded only in this segment. "
                f"Previous whole-chapter quality error: {previous_error}"
            )
            segment_plan = self.provider.create_with_tools(
                NovelAiChapterScenePlan,
                self._chapter_scene_plan_system_prompt(),
                self._chapter_scene_plan_user_prompt(segment_request, instruction),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "outline"),
            )
            if not segment_plan.scenes:
                raise ValueError(f"Source segment {index + 1}/{len(segments)} returned no scenes.")
            repaired = self._repair_scene_plan(segment_request, segment_plan, 1)
            scenes.extend(repaired.scenes)
            warnings.extend(repaired.warnings)
        return NovelAiChapterScenePlan(
            chapter_id=request.chapter.chapter_id,
            scenes=[scene.model_copy(update={"chapter_id": request.chapter.chapter_id, "index": index}) for index, scene in enumerate(scenes)],
            warnings=warnings,
            needs_review=True,
        )

    def _stream_plan_chapter_source_segments(
        self,
        request: NovelAiPlanChapterRequest,
        min_scene_count: int,
        previous_error: str,
    ) -> Iterator[tuple[str, object]]:
        segments = self._chapter_source_segments(request, min_scene_count)
        scenes: list[SceneCandidate] = []
        warnings = ["Whole-chapter scene planning returned no usable scenes; the same model planned continuous source segments instead."]
        yield ("status", f"Planning {len(segments)} continuous chapter source segments with the same model...")
        for index, (start, end, text) in enumerate(segments):
            segment_request = self._segment_request(request, index, len(segments), start, end, text)
            instruction = (
                f"This is continuous source segment {index + 1}/{len(segments)} after whole-chapter planning failed. "
                "Return at least one non-graphic playable scene grounded only in this segment. "
                f"Previous whole-chapter quality error: {previous_error}"
            )
            yield (
                "trace",
                {
                    "phase": "chapter_scene_plan_segmented",
                    "level": "warning",
                    "title": f"Planning source segment {index + 1}/{len(segments)}",
                    "message": "The same configured model is planning a continuous source segment after empty whole-chapter results.",
                    "details": {"start_offset": start, "end_offset": end},
                },
            )
            segment_plan = yield from self._stream_structured_result(
                NovelAiChapterScenePlan,
                self._chapter_scene_plan_system_prompt(),
                self._chapter_scene_plan_user_prompt(segment_request, instruction),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "outline"),
                phase="chapter_scene_plan_segmented",
            )
            if not segment_plan.scenes:
                raise ValueError(f"Source segment {index + 1}/{len(segments)} returned no scenes.")
            repaired = self._repair_scene_plan(segment_request, segment_plan, 1)
            scenes.extend(repaired.scenes)
            warnings.extend(repaired.warnings)
        return NovelAiChapterScenePlan(
            chapter_id=request.chapter.chapter_id,
            scenes=[scene.model_copy(update={"chapter_id": request.chapter.chapter_id, "index": index}) for index, scene in enumerate(scenes)],
            warnings=warnings,
            needs_review=True,
        )

    def _repair_scene_candidate_contract(
        self,
        request: NovelAiPlanChapterRequest,
        scene: SceneCandidate,
        index: int,
    ) -> SceneCandidate:
        chapter_start = request.chapter.start_offset
        chapter_end = max(request.chapter.end_offset, chapter_start + len(request.text))
        start = max(chapter_start, min(scene.start_offset, chapter_end))
        end = max(start + 1, min(scene.end_offset, chapter_end))
        rel_start = max(0, start - chapter_start)
        rel_end = max(rel_start, min(len(request.text), end - chapter_start))
        excerpt = scene.source_excerpt or request.text[rel_start:rel_end]
        commands = scene.commands or self._planned_commands_for_excerpt(excerpt, scene)
        return SceneCandidate(
            **{
                **scene.model_dump(),
                "chapter_id": request.chapter.chapter_id,
                "index": index,
                "start_offset": start,
                "end_offset": end,
                "source_span": SourceSpan(start_offset=start, end_offset=end),
                "source_excerpt": excerpt,
                "summary": scene.summary or excerpt[:180],
                "commands": commands,
            }
        )

    def _fallback_scene_candidates(
        self,
        request: NovelAiPlanChapterRequest,
        count: int,
    ) -> list[SceneCandidate]:
        text = request.text
        chapter_start = request.chapter.start_offset
        if not text.strip():
            return [
                self._scene_from_span(
                    request.chapter.chapter_id,
                    0,
                    chapter_start,
                    max(chapter_start + 1, request.chapter.end_offset),
                    text,
                )
            ]

        targets: list[tuple[int, int]] = []
        step = max(1, math.ceil(len(text) / count))
        start = 0
        for index in range(count):
            if index == count - 1:
                end = len(text)
            else:
                target = min(len(text), (index + 1) * step)
                window_start = max(start + 1, target - 240)
                window_end = min(len(text), target + 240)
                candidates = [
                    pos + 1
                    for pos in range(window_start, window_end)
                    if text[pos:pos + 1] in "\n。！？!?；;"
                ]
                end = min(candidates, key=lambda pos: abs(pos - target)) if candidates else target
            if end <= start:
                end = min(len(text), start + step)
            targets.append((start, end))
            start = end
        return [
            self._scene_from_span(
                request.chapter.chapter_id,
                index,
                chapter_start + rel_start,
                chapter_start + rel_end,
                text[rel_start:rel_end],
            )
            for index, (rel_start, rel_end) in enumerate(targets)
            if rel_end > rel_start
        ]

    def _scene_from_span(self, chapter_id: str, index: int, start: int, end: int, text: str) -> SceneCandidate:
        scene = self._scene(chapter_id, index, start, end, text)
        return SceneCandidate(
            **{
                **scene.model_dump(),
                "source_span": SourceSpan(start_offset=start, end_offset=end),
                "commands": self._planned_commands_for_excerpt(text, scene),
            }
        )

    def _planned_commands_for_excerpt(self, text: str, scene: SceneCandidate) -> list[object]:
        commands: list[object] = [
            BackgroundCommand(
                background_id=f"bg_{scene.location_hint or 'unknown'}",
                background_fit="stretch",
                transition="fade",
                transition_display_name="淡入过场",
            )
        ]
        dialogue = DIALOGUE_PATTERN.search(text)
        speakers = extract_speakers(text, limit=1)
        if dialogue and speakers:
            commands.append(DialogCommand(character_id=speakers[0], text=dialogue.group(1).strip(), emotion="neutral"))
        else:
            commands.append(NarrationCommand(text=(scene.summary or text.strip() or "待改编场景")[:180]))
        return commands

    def _safe_ai_chapter_conflict_points(
        self,
        request: NovelAiPlanChapterRequest,
        scene_plan: NovelAiChapterScenePlan,
        warnings: list[str],
    ) -> list[ConflictPoint]:
        try:
            result = self.provider.create_with_tools(
                NovelAiConflictAnalysisResponse,
                self._chapter_conflict_system_prompt(),
                self._chapter_conflict_user_prompt(request, scene_plan),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "analysis"),
            )
            return result.conflict_points
        except Exception as exc:
            log_exception(logger, "章节冲突分析失败，已跳过冲突点分析", exc)
            warnings.append(f"章节冲突分析结构校验失败，已跳过冲突点分析：{exc}")
            return []

    def _safe_ai_chapter_branch_suggestions(
        self,
        request: NovelAiPlanChapterRequest,
        scene_plan: NovelAiChapterScenePlan,
        conflict_points: list[ConflictPoint],
        warnings: list[str],
    ) -> list[BranchSuggestion]:
        if not request.allow_branch_suggestions or request.min_branch_suggestion_count <= 0:
            return []
        try:
            result = self.provider.create_with_tools(
                NovelAiBranchSuggestionResponse,
                self._chapter_branch_suggestion_system_prompt(),
                self._chapter_branch_suggestion_user_prompt(request, scene_plan, conflict_points),
                temperature=0.1,
                selection=self._json_mode_selection(request.provider_selection, "analysis"),
            )
            warnings.extend(self._normalize_branch_suggestion_warnings(result.warnings))
            suggestions = [
                BranchSuggestion(**{**branch.model_dump(), "enabled_by_default": False})
                for branch in result.branch_suggestions
            ]
            self._append_branch_suggestion_shortfall_warning(request, suggestions, warnings)
            return suggestions
        except Exception as exc:
            log_exception(logger, "章节分支建议失败，已跳过分支建议", exc)
            warnings.append(f"章节分支建议结构校验失败，已跳过分支建议：{exc}")
            return []

    @staticmethod
    def _normalize_branch_suggestion_warnings(raw_warnings: list[str]) -> list[str]:
        normalized: list[str] = []
        no_branch_message = "本章未发现高置信度可选分支，已保留线性主线；作者可在后续编辑器中按冲突点手动增补分歧。"
        for warning in raw_warnings:
            text = str(warning or "").strip()
            if not text:
                continue
            compact = " ".join(text.split())
            lower = compact.lower()
            if "branch suggestions below target" in lower:
                continue
            if (
                "no strong optional choice" in lower
                or "no clear optional choice" in lower
                or "no branch is appropriate" in lower
                or "without branching decisions" in lower
                or "no room for a meaningful branch" in lower
            ):
                if no_branch_message not in normalized:
                    normalized.append(no_branch_message)
                continue
            normalized.append(compact)
        return normalized

    @staticmethod
    def _append_branch_suggestion_shortfall_warning(
        request: NovelAiPlanChapterRequest,
        suggestions: list[BranchSuggestion],
        warnings: list[str],
    ) -> None:
        if request.allow_branch_suggestions and len(suggestions) < request.min_branch_suggestion_count:
            warnings.append(
                f"本章可用分支建议少于目标：返回 {len(suggestions)} 条，"
                f"目标 {request.min_branch_suggestion_count} 条；已保留主线，建议作者在编辑器中按冲突点人工增补。"
            )

    def _stream_ai_chapter_conflict_points(
        self,
        request: NovelAiPlanChapterRequest,
        scene_plan: NovelAiChapterScenePlan,
        warnings: list[str],
    ) -> Iterator[tuple[str, object]]:
        try:
            yield ("status", "正在分析章节冲突与分支机会...")
            result = yield from self._stream_structured_result(
                NovelAiConflictAnalysisResponse,
                self._chapter_conflict_system_prompt(),
                self._chapter_conflict_user_prompt(request, scene_plan),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "analysis"),
                phase="chapter_conflict",
            )
            yield ("checkpoint", {"stage": "conflict_points", "payload": result.model_dump(mode="json")})
            return result.conflict_points
        except Exception as exc:
            log_exception(logger, "流式章节冲突分析失败，已跳过冲突点分析", exc)
            message = f"章节冲突分析结构校验失败，已跳过冲突点分析：{exc}"
            warnings.append(message)
            yield ("trace", {"phase": "chapter_conflict", "level": "warning", "title": "章节冲突分析已跳过", "message": message})
            return []

    def _stream_ai_chapter_branch_suggestions(
        self,
        request: NovelAiPlanChapterRequest,
        scene_plan: NovelAiChapterScenePlan,
        conflict_points: list[ConflictPoint],
        warnings: list[str],
    ) -> Iterator[tuple[str, object]]:
        if not request.allow_branch_suggestions or request.min_branch_suggestion_count <= 0:
            return []
        try:
            yield ("status", "正在生成章节分支建议...")
            result = yield from self._stream_structured_result(
                NovelAiBranchSuggestionResponse,
                self._chapter_branch_suggestion_system_prompt(),
                self._chapter_branch_suggestion_user_prompt(request, scene_plan, conflict_points),
                temperature=0.1,
                selection=self._json_mode_selection(request.provider_selection, "analysis"),
                phase="chapter_branch_suggestions",
            )
            suggestions = [
                BranchSuggestion(**{**branch.model_dump(), "enabled_by_default": False})
                for branch in result.branch_suggestions
            ]
            warnings.extend(self._normalize_branch_suggestion_warnings(result.warnings))
            self._append_branch_suggestion_shortfall_warning(request, suggestions, warnings)
            yield ("checkpoint", {"stage": "branch_suggestions", "payload": {"branch_suggestions": [item.model_dump(mode="json") for item in suggestions]}})
            return suggestions
        except Exception as exc:
            log_exception(logger, "流式章节分支建议失败，已跳过分支建议", exc)
            message = f"章节分支建议结构校验失败，已跳过分支建议：{exc}"
            warnings.append(message)
            yield ("trace", {"phase": "chapter_branch_suggestions", "level": "warning", "title": "章节分支建议已跳过", "message": message})
            return []

    def ai_adapt_scene(self, request: NovelAiAdaptSceneRequest) -> AdaptSceneResponse:
        scene_beat = self.provider.create_with_tools(
            SceneBeat,
            self._adapt_scene_beat_system_prompt(),
            self._adapt_scene_beat_user_prompt(request),
            temperature=0.2,
            selection=self._json_mode_selection(request.provider_selection, "scene"),
        )
        warnings: list[str] = []
        conflict_points = self._safe_ai_conflict_points(request, scene_beat, warnings)
        branch_suggestions = self._safe_ai_branch_suggestions(request, conflict_points, warnings)
        return self._compose_adapt_scene_response(request, scene_beat, conflict_points, branch_suggestions, warnings)

    def stream_ai_adapt_scene(self, request: NovelAiAdaptSceneRequest) -> Iterator[tuple[str, object]]:
        yield ("status", "Adapting scene into AgentVN commands...")
        scene_beat = yield from self._stream_structured_result(
            SceneBeat,
            self._adapt_scene_beat_system_prompt(),
            self._adapt_scene_beat_user_prompt(request),
            temperature=0.2,
            selection=self._json_mode_selection(request.provider_selection, "scene"),
            phase="scene_adaptation",
        )
        yield ("checkpoint", {"stage": "scene_beat", "payload": scene_beat.model_dump(mode="json")})
        warnings: list[str] = []
        conflict_points = yield from self._stream_ai_conflict_points(request, scene_beat, warnings)
        branch_suggestions = yield from self._stream_ai_branch_suggestions(request, conflict_points, warnings)
        yield ("final", self._compose_adapt_scene_response(request, scene_beat, conflict_points, branch_suggestions, warnings))

    def _safe_ai_conflict_points(
        self,
        request: NovelAiAdaptSceneRequest,
        scene_beat: SceneBeat,
        warnings: list[str],
    ) -> list[ConflictPoint]:
        try:
            result = self.provider.create_with_tools(
                NovelAiConflictAnalysisResponse,
                self._conflict_analysis_system_prompt(),
                self._conflict_analysis_user_prompt(request, scene_beat),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "analysis"),
            )
            return result.conflict_points
        except Exception as exc:
            log_exception(logger, "场景冲突分析失败，已跳过冲突点分析", exc)
            warnings.append(f"Conflict analysis was skipped after schema validation failed: {exc}")
            return []

    def _safe_ai_branch_suggestions(
        self,
        request: NovelAiAdaptSceneRequest,
        conflict_points: list[ConflictPoint],
        warnings: list[str],
    ) -> list[BranchSuggestion]:
        if not request.import_options.allow_branch_suggestions:
            return []
        try:
            result = self.provider.create_with_tools(
                NovelAiBranchSuggestionResponse,
                self._branch_suggestion_system_prompt(),
                self._branch_suggestion_user_prompt(request, conflict_points),
                temperature=0.1,
                selection=self._json_mode_selection(request.provider_selection, "analysis"),
            )
            return [
                BranchSuggestion(**{**branch.model_dump(), "enabled_by_default": False})
                for branch in result.branch_suggestions
            ]
        except Exception as exc:
            log_exception(logger, "场景分支建议失败，已跳过分支建议", exc)
            warnings.append(f"Branch suggestions were skipped after schema validation failed: {exc}")
            return []

    def _stream_ai_conflict_points(
        self,
        request: NovelAiAdaptSceneRequest,
        scene_beat: SceneBeat,
        warnings: list[str],
    ) -> Iterator[tuple[str, object]]:
        try:
            yield ("status", "Analyzing scene conflict and branch opportunities...")
            result = yield from self._stream_structured_result(
                NovelAiConflictAnalysisResponse,
                self._conflict_analysis_system_prompt(),
                self._conflict_analysis_user_prompt(request, scene_beat),
                temperature=0.2,
                selection=self._json_mode_selection(request.provider_selection, "analysis"),
                phase="scene_conflict",
            )
            yield ("checkpoint", {"stage": "conflict_points", "payload": result.model_dump(mode="json")})
            return result.conflict_points
        except Exception as exc:
            log_exception(logger, "流式场景冲突分析失败，已跳过冲突点分析", exc)
            message = f"Conflict analysis was skipped after schema validation failed: {exc}"
            warnings.append(message)
            yield ("trace", {"phase": "scene_conflict", "level": "warning", "title": "Conflict analysis skipped", "message": message})
            return []

    def _stream_ai_branch_suggestions(
        self,
        request: NovelAiAdaptSceneRequest,
        conflict_points: list[ConflictPoint],
        warnings: list[str],
    ) -> Iterator[tuple[str, object]]:
        if not request.import_options.allow_branch_suggestions:
            return []
        try:
            yield ("status", "Generating scene branch suggestions...")
            result = yield from self._stream_structured_result(
                NovelAiBranchSuggestionResponse,
                self._branch_suggestion_system_prompt(),
                self._branch_suggestion_user_prompt(request, conflict_points),
                temperature=0.1,
                selection=self._json_mode_selection(request.provider_selection, "analysis"),
                phase="scene_branch_suggestions",
            )
            suggestions = [
                BranchSuggestion(**{**branch.model_dump(), "enabled_by_default": False})
                for branch in result.branch_suggestions
            ]
            yield ("checkpoint", {"stage": "branch_suggestions", "payload": {"branch_suggestions": [item.model_dump(mode="json") for item in suggestions]}})
            return suggestions
        except Exception as exc:
            log_exception(logger, "流式场景分支建议失败，已跳过分支建议", exc)
            message = f"Branch suggestions were skipped after schema validation failed: {exc}"
            warnings.append(message)
            yield ("trace", {"phase": "scene_branch_suggestions", "level": "warning", "title": "Branch suggestions skipped", "message": message})
            return []

    def _compose_adapt_scene_response(
        self,
        request: NovelAiAdaptSceneRequest,
        scene_beat: SceneBeat,
        conflict_points: list[ConflictPoint],
        branch_suggestions: list[BranchSuggestion],
        warnings: list[str],
    ) -> AdaptSceneResponse:
        candidate = request.scene_candidate
        scene_beat = self._repair_scene_beat_character_references(request, scene_beat, warnings)
        return AdaptSceneResponse(
            adapted_scene=AdaptedScene(
                adapted_scene_id=f"adapted_{candidate.scene_candidate_id}",
                source_scene_candidate_id=candidate.scene_candidate_id,
                scene_beat=scene_beat,
                source_mapping=SourceMapping(
                    document_id=candidate.chapter_id,
                    start_offset=candidate.start_offset,
                    end_offset=candidate.end_offset,
                    source_excerpt=candidate.source_excerpt,
                    adapted_command_ids=[f"cmd_{index + 1}" for index, _ in enumerate(scene_beat.commands)],
                ),
                warnings=warnings,
                needs_review=bool(warnings),
            ),
            branch_suggestions=branch_suggestions,
            conflict_points=conflict_points,
            warnings=warnings,
        )

    @staticmethod
    def _character_reference_key(value: str | None) -> str:
        if not value:
            return ""
        return re.sub(r"\s+", "", value).strip().casefold()

    @classmethod
    def _character_reference_variants(cls, value: str | None) -> list[str]:
        if not value:
            return []
        base = value.strip()
        if not base:
            return []
        variants = [base]
        for separator in ("·", "・", ".", "-", "_", " "):
            if separator not in base:
                continue
            for part in base.split(separator):
                part = part.strip()
                if len(part) >= 2:
                    variants.append(part)

        unique: list[str] = []
        seen: set[str] = set()
        for variant in variants:
            key = cls._character_reference_key(variant)
            if key and key not in seen:
                seen.add(key)
                unique.append(variant)
        return unique

    @classmethod
    def _adapt_scene_allowed_character_references(cls, request: NovelAiAdaptSceneRequest) -> list[str]:
        references: list[str] = []
        seen: set[str] = set()

        def add(value: str | None) -> None:
            key = cls._character_reference_key(value)
            if key and value and key not in seen:
                seen.add(key)
                references.append(value.strip())

        for character in request.known_characters:
            add(character.character_id)
            add(character.name)
            for alias in character.aliases:
                add(alias)
        for name in request.scene_candidate.characters:
            add(name)
        return references

    @classmethod
    def _character_reference_lookup(cls, request: NovelAiAdaptSceneRequest) -> dict[str, str]:
        lookup: dict[str, str] = {}
        collisions: set[str] = set()

        def add(alias: str | None, target: str | None) -> None:
            key = cls._character_reference_key(alias)
            clean_target = target.strip() if target else ""
            if not key or not clean_target:
                return
            existing = lookup.get(key)
            if existing and existing != clean_target:
                collisions.add(key)
                return
            lookup[key] = clean_target

        for character in request.known_characters:
            target = character.character_id.strip() or character.name.strip()
            for value in [character.character_id, character.name, *character.aliases]:
                for variant in cls._character_reference_variants(value):
                    add(variant, target)

        for name in request.scene_candidate.characters:
            target = name.strip()
            for variant in cls._character_reference_variants(name):
                add(variant, target)

        for key in collisions:
            lookup.pop(key, None)
        return lookup

    @classmethod
    def _repair_scene_beat_character_references(
        cls,
        request: NovelAiAdaptSceneRequest,
        scene_beat: SceneBeat,
        warnings: list[str],
    ) -> SceneBeat:
        lookup = cls._character_reference_lookup(request)
        if not lookup:
            return scene_beat

        repaired_commands = []
        changed = False
        for index, command in enumerate(scene_beat.commands):
            if isinstance(command, DialogCommand):
                original_id = command.character_id.strip()
                target_id = lookup.get(cls._character_reference_key(original_id))
                if target_id:
                    if target_id != command.character_id:
                        payload = command.model_dump()
                        payload["character_id"] = target_id
                        repaired_commands.append(DialogCommand(**payload))
                        changed = True
                        warnings.append(
                            f"SceneBeat command {index + 1} dialog character_id was normalized from '{original_id}' to confirmed character '{target_id}'."
                        )
                    else:
                        repaired_commands.append(command)
                    continue

                text = command.text.strip()
                narration_text = f"{original_id}：{text}" if original_id and text else text or original_id
                repaired_commands.append(NarrationCommand(text=narration_text, font_asset_id=command.font_asset_id))
                changed = True
                warnings.append(
                    f"SceneBeat command {index + 1} used unconfirmed dialog character '{original_id}' and was converted to narration."
                )
                continue

            if isinstance(command, SpriteCommand):
                original_id = command.character_id.strip()
                target_id = lookup.get(cls._character_reference_key(original_id))
                if target_id:
                    if target_id != command.character_id:
                        payload = command.model_dump()
                        payload["character_id"] = target_id
                        repaired_commands.append(SpriteCommand(**payload))
                        changed = True
                        warnings.append(
                            f"SceneBeat command {index + 1} sprite character_id was normalized from '{original_id}' to confirmed character '{target_id}'."
                        )
                    else:
                        repaired_commands.append(command)
                    continue

                changed = True
                warnings.append(
                    f"SceneBeat command {index + 1} used unconfirmed sprite character '{original_id}' and was removed before import."
                )
                continue

            repaired_commands.append(command)

        if not changed:
            return scene_beat

        payload = scene_beat.model_dump()
        payload["commands"] = [command.model_dump() for command in repaired_commands]
        return SceneBeat(**payload)

    def batch_adapt(self, request: BatchAdaptRequest) -> BatchAdaptResponse:
        adapted = [
            self.adapter.adapt_scene(
                AdaptSceneRequest(
                    scene_candidate=scene,
                    known_characters=request.known_characters,
                    import_options=request.import_options,
                    memory_mode=request.memory_mode,
                )
            ).adapted_scene
            for scene in request.scenes
        ]
        return BatchAdaptResponse(adapted_scenes=adapted)

    def extract_characters(self, request: ExtractCharactersRequest) -> ExtractCharactersResponse:
        names = extract_speakers(request.text, limit=60)
        return ExtractCharactersResponse(
            characters=[
                CharacterCandidate(
                    character_id=name.lower(),
                    name=name,
                    first_seen_offset=request.text.find(name),
                    description="自动识别，需人工确认。",
                )
                for name in names
            ]
        )

    @staticmethod
    def _scan_summary_system_prompt() -> str:
        return (
            "你负责把一段中文小说文本压缩成稳定的导入摘要。"
            "只返回 chunk_id、index、summary、confidence、warnings，不要返回人物、地点、时间线或其他字段。"
        )

    @staticmethod
    def _scan_summary_user_prompt(request: NovelAiChunkRequest) -> str:
        return f"""
请概括这个文本块的主线功能，保持中性、可用于视觉小说导入。
要求：
- summary 只写本块发生了什么和主要推进，不复述露骨细节。
- confidence 使用 0 到 1 的数字。
- 不要返回 characters、locations、timeline、plot_elements、conflicts。

文档 id: {request.document_id}
文本块 id: {request.chunk_id}
文本块序号: {request.index}
原文 offset: {request.start_offset}-{request.end_offset}
上一段滚动摘要:
{request.previous_summary or "无"}

文本块:
{request.text}
"""

    @staticmethod
    def _scan_entities_system_prompt() -> str:
        return (
            "你负责从一段中文小说文本中提取章节候选、人物和地点索引。"
            "只返回 chapter_candidates、characters、locations、warnings。"
            "不要返回 summary、timeline、foreshadowing 或 conflicts。"
            "characters 只抽取具名且对主线、对白、关系或后续视觉小说改编有复用价值的人物。"
            "路人、一次性称谓、职位泛称、群体名、纯描述短语、只出现一次且无后续作用的人不要放进 characters，改在 warnings 中说明被忽略的类别。"
        )

    @staticmethod
    def _scan_entities_user_prompt(request: NovelAiChunkRequest, summary: NovelAiChunkSummary) -> str:
        return f"""
请提取本块中的章节候选、人物和地点，用于后续视觉小说蓝图。
要求：
- chapter_candidates 的 start_offset/end_offset 必须落在本块原文 offset 范围内。
- characters 合并同一人物在本块中的别名，aliases 使用字符串数组。
- characters 只保留可复用的具名主角/配角/关键反派/关键关系人物。
- 排除路人、一次性称谓、职位泛称、群体名、纯描述短语、无对白/无关系推进且只出现一次的人。
- 被排除的边缘人物不要补进 characters，请在 warnings 中用短句概括类别，例如“忽略若干侍卫/群众称谓”。
- locations 使用字符串数组，不要返回对象。
- 不确定就写 warnings，不要编造。

摘要:
{summary.model_dump_json()}

文档 id: {request.document_id}
文本块 id: {request.chunk_id}
文本块序号: {request.index}
原文 offset: {request.start_offset}-{request.end_offset}

文本块:
{request.text}
"""

    @staticmethod
    def _scan_timeline_system_prompt() -> str:
        return (
            "你负责从一段中文小说文本中提取时间线、伏笔和潜在冲突提示。"
            "只返回 timeline、foreshadowing、warnings。"
            "不要返回 characters、locations、chapters、plot_elements 或 conflicts 字段。"
        )

    @staticmethod
    def _scan_timeline_user_prompt(request: NovelAiChunkRequest, summary: NovelAiChunkSummary) -> str:
        return f"""
请提取本块中影响后续改编的时间线、伏笔、潜在分歧。
要求：
- timeline 使用短字符串，按原文出现顺序排列。
- foreshadowing 可包含伏笔、冲突机会或后续需复核的信息。
- 不要输出 plot_elements/conflicts 这类额外字段。
- 如果内容敏感，只写剧情功能层面的中性提示。

摘要:
{summary.model_dump_json()}

文本块:
{request.text}
"""

    @staticmethod
    def _scan_chunk_system_prompt() -> str:
        return (
            "你负责把长篇中文小说分块分析成可靠的视觉小说大纲素材。"
            "最终必须调用 AgentVN 工具 analyze_novel_chunk，不要用普通文本回答结构化数据。"
            "如果原文包含成人、暴力或其他敏感描写，只保留中性高层剧情功能、人物关系和场景推进，不复述露骨细节。"
        )

    @staticmethod
    def _scan_chunk_user_prompt(request: NovelAiChunkRequest) -> str:
        return f"""
请为 AgentVN 视觉小说导入分析一段长篇小说文本，并通过工具参数填写结构化字段。
要求：
- 保留中文人物名、地点、时间线、伏笔、冲突和章节候选。
- 章节候选的 start_offset/end_offset 必须落在本块原文 offset 范围内。
- 列表没有内容时返回空数组；confidence 使用 0 到 1 的数字。
- 对敏感内容做中性概括，不复述露骨细节。

文档 id: {request.document_id}
文本块 id: {request.chunk_id}
文本块序号: {request.index}
原文 offset: {request.start_offset}-{request.end_offset}
上一段滚动摘要:
{request.previous_summary or "无"}

文本块:
{request.text}
"""

    @staticmethod
    def _outline_mainline_system_prompt() -> str:
        return (
            "你负责把分块分析合成为小说主线总览。"
            "只返回 document_id、title、summary、main_plot、needs_review、coverage_confidence、warnings。"
            "不要返回 chapters、characters、locations、timeline 或 conflict_points。"
        )

    @staticmethod
    def _outline_mainline_user_prompt(request: NovelAiOutlineRequest) -> str:
        return f"""
请根据分块分析结果合成可播放主线总览。
要求：
- summary 是全书短摘要。
- main_plot 是从开头到结尾的顺滑主线，不要把互斥可能性拆进主线。
- 如果覆盖不确定，设置 needs_review=true 并写 warnings。

文档 id: {request.document_id}
标题: {request.title}
总字符数: {request.total_chars}
允许分支建议: {request.allow_branch_suggestions}

分块分析数据:
{request.model_dump_json()}
"""

    @staticmethod
    def _outline_structure_system_prompt() -> str:
        return (
            "你负责把小说分块分析整理成章节结构、时间线和冲突提示。"
            "只返回 chapters、timeline、branch_or_foreshadowing、conflict_points、warnings。"
            "不要返回 characters 或 locations。"
        )

    @staticmethod
    def _outline_structure_user_prompt(request: NovelAiOutlineRequest, mainline: NovelAiOutlineMainline) -> str:
        return f"""
Hard source-range requirements:
- every chapter must include start_offset and end_offset copied from the scan analyses
- every chapter range must satisfy 0 <= start_offset < end_offset <= {request.total_chars}
- chapter ranges must follow source order and must not overlap
- each chapter title and summary must describe only events inside its own source range
- never return 0-0 placeholder ranges

请根据已确认主线生成章节结构和冲突提示。
要求：
- chapters 必须按原文顺序形成完整可播放主线。
- timeline、branch_or_foreshadowing 使用短中文条目。
- conflict_points 只记录明确的时间线、动机、事实、过渡缺失或可分支冲突。
- allow_branch_suggestions=false 时，把歧义收束到主线，不要生成默认分支。

主线总览:
{mainline.model_dump_json()}

分块分析数据:
{request.model_dump_json()}
"""

    @staticmethod
    def _outline_index_system_prompt() -> str:
        return (
            "你负责从小说分块分析中合并人物和地点索引。"
            "只返回 characters、locations、warnings。不要返回 chapters、timeline 或 main_plot。"
            "characters 默认只保留主配角优先的可复用角色；低置信、一次性、称谓型、群体型人物不要提升到角色表。"
        )

    @staticmethod
    def _outline_index_user_prompt(request: NovelAiOutlineRequest, mainline: NovelAiOutlineMainline) -> str:
        return f"""
请合并全书人物和地点索引。
要求：
- characters 合并同一人物的别名与描述，保留 first_seen_offset。
- characters 只保留会反复出现在主线、对白、立绘、关系推进或关键冲突中的具名角色。
- 排除路人、一次性称谓、职位泛称、群体名、纯描述短语、仅出现一次且无后续作用的人；这些边缘类别写入 warnings。
- locations 使用字符串数组，不要返回对象。
- 不确定的身份合并写入 warnings。

主线总览:
{mainline.model_dump_json()}

分块分析数据:
{request.model_dump_json()}
"""

    @staticmethod
    def _outline_user_prompt(request: NovelAiOutlineRequest) -> str:
        return f"""
请根据分块分析结果合成 AgentVN 导入用的全书大纲。输出必须覆盖全文并保持章节顺序。
要求：
- chapters 必须形成从开头到结尾可播放的主线，不要把互斥可能性直接拆成主线章节。
- characters 合并同一人物的别名与描述，保留 first_seen_offset。
- characters 只保留具名且可复用的主角、配角、关键反派和关键关系人物；路人、一次性称谓、职位泛称、群体名、纯描述短语和只出现一次且无后续作用的人写入 warnings，不放入角色表。
- timeline、locations、branch_or_foreshadowing 用简短中文条目。
- 如果覆盖不确定或分块信息冲突，请标记 needs_review 并写入 warnings/conflict_points。
- 如果涉及敏感内容，只保留剧情功能、人物关系和冲突层面的中性描述。

分支/冲突策略：
- 始终产出一条顺滑主线。
- 分析时间线、动机、事实、过渡缺失和可分支冲突。
- conflict_points 需要包含 source_scene_id、description、mainline_resolution、suggests_branch 和 confidence。
- allow_branch_suggestions 为 false 时，把歧义收束到主线，不生成默认分支。
- allow_branch_suggestions 为 true 时，也要保留完整主线，只建议高置信度可选分支，且 enabled_by_default=false。

文档 id: {request.document_id}
标题: {request.title}
总字符数: {request.total_chars}
允许分支建议: {request.allow_branch_suggestions}

分块分析数据:
{request.model_dump_json()}
"""

    @staticmethod
    def _chapter_scene_plan_system_prompt() -> str:
        return (
            "Plan one confirmed Chinese novel chapter into playable visual-novel SceneCandidate objects. "
            "Hard requirements: scenes must meet the requested minimum; never return an empty scenes list for non-empty source text; "
            "mature or sensitive source material must be transformed into non-graphic relationship, motivation, consequence, and transition beats instead of being omitted; "
            "every scene must include source_span, summary, and commands. "
            "Commands are compact draft command skeletons; the backend will refine them later. "
            "你负责把一个已确认中文小说章节拆成视觉小说 SceneCandidate 主线场景。"
            "只返回 chapter_id、scenes、warnings、needs_review。"
            "不要返回 conflict_points、SceneBeat 命令或 branch_suggestions。"
        )

    @staticmethod
    def _chapter_scene_plan_user_prompt(request: NovelAiPlanChapterRequest, corrective_instruction: str | None = None) -> str:
        return f"""
Hard structure requirements:
- scenes quantity minimum: {NovelImportService._min_scene_count_for_request(request)}
- suggested_scene_count: {request.suggested_scene_count or suggested_scene_count_for_text(len(request.text))}
- if fewer scenes are truly appropriate, warnings must explicitly explain the reason
- every scene must include source_span(start_offset/end_offset), summary, and commands
- commands should be a concise visual-novel command draft using valid command types
- use show_image when the source asks the player to inspect a key item, clue, photo, letter, or prop
- the chapter source below is complete and authoritative for this chapter
- never claim that source text, later text, or chapter text is missing, incomplete, partial, truncated, or not provided
- if the chapter summary mentions an event absent from the source, ignore that event and plan only the supplied source
- never return zero scenes for non-empty chapter source
- sensitive or mature details must be adapted into non-graphic playable scenes that preserve relationships, motivations, consequences, and transitions
- warnings may flag sensitivity, but warnings never replace the required scenes
{f"- corrective retry instruction: {corrective_instruction}" if corrective_instruction else ""}

请为一个已确认章节规划视觉小说主线场景。
要求：
- scenes 必须按原文顺序组成可播放主线。
- 每个场景必须包含全文 offset、可读标题、摘要、人物、地点和时间提示。
- source_excerpt 使用对应原文片段，不要编造不存在的桥段。
- 不要写 SceneBeat commands，不要写 conflict_points。
- 对敏感内容保持中性概要，不复述露骨细节。

文档 id: {request.document_id}
全书大纲:
{request.outline_summary}

章节:
{request.chapter.model_dump_json()}

已知角色:
{[character.model_dump() for character in request.known_characters]}

章节原文:
{request.text}
"""

    @staticmethod
    def _chapter_conflict_system_prompt() -> str:
        return (
            "你负责检查一个章节场景计划中的时间线、动机、事实、过渡和潜在分支冲突。"
            "只返回 { conflict_points, warnings }，不要返回 scenes 或 SceneBeat。"
        )

    @staticmethod
    def _chapter_conflict_user_prompt(request: NovelAiPlanChapterRequest, scene_plan: NovelAiChapterScenePlan) -> str:
        return f"""
请检查章节场景计划是否存在冲突或可分支机会。
要求：
- 低置信度内容写入 warnings。
- conflict_points 的 source_scene_id 优先使用对应 scene_candidate_id。
- allow_branch_suggestions=false 时，只写主线修正建议，不建议默认分支。

允许分支建议: {request.allow_branch_suggestions}
章节:
{request.chapter.model_dump_json()}

场景计划:
{scene_plan.model_dump_json()}
"""

    @staticmethod
    def _chapter_branch_suggestion_system_prompt() -> str:
        return (
            "Create optional branch suggestions for a planned imported visual-novel chapter. "
            "Return only { branch_suggestions, warnings }. Return 0 to 2 high-confidence suggestions; "
            "do not invent branches to satisfy a quota. Every suggestion must be disabled by default."
        )

    @staticmethod
    def _chapter_branch_suggestion_user_prompt(
        request: NovelAiPlanChapterRequest,
        scene_plan: NovelAiChapterScenePlan,
        conflict_points: list[ConflictPoint],
    ) -> str:
        allowed_scene_ids = [scene.scene_candidate_id for scene in scene_plan.scenes]
        return f"""
Create 0 to 2 high-confidence branch suggestions when the chapter has strong optional choice points.
Every source_scene_id must exactly copy one value from Allowed scene_candidate_ids.
Do not use chapter_id, scene titles, display names, summaries, future invented ids, or translated ids as source_scene_id.
Keep mainline intact; suggestions are optional author review stubs.
Set enabled_by_default=false for every branch.
If no branch is appropriate, return an empty branch_suggestions array and explain why in warnings.

Allow branch suggestions: {request.allow_branch_suggestions}
Allowed scene_candidate_ids:
{allowed_scene_ids}

Chapter:
{request.chapter.model_dump_json()}

Scene plan:
{scene_plan.model_dump_json()}

Conflict points:
{[conflict.model_dump() for conflict in conflict_points]}
"""

    @staticmethod
    def _plan_chapter_user_prompt(request: NovelAiPlanChapterRequest) -> str:
        return f"""
请为一个已确认章节规划视觉小说场景，只生成 SceneCandidate，不要写 SceneBeat 命令。
要求：
- scenes 必须按原文顺序组成可播放主线。
- 每个场景必须包含全文 offset、可读标题、摘要、人物、地点和时间提示。
- source_excerpt 使用对应原文片段，不要编造不存在的桥段。
- 如果有冲突或可能选择点，写入 conflict_points；禁用分支时不要拆成互斥主线。
- 对敏感内容保持中性概要，不复述露骨细节。

文档 id: {request.document_id}
允许分支建议: {request.allow_branch_suggestions}
全书大纲:
{request.outline_summary}

章节:
{request.chapter.model_dump_json()}

已知角色:
{[character.model_dump() for character in request.known_characters]}

章节原文:
{request.text}
"""

    @staticmethod
    def _adapt_scene_user_prompt(request: NovelAiAdaptSceneRequest) -> str:
        return f"""
请把一个小说场景计划改编为 AgentVN AdaptSceneResponse。
要求：
- adapted_scene.scene_beat 是当前 source_scene_candidate_id 的顺滑主线改编。
- 命令要适合视觉小说播放：背景、BGM、旁白、角色对白、选择或状态更新按需要使用。
- 尽量保留原对白的剧情功能；无法确认时标记 needs_review。
- 对敏感内容改写为非露骨、适合视觉小说概述的表达。
- allow_branch_suggestions 为 false 时返回空 branch_suggestions；为 true 时只返回可选分支建议，且 enabled_by_default=false。
- conflict_points 应解释主线选择原因以及后续是否值得创建分支节点。

全书大纲:
{request.outline_summary or "无"}

上一场摘要:
{request.previous_scene_summary or "无"}

场景候选:
{request.scene_candidate.model_dump_json()}

已知角色:
{[character.model_dump() for character in request.known_characters]}

导入选项:
{request.import_options.model_dump_json()}
"""

    @staticmethod
    def _adapt_scene_beat_system_prompt() -> str:
        return (
            "Adapt one imported Chinese novel scene into one playable AgentVN SceneBeat. "
            "Hard requirements: output must include summary and commands; commands must not be empty. "
            "Return only the SceneBeat object. Do not include conflict analysis, branch suggestions, "
            "source mapping, review notes, or extra fields. The backend will assemble those separately."
        )

    @staticmethod
    def _adapt_scene_beat_user_prompt(request: NovelAiAdaptSceneRequest) -> str:
        allowed_character_references = NovelImportService._adapt_scene_allowed_character_references(request)
        return f"""
Create one SceneBeat for the current imported novel scene.
Required:
- Keep the mainline smooth and playable.
- Use only valid AgentVN command types: dialog, narration, hide_dialog, background, show_image, video, sprite, choice, state_update, conditional_jump, jump, animation, bgm, sfx, camera, wait.
- Camera commands may use either structured motion or legacy action/params, but never mix both formats in one command. Prefer structured motion for new camera work.
- Use show_image for key items, clues, photos, letters, or props that should be shown in focused detail.
- Use concise Chinese narration and dialogue.
- For dialog/sprite character_id, use only the exact Chinese character_id/name from Known characters or the scene candidate.
  Never invent placeholders such as senpai, senior, main_character, protagonist, speaker, or narrator.
  If a speaker name is not in Allowed character references, rewrite that line as narration instead of a dialog command.
  If the source uses a shortened name, resolve it only when it clearly matches an allowed full name or alias.
- The scene_candidate includes source_span/source offsets and a command draft; preserve the covered source span in the adapted content.
- Return a non-empty commands array and a summary for every scene.
- Do not output source_mapping, conflict_points, branch_suggestions, review_notes, or needs_review.

Outline:
{request.outline_summary or "none"}

Previous scene summary:
{request.previous_scene_summary or "none"}

Scene candidate:
{request.scene_candidate.model_dump_json()}

Known characters:
{[character.model_dump() for character in request.known_characters]}

Allowed character references:
{allowed_character_references}

Import options:
{request.import_options.model_dump_json()}
"""

    @staticmethod
    def _conflict_analysis_system_prompt() -> str:
        return (
            "Analyze one adapted visual-novel scene for timeline, motivation, fact, transition, "
            "and branch-opportunity conflicts. Return only { conflict_points, warnings }. "
            "Do not return scene commands or branch suggestions."
        )

    @staticmethod
    def _conflict_analysis_user_prompt(request: NovelAiAdaptSceneRequest, scene_beat: SceneBeat) -> str:
        return f"""
Analyze conflicts for this imported scene after adaptation.
Return conflict_points only when there is a concrete issue or branch opportunity. Low-confidence notes go to warnings.

Scene candidate:
{request.scene_candidate.model_dump_json()}

Adapted SceneBeat:
{scene_beat.model_dump_json()}

Allow branch suggestions later: {request.import_options.allow_branch_suggestions}
"""

    @staticmethod
    def _branch_suggestion_system_prompt() -> str:
        return (
            "Create optional branch suggestions for an imported visual-novel scene. "
            "Return only { branch_suggestions, warnings }. Return 0 to 2 high-confidence suggestions when plausible; "
            "do not invent branches to satisfy a quota. "
            "Every suggestion must be disabled by default. "
            "Do not write full branch scenes."
        )

    @staticmethod
    def _branch_suggestion_user_prompt(
        request: NovelAiAdaptSceneRequest,
        conflict_points: list[ConflictPoint],
    ) -> str:
        return f"""
Create optional branch suggestions from high-confidence conflicts only.
Each branch should become a placeholder scene for the author to continue later.
Every source_scene_id must exactly equal the current scene_candidate_id: {request.scene_candidate.scene_candidate_id}
Do not use chapter_id, scene title, display name, summary, a future id, or an invented id as source_scene_id.
Set enabled_by_default=false for every suggestion.
Return at most 2 suggestions. If no branch is appropriate, return an empty branch_suggestions array and explain why in warnings.

Scene candidate:
{request.scene_candidate.model_dump_json()}

Conflict points:
{[conflict.model_dump() for conflict in conflict_points]}
"""

    @staticmethod
    def _scene(chapter_id: str, index: int, start: int, end: int, text: str) -> SceneCandidate:
        return SceneCandidate(
            scene_candidate_id=new_id("scene_candidate"),
            chapter_id=chapter_id,
            title=f"场景 {index + 1}",
            display_name=f"第 {index + 1} 场",
            index=index,
            start_offset=start,
            end_offset=end,
            location_hint=(find_keywords(text, LOCATION_KEYWORDS) or [None])[0],
            time_hint=(find_keywords(text, TIME_KEYWORDS) or [None])[0],
            characters=extract_speakers(text, limit=20),
            source_span=SourceSpan(start_offset=start, end_offset=end),
            source_excerpt=text,
            summary=text[:120],
            commands=[
                BackgroundCommand(
                    background_id=f"bg_{(find_keywords(text, LOCATION_KEYWORDS) or ['unknown'])[0]}",
                    background_fit="stretch",
                    transition="fade",
                    transition_display_name="淡入过场",
                ),
                NarrationCommand(text=(text.strip() or "待改编场景")[:180]),
            ],
            confidence=0.55,
        )

    @staticmethod
    def _scene_chapter_candidate(request: NovelAiChunkRequest) -> ChapterCandidate:
        return ChapterCandidate(
            chapter_id=new_id("chapter"),
            title=f"文本块 {request.index + 1}",
            index=request.index,
            start_offset=request.start_offset,
            end_offset=request.end_offset,
            summary=request.text[:240],
            confidence=0.35,
        )
