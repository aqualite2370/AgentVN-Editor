"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const runtimeFile = "GameCli_framework/src/components/shell/HelpScreen.tsx";
const backendFile = "backend/app/models/commands.py";
const frontendFiles = [
  "editor/src/components/advanced/RenpyRuntimePreview.tsx",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
];

// Exercise the real post-build audit against the actual prepared workspace.
// Editor UI is compiled into frontendDist, not shipped as Runtime source.
if (!process.argv.includes("--fixtures-only")) {
  const actual = collectStageResourceEvidence(root, [runtimeFile, ...frontendFiles]);
  assert.deepEqual(actual.bundled.map(item => item.file), [runtimeFile]);
  assert.deepEqual(actual.frontendSources.map(item => item.file), frontendFiles);
  assert(actual.frontendSources.every(item => /^[a-f0-9]{64}$/.test(item.sha256)));
  assert(!fs.existsSync(path.join(root, "editor/src-tauri/bundle-workspace/editor")));
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "AgentVN 中文 resource audit "));
function write(relative, text) {
  const file = path.join(fixture, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
try {
  write(runtimeFile, "new runtime");
  write(`editor/src-tauri/bundle-workspace/${runtimeFile}`, "new runtime");
  write(frontendFiles[0], "compiled editor input");
  write(backendFile, "validated backend source");
  const backendEvidence = collectStageResourceEvidence(fixture, [backendFile]);
  assert.deepEqual(backendEvidence.backendSources.map(item => item.file), [backendFile]);
  assert.equal(backendEvidence.backendSources[0].scope,
    "backend-source; Dev uses owned Python workspace; packaged backend requires Release acceptance");
  assert.throws(() => collectStageResourceEvidence(fixture, ["backend/missing.py"]), /ENOENT/,
    "Missing backend source must still fail");
  const prepared = collectStageResourceEvidence(fixture, [runtimeFile, frontendFiles[0]]);
  assert.deepEqual(prepared.bundled.map(item => item.file), [runtimeFile]);
  assert.deepEqual(prepared.frontendSources.map(item => item.file), [frontendFiles[0]]);
  write(`editor/src-tauri/bundle-workspace/${runtimeFile}`, "old runtime");
  assert.throws(() => collectStageResourceEvidence(fixture, [runtimeFile]),
    /Bundled workspace mismatch/, "stale Runtime must still block delivery");
  fs.unlinkSync(path.join(fixture, "editor/src-tauri/bundle-workspace", runtimeFile));
  assert.throws(() => collectStageResourceEvidence(fixture, [runtimeFile]), /ENOENT/,
    "missing Runtime must not silently become a frontend-only file");
  assert.equal(collectStageResourceEvidence(fixture, [frontendFiles[0]]).frontendSources.length, 1);
  assert.throws(() => collectStageResourceEvidence(fixture, [frontendFiles[1]]), /ENOENT/,
    "missing editor input must not be ignored");
  assert.throws(() => collectStageResourceEvidence(fixture, ["../outside.ts"]), /Unsafe resource path/);
  console.log("PASS actual help-slice resource audit, frontend/runtime separation, stale/missing files and Chinese paths");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
