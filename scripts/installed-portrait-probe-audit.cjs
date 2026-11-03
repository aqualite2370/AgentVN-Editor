"use strict";
// Supplemental evidence audit. Never retroactively clears the original #185.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `probe-audit-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
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
  const inputs = ["06", "07", "08", "09"].map(n => {
    const file = path.join(qa, `diagnostic-${n}/report.json`);
    return { n, file, report: read(file) };
  });
  check("Original failure and sealed native log remain unchanged", () => {
    const prior = read(path.join(qa, "audit-01/report.json"));
    const recovered = read(path.join(qa, "native-log-supplement-01/report.json"));
    for (const f of [recovered.source, recovered.previousAudit, recovered.nativeLogCopy, ...prior.evidence])
      assert.equal(sha(f.path), f.sha256);
    assert.equal(read(recovered.source.path).status, "FAILED");
    assert.equal(recovered.layer, "EMBEDDED_GAMECLI_RUNTIME_PREVIEW");
    return { originalNotRelabelled: true, rootCause: "NOT_PROVEN" };
  });
  check("Probe insufficiency explicitly rejected; ready probes have actual DialogBox coverage", () => {
    const [a, b, c, d] = inputs.map(x => x.report);
    assert.equal(a.status, "NOT_REPRODUCED_ORIGINAL_FAILURE_REMAINS_OPEN");
    assert.equal(a.traceCoverage, undefined);
    assert(!a.steps.flatMap(s => s.renderTraces ?? []).some(t =>
      t.trace?.snapshots?.some(s => s.dialogs.length)));
    assert.equal(c.status, "DIAGNOSTIC_FAILED");
    assert.match(c.error, /must observe a real Runtime DialogBox commit/);
    assert.equal(c.previewMounts.length, 6);
    for (const r of [b, d]) {
      assert.equal(r.status, "NOT_REPRODUCED_ORIGINAL_FAILURE_REMAINS_OPEN");
      assert.equal(r.previewMounts.length, 2);
      assert(r.previewMounts.every(m => !m.ghost && !m.pending && m.src.includes("/gamecli-preview/")));
      assert(r.traceCoverage.actualRendererFrames > 0 && r.traceCoverage.dialogCommitsObserved > 0);
      assert.equal(r.exports.length, 2);
      assert.equal(sha(r.packagedChunk.path), r.packagedChunk.sha256);
      assert.equal(sha(r.packagedChunk.localSameBytes), r.packagedChunk.sha256);
      assert.equal(r.packagedChunk.sha256, "2279c5b79fa317141bb2eb3a0ff8f435635b983993dbdb4005ac88761009e0f0");
    }
    // 07 predates the flag; its sealed executed source has no refresh branch.
    assert.equal(b.refreshDraft, undefined);
    assert(!fs.readFileSync(path.join(qa, "diagnostic-07/executed-test.cjs"), "utf8").includes("if (refreshDraft)"));
    assert.equal(d.refreshDraft, true);
    assert.equal(d.pendingDraftRefreshes.length, 2);
    assert(d.pendingDraftRefreshes.every(f => f.realAuthorInput && f.phase === "loading"
      && f.initialValue === f.restoredValue && f.waitForRefreshedRuntimeReady === false));
    for (const { report: r } of inputs) {
      assert.deepEqual(r.errors, []); assert.equal(r.cleanupError, undefined);
      assert.equal(r.modelRequests, 0);
      for (const e of r.exports) assert.equal(sha(e.path), e.sha256);
    }
    return { inputs: inputs.map(x => describe(x.file)),
      classifications: { "06": "QA_INSUFFICIENT_PROBE", "07": "VALID_PROBE_NOT_REPRODUCED",
        "08": "QA_FAILED_NO_DIALOG_COMMIT", "09": "VALID_PROBE_NOT_REPRODUCED" },
      priorPending03To05NotProvenMounted: true, productFixed: false };
  });
  check("Post-diagnostic-01 cache, protected files, owned processes and ports restored", () => {
    const identities = new Set(), ports = [];
    for (const { report: r } of inputs) {
      const restoration = read(r.nativeCacheRestoration);
      assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
      const directory = restoration.originalDirectory;
      const id = ps(`$v=(& fsutil.exe file queryfileid '${directory.replace(/'/g, "''")}'|Out-String);` +
        `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'ID unavailable'};$Matches[0].ToLowerInvariant()`);
      assert.equal(id, restoration.originalDirectoryId);
      for (const f of restoration.originalFiles) assert.equal(sha(path.join(directory, f.relative)), f.sha256);
      assert(r.cleanups.length && r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
      for (const p of r.knownProcesses) identities.add(`${p.ProcessId}:${p.Created}`);
      for (const l of r.launches) ports.push(...l.ports);
    }
    assert(!rows().some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
    const uniquePorts = [...new Set(ports)]; assert.equal(listeners(uniquePorts).length, 0);
    const prep = read(path.join(qa, "preparation.json"));
    for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256);
    return { processIdentities: identities.size, ports: uniquePorts, immutableFiles: prep.immutable.length,
      restoredBaseline: "POST_DIAGNOSTIC01_ONLY", originalCacheBytesNotRecovered: true, normalCloseClaimed: false };
  });
  check("QA contracts, syntax, Git publication boundaries and unchanged Dev", () => {
    const run = (cmd, args) => {
      const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      return { command: [cmd, ...args], exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
    const index = path.resolve(root, run("git", ["rev-parse", "--git-path", "index"]).stdout.trim()), indexSha = sha(index);
    const files = ["scripts/lib/runtime-render-diagnostic.cjs", "scripts/runtime-render-diagnostic-test.cjs",
      "scripts/installed-portrait-switch-diagnostic.cjs", "scripts/installed-portrait-probe-audit.cjs"];
    const commands = files.map(f => run(process.execPath, ["--check", f]));
    commands.push(run(process.execPath, ["scripts/runtime-render-diagnostic-test.cjs"]));
    commands.push(run(process.execPath, ["scripts/portrait-installed-observation-test.cjs"]));
    commands.push(run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/installed-layout-cache-session.ps1", "-Action", "SelfTest", "-RunDirectory", path.join(qa, "diagnostic-99")]));
    commands.push(run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/push-agentvn-editor.ps1", "-CheckOnly"]));
    for (const f of files) {
      assert.equal(spawnSync("git", ["check-ignore", "--", f], { cwd: root, windowsHide: true }).status, 1);
      fs.copyFileSync(path.join(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);
    }
    run("git", ["check-ignore", "--", "output/installed-portrait-current-20261021-01/REPORT.md"]);
    assert.equal(run("git", ["rev-parse", "HEAD"]).stdout.trim(), head); assert.equal(sha(index), indexSha);
    const dev = path.join(root, "AgentVN Dev.exe"), debug = path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe");
    assert.equal(sha(dev), "5eaf4855207286bfa9c52344973e83f9d3f5045a9b7ee7f17943f1cb91f738fa");
    assert.equal(sha(debug), sha(dev));
    return { commands, head, indexSha256: indexSha, gitPushPerformed: false, dev: describe(dev), devRebuilt: false };
  });
  assert.equal(report.groups.length, 4);
  report.status = "EVIDENCE_AUDIT_PASS_PRODUCT_FAILURE_REMAINS_OPEN";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, groups: report.groups.map(g => [g.name, g.status]), out, error: report.error }));
}
