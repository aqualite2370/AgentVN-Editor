"use strict";
// Exercise the actual pre-write validation and graph-ingress APIs together.
const fs = require("node:fs"), assert = require("node:assert/strict");
const ts = require("../editor/node_modules/typescript");
require.extensions[".ts"] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true },
}).outputText, file);
const { validateNovelBlueprintWrite } = require("../editor/src/novel-import/structureValidator.ts");
const { adaptedSceneToNode } = require("../editor/src/novel-import/importToGraph.ts");
const text = "雨停了，窗外的树叶轻轻摇动。";
const document = { document_id: "qa_doc", normalized_text: text, raw_text: text, total_chars: text.length };
const candidate = { scene_candidate_id: "qa_candidate", chapter_id: "qa_chapter", index: 0, title: "雨后",
  start_offset: 0, end_offset: text.length, source_excerpt: text, summary: text, characters: [] };
const layout = { importLineId: "qa_line", sessionId: "qa_session", startPosition: { x: 0, y: 0 },
  columnGap: 360, rowGap: 220, columns: 4 };
function fixture(commands) {
  return { adapted_scene_id: "qa_adapted", source_scene_candidate_id: candidate.scene_candidate_id,
    scene_beat: { scene_id: "qa_scene", title: "雨后", summary: text, chapter: 0, tags: [], commands },
    source_mapping: { document_id: document.document_id, start_offset: 0, end_offset: text.length,
      source_excerpt: text, adapted_command_ids: [] }, warnings: [], needs_review: false };
}
function validate(adapted) {
  return validateNovelBlueprintWrite({ reportId: "qa_report", document, sceneCandidate: candidate,
    adaptedScene: adapted, branchSuggestions: [], conflictPoints: [], knownCharacters: [],
    usedSceneIds: new Set(), allowBranchSuggestions: false });
}
const nullable = { type: "narration", text, presentation_mode: null, clear_nvl_page_before: null,
  bubble_position: null, dialog_style_mode: null, narration_style: null };
const raw = fixture([nullable]);
const result = validate(raw);
assert.equal(result.blocked, false, JSON.stringify(result.report.errors));
const graph = adaptedSceneToNode(result.adaptedScene, layout, 0);
for (const commands of [result.adaptedScene.scene_beat.commands, graph.data.scene.commands]) {
  const narration = commands.find(c => c.type === "narration"); assert(narration);
  for (const field of Object.keys(nullable).filter(k => nullable[k] === null)) assert.equal(narration[field], undefined, field);
}
assert.deepEqual(raw.scene_beat.commands[0], nullable, "Original backend/model response must stay intact");
console.log("PASS default backend optional null survives pre-write validation and graph ingress");
const explicit = { type: "narration", text, narration_style: "centered", presentation_mode: "nvl",
  clear_nvl_page_before: false, dialog_style_mode: "manual" };
const selected = validate(fixture([explicit]));
assert(!selected.blocked); assert.deepEqual(selected.adaptedScene.scene_beat.commands[0], explicit);
console.log("PASS explicit presentation, false and styles remain unchanged");
const badStyle = validate(fixture([{ ...explicit, narration_style: "banner" }]));
assert(badStyle.blocked); assert(badStyle.report.errors.some(e => e.includes("narration_style")));
console.log("PASS explicit invalid narration style is still blocked");
const meaningful = { type: "state_update", key: "qa_state", operation: "set", value: null };
const withNullState = validate(fixture([{ type: "narration", text }, meaningful]));
assert(!withNullState.blocked);
assert.deepEqual(withNullState.adaptedScene.scene_beat.commands.find(c => c.type === "state_update"), meaningful);
assert.deepEqual(adaptedSceneToNode(withNullState.adaptedScene, layout, 0).data.scene.commands
  .find(c => c.type === "state_update"), meaningful);
console.log("PASS meaningful state null survives validation and graph write");
for (const [field, value] of [["presentation_mode", "illegal"], ["clear_nvl_page_before", "yes"],
  ["bubble_position", { mode: "unsafe" }], ["dialog_style_mode", "illegal"]]) {
  const result = validate(fixture([{ type: "narration", text, [field]: value }]));
  assert.deepEqual(result.adaptedScene.scene_beat.commands[0][field], value, field);
}
console.log("PASS normalization does not hide explicit invalid field values");
