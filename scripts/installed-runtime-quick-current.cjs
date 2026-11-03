"use strict";
// Current actual NSIS installation; retain the existing strict QA lock/profile
// boundaries rather than widening them for a new suite name.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateQuickReport } = require("./native-runtime-quick-audit.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const installationFile = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json";
const checkpointRoot = "F:/AgentVN/Checkpoints/Installed-Runtime-Quick-20261021-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const head = () => {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0); return r.stdout.trim();
};
function validate(session, raw) {
  assert.equal(session.status, "PASS"); assert(session.finishedAt);
  assert.equal(session.scope, "ACTUAL_NSIS_INSTALLED_PLAYER_QUICK_EXCEPTION_MATRIX");
  assert.equal(session.version, "1.9.14"); assert(!session.error && !session.cleanupError);
  for (const k of ["modelRequests", "builds", "productChanges"]) assert.equal(session[k], 0);
  assert.equal(session.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
  const installation = read(session.installation.path);
  assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, session.version);
  assert.equal(path.resolve(session.executable.path), path.join(installation.installRoot, "agentvn-player.exe"));
  assert.equal(installation.resources.find(p => path.resolve(p.path) === path.resolve(session.executable.path)).sha256,
    session.executable.sha256);
  assert.deepEqual(session.commands.map(c => c.label), ["profile-prepare", "quick", "profile-restore"]);
  assert(session.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  validateQuickReport(raw, 12);
  assert(raw.launches.every(l => l.executableSha256 === session.executable.sha256 &&
    path.resolve(l.identity.ExecutablePath) === path.resolve(session.executable.path) &&
    l.libraryStorage === "PHYSICAL_DEFAULT_PATH"));
  assert.equal(session.gitAfter.head, session.gitBefore.head); assert.equal(session.gitAfter.index, session.gitBefore.index);
}
async function main() {
  const attempt = process.argv[2] || "03"; assert.match(attempt, /^\d{2}$/);
  const out = path.join(base, `quick-${attempt}`), checkpoint = path.join(checkpointRoot, `quick-${attempt}`);
  assert(!fs.existsSync(out) && !fs.existsSync(checkpoint));
  fs.mkdirSync(out); fs.mkdirSync(checkpoint, { recursive: true });
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.14",
    scope: "ACTUAL_NSIS_INSTALLED_PLAYER_QUICK_EXCEPTION_MATRIX", out, checkpoint,
    modelRequests: 0, builds: 0, productChanges: 0, commands: [], snapshots: [],
    limitations: ["Historical UI exports, not a fresh Editor export", "Library, not standalone/setup",
      "Read sharing denial, not ACL", "Public native library reseed on restart, not picker",
      "Attributed termination, not normal close", "No Android, physical4K or real model",
      "Renpy quick actions; cross-layout reads evidenced separately"] };
  const save = () => fs.writeFileSync(path.join(out, "installed-session.json"), JSON.stringify(r, null, 2));
  const env = { ...process.env, AGENTVN_WORKSPACE_OUTPUT: out };
  let protectedProfiles = false;
  async function command(exe, args, label) {
    const row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING",
      log: path.join(out, `installed-${label}.log`) }; r.commands.push(row); save();
    const fd = fs.openSync(row.log, "wx");
    try {
      const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
      row.pid = child.pid; save();
      row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      row.status = row.exitCode === 0 ? "PASS" : "FAILED"; assert.equal(row.exitCode, 0, `${label}: ${row.log}`);
    } finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
  }
  const profile = action => command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out,
    "-Storage", "NativeRoaming"], `profile-${action.toLowerCase()}`);
  try {
    r.gitBefore = { head: head(), index: sha(path.join(root, ".git/index")) };
    r.installation = desc(installationFile); const installation = read(installationFile);
    assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, r.version);
    r.executable = desc(path.join(installation.installRoot, "agentvn-player.exe"));
    assert.equal(r.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
    r.protectedFiles = read("F:/AgentVN/QA/Installed-Assistant-Recovery-20261021-01/session-03/report.json").products;
    for (const f of r.protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
    for (const name of ["scripts/installed-runtime-quick-current.cjs", "scripts/installed-runtime-quick-gaps-playwright.cjs",
      "scripts/installed-runtime-quick-gaps-lock.ps1", "scripts/installed-runtime-quick-observation.cjs",
      "scripts/lib/installed-runtime-session.cjs", "scripts/lib/current-native-capture.cjs",
      "scripts/native-runtime-quick-audit.cjs", "scripts/native-dev-preview-profile.ps1",
      "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
      const source = path.join(root, name), copy = path.join(checkpoint, name);
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
      r.snapshots.push({ source: desc(source), copy: desc(copy) });
    }
    r.originalExport = desc(path.join(root, "output/installed-runtime-abilities-20261018-01/export-03/report.json"));
    r.originalFixture = desc(path.join(root, "output/installed-runtime-abilities-20261018-01/fixtures-02.json"));
    const exported = read(r.originalExport.path), fixture = read(r.originalFixture.path);
    assert.equal(exported.status, "PASS"); assert.equal(sha(fixture.input), fixture.inputSha256);
    const input = path.join(out, "快存异常隔离工程.vnproj");
    fs.copyFileSync(fixture.input, input, fs.constants.COPYFILE_EXCL); env.AGENTVN_TEST_PROJECT = input;
    r.isolation = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out };
    const cartridges = exported.cartridges.map(c => {
      assert.equal(sha(c.path), c.sha256); const copy = path.join(out, `${c.layout}.vncart`);
      fs.copyFileSync(c.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...c, historicalSource: c.path, path: copy };
    }); r.cartridges = cartridges;
    assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
    protectedProfiles = true; await profile("Prepare");
    const journal = read(path.join(out, "profile-protection.json"));
    const prep = { status: "PASS", sessionRoot: out, executable: r.executable, originalExport: r.originalExport,
      originalFixture: r.originalFixture, defaultStorage: "PHYSICAL_DEFAULT_PATH", fixture: { ...fixture, input },
      profiles: journal.records.filter(p => p.existed), allProfiles: journal.records, cartridges,
      // Identity only: required by the existing bounded Windows lock helper.
      installId: `qa_native_quick_20261020_${attempt}`,
      webview: path.join(out, "webview"), temporary: path.join(out, "temporary") };
    fs.mkdirSync(prep.temporary); const prepFile = path.join(out, "preparation.json");
    fs.writeFileSync(prepFile, JSON.stringify(prep, null, 2), { flag: "wx" });
    await command(process.execPath, ["scripts/installed-runtime-quick-gaps-playwright.cjs",
      "--current-native-preparation", prepFile], "quick");
    r.status = "PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      const live = rows().filter(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out));
      assert.deepEqual(live, [], "Refuse restoring original profiles while Player/owned WebView is alive");
      if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore"); r.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(r.restoration.path).status, "PASS");
      }
      for (const f of r.protectedFiles || []) assert.equal(sha(f.path), f.sha256, f.path);
      r.gitAfter = { head: head(), index: sha(path.join(root, ".git/index")) };
      if (r.status === "PASS") {
        r.finishedAt = new Date().toISOString(); const raw = read(path.join(out, "player-01.json"));
        validate(r, raw);
        r.absentPorts = raw.launches.map(l => l.port); assert.deepEqual(listeners(r.absentPorts), []);
      }
    } catch (e) { r.status = "FAILED"; r.cleanupError = String(e.stack || e); process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error, cleanupError: r.cleanupError }));
  }
}
module.exports = { validate };
if (require.main === module) main();
