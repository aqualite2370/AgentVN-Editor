"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict"), { spawn, execFileSync } = require("node:child_process");
const { sha, pause } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-transient-role-states-20261019-01";
const work = "F:/AgentVN/QA/Transient-Role-States-20261019-01";
assert(!fs.existsSync(base) && !fs.existsSync(work));
const fixture = JSON.parse(fs.readFileSync("D:/AgentVN/output/installed-layout-author-review-20261019-01/ordinary-fixtures.json", "utf8"));
const env = { ...process.env, AGENTVN_TEST_PROJECT: fixture.input, AGENTVN_WORKSPACE_OUTPUT: base };
const report = { status: "RUNNING", at: new Date().toISOString(), commands: [], productChanges: 0, modelRequests: 0, newBuilds: 0 };
const save = () => { if (fs.existsSync(base)) fs.writeFileSync(`${base}/execution.json`, JSON.stringify(report, null, 2)); };
let prepared = false;
const run = (exe, args, label) => new Promise((resolve, reject) => {
  const p = spawn(exe, args, { cwd: "D:/AgentVN", env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const row = { exe, args, label, pid: p.pid, at: new Date().toISOString() }; report.commands.push(row); save();
  const chunks = [];
  for (const stream of [p.stdout, p.stderr]) stream.on("data", b => { chunks.push(b); process.stdout.write(b); });
  p.once("error", reject); p.once("exit", code => {
    row.exitCode = code; row.finishedAt = new Date().toISOString();
    if (fs.existsSync(work)) {
      row.log = `${work}/${label}.log`;
      fs.writeFileSync(row.log, Buffer.concat(chunks), { flag: "wx" }); row.sha256 = sha(row.log);
    }
    save(); resolve(code);
  });
});
const profile = action => run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  "scripts/installed-preview-session.ps1", "-Suite", "transient-role-states", "-Action", action], action.toLowerCase());
function residuals() {
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `@{processes=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' `+
    `-or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|`+
    `Select-Object ProcessId,Name)}|ConvertTo-Json -Depth 4`], { encoding: "utf8", windowsHide: true }).replace(/^\uFEFF/, ""));
}
(async () => {
  assert.equal(await profile("Prepare"), 0); prepared = true;
  const runner = "D:/AgentVN/scripts/installed-transient-role-states.cjs";
  report.runner = { path: runner, sha256: sha(runner) }; save();
  const code = await run(process.execPath, [runner], "player");
  const raw = JSON.parse(fs.readFileSync(`${base}/player.json`, "utf8"));
  assert(raw.finishedAt); assert.equal(sha(runner), report.runner.sha256);
  report.completedCells = raw.cells.filter(c => c.executed).length;
  report.status = raw.status; if (code) process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  if (prepared) try {
    const deadline = Date.now() + 15000;
    let state = residuals();
    while (state.processes.length && Date.now() < deadline) { await pause(200); state = residuals(); }
    report.beforeRestore = state; assert.equal(state.processes.length, 0, "Refuse restore while WebView owns default profile");
    assert.equal(await profile("Restore"), 0); report.profileRestoration = "PASS";
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report));
});
