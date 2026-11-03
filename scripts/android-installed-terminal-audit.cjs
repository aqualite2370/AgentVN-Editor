"use strict";
// Independent read-only audit. No new ADB server, build, install or mutation
// of the source receipt, APK, metadata, runtime logs or historical evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");
const { audit } = require("./android-installed-cleanup-evidence-audit.cjs");
const { validateWindowsPrerequisite } = require("./lib/installed-windows-prerequisite.cjs");
const { validateInstalledDefaultTitle } = require("./lib/installed-agentvn-title-prerequisite.cjs");
const { validateDefaultTitleApk } = require("./lib/android-default-title-flow.cjs");
const { assertDefaultTitle } = require("./lib/agentvn-default-title.cjs");
const sharp = require("../GameCli_framework/node_modules/sharp");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, "..");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => A.sha256(fs.readFileSync(file));
const evidence = file => ({ path: file, sha256: sha(file) });
function correlatedCacheErrors(lines, packageName) {
  const prefix = `/data/user/0/${packageName}/cache/WebView/Default/HTTP Cache/Code Cache/`;
  const groups = new Set();
  for (const line of lines) {
    const match = line.match(/^(\d\d-\d\d \S+\s+\d+\s+\d+)\s+E chromium: (.*)$/);
    if (!match) return false;
    if (["js", "wasm"].some(kind => match[2] ===
      `[ERROR:simple_file_enumerator.cc(21)] opendir ${prefix}${kind}: No such file or directory (2)`))
      groups.add(match[1]);
    else if (match[2] !== "[ERROR:simple_index_file.cc(614)] Could not reconstruct index from disk") return false;
  }
  return lines.every(line => groups.has(line.match(/^(\d\d-\d\d \S+\s+\d+\s+\d+)/)?.[1]));
}
async function main() {
  assert([4, 5].includes(process.argv.length), "node script <android-run-root> <fresh-audit-file> [--cache-reference=review]");
  const run = path.resolve(process.argv[2]), file = path.resolve(process.argv[3]);
  assert(A.inside(path.join(root, "output"), run) && A.inside(run, file));
  assert(!fs.existsSync(file), "Preserve previous audits");
  const cacheArg = process.argv[4];
  assert(!cacheArg || cacheArg.startsWith("--cache-reference="));
  const cacheReference = cacheArg && path.resolve(cacheArg.slice("--cache-reference=".length));
  const reportFile = path.join(run, "report.json"), session = path.join(run, "installed-session");
  const runtimeRoot = path.join(session, "android-runtime");
  const result = { status: "FAILED", checkedAt: new Date().toISOString(),
    scope: "Actual installed current export, scoped device logs and final cleanup",
    sourceReport: evidence(reportFile), originalEvidenceModified: false, checks: [] };
  async function check(name, action) {
    const row = { name, status: "FAILED" }; result.checks.push(row);
    row.evidence = await action(); row.status = "PASS";
  }
  try {
    const main = read(reportFile), runtime = read(path.join(runtimeRoot, "runtime-smoke-report.json"));
    const titleScope = runtime.scope === "installed-agentvn-title";
    const launch = read(path.join(runtimeRoot, "acceptance-launch.json"));
    const boot = read(path.join(runtimeRoot, "cold-boot.json")), request = read(path.join(session, "android-request.json"));
    await check("current installed export, Windows prerequisite and preserved source metadata", async () => {
      assert.equal(main.status, titleScope ? "INSTALLED_AGENTVN_DEFAULT_TITLE_ANDROID_PASS" : "INSTALLED_CURRENT_ANDROID_PASS");
      assert.equal(main.buildLaunch.originIsElevated, false); assert.equal(main.buildLaunch.isElevated, true);
      assert.equal(main.buildLaunch.exitCode, 0); assert.equal(main.versionProvenance.status, "PASS");
      assert.equal(sha(main.apk.path), main.apk.sha256); assert.equal(sha(main.apk.metadata.path), main.apk.metadata.sha256);
      const metadata = read(main.apk.metadata.path), cleanup = audit(metadata);
      assert.equal(cleanup.status, "PASS");
      const archive = await JSZip.loadAsync(fs.readFileSync(main.apk.path));
      const entries = Object.values(archive.files).filter(e => !e.dir && e.name.endsWith("embedded-cartridge/manifest.json"));
      assert.equal(entries.length, 1);
      const manifest = JSON.parse(await entries[0].async("string"));
      assert.equal(metadata.gameVersion, manifest.version);
      assert.equal(metadata.minimumRuntimeVersion, manifest.runtime_version);
      assert.equal(metadata.engineVersion, metadata.runtimeVersion);
      const installedAudit = path.join(session, "installer-resource-report.json");
      assert.equal(sha(main.windowsGate.path), main.windowsGate.sha256);
      if (titleScope) assert.equal(sha(read(main.windowsGate.path).installationAudit.path), sha(installedAudit),
        "Windows and Android must use the same installation audit bytes");
      const windows = titleScope
        ? validateInstalledDefaultTitle(main.windowsGate.path, { auditFile: read(main.windowsGate.path).installationAudit.path,
          fixture: read(main.sourceFixture.path) })
        : validateWindowsPrerequisite(main.windowsGate.path,
          { auditFile: installedAudit, fixture: { projectId: manifest.game_id } });
      if (titleScope) {
        const checkedTitle = await validateDefaultTitleApk(main.apk.path, main.sourceFixture.path);
        assert.equal(checkedTitle.gameId, manifest.game_id);
        assert.equal(request.scope, "installed-agentvn-title");
        result.scope = "Actual installed default-title only, precise logs and final cleanup; not full-story/legacy-device acceptance";
      }
      assert.equal(windows.currentInstallationVerified, true);
      const deployment = read(installedAudit).deployments.filter(d => d.kind === "NSIS actual isolated installation");
      assert.equal(deployment.length, 1); assert.equal(deployment[0].installedRoot, main.installRoot);
      assert.equal(sha(path.join(main.installRoot, "agentvn-editor.exe")), deployment[0].executable.sha256);
      assert(main.resources.length >= 155);
      for (const item of main.resources)
        for (const base of [root, main.installRoot]) assert.equal(sha(path.join(base, item.relative)), item.sha256);
      for (const [kind, relative] of [["engine", "GameCli_framework/src-tauri/Cargo.toml"],
        ["protocol", "shared/cartridge/constants.ts"]])
        assert.equal(metadata.versionEvidence.sources[kind].sha256, sha(path.join(main.installRoot, relative)));
      return { apk: main.apk, versions: main.versionProvenance, windows,
        installedSourceFiles: main.resources.length, cleanup };
    });
    await check("scoped actual-touch device flow, precise logs and honest audio source", async () => {
      assert.equal(runtime.status, "RUNTIME_PASS"); assert.equal(runtime.interaction, "administrator-adb-real-touch");
      assert.equal(runtime.isElevated, true);
      assert.equal(runtime.permission.isElevated, true); assert.equal(runtime.permission.success, true);
      assert.equal(launch.parentBoundary, "non-admin-to-RunAs"); assert.equal(launch.status, "PASS");
      assert.equal(runtime.coldBoot.status, "PASS"); assert.equal(boot.audioEnabled, true);
      assert(!boot.arguments.includes("-no-audio"));
      assert(Object.keys(runtime.requiredCoverage).length >= (titleScope ? 7 : 20));
      assert(Object.values(runtime.requiredCoverage).every(value => value === "PASS"));
      if (titleScope) {
        assert.deepEqual(Object.keys(runtime.requiredCoverage), ["title", "titleContrast", "settingsReturn", "aboutReturn",
          "startGame", "coldEmulatorBoot", "rendererWarnings"]);
        assert.equal(runtime.defaultTitleSamples.length, 3); assert.equal(runtime.defaultTitleRestartSamples.length, 6);
        for (const sample of [...runtime.defaultTitleSamples, ...runtime.defaultTitleRestartSamples]) {
          assert.equal(sha(sample.screenshot.path), sample.screenshot.sha256);
          assert.deepEqual(sample.before, sample.after);
          const png = await sharp(sample.screenshot.path).metadata();
          assert.equal(png.width, sample.png.width); assert.equal(png.height, sample.png.height);
          assert(png.width >= 1920 && png.height >= 1080 && png.width > png.height);
          const background = [...await sharp(sample.screenshot.path).removeAlpha().extract({
            left: Math.round(png.width * .04), top: Math.round(png.height * .3), width: 1, height: 1,
          }).raw().toBuffer()].slice(0, 3);
          assert.deepEqual(background, sample.background);
          assert.equal(assertDefaultTitle(sample.before, runtime.defaultTitleInput.fixture.title, background).contrast, sample.contrast);
        }
      } else {
        assert.equal(runtime.fullStory.cases.length, 7); assert(runtime.fullStory.cases.every(c => c.status === "PASS"));
      }
      assert.equal(runtime.restartTrials.length, 6); assert.equal(runtime.logcat.fatal.length, 0);
      assert(runtime.rendererWarningAssessment.status.startsWith("PASS"));
      assert.equal(runtime.rendererWarningAssessment.unknownWarnings.length, 0);
      let logReview = { status: "NO_ERRORS" };
      if (runtime.logcat.errors.length) {
        assert(cacheReference && fs.existsSync(cacheReference), "Actual cache errors require an explicit reviewed causal reference");
        assert(correlatedCacheErrors(runtime.logcat.errors, runtime.packageName),
          "Unknown or uncorrelated errors are not covered by the previous cache diagnosis");
        assert.match(runtime.webviewVersion,
          /Current WebView package \(name, version\): \(com\.google\.android\.webview, 124\.0\.6367\.219\)/);
        assert.equal(runtime.rendererWarningAssessment.stableLayers, true);
        assert.equal(runtime.rendererWarningAssessment.monotonicGrowth, false);
        assert.equal(runtime.rendererWarningAssessment.tileWarningCount, 0);
        assert.equal(new Set(runtime.restartTrials.map(t => t.screenshotSha256)).size, 1);
        logReview = { status: "NON_BLOCKING_THIS_APK_DEVICE_AND_RECORDED_PROVIDER_ONLY",
          retainedErrors: runtime.logcat.errors, priorCausalEvidence: evidence(cacheReference),
          limits: "Fresh correlated-message and stability review; prior native traces inform an engineering inference. No new native stack/provider binary capture, upstream-fix claim or exemption for other APKs/providers/errors." };
      }
      assert(runtime.touches.length > 0 && runtime.layoutChecks.length > 0 && runtime.screenshots.length > 0);
      const screenshots = runtime.screenshots.map(file => evidence(file));
      assert.equal(main.audio.newListening, false); assert.equal(sha(main.audio.path), main.audio.sha256);
      assert.equal(read(main.audio.path).status, "USER_CONFIRMED_PASS");
      return { coverage: runtime.requiredCoverage,
        ...(titleScope ? { titleSamples: 9, fullStory: "NOT_IN_THIS_SCOPE" }
          : { cases: runtime.fullStory.cases.map(c => ({ name: c.name, status: c.status })) }),
        touches: runtime.touches.length, geometryChecks: runtime.layoutChecks.length, screenshots,
        audio: main.audio, rendererAssessment: runtime.rendererWarningAssessment, logReview };
    });
    await check("finally cleanup and no owned host processes or listening ports", () => {
      assert.equal(runtime.uninstallStatus, "PASS"); assert.equal(runtime.apkCleanupStatus, "PASS");
      assert.equal(runtime.cleanupError, null); assert.equal(launch.emulatorCleanupStatus, "PASS");
      assert.equal(boot.emulatorCleanupStatus, "PASS"); assert.equal(fs.existsSync(runtime.stagingApk.path), false);
      assert.equal(sha(runtime.sourceApk.path), runtime.sourceApk.sha256);
      const pids = [...new Set([main.owner.editorPid, main.owner.backendPid, main.buildLaunch.elevatedProcessId,
        launch.processId, runtime.ownership.runnerPid, ...boot.processes.map(p => p.ProcessId)].filter(Boolean))];
      const ports = [main.owner.backendPort, main.owner.cdpPort, request.adbPort, request.cdpPort,
        request.coldBoot.adbPort, request.coldBoot.grpcPort];
      const command = `$ErrorActionPreference='Stop'; $pidsToCheck=@(${pids.join(",")}); $portsToCheck=@(${ports.join(",")}); `
        + `@{processes=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -in $pidsToCheck} `
        + `| Select-Object ProcessId,Name,CreationDate); listeners=@(Get-NetTCPConnection -State Listen `
        + `-ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in $portsToCheck} `
        + `| Select-Object LocalPort,OwningProcess)} | ConvertTo-Json -Depth 5 -Compress`;
      const host = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
        { windowsHide: true, encoding: "utf8", timeout: 30000 }));
      assert.equal(host.processes.length, 0); assert.equal(host.listeners.length, 0);
      return { checkedPids: pids, checkedPorts: ports, host, sourceApk: evidence(runtime.sourceApk.path),
        uninstallStatus: runtime.uninstallStatus, apkCleanupStatus: runtime.apkCleanupStatus };
    });
    result.status = "INSTALLED_DEVICE_PROVENANCE_AND_CLEANUP_AUDIT_PASS";
  } catch (error) { result.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    assert.equal(sha(reportFile), result.sourceReport.sha256);
    fs.writeFileSync(file, JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: result.status, file, checks: result.checks.map(c => ({ name: c.name, status: c.status })),
      error: result.error }));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { correlatedCacheErrors };
