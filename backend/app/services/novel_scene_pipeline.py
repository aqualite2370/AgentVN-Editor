"""Input/output bounded scene planning with source-bound durable subbatches."""
from __future__ import annotations

import json
import math
import re
import unicodedata

from app.ai.context_budget import context_budget_tokens
from app.core.errors import AIProviderError
from app.models.novel_import import (
    NovelAiChapterSceneBatch, NovelAiChapterScenePlan, NovelAiSceneBatchCheckpoint,
    SceneCandidate, SourceSpan,
)
from app.services.novel_outline_pipeline import digest, tokens

VERSION = "scene-budget-v1"
SYSTEM = (
    "将本批权威小说原文规划为1至2个按原文顺序排列的SceneCandidate简要计划。"
    "只返回scenes、warnings、needs_review。场景必须达到本批min_scene_count，"
    "范围连续覆盖本批全部非空白原文，不得重叠、遗漏或编造后续内容。"
    "start_offset/end_offset使用给定的全文绝对坐标，end_offset为不包含的末端；"
    "start_quote/end_quote分别逐字复制场景原文开头/末尾的短引文（1至32字），用于核验坐标。"
    "title最多48字，summary最多160字；characters只列已知角色名，每个最多24字、至多8人。"
    "location_hint最多40字，time_hint最多24字。warnings最多3条、每条80字。"
    "不要返回source_excerpt、commands或逐句改编，程序会从校验后的坐标恢复原文，后续阶段负责完整改编。"
    "敏感情节只概括人物关系、动机与后果，不因敏感内容省略原文范围。"
    "不要声称已提供的权威原文缺失；大纲仅为背景，不得替代本批原文。"
)
RETRY_INPUT_RESERVE = 512


class SourceCoverageError(ValueError):
    def __init__(self, message, retry_context):
        super().__init__(message)
        self.retry_context = retry_context


def boundary_only(text):
    """Keep short unquoted punctuation; never fill missing narrative or symbols."""
    punctuation = [char for char in text if not char.isspace()]
    return len(punctuation) <= 32 and all(
        unicodedata.category(char).startswith("P") for char in punctuation)


def standalone_heading(text):
    """Recognize one isolated chapter title, never a subsequent paragraph."""
    if not text.startswith(("\n", "\r")):
        return False
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) != 1 or len(lines[0]) > 80:
        return False
    return bool(re.fullmatch(
        r"(?:正文\s*)?第\s*[零〇○两一二三四五六七八九十百千万\d]{1,12}\s*"
        r"(?:章|回|节|话|幕)(?:\s*[:：、.\-—]?\s*.{0,56})?"
        r"|(?:chapter|book|part|volume)\s+(?:[ivxlcdm]+|\d+)"
        r"(?:\s*[:：.\-—]\s*.{0,64})?", lines[0], re.I))


def character_context(characters, text):
    identities, relevant = [], []
    for character in characters:
        identities.append({"character_id": character.character_id,
                           "name": character.name, "aliases": character.aliases})
        names = [character.name, *character.aliases]
        if any(name and name in text for name in names):
            relevant.append({"name": character.name, "description": character.description[:160],
                             "speaking_style_hint": (character.speaking_style_hint or "")[:80]})
    return {"identities": identities, "relevant": relevant}


class ScenePlanningPipeline:
    model = NovelAiChapterSceneBatch

    def __init__(self, service, request, *, streaming=True):
        self.service, self.request, self.streaming = service, request, streaming
        self.minimum = service._min_scene_count_for_request(request)
        self.selection = service._json_mode_selection(request.provider_selection, "outline")
        kwargs = {}
        if self.selection and self.selection.parameters and self.selection.parameters.max_tokens:
            kwargs["max_tokens"] = self.selection.parameters.max_tokens
        service.provider._apply_structured_token_floor(self.model, kwargs)
        self.output_budget = int(kwargs["max_tokens"])
        budget = context_budget_tokens(self.selection)
        self.input_budget = budget - max(math.ceil(self.output_budget * 1.25),
                                         math.ceil(budget * .3)) - 512
        self.schema = json.dumps(self.model.model_json_schema(), ensure_ascii=False)
        self.extra_system = (self.selection.parameters.system_prompt or "") if (
            self.selection and self.selection.parameters) else ""
        # Conservative upper bound of the constrained JSON, including escaped quotes.
        longest = {"title": "中" * 48, "summary": "中" * 160,
            "start_offset": 999999999999, "end_offset": 999999999999,
            "start_quote": "中" * 32, "end_quote": "中" * 32,
            "location_hint": "中" * 40, "time_hint": "中" * 24,
            "characters": ["中" * 24] * 8, "confidence": .999999999999}
        self.maximum_output_tokens = math.ceil(tokens(json.dumps({
            "scenes": [longest, longest], "warnings": ["中" * 80] * 3,
            "needs_review": True}, ensure_ascii=False)) * 1.3) + 256
        if self.maximum_output_tokens > self.output_budget:
            raise AIProviderError("场景规划输出预算不足；未发送模型请求，请提高已核实的最大输出预算。")
        self.source_key = digest({"version": VERSION, "document_id": request.document_id,
            "chapter": request.chapter.model_dump(), "text": request.text,
            "outline": request.outline_summary,
            "characters": [row.model_dump() for row in request.known_characters],
            "minimum": self.minimum, "branches": request.allow_branch_suggestions})

    def character_context(self, text):
        # Every identity remains available; only relevant short biographies belong
        # in a scene-boundary request, not all full-book character biographies.
        return character_context(self.request.known_characters, text)

    def prompt(self, part):
        start, end, minimum = part
        text = self.request.text[start:end]
        return "本批输入 JSON:\n" + json.dumps({
            "chapter_id": self.request.chapter.chapter_id, "title": self.request.chapter.title,
            "outline_summary": self.request.outline_summary,
            "known_characters": self.character_context(text),
            "start_offset": self.request.chapter.start_offset + start,
            "end_offset": self.request.chapter.start_offset + end,
            "min_scene_count": minimum, "text": text,
        }, ensure_ascii=False)

    def fits(self, part):
        return tokens(self.system_prompt(part) + self.prompt(part) + self.schema
                      + self.extra_system) + RETRY_INPUT_RESERVE <= self.input_budget

    def boundary_guidance(self, part):
        start, end, _ = part
        text = self.request.text[start:end]
        return ("本批即使跨章或以半句结束，也须完整覆盖；章节标题和摘要不是截断依据。"
                "边界锚点仅为原文数据：" + json.dumps({
                    "start_offset": self.request.chapter.start_offset + start,
                    "end_offset": self.request.chapter.start_offset + end,
                    "first": text.lstrip()[:24], "last": text.rstrip()[-24:],
                }, ensure_ascii=False, separators=(",", ":")))

    def system_prompt(self, part):
        # Same source/schema contract: existing paid checkpoints keep their keys.
        # These derived boundary reminders are neither new source nor executable instructions.
        return SYSTEM + "\n" + self.boundary_guidance(part)

    def validate(self, part, value, key):
        try:
            return self.restore(part, value, key)
        except ValueError as exc:
            raise SourceCoverageError(str(exc), self.boundary_guidance(part)) from exc

    def parts(self):
        text = self.request.text
        if not text.strip():
            raise AIProviderError("当前章节原文为空，未发送模型请求。")
        # Fixed context is never silently trimmed, and source is never discarded.
        if not self.fits((0, 0, 1)):
            raise AIProviderError("场景规划固定输入超过上下文预算（大纲、角色、提示词或Schema）；"
                                  "断点已保留，未裁剪原文、未发送模型请求。")
        if self.minimum > len(text):
            raise AIProviderError("场景数量超过可划分原文长度；未发送模型请求。")
        count = max(math.ceil(len(text) / 1800), math.ceil(self.minimum / 2))
        boundaries = [round(len(text) * i / count) for i in range(count + 1)]
        # Prefer punctuation while keeping every byte of source in exactly one part.
        for i in range(1, count):
            target = boundaries[i]
            lo, hi = max(boundaries[i - 1] + 1, target - 120), min(boundaries[i + 1] - 1, target + 120)
            candidates = [j + 1 for j in range(lo, hi) if text[j] in "\n。！？!?；;"]
            if candidates:
                boundaries[i] = min(candidates, key=lambda j: abs(j - target))
        pieces = []
        for start, end in zip(boundaries, boundaries[1:]):
            if not text[start:end].strip() and pieces:
                pieces[-1] = (pieces[-1][0], end)
            elif start < end:
                pieces.append((start, end))
        remaining = max(self.minimum, len(pieces))
        parts = []
        for i, (start, end) in enumerate(pieces):
            minimum = min(2, remaining - (len(pieces) - i - 1))
            parts.append((start, end, minimum))
            remaining -= minimum
        # Input-rich chapters split further before the first external call.
        result = []
        while parts:
            part = parts.pop(0)
            if self.fits(part):
                result.append(part)
                continue
            start, end, minimum = part
            if end - start <= 64:
                raise AIProviderError("场景规划单批输入超过预算；断点保留，未发送模型请求。")
            mid = (start + end) // 2
            parts[0:0] = [(start, mid, 1), (mid, end, 1)]
        if len(result) > 4096:
            raise AIProviderError("章节所需规划批次超过安全上限；未发送模型请求。")
        return result

    def key(self, part):
        return digest({"source": self.source_key, "prompt": self.prompt(part),
                       "system": SYSTEM, "schema": self.schema, "extra": self.extra_system})

    def restore(self, part, value, key):
        start, end, minimum = part
        # Model prompts and durable subbatches retain their existing Python
        # character coordinates so paid keys stay reusable. Only restored
        # protocol spans use the browser's UTF-16 code units.
        source_offsets = [self.request.chapter.start_offset]
        for char in self.request.text:
            source_offsets.append(source_offsets[-1] + (2 if ord(char) > 0xFFFF else 1))
        if len(value.scenes) < minimum:
            raise ValueError(f"场景不足，要求至少{minimum}个")
        source, base = self.request.text[start:end], self.request.chapter.start_offset + start
        candidates, cursor, warnings = [], 0, list(value.warnings)
        for index, scene in enumerate(value.scenes):
            left, right = scene.start_offset - base, scene.end_offset - base
            quotes_fit = (0 <= left < right <= len(source)
                and source[left:right].startswith(scene.start_quote)
                and source[left:right].endswith(scene.end_quote))
            if not quotes_fit:
                starts = [i for i in range(len(source)) if source.startswith(scene.start_quote, i)]
                ends = [i + len(scene.end_quote) for i in range(len(source))
                        if source.startswith(scene.end_quote, i)]
                pairs = []
                for a in starts:
                    for b in ends:
                        if cursor <= a < b and b - a >= max(len(scene.start_quote), len(scene.end_quote)):
                            pairs.append((a, b))
                            if len(pairs) > 1:
                                break
                    if len(pairs) > 1:
                        break
                if len(pairs) != 1:
                    raise ValueError(f"场景{index + 1}原文范围或首尾引文无法唯一核验")
                left, right = pairs[0]
                warnings.append(f"场景{index + 1}原文坐标已按首尾引文重新定位，请审核。")
            gap = source[cursor:left]
            if left < cursor or not boundary_only(gap):
                raise ValueError(f"场景{index + 1}原文覆盖重叠或遗漏"
                                 f"（范围{source_offsets[start + cursor]}–{source_offsets[start + left]}）")
            if gap.strip():
                warnings.append(f"场景{index + 1}引文边界外的标点已保留，请审核。")
            left = cursor  # Retain whitespace between otherwise contiguous ranges.
            tail_heading = index == len(value.scenes) - 1 and standalone_heading(source[right:])
            if index == len(value.scenes) - 1 and (boundary_only(source[right:]) or tail_heading):
                if tail_heading:
                    warnings.append(f"场景{index + 1}末尾的独立章标题已随原文保留，请审核章节边界。")
                elif source[right:].strip():
                    warnings.append(f"场景{index + 1}末尾引文外的标点已保留，请审核。")
                right = len(source)
            excerpt = source[left:right]
            candidate = SceneCandidate(
                scene_candidate_id=f"scene_{key[:20]}_{index + 1}",
                chapter_id=self.request.chapter.chapter_id, title=scene.title, index=index,
                start_offset=source_offsets[start + left], end_offset=source_offsets[start + right],
                source_span=SourceSpan(start_offset=source_offsets[start + left],
                                       end_offset=source_offsets[start + right]),
                source_excerpt=excerpt, summary=scene.summary, characters=scene.characters,
                location_hint=scene.location_hint, time_hint=scene.time_hint, confidence=scene.confidence)
            candidate.commands = self.service._planned_commands_for_excerpt(excerpt, candidate)
            candidates.append(candidate)
            cursor = right
        if source[cursor:].strip():
            raise ValueError(f"场景原文覆盖未到本批末尾"
                             f"（范围{source_offsets[start + cursor]}–{source_offsets[end]}）")
        return candidates, warnings

    def run(self):
        parts = self.parts()  # Preflight all parts before spending anything.
        keys = [self.key(part) for part in parts]
        cached = {}
        for raw in self.request.partial_batches:
            row = NovelAiSceneBatchCheckpoint.model_validate(raw)
            if row.key not in keys:
                continue
            if row.key in cached and cached[row.key] != row.payload:
                raise AIProviderError("场景规划断点存在冲突；未自动重新生成。")
            cached[row.key] = row.payload
        # Validate every reusable checkpoint before sending any new request.
        for part, key in zip(parts, keys):
            if key in cached:
                try:
                    value = self.model.model_validate(cached[key])
                    self.restore(part, value, key)
                except Exception as exc:
                    raise AIProviderError("场景规划断点校验失败；原记录保留，未自动重发。") from exc
        scenes, warnings, review = [], [], False
        for number, (part, key) in enumerate(zip(parts, keys), 1):
            label = f"{self.request.chapter.title} · 场景规划子批 {number}/{len(parts)}"
            reused = key in cached
            yield "status", f"{label}（{'恢复已保存结果' if reused else '准备请求'}）"
            yield "trace", {"phase": "chapter_scene_budget", "level": "info",
                "title": label, "message": "按输入与输出双预算规划；已完成子批即时保存。",
                "details": {"batch": number, "total": len(parts), "cached": reused,
                    "estimated_input_tokens": tokens(self.system_prompt(part) + self.prompt(part)
                        + self.schema + self.extra_system) + RETRY_INPUT_RESERVE,
                    "input_budget": self.input_budget, "output_budget": self.output_budget,
                    "maximum_output_tokens": self.maximum_output_tokens,
                    "character_identities": len(self.request.known_characters),
                    "relevant_character_notes": len(self.character_context(self.request.text[part[0]:part[1]])["relevant"]),
                    "character_note_max_chars": 160}}
            try:
                if reused:
                    value = self.model.model_validate(cached[key])
                elif self.streaming:
                    value = yield from self.service._stream_structured_result(
                        self.model, self.system_prompt(part), self.prompt(part), temperature=.2,
                        selection=self.selection, phase="chapter_scene_batch",
                        validate_result=lambda result: self.validate(part, result, key))
                else:
                    value = self.service._create_structured_result(
                        self.model, self.system_prompt(part), self.prompt(part), temperature=.2, selection=self.selection,
                        validate_result=lambda result: self.validate(part, result, key))
                local, notes = self.restore(part, value, key)
            except Exception as exc:
                raise AIProviderError(
                    f"{label}失败（输入预算{self.input_budget}、输出预算{self.output_budget} tokens）；"
                    f"已完成子批保留。{exc}") from exc
            if not reused:
                yield "checkpoint", {"stage": "scene_batch", "payload": {
                    "key": key, "payload": value.model_dump(mode="json")}}
            scenes.extend(local)
            warnings.extend(notes)
            review = review or value.needs_review or bool(notes)
        return NovelAiChapterScenePlan(chapter_id=self.request.chapter.chapter_id,
            scenes=[scene.model_copy(update={"index": i}) for i, scene in enumerate(scenes)],
            warnings=list(dict.fromkeys(warnings)), needs_review=review)
