"use strict";
// Provenance wrapper only: retain the established raw-frame business oracle.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateReport } = require("./lib/native-runtime-motion-oracle.cjs");
const root = path.resolve(__dirname, "..");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const installationFile = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json";
const checkpointRoot = "F:/AgentVN/Checkpoints/Installed-Runtime-Motion-20261021-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const head = () => {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0); return r.stdout.trim();
};
const guards = ["native-runtime-motion-audit-test.cjs", "native-runtime-state-viewport-test.cjs"];
function validate(s, r) {
  assert.equal(s.status, "PASS"); assert(s.finishedAt); assert.equal(s.version, "1.9.14");
  assert.equal(s.scope, "ACTUAL_NSIS_INSTALLED_PLAYER_LIBRARY_MENU_MOTION");
  assert(!s.error && !s.cleanupError);
  for (const k of ["modelRequests", "builds", "productChanges"]) assert.equal(s[k], 0);
  assert.equal(s.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
  const installed = read(s.installation.path);
  assert.equal(installed.status, "PASS"); assert.equal(installed.executable.version, s.version);
  assert.equal(s.executable.path, path.join(installed.installRoot, "agentvn-player.exe"));
  assert.equal(installed.resources.find(p => path.resolve(p.path) === s.executable.path).sha256, s.executable.sha256);
  assert.deepEqual(s.commands.map(c => c.label),
    [...guards.map(g => `guard-${g}`), "profile-prepare", "motion", "profile-restore"]);
  assert(s.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  validateReport(r, false);
  assert.equal(r.screenshots.length, 24);
  assert(r.launches.every(l => l.executableSha256 === s.executable.sha256 &&
    path.resolve(l.identity.ExecutablePath) === s.executable.path && l.libraryStorage === "PHYSICAL_DEFAULT_PATH"));
  assert.equal(s.gitAfter.head, s.gitBefore.head); assert.equal(s.gitAfter.index, s.gitBefore.index);
  for (const n of ["Editor transitions", "Windows setup/upgrade", "Android native back", "Physical native window close"])
    assert(r.notRun.includes(n));
}
async function main() {
  const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
  const out = path.join(base, `installed-motion-current-${attempt}`), checkpoint = path.join(checkpointRoot, `session-${attempt}`);
  assert(!fs.existsSync(out) && !fs.existsSync(checkpoint));
  fs.mkdirSync(out); fs.mkdirSync(checkpoint, { recursive: true });
  const s = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.14", out, checkpoint,
    scope: "ACTUAL_NSIS_INSTALLED_PLAYER_LIBRARY_MENU_MOTION", commands: [], snapshots: [],
    modelRequests: 0, builds: 0, productChanges: 0,
    limitations: ["Historical actual UI exports, not fresh Editor exports", "Library, not standalone/setup",
      "Public native library import, not OS picker", "Attributed cleanup, not physical native close",
      "No Editor motion, Android, physical4K or real model", "Not all17 preference-control persistence",
      "Not gallery/asset-specific or loader-fault matrix", "Quick-load original dark frame remains a separate open observation"] };
  const save = () => fs.writeFileSync(path.join(out, "installed-session.json"), JSON.stringify(s, null, 2));
  const temporary = path.join(out, "support-temporary"); fs.mkdirSync(temporary);
  const env = { ...process.env, AGENTVN_WORKSPACE_OUTPUT: out, TEMP: temporary, TMP: temporary };
  let protectedProfiles = false;
  async function command(exe, args, label) {
    const row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING",
      log: path.join(out, `installed-${label}.log`) }; s.commands.push(row); save();
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
    s.gitBefore = { head: head(), index: sha(path.join(root, ".git/index")) };
    s.installation = desc(installationFile); const installed = read(installationFile);
    assert.equal(installed.status, "PASS"); assert.equal(installed.executable.version, s.version);
    s.executable = desc(path.join(installed.installRoot, "agentvn-player.exe"));
    assert.equal(s.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
    s.protectedFiles = read("F:/AgentVN/QA/Installed-Assistant-Recovery-20261021-01/session-03/report.json").products;
    for (const f of s.protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
    for (const name of ["scripts/installed-runtime-motion-current.cjs", "scripts/native-runtime-motion-playwright.cjs",
      "scripts/lib/installed-runtime-motion-sampler.cjs", "scripts/lib/native-runtime-motion-oracle.cjs",
      "scripts/native-runtime-motion-audit.cjs", ...guards.map(g => `scripts/${g}`),
      "scripts/lib/installed-runtime-session.cjs", "scripts/lib/current-native-capture.cjs",
      "scripts/native-dev-preview-profile.ps1", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
      const source = path.join(root, name), copy = path.join(checkpoint, name);
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
      s.snapshots.push({ source: desc(source), copy: desc(copy) });
    }
    for (const g of guards) await command(process.execPath, [`scripts/${g}`], `guard-${g}`);
    assert.deepEqual(fs.readdirSync(temporary), []);
    s.originalExport = desc(path.join(root, "output/installed-runtime-abilities-20261018-01/export-03/report.json"));
    s.originalFixture = desc(path.join(root, "output/installed-runtime-abilities-20261018-01/fixtures-02.json"));
    const exported = read(s.originalExport.path), fixture = read(s.originalFixture.path);
    assert.equal(exported.status, "PASS"); assert.equal(sha(fixture.input), fixture.inputSha256);
    const input = path.join(out, "菜单转场隔离工程.vnproj");
    fs.copyFileSync(fixture.input, input, fs.constants.COPYFILE_EXCL); env.AGENTVN_TEST_PROJECT = input;
    s.isolation = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out };
    const cartridges = exported.cartridges.map(c => {
      assert.equal(sha(c.path), c.sha256); const copy = path.join(out, `${c.layout}.vncart`);
      fs.copyFileSync(c.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...c, historicalSource: c.path, path: copy };
    }); s.cartridges = cartridges;
    assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
    protectedProfiles = true; await profile("Prepare");
    const journal = read(path.join(out, "profile-protection.json"));
    const prep = { status: "PASS", sessionRoot: out, executable: s.executable,
      originalExport: s.originalExport, originalFixture: s.originalFixture,
      defaultStorage: "PHYSICAL_DEFAULT_PATH", fixture: { ...fixture, input },
      profiles: journal.records.filter(p => p.existed), allProfiles: journal.records, cartridges,
      installId: `qa_installed_motion_20261021_${attempt}`,
      webview: path.join(out, "webview"), temporary: path.join(out, "temporary") };
    fs.mkdirSync(prep.temporary); const prepFile = path.join(out, "preparation.json");
    fs.writeFileSync(prepFile, JSON.stringify(prep, null, 2), { flag: "wx" });
    await command(process.execPath, ["scripts/native-runtime-motion-playwright.cjs",
      "--current-native-preparation", prepFile], "motion");
    s.status = "PASS";
  } catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      const deadline = Date.now() + 20000; let live;
      do {
        live = rows().filter(p => p.Name === "agentvn-player.exe" ||
          p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out));
        if (!live.length) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      } while (Date.now() < deadline);
      assert.deepEqual(live, [], "Refuse restoring profiles while Player/owned WebView is alive");
      if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore"); s.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(s.restoration.path).status, "PASS");
      }
      for (const f of s.protectedFiles || []) assert.equal(sha(f.path), f.sha256, f.path);
      s.gitAfter = { head: head(), index: sha(path.join(root, ".git/index")) };
      if (s.status === "PASS") {
        s.finishedAt = new Date().toISOString(); const r = read(path.join(out, "motion.json")); validate(s, r);
        s.absentPorts = r.launches.map(l => l.port); assert.deepEqual(listeners(s.absentPorts), []);
      }
    } catch (e) { s.status = "FAILED"; s.cleanupError = String(e.stack || e); process.exitCode = 1; }
    s.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: s.status, out, error: s.error, cleanupError: s.cleanupError }));
  }
}
module.exports = { validate };
if (require.main === module) main();
