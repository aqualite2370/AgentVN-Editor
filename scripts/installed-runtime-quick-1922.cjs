"use strict";
// Own exactly one current installed quick-exception run and always restore profiles.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { observeStoryTree } = require("./lib/runtime-story-observer.cjs");
const { validateQuickPreparation } = require("./lib/installed-runtime-quick-1922-preparation.cjs");
const { validateQuickReport } = require("./native-runtime-quick-audit.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
async function main() {
  const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
  const smoke = process.argv.includes("--smoke");
  const out = path.join(base, `installed-quick-1922-${attempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), out, smoke,
    scope: "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_QUICK_EXCEPTIONS",
    productChanges: 0, builds: 0, modelRequests: 0, normalCloseClaimed: false,
    commands: [], knownProcesses: [], observerTransients: [],
    limitations: ["Public native library preparation, not file picker", "Sharing denial, not ACL",
      "Explicit Codex temporary physical Roaming, not unisolated default profile",
      "Owned process termination, not normal close", "Library, not standalone/setup/Android",
      "Real WebView viewport emulation, not physical4K", "Synthetic semantic corruption is controlled fault injection"] };
  const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(r, null, 2));
  let prepared = false, raw;
  const known = new Map();
  async function command(exe, args, label, env = process.env, observe = false) {
    const c = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING",
      log: path.join(out, label + ".log") };
    r.commands.push(c); save();
    const fd = fs.openSync(c.log, "wx"); let timer;
    function sample() {
      const file = path.join(out, "player-01.json");
      if (!fs.existsSync(file)) return;
      let value; try { value = read(file); } catch { return; }
      const all = rows();
      for (const launch of value.launches) {
        const result = observeStoryTree(all, launch, known, r.executable.path);
        if (result.transient) r.observerTransients.push({ ...result, at: new Date().toISOString() });
      }
      r.knownProcesses = [...known.values()]; save();
    }
    try {
      const child = spawn(exe, args, { cwd: path.resolve(__dirname, ".."), env,
        windowsHide: true, stdio: ["ignore", fd, fd] });
      c.pid = child.pid; save();
      if (observe) timer = setInterval(() => {
        try { sample(); } catch (e) { r.observerError = String(e.stack || e); save(); }
      }, 3000);
      c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      c.status = c.exitCode === 0 ? "PASS" : "FAILED"; if (observe) sample();
      return c;
    } finally { clearInterval(timer); fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
  }
  const profile = async action => {
    const c = await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out,
      "-CodexCacheView", "-Storage", "NativeRoaming"], `profile-${action.toLowerCase()}`);
    assert.equal(c.exitCode, 0, c.log);
  };
  try {
    save(); r.checkpoint = desc("F:/AgentVN/Checkpoints/Installed-Runtime-Quick-1922-20261023-01/report.json");
    r.protectedProducts = read(r.checkpoint.path).products;
    for (const f of r.protectedProducts) assert.equal(sha(f.path), f.sha256);
    r.installation = desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json");
    const installed = read(r.installation.path);
    assert.equal(installed.status, "PASS"); assert.equal(installed.version, "1.9.22");
    for (const f of [installed.executable, ...installed.resources, installed.originalAudit, installed.originalInstallation])
      assert.equal(sha(f.path), f.sha256);
    r.executable = desc(path.join(installed.installRoot, "agentvn-player.exe"));
    r.originalExport = desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json");
    const exported = read(r.originalExport.path);
    r.originalFixture = desc(path.join(exported.out, "fixture.json"));
    const input = path.join(out, "快存异常隔离工程.vnproj");
    fs.copyFileSync(exported.fixture.input, input, fs.constants.COPYFILE_EXCL);
    r.fixture = { ...exported.fixture, input }; r.cartridges = exported.cartridges;
    r.environment = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out };
    const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
    r.tools = [__filename, "scripts/lib/installed-runtime-session.cjs",
      "scripts/lib/installed-runtime-quick-1922-preparation.cjs", "scripts/lib/runtime-story-observer.cjs",
      "scripts/installed-runtime-quick-gaps-playwright.cjs", "scripts/installed-runtime-quick-gaps-lock.ps1",
      "scripts/installed-runtime-quick-observation.cjs", "scripts/native-runtime-quick-audit.cjs",
      "scripts/lib/current-native-capture.cjs", "scripts/native-dev-preview-profile.ps1"].map(file => {
      const f = desc(file), copy = path.join(out, "tools", path.basename(file));
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(f.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...f, copy };
    });
    assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
    prepared = true; await profile("Prepare");
    const journal = read(path.join(out, "profile-protection.json"));
    const prep = { status: "PASS", current1922Library: true, sessionRoot: out,
      defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
      executable: r.executable, installation: r.installation, originalExport: r.originalExport,
      originalFixture: r.originalFixture, fixture: r.fixture, cartridges: r.cartridges,
      profiles: journal.records.filter(p => p.existed), allProfiles: journal.records,
      installId: `qa_current_quick_1922_${attempt}`, webview: path.join(out, "webview"), temporary };
    validateQuickPreparation(prep, out);
    const prepFile = path.join(out, "preparation.json");
    fs.writeFileSync(prepFile, JSON.stringify(prep, null, 2), { flag: "wx" }); r.preparation = desc(prepFile);
    const result = await command(process.execPath, ["scripts/installed-runtime-quick-gaps-playwright.cjs",
      "--current-native-preparation", prepFile, ...(smoke ? ["--smoke"] : [])], "quick",
    { ...process.env, ...r.environment, TEMP: temporary, TMP: temporary }, true);
    const rawFile = path.join(out, "player-01.json"); r.raw = desc(rawFile); raw = read(rawFile);
    assert(raw.finishedAt && !raw.cleanupError);
    assert(raw.launches.every(l => l.cleanup?.status === "PASS"));
    assert(raw.locks.every(l => l.cleanup === "PASS")); assert(raw.faults.every(f => f.restoration === "PASS"));
    assert(!r.observerError, r.observerError);
    assert.equal(result.exitCode, 0, JSON.stringify(raw.cells.map(c => ({ name: c.name, status: c.status,
      error: c.error, checks: c.checks.filter(c => c.status !== "PASS") }))));
    validateQuickReport(raw, smoke ? 1 : 12, { current1922: true });
    r.status = "PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
      if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore"); r.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(r.restoration.path).status, "PASS");
      }
      if (fs.existsSync(path.join(out, "player-01.json"))) {
        raw = read(path.join(out, "player-01.json")); r.raw = desc(path.join(out, "player-01.json"));
        r.absentPorts = raw.launches.map(l => l.port); assert.deepEqual(listeners(r.absentPorts), []);
        assert(raw.locks.every(l => l.cleanup === "PASS") && raw.faults.every(f => f.restoration === "PASS"));
      }
      for (const f of [...r.protectedProducts || [], ...r.tools || [], ...r.cartridges || []])
        assert.equal(sha(f.path), f.sha256);
      const all = rows();
      for (const p of known.values()) assert(!all.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
    } catch (e) { r.status = "FAILED"; r.cleanupError = String(e.stack || e); process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, smoke, error: r.error, cleanupError: r.cleanupError }));
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
