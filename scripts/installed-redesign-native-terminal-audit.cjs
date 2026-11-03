"use strict";
// Read-only audit of the native supplement, including its preserved failures.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha256, inside, validateNativeResult } = require("./lib/installed-acceptance.cjs");
const [rootArg, outArg] = process.argv.slice(2);
assert(rootArg && outArg);
const root = path.resolve(rootArg), out = path.resolve(outArg);
assert(root.startsWith("F:\\AgentVN\\QA\\") && inside(root, out) && !fs.existsSync(out));
fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file));
const at = relative => read(path.join(root, relative));
const first = at("installed-flow-03/native-supplement-02/report.json");
const last = at("installed-flow-03/native-supplement-03/report.json");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [],
  scope: "P5_NATIVE_WORKFLOW_SUPPLEMENT_ONLY", modelRequests: 0,
  Android: "NOT_RUN", wholeProjectAcceptance: false, physical4K: false };
async function check(name, action) { report.cases.push({ name, status: "PASS", detail: await action() }); }
(async () => {
  await check("historical-failures-preserved-and-four-workflow-groups-accounted", () => {
    assert.equal(at("installed-flow-03/native-supplement-01/report.json").status, "FAILED");
    assert.equal(first.status, "FAILED"); assert.equal(first.cases.length, 2);
    assert(first.error.includes("Native result must match the requested cancel/select operation"));
    assert.equal(last.status, "PASS"); assert.equal(last.cases.length, 2);
    assert([...first.cases, ...last.cases].every(c => c.status === "PASS"));
    assert.equal(new Set([...first.cases, ...last.cases].map(c => c.name)).size, 4);
    assert.equal(sha256(fs.readFileSync(last.resumeEvidence.path)), last.resumeEvidence.sha256);
    assert.equal(last.resumeEvidence.originalStatus, "FAILED");
    assert.equal(at("installed-flow-03/report.json").status, "BLOCKED");
    assert.equal(sha256(fs.readFileSync(last.originalReport.path)), last.originalReport.sha256);
    assert.equal(last.originalReport.sha256, "d4a592698a49ade0f436a70c992b744e51c9adb70b2a10d42b130aa3e5803137");
    return { inheritedGroups: 2, newGroups: 2, historicalStatuses: ["FAILED", "FAILED", "BLOCKED"] };
  });
  await check("real-input-receipts-natural-exits-and-same-data-restart", () => {
    const reopened = last.cases[0].detail;
    const inputs = [first.cases[0].detail.input, first.cases[1].detail.input,
      reopened.cancelled, reopened.opened];
    for (const input of inputs) {
      validateNativeResult(input.request, input.result);
      assert(input.result.interaction.includes("Computer Use"));
      assert.deepEqual(read(input.request.completion), input.result);
    }
    const closes = [reopened.closed, last.cases[1].detail];
    for (const closed of closes) {
      assert.equal(closed.editorExitedNaturally, true);
      assert.equal(closed.cleanup.editor.alreadyExited, true);
      assert.equal(closed.cleanup.editor.exitCode, 0);
      assert.equal(closed.result.requestId, closed.request.requestId);
      assert.equal(closed.result.ownerPid, closed.request.ownerPid);
      assert(closed.result.interaction.includes("Computer Use"));
      assert.deepEqual(read(closed.request.completion), closed.result);
    }
    assert.equal(last.launches.length, 2);
    const [before, after] = last.launches;
    assert.notEqual(before.editorPid, after.editorPid);
    assert.notEqual(before.backendPid, after.backendPid);
    assert.equal(before.databasePath, after.databasePath);
    assert.equal(before.webviewRoot, after.webviewRoot);
    assert.equal(reopened.libraryEntries, 1);
    return { nativeInputs: inputs.length, normalCloses: closes.length,
      databasePath: before.databasePath, webviewRoot: before.webviewRoot, libraryEntries: 1 };
  });
  await check("retained-portable-resource-bytes-and-screenshot-parameters", async () => {
    const artifact = last.portable;
    assert.deepEqual(artifact, first.portable); assert(inside(root, artifact.path));
    const bytes = fs.readFileSync(artifact.path);
    assert.equal(sha256(bytes), artifact.sha256); assert.equal(bytes.length, artifact.bytes);
    const zip = await JSZip.loadAsync(bytes), project = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(project.asset_manifest.length, artifact.assets.length);
    assert.equal(project.editor_settings.runtimeUILayoutProfiles.activeType, "renpy");
    assert(!JSON.stringify(project).includes(path.dirname(artifact.path)));
    for (const asset of artifact.assets) {
      const record = project.asset_manifest.find(a => a.asset_id === asset.id);
      assert(record); assert.equal(record.asset_type, asset.type);
      assert.equal(sha256(await zip.file(record.metadata.project_path).async("nodebuffer")), asset.sha256);
    }
    const images = [...first.cases, last.cases[0]].map(c => c.detail.screenshot);
    for (const image of images) {
      assert.deepEqual(image.before, image.after);
      const png = fs.readFileSync(image.path); assert.equal(sha256(png), image.sha256);
      assert.equal(png.readUInt32BE(16), image.before.width * image.before.dpr);
      assert.equal(png.readUInt32BE(20), image.before.height * image.before.dpr);
    }
    return { artifact, screenshotCount: images.length, nativeSupplementNotDisplayMatrix: true };
  });
  await check("frozen-dev-installer-installation-and-shared-database-unchanged", () => {
    const built = at("release-package-01/report.json"), install = at("release-install-01/actual-installation.json");
    assert.equal(built.status, "PASS"); assert.equal(install.status, "PASS");
    const dev = "D:\\AgentVN\\AgentVN Dev.exe";
    assert.equal(sha256(fs.readFileSync(dev)), built.beforeDev.sha256);
    assert.equal(sha256(fs.readFileSync(dev)),
      sha256(fs.readFileSync("D:\\AgentVN\\editor\\src-tauri\\target\\debug\\agentvn-editor.exe")));
    const installer = built.newInstallers[0];
    assert.equal(sha256(fs.readFileSync(installer.path)), installer.sha256);
    assert.equal(sha256(fs.readFileSync(install.executable.path)), install.executable.sha256);
    const player = at("installed-hide-matrix-06/report.json").playerExecutable;
    assert.equal(sha256(fs.readFileSync(player.path)), player.sha256);
    const database = path.join(process.env.APPDATA, "com.agentvn.editor/backend/vn_engine.db");
    const hash = sha256(fs.readFileSync(database));
    assert.equal(hash, "984d7a62038312040b8d510312bb01ef0268e8d9c9987ea04181db531f4ab1e3");
    return { devSha256: built.beforeDev.sha256, installer, editor: install.executable, player,
      sharedDatabase: { path: database, sha256: hash } };
  });
  await check("all-native-attempt-processes-and-ports-stopped", () => {
    const run = path.join(root, "installed-flow-03");
    for (const name of ["native-supplement-01", "native-supplement-02", "native-supplement-03"]) {
      const result = read(path.join(run, name, "report.json")); assert.equal(result.modelRequests, 0);
      assert(result.cleanup.length > 0);
      assert(result.cleanup.every(c => c.editor.exitCode === 0 && c.backend.exitCode === 0));
    }
    const states = fs.readdirSync(run).filter(n => /^owned-launch-\d+$/.test(n))
      .map(n => read(path.join(run, n, "installed-processes.json")));
    const pids = [...new Set(states.flatMap(s => [s.editorPid, s.backendPid]))];
    const ports = [...new Set(states.flatMap(s => [s.backendPort, s.cdpPort]))];
    assert(pids.length && ports.length);
    const actual = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$qaNativePids=@(${pids.join(",")}); $qaNativePorts=@(${ports.join(",")}); ` +
      "[pscustomobject]@{processes=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $qaNativePids } | Select-Object ProcessId,ExecutablePath);" +
      "listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $qaNativePorts } | Select-Object LocalPort,OwningProcess)} | ConvertTo-Json -Depth 4 -Compress"],
    { windowsHide: true, encoding: "utf8" }));
    assert.equal(actual.processes.length, 0); assert.equal(actual.listeners.length, 0);
    return { launches: states.length, pidCount: pids.length, portCount: ports.length, actual };
  });
  assert.equal(report.cases.length, 5); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
});
