"use strict";
// Wait for the exact already-running export consumer; never start a second UI
// session or retry a failed product run.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const attempt = process.argv[2], pid = Number(process.argv[3]), created = process.argv[4];
const followupAttempt = process.argv[5] || attempt;
assert.match(attempt || "", /^\d{2}$/); assert(Number.isSafeInteger(pid) && pid > 0);
assert.match(followupAttempt, /^\d{2}$/);
assert.match(created || "", /^\d{4}-\d{2}-\d{2}T/);
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const out = path.join(base, `abilities-followup-${followupAttempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), commands: [],
  waitingFor: { pid, created }, productChanges: 0, builds: 0, modelRequests: 0,
  scope: "WAIT_FOR_CURRENT_EXPORT_CONSUMPTION_THEN_INSTALLED_ABILITIES_AND_AUDIT",
  tools: [__filename, "scripts/candidate-1924-abilities-session.cjs",
    "scripts/candidate-1924-abilities-flow.cjs", "scripts/lib/candidate-1924-abilities-adapter.cjs",
    "scripts/candidate-1924-abilities-adapter-test.cjs", "scripts/candidate-1924-abilities-audit.cjs",
    "scripts/installed-runtime-abilities-playwright.cjs"].map(desc) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(file, label) {
  for (const item of report.tools) assert.equal(sha(item.path), item.sha256, item.path);
  const row = { label, command: [process.execPath, file, attempt], status: "RUNNING",
    startedAt: new Date().toISOString(), log: path.join(out, label + ".log") };
  report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(process.execPath, [file, attempt], {
      cwd: path.resolve(__dirname, ".."), windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    row.status = row.exitCode === 0 ? "PASS" : "FAILED"; assert.equal(row.exitCode, 0, row.log);
  } finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  save();
  const parent = rows().find(p => p.ProcessId === pid);
  assert(parent && parent.Created === created && path.resolve(parent.ExecutablePath) === path.resolve(process.execPath),
    "The prerequisite process must actually be alive with this exact identity now");
  report.verifiedWaitingIdentity = parent; save();
  while (rows().some(p => p.ProcessId === pid && p.Created === created)) {
    report.lastVerifiedAt = new Date().toISOString(); save();
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  const predecessor = path.join(base, `fresh-export-audit-${attempt}/report.json`);
  const receipt = read(predecessor);
  assert.equal(receipt.status, "PASS"); assert(receipt.finishedAt && !receipt.cleanupError);
  report.predecessor = desc(predecessor); save();
  await command("scripts/candidate-1924-abilities-session.cjs", "abilities");
  await command("scripts/candidate-1924-abilities-audit.cjs", "audit");
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
