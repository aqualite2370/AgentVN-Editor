"use strict";
// Sequential build gates. Real-native behavior AND its independent audit must
// already pass with the same source bytes before a Dev publication can start.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { qa, summary } = require("./native-novel-partial.cjs");
const root = path.resolve(__dirname, ".."), load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: f, sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedAt: fs.statSync(f).mtime.toISOString() });
async function main() {
  const [name, iteration, audit] = process.argv.slice(2);
  assert(/^gates-\d{2}$/.test(name) && /^\d{2}$/.test(iteration) && /^audit-\d{2}$/.test(audit));
  const out = path.join("F:/AgentVN/QA/Novel-Phase-Repair-20261020-01", name);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const evidence = path.join(qa, `session-${iteration}/report.json`), receipt = path.join(qa, audit, "receipt.json");
  const r = { at: new Date().toISOString(), status: "RUNNING", steps: [],
    behavior: describe(evidence), audit: describe(receipt), before: describe(path.join(root, "AgentVN Dev.exe")) };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  async function command(label, script) {
    const step = { label, command: script, status: "RUNNING", startedAt: new Date().toISOString() };
    r.steps.push(step); save(); console.log(`START ${label}`);
    const file = path.join(out, `${label}.log`), fd = fs.openSync(file, "wx");
    try {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `$ErrorActionPreference='Stop'; ${script}; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}`],
      { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd], env: { ...process.env,
        PYTHONIOENCODING: "utf-8", AGENTVN_TEST_PROJECT: load(path.join(summary, "preparation.json")).inputs[0].path,
        AGENTVN_WORKSPACE_OUTPUT: out } });
      step.pid = child.pid; save();
      step.code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
      assert.equal(step.code, 0, `${label} failed: ${file}`);
      step.status = "PASS"; console.log(`PASS ${label}`);
    } finally { fs.closeSync(fd); step.log = describe(file); step.finishedAt = new Date().toISOString(); save(); }
  }
  try {
    const b = load(evidence), a = load(receipt);
    assert.equal(b.status, "CURRENT_NATIVE_NOVEL_PARTIAL_PASS");
    assert.equal(b.verifyGraphPhases, true); assert.equal(b.phaseFacts.length, 7);
    assert.equal(a.status, "CURRENT_NATIVE_NOVEL_PARTIAL_EVIDENCE_VERIFIED");
    assert.equal(a.report.sha256, sha(evidence)); assert(a.invalidVariantsRejected >= 29);
    for (const f of b.sources) assert.equal(sha(f.path), f.sha256, "Source changed since behavior test");
    const lifecycleFile = "F:/AgentVN/QA/Native-Novel-Lifecycle-20261020-01/session-02/report.json";
    const lifecycleReceipt = "F:/AgentVN/QA/Native-Novel-Lifecycle-20261020-01/audit-02/receipt.json";
    const lifecycle = load(lifecycleFile), lifecycleAudit = load(lifecycleReceipt);
    assert.equal(lifecycle.status, "CURRENT_NATIVE_NOVEL_LIFECYCLE_PASS");
    assert.equal(lifecycleAudit.status, "CURRENT_NATIVE_NOVEL_LIFECYCLE_EVIDENCE_VERIFIED");
    assert.equal(lifecycleAudit.report.sha256, sha(lifecycleFile));
    for (const f of lifecycle.sources) assert.equal(sha(f.path), f.sha256);
    r.lifecycle = describe(lifecycleFile); r.lifecycleAudit = describe(lifecycleReceipt); save();
    await command("facts", "node scripts/novel-phase-facts-test.cjs");
    await command("backend", "python -m pytest backend/tests/test_novel_process_service.py backend/tests/test_novel_processing_contracts.py -q -p no:cacheprovider");
    await command("core", "node scripts/novel-processing-core-test.cjs");
    await command("append-contract", "node scripts/novel-import-append-graph-contract-test.cjs");
    await command("typecheck", "npm --prefix D:\\AgentVN\\editor run typecheck");
    await command("editor-build", "npm --prefix D:\\AgentVN\\editor run build");
    await command("gamecli-build", "npm --prefix D:\\AgentVN\\GameCli_framework run build");
    await command("workspace-contract", "node scripts/editor-workspace-contract.cjs");
    await command("dev-build", "& powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1");
    r.dev = describe(path.join(root, "AgentVN Dev.exe"));
    r.built = describe(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
    assert.equal(r.dev.sha256, r.built.sha256);
    const publication = r.steps.find(s => s.label === "dev-build");
    assert(fs.statSync(r.dev.path).mtimeMs >= Date.parse(publication.startedAt), "Root Dev must actually be overwritten");
    r.sameHashMeaning = "A frontend-only change can retain the native binary hash; actual copy time and source hashes are separate.";
    for (const f of b.sources) assert.equal(sha(f.path), f.sha256, "Build changed tested source");
    r.resourceChecks = [];
    for (const relative of ["GameCli_framework/src/components/player/DialogBox.tsx", "shared/cartridge/validators.ts",
      "GameCli_framework/src/styles/shell.css"]) {
      const bundled = path.join(root, "editor/src-tauri/bundle-workspace", relative);
      assert.equal(sha(bundled), sha(path.join(root, relative)), relative);
      r.resourceChecks.push(describe(bundled));
    }
    const versions = path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json");
    assert.equal(load(versions).editorVersion, load(path.join(root, "editor/src-tauri/tauri.conf.json")).version);
    r.resourceChecks.push(describe(versions));
    r.player = describe(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    r.backendBoundary = "Dev runs the tested source Python backend. This Dev build does not rebuild or prove an installed creator-backend.exe.";
    r.status = "NOVEL_PHASE_GATES_AND_ACTUAL_DEV_COPY_PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; console.error(r.error); }
  finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, dev: r.dev })); }
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
