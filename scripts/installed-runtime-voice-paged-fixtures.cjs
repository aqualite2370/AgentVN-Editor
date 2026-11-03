"use strict";
// Test input only. Reuse the already verified synthetic WAV without claiming
// a new listening test; six voiced commands cover three independent modes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const base = "D:/AgentVN/output/installed-runtime-voice-paged-20261019-01";
const work = "F:/AgentVN/QA/Runtime-Voice-Paged-20261019-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => sha256(fs.readFileSync(p));
const prep = read(path.join(base, "preparation.json"));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert(!fs.existsSync(path.join(base, "fixtures.json")));
const original = read("D:/AgentVN/output/installed-runtime-voice-20261019-01/fixtures.json");
assert.equal(sha(original.input), original.inputSha256);
assert.equal(sha(original.voice.path), original.voice.sha256);
const project = read(original.input);
project.project_id = "installed-runtime-voice-paged-20261019-01";
project.title = "有声分页重启恢复隔离验收20261019";
const dialogs = [];
for (const mode of ["dialog", "nvl", "bubble"]) {
  // Distinct numbered segments make ordering/duplication measurable, not just
  // a repeated-character length check. Large enough to paginate at 4K.
  const text = Array.from({ length: 340 }, (_, i) =>
    `${mode}第${String(i + 1).padStart(3, "0")}段：月光映照石阶，远处传来清晰的脚步声；她停下来，确认每一页文字都完整保留。`).join("");
  dialogs.push({ text, voice: original.voice.assetId, mode });
  dialogs.push({ text: `${mode}分页结束：这是新一句有声对白，应当正常播放一次。`,
    voice: original.voice.assetId, mode });
}
project.nodes[1].data.scene.commands = dialogs.map(d => ({
  type: "dialog", character_id: "hero", text: d.text, voice: d.voice, presentation_mode: d.mode,
}));
const input = path.join(work, "有声分页重启隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const wavPath = path.join(work, "合成语音探针.wav");
fs.copyFileSync(original.voice.path, wavPath, fs.constants.COPYFILE_EXCL);
const fixture = { status: "PASS", at: new Date().toISOString(), input, inputSha256: sha(input),
  projectId: project.project_id, title: project.title, spriteSha256: original.spriteSha256,
  voice: { ...original.voice, path: wavPath, dialogs }, modelRequests: 0, productChanges: 0,
  provenance: { fixture: original.input, sha256: original.inputSha256 } };
fs.writeFileSync(path.join(base, "fixtures.json"), JSON.stringify(fixture, null, 2), { flag: "wx" });
console.log("PASS six voiced commands, three numbered long texts, exact prior WAV; no model/build");
