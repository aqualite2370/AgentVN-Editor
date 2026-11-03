"use strict";
// Exercise the actual Windows PowerShell boundary, without Prepare/Restore.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { buildCache } = require("./installed-editor-motion-cache.cjs");
const candidate = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
  ? require("./candidate-1924-quick-adapter.cjs").quickCandidate() : null;
const base = candidate?.base || "F:/AgentVN/QA/Editor-1.9.30-20261026-01";
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const out = path.join(base, `motion-cache-guard-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const originalFile = path.resolve(__dirname, "../installed-layout-cache-session.ps1");
const original = fs.readFileSync(originalFile, "utf8"), built = buildCache(original);
const script = path.join(out, "executed-cache.ps1");
fs.writeFileSync(script, built.source, { flag: "wx" });
const report = { status: "RUNNING", cases: [], mutations: 0, productStarts: 0, profileMutations: 0 };
try {
  for (const change of built.adaptations) {
    assert.throws(() => buildCache(original.replace(change.before, "")));
    assert.throws(() => buildCache(original + "\n" + change.before)); report.mutations += 2;
  }
  for (const [run, allowed, expected] of [
    [`${base}/editor-motion-02`, base, 0],
    [`${base}/editor-motion-02/nested`, base, 1],
    [base, base, 1],
    [`${base}/editor-motion-two`, base, 1],
    [`${base}/editor-motion-02`, `${base}-other`, 1],
    [`${base}-other/editor-motion-02`, base, 1],
    [`${base}-other/editor-motion-02`, `${base}-other`, 1],
    ["D:/AgentVN", base, 1],
  ]) {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
      "-Action", "SelfTest", "-RunDirectory", path.resolve(run), "-AllowedRunRoot", path.resolve(allowed)];
    const r = spawnSync("powershell.exe", args, { windowsHide: true, encoding: "utf8" });
    report.cases.push({ run, allowed, expected, actual: r.status, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.status, expected, JSON.stringify(report.cases.at(-1)));
  }
  assert.equal(fs.readFileSync(originalFile, "utf8"), original);
  report.status = "PASS";
} finally {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
}
console.log(JSON.stringify({ status: report.status, realPowerShellCases: report.cases.length,
  sourceDriftRejected: report.mutations, out, profileMutations: 0 }));
