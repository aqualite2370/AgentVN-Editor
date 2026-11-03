"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { allocateAndroidDevicePorts } = require("./lib/android-device-ports.cjs");
const { validateNavigationRequest } = require("./android-current-navigation.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
async function main() {
  const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
  const probe = process.argv[3]; assert(probe === undefined || probe === "--exit-probe");
  const trace = process.argv[4]; assert(trace === undefined || (trace === "--trace-exit" && probe));
  const root = "F:\\AgentVN\\QA\\Android-Package-20261021-01";
  const out = path.join(root, "device-navigation-12-" + attempt); fs.mkdirSync(out);
  const r = { status: "PREPARING", startedAt: new Date().toISOString(),
    scope: "CURRENT_SIGNED_APK_AGENTVN_NAVIGATION_NOT_FULL_ANDROID", productChanges: 0, modelRequests: 0, buildInvocations: 0 };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  try {
    const source = read(path.join(root, "device-upgrade-12-08/request-submitted.json"));
    const [adbPort, cdpPort, bootPort, grpcPort] = await allocateAndroidDevicePorts();
    const request = { ...source, scope: "installed-current-navigation", runId: `android-navigation-12-${attempt}`,
      outputDir: path.join(out, "runtime"), adbPort, cdpPort,
      ...(probe ? { exitProbe: "no-game-autosave-disabled" } : {}),
      ...(trace ? { traceExitBoundary: true } : {}),
      coldBoot: { ...source.coldBoot, adbPort: bootPort, grpcPort } };
    validateNavigationRequest(request);
    r.tools = ["android-current-navigation.cjs", "android-current-navigation-launch.cjs", "start-android-acceptance.ps1",
      "android-cold-boot.ps1", "android-acceptance-preflight.ps1", "visible-control-geometry.cjs",
      "lib/android-exit-observer.cjs"].map(name => {
      const file = path.join(__dirname, name); fs.copyFileSync(file, path.join(out, path.basename(name)), fs.constants.COPYFILE_EXCL);
      return fileEvidence(file);
    });
    const file = path.join(out, "request.json"); fs.writeFileSync(file, JSON.stringify(request, null, 2), { flag: "wx" });
    fs.copyFileSync(file, path.join(out, "request-submitted.json"), fs.constants.COPYFILE_EXCL);
    r.status = "AWAITING_SAME_OWNED_RUNTIME"; save();
    r.launchOutput = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "start-android-acceptance.ps1"), "-RequestPath", file],
      { windowsHide: true, encoding: "utf8", timeout: 120000 });
    save();
    const until = Date.now() + 25 * 60000, launchPath = path.join(request.outputDir, "acceptance-launch.json");
    while (Date.now() < until) {
      if (fs.existsSync(launchPath)) {
        let launch; try { launch = read(launchPath); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
        if (launch?.finishedAt) { r.launch = { ...fileEvidence(launchPath), value: launch }; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    assert(r.launch, "Timeout: inspect same owner, do not relaunch");
    const runtimePath = path.join(request.outputDir, "navigation-report.json");
    if (fs.existsSync(runtimePath)) r.runtime = { ...fileEvidence(runtimePath), value: read(runtimePath) };
    assert.equal(r.launch.value.emulatorCleanupStatus, "PASS");
    for (const tool of r.tools) assert.equal(fileEvidence(tool.path).sha256, tool.sha256);
    assert.equal(r.runtime?.value.uninstallStatus, "PASS"); assert.equal(r.runtime.value.apkCleanupStatus, "PASS");
    assert.equal(r.runtime.value.adbCleanupStatus, "PASS"); assert.equal(r.runtime.value.cleanupError, null);
    r.status = r.runtime.value.status;
    if (r.status === "FAILED") process.exitCode = 1;
    r.limitations = ["AgentVN asset-free three-line fixture only; not Ren'Py, NVL, bubble, audio, save failures or complete Android acceptance",
      "Source Editor12 normal close FAILED and old APK exit FAILED remain unchanged",
      "API35 emulator actual 2400x1080, no physical-device or desktop display-matrix claim"];
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: r.status, out, error: r.error }));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
