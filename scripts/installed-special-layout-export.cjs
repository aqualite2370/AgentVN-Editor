"use strict";
// Continue the exact native-saved author result through installed export and
// the shipped native Player. Preview mode is not a standalone/setup claim.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const A = require("./lib/installed-acceptance.cjs");
const { rows, ps, until, listeners } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt, /^\d{2}$/);
const resumeArgument = process.argv.find(value => value.startsWith("--resume-download="));
const resumeAttempt = resumeArgument?.slice("--resume-download=".length);
if (resumeAttempt) assert.match(resumeAttempt, /^\d{2}$/);
const priorFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-39/report.json";
const prior = JSON.parse(fs.readFileSync(priorFile));
assert.equal(prior.status, "PASS"); assert.equal(prior.steps.length, 6);
assert.equal(prior.nativeCacheRestoration, "PASS"); assert(prior.finishedAt);
const input = prior.portable.retained;
assert.equal(A.sha256(fs.readFileSync(input)), prior.portable.sha256);
const out = path.resolve(`F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(), steps: [], screenshots: [],
  launches: [], cleanups: [], errors: [], modelRequests: 0,
  scope: "ACTUAL_INSTALLED_UI_CARTRIDGE_EXPORT_AND_SHIPPED_PLAYER_PREVIEW",
  priorAuthor: { path: priorFile, sha256: A.sha256(fs.readFileSync(priorFile)) },
  boundaries: { standaloneSetup: false, android: false, nativePicker: false,
    normalWindowClose: false, allNvlBubbleStorySemantics: false, fullDisplayMatrix: false },
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({
  installationFile: "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json",
  out, input, report, save,
});
let page, prepared = false, player, playerBrowser, playerIdentity, playerPage, playerCdp;
const playerProcesses = new Map();
function rememberPlayer() {
  if (!player) return;
  for (const p of ownedProcessTree(rows(), player.pid, playerIdentity?.Created))
    playerProcesses.set(`${p.ProcessId}:${p.Created}`, p);
  report.playerProcesses = [...playerProcesses.values()]; save();
}
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"),
    "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 30000 });
  (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function step(label, action) {
  const row = { label, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(row); save();
  try { row.detail = await action(); row.status = "PASS"; console.log(`PASS ${label}`); }
  catch (error) { row.status = "FAILED"; throw error; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  save();
  const zip = await JSZip.loadAsync(fs.readFileSync(input));
  const document = JSON.parse(await zip.file("project.json").async("string"));
  if (resumeAttempt) {
    await step("Retain original FAILED while validating its completed real UI download", async () => {
      const previousFile = path.resolve(`F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${resumeAttempt}/report.json`);
      const previous = JSON.parse(fs.readFileSync(previousFile));
      assert.equal(previous.status, "FAILED"); assert.equal(previous.nativeCacheRestoration, "PASS");
      assert(previous.finishedAt && previous.error.includes("download.saveAs: ENOENT"));
      assert.equal(previous.priorAuthor.sha256, report.priorAuthor.sha256);
      assert.equal(previous.steps[0].status, "PASS"); assert.equal(previous.download.failure, null);
      const completed = previous.downloadEvents.filter(e => e.type === "progress" && e.state === "completed");
      assert.equal(completed.length, 1);
      assert.equal(path.resolve(completed[0].filePath), path.resolve(previous.download.destination));
      assert.equal(path.dirname(path.resolve(completed[0].filePath)), path.dirname(previousFile));
      const bytes = fs.readFileSync(completed[0].filePath);
      assert.equal(bytes.length, completed[0].receivedBytes); assert.equal(bytes.length, completed[0].totalBytes);
      const game = await JSZip.loadAsync(bytes, { checkCRC32: true });
      const skin = JSON.parse(await game.file("ui/layout.json").async("string"));
      assert.equal(skin.layout_type, "renpy"); assert.equal(skin.advancedPresentationEnabled, true);
      assert.deepEqual(skin.dialogueLayouts, prior.profiles.profiles.renpy.dialogueLayouts);
      assert.deepEqual(skin.confirmationLayout, prior.profiles.profiles.renpy.confirmationLayout);
      const archiveImage = document.asset_manifest.find(a => a.asset_id === "special_background");
      const expected = await zip.file(archiveImage.metadata.project_path).async("nodebuffer");
      const matching = [];
      for (const [name, file] of Object.entries(game.files))
        if (!file.dir && name.startsWith("assets/") && A.sha256(await file.async("nodebuffer")) === A.sha256(expected))
          matching.push(name);
      assert(matching.length > 0);
      report.resumedDownload = { report: previousFile, sha256: A.sha256(fs.readFileSync(previousFile)),
        originalStatus: previous.status, completed, newExportRequests: 0, matching };
      report.cartridge = { path: completed[0].filePath, sha256: A.sha256(bytes), bytes: bytes.length,
        generatedAt: fs.statSync(completed[0].filePath).mtime.toISOString(), source: "same completed UI download; no re-export" };
      return report.resumedDownload;
    });
  } else {
  cache("SelfTest"); cache("Prepare"); prepared = true; page = await host.start();
  report.downloadEvents = [];
  host.cdp.on("Browser.downloadWillBegin", event => {
    report.downloadEvents.push({ type: "begin", guid: event.guid, suggestedFilename: event.suggestedFilename }); save();
  });
  host.cdp.on("Browser.downloadProgress", event => {
    report.downloadEvents.push({ type: "progress", guid: event.guid, state: event.state,
      receivedBytes: event.receivedBytes, totalBytes: event.totalBytes, filePath: event.filePath }); save();
  });
  await step("Portable bytes reopened by installed backend and actual homepage", async () => {
    const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input),
    });
    const result = await response.json(); assert(response.ok && result.ok);
    await page.reload();
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: document.title }).click();
    await A.settleEditor(page);
    assert.deepEqual((await A.projectSnapshot(host.current.ports[0])).settings.runtimeUILayoutProfiles, prior.profiles);
  });
  await step("Actual installed publishing exports same authored regions and image bytes", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click();
    const publishing = page.locator(".cartridge-export-panel"); await publishing.waitFor();
    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    await A.dismissEnvironmentCompletion(page);
    await publishing.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await publishing.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warning = publishing.getByRole("checkbox", { name: /我已检查全部警告/ });
    if (await warning.count()) await warning.check();
    // CDP owns this download's physical destination. Playwright's saveAs would
    // look for a separate GUID artifact, so validate the actual completion.
    const pending = page.waitForEvent("download");
    await publishing.locator(".package-primary-action").click();
    const download = await pending, filename = download.suggestedFilename();
    assert.equal(path.basename(filename), filename); assert(filename.endsWith(".vncart"));
    const destination = path.join(out, filename); assert(!fs.existsSync(destination));
    report.download = { suggestedFilename: filename, destination, source: "actual WebView completed CDP download" }; save();
    const failure = await download.failure(); report.download.failure = failure; save();
    assert.equal(failure, null, failure);
    const completed = await until(() => report.downloadEvents.find(e => e.type === "progress"
      && e.state === "completed" && e.filePath && path.resolve(e.filePath) === destination),
    "same UI download completed at exact configured Windows path", 10000);
    assert.equal(fs.statSync(destination).size, completed.totalBytes);
    assert.equal(completed.receivedBytes, completed.totalBytes);
    report.cartridge = { path: destination, sha256: A.sha256(fs.readFileSync(destination)),
      bytes: fs.statSync(destination).size, generatedAt: fs.statSync(destination).mtime.toISOString(),
      source: report.download.source }; save();
    const game = await JSZip.loadAsync(fs.readFileSync(report.cartridge.path));
    const skin = JSON.parse(await game.file("ui/layout.json").async("string"));
    assert.equal(skin.layout_type, "renpy"); assert.equal(skin.advancedPresentationEnabled, true);
    assert.deepEqual(skin.dialogueLayouts, prior.profiles.profiles.renpy.dialogueLayouts);
    assert.deepEqual(skin.confirmationLayout, prior.profiles.profiles.renpy.confirmationLayout);
    const archiveImage = document.asset_manifest.find(a => a.asset_id === "special_background");
    const expected = await zip.file(archiveImage.metadata.project_path).async("nodebuffer");
    const matching = [];
    for (const [name, file] of Object.entries(game.files))
      if (!file.dir && name.startsWith("assets/") && A.sha256(await file.async("nodebuffer")) === A.sha256(expected))
        matching.push(name);
    assert(matching.length > 0, "Actual dependency image bytes must be exported, not only its thumbnail/reference");
    return { cartridge: report.cartridge, imagePaths: matching };
  });
  }
  await step("Shipped native Player consumes cartridge, nine actions and authored confirmation", async () => {
    const exe = path.join(host.installation.installRoot, "agentvn-player.exe");
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer(); server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(e => e ? reject(e) : resolve(p)); });
    });
    const environment = { ...process.env };
    for (const name of Object.keys(environment)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(name)) delete environment[name];
    Object.assign(environment, {
      WEBVIEW2_USER_DATA_FOLDER: path.join(out, "native-player-webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary"),
    });
    assert.equal(listeners([port]).length, 0);
    player = spawn(exe, ["--mode", "preview", "--cartridge", report.cartridge.path], {
      cwd: host.installation.installRoot, env: environment, windowsHide: true, stdio: "ignore",
    });
    await until(() => { playerIdentity = rows().find(p => p.ProcessId === player.pid); return playerIdentity; }, "owned native Player identity");
    assert.equal(path.resolve(playerIdentity.ExecutablePath), path.resolve(exe));
    report.player = { executable: exe, sha256: A.sha256(fs.readFileSync(exe)), pid: player.pid, port, identity: playerIdentity };
    rememberPlayer();
    await until(async () => {
      assert.equal(player.exitCode, null); rememberPlayer();
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
      catch { return false; }
    }, "actual native Player WebView", 60000);
    assert(listeners([port]).every(p => [...playerProcesses.values()].some(n => n.ProcessId === p.OwningProcess)));
    playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const target = playerBrowser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost/.test(p.url()));
    assert(target);
    const cdp = await target.context().newCDPSession(target);
    playerPage = target; playerCdp = cdp;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await target.emulateMedia({ reducedMotion: "no-preference" });
    target.on("pageerror", e => report.errors.push(String(e)));
    await target.getByTestId("start-new-game").waitFor(); await A.settleRuntime(target);
    await target.getByTestId("start-new-game").click();
    await target.getByTestId("game-state-playing").waitFor(); await A.settleRuntime(target);
    assert.equal(await target.locator(".renpy-quick-bar button").count(), 9);
    await target.keyboard.press("Escape"); await A.settleRuntime(target);
    // Escape opens the actual game menu (MainMenu), not an auxiliary page's
    // shared side navigation. Use the real exit entry rendered at this level.
    await target.getByTestId("open-exit-confirmation").click();
    const modal = target.locator(".modal-panel"); await modal.waitFor();
    await target.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => {})));
    });
    assert.equal(await modal.evaluate(n => getComputedStyle(n).backgroundColor), "rgb(38, 55, 74)");
    const r = await modal.boundingBox(); assert(r && r.x >= 0 && r.y >= 0 && r.x + r.width <= 1921 && r.y + r.height <= 1081);
    report.screenshots.push(await captureInstalledWebview(target, cdp, path.join(out, "native-player-authored-confirmation.png"),
      { width: 1920, height: 1080, dpr: 1, reduced: false }));
    await target.keyboard.press("Escape"); await modal.waitFor({ state: "hidden" });
    assert.equal(player.exitCode, null);
    return { player: report.player, confirmation: r, continuedRunningAfterCancel: true };
  });
  assert.equal(report.steps.length, resumeAttempt ? 2 : 3); assert(report.steps.every(s => s.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (playerPage) try {
    report.screenshots.push(await captureInstalledWebview(playerPage, playerCdp, path.join(out, "native-player-failure.png"),
      { width: 1920, height: 1080, dpr: 1, reduced: false }));
  } catch (error) { report.playerCaptureError = String(error); }
  if (page) try { await host.shot("failure"); } catch (e) { report.captureError = String(e); }
}).finally(async () => {
  try {
    rememberPlayer(); await playerBrowser?.close();
    for (const p of [...playerProcesses.values()].reverse()) stopOwnedProcess(p, ps);
    if (report.player) {
      await until(() => !rows().some(p => playerProcesses.has(`${p.ProcessId}:${p.Created}`))
        && listeners([report.player.port]).length === 0, "owned Player cleanup", 15000);
      report.playerCleanup = "PASS";
    }
    await host.stop("finally");
    if (prepared) { cache("Restore"); report.nativeCacheRestoration = "PASS"; }
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
