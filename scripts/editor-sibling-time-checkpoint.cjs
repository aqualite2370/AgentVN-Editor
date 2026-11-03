"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, ".."), out = "F:/AgentVN/Checkpoints/Editor-Sibling-Time-20261024-01";
const qa = "F:/AgentVN/QA/Editor-Sibling-Time-20261024-01";
assert(!fs.existsSync(out) && !fs.existsSync(qa)); fs.mkdirSync(out); fs.mkdirSync(qa);
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files = ["AGENTS.md", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "editor/src/utils/editorTransitionPresentation.ts", "editor/src/styles/variables.css",
  "editor/src/styles/editor-tokens.css", "editor/src/app/App.css", "editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/components/advanced/AdvancedToolsPanel.tsx", "editor/src/components/common/GlassSelectionGroup.tsx",
  "scripts/editor-transition-presentation-test.cjs", "scripts/editor-options-motion-playwright.cjs",
  "scripts/advanced-tools-transition-regression-playwright.cjs",
  "scripts/lib/installed-editor-motion-sampler.cjs", "scripts/lib/installed-editor-motion-workspace-policy.cjs",
  "scripts/lib/editor-ui-acceptance.cjs", "scripts/lib/current-native-editor-session.cjs",
  "GameCli_framework/src/app/RuntimeScreenNavigator.tsx", "GameCli_framework/src/app/runtimePageCrossfade.ts"];
const entries = files.map(file => {
  const source = path.join(root, file), copy = path.join(out, "files", file);
  fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(copy), sha(source)); return { file, copy, sha256: sha(source) };
});
const products = ["D:/AgentVN/AgentVN Dev.exe", "D:/AgentVN/editor/src-tauri/binaries/agentvn-player.exe",
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/agentvn-editor.exe",
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/agentvn-player.exe"]
  .map(file => ({ path: file, sha256: sha(file), bytes: fs.statSync(file).size }));
const project = fixture("qa-editor-sibling-time-20261024");
project.title = "同尺寸切页时钟隔离工程";
const input = path.join(out, "临时工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ startedAt: new Date().toISOString(),
  scope: "EDITOR_SIBLING_TIME_READER_NOT_RUNTIME_OR_HOME_CURVE", entries, products,
  input: { path: input, sha256: sha(input), projectId: project.project_id },
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, qa, files: entries.length, input }));
