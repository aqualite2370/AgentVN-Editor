import type { ChapterCandidate, SceneCandidate } from "./types";

/** A historical "planned" flag cannot prove that a model returned source text. */
export function auditChapterPlanningSource(chapter: ChapterCandidate, scenes: SceneCandidate[], text: string): string[] {
  const rows = scenes.filter(scene => scene.chapter_id === chapter.chapter_id)
    .sort((a, b) => a.start_offset - b.start_offset);
  if (!rows.length) return ["没有场景"];
  const issues: string[] = [];
  let cursor = chapter.start_offset;
  for (let i = 0; i < rows.length; i += 1) {
    const scene = rows[i];
    if (!Number.isInteger(scene.start_offset) || !Number.isInteger(scene.end_offset)
      || scene.start_offset < cursor || scene.end_offset <= scene.start_offset
      || scene.end_offset > chapter.end_offset) {
      issues.push(`场景${i + 1}范围无效或重叠`);
      continue;
    }
    if (text.slice(cursor, scene.start_offset).trim()) issues.push(`场景${i + 1}之前有未覆盖原文`);
    if (text.slice(scene.start_offset, scene.end_offset) !== scene.source_excerpt
      || (scene.source_span && (scene.source_span.start_offset !== scene.start_offset
        || scene.source_span.end_offset !== scene.end_offset))) {
      issues.push(`场景${i + 1}摘录与原文范围不一致`);
    }
    cursor = scene.end_offset;
  }
  if (text.slice(cursor, chapter.end_offset).trim()) issues.push("章末有未覆盖原文");
  return issues;
}

/** Whole-book AI planning must not hide holes behind plausible numeric coverage. */
export function uncoveredChapterRanges(chapters: ChapterCandidate[], text: string): Array<{
  start: number; end: number; before?: string; after?: string;
}> {
  const gaps: Array<{ start: number; end: number; before?: string; after?: string }> = [];
  let cursor = 0;
  let before: string | undefined;
  for (const chapter of [...chapters].sort((a, b) => a.start_offset - b.start_offset)) {
    if (chapter.start_offset > cursor && text.slice(cursor, chapter.start_offset).trim()) {
      gaps.push({ start: cursor, end: chapter.start_offset, before, after: chapter.title });
    }
    cursor = Math.max(cursor, chapter.end_offset);
    before = chapter.title;
  }
  if (text.slice(cursor).trim()) gaps.push({ start: cursor, end: text.length, before });
  return gaps;
}

export interface PlanningSourceGapRepair {
  chapterId: string;
  originalStart: number;
  originalEnd: number;
  start: number;
  end: number;
  addedRanges: Array<{ start: number; end: number }>;
  changedSceneIds: string[];
  addedSceneIds: string[];
}

/** Recover omitted source locally, after planning, without invalidating paid subbatches. */
export function repairPlanningSourceGaps(input: {
  chapters: ChapterCandidate[];
  scenes: SceneCandidate[];
  text: string;
  maxSceneChars: number;
  adaptedSceneIds: string[];
}): { chapters: ChapterCandidate[]; scenes: SceneCandidate[]; repairs: PlanningSourceGapRepair[] } {
  const { text } = input;
  const limit = Math.max(900, Math.min(12000, Math.floor(input.maxSceneChars) || 2200));
  const boundary = (at: number): boolean => Number.isInteger(at) && at >= 0 && at <= text.length
    && !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]));
  const original = [...input.chapters].sort((a, b) => a.start_offset - b.start_offset);
  if (!original.length) throw new Error("没有可恢复原文范围的已规划章节。");
  if (new Set(original.map(c => c.chapter_id)).size !== original.length
    || new Set(input.scenes.map(s => s.scene_candidate_id)).size !== input.scenes.length) {
    throw new Error("章节或场景编号重复，未自动修复原文范围。");
  }
  for (const [index, chapter] of original.entries()) {
    if (!boundary(chapter.start_offset) || !boundary(chapter.end_offset) || chapter.start_offset >= chapter.end_offset
      || (index > 0 && original[index - 1].end_offset > chapter.start_offset)) {
      throw new Error(`「${chapter.title}」原文范围无效、重叠或切断字符，未自动修复。`);
    }
    const issues = auditChapterPlanningSource(chapter, input.scenes, text);
    if (input.scenes.some(scene => scene.chapter_id === chapter.chapter_id
      && (!boundary(scene.start_offset) || !boundary(scene.end_offset)))) {
      issues.push("场景边界切断字符");
    }
    if (issues.length) throw new Error(`「${chapter.title}」规划尚未通过原文校验：${issues.join("；")}`);
  }
  const chapters: ChapterCandidate[] = [], scenes: SceneCandidate[] = [], repairs: PlanningSourceGapRepair[] = [];
  const allIds = new Set(input.scenes.map(s => s.scene_candidate_id));
  const adapted = new Set(input.adaptedSceneIds);
  if (input.scenes.some(s => !original.some(c => c.chapter_id === s.chapter_id))) {
    throw new Error("存在不属于当前章节的场景，未自动修复。");
  }
  for (const [chapterIndex, chapter] of original.entries()) {
    const start = chapterIndex === 0 ? 0 : chapter.start_offset;
    const end = original[chapterIndex + 1]?.start_offset ?? text.length;
    const before = input.scenes.filter(s => s.chapter_id === chapter.chapter_id).sort((a, b) => a.start_offset - b.start_offset);
    let rows = [...before];
    const addedRanges: Array<{ start: number; end: number }> = [];
    const addedSceneIds: string[] = [];
    const extend = (scene: SceneCandidate, left: number, right: number): SceneCandidate => ({
      ...scene, start_offset: left, end_offset: right, source_span: { start_offset: left, end_offset: right },
      source_excerpt: text.slice(left, right),
      commands: [
        ...(left < scene.start_offset && text.slice(left, scene.start_offset).trim()
          ? [{ type: "narration" as const, text: text.slice(left, scene.start_offset) }] : []),
        ...scene.commands,
        ...(right > scene.end_offset && text.slice(scene.end_offset, right).trim()
          ? [{ type: "narration" as const, text: text.slice(scene.end_offset, right) }] : []),
      ],
    });
    const supplement = (left: number, right: number): SceneCandidate[] => {
      const result: SceneCandidate[] = [];
      while (left < right) {
        let cut = Math.min(left + limit, right);
        if (cut < right) {
          const local = text.slice(left, cut), matches = [...local.matchAll(/\n\s*\n|[。！？!?；;]/g)];
          const preferredMatches = matches.filter(m => (m.index ?? 0) >= limit * 0.6);
          const preferred = preferredMatches[preferredMatches.length - 1];
          if (preferred) cut = left + (preferred.index ?? 0) + preferred[0].length;
          if (!boundary(cut)) cut -= 1;
          // Leave the final source character with trailing whitespace rather than
          // manufacturing a whitespace-only playable scene.
          if (!text.slice(cut, right).trim()) {
            while (cut > left && /\s/.test(text[cut - 1])) cut -= 1;
            cut -= 1;
            if (!boundary(cut)) cut -= 1;
          }
        }
        if (cut <= left) throw new Error("补充原文无法安全分页，未写入。");
        const id = `scene_source_${chapter.chapter_id}_${left}_${cut}`;
        if (allIds.has(id)) throw new Error("补充场景编号冲突，未覆盖已有内容。");
        allIds.add(id); addedSceneIds.push(id);
        result.push({
          scene_candidate_id: id, chapter_id: chapter.chapter_id, index: 0,
          title: `${chapter.title} · 补充原文 ${result.length + 1}`, summary: chapter.summary,
          start_offset: left, end_offset: cut, source_span: { start_offset: left, end_offset: cut },
          source_excerpt: text.slice(left, cut), characters: [],
          commands: [{ type: "narration", text: text.slice(left, cut) }], confidence: 0.7,
        });
        left = cut;
      }
      return result;
    };
    // Whitespace inside a previously valid chapter is retained in the next scene.
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i - 1].end_offset < rows[i].start_offset) {
        const left = rows[i - 1].end_offset, right = rows[i].start_offset;
        if (text.slice(left, right).trim()) throw new Error("章内仍有正文遗漏，未绕过场景校验。");
        rows[i] = extend(rows[i], left, rows[i].end_offset);
      }
    }
    const edge = (left: number, right: number, atStart: boolean) => {
      if (left >= right) return;
      addedRanges.push({ start: left, end: right });
      const at = atStart ? 0 : rows.length - 1, current = rows[at], value = text.slice(left, right);
      // Short missing characters join their original sentence; longer prose stays bounded.
      if (!value.trim() || (value.length <= 256 && current.source_excerpt.length + value.length <= limit)) {
        rows[at] = extend(current, atStart ? left : current.start_offset, atStart ? current.end_offset : right);
      } else {
        const extra = supplement(left, right);
        rows = atStart ? [...extra, ...rows] : [...rows, ...extra];
      }
    };
    edge(start, rows[0].start_offset, true);
    edge(rows[rows.length - 1].end_offset, end, false);
    const changedSceneIds = before.filter(s => {
      const next = rows.find(r => r.scene_candidate_id === s.scene_candidate_id);
      return JSON.stringify(next) !== JSON.stringify(s);
    }).map(s => s.scene_candidate_id);
    if (changedSceneIds.some(id => adapted.has(id))) {
      throw new Error(`「${chapter.title}」受影响场景已有改编结果，已保留数据，未自动覆盖。`);
    }
    const changed = start !== chapter.start_offset || end !== chapter.end_offset || changedSceneIds.length > 0 || addedSceneIds.length > 0;
    const repairedChapter = changed ? {
      ...chapter, start_offset: start, end_offset: end, char_count: end - start,
      status: "needs_review" as const,
      metadata: { ...chapter.metadata, source_coverage_repair: {
        version: 1, original_start_offset: chapter.start_offset, original_end_offset: chapter.end_offset,
      } },
    } : chapter;
    if (changed) repairs.push({ chapterId: chapter.chapter_id, originalStart: chapter.start_offset,
      originalEnd: chapter.end_offset, start, end, addedRanges, changedSceneIds, addedSceneIds });
    if (auditChapterPlanningSource(repairedChapter, rows, text).length
      || rows.map(r => r.source_excerpt).join("") !== text.slice(start, end)) {
      throw new Error(`「${chapter.title}」补充后仍未完整覆盖原文，未写入。`);
    }
    chapters.push(repairedChapter); scenes.push(...rows);
  }
  const orderedScenes = repairs.length ? scenes.map((s, index) => s.index === index ? s : { ...s, index }) : input.scenes;
  return { chapters: repairs.length ? chapters : input.chapters, scenes: orderedScenes, repairs };
}
