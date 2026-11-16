"use strict";
// Actual NSIS/default QA profile -> UI editing -> restart -> UI export -> native binaries.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { IsolatedPlayer } = require("./lib/isolated-native-player-session.cjs");
const { settleEditor, settleRuntime, select } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const JSZip = require("../editor/node_modules/jszip");
const base = path.resolve(process.argv[2] || "");
assert(["01", "02", "03", "04"].some(n => base === path.resolve("F:/testavn/Windows-Isolated-1981-20261116-" + n)));
const remaining = !base.endsWith("-01");
assert.equal(process.argv.length, 3);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const candidate = read(path.join(base, "candidate.json")), fixture = read(path.join(base, "fixture.vnproj"));
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", scope: "ACTUAL_1981_NSIS_DEFAULT_PROFILE_UI_AUTHOR_RESTART_UI_EXPORT_NATIVE032_OLD031",
  stages: [], launches: [], cleanups: [], screenshots: [], errors: [], modelRequests: 0,
  computerUse: false, storeInjection: false, controlledNativeIPC: false,
  fixtureImport: "Public backend API into disposable default QA database; authoring/export use real UI",
  startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let editor, page, installation, backendPort, authored, cartridge;
const player = new IsolatedPlayer({ out, report, save, nativeProfile: true });
const menu = layout => layout.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu");
const current = () => editor.api("/api/project/projects/" + fixture.project_id);
async function step(name, action) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.stages.push(row); save();
  console.log("START", name);
  try { row.detail = await action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { row.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(row)); }
}
function install(action) {
  const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "editor-autosave-upgrade-install.ps1"), "-SessionRoot", base, "-Action", action],
  { encoding: "utf8", windowsHide: true, timeout: 240000 });
  fs.writeFileSync(path.join(out, "install-" + action.toLowerCase() + ".log"),
    (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  return action === "New" ? read(path.join(base, "install-new.json")) : undefined;
}
async function start(label) {
  editor = defaultEditorSession({ installation, out, report, save, label,
    expectedQaUser: owner.account.name, isolatedBackendPort: backendPort });
  page = await editor.start();
}
async function openProject() {
  await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function openLayout() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  const entry = page.getByTestId("renpy-player-layout-entry");
  if (await entry.isVisible()) await entry.click();
  else await page.locator(".runtime-layout-screen-list").getByRole("button", { name: "播放页", exact: true }).click();
  await settleEditor(page);
  await page.locator('.runtime-layout-component-list button[data-component-id="quick_menu"]').click();
}
async function uiDownload(trigger) {
  const directory = path.join(out, "exports"); fs.mkdirSync(directory);
  await editor.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory, eventsEnabled: true });
  const events = [], startedAt = Date.now();
  const begin = event => events.push({ type: "begin", ...event });
  const progress = event => events.push({ type: "progress", ...event });
  editor.cdp.on("Browser.downloadWillBegin", begin); editor.cdp.on("Browser.downloadProgress", progress);
  try {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), trigger.click()]);
    const filename = download.suggestedFilename(); assert.equal(path.basename(filename), filename);
    const started = await until(() => events.find(e => e.type === "begin"), "actual UI download begin", 15000);
    const done = await until(() => events.find(e => e.guid === started.guid && ["completed", "canceled"].includes(e.state)),
      "actual UI cartridge download complete", 60000);
    assert.equal(done.state, "completed"); assert(done.receivedBytes > 0); assert.equal(done.receivedBytes, done.totalBytes);
    const requested = path.join(directory, filename), qaDefault = path.join(process.env.USERPROFILE, "Downloads", filename);
    const original = await until(() => [done.filePath, requested, qaDefault].filter(Boolean)
      .find(file => fs.existsSync(file) && !fs.existsSync(file + ".crdownload")), "current completed file", 15000);
    assert([requested, qaDefault].some(file => path.resolve(original) === path.resolve(file)), "No unrelated download directory");
    assert(fs.statSync(original).mtimeMs >= startedAt - 2000);
    assert.equal(fs.statSync(original).size, done.receivedBytes);
    const source = desc(original);
    if (path.resolve(original) !== path.resolve(requested)) {
      fs.copyFileSync(original, requested, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(requested), source.sha256);
      fs.unlinkSync(original); assert(!fs.existsSync(original));
    }
    return { ...desc(requested), source, defaultQaDownloadRetired: original === qaDefault,
      input: "Installed Editor export button", nativePickerBypass: false, events };
  } finally {
    editor.cdp.off("Browser.downloadWillBegin", begin); editor.cdp.off("Browser.downloadProgress", progress);
  }
}
async function barGeometry(target) {
  return target.locator(".renpy-quick-bar").evaluate(bar => {
    const rect = n => n.getBoundingClientRect().toJSON(), frame = bar.closest(".runtime-layout-frame");
    return { placement: bar.dataset.quickMenuPlacement, bar: rect(bar), frame: rect(frame),
      buttons: [...bar.querySelectorAll("button")].map(button => {
        const r = button.getBoundingClientRect();
        return { text: button.textContent, rect: r.toJSON(),
          hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      }), overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
function verifyBar(value) {
  assert.equal(value.placement, "custom"); assert.equal(value.buttons.length, 9);
  assert(value.buttons.every(b => b.hit));
  assert(value.bar.left >= value.frame.left - 1 && value.bar.right <= value.frame.right + 1);
  assert(value.bar.top >= value.frame.top - 1 && value.bar.bottom < value.frame.top + value.frame.height / 2);
  assert(value.overflow <= 1);
}
(async () => {
  save();
  backendPort = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(e => e ? reject(e) : resolve(port)); });
  });
  await step(remaining ? "reuse-byte-verified1981-install-and-inherit-four-passed-stages" : "actual-1981-nsis-install-and-precise-payload", async () => {
    if (remaining) {
      const priorBase = "F:/testavn/Windows-Isolated-1981-20261116-01";
      const priorFile = path.join(priorBase, "resource-01/report.json"), prior = read(priorFile);
      assert.equal(prior.status, "FAILED");
      assert(prior.stages.slice(0, 4).every(s => s.status === "PASS"));
      assert.match(prior.stages[4].error, /android-env-import-backdrop/);
      report.inheritedStages = prior.stages.slice(0, 4).map(s => ({ ...s, evidence: desc(priorFile) }));
      installation = read(path.join(priorBase, "install-new.json")); report.installations = 0;
    } else { install("Snapshot"); installation = install("New"); report.installations = 1; }
    assert.equal(installation.executable.version, "1.9.81");
    const payload = read(candidate.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
    assert(payload); assert.equal(sha(installation.executable.path), payload.executable.sha256);
    for (const resource of [{ name: "build-versions.json", ...payload.versionResource }, ...payload.runtimeProvenance])
      assert.equal(sha(path.join(installation.installRoot, resource.name)), resource.sha256);
    assert.equal(sha(path.join(installation.installRoot, "agentvn-player.exe")), candidate.player.sha256);
    return { executable: installation.executable, nativePlayer: candidate.player, upgradeClaim: false };
  });
  await step(remaining ? "restore-actual-saved-author-layout-in-fresh-QA-default-profile" : "installed-default-profile-import-and-real-controls-save", async () => {
    await start(remaining ? "followup1981" : "first1981");
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await openProject(); await openLayout();
    const x = page.getByRole("spinbutton", { name: "控件x", exact: true });
    if (remaining) {
      authored = (await current()).editor_settings;
      assert.deepEqual(authored.runtimeUILayoutProfiles, fixture.editor_settings.runtimeUILayoutProfiles);
      assert(await x.isEnabled()); assert.equal(await x.inputValue(), "50");
      return { inheritedActualAuthoring: true, repeatedAuthoring: false, defaultDatabase: editor.current.database,
        sameOriginalProfileClaim: false };
    }
    assert(await x.isDisabled());
    await select(page, "快捷栏位置", "自定义位置");
    await select(page, "布局锚点", "顶部居中");
    for (const [field, value] of [["x", "50"], ["y", "10"], ["width", "60"], ["height", "6"]]) {
      const input = page.getByRole("spinbutton", { name: "控件" + field, exact: true });
      await input.fill(value); await input.press("Tab");
    }
    await select(page, "快捷栏位置", "底部居中"); assert(await x.isDisabled());
    await select(page, "快捷栏位置", "自定义位置"); assert.equal(await x.inputValue(), "50");
    await page.locator('[data-help-key="layout.save"]:visible').click();
    await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
    await until(async () => {
      const settings = (await current()).editor_settings;
      return menu(settings.runtimeUILayoutProfiles.profiles.renpy).style.quickMenuPlacement === "custom";
    }, "actual saved layout mode", 30000);
    authored = (await current()).editor_settings;
    assert.deepEqual(menu(authored.runtimeUILayoutProfiles.profiles.renpy).rect,
      { x: 50, y: 10, width: 60, height: 6, anchor: "top_center" });
    assert.deepEqual(authored.runtimeUILayoutProfiles.profiles.agentvn, fixture.editor_settings.runtimeUILayoutProfiles.profiles.agentvn);
    await editor.shot("installed-custom-placement");
    return { menu: menu(authored.runtimeUILayoutProfiles.profiles.renpy), defaultDatabase: editor.current.database };
  });
  if (!remaining) {
  await step("first-editor-normal-close", () => editor.naturalClose());
  await step("same-default-profile-restart-and-real-layout-controls", async () => {
    await start("restart1981"); await openProject(); await openLayout();
    assert.deepEqual((await current()).editor_settings.runtimeUILayoutProfiles, authored.runtimeUILayoutProfiles);
    const y = page.getByRole("spinbutton", { name: "控件y", exact: true });
    assert(await y.isEnabled()); assert.equal(await y.inputValue(), "10");
    await editor.shot("installed-restart-placement");
    return { defaultDatabase: editor.current.database, rectangleRestored: true };
  });
  }
  await step("actual-installed-export-button-and-cartridge-layout-runtime-version", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
    await page.locator('[data-help-key="package.gameId"]').fill("qa_quick_placement_1981");
    const mode = page.locator('[data-help-key="package.mode"]');
    if (!(await mode.innerText()).includes("游戏卡带")) {
      // Standalone is the default; its automatic environment probe can finish
      // after the publish panel mounts. Dismiss its real terminal dialog first.
      const dialog = page.getByTestId("package-environment-operation-dialog");
      await dialog.waitFor({ timeout: 30000 });
      await dialog.getByRole("button", { name: /^(完成|关闭)$/ }).filter({ visible: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await mode.click();
      await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    }
    await page.locator('[data-package-stage="checks"]').click();
    const optionalWarning = page.locator('[data-help-key="package.confirmWarnings"]');
    if (await optionalWarning.isVisible()) await optionalWarning.check();
    const trigger = page.locator('[data-help-key="package.export"]'); assert(await trigger.isEnabled());
    cartridge = await uiDownload(trigger); report.cartridge = cartridge;
    const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.equal(manifest.runtime_version, "0.32.0");
    assert.deepEqual(menu(layout), menu(authored.runtimeUILayoutProfiles.profiles.renpy));
    await editor.shot("installed-ui-export-completed");
    return { cartridge, manifest, actualExportButton: true, publicExportApiCalledByQA: false };
  });
  await step("second-editor-normal-close-before-native-consumption", () => editor.naturalClose());
  await step("actual-frozen031-binary-refuses-unmodified032-cartridge", async () => {
    assert.equal(sha(candidate.oldPlayer.path), candidate.oldPlayer.sha256);
    await player.start(candidate.oldPlayer.path, ["--mode", "fixed", "--cartridge", cartridge.path]);
    await player.page.getByText(/GameCLI 版本过低（runtime_version）/).first().waitFor({ timeout: 60000 });
    const text = await player.page.locator("body").innerText();
    assert.match(text, /卡带要求 0\.32\.0/); assert.match(text, /当前 GameCLI 为 0\.31\.0/);
    assert.equal(await player.page.locator(".story-player").count(), 0);
    await player.shot("actual-old031-refusal"); await player.stop();
    return { binary: candidate.oldPlayer, cartridge: desc(cartridge.path), text, versionOrBinaryMutation: false };
  });
  await step("actual-installed032-player-consumes-ui-export-and-nine-controls", async () => {
    const executable = path.join(installation.installRoot, "agentvn-player.exe");
    assert.equal(sha(executable), candidate.player.sha256);
    await player.start(executable, ["--mode", "fixed", "--cartridge", cartridge.path]);
    await player.page.getByRole("button", { name: "开始游戏", exact: true }).waitFor({ timeout: 60000 });
    await settleRuntime(player.page);
    await player.page.getByRole("button", { name: "开始游戏", exact: true }).click();
    await player.page.locator('.renpy-quick-bar[data-quick-menu-placement="custom"]').waitFor();
    await settleRuntime(player.page);
    const value = await barGeometry(player.page); verifyBar(value);
    await player.page.locator(".renpy-quick-bar").getByRole("button", { name: "历史", exact: true }).click();
    await player.ready("history");
    await player.page.getByRole("button", { name: "返回", exact: true }).filter({ visible: true }).click();
    await player.ready("playing"); verifyBar(await barGeometry(player.page));
    await player.page.locator(".renpy-quick-bar").getByRole("button", { name: "隐藏", exact: true }).click();
    await player.page.locator('.story-interface[data-hidden="true"]').waitFor();
    await player.page.keyboard.press("h");
    await player.page.locator('.story-interface[data-hidden="false"]').waitFor(); await settleRuntime(player.page);
    verifyBar(await barGeometry(player.page));
    await player.shot("actual-installed032-custom-bar");
    await player.stop(); assert.equal(sha(cartridge.path), cartridge.sha256);
    return { binary: desc(executable), geometry: value, historyReturnHideRestore: true,
      displayScope: "1920x1080 DPR1 normal WebView emulation; not a new full matrix or physical phone" };
  });
  if (!remaining) await step("restore-only-this-QA-install-registration", async () => {
    install("Restore"); return read(path.join(base, "metadata-restoration.json"));
  });
  assert.equal(report.stages.length, remaining ? 6 : 9); assert(report.stages.every(s => s.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.blockedModelRequests || 0, 0);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; })
.finally(async () => {
  try {
    if (page && !page.isClosed() && report.status !== "PASS") await editor.shot("failure-terminal").catch(() => {});
    await player.stop(); await editor?.stop();
    if (fs.existsSync(path.join(base, "metadata-before.json")) && !fs.existsSync(path.join(base, "metadata-restoration.json")))
      install("Restore");
    report.cleanupStatus = "PASS";
  } catch (error) { report.status = "FAILED"; report.cleanupStatus = "FAILED"; report.cleanupError = error.stack; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, stages: report.stages.length, out, error: report.error }));
});
