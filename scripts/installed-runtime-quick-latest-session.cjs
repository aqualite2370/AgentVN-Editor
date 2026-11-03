"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), { sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-runtime-quick-latest-20261019-01";
const work = "F:/AgentVN/QA/Runtime-Quick-Latest-20261019-01";
assert(!fs.existsSync(base) && !fs.existsSync(work));
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const fixture = read("D:/AgentVN/output/installed-runtime-abilities-20261018-01/fixtures-02.json");
const env = { ...process.env, AGENTVN_TEST_PROJECT: fixture.input, AGENTVN_WORKSPACE_OUTPUT: base };
const report = { status: "RUNNING", at: new Date().toISOString(), commands: [], productChanges: 0, newBuilds: 0, modelRequests: 0 };
const save = () => { if (fs.existsSync(base)) fs.writeFileSync(`${base}/execution-01.json`, JSON.stringify(report, null, 2)); };
let protectedProfiles = false;
const command = (exe, args, label) => new Promise((resolve, reject) => {
  const child = spawn(exe, args, { cwd: "D:/AgentVN", env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const row = { exe, args, label, pid: child.pid, startedAt: new Date().toISOString() }; report.commands.push(row); save();
  const output = []; for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { output.push(b); process.stdout.write(b); });
  child.once("error", reject); child.once("exit", (code, signal) => {
    row.exitCode = code; row.signal = signal; row.finishedAt = new Date().toISOString();
    if (fs.existsSync(work)) { row.log = path.join(work, `${label}-01.log`); fs.writeFileSync(row.log, Buffer.concat(output), { flag: "wx" }); row.sha256 = sha(row.log); }
    save(); resolve(code);
  });
});
const profile = action => command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  "scripts/installed-preview-session.ps1", "-Suite", "runtime-quick-latest", "-Action", action], action.toLowerCase());
(async () => {
  assert.equal(await profile("Prepare"), 0); protectedProfiles = true;
  const runner = "D:/AgentVN/scripts/installed-runtime-quick-latest-playwright.cjs";
  report.runner = { path: runner, sha256: sha(runner) }; save();
  const code = await command(process.execPath, [runner], "player"), raw = read(`${base}/player-01.json`);
  assert.equal(sha(runner), report.runner.sha256); assert.equal(raw.cells.length, 12); assert(raw.finishedAt);
  assert(["PASS", "FAILED"].includes(raw.status)); assert.equal(code, raw.status === "PASS" ? 0 : 1);
  report.status = raw.status; report.sourceConclusion = raw.status; if (code) process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    if (protectedProfiles) { assert.equal(await profile("Restore"), 0); assert.equal(read(`${base}/profile-restoration.json`).status, "PASS"); report.profileRestoration = "PASS"; }
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report));
});
