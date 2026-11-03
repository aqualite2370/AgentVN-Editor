"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const run = "D:/AgentVN/output/installed-gui-session-20261018-01";
const reference = "D:/AgentVN/output/installed-gui-20261018-01", destination = process.argv[2];
assert(destination && !fs.existsSync(destination));
const sha = b => crypto.createHash("sha256").update(b).digest("hex"), fileSha = f => sha(fs.readFileSync(f));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", g14Status: "FAILED",
  at: new Date().toISOString(), checks: [], inputs: [], commands: [], error: null, productChanges: 0, realModelRequests: 0,
  blocked: ["Correct desktop default import, subsequent correct-value native save/restart/reimport/export/player consumption",
    "Native resource directory picker not tested in this ZIP session",
    "Full Runtime motion, physical4K and Android not tested here"] };
function load(root, name) {
  const f = path.join(root, name); report.inputs.push({ path: f, sha256: fileSha(f) }); return read(f);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const download = load(reference, "official-download-02.json"), extracted = load(reference, "official-extract.json");
  const generated = load(reference, "official-generate-02.json");
  const author = load(run, "author-01/report.json"), defect = load(run, "defect-audit-02.json");
  const negative = load(run, "negative-01/report.json"), prep = load(run, "preparation.json");
  const fixture = load(run, "fixtures.json"), launch = load(run, "launch.json"), backend = load(run, "backend-ready.json");
  await check("Official SDK SHA and six tagged template/generator sources plus complete authentic generated resources are traced", async () => {
    for (const r of [download, extracted, generated]) assert.equal(r.status, "PASS");
    assert.equal(fileSha(download.download.path), download.download.sha256);
    assert.equal(download.download.sha256, "ff57648f9c04f27e381c48af6d8e3ee3cdec296bed4d3831f47f09b0a71b505e");
    assert.equal(extracted.sourceComparison.length, 6);
    for (const row of extracted.sourceComparison) assert.equal(row.actualSha256, row.gitBlobSha256);
    assert.equal(generated.command.exitCode, 0); assert.equal(generated.ref, "39895c1e017f0b36ffea2447d97eccd69d76ee1c");
    assert.equal(generated.generated.images, 24); assert.equal(generated.generated.fonts, 1);
    assert.equal(generated.resolvedCommonDependencies.length, 2);
    assert.equal(fileSha(generated.generated.archive.path), generated.generated.archive.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(generated.generated.archive.path));
    for (const f of generated.files) {
      assert.equal(fileSha(path.join(generated.generated.directory, f.relative)), f.sha256);
      assert.equal(sha(await zip.file(`官方模板 中文/game/${f.relative}`).async("nodebuffer")), f.sha256);
    }
    assert.equal(fixture.officialArchive.sha256, generated.generated.archive.sha256);
    return { sdk: download.download, tag: generated.tag, ref: generated.ref,
      authenticPngs: 24, commonFont: 1, archive: generated.generated.archive,
      generatorNotRunInsideAgentVnImporter: true };
  });
  await check("Original installed full-template regression fails on incorrect desktop defaults, not on missing test assets", () => {
    assert.equal(author.status, "FAILED"); assert(author.error.includes("30 !== 22"));
    assert.equal(author.checks.length, 2); assert(author.checks.every(c => c.status === "PASS"));
    assert.equal(author.matrix.length, 12);
    const keys = new Set(author.matrix.map(r => `${r.width}/${r.height}/${r.dpr}/${r.reduced}`));
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const m of [false, true])
      assert(keys.has(`${w}/${h}/${d}/${m}`));
    assert(author.matrix.every(r => r.status === "PASS"));
    assert(author.scan.summary.includes("25 个素材候选") && author.scan.summary.includes("147 条待确认内容"));
    assert(author.scan.issues.includes("unsupported_script") && author.scan.parameters.some(s => s.includes("shared.fontSize") && s.includes("30")));
    return { productStatus: "FAILED", scanCancelAndGeometryChecks: 2, actualMatrix: 12, issuesExplicitlyReported: 147 };
  });
  await check("Independent live/per-project persistence and minimal source probes establish conditional-scope loss", () => {
    assert.equal(defect.status, "FAILED"); assert.equal(defect.evidenceStatus, "PASS"); assert.equal(defect.error, null);
    assert.equal(defect.checks.length, 4); assert.equal(defect.probes.length, 4);
    assert.equal(defect.probes.filter(p => p.status === "FAILED").length, 2);
    assert(defect.probes.filter(p => p.status === "FAILED").every(p => p.expected === 22 && p.observed === 30));
    assert.equal(defect.actualLayoutValues.actual.fontSize, 30);
    assert.equal(defect.actualLayoutValues.desktopTemplate.fontSize, 22);
    assert.equal(defect.persistedProject.values.shared.fontSize, 30);
    assert.equal(defect.persistedProject.values.shared.spacing, 20);
    assert.equal(defect.persistedProject.values.save_load.saveColumns, 2);
    assert.equal(fileSha(defect.source.path), defect.source.sha256);
    assert.equal(defect.assetProofs.length, 25);
    for (const a of defect.assetProofs) assert.equal(a.sha256, generated.files.find(f => f.relative === a.relative).sha256);
    assert(defect.fontCoverage.includes("项目字符存在缺字") && defect.fontCoverage.includes("回退到系统字体"));
    return { defect: defect.defect, actual: defect.actualLayoutValues, cause: defect.cause,
      importedExactResources: 25, fontCoverage: defect.fontCoverage };
  });
  await check("Eight actual installed malicious/damaged scans and conflicting-binding transaction retain original data", () => {
    assert.equal(negative.status, "PASS"); assert.equal(negative.error, null); assert.equal(negative.errors.length, 0);
    assert.equal(negative.cases.length, 8); assert(negative.cases.every(c => c.status === "PASS"));
    for (const c of negative.cases) assert.equal(fileSha(c.path), c.sha256);
    assert.equal(negative.checks.length, 2); assert(negative.checks.every(c => c.status === "PASS"));
    assert(negative.conflictError.includes("BINDING_CONFLICT:title_background"));
    return { cases: negative.cases, conflict: negative.conflictError };
  });
  await check("Fifteen raw native screenshots preserve actual viewport, DPR, reduced-motion and exact PNG/SHA", () => {
    const shots = [author, defect, negative].flatMap(r => r.screenshots); assert.equal(shots.length, 15);
    for (const s of shots) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha(bytes), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    return { screenshots: 15, physical4k: false, fullTransitionAudit: false };
  });
  await check("Frozen source support tests are executed separately and do not overrule real installed template failure", () => {
    const candidate = read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    const files = ["shared/cartridge/renpyGui.ts", "editor/src/renpy/renpyGuiImport.ts", "editor/src/renpy/renpyGuiImportPlan.ts",
      "editor/src/components/advanced/RenpyGuiImportWorkbench.tsx", "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx"];
    for (const relative of files) {
      const f = path.resolve("D:/AgentVN", relative), c = candidate.source.find(s => path.resolve(s.path).toLowerCase() === f.toLowerCase());
      assert(c); assert.equal(fileSha(f), c.sha256);
    }
    for (const script of ["renpy-gui-import-contract-test.cjs", "renpy-gui-archive-scan-test.cjs",
      "renpy-gui-import-apply-test.cjs", "renpy-gui-import-roundtrip-test.cjs"]) {
      const r = spawnSync(process.execPath, [path.join("scripts", script)],
        { cwd: "D:/AgentVN", windowsHide: true, encoding: "utf8", timeout: 60000 });
      report.commands.push({ command: `node scripts/${script}`, exitCode: r.status,
        status: r.status === 0 ? "PASS" : "FAILED", stdout: r.stdout, stderr: r.stderr });
      assert.equal(r.status, 0, r.stderr); assert(r.stdout.includes("PASS"));
    }
    return { matchingSourceFiles: 5, passingSourceSupportTests: 4, productScopeNotPromoted: true };
  });
  await check("Four original profiles/55 independent bytes, original DB/Dev and pending MSI EXE are unchanged", () => {
    const restore = load(run, "profile-restoration.json"); assert.equal(restore.status, "PASS");
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original)); assert(!fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(fileSha(path.join(p.original, f.relative)), f.sha256);
        assert.equal(fileSha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); assert.equal(fileSha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const incident = read("D:/AgentVN/output/host-msi-session-20261018-01/incident-audit-01.json");
    assert.equal(fileSha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(fileSha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    return { originals: 55, originalDbUnchanged: true, rootDevUnchanged: true, msiUntouched: true };
  });
  await check("Installed provenance, attributed cleanup and no owned process/port residues are verified", () => {
    assert.equal(launch.status, "PASS"); assert.equal(backend.status, "PASS");
    assert.equal(fileSha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
    assert.equal(launch.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(fileSha(path.join(launch.installRoot, "creator-backend.exe")), backend.backendSha256);
    assert(!launch.dataDirectoryOverride && !launch.webviewDirectoryOverride && !launch.manualBackendSpawn);
    const cleanup = load(run, "computer-use-import-blocked.json");
    assert.equal(cleanup.cleanupStatus, "PASS"); assert.equal(cleanup.normalClose, "NOT_RUN_CONTROLLED_TEST_TEARDOWN");
    const ports = [8278, launch.cdpPort, launch.playerCdpPort];
    const state = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object ProcessId,Name)
      $s=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$p;ports=$s}|ConvertTo-Json -Depth 6
    `], { windowsHide: true, encoding: "utf8", timeout: 15000 });
    assert.equal(state.status, 0, state.stderr);
    const current = JSON.parse(state.stdout.replace(/^\uFEFF/, ""));
    assert.equal(current.processes.length, 0); assert.equal(current.ports.length, 0);
    return { ...current, portsChecked: ports, normalWindowClose: "NOT_RUN", cleanMachineClaim: false };
  });
  await check("Preparation/capture failures stay immutable; no dependent acceptance is silently promoted", () => {
    for (const [root, name] of [[reference, "official-download.json"], [reference, "official-generate.json"],
      [run, "defect-audit-01.json"]]) assert.equal(load(root, name).status, "FAILED");
    assert([author, defect, negative, fixture, generated, launch].every(r => r.realModelRequests === 0));
    return { retainedToolFailures: 3, retainedProductFailure: true, blocked: report.blocked };
  });
  report.status = "PASS"; report.evidenceStatus = "PASS";
})().catch(e => { report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, g14Status: report.g14Status,
    checks: report.checks.length, error: report.error, destination }, null, 2));
});
