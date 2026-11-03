"use strict";
// Real current installed Editor, real administrator, controlled directory only.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { selectControlledPackageOutput } = require("./lib/controlled-package-output.cjs");
const { normalEditorClose } = require("./lib/windows-repository-native.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const [installationFile, authorFile, output, administrator] = process.argv.slice(2);
const out = path.resolve(output || ""), admin = path.resolve(administrator || "");
const root = path.resolve(__dirname, ".."), qa = "F:\\AgentVN\\QA\\Android-Package-20261021-01";
assert.equal(path.dirname(out), qa); assert.match(path.basename(out), /^editor-\d{2}$/);
assert.equal(admin, path.join(qa, path.basename(out).replace("editor", "administrator"))); assert(!fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const author = read(authorFile); assert.equal(author.status, "PASS"); assert.equal(author.cleanup, "PASS");
assert.equal(sha(author.portable.path), author.portable.sha256); assert.equal(sha(installationFile), author.installation.sha256);
const origin = read(path.join(admin, "origin.json")), receipt = read(path.join(admin, "result.json"));
assert.equal(origin.originIsElevated, false); assert.equal(receipt.isElevated, true);
assert.equal(receipt.status, "RUNNING"); assert.equal(receipt.userSid, origin.userSid);
assert.equal(receipt.originProcessId, origin.originProcessId);
assert(receipt.probe?.isElevated && receipt.probe.success && !fs.existsSync(receipt.probe.probeRoot));
const token = JSON.parse(ps("$i=[Security.Principal.WindowsIdentity]::GetCurrent();" +
  `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${process.pid}';` +
  "ConvertTo-Json -Compress @{isElevated=([Security.Principal.WindowsPrincipal]::new($i)).IsInRole(" +
  "[Security.Principal.WindowsBuiltInRole]::Administrator);sid=$i.User.Value;parent=$p.ParentProcessId}"));
assert(token.isElevated); assert.equal(token.sid, receipt.userSid); assert.equal(token.parent, receipt.processId);
assert(rows().some(p => p.ProcessId === receipt.processId && p.Created === receipt.created));
fs.mkdirSync(out);
const destination = path.join(out, "Android 输出"); fs.mkdirSync(destination);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_INSTALLED_1_9_36_PUBLISH_UI_ANDROID_ASPECT_ADMIN_BUILD_CONTROLLED_DIRECTORY_NOT_DEVICE",
  installation: desc(installationFile), author: desc(authorFile), input: author.portable,
  administrator: { directory: admin, origin: desc(path.join(admin, "origin.json")), receiptFile: path.join(admin, "result.json"), token,
    probe: receipt.probe, permission: desc(path.join(admin, "permission", "acceptance-permission.json")) },
  modelRequests: 0, productChanges: 0, builds: 0, steps: [], screenshots: [], launches: [], cleanups: [],
  errors: [], knownBuildProcesses: [], observedFiles: [], observations: [], cleanup: "PENDING",
  nativeChooserClaim: false, deviceClaim: false, outputDirectoryMode: "user-authorized one-shot response" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
report.testIdentity = desc(path.join(out, "executed-test.cjs"));
let owner, page, prepared = false, pending = false, terminal = false, policyPrepared = false;
async function step(name, fn) {
  const s = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(s); save(); console.log("START", name);
  try { s.detail = await fn(); s.status = "PASS"; console.log("PASS", name); }
  catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); throw e; }
  finally { s.finishedAt = new Date().toISOString(); save(); }
}
async function cache(action) {
  const operation = { action, status: "RUNNING", startedAt: new Date().toISOString() };
  (report.cacheOperations ??= []).push(operation);
  const fd = fs.openSync(path.join(out, `cache-${action}.log`), "wx");
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/android-current-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
    "-PhysicalPackageCache", "-PhysicalEnvironmentCache"], { windowsHide: true, stdio: ["ignore", fd, fd] });
  operation.pid = child.pid; save();
  try {
    operation.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(operation.exitCode, 0, `Cache ${action}: see log`); operation.status = "PASS";
  } finally { fs.closeSync(fd); operation.finishedAt = new Date().toISOString(); save(); }
}
function policy(action, port) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/android-current-webview-policy.ps1"), "-Action", action, "-RunDirectory", admin,
    ...(port ? ["-Port", String(port)] : [])], { windowsHide: true, encoding: "utf8", timeout: 20000 });
  fs.writeFileSync(path.join(out, `policy-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function dismissEnvironment() {
  const dialog = page.getByTestId("package-environment-operation-dialog");
  if (!await dialog.isVisible()) return false;
  const phase = await dialog.getAttribute("data-environment-phase");
  if (!["completed", "failed"].includes(phase)) return true;
  (report.environmentChecks ??= []).push({ phase, text: await dialog.innerText() }); save();
  assert.equal(phase, "completed", report.environmentChecks.at(-1).text);
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await dialog.waitFor({ state: "detached" }); return true;
}
function retain(file, name) {
  const hash = sha(file);
  if (report.observedFiles.some(f => f.name === name && f.sha256 === hash)) return;
  const copy = path.join(out, "observed-build", `${name}-${hash.slice(0, 12)}${path.extname(file)}`);
  fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
  report.observedFiles.push({ name, source: file, ...desc(copy) });
}
async function observe() {
  for (const process of ownedProcessTree(rows(), owner.current.pid, owner.current.created)) {
    if (!report.knownBuildProcesses.some(p => p.ProcessId === process.ProcessId && p.Created === process.Created)) {
      const { CommandLine, ...safe } = process; report.knownBuildProcesses.push(safe);
    }
  }
  const base = "C:\\Users\\1\\AppData\\Local\\com.agentvn.editor\\standalone-package";
  for (const e of fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d+$/.test(e.name))) {
    const run = path.join(base, e.name);
    for (const [relative, name] of [
      ["build-workspace/build-versions.json", "versions"], ["build-workspace/shared/cartridge/gameViewport.ts", "viewport"],
      ["build-workspace/GameCli_framework/src/components/shell/SettingsScreen.tsx", "settings"],
      ["build-workspace/GameCli_framework/src/store/settingsStore.ts", "settings-store"],
      ["build-workspace/scripts/build-runtime-standalone-android.cjs", "builder"],
      ["build-workspace/GameCli_framework/public/embedded-cartridge/manifest.json", "embedded-manifest"],
      ["build-workspace/GameCli_framework/public/embedded-cartridge/ui/layout.json", "embedded-layout"],
      ["game.vncart", "cartridge"], ["diagnostics/package-build-manifest.json", "manifest"],
      ["diagnostics/android-symlink-capability.json", "build-permission"],
      ["diagnostics/android-symlink-capability-elevated.json", "build-permission"],
      ["diagnostics/android-build-status.json", "build-status"],
      ["diagnostics/standalone-android-build.log", "log"],
    ]) {
      const file = path.join(run, relative); if (fs.existsSync(file)) retain(file, name);
    }
  }
  const text = await page.locator(".package-log-console").innerText().catch(() => "");
  if (report.lastConsole !== text) { report.lastConsole = text; console.log(text.slice(-450)); }
  report.observations.push({ at: new Date().toISOString(), processCount: report.knownBuildProcesses.length }); save();
}
(async () => {
  save();
  const disk = fs.statfsSync("C:/"); report.diskPreflight = { freeBytes: disk.bavail * disk.bsize, minimumBytes: 15 * 1024 ** 3 };
  assert(report.diskPreflight.freeBytes >= report.diskPreflight.minimumBytes);
  await cache("SelfTest"); prepared = true; await cache("Prepare");
  owner = installedReleaseSession({ installationFile, out, report, save, input: author.portable.path,
    beforeHostStart: ({ cdpPort }) => {
      policyPrepared = true; policy("Prepare", cdpPort); report.webviewPolicy = desc(path.join(admin, "webview-policy.json")); save();
    } });
  await step("installed-editor-import-and-authored-renpy-4-3", async () => {
    page = await owner.start();
    const r = await fetch(`http://127.0.0.1:${owner.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": "aspect-project.vnproj" },
      body: fs.readFileSync(author.portable.path), signal: AbortSignal.timeout(30000) });
    const payload = await r.json(); assert(r.ok && payload.ok); await page.reload();
    await page.locator(".recent-project-open:visible").filter({ hasText: "安装版比例隔离工程" }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    await page.locator('[data-layout-type-option="renpy"]').click(); await settleEditor(page);
    assert((await page.getByRole("combobox", { name: "画面比例", exact: true }).innerText()).includes("4:3"));
    const state = (await owner.api("/api/project/state")).project_metadata;
    assert.equal(state.settings.runtimeUILayoutProfiles.activeType, "renpy");
    assert.equal(state.settings.runtimeUILayout.gameViewport.aspectRatio, "4:3");
    return { projectId: state.project_id, layout: "renpy", ratio: "4:3" };
  });
  await step("actual-android-publish-settings-and-one-shot-directory", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
    await until(async () => {
      if (await dismissEnvironment()) return false;
      const s = page.locator('[data-package-stage="settings"]');
      if (!await s.isVisible()) return false;
      if (await s.getAttribute("aria-current") !== "page") { await s.click(); return false; }
      return page.locator('[data-help-key="package.mode"]').isVisible();
    }, "installed publishing ready", 180000);
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /打包 Windows 单软件/ }).click();
    await page.locator('[data-help-key="package.platform"]').click();
    await page.getByRole("option", { name: /Android/ }).click();
    await until(async () => {
      if (await dismissEnvironment()) return false;
      const panel = page.locator(".android-env-panel:not(.windows-env-panel)");
      if (await panel.getAttribute("data-environment-verification") === "passed") return true;
      const check = page.locator('[data-help-key="package.androidEnvCheck"]');
      if (await check.isEnabled()) await check.click();
      return false;
    }, "installed actual Android environment checks", 240000);
    for (const [key, value] of [["gameId", "qa_player_aspect_android_1936"], ["title", "AgentVN Aspect Android QA1936"],
      ["author", "QA"], ["version", "1.0.0"], ["androidApplicationId", "com.agentvn.qa.playeraspect1936"]])
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    report.controlledOutput = await selectControlledPackageOutput({ page,
      trigger: page.locator('[data-help-key="package.chooseOutputDir"]'), out, destination, ownerPid: owner.current.pid });
    assert.equal(await page.locator('[data-help-key="package.outputDir"]').inputValue(), destination);
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warnings.isVisible()) await warnings.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
    assert(await page.locator('[data-help-key="package.export"]').isEnabled());
    await owner.shot("android-export-configured"); return { destination, nativePicker: "NOT_RUN" };
  });
  await step("single-actual-ui-apk-build-and-embedded-player-capability", async () => {
    assert.equal(report.builds, 0); report.builds = 1; pending = true; save();
    await page.locator('[data-help-key="package.export"]').click();
    while (true) {
      await observe();
      if (await page.getByTestId("package-build-result-dialog").isVisible()) { terminal = true; pending = false; break; }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    report.resultText = await page.getByTestId("package-build-result-dialog").innerText(); save();
    assert(report.resultText.includes("Android 软件构建成功"), report.resultText);
    const apks = fs.readdirSync(destination).filter(n => n.endsWith(".apk")); assert.equal(apks.length, 1);
    report.apk = desc(path.join(destination, apks[0]));
    const zip = await JSZip.loadAsync(fs.readFileSync(report.apk.path), { checkCRC32: true });
    const embedded = async suffix => {
      const entries = Object.values(zip.files).filter(e => !e.dir && e.name.endsWith("embedded-cartridge/" + suffix));
      assert.equal(entries.length, 1); const bytes = await entries[0].async("nodebuffer");
      return { name: entries[0].name, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), value: JSON.parse(bytes) };
    };
    report.embedded = { manifest: await embedded("manifest.json"), layout: await embedded("ui/layout.json") };
    assert.equal(report.embedded.manifest.value.game_id, "qa_player_aspect_android_1936");
    assert.equal(report.embedded.manifest.value.runtime_version, "0.27.0");
    assert.equal(report.embedded.layout.value.layout_type, "renpy");
    assert.equal(report.embedded.layout.value.gameViewport.aspectRatio, "4:3");
    const permission = report.observedFiles.find(f => f.name === "build-permission" && read(f.path).isElevated && read(f.path).success);
    assert(permission, "Independent actual-build elevated symlink evidence required");
    report.buildPermission = permission;
    for (const [name, relative] of [["viewport", "shared/cartridge/gameViewport.ts"],
      ["settings", "GameCli_framework/src/components/shell/SettingsScreen.tsx"],
      ["settings-store", "GameCli_framework/src/store/settingsStore.ts"],
      ["builder", "scripts/build-runtime-standalone-android.cjs"]])
      assert(report.observedFiles.some(f => f.name === name && f.sha256 === sha(path.join(owner.installation.installRoot, relative))));
    assert(report.observedFiles.some(f => f.name === "versions" && read(f.path).editorVersion === "1.9.36"));
    await owner.shot("android-build-result"); return { apk: report.apk, layout: "renpy", defaultRatio: "4:3" };
  });
  await step("natural-installed-editor-and-backend-close", () => normalEditorClose({ owner, out, report }));
  assert.equal(report.steps.length, 4); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = pending && !terminal ? "OBSERVATION_FAILED_BUILD_PRESERVED" : "FAILED";
  report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) await owner.shot("failure").catch(() => {});
}).finally(async () => {
  if (pending && !terminal) {
    report.cleanup = "LIVE_BUILD_PRESERVED_DO_NOT_RESTART"; save();
    console.log(JSON.stringify({ status: report.status, live: owner?.current, out, error: report.error })); return;
  }
  try {
    await owner?.stop("Android aspect build final cleanup");
    if (policyPrepared && fs.existsSync(path.join(admin, "webview-policy.json"))) {
      policy("Restore"); report.policyRestoration = desc(path.join(admin, "webview-policy-restoration.json"));
      assert.equal(read(report.policyRestoration.path).status, "PASS");
    }
    if (prepared && fs.existsSync(path.join(out, "cache-protection.json"))) {
      await cache("Restore"); report.cacheRestoration = desc(path.join(out, "cache-restoration.json"));
      assert.equal(read(report.cacheRestoration.path).status, "PASS");
    }
    const identities = new Set([...(report.knownProcesses || []), ...report.knownBuildProcesses].map(p => `${p.ProcessId}:${p.Created}`));
    assert(!rows().some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
    assert.deepEqual(listeners(report.launches.flatMap(l => l.ports)), []); report.cleanup = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.cleanup = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, builds: report.builds, cleanup: report.cleanup,
    error: report.error, cleanupError: report.cleanupError }));
});
