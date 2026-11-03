"use strict";
// Observe the existing process by identity, never restart a timed-out matrix.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const current1930=process.argv.includes("--candidate=1.9.30");
assert.deepEqual(process.argv.slice(2),current1930?[attempt,"--candidate=1.9.30"]:[attempt]);
const base = current1930?"F:/AgentVN/QA/Editor-1.9.30-20261026-01":"F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const source = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/narrative-installed-${current1930?"1930":"1924"}-${attempt}/session.json`;
const out = path.join(base, `narrative-followup-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const initial = read(source);
const candidates=current1930?rows().filter(p=>/candidate-1924-narrative-session\.cjs 01 --candidate=1\.9\.30\s*$/.test(p.CommandLine||"")):[];
if(current1930&&!initial.finishedAt)assert.equal(candidates.length,1,"Unique existing narrative process required");
const identity = current1930?{ProcessId:candidates[0]?.ProcessId,Created:candidates[0]?.Created}:
  { ProcessId: 14208, Created: "2026-10-24T10:10:29.5524660Z" };
const report = { status: "WAITING_FOR_EXISTING_MATRIX", startedAt: new Date().toISOString(), source,
  sourceStartedAt: initial.startedAt, identity, commands: [], modelRequests: 0, productChanges: 0, builds: 0,
  scope: current1930?"EXISTING_INSTALLED_1930_NARRATIVE_AUDIT_THEN_QUICK_EXCEPTIONS":"EXISTING_INSTALLED_1924_NARRATIVE_TERMINAL_AUDIT_THEN_FRESH_AUTHOR_EXPORT",
  tools: [__filename, "scripts/candidate-1924-narrative-audit.cjs",
    ...(current1930?["scripts/candidate-1924-quick-session.cjs","scripts/candidate-1924-quick-flow.cjs",
      "scripts/candidate-1924-quick-audit.cjs","scripts/lib/candidate-1924-quick-adapter.cjs",
      "scripts/candidate-1924-quick-lock.ps1","scripts/lib/wait-native-runtime-page.cjs"]:["scripts/candidate-1924-author-export.cjs"])]
    .map(desc) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(label, args) {
  for (const f of report.tools) assert.equal(sha(f.path), f.sha256, f.path);
  const row = { label, command: [process.execPath, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
    log: path.join(out, label + ".log") }; report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(process.execPath, args, {
      cwd: path.resolve(__dirname, ".."), env: process.env, windowsHide: true, stdio: ["ignore", fd, fd],
    });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, 0, row.log); row.status = "PASS";
  } catch (error) { row.status = "FAILED"; throw error; }
  finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  save();
  if (!initial.finishedAt) assert(rows().some(p => p.ProcessId === identity.ProcessId && p.Created === identity.Created &&
    /candidate-1924-narrative-session\.cjs 01/.test(p.CommandLine)));
  for (;;) {
    const current = read(source); assert.equal(current.startedAt, initial.startedAt);
    if (current.finishedAt) {
      assert(["PASS", "FAILED"].includes(current.status) && !current.cleanupError);
      report.sourceConclusion = current.status; report.terminalSource = desc(source); break;
    }
    assert(rows().some(p => p.ProcessId === identity.ProcessId && p.Created === identity.Created),
      "Original process identity disappeared without terminal evidence; do not restart");
    report.lastVerifiedAt = new Date().toISOString(); save();
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  report.status = "AUDITING_ORIGINAL_MATRIX"; save();
  const flag=current1930?["--candidate=1.9.30"]:[];
  await command("narrative-audit", ["scripts/candidate-1924-narrative-audit.cjs", attempt,...flag]);
  const audit = read(path.join(base, `narrative-audit-${attempt}/report.json`));
  assert.equal(audit.status, "PASS"); assert.equal(audit.sourceConclusion, report.sourceConclusion);
  assert.equal(report.sourceConclusion, "PASS", "Preserve failed source, do not start dependent author workflow");
  assert.equal(audit.coverageComplete, true);
  if(current1930) {
    report.status="RUNNING_CURRENT_QUICK_EXCEPTIONS";save();
    await command("quick",["scripts/candidate-1924-quick-session.cjs",attempt,...flag]);
    await command("quick-audit",["scripts/candidate-1924-quick-audit.cjs",attempt,...flag]);
    const quick=read(path.join(base,`quick-audit-${attempt}/report.json`));
    assert.equal(quick.status,"PASS");assert(quick.finishedAt&&!quick.error);
  }else {
    report.status = "FRESH_INSTALLED_AUTHOR_EXPORT"; save();
    await command("author-export", ["scripts/candidate-1924-author-export.cjs", attempt]);
    const author = read(path.join(base, `author-export-${attempt}/report.json`));
    assert.equal(author.status, "PASS"); assert(author.finishedAt && !author.cleanupError);
  }
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, sourceConclusion: report.sourceConclusion, out, error: report.error }));
});
