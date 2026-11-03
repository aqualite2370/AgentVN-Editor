"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const input = process.argv[2];
assert(input, "Pass the completed E2 gate report path");
const gateFile = path.resolve(input);
const gates = JSON.parse(fs.readFileSync(gateFile, "utf8"));
assert.equal(gates.status, "EDITOR_E2_DEV_GATES_PASS", "Do not create delivery evidence for incomplete gates");
const output = path.join(path.dirname(gateFile), "delivery-evidence.json");
assert(!fs.existsSync(output), "Refusing to overwrite evidence");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function walk(relative) {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), `Unexpected link in source evidence: ${relative}/${entry.name}`);
    const next = `${relative}/${entry.name}`;
    return entry.isDirectory() ? walk(next) : [next];
  });
}
const report = { scope: "Editor E2 Dev delivery and bundled source verification; not installed Release or Android",
  status: "RUNNING", gates: gateFile, checkedAt: new Date().toISOString() };
try {
  const version = JSON.parse(fs.readFileSync(path.join(root, "editor/src-tauri/tauri.conf.json"))).version;
  const bundledVersion = JSON.parse(fs.readFileSync(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json")));
  assert.equal(bundledVersion.editorVersion, version);
  const buildScripts = JSON.parse(fs.readFileSync(path.join(root, "scripts/standalone-build-scripts.json"))).scripts;
  const files = [...walk("GameCli_framework/src"), ...walk("shared"),
    ...buildScripts.map(script => `scripts/${script}`)];
  assert(files.length > 0, "Empty resource evidence is invalid");
  report.resources = collectStageResourceEvidence(root, files);
  report.resourceCount = report.resources.bundled.length;
  report.version = { editor: version, bundled: bundledVersion.editorVersion };
  for (const [file, expected] of Object.entries(gates.sourceHashes))
    assert.equal(sha(path.join(root, file)), expected, `Verified E2 source changed: ${file}`);
  const executable = path.join(root, "AgentVN Dev.exe");
  assert.equal(sha(executable), gates.dev.sha256);
  assert.equal(sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), gates.dev.sha256);
  report.dev = { ...gates.dev, bytes: fs.statSync(executable).size };
  report.frontendDist = walk("editor/dist").map(file => ({
    path: file, sha256: sha(path.join(root, file)), bytes: fs.statSync(path.join(root, file)).size,
  }));
  const player = path.join(root, "editor/src-tauri/binaries/agentvn-player.exe");
  const playerHash = sha(player);
  assert.equal(playerHash, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
  report.player = { path: player, sha256: playerHash, modifiedAt: fs.statSync(player).mtime.toISOString() };
  const nativeFile = path.join(path.dirname(gateFile), "editor-workspace-native-motion-playwright/evidence/report.json");
  const native = JSON.parse(fs.readFileSync(nativeFile));
  assert.equal(native.status, "PASS");
  assert.equal(native.results.length, 10, "Expected actual window plus nine high-resolution WebView modes");
  assert.equal(native.cleanup.remainingOwnedProcesses.length, 0);
  report.native = { report: nativeFile, status: native.status, browser: native.browser,
    actualWindowViewport: native.actualWindowViewport, cleanup: native.cleanup, loveChat: native.loveChat,
    geometryScope: "CDP logical viewport emulation inside actual WebView2; not physical 4K or installed Release" };
  report.remaining = [
    "Independent love-chat route remains unverified; no similar feature substituted.",
    "Same-build native pre-fix timing comparison is historical reference only.",
    "Installed Release and Windows/Android end-to-end acceptance remain outside this E2 gate report.",
    "All historical feature items remain tracked in plans/ACTIVE_TASKS.md.",
  ];
  report.status = "PASS_WITH_RECORDED_SCOPE_LIMITS";
} catch (error) {
  report.status = "FAILED";
  report.error = error.stack;
  process.exitCode = 1;
}
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(`${report.status}: ${output}`);
