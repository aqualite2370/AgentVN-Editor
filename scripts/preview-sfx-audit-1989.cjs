"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Preview-Sfx-Release-1989-20261117-01";
const out = path.join(base, "functional-audit.json"); assert(!fs.existsSync(out));
const report = { status: "RUNNING", groups: [], inputHashes: [], modelRequests: 0, builds: 0, productLaunches: 0 };
const read = f => { report.inputHashes.push({ path: f, sha256: sha(f) }); return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); };
function group(name, fn) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = fn(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; row.error = e.stack; throw e; }
}
try {
  group("direct-source-and-browser-nonempty-matrices", () => {
    const rows = [
      ["Gallery-Preview-Options-Direct-20261117-02", 64],
      ["Gallery-Preview-Options-Browser-20261117-05", 24],
      ["Sfx-Stop-Fade-Direct-20261117-03", 23],
      ["Sfx-Stop-Fade-Browser-20261117-05", 12],
    ];
    for (const [name, count] of rows) {
      const r = read(`F:/testavn/${name}/report.json`);
      assert.equal(r.status, "PASS"); assert.equal(r.cases.length, count); assert(r.cases.every(c => c.status === "PASS"));
      assert(r.finishedAt); if (name.includes("Browser")) assert.match(r.cleanup, /STOPPED$/);
    }
    return rows;
  });
  group("backend-strict-roundtrip-tests", () => {
    const r = cp.spawnSync("python", ["-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/test_sfx_stop_fade.py"], {
      cwd: path.join(root, "backend"), encoding: "utf8", windowsHide: true,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 30000,
    });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /14 passed/);
    return { command: r.spawnargs, stdout: r.stdout, stderr: r.stderr };
  });
  group("new-native-artifacts-and-bundled-sources", () => {
    const b = read(path.join(base, "release/build.json"));
    assert.equal(b.version, "1.9.89"); assert.equal(b.runtimeVersion, "0.33.0");
    for (const d of [b.installer, b.dev, b.player, b.backend, b.oldPlayer]) assert.equal(sha(d.path), d.sha256);
    for (const s of b.sources) assert.equal(sha(s.path), s.sha256);
    for (const pair of b.bundledSources) assert.equal(sha(pair.source.path), sha(pair.bundled.path));
    assert.notEqual(b.player.sha256, b.oldPlayer.sha256);
    return { version: b.version, runtime: b.runtimeVersion, installer: b.installer, sourceCount: b.sources.length };
  });
  group("actual-installed-native-cases-not-source-substitutes", () => {
    const r = read("F:/testavn/Windows-Isolated-1989-20261117-01/resource-01/report.json");
    assert.equal(r.status, "PASS"); assert.equal(r.stages.length, 8); assert(r.stages.every(s => s.status === "PASS"));
    assert.equal(r.cleanupStatus, "PASS"); assert(r.finishedAt); assert.deepEqual(r.errors, []);
    assert(r.stages.some(s => s.name === "real-frozen032-rejects-new033-cartridge"));
    return { cases: r.stages.map(s => s.name), boundaries: r.boundaries };
  });
  group("original-git-and-user-project-preserved", () => {
    const c = read(path.join(base, "checkpoint.json"));
    const head = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
    assert.equal(head, c.git.head); assert.equal(sha(c.git.index.path), c.git.index.sha256);
    assert.equal(sha(c.daily.path), c.daily.sha256); assert.equal(sha(c.frozen.installer.path), c.frozen.installer.sha256);
    const userProject = "C:/Users/1/Downloads/隐忍的成长_20261109_003641.vnproj";
    assert.equal(sha(userProject), "35a33a8b074d8aff682d14c634205450c069a307c34f25ac4d4c4ca5016656f3");
    return { head, userProjectReadOnly: true, dailyUnchanged: true };
  });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = e.stack; process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, groups: report.groups.length, error: report.error }));
