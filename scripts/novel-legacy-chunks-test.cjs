"use strict";
// No HTTP or model. Optional private checkpoint is read in place; never log text.
const assert = require("node:assert/strict"), fs = require("node:fs");
const ts = require("../editor/node_modules/typescript");
require.extensions[".ts"] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true },
}).outputText, file);
const { chunkText } = require("../editor/src/novel-import/textChunker.ts");
const { chunksMatchDocument } = require("../editor/src/novel-import/persistence.ts");
const cases = [];
function test(name, fn) {
  try { fn(); cases.push({ name, status: "PASS" }); }
  catch { cases.push({ name, status: "FAILED" }); }
}
const text = Array.from({ length: 65 }, (_, i) =>
  `章节${i}\n${"甲乙丙丁。".repeat(36 + i % 5)}\n\n\n${"末尾段落。".repeat(27)}`).join("\n\n");
const doc = { document_id: "legacy_doc", normalized_text: text };
for (const max of [2600, 4032, 6000, 8000]) {
  test(`paragraph/overlap producer ${max} reuses exact saved IDs`, () => {
    const chunks = chunkText(doc.document_id, text, max, Math.floor(max * .08));
    const prior = JSON.stringify(chunks);
    assert(chunksMatchDocument(chunks, doc));
    assert.equal(JSON.stringify(chunks), prior);
  });
}
const chunks = chunkText(doc.document_id, text, 4032, 322);
test("same-length source edit refuses old analysis", () => {
  assert(!chunksMatchDocument(chunks, { ...doc, normalized_text: text.replace("甲", "新") }));
});
test("another document refuses old analysis", () => {
  assert(!chunksMatchDocument(chunks, { ...doc, document_id: "other" }));
});
test("corrupted saved text is not whitespace-normalized into a match", () => {
  const copy = structuredClone(chunks); copy[2].text += "新";
  assert(!chunksMatchDocument(copy, doc));
});
test("out-of-range offsets refuse recovery", () => {
  const copy = structuredClone(chunks); copy[0].start_offset = -1;
  assert(!chunksMatchDocument(copy, doc));
});
test("single paragraph-normalized chunk", () => {
  const small = { document_id: "small", normalized_text: "甲。\n\n\n乙。\n\n\n丙。" };
  assert(chunksMatchDocument(chunkText(small.document_id, small.normalized_text, 6000, 480), small));
});
test("exact source slice remains supported", () => {
  assert(chunksMatchDocument([{ chunk_id: "exact", document_id: "e", index: 0,
    text: "原文", start_offset: 0, end_offset: 2 }], { document_id: "e", normalized_text: "原文" }));
});
test("empty list does not count as a checkpoint", () => assert(!chunksMatchDocument([], doc)));
const privateFile = process.argv.find(a => a.startsWith("--private="))?.slice(10);
if (privateFile) {
  test("private original85 matches actual producer without changing scans", () => {
    const p = JSON.parse(fs.readFileSync(privateFile, "utf8"));
    const s = p.editor_settings.novelPersistence.sessionSnapshot;
    assert.equal(s.ai_chunk_analyses.length, 85);
    assert.equal(s.chunks.length, 85);
    assert(chunksMatchDocument(s.chunks, s.document));
    assert(s.ai_chunk_analyses.every(a => s.chunks.some(c => c.chunk_id === a.chunk_id)));
  });
}
const result = { status: cases.every(c => c.status === "PASS") ? "PASS" : "FAILED",
  modelRequests: 0, privateTextLogged: false, cases };
console.log(JSON.stringify(result, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
