"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Project-Import-Atomic-20261020-01";
const summary = path.join(root, "output/project-import-atomic-20261020-01");
const iteration = process.argv[2] || "01"; assert(/^\d{2}$/.test(iteration));
const out = path.join(qa, `closeout-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  generatedAt: fs.statSync(file).mtime.toISOString() });
const evidence = name => { const file = path.join(qa, name, "report.json"); return { file, data: read(file), reference: describe(file) }; };
const receipt = { status: "RUNNING", at: new Date().toISOString(), checks: [], modelRequests: 0,
  scope: "SOURCE_BROWSER_IMPORT_TRANSACTION_AND_DEV_NOT_INSTALLED_ACCEPTANCE",
  historicalInstalledLedger: { PASS: 3, FAILED: 9, BLOCKED: 6 },
  notProven: ["New Dev native UI or new Release installation", "Windows/Android exports or upgrade",
    "Native ticket/fallback transport (shared final commit branch changed, no new native input acceptance)",
    "General offline-save behavior (left unchanged)", "Real model/final project"] };
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; receipt.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
(async () => {
  const prep = read(path.join(summary, "preparation.json"));
  const full = evidence("green-03-full"), gates = evidence("check-01"), dev = evidence("dev-01");
  const runNames = ["red-01", "red-02", "red-03-probe", "green-01-smoke", "green-02-full", "green-03-full"];
  const runs = runNames.map(evidence);
  await check("Original rejected imports and save-boundary observation remain immutable", () => {
    for (const r of runs) {
      assert.equal(sha(path.join(path.dirname(r.file), "executed-test.cjs")), r.data.testSource.sha256);
      assert.equal(r.data.modelRequests, 0); assert.equal(r.data.cleanup.status, "PASS");
    }
    const reds = runs.slice(0, 3);
    for (const r of reds) {
      assert.equal(r.data.status, "FAILED");
      assert.match(r.data.error, /failed import changed current graph/);
      assert.equal(r.data.cases[0].attempts[0].responseStatus, 422);
    }
    const probe = reds[2].data.cases[0].attempts[0];
    assert.notEqual(probe.atSaveBoundary.metadata.projectId, probe.before.metadata.projectId);
    assert.equal(probe.homeVisible, false); assert.deepEqual(probe.alert, []);
    assert.equal(probe.backendCatalog.length, 1);
    assert.equal(probe.backendCatalog[0].project_id, probe.before.metadata.projectId);
    assert.equal(runs[4].data.status, "FAILED");
    assert.match(runs[4].data.error, /network-abort: no actionable error/);
    assert(runs[4].data.cases[0].attempts.at(-1).alert[0].includes("无法连接后端服务"));
    return { historical: runs.map(r => ({ ...r.reference, originalStatus: r.data.status })),
      localizationObserverCorrection: "Expected English fetch substring replaced with actual localized error and exact backend URL; preservation assertions unchanged" };
  });
  await check("Twelve displays and all forty-eight rejections preserve current state exactly", () => {
    const f = full.data; assert.equal(f.status, "PASS"); assert.equal(f.cases.length, 12);
    const expected = [1920, 2560, 3840].flatMap(width =>
      [1, 2].flatMap(dpr => [false, true].map(reduced => JSON.stringify([width, dpr, reduced]))));
    assert.deepEqual(f.cases.map(c => JSON.stringify([c.width, c.dpr, c.reduced])).sort(), expected.sort());
    for (const c of f.cases) {
      assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 7);
      assert.deepEqual(c.attempts.map(a => a.fault), ["invalid-encoding", "same-id-invalid", "http-503", "network-abort"]);
      for (const a of c.attempts) {
        assert.equal(a.status, "PASS"); assert.equal(a.homeVisible, true); assert(a.alert.length);
        assert.deepEqual(a.after, a.before);
        if (a.fault === "invalid-encoding") assert.deepEqual(a.atSaveBoundary, a.before);
        if (a.boundary === "ACTUAL_BACKEND_422") assert.equal(a.responseStatus, 422);
      }
    }
    return { evidence: full.reference, displayCombinations: 12, groupedChecks: 84,
      actualBackend422: 24, controlledTransportFailures: 24, originalProbeNowPreservesStateBeforeHTTP: true };
  });
  await check("Reloaded real portable packages and actual screenshot pixels match evidence", async () => {
    const prepared = read(prep.fixtures.find(f => f.path.endsWith("修正后再导入.vnproj")).path);
    const expected = Buffer.from(prepared.asset_manifest[0].metadata.data_url.split(",")[1], "base64");
    const packages = [], screenshots = [];
    for (const c of full.data.cases) {
      const p = c.portable; assert.equal(sha(p.path), p.sha256);
      const z = await JSZip.loadAsync(fs.readFileSync(p.path));
      const project = JSON.parse(await z.file("project.json").async("string")); assert.equal(project.asset_manifest.length, 1);
      assert(project.project_id.endsWith(c.key));
      const bytes = await z.file(project.asset_manifest[0].metadata.project_path).async("nodebuffer");
      assert.deepEqual(bytes, expected); packages.push(describe(p.path));
      assert.equal(c.screenshots.length, 2);
      for (const s of c.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        assert.deepEqual(s.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
        const png = fs.readFileSync(s.path);
        assert.equal(png.readUInt32BE(16), c.width * c.dpr); assert.equal(png.readUInt32BE(20), c.height * c.dpr);
        screenshots.push({ ...describe(s.path), png: s.png });
      }
    }
    receipt.packages = packages;
    return { portablePackages: packages, screenshots, qualification: "Owned source browser; not native WebView or physical 4K display" };
  });
  await check("All direct regressions and sequential builds finished before full Dev build", () => {
    for (const r of [gates, dev]) {
      assert.equal(r.data.status, "PASS"); assert(r.data.steps.length);
      assert(r.data.steps.every(s => s.exitCode === 0 && s.status === "PASS"));
      for (const s of r.data.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
    }
    assert.equal(gates.data.steps.length, 11); assert.equal(dev.data.steps.length, 1);
    assert(full.data.finishedAt <= gates.data.at); assert(gates.data.finishedAt <= dev.data.at);
    assert.deepEqual(gates.data.steps.slice(-3).map(s => s.command.at(-1)), ["typecheck", "build", "build"]);
    const python = gates.data.steps.find(s => s.command[0] === "python"); assert(python);
    assert.match(fs.readFileSync(python.logPath, "utf8"), /83 passed/);
    receipt.commands = [...gates.data.steps, ...dev.data.steps].map(s => ({ ...s, log: describe(s.logPath) }));
    return { gates: gates.reference, dev: dev.reference, directAndBackendSteps: 8, sequentialBuildSteps: 3 };
  });
  await check("Actual Dev overwrite, current counterpart hashes and only authorized App function changed", () => {
    receipt.dev = dev.data.dev; receipt.player = dev.data.player;
    assert.equal(sha(receipt.dev.path), receipt.dev.sha256);
    assert.equal(sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), receipt.dev.sha256);
    assert.equal(sha(receipt.player.path), receipt.player.sha256);
    assert.equal(sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")), receipt.player.sha256);
    assert(!fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")));
    const old = prep.saved.find(s => s.file === "AgentVN Dev.exe"); assert.notEqual(receipt.dev.sha256, old.sha256);
    const app = path.join(root, "editor/src/app/App.tsx");
    const before = fs.readFileSync(path.join(prep.checkpoint, "editor/src/app/App.tsx"), "utf8").replace(/\r\n/g, "\n");
    const after = fs.readFileSync(app, "utf8").replace(/\r\n/g, "\n");
    const withoutCommit = text => text.replace(/  async function finishProjectImport\([\s\S]*?(?=  async function selectProjectImportFile)/, "");
    assert.notEqual(after, before); assert.equal(withoutCommit(after), withoutCommit(before));
    for (const s of full.data.sources.filter(s => s.file !== "editor/src/app/App.tsx"))
      assert.equal(sha(path.join(root, s.file)), prep.saved.find(p => p.file === s.file).sha256);
    receipt.resources = { frontendSources: [{ file: "editor/src/app/App.tsx", sha256: sha(app) }] };
    const backendPath = path.join(root, "editor/src-tauri/binaries/creator-backend.exe");
    assert.equal(sha(backendPath), prep.saved.find(p => p.file === "editor/src-tauri/binaries/creator-backend.exe").sha256);
    receipt.backendUnchanged = describe(backendPath);
    receipt.compiled = ["GameCli_framework/dist/assets", "editor/dist/gamecli-preview/assets", "editor/dist/assets"].map(dir => {
      const names = fs.readdirSync(path.join(root, dir)).filter(n =>
        (dir === "editor/dist/assets" ? /^index-.*\.js$/ : /^StoryPlayer-.*\.js$/).test(n));
      assert.equal(names.length, 1); return describe(path.join(root, dir, names[0]));
    });
    assert.equal(receipt.compiled[0].sha256, receipt.compiled[1].sha256);
    return { onlyProductFunctionChanged: "App.finishProjectImport", previousDevSha256: old.sha256,
      editorMotionChanged: false, runtimeChanged: false, backendChanged: false,
      compiledCoverage: "Editor entry JS and two Runtime JS samples; not all dist files" };
  });
  await check("Checkpoint, frozen installation and every recorded service cleanup retained", () => {
    for (const s of prep.saved) assert.equal(sha(path.join(prep.checkpoint, s.file)), s.sha256);
    for (const f of prep.fixtures) assert.equal(sha(f.path), f.sha256);
    const audit = read("F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-07/audit.json");
    receipt.frozen = audit.artifactChecks.filter(a => a.label.startsWith("frozen installed"));
    assert.equal(receipt.frozen.length, 3);
    for (const f of receipt.frozen) assert.equal(sha(f.path), f.sha256);
    const pids = [...new Set(runs.flatMap(r => r.data.cleanup.pids))];
    const ports = [...new Set(runs.flatMap(r => r.data.cleanup.ports))];
    const current = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$p=@(Get-CimInstance Win32_Process -Filter '${pids.map(p => `ProcessId=${p}`).join(" OR ")}'|Select-Object ProcessId,CreationDate);` +
      `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
      `@{processes=$p;listeners=$l}|ConvertTo-Json -Compress -Depth 4`], { encoding: "utf8", windowsHide: true }));
    assert.equal(current.processes.length, 0); assert.equal(current.listeners.length, 0);
    receipt.cleanup = { status: "PASS", pids, ports, current }; return receipt.cleanup;
  });
  receipt.status = "SOURCE_AND_DEV_PASS";
})().catch(error => { receipt.status = "FAILED"; receipt.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  receipt.finishedAt = new Date().toISOString();
  receipt.qaSources = ["scripts/project-import-atomic-playwright.cjs", "scripts/project-import-atomic-gates.cjs",
    "scripts/project-import-atomic-closeout.cjs"].map(file => {
    const source = path.join(root, file), target = path.join(out, "sources", file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    return { file, sha256: sha(source), snapshot: target };
  });
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  fs.copyFileSync(path.join(out, "receipt.json"), path.join(summary, `receipt-${iteration}.json`), fs.constants.COPYFILE_EXCL);
  console.log(JSON.stringify({ status: receipt.status, out, error: receipt.error }));
});
