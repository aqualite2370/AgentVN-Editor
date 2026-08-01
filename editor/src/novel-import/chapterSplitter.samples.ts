import { splitChapterRecordsAsync } from "./chapterSplitter";

interface FixtureResult {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runChapterSplitterFixtureSuite(): Promise<string[]> {
  const results: FixtureResult[] = [];

  results.push(await fixture("普通中文网文", async () => {
    const text = [
      "第1章 初遇",
      "",
      "夜雨落在青石街上，阿宁第一次见到那盏灯。",
      "",
      "第2章 风起",
      "",
      "第二天，城门外的风把旧告示吹得猎猎作响。",
    ].join("\n");
    const { records, report } = await splitChapterRecordsAsync(text, { fileType: "txt" });
    assert(records.length === 2, `expected 2 chapters, got ${records.length}`);
    assert(records[0].startOffset === 0, "first chapter must start at offset 0");
    assert(records[1].startOffset > records[0].startOffset, "chapter order must be ascending");
    assert(!report.usedFallback, "ordinary numbered chapters should not fallback");
    return `${records.length}:${records.map((item) => item.title).join("/")}`;
  }));

  results.push(await fixture("目录页重复标题", async () => {
    const text = [
      "目录",
      "第1章 初遇",
      "第2章 风起",
      "",
      "作品简介",
      "这是一段简介。",
      "",
      "第1章 初遇",
      "",
      "正文第一章内容，人物登场。",
      "",
      "第2章 风起",
      "",
      "正文第二章内容，冲突出现。",
    ].join("\n");
    const { records, report } = await splitChapterRecordsAsync(text, { fileType: "txt" });
    assert(records.length === 2, `expected body chapters only, got ${records.length}`);
    assert((report.tocRange?.candidateCount ?? 0) >= 2, "TOC region should be detected");
    assert(records[0].startOffset > (report.tocRange?.endOffset ?? 0), "first body chapter must be after TOC");
    return `${records.length}:toc=${report.tocRange?.candidateCount ?? 0}`;
  }));

  results.push(await fixture("特殊章节词", async () => {
    const text = [
      "序章",
      "旧梦从这里开始。",
      "",
      "番外 风雪夜",
      "另一个角落里的故事。",
      "",
      "终章",
      "所有线索合拢。",
      "",
      "尾声",
      "灯火重新亮起。",
    ].join("\n");
    const { records } = await splitChapterRecordsAsync(text, { fileType: "txt" });
    assert(records.length === 4, `expected 4 special chapters, got ${records.length}`);
    assert(records.some((item) => item.title.includes("尾声")), "tail chapter should be detected");
    return records.map((item) => item.title).join("/");
  }));

  results.push(await fixture("正文误命中", async () => {
    const text = [
      "第1章 开端",
      "",
      "他说第2章这个词只是书名的一部分，并不是新的标题。",
      "这句话仍然属于第一章。",
      "",
      "第2章 真正的标题",
      "",
      "新的章节从这里开始。",
    ].join("\n");
    const { records } = await splitChapterRecordsAsync(text, { fileType: "txt" });
    assert(records.length === 2, `expected 2 real chapters, got ${records.length}`);
    assert(records[1].title.includes("真正的标题"), "paragraph mention must not become a chapter");
    return records.map((item) => item.title).join("/");
  }));

  results.push(await fixture("无章节 fallback", async () => {
    const paragraph = "没有章节标题的长段落，只有持续推进的叙述。";
    const text = Array.from({ length: 900 }, () => paragraph).join("\n\n");
    const { records, report } = await splitChapterRecordsAsync(text, { fileType: "txt", fallbackTargetChars: 7000 });
    assert(records.length > 1, "long unstructured text should be sliced");
    assert(report.usedFallback, "fallback report flag should be true");
    assert(records.every((item) => item.sourceType === "fallback_auto"), "fallback records should use fallback_auto");
    return `${records.length}:fallback`;
  }));

  results.push(await fixture("400万字模拟性能", async () => {
    const body = "风从旷野吹来，人物在路上交换线索，场景继续推进。";
    const chapters = Array.from({ length: 400 }, (_, index) => [
      `第${index + 1}章 模拟章节${index + 1}`,
      "",
      Array.from({ length: 170 }, () => body).join(""),
    ].join("\n")).join("\n\n");
    const padded = chapters.padEnd(4_000_000, body);
    const started = Date.now();
    const { records, report } = await splitChapterRecordsAsync(padded, { fileType: "txt" });
    const elapsed = Date.now() - started;
    assert(records.length >= 390, `expected most generated chapters, got ${records.length}`);
    assert(!report.usedFallback, "large numbered text should not fallback");
    assert(records.every((item, index) => index === 0 || item.startOffset > records[index - 1].startOffset), "offsets must be ascending");
    return `${records.length}:chars=${padded.length}:ms=${elapsed}`;
  }));

  return results.map((result) => `chapter_splitter:${result.name}:${result.ok}:${result.detail}`);
}

async function fixture(name: string, run: () => Promise<string>): Promise<FixtureResult> {
  try {
    return { name, ok: true, detail: await run() };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
