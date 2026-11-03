"use strict";
// Public-import fixture, not a product change or native-picker acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const base = process.env.AGENTVN_PORTRAIT_RUN || "D:/AgentVN/output/installed-dialog-portrait-20261019-01";
const work = process.env.AGENTVN_PORTRAIT_WORK || "F:/AgentVN/QA/Dialog-Portrait-20261019-01";
assert.equal(path.dirname(path.resolve(base)), path.resolve("D:/AgentVN/output"));
assert.equal(path.dirname(path.resolve(work)), path.resolve("F:/AgentVN/QA"));
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const prep = read(`${base}/preparation.json`);
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
const previous = read("D:/AgentVN/output/installed-assets-20261018-01/fixtures.json");
const row = previous.types.find(a => a.type === "portrait"); assert(row);
assert.equal(sha256(fs.readFileSync(row.files.new.path)), row.files.new.sha256);
const p = fixture("installed-dialog-portrait-20261019-01");
p.title = "专用对白头像真实入口验收20261019";
p.nodes[1].data.scene.commands = [
  { type: "dialog", character_id: "hero", text: "PORTRAIT_BOUND：真实头像选择后必须显示升级头像。", presentation_mode: "dialog" },
  { type: "dialog", character_id: "hero", text: "PORTRAIT_CONTROL：无头像的对照句。", presentation_mode: "dialog" },
];
p.asset_manifest = [{ asset_id: row.id, asset_type: "portrait", metadata: {
  filename: "portrait-升级.svg", display_name: "升级头像专用验收", mime_type: "image/svg+xml",
  width: 900, height: 600, data_url: `data:image/svg+xml;base64,${fs.readFileSync(row.files.new.path).toString("base64")}`,
} }];
const input = path.join(work, "对白头像隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
fs.writeFileSync(`${base}/fixtures.json`, JSON.stringify({
  status: "PASS", at: new Date().toISOString(), input, inputSha256: sha256(fs.readFileSync(input)),
  projectId: p.project_id, title: p.title, scene: "ui_acceptance", nodeId: "scene",
  portrait: { id: row.id, sha256: row.files.new.sha256, priorReplacementFixture: previous.input,
    path: row.files.new.path, width: 900, height: 600 },
  scope: "NEW_ISOLATED_PROJECT_WITH_EXACT_PREVIOUS_UI_REPLACEMENT_BYTES; PORTRAIT_BOUND_BY_REAL_UI",
  modelRequests: 0, productChanges: 0, nativeProjectPickerClaim: false,
}, null, 2), { flag: "wx" });
console.log("PASS: isolated project with exact upgraded portrait bytes; no prebound portrait command");
