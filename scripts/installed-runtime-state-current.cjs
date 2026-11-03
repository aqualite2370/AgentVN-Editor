"use strict";
// Reuse the established business flow against an exact, actually installed
// Player. Historical UI exports remain explicitly historical test inputs.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, "..");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const installationFile = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json";
const checkpointRoot = "F:/AgentVN/Checkpoints/Installed-Runtime-State-20261021-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
function validate(r, flow, cross) {
  assert.equal(r.status, "PASS"); assert.equal(r.version, "1.9.14"); assert(r.finishedAt);
  assert.equal(r.scope, "ACTUAL_NSIS_INSTALLED_PLAYER_LIBRARY_STATE_HISTORICAL_UI_EXPORTS");
  assert.equal(r.productsChanged, 0); assert.equal(r.modelRequests, 0); assert.equal(r.builds, 0);
  assert(!r.error && !r.cleanupError);
  assert.deepEqual(r.commands.map(c => c.label), ["profile-prepare", "flow", "cross-layout", "profile-restore"]);
  assert(r.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  assert.equal(r.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
  assert(r.executable.path.startsWith(path.resolve(read(r.installation.path).installRoot) + path.sep));
  const expected = ["agentvn", "renpy"].flatMap(layout => [1920, 2560, 3840].flatMap(width =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ layout, width, height: width * 9 / 16, dpr, reduced })))));
  assert.deepEqual(flow.matrix.map(({ layout, width, height, dpr, reduced }) =>
    ({ layout, width, height, dpr, reduced })), expected);
  assert(flow.matrix.every(c => c.status === "PASS")); assert.deepEqual(cross.matrix, flow.matrix);
  assert.equal(flow.checks.length, 15); assert.equal(cross.checks.length, 1);
  assert.equal(flow.launches.length, 2); assert.equal(cross.launches.length, 1);
  assert.equal(flow.screenshots.length, 33); assert.equal(cross.screenshots.length, 2);
  for (const f of [flow, cross]) {
    assert.equal(f.status, "PASS"); assert.equal(f.exe.path, r.executable.path);
    assert.equal(f.exe.sha256, r.executable.sha256);
    assert(f.checks.every(c => c.status === "PASS")); assert.deepEqual(f.pageErrors, []);
    assert(!f.error && !f.cleanupError); assert.equal(f.realModelRequests, 0); assert.equal(f.productChanges, 0);
    assert(f.launches.every(l => l.cleanup.status === "PASS" && l.libraryStorage === "PHYSICAL_DEFAULT_PATH"));
  }
  assert.equal(cross.reusedMatrix.path, path.join(r.out, "flow/report.json"));
  assert.equal(cross.reusedMatrix.sha256, sha(cross.reusedMatrix.path)); assert(cross.reusedMatrix.matrixOnly);
  const d = cross.checks[0].detail;
  assert(d.realPlayerRestart && !d.nativePickerClaim && !d.standaloneExeSaveLocationClaim && !d.storage.portable);
  assert.equal(d.files.length, 10); assert.equal(d.before.length, 10);
  return d;
}
async function main() {
  const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
  const out = path.join(base, `installed-state-current-${attempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const checkpoint = path.join(checkpointRoot, `session-${attempt}`);
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.14", out,
    scope: "ACTUAL_NSIS_INSTALLED_PLAYER_LIBRARY_STATE_HISTORICAL_UI_EXPORTS",
    productsChanged: 0, modelRequests: 0, builds: 0, commands: [], snapshots: [],
    limitations: ["Library, not standalone/setup", "No new Editor export", "API library insertion, not native picker",
      "Owned termination, not normal close", "No Android or real model", "Business 1080p DPR1; display matrix 24",
      "No audio fixture or new listening claim", "Quick error/concurrency paths not run by this flow"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  const env = { ...process.env, AGENTVN_WORKSPACE_OUTPUT: out };
  let protectedProfiles = false;
  async function command(exe, args, label) {
    const row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING",
      log: path.join(out, `${label}.log`) }; r.commands.push(row); save();
    const fd = fs.openSync(row.log, "wx");
    try {
      const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
      row.pid = child.pid; save();
      row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      row.status = row.exitCode === 0 ? "PASS" : "FAILED";
      assert.equal(row.exitCode, 0, `${label}: ${row.log}`);
    } finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
  }
  const profile = action => command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out,
    "-Storage", "NativeRoaming"], `profile-${action.toLowerCase()}`);
  try {
    r.installation = desc(installationFile); const installation = read(installationFile);
    assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, r.version);
    r.executable = desc(path.join(installation.installRoot, "agentvn-player.exe"));
    assert.equal(r.executable.sha256, installation.resources.find(f => path.resolve(f.path) === r.executable.path).sha256);
    assert.equal(r.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
    // Exact user/database/frozen/current-product identities already enumerated by
    // the preceding acceptance; keep all of them protected in this session.
    const prior = read("F:/AgentVN/QA/Installed-Assistant-Recovery-20261021-01/session-03/report.json");
    r.protectedFiles = prior.products;
    for (const f of r.protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
    for (const name of ["scripts/installed-runtime-state-current.cjs", "scripts/installed-runtime-abilities-playwright.cjs",
      "scripts/native-dev-preview-profile.ps1", "scripts/lib/current-native-capture.cjs",
      "scripts/lib/owned-process-tree.cjs", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
      const file = path.join(root, name), copy = path.join(checkpoint, name);
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
      r.snapshots.push({ source: desc(file), copy: desc(copy) });
    }
    r.originalExport = desc(path.join(root, "output/installed-runtime-abilities-20261018-01/export-03/report.json"));
    r.originalFixture = desc(path.join(root, "output/installed-runtime-abilities-20261018-01/fixtures-02.json"));
    const exported = read(r.originalExport.path), fixture = read(r.originalFixture.path);
    assert.equal(exported.status, "PASS"); assert.equal(sha(fixture.input), fixture.inputSha256);
    const input = path.join(out, "剧情状态隔离工程.vnproj");
    fs.copyFileSync(fixture.input, input, fs.constants.COPYFILE_EXCL);
    env.AGENTVN_TEST_PROJECT = input; r.isolation = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out };
    const cartridges = exported.cartridges.map(c => {
      assert.equal(sha(c.path), c.sha256);
      const copy = path.join(out, `${c.layout}.vncart`); fs.copyFileSync(c.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...c, historicalSource: c.path, path: copy };
    }); r.cartridges = cartridges;
    assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
    protectedProfiles = true; await profile("Prepare");
    const journal = read(path.join(out, "profile-protection.json"));
    const prep = { status: "PASS", sessionRoot: out, executable: r.executable, originalExport: r.originalExport,
      originalFixture: r.originalFixture, defaultStorage: "PHYSICAL_DEFAULT_PATH", fixture: { ...fixture, input },
      profiles: journal.records.filter(p => p.existed), allProfiles: journal.records, cartridges,
      installId: `qa_installed_state_current_20261021_${attempt}`,
      webview: path.join(out, "webview"), temporary: path.join(out, "temporary") };
    fs.mkdirSync(prep.temporary); const prepFile = path.join(out, "preparation.json");
    fs.writeFileSync(prepFile, JSON.stringify(prep, null, 2), { flag: "wx" });
    await command(process.execPath, ["scripts/installed-runtime-abilities-playwright.cjs", path.join(out, "flow"),
      "--current-native-preparation", prepFile], "flow");
    await command(process.execPath, ["scripts/installed-runtime-abilities-playwright.cjs", path.join(out, "cross-layout"),
      "--current-native-preparation", prepFile, "--native-matrix-source", path.join(out, "flow/report.json"),
      "--cross-layout-only"], "cross-layout");
    r.status = "PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      // Refuse restoring original profiles while any Player or this session's
      // WebView still exists. Never broaden cleanup to unrelated processes.
      const live = rows().filter(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out));
      assert.deepEqual(live, [], "Player/owned WebView still alive; profile restore must wait");
      if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore"); r.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(r.restoration.path).status, "PASS");
      }
      for (const f of r.protectedFiles || []) assert.equal(sha(f.path), f.sha256, f.path);
      if (r.status === "PASS") {
        const f = read(path.join(out, "flow/report.json")), c = read(path.join(out, "cross-layout/report.json"));
        r.finishedAt = new Date().toISOString(); validate(r, f, c);
        const ports = [...f.launches, ...c.launches].map(l => l.cdpPort);
        assert.deepEqual(listeners(ports), []); r.absentPorts = ports;
      }
    } catch (e) { r.status = "FAILED"; r.cleanupError = String(e.stack || e); process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error, cleanupError: r.cleanupError }));
  }
}
module.exports = { validate };
if (require.main === module) main();
