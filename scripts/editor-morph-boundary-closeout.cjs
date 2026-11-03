"use strict";
// Audit source evidence without rewriting the frozen installed failure.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { gunzipSync } = require("node:zlib");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Editor-Morph-Bounds-20261019-01";
const checkpoint = "F:/AgentVN/Checkpoints/Editor-Morph-Bounds-20261019-01";
const out = path.join(root, "output/editor-morph-bounds-20261019-01");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const hash = p => sha(fs.readFileSync(p));
const receipt = { at: new Date().toISOString(), status: "RUNNING", layer: "Editor",
  productChanges: 0, newBuilds: 0, modelSubmissions: 0, checks: [], runs: [], historicalReplay: [] };
function check(name, condition, detail) {
  receipt.checks.push({ name, status: condition ? "PASS" : "FAILED", detail });
}
for (const name of ["baseline-full-01", "interaction-full-01"]) {
  const file = path.join(qa, name, "report.json"), r = read(file);
  const run = { path: file, sha256: hash(file), status: r.status, episodes: 0, assertions: 0, frames: 0 };
  receipt.runs.push(run);
  check(`${name}: complete nonempty matrix and cleanup`,
    r.status === "PASS" && r.cases.length === 12 && r.cleanupSurvivors.length === 0
      && r.modelSubmissions === 0 && r.finishedAt && r.service.processes.length >= 2);
  const combinations = new Set();
  for (const c of r.cases) {
    combinations.add(`${c.width}/${c.height}/${c.dpr}/${c.reduced}`);
    assert.equal(c.status, "PASS");
    assert.equal(c.paths.length, 2);
    const png = fs.readFileSync(c.screenshot.path);
    assert.equal(sha(png), c.screenshot.sha256);
    assert.equal(png.readUInt32BE(16), c.width * c.dpr);
    assert.equal(png.readUInt32BE(20), c.height * c.dpr);
    for (const p of c.paths) {
      run.episodes++; run.assertions += p.checks.length;
      assert.equal(p.status, "PASS");
      assert(p.checks.length >= 10 && p.checks.every(c => c.status === "PASS"));
      const bytes = fs.readFileSync(p.trace.path);
      assert.equal(sha(bytes), p.trace.sha256);
      const trace = JSON.parse(gunzipSync(bytes));
      assert(trace.frames.length >= 3 && !trace.limitReached);
      run.frames += trace.frames.length;
      // Same boundary oracle as the live regression; never infer from screenshots.
      assert(trace.frames.every(f => !f.panel || !f.inspector
        || f.panel.rect.right <= f.inspector.rect.left + 1));
      assert(trace.frames.every(f => !f.inspectorOverlapHit?.belongsToPanel));
      assert(trace.frames.every(f => !f.pageHidden && f.visibilityState === "visible"));
      if (name === "interaction-full-01" && p.from === p.target) {
        assert.equal(p.reverseDuringRunningMorph, true);
        assert(trace.events.some(e => e.name === "WAAPI" && e.type === "cancel"));
      }
    }
  }
  check(`${name}: twelve unique combinations,24 episodes,raw bytes verified`,
    combinations.size === 12 && run.episodes === 24);
  assert.equal(hash(path.join(path.dirname(file), "executed-test.cjs")), r.testSha256);
}
const maskFile = path.join(qa, "mask-related-01/report.json"), mask = read(maskFile);
check("Related1080pDPR1reduced selection-mask pointer/keyboard/redirect nine cases",
  mask.status === "PASS" && mask.cases.length === 9
    && mask.cases.every(c => c.failures.length === 0) && mask.cleanup.status === "PASS",
  { path: maskFile, sha256: hash(maskFile), note: "Single combination,not full12 mask matrix" });
const oldFile = path.join(root, "output/installed-editor-motion-20261018-01/motion-01/report.json");
const oldBefore = hash(oldFile), old = read(oldFile);
for (const c of old.matrix.filter(c => c.reduced)) {
  for (const e of c.episodes.filter(e =>
    ["tab-assets-to-library", "tab-animation-to-providers"].includes(e.name))) {
    const bytes = fs.readFileSync(e.trace.path);
    assert.equal(sha(bytes), e.trace.sha256);
    const trace = JSON.parse(gunzipSync(bytes));
    const maximum = Math.max(0, ...trace.frames.map(f =>
      f.panel && f.inspector ? f.panel.rect.right - f.inspector.rect.left : 0));
    receipt.historicalReplay.push({ width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced,
      name: e.name, trace: e.trace, status: maximum > 1 ? "EXPECTED_FAILED" : "UNEXPECTED_PASS",
      maximumOverlap: maximum });
  }
}
check("Same geometry oracle detects all12 original installed failures; historical report unchanged",
  receipt.historicalReplay.length === 12
    && receipt.historicalReplay.every(r => r.status === "EXPECTED_FAILED")
    && old.status === "FAILED" && hash(oldFile) === oldBefore,
  { path: oldFile, sha256: oldBefore, note: "Historical replay,not new installed execution" });
const saved = read(path.join(checkpoint, "manifest.json"));
const productFiles = saved.files.filter(f => !["AGENTS.md", "plans/ACTIVE_TASKS.md"].includes(f.relative));
check("All eight checkpointed product files unchanged",
  productFiles.length === 8 && productFiles.every(f => hash(path.join(root, f.relative)) === f.sha256));
const dev = path.join(root, "AgentVN Dev.exe");
const debug = path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe");
receipt.dev = { path: dev, sha256: hash(dev), debugPath: debug, debugSha256: hash(debug),
  updatedThisSlice: false, note: "HOST-03 build retained; no new native G12 acceptance" };
check("Previous fully built rootDev/debug retained and identical",
  receipt.dev.sha256 === saved.dev.sha256 && receipt.dev.sha256 === receipt.dev.debugSha256);
const frozen = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe";
receipt.frozen = { path: frozen, sha256: hash(frozen), g12Status: "FAILED" };
check("Frozen installed candidate unchanged",
  receipt.frozen.sha256 === "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
receipt.status = receipt.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
receipt.unverified = ["New nativeDev G12", "New installedRelease G12", "Other Editor paths",
  "Runtime motion", "Windows/Android exports", "Complete18-group regression"];
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
console.log(JSON.stringify(receipt, null, 2));
if (receipt.status !== "PASS") process.exitCode = 1;
