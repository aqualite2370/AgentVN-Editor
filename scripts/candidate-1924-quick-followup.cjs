"use strict";
// Wait for the exact existing ability chain; never overlap product sessions.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const [attempt, pidText, created] = process.argv.slice(2), pid = Number(pidText);
assert.match(attempt || "", /^\d{2}$/); assert(Number.isSafeInteger(pid) && pid > 0);
assert.match(created || "", /^\d{4}-\d{2}-\d{2}T/);
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const source = path.join(base, "abilities-followup-02/report.json");
const out = path.join(base, `quick-followup-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
const initial = read(source);
const tools = [__filename, "scripts/candidate-1924-quick-session.cjs", "scripts/candidate-1924-quick-flow.cjs",
  "scripts/candidate-1924-quick-audit.cjs", "scripts/candidate-1924-quick-lock.ps1",
  "scripts/candidate-1924-quick-adapter-test.cjs", "scripts/lib/candidate-1924-quick-adapter.cjs",
  "scripts/lib/installed-runtime-session.cjs", "scripts/installed-runtime-quick-gaps-playwright.cjs",
  "scripts/installed-runtime-quick-observation.cjs", "scripts/native-runtime-quick-audit.cjs",
  "scripts/native-dev-preview-profile.ps1", "scripts/lib/runtime-story-observer.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/lib/current-native-editor-session.cjs"].map(desc);
const report = { status: "WAITING_FOR_EXISTING_ABILITIES", startedAt: new Date().toISOString(),
  scope: "WAIT_THEN_INSTALLED_1_9_24_QUICK_EXCEPTIONS_AND_AUDIT", identity: { pid, created },
  source, sourceStartedAt: initial.startedAt, tools, commands: [], productChanges: 0, builds: 0, modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(script, label) {
  for (const item of tools) assert.equal(sha(item.path), item.sha256, item.path);
  const row = { command: [process.execPath, script, attempt], label, status: "RUNNING",
    startedAt: new Date().toISOString(), log: path.join(out, `${label}.log`) };
  report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(process.execPath, [script, attempt], {
      cwd: path.resolve(__dirname, ".."), windowsHide: true, stdio: ["ignore", fd, fd] });
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
  for (const item of tools) {
    item.copy = path.join(out, "tools", path.relative(path.resolve(__dirname, ".."), item.path));
    fs.mkdirSync(path.dirname(item.copy), { recursive: true });
    fs.copyFileSync(item.path, item.copy, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(item.copy), item.sha256);
  }
  save();
  const parent = rows().find(p => p.ProcessId === pid);
  assert(parent && parent.Created === created &&
    /candidate-1924-abilities-followup\.cjs 01 /.test(parent.CommandLine) &&
    path.resolve(parent.ExecutablePath) === path.resolve(process.execPath));
  report.verifiedWaitingIdentity = parent; save();
  for (;;) {
    const current = read(source); assert.equal(current.startedAt, initial.startedAt);
    if (current.finishedAt) {
      assert.equal(current.status, "PASS"); assert(!current.error && !current.cleanupError); break;
    }
    assert(rows().some(p => p.ProcessId === pid && p.Created === created),
      "Existing ability chain disappeared without terminal evidence; do not restart");
    report.lastVerifiedAt = new Date().toISOString(); save();
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  const predecessor = path.join(base, `abilities-audit-${attempt}/report.json`), audit = read(predecessor);
  assert.equal(audit.status, "PASS"); assert(audit.finishedAt && !audit.error && !audit.cleanupError);
  report.predecessor = desc(predecessor); report.status = "RUNNING_QUICK_EXCEPTIONS"; save();
  await command("scripts/candidate-1924-quick-session.cjs", "quick");
  await command("scripts/candidate-1924-quick-audit.cjs", "audit");
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
