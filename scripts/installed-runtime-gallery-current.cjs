"use strict";
// Current installation wrapper only; actual gallery state is exercised by the native UI runner.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { validateGallery } = require("./lib/runtime-gallery-evidence.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const installationFile = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json";
const checkpointRoot = "F:/AgentVN/Checkpoints/Installed-Runtime-Gallery-20261021-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
function git() {
  const p = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(p.status, 0); return { head: p.stdout.trim(), index: sha(path.join(root, ".git/index")) };
}
const guards = ["runtime-gallery-evidence-test.cjs", "native-runtime-state-viewport-test.cjs",
  "gallery-manifest-test.cjs", "gallery-anchor-runtime-test.cjs", "playback-session-checkpoint-test.cjs"];
function validate(s, r) {
  assert.equal(s.status, "PASS"); assert(s.finishedAt); assert(!s.error && !s.cleanupError);
  assert.equal(s.version, "1.9.14"); assert.equal(s.scope, "ACTUAL_NSIS_INSTALLED_PLAYER_GALLERY_FLOW_AND_FAILURES");
  for (const k of ["productChanges", "modelRequests", "builds"]) assert.equal(s[k], 0);
  const installation = read(s.installation.path);
  assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, s.version);
  assert.equal(s.executable.path, path.join(installation.installRoot, "agentvn-player.exe"));
  assert.equal(s.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
  assert.equal(installation.resources.find(f => path.resolve(f.path) === s.executable.path).sha256, s.executable.sha256);
  assert.deepEqual(s.commands.map(c => c.label), [...guards.map(g => `guard-${g}`), "gallery"]);
  assert(s.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  assert.equal(r.executable.sha256, s.executable.sha256); assert.equal(r.executable.path, s.executable.path);
  assert.deepEqual(r.installation, s.installation);
  validateGallery(r, { installed: true, executable: s.executable.path });
  assert(r.launches.every(l => l.executableSha256 === s.executable.sha256));
  assert.equal(read(r.profileRestoration.path).status, "PASS");
  assert.deepEqual(s.gitAfter, s.gitBefore);
}
async function main() {
  const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
  const out = path.join(base, `installed-gallery-current-${attempt}`);
  const checkpoint = path.join(checkpointRoot, `session-${attempt}`);
  assert(!fs.existsSync(out) && !fs.existsSync(checkpoint));
  fs.mkdirSync(out); fs.mkdirSync(checkpoint, { recursive: true });
  const s = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.14", out, checkpoint,
    scope: "ACTUAL_NSIS_INSTALLED_PLAYER_GALLERY_FLOW_AND_FAILURES", commands: [], snapshots: [],
    productChanges: 0, modelRequests: 0, builds: 0,
    limitations: ["Controlled ZIP derivative of historical actual Editor exports, not fresh gallery export",
      "Library, not standalone/setup/Android", "Public native import, not OS picker",
      "Attributed termination, not normal native close", "No new audio/voice evidence",
      "No trusted legacy serialized gallery sample", "Not full transition matrix or physical4K"] };
  const save = () => fs.writeFileSync(path.join(out, "installed-session.json"), JSON.stringify(s, null, 2));
  const temp = path.join(out, "support-temporary"); fs.mkdirSync(temp);
  const env = { ...process.env, AGENTVN_WORKSPACE_OUTPUT: out, TEMP: temp, TMP: temp };
  async function command(exe, args, label) {
    const row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING",
      log: path.join(out, `${label}.log`) }; s.commands.push(row); save();
    const fd = fs.openSync(row.log, "wx");
    try {
      const p = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
      row.pid = p.pid; save();
      row.exitCode = await new Promise((resolve, reject) => { p.once("error", reject); p.once("close", resolve); });
      row.status = row.exitCode === 0 ? "PASS" : "FAILED"; assert.equal(row.exitCode, 0, `${label}: ${row.log}`);
    } finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
  }
  try {
    s.gitBefore = git(); s.installation = desc(installationFile);
    const installation = read(installationFile); assert.equal(installation.status, "PASS");
    assert.equal(installation.executable.version, s.version);
    s.executable = desc(path.join(installation.installRoot, "agentvn-player.exe"));
    assert.equal(s.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
    s.protectedFiles = read(path.join(base, "installed-settings-current-01/installed-session.json")).protectedFiles;
    for (const f of s.protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
    for (const name of ["scripts/installed-runtime-gallery-current.cjs", "scripts/native-runtime-gallery.cjs",
      "scripts/lib/runtime-gallery-evidence.cjs", "scripts/lib/installed-runtime-session.cjs",
      "scripts/lib/current-native-capture.cjs", "scripts/native-dev-preview-profile.ps1",
      ...guards.map(g => `scripts/${g}`), "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
      const source = path.join(root, name), copy = path.join(checkpoint, name);
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
      s.snapshots.push({ source: desc(source), copy: desc(copy) });
    }
    for (const g of guards) await command(process.execPath, [`scripts/${g}`], `guard-${g}`);
    assert.deepEqual(fs.readdirSync(temp), []);
    assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
    await command(process.execPath, ["scripts/native-runtime-gallery.cjs", attempt, "--rollback",
      "--installed-player", installationFile], "gallery");
    s.status = "PASS";
  } catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      for (const f of s.protectedFiles || []) assert.equal(sha(f.path), f.sha256, f.path);
      s.gitAfter = git();
      if (s.status === "PASS") {
        s.finishedAt = new Date().toISOString(); const r = read(path.join(out, "report.json")); validate(s, r);
        s.absentPorts = r.launches.map(l => l.port); assert.deepEqual(listeners(s.absentPorts), []);
      }
    } catch (e) { s.status = "FAILED"; s.cleanupError = String(e.stack || e); process.exitCode = 1; }
    s.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: s.status, out, error: s.error, cleanupError: s.cleanupError }));
  }
}
module.exports = { validate };
if (require.main === module) main();
