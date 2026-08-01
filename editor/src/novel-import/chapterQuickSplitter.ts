import type { ChapterCandidate, ChapterSourceType } from "./types";
import { estimateTextTokens } from "../utils/contextBudget";

interface HeadingMatch {
  title: string;
  start: number;
  sourceType: ChapterSourceType;
  confidence: number;
}

const chineseNumeral = "[零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+";
const romanNumeral = "[ivxlcdm]+";

const txtHeadingPatterns = [
  new RegExp(`^(?:正文\\s*)?第\\s*(?:\\d{1,6}|${chineseNumeral})\\s*[章节回部卷集篇](?:\\s|$|[：:、.．-]).*$`, "i"),
  new RegExp(`^(?:卷|第\\s*(?:\\d{1,6}|${chineseNumeral})\\s*卷)(?:\\s|$|[：:、.．-]).*$`, "i"),
  /^(?:序章|楔子|引子|番外|终章|尾声)(?:\s|$|[：:、.．-]).*$/i,
  new RegExp(`^chapter\\s+(?:\\d+|${romanNumeral})(?:\\s|$|[:：.．、-]).*$`, "i"),
  /^(?:part|book)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s|$|[:：.．、-]).*$/i,
];

export function splitQuickChapters(text: string): ChapterCandidate[] {
  const headings = findChapterHeadings(text);
  if (headings.length === 0) {
    return [createChapter(text, 0, "全文", 0, text.length, "fallback_auto", 0.35)];
  }

  const chapters: ChapterCandidate[] = [];
  if (headings[0].start > 0) {
    chapters.push(createChapter(text, 0, "开篇", 0, headings[0].start, "fallback_auto", 0.45));
  }

  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    chapters.push(createChapter(text, chapters.length, heading.title, heading.start, next?.start ?? text.length, heading.sourceType, heading.confidence));
  });

  return chapters.filter((chapter) => chapter.end_offset > chapter.start_offset);
}

function findChapterHeadings(text: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  const linePattern = /^([^\r\n]{1,120})(?:\r?\n|$)/gm;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(text))) {
    const title = match[1].trim();
    if (!title) continue;
    const markdown = title.match(/^#{1,2}\s+(.{1,100})$/);
    if (markdown?.[1]) {
      headings.push({ title: markdown[1].trim(), start: match.index, sourceType: "markdown_heading", confidence: 0.78 });
    } else if (isLikelyTxtChapterHeading(title)) {
      headings.push({ title, start: match.index, sourceType: "txt_rule", confidence: 0.72 });
    }
  }

  return dedupeNearbyHeadings(headings);
}

function isLikelyTxtChapterHeading(line: string): boolean {
  if (line.length > 80) return false;
  return txtHeadingPatterns.some((pattern) => pattern.test(line));
}

function dedupeNearbyHeadings(headings: HeadingMatch[]): HeadingMatch[] {
  const result: HeadingMatch[] = [];
  for (const heading of headings) {
    const previous = result[result.length - 1];
    if (previous && heading.start - previous.start < 20 && heading.title === previous.title) continue;
    result.push(heading);
  }
  return result;
}

function createChapter(
  text: string,
  index: number,
  title: string,
  start: number,
  end: number,
  sourceType: ChapterSourceType,
  confidence: number
): ChapterCandidate {
  const chapterText = text.slice(start, end);
  const charCount = chapterText.length;
  return {
    chapter_id: `quick_chapter_${index + 1}`,
    title,
    normalized_title: title.trim().toLowerCase(),
    index,
    start_offset: start,
    end_offset: end,
    char_count: charCount,
    word_count: estimateWords(chapterText),
    estimated_tokens: estimateTextTokens(chapterText),
    source_type: sourceType,
    status: sourceType === "fallback_auto" ? "manual_review" : "needs_review",
    anomaly_flags: [],
    summary: "",
    confidence,
  };
}

function estimateWords(text: string): number {
  const latinWords = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return latinWords + cjkChars;
}
