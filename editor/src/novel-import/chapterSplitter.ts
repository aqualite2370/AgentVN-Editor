import { nanoid } from "nanoid";
import { estimateTokensFromCjkCharCount } from "../utils/contextBudget";
import type {
  ChapterAnomalyFlag,
  ChapterCandidate,
  ChapterRecord,
  ChapterSourceType,
  ChapterSplitReport,
  ChapterStatus,
  ChapterStructureHint,
  NovelFileType,
} from "./types";

type RecommendedAction = ChapterSplitReport["preview"]["recommendedActions"][number];

export interface SplitChaptersOptions {
  bookId?: string;
  documentId?: string;
  fileType?: NovelFileType;
  metadata?: Record<string, unknown>;
  minConfidence?: number;
  fallbackTargetChars?: number;
  fallbackOverlapChars?: number;
}

export interface SplitChaptersAsyncOptions extends SplitChaptersOptions {
  onProgress?: (progress: { current: number; total: number; message: string }) => void;
}

interface TitleNumberInfo {
  value?: number;
  raw?: string;
  unit?: "chapter" | "volume" | "section" | "part" | "book" | "special";
  isVolume?: boolean;
  isSpecial?: boolean;
}

interface ParsedTitle {
  title: string;
  sourceType: ChapterSourceType;
  ruleId: string;
  level?: number;
  numberInfo?: TitleNumberInfo;
  baseConfidence: number;
}

interface InternalCandidate {
  title: string;
  normalizedTitle: string;
  startOffset: number;
  lineEndOffset: number;
  sourceType: ChapterSourceType;
  ruleId: string;
  level?: number;
  confidence: number;
  beforeBlank: boolean;
  afterBlank: boolean;
  numberInfo?: TitleNumberInfo;
  metadata?: Record<string, unknown>;
  anomalyFlags: ChapterAnomalyFlag[];
}

interface TocRegion {
  startOffset: number;
  endOffset: number;
  candidateCount: number;
}

interface CandidateBuildResult {
  candidates: InternalCandidate[];
  tocRegion?: TocRegion;
  tocReferenceTitles: string[];
  rulesUsed: string[];
}

interface SplitChapterRecordsResult {
  records: ChapterRecord[];
  report: ChapterSplitReport;
}

const minimumReliableConfidence = 0.62;
const lowConfidenceThreshold = 0.68;
const tooShortChars = 350;
const tooLongChars = 60000;
const suspiciousPattern = /(http|www\.|qq|微信|VX|公众号|邮箱|email|版权|盗版|防盗|广告|加群|求票|月票|推荐票|打赏|订阅|起点中文网|纵横中文网|晋江文学城|小说网|最新地址|本章未完|点击下一页)/i;
const specialTitlePattern = /^(?:正文\s*)?(序章|楔子|引子|外传|番外|终章|尾声|后记|附录|作品相关|上架感言)(?:\s*[:：、.\-—]?\s*(.{0,48}))?$/u;
const chineseChapterPattern = /^(?:正文\s*)?第\s*([零〇○两一二三四五六七八九十百千万\d]{1,12})\s*(章|回|节|话|幕)(?:\s*[:：、.\-—]?\s*(.{0,56}))?$/u;
const chineseVolumePattern = /^(?:(?:第\s*([零〇○两一二三四五六七八九十百千万\d]{1,12})\s*卷)|(?:卷\s*([零〇○两一二三四五六七八九十百千万\d]{1,12})))(?:\s*[:：、.\-—]?\s*(.{0,56}))?$/u;
const markdownHeadingPattern = /^(#{1,2})\s+(.{1,96})$/u;
const englishTitlePattern = /^(chapter|book|part|volume)\s+([ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?:\s*[:：.\-—]\s*(.{0,64}))?$/iu;
const decorativeEdgePattern = /^[\s#＊*=\-—_·.。:：、【】\[\]（）()]+|[\s#＊*=\-—_·.。:：、【】\[\]（）()]+$/gu;

export function splitChapters(text: string, options: SplitChaptersOptions = {}): ChapterCandidate[] {
  return splitChapterRecords(text, options).records.map(chapterRecordToCandidate);
}

export async function splitChaptersAsync(
  text: string,
  options: SplitChaptersAsyncOptions = {},
): Promise<{ chapters: ChapterCandidate[]; report: ChapterSplitReport }> {
  const result = await splitChapterRecordsAsync(text, options);
  return { chapters: result.records.map(chapterRecordToCandidate), report: result.report };
}

export function splitChapterRecords(text: string, options: SplitChaptersOptions = {}): SplitChapterRecordsResult {
  const build = buildCandidates(text, options);
  return buildRecordsAndReport(text, options, build);
}

export async function splitChapterRecordsAsync(
  text: string,
  options: SplitChaptersAsyncOptions = {},
): Promise<SplitChapterRecordsResult> {
  options.onProgress?.({ current: 0, total: text.length || 1, message: "读取结构化章节线索" });
  const structured = collectStructuredCandidates(text, options);
  const markdown = options.fileType === "md" ? await scanMarkdownCandidatesAsync(text, options) : [];
  options.onProgress?.({ current: Math.min(text.length, 1), total: text.length || 1, message: "扫描本地章节标题" });
  const txt = await scanTextRuleCandidatesAsync(text, options);
  const merged = mergeCandidateCollections(text, options, [...structured, ...markdown, ...txt]);
  options.onProgress?.({ current: text.length, total: text.length || 1, message: "生成章节预览与异常标记" });
  await yieldToUi();
  return buildRecordsAndReport(text, options, merged);
}

export function chapterRecordToCandidate(record: ChapterRecord): ChapterCandidate {
  return {
    chapter_id: record.chapterId,
    book_id: record.bookId,
    title: record.title,
    normalized_title: record.normalizedTitle,
    index: record.index,
    start_offset: record.startOffset,
    end_offset: record.endOffset,
    char_count: record.charCount,
    word_count: record.wordCount,
    estimated_tokens: record.estimatedTokens,
    source_type: record.sourceType,
    status: record.status,
    anomaly_flags: record.anomalyFlags,
    summary: "",
    confidence: record.confidence,
    metadata: record.metadata,
  };
}

export function normalizeChapterTitle(title: string): string {
  return title
    .replace(/^#{1,6}\s+/, "")
    .replace(decorativeEdgePattern, "")
    .replace(/\s+/g, " ")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .trim()
    .toLowerCase();
}

export function updateChapterRange(chapter: ChapterCandidate, start: number, end: number): ChapterCandidate {
  const nextStart = Math.max(0, start);
  const nextEnd = Math.max(nextStart, end);
  return {
    ...chapter,
    start_offset: nextStart,
    end_offset: nextEnd,
    char_count: nextEnd - nextStart,
    estimated_tokens: estimateTokensForTextLength(nextEnd - nextStart),
  };
}

function buildCandidates(text: string, options: SplitChaptersOptions): CandidateBuildResult {
  return mergeCandidateCollections(text, options, [
    ...collectStructuredCandidates(text, options),
    ...(options.fileType === "md" ? scanMarkdownCandidates(text, options) : []),
    ...scanTextRuleCandidates(text, options),
  ]);
}

function collectStructuredCandidates(text: string, options: SplitChaptersOptions): InternalCandidate[] {
  const hints = readStructuredHints(options.metadata);
  return hints.flatMap((hint): InternalCandidate[] => {
    const title = normalizeVisibleTitle(hint.title);
    if (!title) return [];
    const startOffset = clampOffset(hint.start_offset, text.length);
    const lineEndOffset = hint.end_offset !== undefined ? clampOffset(hint.end_offset, text.length) : findLineEnd(text, startOffset);
    const parsedNumber = parseNumberInfoFromTitle(title);
    return [{
      title,
      normalizedTitle: normalizeChapterTitle(title),
      startOffset,
      lineEndOffset,
      sourceType: hint.source_type,
      ruleId: hint.source_type,
      level: hint.level,
      confidence: clamp01((hint.confidence ?? 0.86) + (hint.source_type === "epub_toc" ? 0.06 : 0)),
      beforeBlank: true,
      afterBlank: true,
      numberInfo: parsedNumber,
      metadata: hint.metadata,
      anomalyFlags: [],
    }];
  });
}

function readStructuredHints(metadata?: Record<string, unknown>): ChapterStructureHint[] {
  const raw = metadata?.structured_chapter_hints;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ChapterStructureHint[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<ChapterStructureHint>;
    if (typeof candidate.title !== "string" || typeof candidate.start_offset !== "number" || typeof candidate.source_type !== "string") return [];
    return [{
      title: candidate.title,
      start_offset: candidate.start_offset,
      end_offset: typeof candidate.end_offset === "number" ? candidate.end_offset : undefined,
      source_type: candidate.source_type as ChapterSourceType,
      level: typeof candidate.level === "number" ? candidate.level : undefined,
      confidence: typeof candidate.confidence === "number" ? candidate.confidence : undefined,
      metadata: candidate.metadata && typeof candidate.metadata === "object" ? candidate.metadata as Record<string, unknown> : undefined,
    }];
  });
}

function scanMarkdownCandidates(text: string, options: SplitChaptersOptions): InternalCandidate[] {
  const result: InternalCandidate[] = [];
  forEachLine(text, (line) => {
    const parsed = parseMarkdownTitle(line.trimmed);
    if (parsed) result.push(candidateFromParsedLine(line, parsed, options));
  });
  return result;
}

async function scanMarkdownCandidatesAsync(text: string, options: SplitChaptersAsyncOptions): Promise<InternalCandidate[]> {
  const result: InternalCandidate[] = [];
  await forEachLineAsync(text, async (line) => {
    const parsed = parseMarkdownTitle(line.trimmed);
    if (parsed) result.push(candidateFromParsedLine(line, parsed, options));
    options.onProgress?.({ current: line.endOffset, total: text.length || 1, message: "扫描 Markdown 标题" });
  });
  return result;
}

function scanTextRuleCandidates(text: string, options: SplitChaptersOptions): InternalCandidate[] {
  const result: InternalCandidate[] = [];
  forEachLine(text, (line) => {
    const parsed = parseTextTitle(line.trimmed);
    if (parsed) result.push(candidateFromParsedLine(line, parsed, options));
  });
  return result;
}

async function scanTextRuleCandidatesAsync(text: string, options: SplitChaptersAsyncOptions): Promise<InternalCandidate[]> {
  const result: InternalCandidate[] = [];
  await forEachLineAsync(text, async (line) => {
    const parsed = parseTextTitle(line.trimmed);
    if (parsed) result.push(candidateFromParsedLine(line, parsed, options));
    if (line.endOffset > 0 && line.endOffset % 180000 < Math.max(1, line.raw.length + 1)) {
      options.onProgress?.({ current: line.endOffset, total: text.length || 1, message: "扫描 TXT 章节规则" });
      await yieldToUi();
    }
  });
  return result;
}

function parseMarkdownTitle(trimmed: string): ParsedTitle | undefined {
  const match = trimmed.match(markdownHeadingPattern);
  if (!match) return undefined;
  const level = match[1]?.length ?? 1;
  const title = normalizeVisibleTitle(match[2] ?? "");
  if (!title || looksLikeNoise(title)) return undefined;
  return {
    title,
    sourceType: "markdown_heading",
    ruleId: "markdown_heading",
    level,
    numberInfo: parseNumberInfoFromTitle(title),
    baseConfidence: 0.82,
  };
}

function parseTextTitle(trimmed: string): ParsedTitle | undefined {
  const line = normalizeVisibleTitle(trimmed);
  if (!line || line.length > 96) return undefined;
  if (looksLikeNoise(line)) return undefined;

  const special = line.match(specialTitlePattern);
  if (special) {
    const title = normalizeVisibleTitle(`${special[1] ?? ""}${special[2] ? ` ${special[2]}` : ""}`);
    return {
      title,
      sourceType: "txt_rule",
      ruleId: "txt_special",
      numberInfo: { unit: "special", isSpecial: true, raw: special[1] },
      baseConfidence: 0.7,
    };
  }

  const volume = line.match(chineseVolumePattern);
  if (volume) {
    const rawNumber = volume[1] ?? volume[2] ?? "";
    return {
      title: line,
      sourceType: "txt_rule",
      ruleId: "txt_volume",
      numberInfo: {
        value: parseOrdinal(rawNumber),
        raw: rawNumber,
        unit: "volume",
        isVolume: true,
      },
      baseConfidence: 0.66,
    };
  }

  const chapter = line.match(chineseChapterPattern);
  if (chapter) {
    const rawNumber = chapter[1] ?? "";
    const unit = chapter[2] ?? "章";
    return {
      title: line,
      sourceType: "txt_rule",
      ruleId: `txt_${unit}`,
      numberInfo: {
        value: parseOrdinal(rawNumber),
        raw: rawNumber,
        unit: unit === "章" ? "chapter" : "section",
      },
      baseConfidence: 0.72,
    };
  }

  const english = line.match(englishTitlePattern);
  if (english) {
    const kind = (english[1] ?? "chapter").toLowerCase();
    const rawNumber = english[2] ?? "";
    return {
      title: line,
      sourceType: "txt_rule",
      ruleId: `txt_${kind}`,
      numberInfo: {
        value: parseEnglishOrdinal(rawNumber),
        raw: rawNumber,
        unit: kind === "chapter" ? "chapter" : kind as TitleNumberInfo["unit"],
        isVolume: kind === "book" || kind === "part" || kind === "volume",
      },
      baseConfidence: 0.7,
    };
  }

  return undefined;
}

function parseNumberInfoFromTitle(title: string): TitleNumberInfo | undefined {
  return parseTextTitle(title)?.numberInfo;
}

function candidateFromParsedLine(
  line: LineInfo,
  parsed: ParsedTitle,
  options: SplitChaptersOptions,
): InternalCandidate {
  const leading = line.raw.match(/^\s*/)?.[0].length ?? 0;
  const title = parsed.title;
  const sourceType = parsed.sourceType === "txt_rule" && options.fileType === "md" ? "markdown_heading" : parsed.sourceType;
  let confidence = parsed.baseConfidence;
  const anomalyFlags: ChapterAnomalyFlag[] = [];

  if (line.isStandalone) confidence += 0.12;
  if (title.length <= 32) confidence += 0.08;
  else if (title.length <= 60) confidence += 0.02;
  else confidence -= 0.2;
  if (line.beforeBlank) confidence += 0.04;
  if (line.afterBlank) confidence += 0.04;
  if (parsed.numberInfo?.value !== undefined) confidence += 0.08;
  if (parsed.numberInfo?.isSpecial) confidence += 0.07;
  if (parsed.numberInfo?.isVolume) confidence += 0.03;
  if (sourceType === "markdown_heading" || sourceType === "html_heading" || sourceType === "docx_heading") confidence += 0.06;
  if (sourceType === "epub_toc") confidence += 0.1;
  if (suspiciousPattern.test(title)) {
    confidence -= 0.32;
    anomalyFlags.push("suspicious_ad");
  }
  if (line.raw.length > 72 && parsed.sourceType === "txt_rule") confidence -= 0.22;
  if (!line.beforeBlank && !line.afterBlank && parsed.sourceType === "txt_rule") confidence -= 0.12;

  return {
    title,
    normalizedTitle: normalizeChapterTitle(title),
    startOffset: line.startOffset + leading,
    lineEndOffset: line.endOffset,
    sourceType,
    ruleId: parsed.ruleId,
    level: parsed.level,
    confidence: clamp01(confidence),
    beforeBlank: line.beforeBlank,
    afterBlank: line.afterBlank,
    numberInfo: parsed.numberInfo,
    metadata: { ruleId: parsed.ruleId },
    anomalyFlags,
  };
}

function mergeCandidateCollections(
  text: string,
  options: SplitChaptersOptions,
  rawCandidates: InternalCandidate[],
): CandidateBuildResult {
  const candidates = dedupeCandidates(rawCandidates)
    .sort((a, b) => a.startOffset - b.startOffset || b.confidence - a.confidence);
  const tocRegion = detectTocRegion(text, candidates);
  const tocReferenceTitles = tocRegion
    ? candidates
      .filter((candidate) => isInsideRange(candidate.startOffset, tocRegion))
      .map((candidate) => candidate.normalizedTitle)
    : [];
  const scored = scoreCandidateSequence(candidates, tocRegion);
  const minConfidence = options.minConfidence ?? minimumReliableConfidence;
  const filtered = scored.filter((candidate) => {
    if (tocRegion && isInsideRange(candidate.startOffset, tocRegion)) return false;
    return candidate.confidence >= minConfidence;
  });
  return {
    candidates: filtered,
    tocRegion,
    tocReferenceTitles,
    rulesUsed: collectRulesUsed(scored, tocRegion),
  };
}

function dedupeCandidates(candidates: InternalCandidate[]): InternalCandidate[] {
  const byStart = new Map<number, InternalCandidate>();
  for (const candidate of candidates) {
    const existing = byStart.get(candidate.startOffset);
    if (!existing || candidate.confidence > existing.confidence) byStart.set(candidate.startOffset, candidate);
  }
  return [...byStart.values()];
}

function scoreCandidateSequence(candidates: InternalCandidate[], tocRegion?: TocRegion): InternalCandidate[] {
  let previousAccepted: InternalCandidate | undefined;
  let previousChapterNumber: number | undefined;
  const seenTitles = new Map<string, number>();

  return candidates.map((candidate) => {
    let confidence = candidate.confidence;
    const anomalyFlags = new Set(candidate.anomalyFlags);
    const insideToc = Boolean(tocRegion && isInsideRange(candidate.startOffset, tocRegion));

    if (insideToc) {
      confidence -= 0.58;
      anomalyFlags.add("toc_duplicate");
      return { ...candidate, confidence: clamp01(confidence), anomalyFlags: [...anomalyFlags] };
    }

    const seen = seenTitles.get(candidate.normalizedTitle) ?? 0;
    if (seen > 0) {
      confidence -= candidate.sourceType === "epub_toc" ? 0.06 : 0.12;
      anomalyFlags.add("duplicate_title");
    }
    seenTitles.set(candidate.normalizedTitle, seen + 1);

    if (previousAccepted) {
      const gap = candidate.startOffset - previousAccepted.startOffset;
      if (gap < 180) {
        confidence -= 0.28;
      } else if (gap < 500) {
        confidence -= 0.12;
      } else if (gap > 1200) {
        confidence += 0.05;
      }
    }

    const numberValue = candidate.numberInfo?.value;
    const isChapterLike = candidate.numberInfo?.unit === "chapter" || candidate.numberInfo?.unit === "section";
    if (isChapterLike && numberValue !== undefined) {
      if (previousChapterNumber !== undefined) {
        if (numberValue === previousChapterNumber + 1) confidence += 0.1;
        else if (numberValue > previousChapterNumber) confidence += 0.03;
        else {
          confidence -= 0.18;
          anomalyFlags.add("non_incremental_index");
        }
      }
      previousChapterNumber = Math.max(previousChapterNumber ?? 0, numberValue);
    }

    confidence = clamp01(confidence);
    const next = { ...candidate, confidence, anomalyFlags: [...anomalyFlags] };
    previousAccepted = next;
    return next;
  });
}

function detectTocRegion(text: string, candidates: InternalCandidate[]): TocRegion | undefined {
  if (candidates.length < 2) return undefined;
  const frontLimit = Math.min(text.length, Math.max(3000, Math.min(30000, Math.ceil(text.length * 0.05))));
  const frontCandidates = candidates.filter((candidate) => candidate.startOffset <= frontLimit);
  if (frontCandidates.length < 2) return undefined;

  const frontText = text.slice(0, frontLimit);
  const labelIndex = findTocLabelIndex(frontText);
  if (labelIndex >= 0) {
    const blankAfterLabel = findBlankLineAfter(frontText, labelIndex);
    if (blankAfterLabel > labelIndex) {
      const labeledCandidates = frontCandidates.filter((candidate) => candidate.startOffset > labelIndex && candidate.startOffset <= blankAfterLabel);
      if (labeledCandidates.length >= 2) {
        return {
          startOffset: labelIndex,
          endOffset: Math.min(text.length, blankAfterLabel + 1),
          candidateCount: labeledCandidates.length,
        };
      }
    }
  }
  let best: TocRegion | undefined;
  for (let start = 0; start < frontCandidates.length; start += 1) {
    for (let end = start + 1; end < frontCandidates.length; end += 1) {
      const first = frontCandidates[start];
      const last = frontCandidates[end];
      if (!first || !last) continue;
      const span = last.startOffset - first.startOffset;
      const count = end - start + 1;
      const averageGap = span / Math.max(1, count - 1);
      const hasLabel = labelIndex >= 0 && labelIndex <= first.startOffset + 1200;
      const denseEnough = count >= 8 && averageGap < 240 && span < 6000;
      const labeledSmallToc = hasLabel && count >= 2 && averageGap < 360 && span < 5000;
      if (!denseEnough && !labeledSmallToc) continue;
      const region: TocRegion = {
        startOffset: Math.max(0, hasLabel ? labelIndex : first.startOffset),
        endOffset: Math.min(text.length, last.lineEndOffset + 1),
        candidateCount: count,
      };
      if (!best || region.candidateCount > best.candidateCount || region.endOffset > best.endOffset) best = region;
    }
  }
  return best;
}

function findTocLabelIndex(frontText: string): number {
  const matches = [...frontText.matchAll(/(^|\n)\s*(目录|目錄|contents|table of contents)\s*(\n|$)/giu)];
  return matches.length ? matches[0]?.index ?? -1 : -1;
}

function findBlankLineAfter(text: string, start: number): number {
  const match = text.slice(start).match(/\n\s*\n/u);
  return match?.index !== undefined ? start + match.index : -1;
}

function collectRulesUsed(candidates: InternalCandidate[], tocRegion?: TocRegion): string[] {
  const rules = new Set(candidates.map((candidate) => candidate.ruleId));
  if (tocRegion) rules.add("toc_dedup");
  rules.add("candidate_scoring");
  return [...rules];
}

function buildRecordsAndReport(
  text: string,
  options: SplitChaptersOptions,
  build: CandidateBuildResult,
): SplitChapterRecordsResult {
  const orderedCandidates = build.candidates
    .sort((a, b) => a.startOffset - b.startOffset)
    .filter((candidate, index, all) => index === 0 || candidate.startOffset > all[index - 1].startOffset);
  const shouldFallback = shouldUseFallback(text, orderedCandidates);
  const records = shouldFallback
    ? buildFallbackRecords(text, options)
    : recordsFromCandidates(text, options, orderedCandidates, build.tocReferenceTitles);
  const report = buildReport(records, options, build, shouldFallback);
  return { records, report };
}

function shouldUseFallback(text: string, candidates: InternalCandidate[]): boolean {
  if (text.trim().length === 0) return true;
  if (candidates.length === 0) return true;
  const reliable = candidates.filter((candidate) => candidate.confidence >= lowConfidenceThreshold);
  if (candidates.length === 1 && text.length > 14000 && candidates[0].sourceType !== "epub_toc") return true;
  if (candidates.length >= 2 && reliable.length >= Math.min(2, candidates.length)) return false;
  const averageConfidence = candidates.reduce((total, candidate) => total + candidate.confidence, 0) / candidates.length;
  return averageConfidence < 0.58;
}

function recordsFromCandidates(
  text: string,
  options: SplitChaptersOptions,
  candidates: InternalCandidate[],
  tocReferenceTitles: string[],
): ChapterRecord[] {
  const bookId = options.bookId ?? options.documentId ?? deriveLocalBookId(options.metadata);
  const tocTitleSet = new Set(tocReferenceTitles);
  const titleCounts = new Map<string, number>();
  return candidates.map((candidate, index) => {
    const startOffset = clampOffset(candidate.startOffset, text.length);
    const endOffset = index + 1 < candidates.length ? clampOffset(candidates[index + 1].startOffset, text.length) : text.length;
    const titleSeen = titleCounts.get(candidate.normalizedTitle) ?? 0;
    titleCounts.set(candidate.normalizedTitle, titleSeen + 1);
    const charCount = Math.max(0, endOffset - startOffset);
    const anomalyFlags = new Set<ChapterAnomalyFlag>(candidate.anomalyFlags);
    if (charCount < tooShortChars) anomalyFlags.add("too_short");
    if (charCount > tooLongChars) anomalyFlags.add("too_long");
    if (candidate.confidence < lowConfidenceThreshold) anomalyFlags.add("low_confidence");
    if (titleSeen > 0) anomalyFlags.add("duplicate_title");
    if (tocTitleSet.has(candidate.normalizedTitle) && candidate.sourceType === "txt_rule") {
      // A matching body heading is expected after a TOC; only flag it when the title is also unusually short.
      if (charCount < tooShortChars) anomalyFlags.add("toc_duplicate");
    }
    const status: ChapterStatus = anomalyFlags.has("low_confidence") || anomalyFlags.has("too_short") ? "needs_review" : "confirmed";
    return {
      chapterId: `chapter_${nanoid(8)}`,
      bookId,
      index,
      title: candidate.title,
      normalizedTitle: candidate.normalizedTitle,
      startOffset,
      endOffset,
      charCount,
      wordCount: estimateWords(text.slice(startOffset, Math.min(endOffset, startOffset + 240000)), charCount),
      estimatedTokens: estimateTokensForTextLength(charCount),
      confidence: roundConfidence(candidate.confidence),
      sourceType: candidate.sourceType,
      status,
      anomalyFlags: [...anomalyFlags],
      metadata: {
        ...candidate.metadata,
        level: candidate.level,
        ruleId: candidate.ruleId,
        titleLineEndOffset: candidate.lineEndOffset,
        number: candidate.numberInfo?.value,
        numberUnit: candidate.numberInfo?.unit,
      },
    };
  });
}

function buildFallbackRecords(text: string, options: SplitChaptersOptions): ChapterRecord[] {
  const bookId = options.bookId ?? options.documentId ?? deriveLocalBookId(options.metadata);
  const target = Math.max(6000, Math.min(12000, options.fallbackTargetChars ?? 9000));
  const overlap = Math.max(300, Math.min(800, options.fallbackOverlapChars ?? 500));
  const records: ChapterRecord[] = [];
  let coreStart = 0;
  while (coreStart < text.length) {
    const coreEnd = chooseFallbackEnd(text, coreStart, target);
    const startOffset = Math.max(0, coreStart - (records.length > 0 ? overlap : 0));
    const endOffset = Math.min(text.length, coreEnd + (coreEnd < text.length ? overlap : 0));
    const charCount = Math.max(0, endOffset - startOffset);
    records.push({
      chapterId: `chapter_${nanoid(8)}`,
      bookId,
      index: records.length,
      title: `自动切片 ${records.length + 1}`,
      normalizedTitle: `fallback-${records.length + 1}`,
      startOffset,
      endOffset,
      charCount,
      wordCount: estimateWords(text.slice(startOffset, Math.min(endOffset, startOffset + 240000)), charCount),
      estimatedTokens: estimateTokensForTextLength(charCount),
      confidence: 0.48,
      sourceType: "fallback_auto",
      status: "needs_review",
      anomalyFlags: ["fallback_generated", "low_confidence"],
      metadata: {
        coreStartOffset: coreStart,
        coreEndOffset: coreEnd,
        overlapChars: overlap,
        targetChars: target,
      },
    });
    if (coreEnd >= text.length) break;
    coreStart = coreEnd;
  }
  return records.length ? records : [{
    chapterId: `chapter_${nanoid(8)}`,
    bookId,
    index: 0,
    title: "自动切片 1",
    normalizedTitle: "fallback-1",
    startOffset: 0,
    endOffset: text.length,
    charCount: text.length,
    wordCount: estimateWords(text, text.length),
    estimatedTokens: estimateTokensForTextLength(text.length),
    confidence: 0.42,
    sourceType: "fallback_auto",
    status: "needs_review",
    anomalyFlags: ["fallback_generated", "low_confidence"],
  }];
}

function chooseFallbackEnd(text: string, start: number, target: number): number {
  if (start + target >= text.length) return text.length;
  const minEnd = Math.min(text.length, start + Math.max(6000, Math.floor(target * 0.72)));
  const maxEnd = Math.min(text.length, start + Math.min(12000, Math.ceil(target * 1.28)));
  const desired = Math.min(text.length, start + target);
  const paragraph = lastBoundaryInRange(text, "\n\n", minEnd, maxEnd, desired);
  if (paragraph !== undefined) return paragraph + 2;
  const singleNewline = lastBoundaryInRange(text, "\n", minEnd, maxEnd, desired);
  if (singleNewline !== undefined) return singleNewline + 1;
  const punctuation = choosePunctuationBoundary(text, minEnd, maxEnd, desired);
  if (punctuation !== undefined) return punctuation + 1;
  return desired;
}

function lastBoundaryInRange(text: string, marker: string, minEnd: number, maxEnd: number, desired: number): number | undefined {
  const before = text.lastIndexOf(marker, desired);
  if (before >= minEnd) return before;
  const after = text.indexOf(marker, desired);
  if (after >= minEnd && after <= maxEnd) return after;
  return undefined;
}

function choosePunctuationBoundary(text: string, minEnd: number, maxEnd: number, desired: number): number | undefined {
  const punctuation = /[。！？!?」”’]/gu;
  let best: number | undefined;
  let match: RegExpExecArray | null;
  while ((match = punctuation.exec(text)) !== null) {
    const index = match.index;
    if (index < minEnd) continue;
    if (index > maxEnd) break;
    if (best === undefined || Math.abs(index - desired) < Math.abs(best - desired)) best = index;
  }
  if (best !== undefined && !hasOpenDialogue(text.slice(Math.max(0, best - 400), best + 1))) return best;
  return best;
}

function buildReport(
  records: ChapterRecord[],
  options: SplitChaptersOptions,
  build: CandidateBuildResult,
  usedFallback: boolean,
): ChapterSplitReport {
  const anomalyRows = records.filter((record) => record.anomalyFlags.length > 0);
  const anomalyRatio = records.length > 0 ? anomalyRows.length / records.length : 1;
  const overallConfidence = records.length > 0
    ? roundConfidence(records.reduce((total, record) => total + record.confidence, 0) / records.length)
    : 0;
  const needsHumanConfirmation = usedFallback || overallConfidence < lowConfidenceThreshold || anomalyRatio > 0.28;
  const lengths = [...records].sort((a, b) => a.charCount - b.charCount);
  const recommendedActions: RecommendedAction[] = usedFallback
    ? ["fallback_slice", "adjust_rules", "manual_split"]
    : needsHumanConfirmation
      ? ["confirm", "adjust_rules", "manual_merge", "manual_split", "fallback_slice"]
      : ["confirm"];
  const sourceType = usedFallback ? "fallback_auto" : dominantSourceType(records, options.fileType);
  return {
    bookId: records[0]?.bookId ?? options.bookId ?? options.documentId ?? deriveLocalBookId(options.metadata),
    sourceType,
    overallConfidence,
    needsHumanConfirmation,
    anomalyRatio: roundConfidence(anomalyRatio),
    tocRange: build.tocRegion,
    tocReferenceTitles: build.tocReferenceTitles.slice(0, 200),
    usedFallback,
    lowConfidenceReason: needsHumanConfirmation ? explainLowConfidence({ usedFallback, overallConfidence, anomalyRatio }) : undefined,
    preview: {
      detectedChapterCount: records.length,
      firstTwentyTitles: records.slice(0, 20).map((record) => record.title),
      averageChapterLength: records.length > 0
        ? Math.round(records.reduce((total, record) => total + record.charCount, 0) / records.length)
        : 0,
      shortestChapter: pickPreviewRow(lengths[0]),
      longestChapter: pickPreviewRow(lengths[lengths.length - 1]),
      anomalyChapters: anomalyRows.slice(0, 80).map((record) => pickPreviewRow(record)).filter(Boolean) as NonNullable<ReturnType<typeof pickPreviewRow>>[],
      rulesUsed: usedFallback ? [...new Set([...build.rulesUsed, "fallback_slicing"])] : build.rulesUsed,
      recommendedActions,
    },
  };
}

function explainLowConfidence(input: { usedFallback: boolean; overallConfidence: number; anomalyRatio: number }): string {
  if (input.usedFallback) return "未识别到可靠章节标题，已按固定长度和段落边界生成兜底切片。";
  if (input.overallConfidence < lowConfidenceThreshold) return "章节标题平均置信度偏低，建议人工确认标题和边界。";
  return "异常章节比例偏高，建议确认过短、过长、重复或疑似广告章节。";
}

function dominantSourceType(records: ChapterRecord[], fileType?: NovelFileType): ChapterSourceType {
  const counts = new Map<ChapterSourceType, number>();
  for (const record of records) counts.set(record.sourceType, (counts.get(record.sourceType) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (dominant) return dominant;
  if (fileType === "epub") return "epub_toc";
  if (fileType === "html" || fileType === "htm" || fileType === "xhtml") return "html_heading";
  if (fileType === "md") return "markdown_heading";
  if (fileType === "docx") return "docx_heading";
  return "txt_rule";
}

function pickPreviewRow(record?: ChapterRecord): ChapterSplitReport["preview"]["shortestChapter"] {
  if (!record) return undefined;
  return {
    chapterId: record.chapterId,
    index: record.index,
    title: record.title,
    charCount: record.charCount,
    confidence: record.confidence,
    anomalyFlags: record.anomalyFlags,
  };
}

interface LineInfo {
  raw: string;
  trimmed: string;
  startOffset: number;
  endOffset: number;
  beforeBlank: boolean;
  afterBlank: boolean;
  isStandalone: boolean;
}

function forEachLine(text: string, callback: (line: LineInfo) => void): void {
  let cursor = 0;
  let previousBlank = true;
  while (cursor <= text.length) {
    const newline = text.indexOf("\n", cursor);
    const lineEnd = newline >= 0 ? newline : text.length;
    const raw = text.slice(cursor, lineEnd).replace(/\r$/, "");
    const nextCursor = newline >= 0 ? newline + 1 : text.length + 1;
    const nextLineEnd = nextCursor <= text.length ? findLineEnd(text, nextCursor) : text.length;
    const nextRaw = nextCursor <= text.length ? text.slice(nextCursor, nextLineEnd).replace(/\r$/, "") : "";
    const trimmed = raw.trim();
    const currentBlank = trimmed.length === 0;
    callback({
      raw,
      trimmed,
      startOffset: cursor,
      endOffset: lineEnd,
      beforeBlank: previousBlank,
      afterBlank: nextRaw.trim().length === 0,
      isStandalone: !currentBlank,
    });
    previousBlank = currentBlank;
    cursor = nextCursor;
    if (cursor > text.length) break;
  }
}

async function forEachLineAsync(text: string, callback: (line: LineInfo) => Promise<void> | void): Promise<void> {
  let cursor = 0;
  let previousBlank = true;
  let lastYieldAt = 0;
  while (cursor <= text.length) {
    const newline = text.indexOf("\n", cursor);
    const lineEnd = newline >= 0 ? newline : text.length;
    const raw = text.slice(cursor, lineEnd).replace(/\r$/, "");
    const nextCursor = newline >= 0 ? newline + 1 : text.length + 1;
    const nextLineEnd = nextCursor <= text.length ? findLineEnd(text, nextCursor) : text.length;
    const nextRaw = nextCursor <= text.length ? text.slice(nextCursor, nextLineEnd).replace(/\r$/, "") : "";
    const trimmed = raw.trim();
    const currentBlank = trimmed.length === 0;
    await callback({
      raw,
      trimmed,
      startOffset: cursor,
      endOffset: lineEnd,
      beforeBlank: previousBlank,
      afterBlank: nextRaw.trim().length === 0,
      isStandalone: !currentBlank,
    });
    previousBlank = currentBlank;
    cursor = nextCursor;
    if (cursor - lastYieldAt > 180000) {
      lastYieldAt = cursor;
      await yieldToUi();
    }
    if (cursor > text.length) break;
  }
}

function normalizeVisibleTitle(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .replace(decorativeEdgePattern, "")
    .trim();
}

function looksLikeNoise(title: string): boolean {
  if (!title) return true;
  if (title.length > 110) return true;
  if (/^https?:\/\//i.test(title) || /www\./i.test(title)) return true;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(title)) return true;
  if (/^[\d\s:：.-]+$/.test(title)) return true;
  if (/copyright|all rights reserved/i.test(title)) return true;
  return false;
}

function parseOrdinal(raw: string): number | undefined {
  const value = raw.trim().replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  if (/^\d+$/.test(value)) return Number(value);
  return parseChineseNumber(value);
}

function parseChineseNumber(raw: string): number | undefined {
  const normalized = raw.replace(/○/g, "〇").replace(/两/g, "二").replace(/零/g, "〇");
  if (!normalized) return undefined;
  const digitValues: Record<string, number> = { "〇": 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if ([...normalized].every((char) => char in digitValues)) {
    return Number([...normalized].map((char) => digitValues[char]).join(""));
  }
  const unitValues: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of normalized) {
    if (char in digitValues) {
      number = digitValues[char];
      continue;
    }
    const unit = unitValues[char];
    if (!unit) return undefined;
    if (unit === 10000) {
      section = (section + number) * unit;
      total += section;
      section = 0;
    } else {
      section += (number || 1) * unit;
    }
    number = 0;
  }
  return total + section + number || undefined;
}

function parseEnglishOrdinal(raw: string): number | undefined {
  const value = raw.trim().toLowerCase();
  if (/^\d+$/.test(value)) return Number(value);
  if (/^[ivxlcdm]+$/i.test(value)) return parseRomanNumeral(value);
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
  };
  return words[value];
}

function parseRomanNumeral(raw: string): number | undefined {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  let previous = 0;
  for (const char of [...raw.toLowerCase()].reverse()) {
    const value = values[char];
    if (!value) return undefined;
    if (value < previous) total -= value;
    else {
      total += value;
      previous = value;
    }
  }
  return total || undefined;
}

function estimateWords(sample: string, totalChars: number): number {
  if (!sample) return 0;
  const cjk = sample.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latin = sample.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const sampled = cjk + latin;
  if (sample.length >= totalChars) return sampled;
  return Math.round(sampled * (totalChars / Math.max(1, sample.length)));
}

function estimateTokensForTextLength(charCount: number): number {
  return Math.max(1, estimateTokensFromCjkCharCount(charCount));
}

function findLineEnd(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);
  return newline >= 0 ? newline : text.length;
}

function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(length, Math.floor(offset)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundConfidence(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function isInsideRange(offset: number, range: TocRegion): boolean {
  return offset >= range.startOffset && offset <= range.endOffset;
}

function hasOpenDialogue(text: string): boolean {
  const quotes = (text.match(/[“”"「」『』]/g) ?? []).length;
  return quotes % 2 === 1;
}

function deriveLocalBookId(metadata?: Record<string, unknown>): string {
  const value = metadata?.file_hash ?? metadata?.file_hash_sha256 ?? metadata?.import_record_id;
  return typeof value === "string" && value ? `book_${value.slice(0, 12)}` : "book_local";
}

async function yieldToUi(): Promise<void> {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    await new Promise<void>((resolve) => {
      window.requestIdleCallback(() => resolve(), { timeout: 50 });
    });
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
