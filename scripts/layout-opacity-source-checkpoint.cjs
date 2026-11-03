"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/Layout-Opacity-Source-20261020-01";
const qa = "F:/AgentVN/QA/Layout-Opacity-Source-20261020-01";
assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa), "Do not replace an existing checkpoint");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files = [
  "plans/ACTIVE_TASKS.md", "AGENTS.md", "shared/cartridge/uiSkin.ts",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/components/shell/MainMenu.tsx",
  "GameCli_framework/src/styles/shell.css",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "editor/src/components/advanced/DialogueModeLayoutEditor.tsx",
  "editor/src/components/advanced/RenpyRuntimePreview.tsx",
];
fs.mkdirSync(checkpoint, { recursive: true }); fs.mkdirSync(qa, { recursive: true });
const entries = files.map(file => {
  const target = path.join(checkpoint, "files", file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
  return { file, sha256: sha(target), bytes: fs.statSync(target).size };
});
const dev = path.join(root, "AgentVN Dev.exe"), savedDev = path.join(checkpoint, "AgentVN Dev.exe");
fs.copyFileSync(dev, savedDev, fs.constants.COPYFILE_EXCL);
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const project = fixture("layout-opacity-source-20261020-01");
project.title = "布局透明度 隔离小工程";
const input = path.join(qa, "布局透明度 隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const historical = "output/installed-layout-author-review-20261019-01/inherited-opacity-01/report.json";
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify({
  at: new Date().toISOString(), files: entries, dev: { path: savedDev, sha256: sha(savedDev) },
  fixture: { path: input, sha256: sha(input), projectId: project.project_id },
  historicalFailure: { file: historical, sha256: sha(path.join(root, historical)) },
  scope: "Targeted recoverable copies including untracked authoring implementation; no reset or cleanup",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ checkpoint, qa, input }));
