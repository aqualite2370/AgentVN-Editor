"use strict";
// Read-only final-project audit; no new device connection and no receipt rewriting.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const sharp = require("../GameCli_framework/node_modules/sharp");
const A = require("./lib/installed-acceptance.cjs");
const { verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { audit: auditCleanup } = require("./android-installed-cleanup-evidence-audit.cjs");
const { validateHiddenGrowthApk } = require("./lib/android-hidden-growth-flow.cjs");
assert.equal(process.argv.length, 5, "node final-android-audit <android-run> <cleanup-verification> <fresh-report>");
const [run, protectedFile, file] = process.argv.slice(2).map(p => path.resolve(p));
assert(A.inside(run, file) && !fs.existsSync(file));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => A.sha256(fs.readFileSync(f)), ev = f => ({ path: f, sha256: sha(f) });
const session = path.join(run, "installed-session"), runtimeRoot = path.join(session, "android-runtime");
const reportFile = path.join(run, "report.json");
const result = { status: "RUNNING", startedAt: new Date().toISOString(),
  sourceReport: ev(reportFile), scope: "Final canonical story installed-editor Android export and API35 real touch; not Android<10",
  originalReportsModified: false, checks: [] };
const save = () => fs.writeFileSync(file, JSON.stringify(result, null, 2));
async function check(name, action) {
  const row = { name, status: "RUNNING" }; result.checks.push(row); save();
  try { row.evidence = await action(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; throw e; } finally { save(); }
}
(async () => {
  const main = read(reportFile), runtimeFile = path.join(runtimeRoot, "runtime-smoke-report.json");
  const runtime = read(runtimeFile), launch = read(path.join(runtimeRoot, "acceptance-launch.json"));
  const request = read(path.join(session, "android-request.json")), boot = read(path.join(runtimeRoot, "cold-boot.json"));
  await check("Actual installed source, canonical authorization, APK byte provenance and versions", async () => {
    assert.equal(main.status, "INSTALLED_FINAL_HIDDEN_GROWTH_ANDROID_PASS");
    assert.equal(main.buildLaunch.originIsElevated, false); assert.equal(main.buildLaunch.isElevated, true);
    assert.equal(main.buildLaunch.exitCode, 0);
    assert.equal(main.imported.assetsVerified, 143);
    assert.equal(sha(main.apk.path), main.apk.sha256);
    assert.equal(sha(main.apk.metadata.path), main.apk.metadata.sha256);
    const metadata = read(main.apk.metadata.path);
    const provenance = verifyProvenance(main.apk.path, metadata), cleanup = auditCleanup(metadata);
    assert.equal(provenance.status, "PASS"); assert.equal(provenance.versionStatus, "RECORDED");
    assert.equal(cleanup.status, "PASS");
    assert.equal(metadata.engineVersion, metadata.runtimeVersion);
    // Verify public signature bytes directly. Do not read or initialize the user's signing keystore.
    const java = "C:\\Users\\1\\AppData\\Local\\AgentVN\\AndroidToolchain\\jdk-17\\bin\\java.exe";
    const signer = "C:\\Users\\1\\AppData\\Local\\AgentVN\\AndroidToolchain\\Sdk\\build-tools\\36.0.0\\lib\\apksigner.jar";
    const signature = spawnSync(java, ["-jar", signer, "verify", "--verbose", "--print-certs", main.apk.path],
      { windowsHide: true, encoding: "utf8", timeout: 120000 });
    assert.equal(signature.status, 0, `${signature.error || ""}\n${signature.stderr || ""}`);
    assert.match(signature.stdout, /Verified using v[123](?:\.1)? scheme[^\n]*true/i);
    const certificate = signature.stdout.match(/certificate SHA-256 digest:\s*([0-9a-f]{64})/i)?.[1];
    assert(certificate, "Actual signed APK certificate fingerprint missing");
    const sourceCaptureFile = path.join(run, "source-cartridge-original-bytes.json"), sourceCapture = read(sourceCaptureFile);
    assert.equal(sourceCapture.status, "SOURCE_CARTRIDGE_ORIGINAL_BYTES_PASS");
    assert.equal(sourceCapture.assets.length, 143);
    assert.equal(sourceCapture.sourceSha256, metadata.sourceCartridge.sha256);
    assert.equal(sourceCapture.sourceBytes, metadata.sourceCartridge.bytes);
    assert.equal(sourceCapture.sourcePath, metadata.sourceCartridge.path);
    assert(Date.parse(metadata.recordedAt) >= Date.parse(main.buildLaunch.requestedAt));
    for (const [kind, rel] of [["engine", "GameCli_framework/src-tauri/Cargo.toml"],
      ["protocol", "shared/cartridge/constants.ts"]])
      assert.equal(metadata.versionEvidence.sources[kind].sha256, sha(path.join(main.installRoot, rel)));
    const installation = read(main.installation.path);
    assert.equal(sha(main.installation.path), main.installation.sha256);
    const installed = installation.deployments.filter(d => d.kind === "NSIS actual isolated installation");
    assert.equal(installed.length, 1); assert.equal(installed[0].installedRoot, main.installRoot);
    assert.equal(sha(path.join(main.installRoot, "agentvn-editor.exe")), installed[0].executable.sha256);
    assert(main.resources.length >= 140);
    for (const resource of main.resources) {
      assert.equal(sha(path.join(main.installRoot, resource.relative)), resource.sha256);
      assert.equal(sha(path.join(__dirname, "..", resource.relative)), resource.sha256);
    }
    const cartridge = await validateHiddenGrowthApk(main.apk.path, main.proof.path);
    assert.equal(cartridge.assets.length, 143);
    assert.equal(runtime.hiddenGrowthInput.gameId, cartridge.gameId);
    assert.deepEqual(runtime.hiddenGrowthInput.assets, cartridge.assets);
    assert.equal(request.scope, "installed-hidden-growth");
    return { apk: main.apk, provenance, cleanup, sourceCartridge: ev(sourceCaptureFile), sourceAssets: cartridge.assets.length,
      signature: { status: "PASS", certificateSha256: certificate, java: ev(java), signer: ev(signer),
        command: [java, "-jar", signer, "verify", "--verbose", "--print-certs", main.apk.path],
        stdout: signature.stdout, stderr: signature.stderr, exitCode: signature.status },
      gameVersion: metadata.gameVersion, engineVersion: metadata.engineVersion,
      runtimeProtocolVersion: metadata.runtimeProtocolVersion, minimumRuntimeVersion: metadata.minimumRuntimeVersion };
  });
  await check("Actual touch, six canonical flows, all coverage, retained audio and scoped logs", () => {
    assert.equal(runtime.status, "RUNTIME_PASS"); assert.equal(runtime.scope, "installed-hidden-growth");
    assert.equal(runtime.interaction, "administrator-adb-real-touch");
    assert.equal(runtime.isElevated, true); assert(runtime.permission.isElevated && runtime.permission.success);
    assert.equal(launch.parentBoundary, "non-admin-to-RunAs");
    assert.equal(launch.status, "PASS");
    assert.equal(runtime.coldBoot.status, "PASS"); assert.equal(boot.audioEnabled, true);
    assert(!boot.arguments.includes("-no-audio"));
    assert.equal(Object.keys(runtime.requiredCoverage).length, 14);
    assert(Object.values(runtime.requiredCoverage).every(v => v === "PASS"));
    assert.equal(runtime.finalStory.cases.length, 6); assert(runtime.finalStory.cases.every(c => c.status === "PASS"));
    assert.equal(runtime.restartTrials.length, 6); assert.equal(runtime.logcat.fatal.length, 0);
    assert(runtime.rendererWarningAssessment.status.startsWith("PASS"));
    assert.equal(runtime.rendererWarningAssessment.unknownWarnings.length, 0);
    assert.equal(runtime.logcat.errors.length, 0, "Nonempty raw errors require a separate causal review; never silently filter");
    assert(runtime.touches.length >= 30); assert(runtime.systemBackEvents?.length >= 1);
    assert.equal(runtime.menuActions.mainMenu, "PASS");
    assert(Object.values(runtime.menuActions).every(v => v === "PASS"));
    assert.equal(runtime.rotationEvidence.status, "PASS"); assert.equal(runtime.runtimeStability.status, "PASS");
    assert.equal(runtime.stages.audio, "PASS"); assert.equal(runtime.audio.confirmationSource, "retained-user-confirmation");
    assert.equal(runtime.audioConfirmation.newCapture, false);
    assert(runtime.layoutChecks.length >= 15);
    assert(runtime.layoutChecks.every(c => !c.outOfBounds.length && !c.overlaps.length &&
      c.scrollWidth <= c.root.width + 1 && c.bodyScrollWidth <= c.root.width + 1));
    return { runtime: ev(runtimeFile), touches: runtime.touches.length, layoutChecks: runtime.layoutChecks.length,
      requiredCoverage: runtime.requiredCoverage, renderer: runtime.rendererWarningAssessment,
      audio: main.audio, sourceRuntimeLimit: runtime.excludedCoverage };
  });
  await check("Real Android landscape screenshots, XML and successful restart trials", async () => {
    assert(runtime.screens.length >= 20);
    const pngs = [];
    for (const screen of runtime.screens) {
      const meta = await sharp(screen.screenshot).metadata();
      assert(meta.width >= 1920 && meta.height >= 1080 && meta.width > meta.height);
      const xml = path.join(runtimeRoot, `${screen.label}.xml`);
      assert(fs.readFileSync(xml, "utf8").includes("<hierarchy"), `UIAutomator XML missing: ${screen.label}`);
      pngs.push({ label: screen.label, screenshot: ev(screen.screenshot), xml: ev(xml), width: meta.width, height: meta.height });
    }
    assert.deepEqual(runtime.restartTrials.map(t => t.kind).sort(),
      ["clean-install", "clean-install", "clean-install", "retained-data", "retained-data", "retained-data"]);
    for (const t of runtime.restartTrials) {
      assert.equal(sha(t.screenshotPath), t.screenshotSha256);
      assert.equal(t.fatal.length, 0); assert(t.layers && t.pssKb > 0);
    }
    return pngs;
  });
  await check("Uninstall, staging/source cleanup and owned process/port termination", () => {
    assert.equal(runtime.uninstallStatus, "PASS"); assert.equal(runtime.apkCleanupStatus, "PASS");
    assert.equal(runtime.cleanupError, null); assert.equal(runtime.stages.cleanup, "PASS");
    assert.equal(launch.emulatorCleanupStatus, "PASS");
    assert(!fs.existsSync(runtime.stagingApk.path)); assert.equal(sha(main.apk.path), main.apk.sha256);
    assert.equal(main.editorCleanup.editor.exitCode, 0); assert.equal(main.editorCleanup.backend.exitCode, 0);
    const pids = [...new Set([main.owner.editorPid, main.owner.backendPid, main.buildLaunch.elevatedProcessId,
      runtime.ownership.runnerPid, launch.processId, boot.launcherPid,
      ...(boot.processes || []).map(p => p.ProcessId)].filter(Number.isInteger))];
    const ports = [...new Set([main.owner.backendPort, main.owner.cdpPort, request.adbPort, request.cdpPort,
      request.coldBoot.adbPort, request.coldBoot.grpcPort])];
    const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      `$ids=@(${pids.join(",")});$ports=@(${ports.join(",")});@{processes=@(Get-CimInstance Win32_Process | Where-Object {$ids -contains $_.ProcessId} | Select-Object ProcessId,Name);` +
      `listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$ports -contains $_.LocalPort} | Select-Object LocalPort,OwningProcess)} | ConvertTo-Json -Depth 6 -Compress`],
    { windowsHide: true, encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 0, r.stderr); const remaining = JSON.parse(r.stdout.replace(/^\uFEFF/, ""));
    assert.deepEqual(remaining.processes, []); assert.deepEqual(remaining.listeners, []);
    return { pids, ports, remaining, sourceApkPreserved: true, uninstallStatus: runtime.uninstallStatus,
      apkCleanupStatus: runtime.apkCleanupStatus, emulatorCleanupStatus: launch.emulatorCleanupStatus };
  });
  await check("Original project, shared user database, Dev and prior historical evidence unchanged", () => {
    const protectedFiles = read(protectedFile).protectedFiles.filter(p => !/\\plans\\ACTIVE_TASKS\.md$/i.test(p.path));
    for (const p of protectedFiles) assert.equal(sha(p.path), p.sha256, `Protected source changed: ${p.path}`);
    assert(main.sourcePreserved && main.inputPreserved);
    return { count: protectedFiles.length, userSourcePreserved: true, editorProductNotRecompiled: true };
  });
  result.status = "INSTALLED_FINAL_HIDDEN_GROWTH_ANDROID_TERMINAL_PASS";
})().catch(e => { result.status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { result.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: result.status, file, error: result.error })); });
