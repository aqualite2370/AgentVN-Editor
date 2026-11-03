"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = path.join(root, "output/gui-scope-20261019-01");
const checkpoint = "F:/AgentVN/Checkpoints/GUI-Scope-20261019-01";
const load = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const artifact = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const baseline = load(path.join(checkpoint, "manifest.json")), evidence = {};
function absent(pid) {
  assert(Number.isInteger(pid));
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch (error) { if (error.code !== "ESRCH") throw error; }
  assert(!alive, `Recorded PID ${pid} remains; verify ownership, do not kill unrelated processes`);
}
for (const phase of ["red-parser", "green-parser"]) {
  const file = path.join(out, phase, "report.json"), result = load(file);
  assert.equal(result.cases.length, 16);
  assert.equal(result.modelSubmissions, 0);
  assert.equal(result.status, phase.startsWith("red") ? "FAILED" : "PASS");
  assert.equal(result.cases.filter(c => c.status === "FAILED").length, phase.startsWith("red") ? 13 : 0);
  assert.equal(result.parserSha256, phase.startsWith("red")
    ? baseline.files.find(f => f.relative === "shared/cartridge/renpyGui.ts").sha256
    : sha(path.join(root, "shared/cartridge/renpyGui.ts")));
  evidence[phase] = artifact(file);
}
for (const phase of ["red-browser", "green-browser"]) {
  const file = path.join(out, phase, "report.json"), result = load(file), red = phase.startsWith("red");
  assert.equal(result.status, red ? "FAILED" : "PASS");
  assert.equal(result.cases.length, 12); assert.equal(result.modelSubmissions, 0);
  const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
    ["no-preference", "reduce"].map(motion => `${width}/${dpr}/${motion}`))).sort();
  assert.deepEqual(result.cases.map(c => `${c.width}/${c.dpr}/${c.motion}`).sort(), matrix);
  assert.equal(result.cases.flatMap(c => c.checks).length, 48);
  assert.equal(result.cases.flatMap(c => c.checks).filter(c => c.status === "FAILED").length, red ? 36 : 0);
  for (const c of result.cases) {
    assert(!c.error); assert.equal(c.status, red ? "FAILED" : "PASS");
    assert.deepEqual(c.errors, []);
    assert.deepEqual(c.geometry.viewport, { width: c.width, height: c.height,
      dpr: c.dpr, reduced: c.motion === "reduce" });
    assert.equal(c.assetProofs.length, 25);
    for (const asset of c.assetProofs)
      assert.equal(asset.sha256, baseline.officialFiles.find(f => asset.source === `官方模板 中文/game/${f.relative}`)?.sha256);
    const png = fs.readFileSync(c.screenshot.path);
    assert.equal(png.readUInt32BE(16), c.width * c.dpr); assert.equal(png.readUInt32BE(20), c.height * c.dpr);
    assert.equal(sha(c.screenshot.path), c.screenshot.sha256);
    assert.equal(c.persistedValues.shared.fontSize, red ? 30 : 22);
    assert.equal(c.persistedValues.shared.spacing, red ? 20 : 4);
    assert.equal(c.persistedValues.save_load.saveColumns, red ? 2 : 3);
  }
  absent(result.service.backendPid); absent(result.service.frontendPid);
  evidence[phase] = { ...artifact(file), displays: 12, assertions: 48, officialAssetChecks: 300 };
}
for (const [folder, status] of [["red-roundtrip", "FAILED"], ["green-roundtrip", "FAILED"],
  ["green-roundtrip-02", "PASS"]]) {
  const file = path.join(out, folder, "report.json"), result = load(file);
  assert.equal(result.status, status);
  if (folder === "red-roundtrip") assert(result.error.includes("30 !== 22"));
  if (folder === "green-roundtrip") assert(result.error.includes("maxSingleFileSizeMB"));
  if (status === "PASS") {
    assert.equal(result.assets.length, 25); assert.equal(result.runtimeValidation.ok, true);
    assert.equal(sha(result.cartridge.path), result.cartridge.sha256);
    assert.equal(result.values.shared.fontSize, 22);
  }
  evidence[folder] = artifact(file);
}
// Both headless failures are retained. Serial headless failed too: do not
// pretend that concurrency was proved to be the sole cause.
for (const folder of ["reimport", "reimport-serial"]) {
  const file = path.join(out, folder, "report.json"), result = load(file);
  assert.equal(result.status, "FAILED");
  assert(result.error.includes("continuous intermediate frames"));
  absent(result.owner.backendPid); absent(result.owner.vitePid);
  evidence[folder] = artifact(file);
}
const firstHeadful = load(path.join(out, "reimport-headful/report.json"));
assert.equal(firstHeadful.status, "PASS"); assert.equal(firstHeadful.cases.length, 6);
absent(firstHeadful.owner.backendPid); absent(firstHeadful.owner.vitePid);
assert.equal(load(path.join(out, "reimport-headful/browser-environment.json")).browsers.length, 0);
evidence["first-headful-harness-collision-not-clean-command-pass"] = artifact(path.join(out, "reimport-headful/report.json"));
for (const folder of ["reimport-headful-02", "dialog"]) {
  const file = path.join(out, folder, "report.json"), result = load(file);
  assert.equal(result.status, "PASS");
  assert.equal(result.cases.length, folder === "dialog" ? 36 : 6);
  assert(result.cases.every(c => c.status === "PASS"));
  if (result.owner.backendPid) absent(result.owner.backendPid);
  absent(result.owner.vitePid ?? result.owner.pid);
  const environment = load(path.join(out, folder, "browser-environment.json"));
  assert.equal(environment.browsers.length, 1);
  assert.equal(environment.browsers[0].headless, false);
  assert.equal(environment.processes.length, 1);
  for (const owned of environment.processes) {
    assert.equal(owned.presentAtExit, false); absent(owned.pid);
  }
  evidence[folder] = artifact(file);
  evidence[`${folder}-environment`] = artifact(path.join(out, folder, "browser-environment.json"));
}
for (const file of baseline.files) if (!["shared/cartridge/renpyGui.ts", "plans/ACTIVE_TASKS.md"].includes(file.relative))
  assert.equal(sha(path.join(root, file.relative)), file.sha256, `Unexpected product change: ${file.relative}`);
assert.equal(sha(path.join(checkpoint, "AgentVN-Dev-before.exe")), baseline.devSha256);
const dev = artifact(path.join(root, "AgentVN Dev.exe"));
const debug = artifact(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
assert.equal(dev.sha256, debug.sha256);
assert(fs.statSync(dev.path).mtimeMs > Date.parse(baseline.createdAt));
assert.match(fs.readFileSync(path.join(out, "dev-build.log"), "utf8"), /\[AgentVN\] Dev container built:/);
const bundled = artifact(path.join(root, "editor/src-tauri/bundle-workspace/shared/cartridge/renpyGui.ts"));
assert.equal(bundled.sha256, sha(path.join(root, "shared/cartridge/renpyGui.ts")));
const backend = artifact(path.join(root, "editor/src-tauri/binaries/creator-backend.exe"));
assert.equal(backend.sha256, "920dc21854eefadfa62f3ffe1fd545e7bfa58dee99e7b982b4836e44a42912e0");
const frozen = artifact("F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe");
assert.equal(frozen.sha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
const receipt = { status: "SCOPED_GUI_STATIC_IMPORT_PASS_AND_DEV_OVERWRITTEN", notOverallAcceptance: true,
  createdAt: new Date().toISOString(), checkpoint, evidence, modelSubmissions: 0,
  products: { dev, debug, bundled, backend, frozenInstalledUnchanged: frozen },
  changedProduct: artifact(path.join(root, "shared/cartridge/renpyGui.ts")),
  logs: ["renpy-gui-import-contract-test.cjs.log", "renpy-gui-archive-scan-test.cjs.log",
    "renpy-gui-import-apply-test.cjs.log", "renpy-gui-import-roundtrip-test.cjs.log",
    "editor-workspace-contract.cjs.log", "editor-typecheck.log", "editor-build.log", "gamecli-build.log", "dev-build.log"]
    .map(file => artifact(path.join(out, file))),
  limitations: [
    "Source/browser import + persistence and static Runtime unpack only; no new installed Release or player GUI acceptance.",
    "The original frozen G14 failure and all full-regression results remain unchanged.",
    "Mobile/conditional/function/screen assignments are explicitly unimported; Python is not executed or interpreted.",
    "Headless 4K reimport motion sampling failed twice, including serial. Headful replay passed unchanged assertions; headless rendering remains unresolved, no motion/performance fix is claimed.",
    "First headful suite had six product passes but preload receipt collided in forked worker; command failed. Fixed evidence collector then clean serial headful confirmation is separate evidence.",
    "Initial official roundtrip harness failed due missing explicit loader limits; original tool failure retained.",
    "Unused-resource export pruning, native directory selection, new Windows/Android exports and final user project remain outside this slice.",
  ] };
fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, browserAssertions: 48, parserCases: 16,
  devSha256: dev.sha256, frozenInstalledUnchanged: true }));
