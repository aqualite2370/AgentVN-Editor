"use strict";
// Current installed provenance/isolation wrapper. Product settings are written by real UI only.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateSettings } = require("./lib/runtime-settings-evidence.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const installationFile = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json";
const checkpointRoot = "F:/AgentVN/Checkpoints/Installed-Runtime-Settings-20261021-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
function git() {
  const p = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true, encoding: "utf8" });
  assert.equal(p.status, 0); return { head: p.stdout.trim(), index: sha(path.join(root, ".git/index")) };
}
const guards = ["runtime-settings-evidence-test.cjs", "native-runtime-state-viewport-test.cjs",
  "gamecli-preferences-contract.cjs", "settings-display-mode-contract.cjs", "settings-surface-contract.cjs"];
function validate(s, r) {
  assert.equal(s.status, "PASS"); assert(s.finishedAt); assert.equal(s.version, "1.9.14");
  assert.equal(s.scope, "ACTUAL_NSIS_INSTALLED_PLAYER_ALL17_PREFERENCES");
  assert(!s.error && !s.cleanupError);
  for (const k of ["modelRequests", "builds", "productChanges"]) assert.equal(s[k], 0);
  assert.equal(s.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
  const installed = read(s.installation.path);
  assert.equal(installed.status, "PASS"); assert.equal(installed.executable.version, s.version);
  assert.equal(s.executable.path, path.join(installed.installRoot, "agentvn-player.exe"));
  assert.equal(installed.resources.find(f => path.resolve(f.path) === s.executable.path).sha256, s.executable.sha256);
  assert.deepEqual(s.commands.map(c => c.label), [...guards.map(g => `guard-${g}`), "profile-prepare", "settings", "profile-restore"]);
  assert(s.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  assert.equal(r.currentNative, true);
  validateSettings(r, { executable: s.executable.path, current: true });
  for (const l of r.launches) assert.equal(l.executableSha256, s.executable.sha256);
  assert.deepEqual(s.gitAfter, s.gitBefore);
  for (const name of ["Windows standalone/setup/upgrade", "Android settings/audio", "Physical native window close",
    "Physical 4K display", "New Editor exports", "Full Editor motion", "New audio listening"]) assert(r.notRun.includes(name));
}
async function main() {
  const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
  const out = path.join(base, `installed-settings-current-${attempt}`), checkpoint = path.join(checkpointRoot, `session-${attempt}`);
  assert(!fs.existsSync(out) && !fs.existsSync(checkpoint));
  fs.mkdirSync(out); fs.mkdirSync(checkpoint, { recursive: true });
  const s = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.14", out, checkpoint,
    scope: "ACTUAL_NSIS_INSTALLED_PLAYER_ALL17_PREFERENCES", commands: [], snapshots: [],
    modelRequests: 0, builds: 0, productChanges: 0,
    limitations: ["Historical real UI exports, not new Editor exports", "Library, not standalone/setup/Android",
      "Public native library import, not OS picker", "Real menu-confirmed exit, not physical OS window close",
      "WebView viewport simulation, not physical4K", "No new audio listening or real model", "Not full Editor motion"] };
  const save = () => fs.writeFileSync(path.join(out, "installed-session.json"), JSON.stringify(s, null, 2));
  const temporary = path.join(out, "support-temporary"); fs.mkdirSync(temporary);
  const env = { ...process.env, AGENTVN_WORKSPACE_OUTPUT: out, TEMP: temporary, TMP: temporary };
  let protectedProfiles = false;
  async function command(exe, args, label) {
    const c = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING",
      log: path.join(out, `${label}.log`) }; s.commands.push(c); save();
    const fd = fs.openSync(c.log, "wx");
    try {
      const p = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
      c.pid = p.pid; save();
      c.exitCode = await new Promise((resolve, reject) => { p.once("error", reject); p.once("close", resolve); });
      c.status = c.exitCode === 0 ? "PASS" : "FAILED"; assert.equal(c.exitCode, 0, `${label}: ${c.log}`);
    } finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
  }
  const profile = action => command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out,
    "-Storage", "NativeRoaming"], `profile-${action.toLowerCase()}`);
  try {
    s.gitBefore = git(); s.installation = desc(installationFile);
    const installed = read(installationFile); assert.equal(installed.status, "PASS");
    assert.equal(installed.executable.version, s.version);
    s.executable = desc(path.join(installed.installRoot, "agentvn-player.exe"));
    assert.equal(s.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
    s.protectedFiles = read(path.join(base, "installed-motion-current-01/installed-session.json")).protectedFiles;
    for (const f of s.protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
    for (const name of ["scripts/installed-runtime-settings-current.cjs", "scripts/installed-runtime-settings-playwright.cjs",
      "scripts/lib/runtime-settings-evidence.cjs", "scripts/lib/runtime-settings-proportions.cjs",
      "scripts/lib/installed-runtime-session.cjs", "scripts/lib/current-native-capture.cjs",
      "scripts/native-dev-preview-profile.ps1", ...guards.map(g => `scripts/${g}`),
      "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
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
    const input = path.join(out, "设置持久化隔离工程.vnproj");
    fs.copyFileSync(fixture.input, input, fs.constants.COPYFILE_EXCL);
    env.AGENTVN_TEST_PROJECT = input;
    s.isolation = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out };
    const cartridges = exported.cartridges.map(c => {
      assert.equal(sha(c.path), c.sha256); const copy = path.join(out, `${c.layout}.vncart`);
      fs.copyFileSync(c.path, copy, fs.constants.COPYFILE_EXCL); return { ...c, historicalSource: c.path, path: copy };
    }); s.cartridges = cartridges;
    assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
    protectedProfiles = true; await profile("Prepare");
    const journal = read(path.join(out, "profile-protection.json"));
    const prep = { status: "PASS", sessionRoot: out, executable: s.executable,
      originalExport: s.originalExport, originalFixture: s.originalFixture,
      defaultStorage: "PHYSICAL_DEFAULT_PATH", fixture: { ...fixture, input },
      profiles: journal.records.filter(p => p.existed), allProfiles: journal.records, cartridges,
      installId: `qa_installed_settings_20261021_${attempt}`,
      webview: path.join(out, "webview"), temporary: path.join(out, "temporary") };
    fs.mkdirSync(prep.temporary); const prepFile = path.join(out, "preparation.json");
    fs.writeFileSync(prepFile, JSON.stringify(prep, null, 2), { flag: "wx" });
    await command(process.execPath, ["scripts/installed-runtime-settings-playwright.cjs",
      "--current-native-preparation", prepFile], "settings");
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
