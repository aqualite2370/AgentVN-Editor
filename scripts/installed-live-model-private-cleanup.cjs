"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const run = path.resolve(__dirname, "../output/installed-real-model-20261019-01");
const out = path.join(run, "private-cleanup.json");
assert(!fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), secretValuesRead: false,
  originalProfilesTouched: false, error: null };
let db;
try {
  assert.equal(read(path.join(run, "live-closeout.json")).status, "PASS");
  assert.equal(read(path.join(run, "attributed-stop-01.json")).status, "PASS");
  const root = "F:/AgentVN-QA-InstalledRealModel-20261019-01/model-transport";
  const ready = read(path.join(root, "ready.json")), transport = read(path.join(root, "http-accounting.json"));
  assert.equal(transport.attempts.length, 2);
  assert(transport.attempts.every(a => a.status === "SUCCEEDED"));
  const identity = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(ready.pid)}" | ForEach-Object {@{pid=$_.ProcessId;path=$_.ExecutablePath;parent=$_.ParentProcessId;createdUtc=$_.CreationDate.ToUniversalTime().ToString('o');command=$_.CommandLine}} | ConvertTo-Json`],
  { windowsHide: true, encoding: "utf8" }));
  assert.equal(identity.pid, 49680);
  assert.equal(identity.path.toLowerCase(), "c:\\program files\\nodejs\\node.exe");
  assert(identity.command.includes("D:\\AgentVN\\scripts\\live-model-relay-session.cjs"));
  assert(identity.command.includes("F:\\AgentVN-QA-InstalledRealModel-20261019-01\\model-transport"));
  assert(Math.abs(Date.parse(identity.createdUtc) - Date.parse(ready.at)) < 2000);
  execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${identity.pid}"; if(!$p -or $p.CreationDate.ToUniversalTime().ToString('o') -ne '${identity.createdUtc}' -or $p.ExecutablePath -ne '${identity.path}'){throw 'Relay identity changed'}; Stop-Process -Id ${identity.pid}`],
  { windowsHide: true, encoding: "utf8" });
  report.relay = { pid: identity.pid, createdUtc: identity.createdUtc,
    stopped: true, method: "attributed Stop-Process after stdin already closed; no in-flight requests" };
  // Original profiles remain in the independently verified held paths. This is
  // ONLY the new blank-default QA database whose credential was cleared via UI.
  const prep = read(path.join(run, "preparation.json"));
  assert(prep.blankDefaultProfiles && prep.profiles.every(p => fs.existsSync(p.held)));
  const file = "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db";
  db = new DatabaseSync(file);
  assert.equal(db.prepare("SELECT count(*) AS n FROM editor_shared_state WHERE key='provider_secrets' AND trim(value)='{}'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM assistant_creation_processes WHERE status IN ('queued','running','cancelling')").get().n, 0);
  db.exec("PRAGMA secure_delete=ON; PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  report.isolatedDatabase = { file, currentSecretObjectEmpty: true, activeProcesses: 0,
    vacuumAndWalTruncation: true, integrity: "ok",
    scope: "remove stale database pages from the QA archive; not a claim of forensic disk secure erasure" };
  db.close(); db = null;
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally { db?.close(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" }); console.log(JSON.stringify(report)); }
