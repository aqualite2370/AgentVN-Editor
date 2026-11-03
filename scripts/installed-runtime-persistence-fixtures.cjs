"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-runtime-persistence-20261018-01";
const work = "F:/AgentVN-QA-InstalledRuntimePersistence-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const prep = read(path.join(run, "preparation.json")); assert.equal(prep.status, "PASS");
assert(prep.profiles.every(p => fs.existsSync(p.held))); assert(!fs.existsSync(path.join(run, "fixtures.json")));
const old = read("D:/AgentVN/output/installed-runtime-abilities-20261018-01/fixtures-02.json");
assert.equal(sha256(fs.readFileSync(old.input)), old.inputSha256);
const p = read(old.input); p.project_id = "installed-runtime-persistence-20261018-01"; p.title = "安装版自动保存与NVL容量验收";
p.created_at = p.updated_at = new Date().toISOString();
const capacity = { text: Array.from({ length: 24 }, (_, i) =>
  `NVL_CAP_${String(i + 1).padStart(2, "0")}：` +
  "这是本轮容量翻页验收。整页累积内容不能持续缩小，旧页需安全翻页，菜单往返和存读档保留推进位置。".repeat(3)) };
const sceneTemplate = p.nodes.find(n => n.id === "scene");
function add(id, title, commands) {
  const n = structuredClone(sceneTemplate); n.id = id; n.data.label = n.data.scene.title = title;
  n.data.scene.scene_id = id; n.data.scene.commands = commands;
  n.position = { x: p.nodes.length * 320, y: 420 }; p.nodes.push(n);
}
const backBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#172a36"/></svg>');
p.asset_manifest.push({ asset_id: "qa_capacity_background", asset_type: "background", metadata: {
  filename: "容量验收背景.svg", mime_type: "image/svg+xml", width: 1280, height: 720,
  data_url: `data:image/svg+xml;base64,${backBytes.toString("base64")}` } });
add("qa_entry", "自动保存与容量入口", [
  { type: "background", background_id: "qa_capacity_background" },
  { type: "dialog", character_id: "hero", presentation_mode: "dialog", text: "PERSIST_ENTRY：从真实设置页修改偏好，再选择需要验收的剧情。" },
  { type: "choice", choices: [
    { choice_id: "capacity-entry", text: "进入NVL容量", target_scene_id: "nvl_capacity", conditions: [] },
    { choice_id: "autosave-entry", text: "进入自动存档", target_scene_id: "saves", conditions: [] },
  ] },
]);
add("nvl_capacity", "NVL容量与分支", [
  ...capacity.text.map(text => ({ type: "narration", text, presentation_mode: "nvl" })),
  { type: "choice", choices: [1, 2, 3].map(i => ({ choice_id: `capacity-choice-${i}`, text: `容量分支${i}`,
    target_scene_id: "nvl_after", conditions: [] })) },
]);
add("nvl_after", "NVL新场景清页", [
  { type: "narration", text: "NVL_AFTER：新场景必须清空旧累积页，仅保留这一句。", presentation_mode: "nvl" },
  { type: "narration", text: "NVL_AFTER_TWO：读取、回滚和历史不得重复。", presentation_mode: "nvl" },
]);
p.edges[0].target = "qa_entry";
const input = path.join(work, "自动保存与NVL容量隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
const report = { status: "PASS", at: new Date().toISOString(), input, inputSha256: sha256(fs.readFileSync(input)),
  projectId: p.project_id, title: p.title, text: old.text, spriteSha256: old.spriteSha256,
  source: { path: old.input, sha256: old.inputSha256 }, capacity, controlledProjectFixture: true,
  nativeProjectPickerClaim: false, realModelRequests: 0 };
fs.writeFileSync(path.join(run, "fixtures.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, input, capacityLines: capacity.text.length }));
