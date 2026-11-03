"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-choice-role-states-20261019-01", work = "F:/AgentVN/QA/Choice-Role-States-20261019-01";
assert(!fs.existsSync(base) && !fs.existsSync(work));
const fixture = JSON.parse(fs.readFileSync("D:/AgentVN/output/installed-layout-author-review-20261019-01/ordinary-fixtures.json", "utf8"));
const env = { ...process.env, AGENTVN_TEST_PROJECT: fixture.input, AGENTVN_WORKSPACE_OUTPUT: base };
const report = { status: "RUNNING", at: new Date().toISOString(), commands: [], modelRequests: 0, newBuilds: 0, productChanges: 0 };
const save = () => { if (fs.existsSync(base)) fs.writeFileSync(`${base}/execution.json`, JSON.stringify(report, null, 2)); };
let prepared = false;
const run = (exe, args, label) => new Promise((resolve, reject) => {
  const p = spawn(exe, args, { cwd: "D:/AgentVN", env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const row = { exe, args, label, pid: p.pid, at: new Date().toISOString() }; report.commands.push(row); save();
  const chunks = []; for (const s of [p.stdout, p.stderr]) s.on("data", b => { chunks.push(b); process.stdout.write(b); });
  p.once("error", reject); p.once("exit", code => {
    row.exitCode = code; row.finishedAt = new Date().toISOString();
    if (fs.existsSync(work)) { row.log = `${work}/${label}.log`; fs.writeFileSync(row.log, Buffer.concat(chunks), { flag: "wx" }); row.sha256 = sha(row.log); }
    save(); resolve(code);
  });
});
const profile = action => run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  "scripts/installed-preview-session.ps1", "-Suite", "choice-role-states", "-Action", action], action.toLowerCase());
(async () => {
  assert.equal(await profile("Prepare"), 0); prepared = true;
  const runner = "D:/AgentVN/scripts/installed-choice-role-states.cjs"; report.runner = { path: runner, sha256: sha(runner) }; save();
  const code = await run(process.execPath, [runner], "player");
  const raw = JSON.parse(fs.readFileSync(`${base}/player.json`, "utf8")); assert(raw.finishedAt);
  assert.equal(sha(runner), report.runner.sha256); assert.equal(code, raw.status === "PASS" ? 0 : 1);
  report.status = raw.status; report.completedCells = raw.cells.filter(c => c.executed).length;
  if (code) process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try { if (prepared) { assert.equal(await profile("Restore"), 0); report.profileRestoration = "PASS"; } }
  catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report));
});
