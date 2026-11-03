"use strict";
// Three actual native launches, no cartridge import or story replay.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { waitNativeRuntimePage } = require("./lib/wait-native-runtime-page.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/startup-probe-1924-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const installation = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const installed = read(installation);
const executable = installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out,
  scope: "ACTUAL_INSTALLED_STARTUP_TARGET_DIAGNOSIS_NOT_BUSINESS_ACCEPTANCE",
  installation: { path: installation, sha256: sha(installation) }, executable,
  productChanges: 0, builds: 0, modelRequests: 0, launches: [], commands: [], knownProcesses: [],
  tools: [__filename, "scripts/lib/wait-native-runtime-page.cjs"].map(file => ({ path: file, sha256: sha(file) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const known = new Map();
let child, browser, current, prepared = false;
function remember() {
  const all = rows();
  if (child && current) for (const p of ownedProcessTree(all, child.pid, current.identity.Created))
    known.set(`${p.ProcessId}:${p.Created}`, p);
  report.knownProcesses = [...known.values()]; save();
}
function profile(action) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/native-dev-preview-profile.ps1",
    "-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"];
  const r = spawnSync("powershell.exe", args, { cwd: path.resolve(__dirname, ".."),
    windowsHide: true, encoding: "utf8", timeout: 45000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  report.commands.push({ command: ["powershell.exe", ...args], exitCode: r.status }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function stop() {
  if (!child) return;
  remember(); await browser?.close().catch(() => {}); browser = null;
  for (const p of [...known.values()].reverse()) {
    if (rows().some(a => a.ProcessId === p.ProcessId && a.Created === p.Created)) stopOwnedProcess(p, ps);
  }
  await until(() => !rows().some(p => known.has(`${p.ProcessId}:${p.Created}`)) &&
    listeners([current.port]).length === 0, "exact startup-probe ownership cleanup", 15000);
  current.cleanup = { status: "PASS", method: "OWNED_TERMINATION_NOT_NORMAL_CLOSE" };
  child = null; save();
}
(async () => {
  save(); assert.equal(installed.status, "PASS"); assert.equal(installed.executable.version, "1.9.24");
  for (const f of [installed.executable, ...installed.resources, ...installed.protectedFiles]) assert.equal(sha(f.path), f.sha256);
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.mkdirSync(path.join(out, "temporary")); prepared = true; profile("Prepare");
  for (let index = 1; index <= 3; index++) {
    const port = await new Promise(resolve => {
      const s = net.createServer(); s.listen(0, "127.0.0.1", () => {
        const p = s.address().port; s.close(() => resolve(p));
      });
    });
    assert.deepEqual(listeners([port]), []);
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(k)) delete env[k];
    Object.assign(env, { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"), TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") });
    const fd = fs.openSync(path.join(out, `player-${index}.log`), "wx");
    try { child = spawn(executable.path, ["--mode", "library"], { cwd: path.dirname(executable.path),
      env, windowsHide: true, stdio: ["ignore", fd, fd] }); } finally { fs.closeSync(fd); }
    current = { index, pid: child.pid, port, status: "RUNNING", startedAt: new Date().toISOString(),
      identity: rows().find(p => p.ProcessId === child.pid), events: [] };
    assert(current.identity); report.launches.push(current); remember();
    const deadline = Date.now() + 45000; let online = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try { online = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (online) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(online, `Endpoint never became ready, exit=${child.exitCode}`); current.endpointAt = new Date().toISOString();
    current.initialTargets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    current.legacySelection = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"))?.url() || null;
    const page = await waitNativeRuntimePage(browser, { observe: event => {
      current.events.push({ at: new Date().toISOString(), ...event }); save();
    } });
    current.readyURL = page.url();
    await page.getByTestId("game-state-library").waitFor({ timeout: 20000 });
    current.readyTitle = await page.title(); current.pageErrors = [];
    page.on("pageerror", error => current.pageErrors.push(String(error)));
    current.targetsWhenReady = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    current.status = "PASS"; current.readyAt = new Date().toISOString(); remember();
    const portOwners = listeners([port]);
    assert.equal(portOwners.length, 1); assert([...known.values()].some(p => p.ProcessId === portOwners[0].OwningProcess));
    current.portOwners = portOwners;
    await stop();
    console.log(JSON.stringify({ launch: index, status: current.status, legacySelection: current.legacySelection,
      navigationEvents: current.events.length }));
  }
  assert.equal(report.launches.length, 3); report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  try {
    await stop();
    if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore"); report.restoration = read(path.join(out, "profile-restoration.json"));
      assert.equal(report.restoration.status, "PASS");
    }
    assert.equal(sha(executable.path), executable.sha256);
    assert(!rows().some(p => known.has(`${p.ProcessId}:${p.Created}`)));
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
