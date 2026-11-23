import type { NovelImportSession } from "./types";

/** Mainline plus neighboring chapter summaries; source text travels separately. */
export function chapterPlanningContext(session: NovelImportSession, chapterId: string): string {
  const outline = session.ai_outline;
  if (!outline) return "";
  const ordered = [...outline.chapters].sort((a, b) => a.index - b.index);
  const at = ordered.findIndex(chapter => chapter.chapter_id === chapterId);
  const related = at < 0 ? [] : ordered.slice(Math.max(0, at - 1), at + 2);
  return [
    `摘要：${outline.summary}`,
    `主线：${outline.main_plot}`,
    `相关章节：${related.map(chapter => `${chapter.index + 1}. ${chapter.title}：${chapter.summary}`).join("\n")}`,
  ].join("\n\n");
}
