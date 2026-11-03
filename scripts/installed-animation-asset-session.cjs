"use strict";
// Test-only native session: originals are held/restored, no model or product build.
const fs = require("node:fs"), assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const number = process.argv[2] || "02"; assert(/^0[1-9]$/.test(number));
const base = `D:/AgentVN/output/installed-animation-asset-20261019-${number}`;
const work = `F:/AgentVN/QA/Animation-Asset-20261019-${number}`;
assert(!fs.existsSync(base) && !fs.existsSync(work), "Fresh evidence required");
const env = { ...process.env, AGENTVN_TEST_PROJECT: `${work}/动画素材隔离工程.vnproj`, AGENTVN_WORKSPACE_OUTPUT: base,
  AGENTVN_ANIMATION_ASSET_RUN: base, AGENTVN_ANIMATION_ASSET_WORK: work };
const report = { status: "RUNNING", at: new Date().toISOString(), commands: [], productChanges: 0, modelRequests: 0, newBuilds: 0 };
let prepared = false, launched = false;
const save = () => { if (fs.existsSync(base)) fs.writeFileSync(`${base}/execution.json`, JSON.stringify(report, null, 2)); };
async function run(exe, args, label) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { cwd: "D:/AgentVN", env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const row = { exe, args, label, pid: p.pid, at: new Date().toISOString() }; report.commands.push(row); save();
    const chunks = [];
    for (const stream of [p.stdout, p.stderr]) stream.on("data", b => { chunks.push(b); process.stdout.write(b); });
    p.once("error", reject); p.once("exit", code => {
      row.exitCode = code; row.finishedAt = new Date().toISOString();
      if (fs.existsSync(work)) fs.writeFileSync(`${work}/${label}.log`, Buffer.concat(chunks), { flag: "wx" });
      save(); resolve(code);
    });
  });
}
const profile = action => run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  "scripts/installed-preview-session.ps1", "-Suite", "animation-asset", "-SessionNumber", String(Number(number)), "-Action", action], action.toLowerCase());
const stop = () => run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  "scripts/installed-assistant-recovery-session.ps1", "-Suite", "animation-asset", "-SessionNumber", String(Number(number)),
  "-Action", "StopAll", "-Evidence", "editor-stop"], "editor-stop");
(async () => {
  assert.equal(await profile("Prepare"), 0); prepared = true;
  assert.equal(await profile("Launch"), 0); launched = true;
  const launch = JSON.parse(fs.readFileSync(`${base}/launch.json`, "utf8").replace(/^\uFEFF/, ""));
  const deadline = Date.now() + 60000; let ready = false;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`http://127.0.0.1:${launch.backendPort}/api/health`, { signal: AbortSignal.timeout(1000) });
      const pages = await (await fetch(`http://127.0.0.1:${launch.cdpPort}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
      ready = health.ok && pages.some(p => p.type === "page" && p.url.includes("tauri.localhost"));
    } catch {}
    if (ready) break; await new Promise(r => setTimeout(r, 100));
  }
  assert(ready, "Owned packaged backend and actual application page must both be ready before Observe");
  assert.equal(await profile("Observe"), 0);
  assert.equal(await run(process.execPath, ["scripts/installed-animation-asset-probe.cjs"], "probe"), 0);
  const probe = JSON.parse(fs.readFileSync(`${base}/probe.json`, "utf8"));
  report.status = probe.status; report.consumerConclusion = probe.consumerConclusion;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  for (const [label, action] of [
    ["stop", async () => { if (launched) assert.equal(await stop(), 0); }],
    ["restore", async () => { if (prepared) { assert.equal(await profile("Restore"), 0); report.profileRestoration = "PASS"; } }],
  ]) try { await action(); } catch (e) {
    (report.cleanupErrors ||= []).push({ label, error: String(e.stack || e) }); report.status = "FAILED"; process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report));
});
