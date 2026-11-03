"use strict";
// Read-only product audit after the original wrapper's build-only-manifest
// assertion. Preserve its FAILED report; never rebuild/reinstall or mutate it.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");
assert.equal(process.argv.length, 4, "node script <original-release-report> <fresh-review-directory>");
const root = path.resolve(__dirname, ".."), original = path.resolve(process.argv[2]), out = path.resolve(process.argv[3]);
assert(A.inside(path.join(root, "output"), original) && A.inside(path.join(root, "output"), out));
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const hash = file => A.sha256(fs.readFileSync(file));
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "Corrected actual resource audit, no build/install/UI/device substitute",
  original: { path: original, sha256: hash(original) }, cases: [], resources: [] };
try {
  const previous = read(original);
  assert.equal(previous.status, "FAILED");
  assert.match(previous.error, /ENOENT[\s\S]*scripts\\standalone-build-scripts\.json/);
  assert.deepEqual(previous.steps.map(s => [s.name, s.status, s.exitCode]), [
    ["full-editor-release-build", "PASS", 0], ["three-installer-resource-audit", "PASS", 0],
    ["independent-actual-NSIS-installation", "PASS", 0],
  ]);
  assert.equal(hash(previous.gate.path), previous.gate.sha256);
  const validated = spawnSync(process.execPath, [path.join(__dirname, "installed-player-authoring-release.cjs"),
    previous.gate.path, path.join(out, "must-not-be-created"), "--runtime-webview", "--validate-only"],
  { cwd: root, windowsHide: true, encoding: "utf8", timeout: 60000 });
  report.gateValidation = { exitCode: validated.status, stdout: validated.stdout, stderr: validated.stderr };
  assert.equal(validated.status, 0, validated.stderr); assert(!fs.existsSync(path.join(out, "must-not-be-created")));
  // Last command argument is the installation run root, not a report filename.
  const actualSession = previous.steps[2].command.at(-1);
  assert(A.inside(path.dirname(original), actualSession));
  const actual = read(path.join(actualSession, "actual-installation.json"));
  assert.equal(actual.status, "PASS"); assert.equal(actual.registryRestored, true);
  const auditFile = path.join(actualSession, "installer-resource-report.json"), audit = read(auditFile);
  assert.equal(audit.status, "PASS"); assert.equal(audit.installers.length, 3);
  for (const installer of audit.installers) assert.equal(hash(installer.path), installer.sha256);
  const actualRoots = audit.deployments.filter(d => d.kind === "NSIS actual isolated installation");
  assert.equal(actualRoots.length, 1); assert.equal(actualRoots[0].installedRoot, actual.installRoot);
  assert.equal(hash(actual.executable.path), actual.executable.sha256);
  const manifestFile = path.join(root, "scripts/standalone-build-scripts.json"), manifest = read(manifestFile);
  assert.equal(manifest.schemaVersion, 1); assert.equal(new Set(manifest.scripts).size, manifest.scripts.length);
  assert(manifest.scripts.length > 0);
  report.buildOnlyManifest = { path: manifestFile, sha256: hash(manifestFile), shipped: false };
  const required = ["GameCli_framework/src/main.tsx", "GameCli_framework/src/utils/runtimeCompatibility.ts",
    "GameCli_framework/src/types/runtimeCompatibility.d.ts", "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
    "GameCli_framework/src/styles/player.css", "GameCli_framework/package.json", "GameCli_framework/package-lock.json",
    ...manifest.scripts.map(name => {
      assert.equal(path.basename(name), name); return `scripts/${name}`;
    })];
  for (const deployment of audit.deployments) {
    assert.equal(hash(deployment.executable.path), deployment.executable.sha256);
    for (const relative of required) {
      const sha256 = hash(path.join(root, relative));
      assert.equal(hash(path.join(deployment.installedRoot, relative)), sha256, `${deployment.kind}: ${relative}`);
      report.resources.push({ deployment: deployment.kind, relative, sha256 });
    }
  }
  for (const relative of required) assert.equal(hash(path.join(root, "editor/src-tauri/bundle-workspace", relative)),
    hash(path.join(root, relative)));
  assert.equal(hash(original), report.original.sha256, "Original FAILED proof must remain unchanged");
  report.installation = { directory: actual.installRoot, executable: actual.executable };
  report.installationAudit = { path: auditFile, sha256: hash(auditFile) };
  report.cases = ["completed-gate-still-valid", "three-packages-same-hashes", "actual-installation-and-registry-restored",
    "all-listed-helpers-and-compatibility-sources-shipped", "bundled-equality", "original-failure-preserved"]
    .map(name => ({ name, status: "PASS" }));
  report.status = "INSTALLED_RUNTIME_WEBVIEW_RELEASE_READY";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, out, resources: report.resources.length, error: report.error }));
}
