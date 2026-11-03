"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const attempt = process.argv[2], pid = Number(process.argv[3]), created = process.argv[4];
assert.match(attempt || "", /^\d{2}$/); assert(Number.isSafeInteger(pid) && pid > 0);
assert.match(created || "", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/);
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const out = path.join(base, `title-old-followup-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const source = path.join(base, `quick-followup-${attempt}/report.json`), initial = read(source);
const scripts = ["scripts/renpy-title-old-runtime-native.cjs", "scripts/renpy-title-old-runtime-audit.cjs"];
const tools = [__filename, ...scripts, "scripts/lib/renpy-title-old-runtime-evidence.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/lib/current-native-editor-session.cjs",
  "scripts/lib/owned-process-tree.cjs", "scripts/lib/owned-process-stop.cjs",
  "scripts/native-dev-preview-profile.ps1"].map(file => ({ path: path.resolve(file), sha256: sha(file) }));
const report = { status: "WAITING_FOR_EXISTING_QUICK_FLOW", startedAt: new Date().toISOString(),
  source, sourceStartedAt: initial.startedAt, identity: { pid, created }, commands: [], tools,
  scope: "WAIT_THEN_REAL_OLD_025_REFUSAL_OF_FRESH_1924_026_TITLE_NOT_OVERALL_ACCEPTANCE",
  productChanges: 0, builds: 0, modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(script, label) {
  for (const t of tools) assert.equal(sha(t.path), t.sha256, t.path);
  const row = { label, command: [process.execPath, script, attempt], status: "RUNNING",
    startedAt: new Date().toISOString(), log: path.join(out, `${label}.log`) };
  report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(process.execPath, [script, attempt], {
      cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    assert.equal(row.exitCode, 0, row.log); row.status = "PASS";
  } catch (error) { row.status = "FAILED"; throw error; }
  finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  save();
  for (const t of tools) {
    const target = path.join(out, "tools", path.relative(root, t.path));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(t.path, target, fs.constants.COPYFILE_EXCL); t.copy = target;
    assert.equal(sha(target), t.sha256);
  }
  for (;;) {
    const current = read(source); assert.equal(current.startedAt, initial.startedAt);
    if (current.finishedAt) { assert.equal(current.status, "PASS"); break; }
    const actual = rows().find(p => p.ProcessId === pid && p.Created === created);
    assert(actual && /candidate-1924-quick-followup\.cjs/.test(actual.CommandLine),
      "Exact existing quick flow vanished; do not restart or launch its dependents");
    report.verifiedWaitingIdentity = actual; report.lastVerifiedAt = new Date().toISOString(); save();
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  const quickAudit = read(path.join(base, `quick-audit-${attempt}/report.json`));
  assert.equal(quickAudit.status, "PASS"); assert(quickAudit.finishedAt && !quickAudit.cleanupError);
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  report.status = "REAL_HISTORICAL_BINARY_FLOW"; save();
  await command(scripts[0], "old-title-native");
  report.status = "INDEPENDENT_OLD_TITLE_AUDIT"; save();
  await command(scripts[1], "old-title-audit");
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, commands: report.commands.length, error: report.error }));
});
