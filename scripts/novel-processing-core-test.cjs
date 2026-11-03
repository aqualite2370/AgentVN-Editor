const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");
const ts = require("../editor/node_modules/typescript");

const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => {
  const sourceText = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};
const sourcePath = path.join(root, "editor", "src", "novel-import", "novelProcessing.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

const testModule = new Module(sourcePath, module);
testModule.filename = sourcePath;
testModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
testModule._compile(compiled, sourcePath);

const {
  appendWithoutDuplicateOverlap,
  createAgentTasksForJob,
  createChunksForSelectedChapters,
  createEmptyNovelProcessingState,
  createNovelProcessJob,
  initializeChunkDispatch,
  markAgentTaskFailedInState,
  mergeNovelProcessResults,
  retryFailedAgentTasksInState,
  sanitizeNovelProcessingConfig,
  setChunkResultInState,
} = testModule.exports;

function makeParagraph(seed, repeat) {
  return Array.from({ length: repeat }, (_, index) => `${seed} sentence ${index}.`).join(" ");
}

const chapterOne = "Chapter 1\nA short opening.\n\n";
const chapterTwo = `Chapter 2\n${Array.from({ length: 34 }, (_, index) => makeParagraph(`Long paragraph ${index}`, 36)).join("\n\n")}\n\n`;
const chapterThree = "Chapter 3\nA small closing chapter.\n";
const documentText = `${chapterOne}${chapterTwo}${chapterThree}`;

const chapters = [
  {
    chapter_id: "chapter_1",
    title: "Chapter 1",
    index: 0,
    start_offset: 0,
    end_offset: chapterOne.length,
    summary: "short",
    confidence: 0.91,
  },
  {
    chapter_id: "chapter_2",
    title: "Chapter 2",
    index: 1,
    start_offset: chapterOne.length,
    end_offset: chapterOne.length + chapterTwo.length,
    summary: "long",
    confidence: 0.88,
  },
  {
    chapter_id: "chapter_3",
    title: "Chapter 3",
    index: 2,
    start_offset: chapterOne.length + chapterTwo.length,
    end_offset: documentText.length,
    summary: "closing",
    confidence: 0.77,
  },
];

const config = {
  chunkThresholdChars: 12000,
  chunkTargetChars: 8000,
  chunkMaxChars: 12000,
  chunkOverlapChars: 500,
  chunkMinChars: 2000,
  maxConcurrency: 2,
  maxRetryCount: 2,
};

const selectedChapterIds = ["chapter_2", "chapter_3"];
const edgeConfig = sanitizeNovelProcessingConfig({
  chunkMaxChars: 3000,
  chunkMinChars: 2900,
  chunkTargetChars: 100,
  chunkOverlapChars: 9999,
  maxConcurrency: 99,
  maxRetryCount: -1,
});

assert.equal(edgeConfig.chunkMaxChars, 4000, "chunkMaxChars should respect the supported lower bound");
assert.equal(edgeConfig.chunkTargetChars, edgeConfig.chunkMinChars, "chunkTargetChars should not fall below chunkMinChars");
assert.equal(edgeConfig.chunkOverlapChars, Math.floor(edgeConfig.chunkTargetChars / 2), "chunk overlap should be capped to half the target size");
assert.equal(edgeConfig.maxConcurrency, 10, "maxConcurrency should be capped at the backend-compatible limit");
assert.equal(edgeConfig.maxRetryCount, 0, "maxRetryCount should not go below zero");

const chunks = createChunksForSelectedChapters({
  bookId: "book_test",
  documentText,
  chapters,
  selectedChapterIds,
  config,
});

assert(chunks.length >= 3, "large chapter should split into multiple chunks");
assert(chunks.every((chunk) => selectedChapterIds.includes(chunk.chapterId)), "only selected chapters should create chunks");
assert.equal(chunks.some((chunk) => chunk.chapterId === "chapter_1"), false, "unselected chapters should not be queued");

const chunksByChapter = new Map();
for (const chunk of chunks) {
  const chapter = chapters.find((item) => item.chapter_id === chunk.chapterId);
  assert(chapter, "chunk should point at an existing chapter");
  assert(chunk.startOffset >= chapter.start_offset, "chunk start should stay inside chapter bounds");
  assert(chunk.endOffset <= chapter.end_offset, "chunk end should stay inside chapter bounds");
  assert(chunk.startOffset < chunk.endOffset, "chunk should have a non-empty primary range");
  assert.equal(chunk.charCount, chunk.endOffset - chunk.startOffset, "chunk charCount should describe only the primary source range");
  assert.equal(
    chunk.overlapBefore,
    documentText.slice(Math.max(chapter.start_offset, chunk.startOffset - config.chunkOverlapChars), chunk.startOffset),
    "previous context should be stored separately from the primary source range",
  );
  assert.equal(
    chunk.overlapAfter,
    documentText.slice(chunk.endOffset, Math.min(chapter.end_offset, chunk.endOffset + config.chunkOverlapChars)),
    "next context should be stored separately from the primary source range",
  );
  const apiChunkPayload = {
    chunkText: documentText.slice(chunk.startOffset, chunk.endOffset),
    previousContextSummary: chunk.overlapBefore.slice(-800),
    nextContextHint: chunk.overlapAfter.slice(0, 800),
  };
  assert.equal(apiChunkPayload.chunkText.length, chunk.charCount, "API chunkText should contain only the primary source text");
  assert.equal(apiChunkPayload.previousContextSummary.length, Math.min(800, chunk.overlapBefore.length), "previous context should stay in the context field");
  assert.equal(apiChunkPayload.nextContextHint.length, Math.min(800, chunk.overlapAfter.length), "next context should stay in the context field");
  if (!chunksByChapter.has(chunk.chapterId)) chunksByChapter.set(chunk.chapterId, []);
  chunksByChapter.get(chunk.chapterId).push(chunk);
}

for (const chapterChunks of chunksByChapter.values()) {
  chapterChunks.sort((a, b) => a.indexInChapter - b.indexInChapter);
  chapterChunks.forEach((chunk, index) => {
    assert.equal(chunk.indexInChapter, index, "chunk indexInChapter should be contiguous");
    if (index > 0) {
      assert(chapterChunks[index - 1].endOffset <= chunk.startOffset, "primary chunk offsets should not overlap");
    }
  });
}

const job = createNovelProcessJob({
  bookId: "book_test",
  selectedChapterIds,
  chunks,
  config,
  userInstruction: "rewrite politely",
  outputFormat: "markdown",
  promptVersion: "test-v1",
  now: "2026-06-05T00:00:00.000Z",
});
const dispatchedChunks = initializeChunkDispatch(chunks, job);
const tasks = createAgentTasksForJob({ job, chunks: dispatchedChunks, now: "2026-06-05T00:00:00.000Z" });

assert.equal(job.maxConcurrency, 2, "job should persist configured max concurrency");
assert.equal(tasks.filter((task) => task.status === "processing").length, 2, "only maxConcurrency tasks should start");
assert.equal(tasks.filter((task) => task.status === "waiting").length, Math.max(0, tasks.length - 2), "remaining tasks should wait");

let processing = createEmptyNovelProcessingState({
  selectedChapterIds,
  chapterSnapshots: chapters,
  chunks: dispatchedChunks,
  jobs: [job],
  tasks,
  activeJobId: job.jobId,
  config,
});

processing = markAgentTaskFailedInState(processing, tasks[0].agentTaskId, "synthetic failure");
processing = setChunkResultInState(processing, tasks[1].chunkId, "completed chunk result", { inputTokens: 10, outputTokens: 5 });
assert.equal(processing.tasks.find((task) => task.agentTaskId === tasks[0].agentTaskId).status, "failed", "failed task should keep failed status");
assert.equal(processing.tasks.find((task) => task.agentTaskId === tasks[1].agentTaskId).status, "completed", "completed task should stay completed");

const restored = JSON.parse(JSON.stringify(processing));
assert.equal(restored.activeJobId, job.jobId, "serialized processing state should preserve active job");
assert.equal(restored.tasks.find((task) => task.agentTaskId === tasks[0].agentTaskId).errorMessage, "synthetic failure", "serialized tasks should preserve errors");

processing = retryFailedAgentTasksInState(processing);
assert.equal(processing.tasks.find((task) => task.agentTaskId === tasks[0].agentTaskId).status, "waiting", "retry should move failed task back to waiting");
assert.equal(processing.tasks.find((task) => task.agentTaskId === tasks[0].agentTaskId).retryCount, 1, "retry should increment retry count");
assert.equal(processing.tasks.find((task) => task.agentTaskId === tasks[1].agentTaskId).status, "completed", "retry should not rerun completed task");

const duplicateBlock = "DUPLICATE_CONTEXT_BLOCK_12345";
assert.equal(
  appendWithoutDuplicateOverlap(`first ${duplicateBlock}`, `${duplicateBlock} second`),
  `first ${duplicateBlock} second`,
  "merge helper should remove repeated overlap text",
);

const chapterTwoChunks = processing.chunks.filter((chunk) => chunk.chapterId === "chapter_2").sort((a, b) => a.indexInChapter - b.indexInChapter);
processing = setChunkResultInState(processing, chapterTwoChunks[0].chunkId, `chapter two part one ${duplicateBlock}`);
processing = setChunkResultInState(processing, chapterTwoChunks[1].chunkId, `${duplicateBlock} chapter two part two`);
processing = markAgentTaskFailedInState(processing, processing.tasks.find((task) => task.chunkId === chapterTwoChunks[chapterTwoChunks.length - 1].chunkId).agentTaskId, "tail failed");

const merged = mergeNovelProcessResults({
  chapters,
  chunks: processing.chunks,
  chunkResults: processing.chunkResults,
  tasks: processing.tasks,
});
assert(merged.fullText.indexOf("# Chapter 1") < merged.fullText.indexOf("# Chapter 2"), "chapters should merge in original chapter order");
assert(merged.fullText.includes("chapter two part one"), "completed chunk output should remain visible");
assert(merged.chapterTexts.find((chapter) => chapter.chapterId === "chapter_2").failedChunkIds.length >= 1, "failed chunks should be reported without blocking merge");
assert.equal((merged.fullText.match(new RegExp(duplicateBlock, "g")) ?? []).length, 1, "overlap block should not be duplicated in merged output");

console.log("novel-processing-core-test: ok");
