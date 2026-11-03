"use strict";
// Re-read completed installed evidence. No app launch, model request or product mutation.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const [receipt, root, output] = process.argv.slice(2);
assert(receipt && root && output);
assert(!fs.existsSync(output), "Preserve previous audit");
const installation = verifiedInstalledCandidate(receipt);
const input = [
  ["window", "f0ae557d293ce99bdaf9f62db975e2df5bd753fd1150f2d241abdb41242d5bf1", 18, 16, 2],
  ["history", "d016dd9bf0d17137909fc5669be28aeea2ff9234789fdb7bf1ff338777ae7f1d", 6, 13, 3],
];
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(), installation,
  checks: [], modelRequests: 0, productChanges: 0, appLaunches: 0,
  limitations: ["Controlled HTTP is not real model quality",
    "Forced restart is not natural native close proof",
    "Window drag test does not independently prove pointercancel",
    "Isolated profiles are not default-account migration or upgrade evidence"],
};
function check(name, fn) {
  try { report.checks.push({ name, status: "PASS", detail: fn() }); }
  catch (e) { report.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
}
const live = rows();
for (const [kind, expectedHash, count, shots, launches] of input) {
  const file = path.join(root, `installed-assistant-${kind}-20261101-01`, "report.json");
  const r = read(file);
  check(`${kind}: terminal evidence and candidate binding`, () => {
    assert.equal(sha(file), expectedHash);
    assert.equal(r.status, "PASS"); assert.deepEqual(r.errors, []);
    const cases = kind === "window" ? r.checks : r.cases;
    assert.equal(cases.length, count);
    assert(cases.every(c => c.status === "PASS"));
    assert.equal(r.launches.length, launches);
    for (const launch of r.launches) {
      assert.equal(launch.executable.sha256, installation.executable.sha256);
      assert.equal(launch.backend.sha256, installation.resources.find(f =>
        path.basename(f.path) === "creator-backend.exe").sha256);
    }
    assert.equal(r.realModelRequests, 0);
    return { file, sha256: expectedHash, checks: count, launches };
  });
  check(`${kind}: twelve actual viewports and immutable PNGs`, () => {
    assert.equal(r.matrix.length, 12);
    const keys = r.matrix.map(m => `${m.width}/${m.height}/${m.dpr}/${m.reduced}`);
    assert.equal(new Set(keys).size, 12);
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true])
        assert(keys.includes(`${width}/${height}/${dpr}/${reduced}`));
    assert(r.matrix.every(m => m.status === "PASS"));
    assert.equal(r.screenshots.length, shots);
    for (const shot of r.screenshots) {
      assert.equal(sha(shot.path), shot.sha256);
      const bytes = fs.readFileSync(shot.path);
      const png = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
      assert.deepEqual(png, shot.png);
      for (const sample of [shot.before, shot.after]) {
        assert(Math.abs(sample.dpr - Math.round(sample.dpr)) < 1e-6);
        assert.equal(png.width, Math.round(sample.width * sample.dpr));
        assert.equal(png.height, Math.round(sample.height * sample.dpr));
      }
      assert.deepEqual(shot.before, shot.after);
    }
    return { combinations: 12, pngs: shots };
  });
  check(`${kind}: owned processes, ports and cleanup`, () => {
    assert.equal(r.cleanups.length, launches);
    assert(r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
    const known = r.knownProcesses ?? r.known ?? [];
    assert(known.length, "Require process identity inventory");
    assert(!known.some(p => live.some(q => p.ProcessId === q.ProcessId && p.Created === q.Created)));
    const ports = [...new Set(r.launches.flatMap(l => l.ports))];
    assert.equal(listeners(ports).length, 0);
    return { ports, processes: known.length };
  });
  if (kind === "history") check("history: credentials, provider and retained native downloads", () => {
    assert.equal(r.credentialsCleared, true);
    assert.equal(r.providerCleanup.stopped, true);
    assert.equal(r.providerCleanup.requests, 3);
    assert.equal(r.blockedModelRequests, 0);
    assert.equal(r.modelBoundary.length, 3);
    assert.equal(r.nativeDownloads.length, 2);
    for (const download of r.nativeDownloads) {
      assert.equal(download.cleaned, true);
      assert(!fs.existsSync(download.source));
      assert.equal(sha(download.target), download.sha256);
    }
    return { controlledHttpRequests: 3, paidRequests: 0, downloadsCleaned: 2 };
  });
}
report.status = report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks, output }));
if (report.status !== "PASS") process.exitCode = 1;
