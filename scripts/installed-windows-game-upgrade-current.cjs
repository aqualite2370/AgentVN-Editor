"use strict";
// Real retained old setup -> real same-directory new setup. Never seed save files.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { rows, listeners, until, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { freePort } = require("./lib/windows-portable-qa-utils.cjs");
const { validateBuildEvidence } = require("./lib/windows-package-current-evidence.cjs");
const { validateUpgradeFixture } = require("./lib/windows-game-upgrade-fixture.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Windows-Package-20261021-01";
const attempt = process.argv[2] || "13"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `runtime-${attempt}`); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: f, sha256: sha(f), bytes: fs.statSync(f).size });
const sourceNumber = process.argv.find(a => a.startsWith("--candidate-source="))?.split("=")[1];
const auditNumber = process.argv.find(a => a.startsWith("--native-build-audit="))?.split("=")[1];
const payloadNumber = process.argv.find(a => a.startsWith("--payload-audit="))?.split("=")[1];
const recent = process.argv.includes("--recent");
assert(!sourceNumber || [sourceNumber, auditNumber, payloadNumber].every(n => /^\d{2}$/.test(n)));
assert(!recent || sourceNumber);
const oldFile = path.join(qa, recent ? "editor-05/report.json" : "editor-01/report.json"), old = read(oldFile);
if (recent) require("./lib/windows-current-native-source.cjs").validateRetained1924Source(old);
else validateBuildEvidence(old);
const newFile = path.join(qa, sourceNumber ? `editor-${sourceNumber}/report.json` : "editor-04/report.json"), current = read(newFile);
const newAudit = path.join(qa, sourceNumber ? `native-ui-audit-${auditNumber}/report.json` : "native-ui-audit-03/report.json"),
  newPayload = path.join(qa, sourceNumber ? `setup-payload-audit-${payloadNumber}/report.json` : "setup-payload-audit-03/report.json");
const context = sourceNumber ? require("./lib/windows-current-native-source.cjs").loadNativeSource(newFile, newAudit) : undefined;
if (context) assert.deepEqual(current.upgradeFixture, context.options.expectedUpgradeFixture);
else {
  require("./installed-windows-native-ui-current-audit.cjs").validate(current);
  validateUpgradeFixture(current.upgradeFixture);
}
assert.equal(read(newAudit).status, "PASS"); assert.equal(read(newAudit).source.sha256, sha(newFile));
assert.equal(read(newPayload).status, "PASS"); assert.equal(read(newPayload).buildAudit.sha256, sha(newAudit));
const gameId = current.projectId; assert.equal(gameId, recent ? old.projectId : old.cartridge.manifest.game_id);
const oldVersion = recent ? "1.0.2" : "1.0.0", newVersion = current.upgradeFixture.version;
const oldMarker = recent ? "QA_WINDOWS_UPGRADE_NEW" : "QA_WINDOWS_SAVE";
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: context ? `RETAINED_EDITOR_${recent ? "1_9_24" : "1_9_16"}_TO_INSTALLED_EDITOR_${context.editorVersion.replaceAll(".", "_")}_SAME_GAME_WINDOWS_SETUP_UPGRADE`
    : "RETAINED_EDITOR_1_9_16_TO_INSTALLED_EDITOR_1_9_22_SAME_GAME_WINDOWS_SETUP_UPGRADE",
  ...(context ? { editorVersion: context.editorVersion, oldEditorVersion: recent ? "1.9.24" : "1.9.16",
    nativeCandidateBinding: context.candidateBinding, oldVersion, newVersion } : {}),
  gameId, productChanges: 0, builds: 0, modelRequests: 0, copiedOrSeededSaves: 0,
  sourceOld: desc(oldFile), sourceNew: desc(newFile), newAudit: desc(newAudit), newPayload: desc(newPayload),
  checks: [], launches: [], known: [], cleanups: [], screenshots: [], errors: [], blocked: [],
  notRun: ["Pre-save-mechanism-change old binary", "Clean machine/default installation directory", "Android",
    "Full Runtime display matrix", "Final user project"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const target = path.join(out, "installed-client/saves", gameId, "preview_gamecli");
let profilePrepared = false, setupStarted = false, installed, browser, page, cdp, launch;
function tool(name, action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts", name), "-Action", action, "-RunDirectory", out],
  { windowsHide: true, encoding: "utf8", timeout: 240000,
    env: { ...process.env, TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") } });
  fs.writeFileSync(path.join(out, `${name}-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() };
  report.checks.push(row); report.stage = name; save(); console.log("START", name);
  try { row.result = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { row.finishedAt = new Date().toISOString(); save(); console.log(row.status, name); }
}
function remember() {
  const live = rows();
  if (launch) for (const p of ownedProcessTree(live, launch.pid, launch.created))
    if (!report.known.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)) report.known.push(p);
  save(); return live;
}
async function stop() {
  if (!launch) return;
  remember(); await browser?.close().catch(() => {});
  for (const p of [...report.known].reverse())
    ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
      `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -ceq '${p.Created}')` +
      `{Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
  await until(() => !listeners([launch.port]).length, "owned Player cleanup");
  const live = rows();
  assert(!report.known.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
  report.cleanups.push({ port: launch.port, method: "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE", remaining: [] });
  browser = page = cdp = launch = undefined; save();
}
async function ready(screen) {
  await page.waitForFunction(s => {
    const e = document.querySelector("[data-runtime-screen-transition]");
    return e?.getAttribute("data-runtime-presented-screen") === s && e.getAttribute("data-runtime-screen-transition") === "idle";
  }, screen); await settleRuntime(page);
}
async function command(index, marker, validateNewScript = false) {
  await page.waitForFunction(i => {
    const e = document.querySelector('[data-testid="game-state-playing"]');
    return e?.getAttribute("data-current-scene-id") === "ui_acceptance"
      && Number(e.getAttribute("data-current-command-index")) === i
      && document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true";
  }, index);
  assert((await page.locator(".dialog-box").innerText()).includes(`${marker}_${index}`));
  if (validateNewScript) assert((await page.locator(".dialog-box").innerText()).includes(
    current.upgradeFixture.project.nodes[1].data.scene.commands[index].text));
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); save();
}
function inventory() {
  return fs.existsSync(target) ? fs.readdirSync(target).filter(n => n.endsWith(".json")).sort()
    .map(name => ({ name, sha256: sha(path.join(target, name)), bytes: fs.statSync(path.join(target, name)).size })) : [];
}
function snapshots(prefix) {
  const items = inventory(), dir = path.join(out, prefix); fs.mkdirSync(dir);
  for (const item of items) fs.copyFileSync(path.join(target, item.name), path.join(dir, item.name), fs.constants.COPYFILE_EXCL);
  return items;
}
async function startShortcut(version) {
  const port = await freePort(); assert.equal(listeners([port]).length, 0);
  const link = installed.shortcuts.find(s => s.path.includes("Start Menu"));
  assert(link?.exists && link.target === installed.executable.path);
  const cwd = path.join(out, "unrelated-cwd"); fs.mkdirSync(cwd, { recursive: true });
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_)/.test(k)) delete env[k];
  Object.assign(env, { TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, AGENTVN_QA_SHORTCUT: link.path });
  // Default physical profile roots are protected, retained across the upgrade,
  // and restored in finally. No WebView directory override for preference persistence.
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "$ErrorActionPreference='Stop';$p=Start-Process -FilePath $env:AGENTVN_QA_SHORTCUT -WindowStyle Normal -PassThru;" +
    "[Console]::WriteLine($p.Id)"], { cwd, env, windowsHide: true, encoding: "utf8", timeout: 30000 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr);
  const pid = Number(r.stdout.trim()), identity = rows().find(p => p.ProcessId === pid); assert(identity);
  assert.equal(path.resolve(identity.ExecutablePath).toLowerCase(), installed.executable.path.toLowerCase());
  launch = { pid, created: identity.Created, port, version, shortcut: link,
    executable: desc(identity.ExecutablePath), at: new Date().toISOString() };
  report.launches.push(launch); remember();
  await until(async () => { remember(); return (await fetch(`http://127.0.0.1:${port}/json/version`,
    { signal: AbortSignal.timeout(500) })).ok; }, "real shortcut WebView", 60000);
  assert(listeners([port]).every(l => report.known.some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost")), "installed document");
  page.setDefaultTimeout(30000); page.on("pageerror", e => report.errors.push(String(e)));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" }); await readInstalledViewport(page, expected);
  await ready("title_menu");
  launch.storage = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_save_storage_info", { installId: "preview_gamecli" }));
  assert(launch.storage.portable); assert.equal(path.resolve(launch.storage.targetDirectory), target); save();
}
async function openSaves() {
  const screen = await page.locator("[data-runtime-screen-transition]").getAttribute("data-runtime-presented-screen");
  if (screen === "save_load") return;
  if (screen === "playing") {
    const toggle = page.getByTestId("quick-menu-toggle");
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await page.getByRole("button", { name: "打开存档读档", exact: true }).click();
  } else await page.getByTestId("open-save-load").click();
  await ready("save_load");
}
async function nativeClose(name) {
  remember();
  const request = { name, requestId: crypto.randomUUID(), ownerPid: launch.pid, created: launch.created,
    completion: path.join(out, `${name}-completed.json`) };
  fs.writeFileSync(path.join(out, "native-input-request.json"), JSON.stringify(request, null, 2));
  report.stage = "WAIT_NATIVE_CLOSE"; report.nativeRequest = request; save(); console.log("WAIT_NATIVE_CLOSE", request);
  await until(() => fs.existsSync(request.completion), "Computer Use close", 1200000);
  const receipt = read(request.completion);
  assert.equal(receipt.status, "INPUT_COMPLETED"); assert.equal(receipt.requestId, request.requestId);
  assert.equal(receipt.ownerPid, request.ownerPid); assert(receipt.interaction.includes("Computer Use"));
  await until(() => {
    const now = rows();
    return !report.known.some(p => now.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created))
      && !listeners([launch.port]).length;
  }, "natural Player and WebView exit", 45000);
  report.cleanups.push({ port: launch.port, method: "NATIVE_CONFIRMED_CLOSE", remaining: [], request, receipt });
  await browser?.close().catch(() => {}); browser = page = cdp = launch = undefined; save();
}
(async () => {
  save(); fs.mkdirSync(path.join(out, "temporary")); fs.mkdirSync(path.join(out, "tools"));
  for (const file of ["installed-windows-game-upgrade-current.cjs", "windows-setup-session.ps1", "windows-standalone-profile-session.ps1"])
    fs.copyFileSync(path.join(root, "scripts", file), path.join(out, "tools", file), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "upgrade-source.json"), JSON.stringify({
    editorVersion: context?.editorVersion || "1.9.22", source: desc(newFile), audit: desc(newAudit), payload: desc(newPayload),
    ...(context ? { candidateBinding: context.candidateBinding } : {}),
  }, null, 2), { flag: "wx" });
  if (recent) fs.writeFileSync(path.join(out, "native-setup-source.json"), JSON.stringify({
    editorVersion: "1.9.24", nativeUIBuildSource: true, retainedRelease: "EDITOR_1_9_24_GAME_1_0_2",
    source: desc(oldFile), audit: desc(path.join(qa, "native-ui-audit-04/report.json")),
    payload: desc(path.join(qa, "setup-payload-audit-04/report.json")),
  }, null, 2), { flag: "wx" });
  for (const action of ["SelfTest", "ValidateSource", "ValidateUpgrade"]) tool("windows-setup-session.ps1", action);
  tool("windows-standalone-profile-session.ps1", "SelfTest");
  if (process.argv.includes("--prepare-only")) { report.status = "PREPARED_NOT_RUN"; return; }
  for (const f of current.protectedFiles) assert.equal(sha(f.path), f.sha256);
  profilePrepared = true; tool("windows-standalone-profile-session.ps1", "Prepare");
  await check("Actual retained old setup install and shortcut boot", async () => {
    setupStarted = true; tool("windows-setup-session.ps1", "Install");
    installed = read(path.join(out, "installation.json")); assert.equal(installed.status, "PASS");
    await startShortcut(oldVersion); assert.deepEqual(inventory(), []);
    await page.getByTestId("start-new-game").click(); await ready("playing"); await command(0, oldMarker);
    return { installation: installed, storage: launch.storage };
  });
  await check("Old real UI manual save, preference and quick-entry inspection", async () => {
    await page.keyboard.press("Escape"); await ready("main_menu");
    await page.getByTestId("open-settings").click(); await ready("settings");
    await page.locator(".settings-tabs").getByRole("button", { name: "音频", exact: true }).click();
    await page.getByRole("checkbox", { name: "Mute sound effects", exact: true }).check();
    await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    await page.getByRole("checkbox", { name: "自动存档", exact: true }).check();
    await page.getByTestId("settings-finish").click(); await ready("main_menu");
    await page.getByTestId("continue-game").click(); await ready("playing");
    const toggle = page.getByTestId("quick-menu-toggle");
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    const actions = await page.locator(".quick-menu-action-layer button").evaluateAll(es => es.map(e => ({
      label: e.getAttribute("aria-label"), text: e.textContent?.trim(), disabled: e.disabled,
    })));
    report.oldQuickMenu = actions; assert.equal(actions.length, 7); await shot("old-real-menu");
    await openSaves();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
    await until(() => fs.existsSync(path.join(target, "slot-01.json")), "old actual manual save bytes");
    const manual = read(path.join(target, "slot-01.json")); assert.equal(manual.command_index, 0);
    assert.equal(manual.game_id, gameId);
    await page.getByRole("tab", { name: "快存", exact: true }).click();
    const quickSaveDisabled = await page.getByRole("button", { name: "保存", exact: true }).isDisabled();
    assert(quickSaveDisabled); await shot("old-quick-category-no-create");
    if (!actions.some(a => a.label === "快存" || a.text === "快存")) report.blocked.push({
      id: "WINDOWS-UPGRADE-OLD-QUICK-CREATE", status: "BLOCKED",
      reason: "Retained old AgentVN default layout has seven actions and no quick-save creation action; quick-category save is disabled.",
      actualEvidence: { actions, quickCategorySaveDisabled: quickSaveDisabled },
      noSeedOrInternalStoreCall: true,
    });
    report.oldPreference = await page.evaluate(() => JSON.parse(localStorage.getItem("vn.runtime.settings.preview_gamecli")));
    assert.equal(report.oldPreference.muteSfx, true); assert.equal(report.oldPreference.autoSaveEnabled, true);
    await page.keyboard.press("Escape"); await ready("playing");
    await page.locator(".dialog-box").click(); await command(1, oldMarker);
    await nativeClose("old-player-close"); return { manual, preference: report.oldPreference, quickEntry: report.blocked };
  });
  await check("Old native exit actually creates auto save and retains manual save", async () => {
    await until(() => inventory().some(f => /^auto-\d+\.json$/.test(f.name)), "old exit auto save bytes");
    report.beforeUpgrade = snapshots("before-upgrade");
    const autos = report.beforeUpgrade.filter(f => /^auto-\d+\.json$/.test(f.name));
    assert.equal(autos.length, 1); const auto = read(path.join(target, autos[0].name));
    assert.equal(auto.command_index, 1); assert.equal(auto.game_id, gameId);
    assert(report.beforeUpgrade.some(f => f.name === "slot-01.json"));
    assert(!report.beforeUpgrade.some(f => f.name.startsWith("quick-")));
    return { auto, files: report.beforeUpgrade };
  });
  await check("Same-directory real new NSIS upgrade with no uninstall or data clearing", async () => {
    assert.deepEqual(inventory(), report.beforeUpgrade);
    tool("windows-setup-session.ps1", "Upgrade");
    installed = read(path.join(out, "installation-upgrade.json")); assert.equal(installed.status, "PASS");
    assert.deepEqual(inventory(), report.beforeUpgrade);
    report.afterUpgrade = snapshots("after-upgrade");
    return { installation: installed, unchangedSaves: report.afterUpgrade };
  });
  await check("Updated shortcut loads actual old manual and auto saves, preference and new text", async () => {
    await startShortcut(newVersion);
    report.newPreference = await page.evaluate(() => JSON.parse(localStorage.getItem("vn.runtime.settings.preview_gamecli")));
    assert.deepEqual(report.newPreference, report.oldPreference);
    assert.deepEqual(inventory(), report.beforeUpgrade);
    const loads = [];
    for (const [label, kind, slot, index] of [["手动", "manual", 1, 0], ["自动", "auto", 1, 1]]) {
      await openSaves(); await page.getByRole("tab", { name: label, exact: true }).click();
      await page.getByRole("button", { name: "读取", exact: true }).click();
      await page.getByTestId(`save-slot-${kind}-${slot}`).locator(".save-card-main").click();
      // Saves include the displayed dialog snapshot. Restoration must preserve
      // that saved line; the next command must then come from the new script.
      await ready("playing"); await command(index, oldMarker);
      const savedName = kind === "manual" ? "slot-01.json" : "auto-01.json";
      const restoredText = await page.locator(".dialog-box").innerText();
      const savedText = read(path.join(out, "before-upgrade", savedName)).dialog.text;
      assert(restoredText.includes(savedText));
      await page.locator(".dialog-box").click(); await command(index + 1, current.upgradeFixture.marker, true);
      loads.push({ kind, slot, index, restoredText, savedText, nextIndex: index + 1,
        actualText: await page.locator(".dialog-box").innerText() });
      await shot(`new-actually-loads-old-${kind}`);
    }
    report.actualLoads = loads; await nativeClose("new-player-close"); return { loads, preference: report.newPreference };
  });
  await check("Actual updated uninstaller and save retention", async () => {
    const before = inventory(); tool("windows-setup-session.ps1", "Uninstall"); report.uninstalled = true;
    assert.equal(read(path.join(out, "uninstallation.json")).status, "PASS");
    assert.deepEqual(inventory(), before); return { retained: before };
  });
  assert.equal(report.checks.length, 6); assert.deepEqual(report.errors, []);
  report.status = report.blocked.length ? "PARTIAL_PASS" : "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) await shot("failure").catch(e => { report.captureError = String(e); });
}).finally(async () => {
  try {
    await stop();
    const live = rows();
    const active = live.filter(p => p.ExecutablePath && path.resolve(p.ExecutablePath).toLowerCase()
      .startsWith(path.resolve(out).toLowerCase() + path.sep));
    for (const name of ["install-process.json", "upgrade-process.json", "uninstall-process.json"]) {
      const file = path.join(out, name); if (!fs.existsSync(file)) continue;
      const owned = read(file);
      const present = live.find(p => p.ProcessId === owned.pid && (!owned.created || p.Created === owned.created));
      if (present) active.push(present);
    }
    assert.equal(active.length, 0, "Owned installer still live; retain journals, never restart");
    if (setupStarted && !report.uninstalled && fs.existsSync(path.join(out, "installation.json"))) {
      const partial = read(path.join(out, fs.existsSync(path.join(out, "installation-upgrade.json"))
        ? "installation-upgrade.json" : "installation.json"));
      if (partial.uninstaller && fs.existsSync(partial.uninstaller.path)) {
        tool("windows-setup-session.ps1", "Uninstall"); report.uninstalled = true;
      }
    }
    if (fs.existsSync(path.join(out, "setup-protection.json"))) {
      tool("windows-setup-session.ps1", "Cleanup");
      assert.equal(read(path.join(out, "setup-cleanup.json")).status, "PASS"); report.setupCleanup = true;
    }
    report.finalSaves = inventory();
    if (profilePrepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      tool("windows-standalone-profile-session.ps1", "Restore");
      assert.equal(read(path.join(out, "profile-restoration.json")).status, "PASS"); report.profilesRestored = true;
    }
    for (const f of current.protectedFiles) assert.equal(sha(f.path), f.sha256);
    for (const d of [report.sourceOld, report.sourceNew, report.newAudit, report.newPayload]) assert.equal(sha(d.path), d.sha256);
    assert.equal(listeners(report.launches.map(l => l.port)).length, 0);
    report.cleanupStatus = "PASS";
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, checks: report.checks.map(c => ({ name: c.name, status: c.status })),
    blocked: report.blocked, error: report.error, cleanupError: report.cleanupError }, null, 2));
});
