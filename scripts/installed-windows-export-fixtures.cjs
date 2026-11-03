"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = process.env.AGENTVN_WORKSPACE_OUTPUT || "D:/AgentVN/output/installed-windows-export-20261018-01";
assert(/^D:\/AgentVN\/output\/installed-windows-export-20261018-0[1-9]$/i.test(run.replaceAll("\\", "/")));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const prep = read(path.join(run, "preparation.json"));
const work = prep.workRoot;
assert(/^F:\/AgentVN-QA-InstalledWindowsExport-20261018-0[1-9]$/i.test(work.replaceAll("\\", "/")));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
const project = fixture(`installed-windows-export-isolated-${path.basename(run).slice(-11)}`);
project.schema_version = "1.1.0"; project.title = "安装版Windows独立包验收20261018";
project.nodes[0].data.loadingAnimation = { kind: "default" }; project.nodes[0].data.openingAudio = [];
project.nodes[1].data.scene.commands = [
  { type: "narration", text: "QA_WINDOWS_SAVE_FIRST：本轮仅使用独立临时工程。" },
  { type: "narration", text: "QA_WINDOWS_SAVE_SECOND：此处用于验证实际存档和重启恢复。" },
  { type: "narration", text: "QA_WINDOWS_SAVE_THIRD：拒写时不得悄悄切换保存目录。" },
];
const input = path.join(work, "Windows 独立包 临时工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const output = path.join(work, "中文 Windows 输出");
fs.mkdirSync(output);
const report = { status: "PASS", at: new Date().toISOString(), input, projectId: project.project_id,
  title: project.title, inputSha256: sha256(fs.readFileSync(input)), output,
  realModelRequests: 0, controlledFixturePreparation: true };
fs.writeFileSync(path.join(run, "fixtures.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
