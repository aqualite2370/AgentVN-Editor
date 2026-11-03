"use strict";
// Verify authored bytes, not a label claiming that a Ren'Py fixture is AgentVN.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/default-title-fixture-tests", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "Isolated authored fixture, not installed export acceptance",
  startedAt: new Date().toISOString(), cases: [] };
(async () => {
  const target = path.join(out, "fixture");
  const args = ["scripts/prepare-full-story-acceptance-input.cjs", target, "--agentvn-default"];
  report.command = [process.execPath, ...args];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true });
  report.generator = { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  assert.equal(result.status, 0, result.stderr);
  const fixture = JSON.parse(fs.readFileSync(path.join(target, "fixture-report.json"), "utf8"));
  assert.equal(fixture.layoutType, "agentvn", "Default-title coverage must not use the Ren'Py fixture");
  report.cases.push({ name: "explicit AgentVN coverage", status: "PASS" });
  const bytes = fs.readFileSync(fixture.input);
  assert.equal(sha256(bytes), fixture.sha256);
  const zip = await JSZip.loadAsync(bytes);
  const project = JSON.parse(await zip.file("project.json").async("string"));
  assert.equal(project.project_id, fixture.projectId);
  for (const field of ["runtimeUILayout", "runtimeUILayoutType", "runtimeUILayoutProfiles",
    "runtimeUILayoutProfileSet", "runtimeLayoutType"]) {
    assert.equal(project.editor_settings[field], undefined, `Must exercise missing ${field}, not authored overrides`);
  }
  assert.deepEqual(Object.keys(project.editor_settings), ["characterDisplayNames"],
    "Default title must have no theme, title color, shell or layout override");
  report.cases.push({ name: "archive has no layout/theme overrides", status: "PASS" });
  assert.equal(fixture.assets.length, 3);
  for (const asset of fixture.assets)
    assert.equal(sha256(await zip.file(asset.metadata.path).async("nodebuffer")), asset.metadata.hash_sha256);
  report.cases.push({ name: "three real fixture asset bytes", status: "PASS" });
  assert.equal(project.nodes.filter(n => n.type === "sceneNode").length, 4);
  assert.equal(fixture.scenes.length, 4);
  report.cases.push({ name: "isolated gameplay remains available", status: "PASS" });
  report.fixture = { path: path.join(target, "fixture-report.json"), sha256: sha256(fs.readFileSync(path.join(target, "fixture-report.json"))) };
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  });
