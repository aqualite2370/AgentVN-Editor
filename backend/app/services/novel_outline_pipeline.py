"""Bounded, resumable outline aggregation. Never retry a paid call implicitly."""
from __future__ import annotations

import hashlib
import json
import math

from app.ai.context_budget import context_budget_tokens, estimate_tokens
from app.core.errors import AIProviderError
from app.models.novel_import import (
    NovelAiChunkAnalysis, NovelAiOutlineIndex, NovelAiOutlineMainline,
    NovelAiOutlineStructure,
)

VERSION = "outline-budget-v1"
MODELS = {"mainline": NovelAiOutlineMainline, "structure": NovelAiOutlineStructure,
          "index": NovelAiOutlineIndex}
LABELS = {"mainline": "主线", "structure": "章节结构", "index": "人物索引"}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":")).encode("utf-8")).hexdigest()


def tokens(text):
    # The legacy whitespace estimate undercounts compact JSON and long Latin words.
    return max(estimate_tokens(text), math.ceil(len(text.encode("utf-8")) / 3))


def unique(values):
    return list(dict.fromkeys(values))


class OutlinePipeline:
    def __init__(self, service, request, *, streaming=True):
        self.service, self.request = service, request
        self.streaming = streaming
        self.mainline_warnings = []
        self.mainline_review = False
        self.mainline_confidence = 1.0
        self.cached = {row.key: row for row in request.partial_batches}
        self.source_hash = digest({"document_id": request.document_id, "title": request.title,
            "total_chars": request.total_chars, "analyses": [a.model_dump() for a in request.analyses],
            "branches": request.allow_branch_suggestions})
        self.reuse_full = not request.partial_source_hash or request.partial_source_hash == self.source_hash

    def prompts(self, stage, rows, mainline=None):
        local = self.request.model_copy(update={"analyses": rows, "partial_mainline": None,
            "partial_structure": None, "partial_index": None, "partial_batches": []})
        system = getattr(self.service, f"_outline_{stage}_system_prompt")()
        method = getattr(self.service, f"_outline_{stage}_user_prompt")
        user = method(local) if stage == "mainline" else method(local, mainline)
        # Concrete bounds leave room for complete JSON, never trim validated results.
        system += (
            "\n控制本批输出规模：summary最多300字，main_plot最多1200字；"
            "每章summary最多100字；warnings仅列本批新增问题、最多6条、每条最多80字；"
            "不要重复逐段警告。保留所有本批章节范围，不能为了简短遗漏章节。"
        )
        return system, user

    def selection(self, stage):
        selection = self.service._json_mode_selection(self.request.provider_selection, "outline")
        kwargs = {}
        if selection and selection.parameters and selection.parameters.max_tokens:
            kwargs["max_tokens"] = selection.parameters.max_tokens
        # Use exactly the same floors as transport, including unknown model aliases.
        self.service.provider._apply_structured_token_floor(MODELS[stage], kwargs)
        output = int(kwargs["max_tokens"])
        if selection:
            values = selection.model_dump()
            values["parameters"] = {**(values.get("parameters") or {}), "max_tokens": output}
            selection = type(selection)(**values)
        budget = context_budget_tokens(selection)
        available = budget - max(math.ceil(output * 1.25), math.ceil(budget * .3)) - 512
        return selection, output, available

    def fits(self, stage, rows, mainline):
        _, _, available = self.selection(stage)
        system, user = self.prompts(stage, rows, mainline)
        schema = json.dumps(MODELS[stage].model_json_schema(), ensure_ascii=False)
        configured = self.request.provider_selection
        extra = configured.parameters.system_prompt if configured and configured.parameters else None
        return tokens(system + user + schema + (extra or "")) <= available

    def groups(self, stage, rows, mainline=None):
        groups, current = [], []
        for row in rows:
            candidate = [*current, row]
            # Bound both input and predicted output: many short source rows can
            # otherwise fit input while overflowing the chapter JSON response.
            chapter_count = sum(len(r.chapter_candidates) for r in candidate)
            character_count = sum(len(r.characters) for r in candidate)
            if current and (len(candidate) > 4 or chapter_count > 8
                            or (stage == "index" and character_count > 16)
                            or not self.fits(stage, candidate, mainline)):
                groups.append(current)
                current = []
            if not self.fits(stage, [row], mainline):
                raise AIProviderError(
                    f"大纲{LABELS[stage]}单批输入超过预算；扫描结果已保留，"
                    "请提高已核实的上下文预算或将该批扫描范围拆小后继续。未发送本批模型请求。")
            current.append(row)
        if current:
            groups.append(current)
        return groups

    def stage_rows(self, stage):
        """Limit output cardinality even when one scan found many entities."""
        rows = []
        for analysis in self.request.analyses:
            if stage == "structure":
                fields = {"characters": [], "locations": [], "warnings": []}
                items, size, field = analysis.chapter_candidates, 6, "chapter_candidates"
            else:
                fields = {"chapter_candidates": [], "timeline": [], "foreshadowing": [], "warnings": []}
                items, size, field = analysis.characters, 8, "characters"
            for offset in range(0, max(1, len(items)), size):
                values = {**fields, field: items[offset:offset + size]}
                if offset:
                    values["chunk_id"] = analysis.chunk_id + f":{stage}:{offset}"
                rows.append(analysis.model_copy(update=values))
        return rows

    def remember_mainline(self, result):
        self.mainline_warnings.extend(result.warnings)
        self.mainline_review = self.mainline_review or result.needs_review
        self.mainline_confidence = min(self.mainline_confidence, result.coverage_confidence)

    def call(self, stage, rows, mainline, number, total):
        model = MODELS[stage]
        system, user = self.prompts(stage, rows, mainline)
        key = digest({"version": VERSION, "stage": stage, "system": system, "user": user})
        cached = self.cached.get(key)
        if cached and cached.stage == stage:
            try:
                result = model.model_validate(cached.payload)
                self.validate(stage, rows, result)
            except (ValueError, AIProviderError):
                pass
            else:
                if stage == "mainline":
                    self.remember_mainline(result)
                yield "trace", {"phase": f"outline_{stage}", "level": "info",
                    "title": "复用已保存批次", "message": f"{LABELS[stage]} {number}/{total}",
                    "details": {"batchKey": key}}
                return result
        selection, output, _ = self.selection(stage)
        yield "status", f"正在合成{LABELS[stage]} {number}/{total}"
        yield "trace", {"phase": f"outline_{stage}", "level": "info", "title": "大纲批次",
            "message": f"{LABELS[stage]} {number}/{total}",
            "details": {"batchKey": key, "max_tokens": output,
                "estimated_prompt_tokens": tokens(system + user),
                "context_budget_tokens": context_budget_tokens(selection), "sourceRows": len(rows)}}
        try:
            if self.streaming:
                result = yield from self.service._stream_structured_result(
                    model, system, user, temperature=.2, selection=selection, phase=f"outline_{stage}")
            else:
                result = self.service.provider.create_with_tools(
                    model, system, user, temperature=.2, selection=selection)
            self.validate(stage, rows, result)
        except AIProviderError as exc:
            raise AIProviderError(
                f"大纲{LABELS[stage]}第{number}/{total}批失败；已完成批次保留，未自动重试。{exc}"
            ) from exc
        payload = {"key": key, "stage": stage, "payload": result.model_dump(mode="json")}
        if stage == "mainline":
            self.remember_mainline(result)
        yield "checkpoint", {"stage": "batch", "payload": payload}
        return result

    def validate(self, stage, rows, result):
        if stage == "mainline":
            if result.document_id != self.request.document_id:
                raise AIProviderError("大纲主线的文档归属不匹配，未写入断点。")
            if len(result.summary) > 600 or len(result.main_plot) > 2400:
                raise AIProviderError("大纲主线摘要超过单批预算，未截断或写入结果。")
        if stage != "structure" or not rows or len(self.request.analyses) <= 4:
            return
        source = [c for row in rows for c in row.chapter_candidates]
        if not source:
            return
        start, end = min(c.start_offset for c in source), max(c.end_offset for c in source)
        chapters = sorted(result.chapters, key=lambda c: c.start_offset)
        if not chapters or chapters[0].start_offset != start or chapters[-1].end_offset != end:
            raise AIProviderError("章节覆盖不完整；未用拉伸原文范围掩盖缺失章节。")
        if any(c.end_offset <= c.start_offset or c.start_offset < start or c.end_offset > end
               for c in chapters):
            raise AIProviderError("章节原文范围超出本批或为空。")
        for candidate in source:
            covered_to = candidate.start_offset
            for chapter in chapters:
                if chapter.start_offset > covered_to:
                    break
                if chapter.end_offset > covered_to:
                    covered_to = chapter.end_offset
            if covered_to < candidate.end_offset:
                raise AIProviderError("章节原文范围有遗漏，未写入断点。")

    def mainline(self):
        old = self.request.partial_mainline if self.reuse_full else None
        if old is not None:
            if old.document_id != self.request.document_id:
                raise AIProviderError("主线断点属于其它文档。")
            return old
        # Mainline needs summaries, not all duplicated character/chapter/warning
        # arrays. Detailed facts remain in scans and local structure/index work.
        rows = [NovelAiChunkAnalysis(chunk_id=a.chunk_id, index=a.index,
                summary=a.summary, confidence=a.confidence) for a in self.request.analyses]
        if not rows:
            rows = [NovelAiChunkAnalysis(chunk_id="empty", index=0, summary="无正文")]
        for level in range(16):
            groups = self.groups("mainline", rows)
            if level and len(groups) >= len(rows) and len(rows) > 1:
                raise AIProviderError("主线归并无法在当前预算内收敛；断点保留，未自动重试。")
            results = []
            for i, group in enumerate(groups):
                results.append((yield from self.call("mainline", group, None, i+1, len(groups))))
            if len(results) == 1:
                result = results[0]
                result = result.model_copy(update={"warnings": unique(self.mainline_warnings),
                    "needs_review": self.mainline_review, "coverage_confidence": self.mainline_confidence})
                yield "checkpoint", {"stage": "mainline", "payload": result.model_dump(mode="json")}
                return result
            rows = [NovelAiChunkAnalysis(chunk_id="reduce_" + digest([r.model_dump() for r in group]),
                    index=i, summary=value.summary + "\n" + value.main_plot,
                    warnings=value.warnings, confidence=value.coverage_confidence)
                    for i, (group, value) in enumerate(zip(groups, results))]
        raise AIProviderError("主线归并层级超限；已有断点保留。")

    def run(self):
        yield "checkpoint", {"stage": "source", "payload": self.source_hash}
        mainline = yield from self.mainline()
        values = {}
        for stage in ("structure", "index"):
            old = getattr(self.request, "partial_" + stage) if self.reuse_full else None
            if old is not None:
                values[stage] = old
                continue
            groups = self.groups(stage, self.stage_rows(stage), mainline)
            parts = []
            for i, group in enumerate(groups):
                parts.append((yield from self.call(stage, group, mainline, i+1, len(groups))))
            values[stage] = self.merge(stage, parts)
            yield "checkpoint", {"stage": stage, "payload": values[stage].model_dump(mode="json")}
        result = self.service._compose_outline_response(self.request, mainline, values["structure"], values["index"])
        # Original scan warnings are never discarded to keep model output small.
        result.warnings = unique([*result.warnings, *(w for a in self.request.analyses for w in a.warnings)])
        yield "final", result

    @staticmethod
    def merge(stage, parts):
        if stage == "structure":
            chapters, seen_ids = [], set()
            for part in parts:
                for chapter in part.chapters:
                    # Preserve established IDs, disambiguate only genuine collisions.
                    if chapter.chapter_id in seen_ids:
                        chapter = chapter.model_copy(update={"chapter_id": chapter.chapter_id + "_" +
                            digest([chapter.start_offset, chapter.end_offset])[:10]})
                    seen_ids.add(chapter.chapter_id)
                    chapters.append(chapter.model_copy(update={"index": len(chapters)}))
            return NovelAiOutlineStructure(chapters=chapters,
                timeline=unique([v for p in parts for v in p.timeline]),
                branch_or_foreshadowing=unique([v for p in parts for v in p.branch_or_foreshadowing]),
                conflict_points=[v for p in parts for v in p.conflict_points],
                warnings=unique([v for p in parts for v in p.warnings]))
        characters, by_name = [], {}
        for part in parts:
            for character in part.characters:
                name = character.name.strip()
                if name not in by_name:
                    by_name[name] = len(characters)
                    characters.append(character)
                else:
                    old = characters[by_name[name]]
                    characters[by_name[name]] = old.model_copy(update={
                        "aliases": unique([*old.aliases, *character.aliases]),
                        "description": "\n".join(unique([old.description, character.description])),
                        "first_seen_offset": min(old.first_seen_offset, character.first_seen_offset)})
        return NovelAiOutlineIndex(characters=characters,
            locations=unique([v for p in parts for v in p.locations]),
            warnings=unique([v for p in parts for v in p.warnings]))
