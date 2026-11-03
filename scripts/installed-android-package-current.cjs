"use strict";
// Sealed installation -> real publish UI vncart -> real native upload /
// Android builder. Explicit destination is CONTROLLED input, never a native
// picker PASS. The normal host uses its real RunAs/symlink path. An explicitly
// receipted elevated QA host is separate evidence, never normal-user acceptance.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { nativeInput } = require("./lib/installed-acceptance.cjs");
const { retainedAndroidFixture } = require("./lib/android-game-upgrade-fixture.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Android-Package-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const nativeUpgrade = process.argv.includes("--native-upgrade");
const repairedCandidate = attempt === "10", version = nativeUpgrade ? "1.9.22" : repairedCandidate ? "1.9.19" : "1.9.18";
const candidateQa = "F:/AgentVN/QA/Android-RunId-Release-20261021-01";
const out = path.join(qa, "editor-" + attempt);
assert(!fs.existsSync(out), "Fresh evidence required"); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const prep = read(nativeUpgrade ? "F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json" : repairedCandidate ? path.join(candidateQa, "install-01/report.json")
  : path.join(qa, "preflight-01/preparation.json"));
const gate = read(nativeUpgrade ? "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/actual-installation.json" : repairedCandidate ? path.join(candidateQa, "install-01/report.json")
  : path.join(qa, "preflight-01/audit-01.json")); assert.equal(gate.status, "PASS");
const installationFile = nativeUpgrade ? "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json" : repairedCandidate ? path.join(candidateQa, "installation.json")
  : "F:/AgentVN/QA/MSI-Location-Repair-20261021-01/msi-zh-CN-02/Install.json";
const tools = [__filename, path.join(root, "scripts/android-current-cache-session.ps1"),
  path.join(root, "scripts/lib/installed-release-session.cjs"), path.join(root, "scripts/android-current-webview-policy.ps1")];
if (nativeUpgrade) tools.push(path.join(root, "scripts/lib/android-game-upgrade-fixture.cjs"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version,
  scope: "ACTUAL_INSTALLED_EDITOR_UI_VNCART_CONTROLLED_NATIVE_ANDROID_BUILD_NOT_PICKER_OR_DEVICE",
  normalUIExportStatus: "BLOCKED_NATIVE_DIRECTORY_PICKER", androidDeviceStatus: "NOT_RUN",
  modelRequests: 0, productChanges: 0, builds: 0, sourceBuilderInvocation: false,
  installation: desc(installationFile), protectedFiles: nativeUpgrade ? prep.protectedFiles : prep.protected, tools: tools.map(desc),
  steps: [], launches: [], cleanups: [], screenshots: [], errors: [], buildKnownProcesses: [], progress: [] };
const uploadProbeOnly = process.argv[3] === "--upload-probe-only";
const physicalPackageCache = process.argv.includes("--physical-package-cache");
const physicalEnvironmentCache = process.argv.includes("--physical-environment-cache");
const administratorArgument = process.argv.find(a => a.startsWith("--administrator-launch="));
const administratorRoot = administratorArgument?.slice("--administrator-launch=".length);
assert(!nativeUpgrade || administratorRoot, "Current native upgrade requires a fresh actual elevated launcher");
if (uploadProbeOnly) report.scope = "ACTUAL_INSTALLED_UPLOAD_DIRECTORY_DIAGNOSTIC_NO_PLATFORM_BUILD";
report.physicalPackageCache = physicalPackageCache;
report.physicalEnvironmentCache = physicalEnvironmentCache;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, cachePrepared = false, buildPending = false;
function unchanged() {
  for (const f of [...report.protectedFiles, ...report.tools, report.installation])
    assert.equal(sha(f.path), f.sha256, f.path);
  for (const f of report.physicalHostAbsentFiles || []) assert(!fs.existsSync(f.path), f.path);
}
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/android-current-cache-session.ps1", "-Action", action, "-RunDirectory", out,
    ...(physicalPackageCache ? ["-PhysicalPackageCache"] : []),
    ...(physicalEnvironmentCache ? ["-PhysicalEnvironmentCache"] : [])],
  { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function step(label, fn) {
  const row = { label, status: "RUNNING", startedAt: new Date().toISOString() };
  report.steps.push(row); save(); console.log("START " + label);
  try { row.result = await fn(); row.status = "PASS"; console.log("PASS " + label); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
function observeBuild() {
  const live = rows();
  const tree = ownedProcessTree(live, host.current.pid, host.current.created);
  for (const p of tree) {
    // Android signing processes can carry secrets in argv. Never persist argv.
    if (!report.buildKnownProcesses.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)) {
      const { CommandLine, ...safe } = p; report.buildKnownProcesses.push(safe);
    }
  }
  const base = physicalPackageCache ? "C:/Users/1/AppData/Local/com.agentvn.editor/standalone-package"
    : path.join(out, "native-standalone-package");
  const directories = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d+$/.test(e.name));
  for (const e of directories) {
    const workspace = path.join(base, e.name, "build-workspace"), diagnostics = path.join(base, e.name, "diagnostics");
    const manifest = path.join(diagnostics, "package-build-manifest.json");
    if (fs.existsSync(manifest)) report.latestBuildManifest = { ...desc(manifest), value: read(manifest) };
    const sourceFiles = ["build-versions.json", "GameCli_framework/src-tauri/src/lib.rs",
      "scripts/build-runtime-standalone-android.cjs", "scripts/build-runtime-standalone-android.ps1"];
    if (!report.materializedWorkspace && sourceFiles.every(f => fs.existsSync(path.join(workspace, f)))) {
      assert.equal(read(path.join(workspace, "build-versions.json")).editorVersion, version);
      const files = sourceFiles.map(f => {
        const actual = desc(path.join(workspace, f));
        const installedFile = path.join(host.installation.installRoot, f);
        const installed = desc(installedFile);
        if (f === "build-versions.json") {
          assert.deepEqual(read(path.join(workspace, f)), read(installedFile),
            "Generated version JSON must be semantically identical, whitespace may differ");
        } else assert.equal(actual.sha256, installed.sha256, f);
        return { relative: f, ...actual, installed,
          comparison: f === "build-versions.json" ? "SEMANTIC_JSON" : "SHA256_BYTES" };
      });
      report.materializedWorkspace = { path: workspace, observedAt: new Date().toISOString(), files };
    }
    for (const name of ["android-build-status.json", "android-symlink-capability.json",
      "android-symlink-capability-elevated.json", "android-symlink-capability-runner.json", "android-env-check.json"]) {
      const file = path.join(diagnostics, name);
      if (fs.existsSync(file)) (report.nativeDiagnostics ??= {})[name] = { ...desc(file), value: read(file) };
    }
    const log = path.join(diagnostics, "standalone-android-build.log");
    if (fs.existsSync(log)) {
      const tail = fs.readFileSync(log, "utf8").slice(-1000);
      if (tail !== report.lastBuildTail) { report.lastBuildTail = tail; console.log(tail); }
      report.lastBuildLog = desc(log);
    }
  }
  report.progress.push({ at: new Date().toISOString(), knownProcessCount: report.buildKnownProcesses.length,
    tree: tree.map(p => ({ ProcessId: p.ProcessId, Name: p.Name, Created: p.Created })) });
  save();
}
(async () => {
  if (administratorRoot) {
    assert.equal(path.resolve(administratorRoot), path.resolve(qa, "administrator-" + attempt));
    const originFile = path.join(administratorRoot, "origin.json"), resultFile = path.join(administratorRoot, "result.json");
    const origin = read(originFile), result = read(resultFile);
    assert.equal(origin.originIsElevated, false); assert.equal(result.isElevated, true);
    assert.equal(result.status, "RUNNING"); assert.equal(origin.userSid, result.userSid);
    assert.equal(result.originProcessId, origin.originProcessId); assert.notEqual(result.processId, origin.originProcessId);
    assert.equal(result.attempt, attempt); assert.equal(path.resolve(result.editorDirectory), path.resolve(out));
    assert(result.probe?.success && result.probe?.isElevated && !fs.existsSync(result.probe.probeRoot));
    assert.equal(path.resolve(path.dirname(result.probe.probeRoot)), path.resolve(administratorRoot, "permission"));
    const current = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      "$identity=[Security.Principal.WindowsIdentity]::GetCurrent();" +
      "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=" + process.pid + "';" +
      "ConvertTo-Json -Compress @{elevated=([Security.Principal.WindowsPrincipal]::new($identity))." +
      "IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);sid=$identity.User.Value;parent=$p.ParentProcessId}"],
    { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(current.status, 0, current.stderr);
    const token = JSON.parse(current.stdout.replace(/^\uFEFF/, ""));
    assert.equal(token.elevated, true); assert.equal(token.sid, result.userSid); assert.equal(token.parent, result.processId);
    const liveParent = rows().find(p => p.ProcessId === result.processId && p.Created === result.created);
    assert(liveParent, "Administrator launcher is no longer the same live process");
    report.administratorLaunch = { root: administratorRoot, origin: desc(originFile), helperReceipt: resultFile,
      originProcessId: origin.originProcessId, administratorProcessId: result.processId, token, probe: result.probe };
    report.scope = "ELEVATED_ACTUAL_INSTALLED_EDITOR_UI_CONTROLLED_NATIVE_ANDROID_NOT_NORMAL_USER_OR_PICKER";
    if (result.taskEngine) {
      assert.equal(origin.taskEngine, true);
      const protectionFile = path.join(administratorRoot, "physical-protection.json"), protection = read(protectionFile);
      const baselineProtected = nativeUpgrade ? prep.protectedFiles : prep.protected;
      assert.equal(protection.status, "PASS"); assert.equal(protection.files.length, baselineProtected.length);
      for (const f of protection.files) {
        const original = baselineProtected.find(p => p.path === f.path); assert(original);
        if (!f.path.endsWith("\\Roaming\\com.agentvn.editor\\backend\\vn_engine.db"))
          assert.equal(f.sha256, original.sha256);
      }
      report.packagedHostHistoricalProtection = baselineProtected;
      report.physicalHostProtection = desc(protectionFile);
      report.protectedFiles = protection.files.filter(f => f.existed);
      report.physicalHostAbsentFiles = protection.files.filter(f => !f.existed);
      report.scope = "TASK_ENGINE_ELEVATED_ACTUAL_INSTALLED_EDITOR_CONTROLLED_NATIVE_ANDROID_NOT_NORMAL_USER_OR_PICKER";
    }
  }
  if (nativeUpgrade) {
    report.scope = "ELEVATED_ACTUAL_INSTALLED_1_9_22_NATIVE_UI_ANDROID_SAME_GAME_UPGRADE_BUILD";
    report.normalUIExportStatus = "NOT_RUN_NATIVE_PICKER";
    report.currentNativeUI = true;
  }
  unchanged(); save();
  for (const tool of tools) fs.copyFileSync(tool, path.join(out, path.basename(tool)), fs.constants.COPYFILE_EXCL);
  const upgrade = nativeUpgrade ? retainedAndroidFixture() : null;
  if (upgrade) report.upgradeFixture = upgrade;
  const project = upgrade?.project || fixture(`qa_android_pkg_20261021_${attempt}`);
  if (!upgrade) {
    project.schema_version = "1.1.0"; project.title = "AVN Android QA 20261021";
    project.nodes[0].data.loadingAnimation = { kind: "default" }; project.nodes[0].data.openingAudio = [];
    project.nodes[1].data.scene.commands = [0, 1, 2].map(i => ({
      type: "narration", text: `QA_ANDROID_${i}：本轮隔离小工程，用于安装版Android构建与运行验收。`
    }));
  }
  const input = path.join(out, "Android 隔离小工程.vnproj");
  fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" }); report.input = desc(input);
  if (physicalPackageCache) {
    const disk = fs.statfsSync("C:/");
    report.packageDiskPreflight = { drive: "C:", freeBytes: disk.bavail * disk.bsize, minimumBytes: 15 * 1024 ** 3 };
    assert(report.packageDiskPreflight.freeBytes >= report.packageDiskPreflight.minimumBytes,
      "Insufficient C-space budget for one bounded physical-cache Android build");
  }
  cache("SelfTest"); cache("Prepare"); cachePrepared = true;
  host = installedReleaseSession({ installationFile, out, report, save, input,
    beforeHostStart: administratorRoot ? ({ cdpPort }) => {
      const policy = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts/android-current-webview-policy.ps1"), "-Action", "Prepare",
        "-RunDirectory", administratorRoot, "-Port", String(cdpPort)],
      { encoding: "utf8", windowsHide: true, timeout: 20000 });
      fs.writeFileSync(path.join(out, "webview-policy-prepare.log"), policy.stdout + policy.stderr, { flag: "wx" });
      assert.equal(policy.status, 0, policy.stdout + policy.stderr);
      report.webviewPolicy = desc(path.join(administratorRoot, "webview-policy.json")); save();
    } : undefined });
  if (uploadProbeOnly) {
    page = await host.start();
    await step("Controlled native upload and exact directory-promotion boundary, without an APK build", async () => {
      const prior = read(path.join(qa, "editor-01/report.json"));
      assert.equal(sha(prior.cartridge.path), prior.cartridge.sha256);
      report.cartridge = prior.cartridge;
      const bytes = [...fs.readFileSync(prior.cartridge.path)];
      report.upload = await page.evaluate(async ({ bytes, name }) => {
        const invoke = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
        const upload = await invoke("begin_standalone_package_upload", { fileName: name, expectedSize: bytes.length });
        const appended = await invoke("append_standalone_package_upload_chunk", {
          uploadId: upload.uploadId, fileKind: "cartridge", offsetBytes: 0, chunkBytes: bytes });
        return { ...upload, writtenBytes: appended.writtenBytes };
      }, { bytes, name: path.basename(prior.cartridge.path) });
      assert.equal(report.upload.writtenBytes, bytes.length);
      const aliasRoot = "C:/Users/1/AppData/Local/com.agentvn.editor/standalone-package";
      const physicalRoot = physicalPackageCache ? aliasRoot : path.join(out, "native-standalone-package");
      const source = path.join(aliasRoot, "uploads", report.upload.uploadId);
      report.uploadFilesystem = {
        aliasRoot, physicalRoot, source, realSource: fs.realpathSync.native(source),
        before: fs.readdirSync(source).map(n => ({ name: n, ...desc(path.join(source, n)) })),
        directoryEntries: fs.readdirSync(aliasRoot),
      };
      assert(report.uploadFilesystem.before.some(f => f.sha256 === prior.cartridge.sha256));
      // Separate owned marker, never mutate the native upload being inspected.
      const probeSource = path.join(aliasRoot, "uploads", "qa-rename-probe");
      const probeTarget = path.join(aliasRoot, "qa-rename-probe-moved");
      fs.mkdirSync(probeSource); fs.writeFileSync(path.join(probeSource, "marker.txt"), "qa-native-directory-probe", { flag: "wx" });
      try { fs.renameSync(probeSource, probeTarget); report.nodeDirectoryRename = { status: "PASS", target: fs.realpathSync.native(probeTarget) }; }
      catch (e) { report.nodeDirectoryRename = { status: "FAILED", error: String(e) }; }
      save();
      report.promotionResult = await page.evaluate(async uploadId => {
        try {
          return { returned: await window.__TAURI_INTERNALS__.invoke("build_standalone_package_from_upload", {
            uploadId, targetPlatform: "qa-unsupported-probe", outputDir: "unused-probe-directory",
            runId: "qa-upload-promotion-probe", releaseIdentity: { schemaVersion: 1 },
            optimizationProfile: "off", iconSource: "default" }) };
        } catch (e) { return { rejected: String(e) }; }
      }, report.upload.uploadId);
      report.uploadFilesystem.after = fs.readdirSync(aliasRoot);
      save();
      assert.match(report.promotionResult.rejected || "", /Unsupported package target platform: qa-unsupported-probe/,
        "The diagnostic must reach platform validation after a successful native directory promotion");
      return { promotion: report.promotionResult, nodeRename: report.nodeDirectoryRename };
    });
    unchanged(); report.status = "PASS"; return;
  }
  await step(`Actual ${version} installed host with its own backend and isolated small project`, async () => {
    assert.equal(read(path.join(host.installation.installRoot, "build-versions.json")).editorVersion, version);
    page = await host.start();
    const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
      body: fs.readFileSync(input), signal: AbortSignal.timeout(30000) });
    const value = await response.json(); assert(response.ok && value.ok && value.data.project_id === project.project_id);
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await host.shot("installed-small-project"); return { projectId: project.project_id, nativeProjectPicker: false };
  });
  await step("Actual publish UI exports the isolated project's unchanged cartridge", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
    const operation = page.getByTestId("package-environment-operation-dialog");
    await until(async () => {
      if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
      const settings = page.locator('[data-package-stage="settings"]');
      if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await settings.click(); return false; }
      return page.locator('[data-help-key="package.mode"]').isVisible();
    }, "actual initial environment check terminal", 180000);
    if (await operation.isVisible()) {
      const phase = await operation.getAttribute("data-environment-phase");
      report.initialEnvironment = { phase, text: await operation.innerText() }; save();
      await operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
      await operation.waitFor({ state: "detached" });
    }
    await page.locator('[data-package-stage="settings"]').click();
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    for (const [key, value] of [["gameId", project.project_id], ["title", project.title], ["author", "QA"]])
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    if (upgrade) await page.locator('[data-help-key="package.version"]').fill(upgrade.gameVersion);
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warnings.isVisible()) await warnings.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
    const dir = path.join(out, "cartridge"); fs.mkdirSync(dir);
    await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-help-key="package.export"]').click()]);
    const name = download.suggestedFilename(); assert.equal(path.basename(name), name);
    const file = path.join(dir, name);
    await until(() => fs.existsSync(file) && !fs.existsSync(file + ".crdownload"), "actual new vncart", 60000);
    assert.equal(await download.failure(), null);
    const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const script = JSON.parse(await zip.file("script.json").async("string"));
    assert.equal(manifest.game_id, project.project_id);
    assert(JSON.stringify(script).includes(upgrade ? "QA_ANDROID_UPGRADE_NEW_2" : "QA_ANDROID_2"));
    report.cartridge = { ...desc(file), manifest, layoutSha256: hash(await zip.file("ui/layout.json").async("nodebuffer")),
      scriptSha256: hash(await zip.file("script.json").async("nodebuffer")) };
    await host.shot("ui-cartridge"); return report.cartridge;
  });
  if (nativeUpgrade) {
    await step("Real Android publish UI, native picker and one elevated APK build", async () => {
      await page.locator('[data-package-stage="settings"]').click();
      await page.locator('[data-help-key="package.mode"]').click();
      await page.getByRole("option", { name: /打包 .* 单软件/ }).click();
      await page.locator('[data-help-key="package.platform"]').click();
      await page.getByRole("option", { name: /Android/ }).click();
      const operation = page.getByTestId("package-environment-operation-dialog");
      await until(async () => {
        if (await operation.isVisible()) {
          const phase = await operation.getAttribute("data-environment-phase");
          if (!["completed", "failed"].includes(phase)) return false;
          (report.currentEnvironmentChecks ??= []).push({ phase, text: await operation.innerText() }); save();
          assert.equal(phase, "completed", report.currentEnvironmentChecks.at(-1).text);
          await operation.getByRole("button", { name: "完成", exact: true }).click();
          await operation.waitFor({ state: "detached" });
        }
        const panel = page.locator(".android-env-panel:not(.windows-env-panel)");
        if (await panel.getAttribute("data-environment-verification") === "passed") return true;
        const button = page.locator('[data-help-key="package.androidEnvCheck"]');
        if (await button.isEnabled()) await button.click();
        return false;
      }, "actual current Android environment", 240000);
      await page.locator('[data-help-key="package.androidApplicationId"]').fill(upgrade.applicationId);
      assert.equal(await page.locator('[data-help-key="package.version"]').inputValue(), upgrade.gameVersion);
      const destination = path.join(out, "Android 输出"); fs.mkdirSync(destination);
      report.nativeOutput = await nativeInput({ page, trigger: page.locator('[data-help-key="package.chooseOutputDir"]'),
        out, name: "android-output-select", ownerPid: host.current.pid, selectedPath: destination, timeoutMs: 1200000 });
      assert.equal(await page.locator('[data-help-key="package.outputDir"]').inputValue(), destination);
      report.normalUIExportStatus = "NATIVE_DIRECTORY_SELECTED_BUILD_PENDING"; save();
      const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
      if (await warnings.isVisible()) await warnings.click();
      const consent = page.locator('[data-help-key="package.confirmWarnings"]');
      if (await consent.isVisible()) await consent.check();
      const button = page.locator('[data-help-key="package.export"]'); assert(await button.isEnabled());
      assert.equal(report.builds, 0); report.builds = 1; buildPending = true; save();
      await button.click();
      const result = page.getByTestId("package-build-result-dialog");
      while (true) {
        observeBuild();
        if (await result.isVisible()) break;
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
      buildPending = false; report.resultText = await result.innerText(); save();
      assert(report.resultText.includes("Android 软件构建成功"), report.resultText);
      const apk = fs.readdirSync(destination).filter(n => n.endsWith(".apk")); assert.equal(apk.length, 1);
      report.artifacts = [{ kind: "android_apk", ...desc(path.join(destination, apk[0])) }];
      const elevated = report.nativeDiagnostics?.["android-symlink-capability.json"]?.value
        ?? report.nativeDiagnostics?.["android-symlink-capability-elevated.json"]?.value;
      assert(elevated?.isElevated && elevated.success, "Actual APK build's independent elevated symlink probe required");
      assert(report.materializedWorkspace);
      await host.shot("android-build-result");
      report.featureStatus = "PASS"; report.androidBuildStatus = "STATIC_ONLY";
      report.normalUIExportStatus = "PASS_NATIVE_UI"; return report.artifacts;
    });
    await step("Normal native elevated Editor close", async () => {
      const request = { requestId: crypto.randomUUID(), ownerPid: host.current.pid,
        completion: path.join(out, "normal-close-completed.json"), name: "android-editor-normal-close" };
      fs.writeFileSync(path.join(out, "native-input-request.json"), JSON.stringify(request, null, 2));
      report.stage = "WAIT_NATIVE_EDITOR_CLOSE"; save(); console.log("WAIT_NATIVE_EDITOR_CLOSE", request);
      await until(() => fs.existsSync(request.completion), "Computer Use normal Editor close", 1200000);
      const receipt = read(request.completion); assert.equal(receipt.status, "INPUT_COMPLETED");
      assert.equal(receipt.requestId, request.requestId); assert.equal(receipt.ownerPid, request.ownerPid);
      assert(receipt.interaction.includes("Computer Use"));
      const launch = host.current;
      await until(() => !rows().some(p => p.ProcessId === launch.pid && p.Created === launch.created)
        && listeners(launch.ports).length === 0, "normal elevated Editor/backend exit", 30000);
      await host.stop("Native confirmed Editor close"); assert.deepEqual(report.cleanups.at(-1).killed, []);
      report.normalClose = { request, receipt }; return report.normalClose;
    });
    assert.equal(report.steps.length, 4); assert.deepEqual(report.errors, []);
    unchanged(); report.status = "PASS"; return;
  }
  await step("Actual native upload and installed Android builder with real elevation, not source or picker", async () => {
    const bytes = fs.readFileSync(report.cartridge.path);
    report.upload = await page.evaluate(async ({ name, bytes }) => {
      const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
      const begin = await invoke("begin_standalone_package_upload", { fileName: name, expectedSize: bytes.length });
      let offset = 0;
      for (let i = 0; i < bytes.length; i += 65536) {
        const chunk = bytes.slice(i, i + 65536);
        const result = await invoke("append_standalone_package_upload_chunk", {
          uploadId: begin.uploadId, fileKind: "cartridge", offsetBytes: offset, chunkBytes: chunk });
        offset += chunk.length; if (result.writtenBytes !== offset) throw Error("Native upload byte count mismatch");
      }
      return { ...begin, writtenBytes: offset };
    }, { name: path.basename(report.cartridge.path), bytes: [...bytes] });
    assert.equal(report.upload.writtenBytes, bytes.length);
    const destination = path.join(out, "Android 输出"); fs.mkdirSync(destination);
    assert.equal(report.cartridge.manifest.version, "0.1.0",
      "The explicit QA release identity must match the real UI-exported cartridge");
    report.buildRequest = { uploadId: report.upload.uploadId, targetPlatform: "android", outputDir: destination,
      runId: `android-package-${attempt}-20261021`, optimizationProfile: "off",
      releaseIdentity: { schemaVersion: 1, gameId: project.project_id, title: project.title,
        versionName: report.cartridge.manifest.version, versionCode: 1000,
        androidApplicationId: "com.agentvn.qa.androidcurrent20261021" }, iconSource: "default" };
    report.builds = 1; buildPending = true; save();
    await page.evaluate(request => {
      window.__qaAndroidBuild = { status: "RUNNING" };
      window.__TAURI_INTERNALS__.invoke("build_standalone_package_from_upload", request).then(
        result => { window.__qaAndroidBuild = { status: "TERMINAL", result }; },
        error => { window.__qaAndroidBuild = { status: "REJECTED", error: String(error) }; });
    }, report.buildRequest);
    let state;
    while (true) {
      observeBuild(); state = await page.evaluate(() => window.__qaAndroidBuild);
      if (state.status !== "RUNNING") break;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    buildPending = false; report.nativeResult = state; save();
    assert.equal(state.status, "TERMINAL", state.error);
    report.featureStatus = state.result.status; save();
    assert.equal(state.result.status, "PASS", state.result.message); assert.equal(state.result.ok, true);
    report.artifacts = state.result.artifacts.map(a => {
      const absolute = path.resolve(a.path.replace(/^\\\\\?\\/, ""));
      assert(absolute.startsWith(path.resolve(destination) + path.sep));
      return { kind: a.kind, ...desc(absolute) };
    });
    assert(report.artifacts.some(a => a.path.endsWith(".apk")));
    assert(report.materializedWorkspace, "Materialized installation provenance not observed");
    const elevated = report.nativeDiagnostics?.["android-symlink-capability-elevated.json"]?.value
      ?? (report.administratorLaunch ? report.nativeDiagnostics?.["android-symlink-capability.json"]?.value : undefined);
    assert(elevated?.success && elevated?.isElevated,
      "This actual native Android build must independently prove its elevated symlink capability");
    report.androidBuildStatus = "STATIC_ONLY"; return report.artifacts;
  });
  assert.equal(report.steps.length, 3); assert(report.steps.every(s => s.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); unchanged(); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) await host.shot("failure").catch(e => { report.captureError = String(e); });
}).finally(async () => {
  try {
    assert(!buildPending, "Native build remains in flight: preserve its owner and journals; do not restart or terminate");
    await host?.stop("Android build finally: attributed cleanup, not physical close");
    if (cachePrepared || fs.existsSync(path.join(out, "cache-protection.json"))) {
      cache("Restore"); assert.equal(read(path.join(out, "cache-restoration.json")).status, "PASS");
    }
    unchanged(); report.protectedUnchanged = true;
    const live = rows(), known = [...(report.knownProcesses || []), ...report.buildKnownProcesses];
    assert(!known.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
    assert.equal(listeners(report.cleanups.flatMap(c => c.ports)).length, 0);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, featureStatus: report.featureStatus,
    androidBuildStatus: report.androidBuildStatus, error: report.error, cleanupError: report.cleanupError, out }));
});
