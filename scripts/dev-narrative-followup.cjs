"use strict";
// Continue the exact existing matrix; never launch or restart a matrix.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
async function main() {
  const source = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/dev-narrative-20261024-03";
  const sourceFile = path.join(source, "session.json"), original = read(sourceFile);
  assert.equal(original.status, "RUNNING");
  assert(!original.finishedAt);
  const identities = rows().filter(p => p.ProcessId === 15328 || p.ProcessId === 27576);
  assert.equal(identities.length, 2);
  assert(identities.some(p => p.ProcessId === 15328 && p.Created === "2026-10-23T17:01:37.4173350Z"));
  assert(identities.some(p => p.ProcessId === 27576 && p.Created === "2026-10-23T17:01:39.3011360Z"));
  const out = `${source}-followup-01`; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "WAITING_FOR_ORIGINAL", startedAt: new Date().toISOString(), source,
    originalStartedAt: original.startedAt, identities, commands: [], modelRequests: 0, productChanges: 0,
    scope: "SAME_DEV_MATRIX_TERMINAL_AUDIT_THEN_SCOPED_DIAGNOSIS_NOT_NEW_MATRIX" };
  const save = () => fs.writeFileSync(path.join(out, "followup.json"), JSON.stringify(r, null, 2));
  async function command(label, args) {
    const c = { label, command: [process.execPath, ...args], startedAt: new Date().toISOString(),
      status: "RUNNING", log: path.join(out, `${label}.log`) };
    r.commands.push(c); save(); const fd = fs.openSync(c.log, "wx");
    try {
      const p = spawn(process.execPath, args, { cwd: path.resolve(__dirname, ".."),
        windowsHide: true, stdio: ["ignore", fd, fd] });
      c.pid = p.pid; save();
      c.exitCode = await new Promise((resolve, reject) => { p.once("close", resolve); p.once("error", reject); });
      assert.equal(c.exitCode, 0, c.log); c.status = "PASS";
    } catch (e) { c.status = "FAILED"; throw e; }
    finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
  }
  try {
    fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL); save();
    for (;;) {
      const s = read(sourceFile);
      assert.equal(s.startedAt, original.startedAt, "Original session identity changed");
      if (s.finishedAt) {
        assert(["PASS", "FAILED"].includes(s.status) && !s.cleanupError);
        r.sourceStatus = s.status; r.sourceSha256 = sha(sourceFile); break;
      }
      const active = rows();
      assert(active.some(p => identities.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)),
        "Original processes ended without terminal evidence; refuse automatic restart");
      r.lastVerifiedAt = new Date().toISOString(); save();
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
    r.status = "AUDITING_ORIGINAL"; save();
    await command("terminal-audit", ["scripts/dev-narrative-audit.cjs", "03", "01"]);
    const auditFile = `${source}-audit-01/report.json`, audit = read(auditFile);
    assert.equal(audit.status, "PASS");
    r.audit = { path: auditFile, sha256: sha(auditFile), sourceConclusion: audit.sourceConclusion };
    r.status = "OBSERVING_SCOPED_RESTORATION"; save();
    await command("scoped-observation", ["scripts/dev-nvl-restore-diagnostic.cjs", "04"]);
    r.status = "FOLLOWUP_COMPLETE_NOT_BUSINESS_ACCEPTANCE";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, sourceStatus: r.sourceStatus, error: r.error }));
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
