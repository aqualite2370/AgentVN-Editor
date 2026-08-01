import JSZip from "jszip";
import { nanoid } from "nanoid";
import { EmptyDocumentError, UnsupportedFileTypeError } from "./errors";
import { normalizeText } from "./textChunker";
import { estimateTextTokens } from "../utils/contextBudget";
import type {
  ChapterStructureHint,
  NovelChapterStructureDetection,
  NovelFileType,
  NovelImportPreflight,
  NovelPendingImport,
  NovelProcessingTier,
  NovelRecommendedAction,
  NovelTextThresholds,
  SourceDocument,
} from "./types";

// TODO(session-0-config): replace this local default with novel.* config once the shared config store lands.
export const novelPreflightThresholds: NovelTextThresholds = {
  small_text_chars: 120000,
  small_text_words: 40000,
  large_text_chars: 300000,
  large_text_words: 100000,
  max_direct_process_chars: 1200000,
};

const directProcessRisks = [
  "会消耗大量 input tokens",
  "处理速度会明显变慢",
  "长时间请求更容易中断或超时",
];

interface DecodedText {
  text: string;
  encoding: string;
  confidence: number;
  warning?: string;
}

interface ExtractedFileContent extends DecodedText {
  plainText: string;
  structureSource?: string;
  structure?: NovelChapterStructureDetection;
  structuredHints?: ChapterStructureHint[];
}

export function detectFileType(fileName: string): NovelFileType {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".epub")) return "epub";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".htm")) return "htm";
  if (lower.endsWith(".xhtml")) return "xhtml";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".json")) return "json";
  return "unknown";
}

export async function analyzeNovelFile(file: File, language = "zh-CN"): Promise<NovelPendingImport> {
  const fileType = detectFileType(file.name);
  if (fileType === "unknown") throw new UnsupportedFileTypeError(`Unsupported file type: ${file.name}`);

  const buffer = await file.arrayBuffer();
  const [content, fileHash] = await Promise.all([
    extractFileContent(buffer, fileType),
    hashArrayBuffer(buffer),
  ]);
  const normalized = normalizeText(content.plainText);
  if (!normalized) throw new EmptyDocumentError("Document is empty.");

  const structure = content.structure ?? detectChapterStructure(fileType, content.structureSource ?? content.text, normalized);
  const preflight = buildPreflight({
    file,
    fileType,
    decoded: content,
    normalized,
    structure,
    fileHash,
  });
  const originalPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const document: SourceDocument = {
    document_id: `doc_${nanoid(8)}`,
    title: file.name.replace(/\.[^.]+$/, ""),
    file_name: file.name,
    file_type: fileType,
    language,
    raw_text: normalized,
    normalized_text: normalized,
    imported_at: new Date().toISOString(),
    total_chars: normalized.length,
    file_hash: fileHash,
    original_path: originalPath,
    source_paths: [originalPath],
    file_size: file.size,
    metadata: {
      size: file.size,
      mime_type: file.type || undefined,
      encoding: preflight.encoding,
      file_hash_sha256: preflight.file_hash_sha256,
      file_hash: fileHash,
      original_path: originalPath,
      import_preflight: preflight,
      structured_chapter_hints: remapStructuredHints(content.structuredHints ?? [], normalized),
    },
  };

  return { document, preflight };
}

export async function importNovelFile(file: File, language = "zh-CN"): Promise<SourceDocument> {
  const pending = await analyzeNovelFile(file, language);
  return pending.document;
}

async function extractFileContent(buffer: ArrayBuffer, fileType: NovelFileType): Promise<ExtractedFileContent> {
  if (fileType === "epub") return extractEpub(buffer);
  if (fileType === "docx") return extractDocx(buffer);

  const decoded = decodeTextBuffer(buffer);
  if (isHtmlFileType(fileType)) {
    const extracted = extractHtmlWithStructure(decoded.text, "html_heading");
    return {
      ...decoded,
      plainText: extracted.text,
      structureSource: decoded.text,
      structuredHints: extracted.hints,
    };
  }
  return {
    ...decoded,
    plainText: decoded.text,
    structureSource: decoded.text,
  };
}

function isHtmlFileType(fileType: NovelFileType): boolean {
  return fileType === "html" || fileType === "htm" || fileType === "xhtml";
}

function decodeTextBuffer(buffer: ArrayBuffer): DecodedText {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder("utf-8").decode(bytes.slice(3)),
      encoding: "UTF-8 with BOM",
      confidence: 1,
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder("utf-16le").decode(bytes.slice(2)),
      encoding: "UTF-16LE",
      confidence: 1,
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder("utf-16be").decode(bytes.slice(2)),
      encoding: "UTF-16BE",
      confidence: 1,
    };
  }

  if (looksLikeUtf16(bytes, "le")) {
    return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "UTF-16LE", confidence: 0.86 };
  }
  if (looksLikeUtf16(bytes, "be")) {
    return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "UTF-16BE", confidence: 0.86 };
  }

  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8", confidence: 0.94 };
  } catch {
    // error-log-ignore: UTF-8 严格解码失败会按设计继续尝试中文编码并向作者显示编码提示。
    const gb18030 = tryDecode(bytes, "gb18030") ?? tryDecode(bytes, "gbk");
    if (gb18030) {
      return {
        text: gb18030,
        encoding: "GB18030/GBK",
        confidence: 0.74,
        warning: "文本不是有效 UTF-8，已按 GB18030/GBK 尝试读取；如出现乱码，请另存为 UTF-8 后再导入。",
      };
    }
    return {
      text: new TextDecoder("utf-8").decode(bytes),
      encoding: "可能是 UTF-8",
      confidence: 0.35,
      warning: "未能可靠识别编码，已使用 UTF-8 宽松读取；请检查预览文本是否乱码。",
    };
  }
}

function tryDecode(bytes: Uint8Array, encoding: string): string | undefined {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    // error-log-ignore: 编码探测失败只是候选不匹配，调用方会继续尝试其他编码。
    return undefined;
  }
}

function looksLikeUtf16(bytes: Uint8Array, endian: "le" | "be"): boolean {
  const sampleLength = Math.min(bytes.length - 1, 4000);
  if (sampleLength < 20) return false;
  let zeros = 0;
  let pairs = 0;
  for (let index = 0; index < sampleLength; index += 2) {
    pairs += 1;
    const zeroIndex = endian === "le" ? index + 1 : index;
    if (bytes[zeroIndex] === 0) zeros += 1;
  }
  return pairs > 0 && zeros / pairs > 0.55;
}

interface HtmlStructureExtraction {
  text: string;
  hints: ChapterStructureHint[];
  anchors: Record<string, number>;
}

interface EpubManifestItem {
  id: string;
  href: string;
  fullPath: string;
  mediaType: string;
  properties: string;
}

interface EpubSectionText {
  href: string;
  fullPath: string;
  startOffset: number;
  text: string;
  hints: ChapterStructureHint[];
  anchors: Record<string, number>;
}

function parseXml(source: string): Document {
  return new DOMParser().parseFromString(source, "application/xml");
}

function extractHtmlWithStructure(html: string, sourceType: ChapterStructureHint["source_type"], href?: string): HtmlStructureExtraction {
  if (typeof DOMParser === "undefined") {
    const text = extractTextFromHtml(html);
    return { text, hints: [], anchors: {} };
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript").forEach((node) => node.remove());
  const body = doc.body ?? doc.documentElement;
  const elements = [...body.querySelectorAll("h1,h2,h3,p,li,blockquote,pre,section,article")]
    .filter((element) => {
      const tag = element.tagName.toLowerCase();
      return tag !== "section" && tag !== "article" || !element.querySelector("h1,h2,h3,p,li,blockquote,pre");
    });
  const buffer: string[] = [];
  const hints: ChapterStructureHint[] = [];
  const anchors: Record<string, number> = {};

  for (const element of elements) {
    const value = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    const start = buffer.join("").length;
    buffer.push(value, "\n\n");
    const id = element.getAttribute("id") || element.getAttribute("name");
    if (id) anchors[id] = start;
    const tag = element.tagName.toLowerCase();
    if (/^h[1-3]$/.test(tag)) {
      hints.push({
        title: value,
        start_offset: start,
        source_type: sourceType,
        level: Number(tag.slice(1)),
        confidence: tag === "h1" ? 0.92 : tag === "h2" ? 0.86 : 0.78,
        metadata: { href, tag },
      });
    }
  }

  const text = buffer.join("").trim();
  return { text: text || extractTextFromHtml(html), hints, anchors };
}

function readEpubManifest(opf: Document, opfBase: string): Map<string, EpubManifestItem> {
  const manifest = new Map<string, EpubManifestItem>();
  for (const item of [...opf.querySelectorAll("manifest > item")]) {
    const id = item.getAttribute("id") ?? "";
    const href = item.getAttribute("href") ?? "";
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      fullPath: resolveZipPath(opfBase, href),
      mediaType: item.getAttribute("media-type") ?? "",
      properties: item.getAttribute("properties") ?? "",
    });
  }
  return manifest;
}

async function readEpubNavToc(zip: JSZip, item: EpubManifestItem): Promise<Array<{ title: string; href: string; level: number }>> {
  const source = await zip.file(item.fullPath)?.async("text");
  if (!source) return [];
  const doc = new DOMParser().parseFromString(source, "text/html");
  const navs = [...doc.querySelectorAll("nav")];
  const tocNav = navs.find((nav) => {
    const marker = `${nav.getAttribute("epub:type") ?? ""} ${nav.getAttribute("type") ?? ""} ${nav.getAttribute("role") ?? ""}`;
    return /toc|doc-toc/i.test(marker);
  }) ?? navs[0];
  if (!tocNav) return [];
  const result: Array<{ title: string; href: string; level: number }> = [];
  const walk = (list: Element, level: number) => {
    for (const child of [...list.children]) {
      const link = child.matches("a[href]") ? child as HTMLAnchorElement : child.querySelector("a[href]") as HTMLAnchorElement | null;
      if (link) {
        const title = (link.textContent ?? "").replace(/\s+/g, " ").trim();
        const href = link.getAttribute("href") ?? "";
        if (title && href) result.push({ title, href, level });
      }
      const nested = child.querySelector(":scope > ol, :scope > ul");
      if (nested) walk(nested, level + 1);
    }
  };
  const list = tocNav.querySelector("ol,ul");
  if (list) walk(list, 1);
  return result;
}

async function readEpubNcxToc(zip: JSZip, item: EpubManifestItem): Promise<Array<{ title: string; href: string; level: number }>> {
  const source = await zip.file(item.fullPath)?.async("text");
  if (!source) return [];
  const doc = parseXml(source);
  const result: Array<{ title: string; href: string; level: number }> = [];
  const visit = (point: Element, level: number) => {
    const label = (point.querySelector("navLabel")?.textContent ?? "").replace(/\s+/g, " ").trim();
    const href = point.querySelector("content")?.getAttribute("src") ?? "";
    if (label && href) result.push({ title: label, href, level });
    for (const child of [...point.children].filter((node) => node.tagName.split(":").pop() === "navPoint")) visit(child, level + 1);
  };
  for (const point of [...doc.querySelectorAll("navMap > navPoint")]) visit(point, 1);
  return result;
}

function resolveZipPath(base: string, href: string): string {
  const stack = base.split("/").filter(Boolean);
  for (const part of href.split("#")[0].split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function resolveTocTarget(href: string, tocPath: string, sections: EpubSectionText[]): { offset: number; path: string } | undefined {
  const tocBase = tocPath.includes("/") ? tocPath.slice(0, tocPath.lastIndexOf("/") + 1) : "";
  const [pathPart, fragment] = href.split("#");
  const fullPath = resolveZipPath(tocBase, pathPart || "");
  const section = sections.find((item) => item.fullPath === fullPath || item.href === pathPart || item.fullPath.endsWith(`/${pathPart}`));
  if (!section) return undefined;
  const anchor = fragment ? section.anchors[decodeURIComponent(fragment)] : undefined;
  return { offset: section.startOffset + (anchor ?? 0), path: section.fullPath };
}

function remapStructuredHints(hints: ChapterStructureHint[], normalized: string): ChapterStructureHint[] {
  let cursor = 0;
  return hints.flatMap((hint): ChapterStructureHint[] => {
    const title = hint.title.trim();
    if (!title) return [];
    let start = normalized.indexOf(title, cursor);
    if (start < 0) start = normalized.indexOf(title);
    if (start < 0) start = hint.start_offset;
    cursor = Math.max(cursor, start + title.length);
    return [{ ...hint, start_offset: Math.max(0, start), end_offset: undefined }];
  });
}

async function extractEpub(buffer: ArrayBuffer): Promise<ExtractedFileContent> {
  const zip = await JSZip.loadAsync(buffer);
  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  const rootfile = containerXml ? parseXml(containerXml).querySelector("rootfile")?.getAttribute("full-path") ?? "" : "";
  const fallbackOpf = Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".opf"))?.name ?? "";
  const opfPath = rootfile || fallbackOpf;
  const opfText = opfPath ? await zip.file(opfPath)?.async("text") ?? "" : "";
  const opf = opfText ? parseXml(opfText) : undefined;
  const opfBase = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const manifest = opf ? readEpubManifest(opf, opfBase) : new Map<string, EpubManifestItem>();
  const spineRefs = opf
    ? [...opf.querySelectorAll("spine > itemref")]
      .filter((item) => item.getAttribute("linear") !== "no")
      .map((item) => item.getAttribute("idref") ?? "")
      .filter(Boolean)
    : [];
  const htmlItems = spineRefs.length
    ? spineRefs.map((idref) => manifest.get(idref)).filter((item): item is EpubManifestItem => Boolean(item))
    : Object.values(zip.files)
      .filter((entry) => !entry.dir && /\.(xhtml|html|htm)$/i.test(entry.name))
      .map((entry) => ({ id: entry.name, href: entry.name, fullPath: entry.name, mediaType: "application/xhtml+xml", properties: "" }));

  const sections: EpubSectionText[] = [];
  const textParts: string[] = [];
  for (const item of htmlItems) {
    if (!/html|xhtml|xml/i.test(item.mediaType || item.href)) continue;
    const source = await zip.file(item.fullPath)?.async("text");
    if (!source) continue;
    const startOffset = textParts.join("").length;
    const extracted = extractHtmlWithStructure(source, "html_heading", item.href);
    if (!extracted.text) continue;
    sections.push({
      href: item.href,
      fullPath: item.fullPath,
      startOffset,
      text: extracted.text,
      anchors: extracted.anchors,
      hints: extracted.hints.map((hint) => ({
        ...hint,
        start_offset: startOffset + hint.start_offset,
        metadata: { ...hint.metadata, href: item.href, path: item.fullPath },
      })),
    });
    textParts.push(extracted.text, "\n\n");
  }

  const navItem = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  const ncxId = opf?.querySelector("spine")?.getAttribute("toc") ?? "";
  const ncxItem = manifest.get(ncxId) ?? [...manifest.values()].find((item) => /ncx/i.test(item.mediaType) || /\.ncx$/i.test(item.href));
  const tocItems = navItem ? await readEpubNavToc(zip, navItem) : ncxItem ? await readEpubNcxToc(zip, ncxItem) : [];
  const tocHints = tocItems.flatMap((item, index): ChapterStructureHint[] => {
    const target = resolveTocTarget(item.href, navItem?.fullPath ?? ncxItem?.fullPath ?? "", sections);
    if (!target) return [];
    return [{
      title: item.title,
      start_offset: target.offset,
      source_type: "epub_toc",
      level: item.level,
      confidence: 0.94,
      metadata: { href: item.href, path: target.path, tocIndex: index },
    }];
  });

  const plainText = textParts.join("").trim();
  const structuredHints = tocHints.length ? tocHints : sections.flatMap((section) => section.hints);
  if (!plainText) return extractEpubLegacy(buffer);
  const structure: NovelChapterStructureDetection = {
    detected: structuredHints.length > 0 || spineRefs.length > 0,
    method: tocHints.length > 0 ? "epub_toc" : spineRefs.length > 0 ? "epub_spine" : "none",
    confidence: tocHints.length > 0 ? 0.92 : spineRefs.length > 0 ? 0.72 : 0,
    heading_count: structuredHints.length,
    sample_headings: structuredHints.map((hint) => hint.title).slice(0, 8),
    notes: [
      tocHints.length > 0 ? `Detected ${tocHints.length} EPUB TOC entries` : "",
      spineRefs.length > 0 ? `Detected ${spineRefs.length} OPF spine items` : "",
    ].filter(Boolean),
  };
  return {
    text: plainText,
    plainText,
    structureSource: plainText,
    structure,
    structuredHints,
    encoding: "EPUB container / UTF-8 HTML",
    confidence: 0.9,
  };
}

async function extractEpubLegacy(buffer: ArrayBuffer): Promise<ExtractedFileContent> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const names = entries.map((entry) => entry.name);
  const lowerNames = names.map((name) => name.toLowerCase());
  const ncxCount = lowerNames.filter((name) => name.endsWith(".ncx")).length;
  const opfEntry = entries.find((entry) => entry.name.toLowerCase().endsWith(".opf"));
  const opfText = opfEntry ? await opfEntry.async("text") : "";
  const hasSpine = /<spine\b/i.test(opfText);
  const manifestNav = /properties\s*=\s*["'][^"']*\bnav\b/i.test(opfText);
  const htmlEntries = entries.filter((entry) => /\.(xhtml|html|htm)$/i.test(entry.name));
  const navEntries = htmlEntries.filter((entry) => /(?:^|\/)nav\.(?:xhtml|html|htm)$/i.test(entry.name));
  const htmlTexts = await Promise.all(htmlEntries.map((entry) => entry.async("text")));
  const plainText = htmlTexts.map(extractTextFromHtml).filter(Boolean).join("\n\n");
  const structure: NovelChapterStructureDetection = {
    detected: ncxCount > 0 || navEntries.length > 0 || manifestNav || hasSpine,
    method: ncxCount > 0 || navEntries.length > 0 || manifestNav ? "epub_toc" : hasSpine ? "epub_spine" : "none",
    confidence: ncxCount > 0 || navEntries.length > 0 || manifestNav ? 0.92 : hasSpine ? 0.72 : 0,
    heading_count: ncxCount + navEntries.length + (hasSpine ? 1 : 0),
    sample_headings: collectHtmlHeadings(htmlTexts.join("\n")).slice(0, 8),
    notes: [
      ncxCount > 0 ? `检测到 ${ncxCount} 个 NCX 目录文件` : "",
      navEntries.length > 0 || manifestNav ? "检测到 EPUB nav 目录入口" : "",
      hasSpine ? "检测到 OPF spine 阅读顺序" : "",
    ].filter(Boolean),
  };
  return {
    text: plainText,
    plainText,
    structureSource: htmlTexts.join("\n"),
    structure,
    encoding: "EPUB container / UTF-8 HTML",
    confidence: 0.9,
  };
}

async function extractDocx(buffer: ArrayBuffer): Promise<ExtractedFileContent> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) throw new EmptyDocumentError("DOCX does not contain word/document.xml.");
  const parsed = extractDocxParagraphs(documentXml);
  const text = parsed.text;
  const headingCount = parsed.hints.length;
  const structure: NovelChapterStructureDetection = {
    detected: headingCount > 0,
    method: headingCount > 0 ? "docx_heading" : "none",
    confidence: headingCount > 0 ? 0.72 : 0,
    heading_count: headingCount,
    sample_headings: [],
    notes: headingCount > 0 ? [`检测到 ${headingCount} 个 DOCX 标题样式`] : [],
  };
  return {
    text,
    plainText: text,
    structureSource: text,
    structure,
    structuredHints: parsed.hints,
    encoding: "DOCX package / UTF-8 XML",
    confidence: 0.88,
  };
}

function extractDocxParagraphs(documentXml: string): { text: string; hints: ChapterStructureHint[] } {
  const paragraphs = [...documentXml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)];
  const parts: string[] = [];
  const hints: ChapterStructureHint[] = [];
  for (const match of paragraphs) {
    const xml = match[0];
    const style = xml.match(/<w:pStyle[^>]+w:val="([^"]+)"/i)?.[1] ?? "";
    const text = decodeXmlEntities(
      [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((item) => item[1] ?? "")
        .join("")
    ).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const start = parts.join("").length;
    parts.push(text, "\n\n");
    const heading = style.match(/^Heading([1-3])$/i) ?? style.match(/^标题\s*([1-3])$/);
    if (heading) {
      hints.push({
        title: text,
        start_offset: start,
        source_type: "docx_heading",
        level: Number(heading[1]),
        confidence: 0.82,
        metadata: { style },
      });
    }
  }
  return { text: parts.join("").trim(), hints };
}

function buildPreflight(input: {
  file: File;
  fileType: NovelFileType;
  decoded: DecodedText;
  normalized: string;
  structure: NovelChapterStructureDetection;
  fileHash?: string;
}): NovelImportPreflight {
  const estimatedWords = estimateWords(input.normalized);
  const estimatedTokens = estimateTextTokens(input.normalized);
  const recommendation = recommendAction(input.normalized.length, estimatedWords);
  return {
    file_name: input.file.name,
    file_size_bytes: input.file.size,
    file_type: input.fileType,
    mime_type: input.file.type || undefined,
    encoding: input.decoded.encoding,
    encoding_confidence: input.decoded.confidence,
    encoding_warning: input.decoded.warning,
    total_chars: input.normalized.length,
    estimated_words: estimatedWords,
    estimated_tokens: estimatedTokens,
    has_chapter_structure: input.structure.detected,
    chapter_structure: input.structure,
    is_large_text: input.normalized.length >= novelPreflightThresholds.large_text_chars || estimatedWords >= novelPreflightThresholds.large_text_words,
    exceeds_direct_process_limit: input.normalized.length >= novelPreflightThresholds.max_direct_process_chars,
    recommended_action: recommendation.action,
    recommendation_label: recommendation.label,
    processing_tier: recommendation.tier,
    time_hint: recommendation.timeHint,
    direct_process_risks: directProcessRisks,
    thresholds: novelPreflightThresholds,
    file_hash_sha256: input.fileHash,
    analyzed_at: new Date().toISOString(),
  };
}

function recommendAction(chars: number, words: number): { action: NovelRecommendedAction; tier: NovelProcessingTier; label: string; timeHint: string } {
  if (chars >= novelPreflightThresholds.max_direct_process_chars) {
    return {
      action: "split_required",
      tier: "oversized",
      label: "必须章节拆分",
      timeHint: "当前文件超过直接处理上限，需要先进入章节拆分预览。",
    };
  }
  if (chars >= novelPreflightThresholds.large_text_chars || words >= novelPreflightThresholds.large_text_words) {
    return {
      action: "split_recommended",
      tier: "large",
      label: "强烈建议章节拆分",
      timeHint: "全文解析会进入多批次处理，直接处理更慢且更容易中断。",
    };
  }
  if (chars >= novelPreflightThresholds.small_text_chars || words >= novelPreflightThresholds.small_text_words) {
    return {
      action: "split_recommended",
      tier: "medium",
      label: "建议章节拆分",
      timeHint: "可以直接处理，但章节拆分通常更稳定，也更便于复核。",
    };
  }
  return {
    action: "direct",
    tier: "small",
    label: "可直接处理",
    timeHint: "文本规模较小，可以沿用当前直接 AI 解析流程。",
  };
}

function detectChapterStructure(fileType: NovelFileType, source: string, plainText: string): NovelChapterStructureDetection {
  if (isHtmlFileType(fileType)) return detectHtmlStructure(source);
  if (fileType === "md") return detectMarkdownStructure(source);
  if (fileType === "txt" || fileType === "json" || fileType === "docx") return detectTxtStructure(plainText);
  return { detected: false, method: "none", confidence: 0, heading_count: 0, sample_headings: [], notes: [] };
}

function detectHtmlStructure(html: string): NovelChapterStructureDetection {
  const headings = collectHtmlHeadings(html);
  const structuralTags = (html.match(/<(?:section|article)\b/gi) ?? []).length;
  const count = headings.length + structuralTags;
  return {
    detected: count > 0,
    method: count > 0 ? "html_heading" : "none",
    confidence: headings.length > 0 ? 0.78 : structuralTags > 0 ? 0.56 : 0,
    heading_count: count,
    sample_headings: headings.slice(0, 8),
    notes: structuralTags > 0 ? [`检测到 ${structuralTags} 个 section/article 结构标签`] : [],
  };
}

function detectMarkdownStructure(markdown: string): NovelChapterStructureDetection {
  const headings = [...markdown.matchAll(/^\s{0,3}#{1,2}\s+(.+)$/gm)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  return {
    detected: headings.length > 0,
    method: headings.length > 0 ? "markdown_heading" : "none",
    confidence: headings.length > 0 ? 0.82 : 0,
    heading_count: headings.length,
    sample_headings: headings.slice(0, 8),
    notes: [],
  };
}

function detectTxtStructure(text: string): NovelChapterStructureDetection {
  const lines = text.split(/\n/).slice(0, 1800).map((line) => line.trim()).filter(Boolean);
  const headings = lines.filter((line) => isLikelyTxtChapterHeading(line)).slice(0, 12);
  return {
    detected: headings.length >= 2,
    method: headings.length >= 2 ? "txt_pattern" : "none",
    confidence: headings.length >= 6 ? 0.82 : headings.length >= 2 ? 0.62 : 0,
    heading_count: headings.length,
    sample_headings: headings.slice(0, 8),
    notes: headings.length > 0 ? ["基于前 1800 个非空行的章节标题采样"] : [],
  };
}

function isLikelyTxtChapterHeading(line: string): boolean {
  if (line.length > 80) return false;
  const cnNumber = "0-9零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟";
  const patterns = [
    new RegExp(`^(?:正文\\s*)?第\\s*[${cnNumber}]+\\s*[章节回卷部集](?:\\s|$|[:：.．、-]).*$`, "i"),
    new RegExp(`^(?:卷|部)\\s*[${cnNumber}]+(?:\\s|$|[:：.．、-]).*$`, "i"),
    /^(?:序章|楔子|引子|番外|终章|尾声)(?:\s|$|[:：.．、-]).*$/i,
    /^(?:chapter\s+(?:\d+|[ivxlcdm]+)|part\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)|book\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+))(?:\s|$|[:：.．、-]).*$/i,
  ];
  return patterns.some((pattern) => pattern.test(line));
}

function collectHtmlHeadings(html: string): string[] {
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return [...doc.querySelectorAll("h1,h2,h3")]
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean);
    } catch {
      // error-log-ignore: DOM 解析不可用时会使用等价的正则兼容解析。
      // Fall through to regex fallback.
    }
  }
  return [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => stripTags(match[1] ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractTextFromHtml(html: string): string {
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("script,style,noscript").forEach((node) => node.remove());
      return doc.body?.textContent ?? doc.documentElement.textContent ?? "";
    } catch {
      // error-log-ignore: DOM 解析不可用时会使用等价的纯文本兼容解析。
      // Fall through to regex fallback.
    }
  }
  return decodeXmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|h[1-6]|li)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function stripTags(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, " "));
}

function decodeXmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#x")) {
      const codePoint = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (body.startsWith("#")) {
      const codePoint = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

function estimateWords(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinWords = text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) ?? [];
  return cjk + latinWords.length;
}

async function hashArrayBuffer(buffer: ArrayBuffer): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  try {
    const digest = await crypto.subtle.digest("SHA-256", buffer.slice(0));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    // error-log-ignore: 浏览器不支持摘要算法时只缺少去重指纹，不影响小说正文导入。
    return undefined;
  }
}
