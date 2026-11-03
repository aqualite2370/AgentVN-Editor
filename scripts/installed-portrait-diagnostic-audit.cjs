"use strict";
// Terminal supplement only. A successful evidence audit must NOT clear #185.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const out = path.join(qa, "diagnostic-audit-01");
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
  productStatus: "FAILED", originalFailureOpen: "INSTALLED-LAYOUT-REACT185-01",
  modelRequests: 0, builds: 0, installations: 0, AndroidOperations: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function check(name, fn) {
  const g = { name, status: "RUNNING" }; report.groups.push(g); save();
  try { g.result = fn(); g.status = "PASS"; }
  catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
  finally { save(); }
}
try {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const previous = read(path.join(qa, "audit-01/report.json"));
  check("Original failure and recovered native frame evidence unchanged", () => {
    const supplement = read(path.join(qa, "native-log-supplement-01/report.json"));
    assert.equal(supplement.productStatus, "FAILED");
    assert.equal(supplement.layer, "EMBEDDED_GAMECLI_RUNTIME_PREVIEW");
    for (const item of [supplement.source, supplement.previousAudit, supplement.nativeLogCopy, ...previous.evidence])
      assert.equal(sha(item.path), item.sha256);
    assert.equal(read(supplement.source.path).status, "FAILED");
    return { recovery: desc(path.join(qa, "native-log-supplement-01/report.json")), originalNotRelabelled: true };
  });
  const diagnostics = ["04", "05"].map(a => ({ path: path.join(qa, `diagnostic-${a}/report.json`),
    report: read(path.join(qa, `diagnostic-${a}/report.json`)) }));
  check("Actual export reproduction reports are scoped and terminal", () => {
    const a = diagnostics[0].report, b = diagnostics[1].report;
    assert.equal(a.status, "DIAGNOSTIC_FAILED"); assert.match(a.error, /environment terminal/);
    assert(a.failureDOM.includes("发布检查")); assert.equal(a.exports.length, 1);
    assert.equal(b.status, "NOT_REPRODUCED_ORIGINAL_FAILURE_REMAINS_OPEN");
    assert.equal(b.exports.length, 6);
    assert.equal(b.steps.length, 25); assert(b.steps.every(s => s.status === "COMPLETED"));
    assert(b.frameLifecycle.some(e => e.event === "frameattached"));
    assert(b.frameLifecycle.some(e => e.event === "framedetached"));
    for (const { report: d } of diagnostics) {
      assert.equal(d.modelRequests, 0); assert.deepEqual(d.errors, []); assert.equal(d.cleanupError, undefined);
      assert(d.actualExport && d.pendingPreview);
      for (const e of d.exports) assert.equal(sha(e.path), e.sha256);
    }
    return { inputs: diagnostics.map(d => desc(d.path)), attempts: 2, completedExports: 7,
      rootCause: "NOT_PROVEN", fixed: false, originalFailureStillOpen: true };
  });
  check("Post-diagnostic-01 cache baseline restored and owned processes/ports gone", () => {
    const ports = [], ids = new Set();
    for (const { report: d } of diagnostics) {
      const restoration = read(d.nativeCacheRestoration);
      assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
      const directory = restoration.originalDirectory;
      const id = ps(`$v=(& fsutil.exe file queryfileid '${directory.replace(/'/g, "''")}'|Out-String);` +
        `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'ID unavailable'};$Matches[0].ToLowerInvariant()`);
      assert.equal(id, restoration.originalDirectoryId);
      for (const f of restoration.originalFiles) assert.equal(sha(path.join(directory, f.relative)), f.sha256);
      assert(d.cleanups.length && d.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
      for (const p of d.knownProcesses) ids.add(`${p.ProcessId}:${p.Created}`);
      for (const l of d.launches) ports.push(...l.ports);
    }
    const uniquePorts = [...new Set(ports)];
    assert.equal(listeners(uniquePorts).length, 0);
    assert(!rows().some(p => ids.has(`${p.ProcessId}:${p.Created}`)));
    const prep = read(path.join(qa, "preparation.json"));
    for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256);
    return { processIdentities: ids.size, ports: uniquePorts, immutableFiles: prep.immutable.length,
      deletedUserFiles: 0, originalDiagnostic01CacheMutationStillDisclosed: previous.nativeCacheProtectionGap,
      baselineIsPostDiagnostic01NotOriginal: true, normalCloseClaimed: false };
  });
  check("QA regressions, exact cache boundaries, Git preflight and unchanged Dev", () => {
    const root = path.resolve(__dirname, "..");
    const run = (cmd, args) => {
      const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return { command: [cmd, ...args], exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
    const index = path.resolve(root, run("git", ["rev-parse", "--git-path", "index"]).stdout.trim()), indexSha = sha(index);
    const files = ["scripts/installed-portrait-switch-diagnostic.cjs", "scripts/installed-portrait-native-log-supplement.cjs",
      "scripts/installed-portrait-diagnostic-audit.cjs", "scripts/installed-portrait-current-audit.cjs"];
    const commands = files.map(f => run(process.execPath, ["--check", f]));
    commands.push(run(process.execPath, ["scripts/portrait-installed-observation-test.cjs"]));
    commands.push(run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/installed-layout-cache-session.ps1", "-Action", "SelfTest", "-RunDirectory", path.join(qa, "diagnostic-99")]));
    commands.push(run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/push-agentvn-editor.ps1", "-CheckOnly"]));
    assert.equal(run("git", ["rev-parse", "HEAD"]).stdout.trim(), head); assert.equal(sha(index), indexSha);
    run("git", ["check-ignore", "--", "output/installed-portrait-current-20261021-01/REPORT.md"]);
    for (const f of files) assert.equal(spawnSync("git", ["check-ignore", "--", f], { cwd: root, windowsHide: true }).status, 1);
    const dev = path.join(root, "AgentVN Dev.exe"), debug = path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe");
    assert.equal(sha(dev), "5eaf4855207286bfa9c52344973e83f9d3f5045a9b7ee7f17943f1cb91f738fa");
    assert.equal(sha(debug), sha(dev));
    return { commands, head, indexSha256: indexSha, gitPushPerformed: false, gitignoreChangeNeeded: false,
      dev: desc(dev), debug: desc(debug), devRebuiltThisBlock: false };
  });
  assert.equal(report.groups.length, 4);
  report.status = "EVIDENCE_AUDIT_PASS_PRODUCT_FAILURE_REMAINS_OPEN";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, groups: report.groups.map(g => [g.name, g.status]), out, error: report.error }));
}
