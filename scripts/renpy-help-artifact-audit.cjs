"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
assert(process.argv[2], "Pass the preserved help-slice gate report explicitly");
const baselinePath = path.resolve(process.argv[2]);
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const output = path.join(root, "output/renpy-stage2-help-artifact-audit",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = {
  status: "RUNNING", scope: "post-build-help-artifact-audit; not a rerun of full gates or installed acceptance",
  baseline: { path: baselinePath, sha256: hash(baselinePath), originalStatus: baseline.status },
};
try {
  assert.equal(baseline.scope, "independent-renpy-help-layout-and-preview-slice");
  assert.equal(baseline.status, "FAILED");
  assert.match(baseline.error, /ENOENT.*bundle-workspace\\editor\\src\\components\\advanced/);
  assert.equal(baseline.checks.length, 23);
  assert(baseline.checks.every(check => check.status === "PASS" && check.exitCode === 0),
    "A resource audit cannot convert failed or unfinished behavior/build checks into PASS");
  report.priorCompletedChecks = baseline.checks;
  const expectedDev = baseline.dev;
  assert.equal(hash(expectedDev.path), expectedDev.sha256, "Dev changed since the baseline build");
  assert.equal(hash(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
    expectedDev.compiledSha256, "compiled Dev changed since baseline");
  report.dev = { ...expectedDev, currentSha256: hash(expectedDev.path) };
  const files = [
    ...baseline.bundled.map(item => item.file),
    "editor/src/components/advanced/RenpyRuntimePreview.tsx",
    "editor/src/components/advanced/RenpyTitleEditor.tsx",
    "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  ];
  for (const item of baseline.bundled) {
    assert.equal(hash(path.join(root, item.file)), item.sha256,
      `Product source changed since the baseline: ${item.file}`);
  }
  const editorStarted = Date.parse(baseline.checks.find(item => item.label === "editor-build").startedAt);
  for (const file of files.filter(file => file.startsWith("editor/src/"))) {
    assert(fs.statSync(path.join(root, file)).mtimeMs <= editorStarted,
      `Editor input newer than the completed build: ${file}`);
  }
  Object.assign(report, collectStageResourceEvidence(root, files));
  report.frontendEvidenceBoundary = "Source identities recorded separately; editor UI was exercised by prior real-browser gates. Source hashes alone are not installation evidence.";
  const player = path.join(root, "editor/src-tauri/binaries/agentvn-player.exe");
  report.player = { path: player, sha256: hash(player), generatedAt: fs.statSync(player).mtime.toISOString() };
  assert.equal(hash(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")),
    report.player.sha256, "preview resource differs from the compiled Runtime");
  const config = JSON.parse(fs.readFileSync(path.join(root, "editor/src-tauri/tauri.conf.json"), "utf8"));
  const dist = path.resolve(root, "editor/src-tauri", config.build.frontendDist);
  function inventory(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? inventory(file) : [{
        path: file, sha256: hash(file), bytes: fs.statSync(file).size,
      }];
    });
  }
  report.frontendBuild = { directory: dist, files: inventory(dist) };
  assert(report.frontendBuild.files.some(file => path.basename(file.path) === "index.html"));
  assert(report.frontendBuild.files.some(file => path.extname(file.path) === ".js"));
  assert.equal(hash(baselinePath), report.baseline.sha256, "Historical evidence was altered");
  report.status = "HELP_ARTIFACT_AUDIT_PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, error: report.error, output }));
}
