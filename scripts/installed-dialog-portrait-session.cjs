"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), { sha } = require("./lib/installed-runtime-session.cjs");
const number = process.argv[2] || "01"; assert(/^0[1-9]$/.test(number));
const base = `D:/AgentVN/output/installed-dialog-portrait-20261019-${number}`, work = `F:/AgentVN/QA/Dialog-Portrait-20261019-${number}`;
assert(!fs.existsSync(base) && !fs.existsSync(work));
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const playerOnly = process.argv.includes("--player-only");
assert(!playerOnly || number === "03", "Only explicitly reviewed third-session supplement is supported");
const authorBase = playerOnly ? "D:/AgentVN/output/installed-dialog-portrait-20261019-02" : base;
const input = playerOnly ? read(`${authorBase}/fixtures.json`).input : `${work}/对白头像隔离小工程.vnproj`;
const env = { ...process.env, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: base,
  AGENTVN_PORTRAIT_AUTHOR_RUN: authorBase,
  AGENTVN_PORTRAIT_RUN: base, AGENTVN_PORTRAIT_WORK: work };
const report = { status: "RUNNING", at: new Date().toISOString(), commands: [], runners: [], modelRequests: 0, productChanges: 0, newBuilds: 0 };
const save = () => { if (fs.existsSync(base)) fs.writeFileSync(`${base}/execution-01.json`, JSON.stringify(report, null, 2)); };
let prepared = false, launched = false;
function command(exe, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: "D:/AgentVN", env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const row = { exe, args, label, pid: child.pid, startedAt: new Date().toISOString() }; report.commands.push(row); save();
    const chunks = []; for (const s of [child.stdout, child.stderr]) s.on("data", b => { chunks.push(b); process.stdout.write(b); });
    child.once("error", reject); child.once("exit", (code, signal) => {
      row.exitCode = code; row.signal = signal; row.finishedAt = new Date().toISOString();
      if (fs.existsSync(work)) { row.log = `${work}/${label}.log`; fs.writeFileSync(row.log, Buffer.concat(chunks), { flag: "wx" }); row.sha256 = sha(row.log); }
      save(); resolve(code);
    });
  });
}
const ps = (file, args, label) => command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `scripts/${file}`, ...args], label);
const profile = action => ps("installed-preview-session.ps1", ["-Suite", "dialog-portrait", "-SessionNumber", String(Number(number)), "-Action", action], action.toLowerCase());
const stop = label => ps("installed-assistant-recovery-session.ps1", ["-Suite", "dialog-portrait", "-SessionNumber", String(Number(number)),
  "-Action", "StopAll", "-Evidence", label], label);
const runner = async (file, label) => {
  const item = { path: path.resolve(file), sha256: sha(file) }; report.runners.push(item); save();
  const code = await command(process.execPath, [file], label); assert.equal(sha(file), item.sha256); return code;
};
(async () => {
  assert.equal(await profile("Prepare"), 0); prepared = true;
  if (!playerOnly) {
    assert.equal(await runner("scripts/installed-dialog-portrait-fixtures.cjs", "fixtures"), 0);
    assert.equal(await profile("Launch"), 0); launched = true;
    const deadline = Date.now() + 60000; let healthy = false;
    while (Date.now() < deadline) {
      try { healthy = (await fetch("http://127.0.0.1:8278/api/health", { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (healthy) break; await new Promise(r => setTimeout(r, 100));
    }
    assert(healthy); assert.equal(await profile("Observe"), 0);
    assert.equal(await runner("scripts/installed-dialog-portrait-editor.cjs", "editor"), 0);
    assert.equal(await stop("editor-stop"), 0); launched = false;
  } else {
    assert.equal(read(`${authorBase}/editor-01.json`).status, "PASS");
    report.authoringReused = { path: `${authorBase}/editor-01.json`, sha256: sha(`${authorBase}/editor-01.json`),
      noRepeatedAuthoringOrExport: true };
  }
  const code = await runner("scripts/installed-dialog-portrait-player.cjs", "player"), raw = read(`${base}/player-01.json`);
  assert(raw.finishedAt && ["PASS", "FAILED"].includes(raw.status)); assert.equal(code, raw.status === "PASS" ? 0 : 1);
  report.status = raw.status; report.sourceConclusion = raw.status; if (code) process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    if (launched) assert.equal(await stop("failure-stop"), 0);
    if (prepared) { assert.equal(await profile("Restore"), 0); assert.equal(read(`${base}/profile-restoration.json`).status, "PASS"); report.profileRestoration = "PASS"; }
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report));
});
