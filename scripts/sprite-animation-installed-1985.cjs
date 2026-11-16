"use strict";
// Real installed UI saves the global defaults and exports the cartridges consumed below.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { IsolatedPlayer } = require("./lib/isolated-native-player-session.cjs");
const { settleEditor, settleRuntime, dismissEnvironmentCompletion } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const JSZip = require("../editor/node_modules/jszip");
const base = path.resolve(process.argv[2] || "");
assert.equal(process.argv.length, 3);
const firstBase = path.resolve("F:/testavn/Windows-Isolated-1985-20261116-01");
const remaining = base === path.resolve("F:/testavn/Windows-Isolated-1985-20261116-02");
assert(remaining || base === firstBase);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const candidate = read(path.join(base, "candidate.json")), fixture = read(path.join(base, "fixture.vnproj"));
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), stages: [], launches: [], cleanups: [],
  screenshots: [], errors: [], exports: [], modelRequests: 0, computerUse: false, storeInjection: false,
  scope: "ACTUAL1985_NSIS_DEFAULT_QA_PROFILE_GLOBAL_SAVE_RESTART_UI_EXPORT_NATIVE_TWO_THEME_RASTER",
  boundaries: ["Imported two-node PNG/event scaffold; global settings and exports through actual installed UI",
    "1080p/DPR1 normal native WebView; source12-combination matrices separate", "No Android or upgrade claim"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let editor, page, installation, backendPort, authored;
const player = new IsolatedPlayer({ out, report, save, nativeProfile: true });
if (remaining) {
  const previous = read(path.join(firstBase, "resource-01/report.json"));
  assert.equal(previous.status, "FAILED"); assert(previous.stages.slice(0, 5).every(s => s.status === "PASS"));
  assert.match(previous.error, /advanced\.tab\.layout/);
  report.inherited = { path: path.join(firstBase, "resource-01/report.json"), sha256: sha(path.join(firstBase, "resource-01/report.json")),
    originalStatus: previous.status, passedStages: previous.stages.slice(0, 5).map(s => s.name),
    sameOriginalProfileClaim: false, reinstall: false };
  report.exports.push(previous.exports[0]); assert.equal(report.exports[0].type, "agentvn");
}
const current = () => editor.api("/api/project/projects/" + fixture.project_id);
async function step(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.stages.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { row.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(row)); }
}
function install(action) {
  const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "editor-autosave-upgrade-install.ps1"), "-SessionRoot", base, "-Action", action],
  { encoding: "utf8", windowsHide: true, timeout: 240000 });
  fs.writeFileSync(path.join(out, "install-" + action + ".log"), (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  return action === "New" ? read(path.join(base, "install-new.json")) : undefined;
}
async function start(label) {
  editor = defaultEditorSession({ installation, out, report, save, label, expectedQaUser: owner.account.name, isolatedBackendPort: backendPort });
  page = await editor.start();
}
async function open() {
  await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function workshop() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.animation"]:visible').click(); await settleEditor(page);
  await dismissEnvironmentCompletion(page);
}
async function download(label) {
  const directory = path.join(out, "exports"); fs.mkdirSync(directory, { recursive: true });
  await editor.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory, eventsEnabled: true });
  const events = [], begin = e => events.push({ type: "begin", ...e }), progress = e => events.push({ type: "progress", ...e });
  editor.cdp.on("Browser.downloadWillBegin", begin); editor.cdp.on("Browser.downloadProgress", progress);
  try {
    const [item] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }),
      page.locator('[data-help-key="package.export"]:visible').click()]);
    const name = item.suggestedFilename(); assert.equal(name, path.basename(name));
    const started = await until(() => events.find(e => e.type === "begin"), "download begin");
    const done = await until(() => events.find(e => e.guid === started.guid && e.state === "completed"), "download complete", 90000);
    assert(done.receivedBytes > 0 && done.receivedBytes === done.totalBytes);
    const expected = path.join(directory, name), fallback = path.join(process.env.USERPROFILE, "Downloads", name);
    const original = await until(() => [done.filePath, expected, fallback].filter(Boolean)
      .find(f => fs.existsSync(f) && !fs.existsSync(f + ".crdownload")), "download file");
    assert([expected, fallback].some(f => path.resolve(f) === path.resolve(original)));
    const retained = path.join(directory, label + ".vncart");
    fs.copyFileSync(original, retained, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(original), sha(retained));
    // Only the exact completed QA download is removed; the retained cartridge remains.
    fs.unlinkSync(original);
    return { ...desc(retained), events, input: "Installed export button", defaultQaDownloadRetired: original === fallback };
  } finally {
    editor.cdp.off("Browser.downloadWillBegin", begin); editor.cdp.off("Browser.downloadProgress", progress);
  }
}
async function geometry(marker, count) {
  const p = player.page;
  await p.locator(".dialog-text").filter({ hasText: marker }).waitFor();
  await p.waitForFunction(count => document.querySelectorAll(".sprite-slot:not(.is-exiting)").length === count, count);
  await p.waitForFunction(() => [...document.querySelectorAll(".sprite-slot:not(.is-exiting) img")].every(i => i.complete && i.naturalWidth > 0));
  await settleRuntime(p);
  return p.locator('.sprite-slot[data-character-id="c0"]:not(.is-exiting) img').evaluate(i => ({
    rect: i.getBoundingClientRect().toJSON(), width: i.naturalWidth,
    authorScale: i.closest("[data-sprite-scale]").dataset.spriteScale,
  }));
}
(async () => {
  save();
  backendPort = await new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(e => e ? reject(e) : resolve(port)); }); });
  await step(remaining ? "reuse-byte-verified-existing-install" : "actual-nsis-install-and-player-payload", async () => {
    if (remaining) {
      installation = read(path.join(firstBase, "install-new.json")); report.installations = 0;
    } else {
      install("Snapshot"); installation = install("New"); report.installations = 1;
    }
    assert.equal(installation.executable.version, "1.9.85");
    const payload = read(candidate.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload"); assert(payload);
    assert.equal(sha(installation.executable.path), payload.executable.sha256);
    assert.equal(sha(path.join(installation.installRoot, "agentvn-player.exe")), candidate.player.sha256);
    return { executable: installation.executable, player: candidate.player, installer: candidate.installer };
  });
  await step(remaining ? "restore-prior-real-author-data-into-new-default-qa-profile" : "installed-global-entry-exit-confirm-cancel-save", async () => {
    await start("first1985");
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await open(); await workshop();
    if (remaining) {
      authored = await current();
      assert.deepEqual(authored.editor_settings.spriteAnimationDefaults, fixture.editor_settings.spriteAnimationDefaults);
      assert.deepEqual(authored.nodes, fixture.nodes); assert.deepEqual(authored.edges, fixture.edges);
      fs.writeFileSync(path.join(out, "authored.vnproj"), JSON.stringify(authored, null, 2), { flag: "wx" });
      return { restoredActualAuthorData: true, repeatedAuthoring: false, defaultDatabase: editor.current.database };
    }
    const confirmation = page.getByTestId("sprite-animation-default-confirmation");
    const enter = page.getByRole("button", { name: "保存全局入场", exact: true });
    await enter.click(); await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal((await current()).editor_settings.spriteAnimationDefaults?.enter, undefined);
    await enter.click(); await confirmation.getByRole("button", { name: "确认应用", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "全局入场已保存" }).waitFor();
    await page.getByRole("tab", { name: /立绘退场/ }).click();
    await page.locator('.animation-template-popover [aria-label="关闭动画模板选择"]').click();
    await page.getByRole("button", { name: "保存全局退场", exact: true }).click();
    await confirmation.getByRole("button", { name: "确认应用", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "全局退场已保存" }).waitFor();
    authored = await current();
    assert.equal(authored.editor_settings.spriteAnimationDefaults.enter.phase, "enter");
    assert.equal(authored.editor_settings.spriteAnimationDefaults.exit.phase, "exit");
    const commands = authored.nodes.find(n => n.id === "scene").data.scene.commands;
    assert(commands.filter(c => c.type === "sprite").every(c => c.animation_source === "project"));
    assert.deepEqual(authored.edges, fixture.edges);
    fs.writeFileSync(path.join(out, "authored.vnproj"), JSON.stringify(authored, null, 2), { flag: "wx" });
    await editor.shot("installed-global-saved");
    return { settings: authored.editor_settings.spriteAnimationDefaults, database: editor.current.database,
      cancelUnchanged: true, existingEventsInherited: commands.filter(c => c.type === "sprite").length };
  });
  if (!remaining) {
  await step("first-editor-normal-close", () => editor.naturalClose());
  await step("same-default-profile-restart-readback", async () => {
    await start("restart1985"); await open(); await workshop();
    const restored = await current();
    assert.deepEqual(restored.editor_settings.spriteAnimationDefaults, authored.editor_settings.spriteAnimationDefaults);
    assert.deepEqual(restored.nodes, authored.nodes); assert.deepEqual(restored.edges, authored.edges);
    assert(await page.getByRole("button", { name: "保存全局入场", exact: true }).isVisible());
    await editor.shot("installed-global-restart");
    return { sameProfile: true, database: editor.current.database, settingsAndGraphUnchanged: true };
  });
  }
  for (const type of remaining ? ["renpy"] : ["agentvn", "renpy"]) await step(type + "-installed-ui-cartridge-export", async () => {
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    const option = page.locator(`[data-layout-type-option="${type}"]:visible`);
    if (await option.getAttribute("aria-pressed") !== "true") await option.click();
    await page.waitForFunction(type => document.querySelector(".runtime-layout-designer")?.getAttribute("data-layout-type") === type
      && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false", type);
    await page.locator('[data-help-key="layout.save"]:visible').click();
    await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
    const mode = page.locator('[data-help-key="package.mode"]');
    if (!(await mode.innerText()).includes("游戏卡带")) {
      const dialog = page.getByTestId("package-environment-operation-dialog");
      await dialog.waitFor({ timeout: 30000 });
      await dialog.getByRole("button", { name: /^(完成|关闭)$/ }).filter({ visible: true }).click();
      await dialog.waitFor({ state: "hidden" }); await mode.click();
      await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    }
    await page.locator('[data-help-key="package.gameId"]').fill("qa_sprite_animation1985_" + type);
    await page.locator('[data-package-stage="checks"]').click();
    const optional = page.locator('[data-help-key="package.confirmWarnings"]');
    if (await optional.isVisible()) await optional.check();
    const cartridge = await download(type);
    const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
    const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.equal(layout.layout_type || "agentvn", type);
    const commands = script.scenes.flatMap(s => s.commands).filter(c => c.type === "sprite");
    assert(commands.length > 0); assert(!JSON.stringify(script).includes("animation_source"));
    for (const command of commands) assert.deepEqual(command.animation_config, authored.editor_settings.spriteAnimationDefaults[command.visible ? "enter" : "exit"]);
    const entry = { type, ...cartridge, spriteCommands: commands.length, settingsBakedIntoRuntime: true };
    report.exports.push(entry); return entry;
  });
  await step("second-editor-normal-close", () => editor.naturalClose());
  for (const exported of report.exports) await step(exported.type + "-installed-player-real-count-geometry-and-global-animation", async () => {
    const executable = path.join(installation.installRoot, "agentvn-player.exe");
    assert.equal(sha(executable), candidate.player.sha256);
    await player.start(executable, ["--mode", "fixed", "--cartridge", exported.path]);
    await player.page.getByTestId("start-new-game").click({ timeout: 60000 });
    await player.page.evaluate(() => {
      window.__qaSpriteFrames = []; window.__qaSpriteCapture = true;
      const tick = time => {
        if (!window.__qaSpriteCapture || window.__qaSpriteFrames.length > 2500) return;
        const frames = [...document.querySelectorAll(".sprite-slot")].map(slot => {
          const frame = slot.querySelector(".sprite-animation-frame");
          return { id: slot.dataset.characterId, phase: slot.dataset.spritePhase,
            animation: frame.dataset.runtimeAnimationId,
            opacity: Number(getComputedStyle(slot).opacity) * Number(getComputedStyle(frame).opacity),
            animations: frame.getAnimations().map(a => ({ duration: a.effect.getTiming().duration, state: a.playState })) };
        });
        window.__qaSpriteFrames.push({ time, frames }); requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const samples = []; let first;
    for (const [marker, count] of [["SIZE_STAGE_1", 1], ["SIZE_STAGE_2", 2], ["SIZE_STAGE_5", 5], ["SIZE_STAGE_RETURN_1", 1]]) {
      const g = await geometry(marker, count); first ??= g;
      assert.equal(g.width, 900); assert.equal(g.authorScale, "0.85");
      assert(Math.abs(g.rect.width - first.rect.width) < .5 && Math.abs(g.rect.height - first.rect.height) < .5);
      samples.push({ marker, count, ...g }); await player.page.locator(".dialog-box").click();
    }
    const scaled = await geometry("SIZE_STAGE_AUTHOR_SCALE", 1);
    assert(Math.abs(scaled.rect.width / first.rect.width - 1.1 / .85) < .01);
    const frames = await player.page.evaluate(() => { window.__qaSpriteCapture = false; return window.__qaSpriteFrames; });
    const frameFile = path.join(out, exported.type + "-sprite-frames.json");
    fs.writeFileSync(frameFile, JSON.stringify(frames), { flag: "wx" });
    const intermediate = frames.flatMap(row => row.frames).filter(frame => frame.id === "c1" && frame.opacity > .01 && frame.opacity < .99);
    assert(intermediate.length > 0, "Global animation must produce actual intermediate rendered frames");
    assert(frames.some(row => row.frames.some(frame => frame.id === "c1" && frame.animation === "sprite_fade_out"
      && frame.opacity > .01 && frame.opacity < .99)), "Configured exit must render before removal");
    await player.shot(exported.type + "-actual-player-geometry");
    await player.stop(); assert.equal(sha(exported.path), exported.sha256);
    return { binary: desc(executable), samples, authoredScale: scaled, frames: desc(frameFile),
      intermediateFrames: intermediate.length, runtimeConfigFromUnmodifiedUiExport: true };
  });
  if (!remaining) await step("restore-only-QA-registration", async () => { install("Restore"); return read(path.join(base, "metadata-restoration.json")); });
  assert.equal(report.stages.length, remaining ? 6 : 10); assert(report.stages.every(s => s.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.blockedModelRequests || 0, 0);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; })
.finally(async () => {
  try {
    if (page && !page.isClosed() && report.status !== "PASS") await editor.shot("failure-terminal").catch(() => {});
    await player.stop(); await editor?.stop();
    if (fs.existsSync(path.join(base, "metadata-before.json")) && !fs.existsSync(path.join(base, "metadata-restoration.json"))) install("Restore");
    report.cleanupStatus = "PASS";
  } catch (error) { report.cleanupStatus = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, stages: report.stages.length, out, error: report.error }));
});
