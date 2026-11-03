"use strict";
// New, immutable QA run after DATAURL-01. No product edits, builds, installs or paid calls.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), label = "Repair-Candidate-Refresh-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/repair-candidate-refresh-20261020-01");
const [mode, iteration = "01"] = process.argv.slice(2);
assert(["prepare", "red", "green", "backend", "integrate", "verify"].includes(mode)); assert(/^\d{2}$/.test(iteration));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f));
const products = ["AgentVN Dev.exe", "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe"];
if (mode === "prepare") {
  for (const dir of [qa, checkpoint, summary]) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const saved = ["scripts/lib/repair-candidate-provenance.cjs", "scripts/repair-candidate-provenance-test.cjs",
    "scripts/repair-candidate-preflight.cjs", "scripts/repair-candidate-refresh.cjs",
    "scripts/assistant-agent-tools-playwright.cjs", "scripts/lib/owned-creation-api.cjs",
    "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"].map(file => {
    const source = path.join(root, file), target = path.join(checkpoint, file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(source), sha(target)); return { file, sha256: sha(source) };
  });
  const manifest = { at: new Date().toISOString(), saved, products: products.map(file => ({ file, sha256: sha(path.join(root, file)) })),
    qa, checkpoint, scope: "QA_SNAPSHOTS_AND_PRODUCT_HASHES_NOT_NEW_BINARY_BACKUP" };
  fs.writeFileSync(path.join(summary, "preparation.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "PASS", qa, checkpoint }));
} else {
  const out = path.join(qa, `${mode}-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), mode, steps: [], productChanges: 0, builds: 0, paidModelRequests: 0 };
  const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function run(args, expected = 0, extraEnv = {}) {
    const step = { command: [process.execPath, ...args], cwd: root, status: "RUNNING", logPath: path.join(out, `${report.steps.length + 1}.log`) };
    report.steps.push(step); persist();
    const log = fs.createWriteStream(step.logPath, { flags: "wx" });
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv } });
    step.pid = child.pid; persist();
    for (const s of [child.stdout, child.stderr]) s.pipe(log, { end: false });
    try {
      step.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
      assert.equal(step.exitCode, expected, `See ${step.logPath}`); step.status = "PASS";
    } finally { log.end(); step.finishedAt = new Date().toISOString(); persist(); }
    console.log(`PASS ${step.command.join(" ")}`);
  }
  (async () => {
    if (["red", "green"].includes(mode)) {
      await run(["scripts/repair-candidate-provenance-test.cjs"], mode === "red" ? 1 : 0);
      if (mode === "green") await run(["scripts/full-regression-evidence-test.cjs"]);
    } else if (mode === "backend") {
      const fixture = "F:/AgentVN/QA/Data-URL-Repair-20261020-01/charset素材临时工程.vnproj";
      report.isolation = { AGENTVN_TEST_PROJECT: fixture, AGENTVN_WORKSPACE_OUTPUT: out,
        ASSISTANT_AGENT_PACKAGED_SIDECAR: "1", realPaidModel: false };
      await run(["scripts/assistant-agent-tools-playwright.cjs"], 0, {
        AGENTVN_TEST_PROJECT: fixture, AGENTVN_WORKSPACE_OUTPUT: out, ASSISTANT_AGENT_PACKAGED_SIDECAR: "1",
        AGENTVN_CREATION_AGENT_PAGE: "title",
        AGENTVN_AGENT_TOOLS_DIAGNOSTIC: "0", AGENTVN_AGENT_EXISTING_ARTWORK: "0",
      });
      const folder = path.join(out, "agent-tools"), entries = fs.readdirSync(folder);
      assert.equal(entries.length, 1); report.behavior = path.join(folder, entries[0], "report.json");
      const b = read(report.behavior); assert.equal(b.status, "PASS"); assert.equal(b.cases.length, 13);
      assert.equal(b.cleanup.modelRequestCount, 78); assert.equal(b.cleanup.code, 0);
      report.controlledLocalModelRequests = b.cleanup.modelRequestCount;
      report.sidecarSha256 = b.sidecarSha256; assert.equal(report.sidecarSha256, sha(path.join(root, products[1])));
    } else if (mode === "integrate") {
      const b = read(path.join(qa, "backend-01/report.json")); assert.equal(b.status, "PASS");
      report.destination = `F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-${iteration}`;
      await run(["scripts/repair-candidate-preflight.cjs", report.destination, b.behavior,
        "F:/AgentVN/QA/Data-URL-Repair-20261020-01/payload-01.json"]);
      const a = read(path.join(report.destination, "audit.json"));
      assert.equal(a.provenanceStatus, "PASS"); assert.equal(a.receipts.length, 19);
      assert.equal(a.backendRevalidation.currentSha256, b.sidecarSha256);
      assert.equal(a.backendRevalidation.buildCommandOrigin, "RECORDED_OFFICIAL_BUILD");
      assert(a.qaToolRepair.supersededSources.length > 0); assert.equal(a.fullAcceptance, false);
      report.integrated = { sources: a.sourceChecks.length, references: a.evidenceChecks.length,
        bundled: a.bundledChecks.length, artifacts: a.artifactChecks.length };
    } else {
      const integrated = read(path.join(qa, `integrate-${iteration}/report.json`));
      assert.equal(integrated.status, "PASS");
      const file = path.join(integrated.destination, "audit.json"), a = read(file);
      assert.equal(a.provenanceStatus, "PASS"); assert.equal(a.errors.length, 0);
      assert.equal(a.fullAcceptance, false); assert.equal(a.acceptanceStatus, "BLOCKED");
      assert.equal(a.receipts.length, 19); assert.equal(a.sourceChecks.length, 60);
      assert.deepEqual(a.historical.counts, { FAILED: 9, BLOCKED: 6, PASS: 3 });
      for (const s of [...a.receipts, ...a.sourceChecks, ...a.evidenceChecks, ...a.bundledChecks, ...a.artifactChecks])
        assert.equal(sha(s.path), s.sha256);
      assert.equal(a.qaToolRepair.supersededSources.length, 1);
      const replacement = a.qaToolRepair.supersededSources[0];
      assert.equal(replacement.receiptId, "DATAURL"); assert.equal(replacement.previous.length, 1);
      assert.notEqual(replacement.previous[0].sha256, replacement.sha256);
      assert.equal(a.backendRevalidation.buildCommandOrigin, "RECORDED_OFFICIAL_BUILD");
      const bFile = a.backendRevalidation.behavior.path, b = read(bFile);
      assert.equal(b.status, "PASS"); assert.equal(b.cases.length, 13);
      assert.equal(b.cleanup.modelRequestCount, 78); assert.equal(b.cleanup.sidecarTaskkill, 0);
      assert.equal(b.cleanup.code, 0); assert.equal(b.cleanup.apiStopped, true);
      assert.equal(b.sidecarSha256, a.backendRevalidation.currentSha256);
      const hostLog = fs.readFileSync(path.join(path.dirname(bFile), "creation-api.log"), "utf8");
      const ready = JSON.parse(hostLog.match(/^AGENTVN_CREATION_HOST_READY (.+)$/m)[1]);
      assert.equal(path.dirname(ready.database), path.dirname(bFile));
      const pids = [b.service.pid, b.service.vitePid, ready.pid];
      const ports = [b.service.apiUrl, ready.apiUrl, ready.modelUrl].map(url => Number(new URL(url).port));
      const current = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `$p=@(Get-CimInstance Win32_Process -Filter '${pids.map(p => `ProcessId=${p}`).join(" OR ")}'|Select-Object ProcessId,CreationDate);` +
        `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
        `@{processes=$p;listeners=$l}|ConvertTo-Json -Depth 4 -Compress`], { encoding: "utf8", windowsHide: true }));
      assert.equal(current.processes.length, 0); assert.equal(current.listeners.length, 0);
      report.cleanup = { status: "PASS", pids, ports, current,
        qualifier: "Three recorded service PIDs and three known API/model ports; Vite port not recorded by original runner" };
      for (const s of ["scripts/assistant-agent-tools-playwright.cjs", "scripts/lib/owned-creation-api.cjs"])
        assert.equal(sha(path.join(root, s)), sha(path.join(checkpoint, s)), "Controlled behavior caller changed");
      report.validators = [1, 2].map(n => {
        const log = path.join(qa, `green-01/${n}.log`);
        const value = JSON.parse(fs.readFileSync(log, "utf8").trim().split(/\r?\n/).at(-1));
        assert.equal(value.status, "PASS"); assert(value.cases > 0);
        return { path: log, sha256: sha(log), cases: value.cases };
      });
      assert.deepEqual(report.validators.map(v => v.cases), [16, 22]);
      report.audit = { path: file, sha256: sha(file), receipts: a.receipts.length,
        sources: a.sourceChecks.length, references: a.evidenceChecks.length,
        bundled: a.bundledChecks.length, artifacts: a.artifactChecks.length };
      report.controlledLocalModelRequestsReferenced = 78;
      report.newModelRequests = 0;
    }
    for (const p of read(path.join(summary, "preparation.json")).products)
      assert.equal(sha(path.join(root, p.file)), p.sha256, "QA refresh changed a product");
    report.status = "PASS";
  })().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    report.qaSources = ["scripts/repair-candidate-refresh.cjs", "scripts/repair-candidate-preflight.cjs",
      "scripts/lib/repair-candidate-provenance.cjs", "scripts/repair-candidate-provenance-test.cjs"].map(file => {
      const source = path.join(root, file), target = path.join(out, "sources", file);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      return { file, sha256: sha(source), snapshot: target };
    });
    persist(); console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  });
}
