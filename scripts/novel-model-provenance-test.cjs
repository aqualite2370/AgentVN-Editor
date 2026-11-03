"use strict";
// Exercise the production persistence reducer using a real failed/recovered job,
// or a small fixture for CI. Only execution-owned metadata may name a model.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../editor/node_modules/typescript");
require.extensions[".ts"] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(
  process.env.AGENTVN_NOVEL_PROVENANCE_BASELINE && file.endsWith("novel-import\\persistence.ts")
    ? process.env.AGENTVN_NOVEL_PROVENANCE_BASELINE : file, "utf8"), {
  fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  },
}).outputText, file);
const { createEmptyNovelPersistenceState, deriveNovelPersistenceState, recoverNovelPersistenceState } =
  require("../editor/src/novel-import/persistence.ts");
const { createEmptyNovelProcessingState } = require("../editor/src/novel-import/novelProcessing.ts");
const at = "2026-10-30T00:00:00.000Z", modelA = "connection-a / model-a", modelB = "connection-b / model-b";
function fixture() {
  const document = { document_id: "book", title: "雨后", file_name: "雨后.txt", file_type: "txt",
    raw_text: "雨停了。", normalized_text: "雨停了。", total_chars: 4, imported_at: at,
    file_hash: "fixture", metadata: {}, language: "zh-CN" };
  const chapter = { chapter_id: "chapter", title: "雨后", index: 0, start_offset: 0, end_offset: 4, summary: "", confidence: 1 };
  const chunk = { chunk_id: "chunk", document_id: "book", index: 0, text: "雨停了。",
    start_offset: 0, end_offset: 4, estimated_tokens: 4 };
  const analysis = { chunk_id: "chunk", index: 0, summary: "雨停了。", chapter_candidates: [chapter],
    characters: [], locations: [], timeline: [], foreshadowing: [], warnings: [], confidence: 1 };
  const scene = { scene_candidate_id: "scene", chapter_id: "chapter", index: 0, title: "雨后",
    source_excerpt: "雨停了。", start_offset: 0, end_offset: 4 };
  const adapted = { adapted_scene_id: "adapted", source_scene_candidate_id: "scene",
    scene_beat: { scene_id: "scene", title: "雨后", summary: "", chapter: 0,
      commands: [{ type: "narration", text: "雨停了。" }] }, warnings: [], needs_review: false };
  const session = { session_id: "session", document, chunks: [chunk], chapters: [chapter], scenes: [scene],
    ai_chunk_analyses: [analysis], scan_partials: {}, adapted_scenes: [adapted], ai_stage: "report",
    created_at: at, updated_at: at, import_options: {} };
  return { previous: createEmptyNovelPersistenceState(), session,
    importJob: { status: "completed", total: 1, generatedCount: 1, skippedSceneIds: [], startedAt: at, completedAt: at },
    processing: createEmptyNovelProcessingState(), errors: [], warnings: [], inspectableResults: [] };
}
function sources(p) {
  return Object.fromEntries(["jobs", "tasks", "chunkResults", "chapterResults"].map(key =>
    [key, Object.fromEntries(Object.entries(p[key]).map(([id, row]) => [id, row.modelName]))]));
}
function completed() {
  const input = fixture();
  return { input, saved: JSON.parse(JSON.stringify(deriveNovelPersistenceState({ ...input, modelName: modelA }))) };
}
test("clearing provider configuration on restart preserves every historical model source", () => {
  const { input, saved } = completed();
  const restored = recoverNovelPersistenceState(JSON.parse(JSON.stringify(saved)));
  const next = deriveNovelPersistenceState({ ...input, previous: restored, modelName: "未配置文本生成模型" });
  assert.deepEqual(sources(next), sources(saved));
  assert.deepEqual(next.sessionSnapshot, saved.sessionSnapshot);
});
test("selecting another model without generation does not relabel completed results", () => {
  const { input, saved } = completed();
  const next = deriveNovelPersistenceState({ ...input, previous: saved, modelName: modelB });
  assert.deepEqual(sources(next), sources(saved));
});
test("unknown legacy source remains unknown during recovery", () => {
  const { input } = completed();
  const saved = deriveNovelPersistenceState(input);
  const next = deriveNovelPersistenceState({ ...input, previous: saved, modelName: modelB });
  assert.equal(next.chunkResults.chunk.modelName, undefined);
  assert.equal(next.tasks["novel_job_session:scene:scene"].modelName, undefined);
});
test("new scan results capture execution source without relabelling earlier chunks", () => {
  const { input, saved } = completed();
  input.session.ai_chunk_analyses[0].modelName = modelB;
  input.session.ai_chunk_analyses[0].summary = "新模型重扫。";
  const next = deriveNovelPersistenceState({ ...input, previous: saved });
  assert.equal(next.chunkResults.chunk.modelName, modelB);
  assert.equal(next.tasks["novel_job_session:chunk:chunk"].modelName, modelB);
  assert.equal(next.tasks["novel_job_session:scene:scene"].modelName, modelA);
});
test("regenerating one scene updates only that scene source", () => {
  const { input, saved } = completed();
  input.session.adapted_scenes[0].modelName = modelB;
  const next = deriveNovelPersistenceState({ ...input, previous: saved });
  assert.equal(next.tasks["novel_job_session:scene:scene"].modelName, modelB);
  assert.equal(next.chunkResults.chunk.modelName, modelA);
  assert.equal(next.chapterResults.chapter.modelName, `${modelB} + ${modelA}`,
    "A chapter with outputs from multiple models must retain both sources");
});
test("executor jobs retain their own sources independently of selected model", () => {
  const { input, saved } = completed();
  input.processing.jobs.push({ jobId: "executor", bookId: "book", selectedChapterIds: [],
    totalChunks: 0, completedChunks: 0, failedChunks: 0, skippedChunks: 0, status: "completed",
    createdAt: at, finishedAt: at, modelName: modelB });
  const next = deriveNovelPersistenceState({ ...input, previous: saved, modelName: modelA });
  assert.equal(next.jobs.executor.modelName, modelB);
  assert.equal(next.jobs.novel_job_session.modelName, modelA);
});
test("project source records are not mutated when deriving another snapshot", () => {
  const { input, saved } = completed(), before = structuredClone(saved);
  deriveNovelPersistenceState({ ...input, previous: saved, modelName: modelB });
  assert.deepEqual(saved, before);
});
test("a chapter's distinct documented historical source is not inferred again during recovery", () => {
  const { input, saved } = completed();
  saved.chapterResults.chapter.modelName = "historical-chapter-model";
  const next = deriveNovelPersistenceState({ ...input, previous: saved });
  assert.equal(next.chapterResults.chapter.modelName, "historical-chapter-model");
});
if (process.env.AGENTVN_NOVEL_PROVENANCE_REPLAY) {
  test("actual 1.9.35 failed installation recovery snapshot retains original source", () => {
    const report = JSON.parse(fs.readFileSync(process.env.AGENTVN_NOVEL_PROVENANCE_REPLAY, "utf8"));
    const saved = report.matrix.at(-1).completed.project.editor_settings.novelPersistence;
    const next = deriveNovelPersistenceState({ previous: saved, session: saved.sessionSnapshot,
      importJob: saved.importJobSnapshot, progress: saved.progressSnapshot, processing: saved.processingSnapshot,
      inspectableResults: saved.inspectableResults, errors: saved.errors, warnings: saved.warnings,
      modelName: "未配置文本生成模型" });
    assert.deepEqual(sources(next), sources(saved));
  });
}
