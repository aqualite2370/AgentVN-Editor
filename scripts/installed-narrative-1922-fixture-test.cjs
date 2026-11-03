"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { makeNarrativeFixture, validateNarrativeFixture } = require("./lib/installed-narrative-1922-fixture.cjs");
const source = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/fixture.json", "utf8"));
const project = JSON.parse(fs.readFileSync(source.input, "utf8")), original = structuredClone(project);
const { project: result, metadata, wav } = makeNarrativeFixture(project);
assert.deepEqual(project, original, "Never modify the original fixture object");
assert.doesNotThrow(() => validateNarrativeFixture(result, metadata, wav));
const mutations = [
  ([p]) => { p.project_id = original.project_id; },
  ([p]) => { p.nodes[1].data.scene.commands[1].choices.pop(); },
  ([p]) => { p.nodes.find(n => n.id === "voice_dialog").data.scene.commands[0].voice = "absent"; },
  ([p]) => { p.nodes.find(n => n.id === "capacity").data.scene.commands.pop(); },
  ([p]) => { p.nodes.find(n => n.id === "capacity").data.scene.commands[3].presentation_mode = "dialog"; },
  ([p]) => { p.asset_manifest.find(a => a.asset_id === "qa_narrative_voice").metadata.data_url = ""; },
  ([, m]) => { m.voice.listeningAcceptanceClaim = true; },
  ([, m]) => { m.longTexts.voice_nvl_4k = m.longTexts.voice_nvl; },
  ([, , b]) => { b[0] = 0; },
];
for (const mutate of mutations) {
  const args = [structuredClone(result), structuredClone(metadata), Buffer.from(wav)];
  mutate(args); assert.throws(() => validateNarrativeFixture(...args));
}
const mixed = makeNarrativeFixture(project, { mixedCapacity: true });
assert(mixed.metadata.capacityTexts.slice(0, 8).every(t => t.length > 200 && t.length < 500),
  "Mixed fixture must leave room for several already-displayed history lines");
assert(mixed.metadata.capacityTexts.slice(8).every(t => t.length > 1000),
  "Mixed fixture must still exercise full-page capacity and choice reservation");
assert.doesNotThrow(() => validateNarrativeFixture(mixed.project, mixed.metadata, mixed.wav));
console.log(JSON.stringify({ status: "PASS", rejectedVariants: mutations.length,
  originalUnchanged: true, scope: "QA_FIXTURE_ONLY_NO_APP_START_OR_MODEL" }));
