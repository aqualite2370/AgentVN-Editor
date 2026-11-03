"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Editor-1.9.13-20261021-01";
const file = path.join(qa, "terminal-audit-04.json");
assert(!fs.existsSync(file), "Fresh audit only");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const verify = list => { for (const item of list) assert.equal(sha(item.path), item.sha256, item.path); };
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
  scope: "EDITOR_1.9.13_EXE_ONLY_AND_THREE_UI_FIXES_NOT_FULL_PROJECT_ACCEPTANCE" };
function check(name, fn) {
  try { fn(); report.checks.push({ name, status: "PASS" }); }
  catch (e) { report.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
}
const stages = ["check", "dev", "package", "payload", "install"].map(name => read(path.join(qa, `${name}-04/report.json`)));
const [gates, dev, packaged, payload, installed] = stages;
check("Five sealed stage reports and current source", () => {
  for (const stage of stages) {
    assert.equal(stage.status, "PASS");
    assert(stage.commands.length > 0 && stage.commands.every(c => c.exitCode === 0));
    verify(stage.sources);
  }
  assert(gates.references.reason.includes("packaging-only"));
});
check("One actual new EXE and preserved historical EXE/MSI", () => {
  assert.equal(packaged.installerFormat, "nsis"); assert.equal(packaged.installers.length, 1);
  assert(packaged.installers[0].path.endsWith(".exe"));
  verify(packaged.installers); verify(packaged.existingInstallers); verify(packaged.playerSources);
  assert.deepEqual(fs.readdirSync(path.join(root, "editor/src-tauri/target/release/bundle")), ["nsis"]);
});
check("Dev physically replaced and native Player unchanged", () => {
  verify([dev.dev, dev.playerBefore]);
  assert.equal(sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), dev.dev.sha256);
  assert(Date.parse(dev.dev.generatedAt) > Date.parse(dev.startedAt));
});
const installation = read(path.join(qa, "installation.json"));
check("Payload, actual install and protected user files", () => {
  assert.equal(payload.installerFormat, "nsis"); assert.equal(payload.deployments.length, 1);
  assert.equal(installation.status, "PASS"); assert.equal(installation.metadataRestoration, "PASS");
  assert.equal(installation.executable.version, "1.9.13");
  verify([installation.executable, ...installation.resources, ...installation.protectedFiles]);
  assert.equal(installation.executable.sha256, payload.deployments[0].executable.sha256);
  verify(installed.protectedFiles);
});
const uiRoot = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-31", ui = read(path.join(uiRoot, "report.json"));
check("Actual installed WebView 12 cells, two layouts and restart", () => {
  assert.equal(ui.status, "PASS"); assert.equal(ui.matrix.length, 12);
  for (const cell of ui.matrix) {
    assert.equal(cell.status, "PASS"); assert.equal(cell.types.length, 2);
    assert.deepEqual(cell.types.map(t => t.type), ["agentvn", "renpy"]);
    assert.equal(cell.card.hideRestore, "PASS");
  }
  assert.equal(new Set(ui.matrix.map(c => [c.width, c.height, c.dpr, c.reduced].join(":"))).size, 12);
  assert.equal(ui.launches.length, 2); assert.equal(ui.restart.status, "PASS");
  for (const launch of ui.launches) {
    assert.equal(launch.executable.sha256, installation.executable.sha256);
    assert.equal(launch.manualBackendSpawn, false); assert.equal(launch.sourceServer, false);
  }
  assert.equal(ui.modelRequests, 0); assert.deepEqual(ui.errors, []);
});
check("Actual screenshots retain viewport, DPR and byte provenance", () => {
  assert.equal(ui.screenshots.length, 3);
  for (const shot of ui.screenshots) {
    verify([shot]); assert.deepEqual(shot.before, shot.after);
    const bytes = fs.readFileSync(shot.path);
    assert.equal(bytes.readUInt32BE(16), shot.before.width * shot.before.dpr);
    assert.equal(bytes.readUInt32BE(20), shot.before.height * shot.before.dpr);
  }
});
check("Owned processes, ports and native cache restoration", () => {
  assert.equal(ui.nativeCacheRestoration, "PASS");
  assert.equal(read(path.join(uiRoot, "native-cache-restoration.json")).status, "PASS");
  assert.equal(ui.cleanups.length, 2); assert(ui.cleanups.every(c => c.status === "PASS"));
  assert(!ui.cleanupError);
  const live = rows(), known = new Set(ui.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`));
  assert(!live.some(p => known.has(`${p.ProcessId}:${p.Created}`)));
  assert.equal(listeners(ui.launches.flatMap(l => l.ports)).length, 0);
});
report.status = report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.finishedAt = new Date().toISOString();
report.installer = packaged.installers[0]; report.dev = dev.dev;
report.installedUiReport = path.join(uiRoot, "report.json");
report.limits = ["NSIS silent new-directory installation, not normal wizard or upgrade",
  "WebView viewport emulation, not physical 4K display", "Controlled local parsing task, zero model calls",
  "Owned-process restart, not normal native-window close", "No new Windows/Android export or final user-project acceptance"];
fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASS") process.exitCode = 1;
