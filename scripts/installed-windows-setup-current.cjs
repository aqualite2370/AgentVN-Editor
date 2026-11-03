"use strict";
// Actual NSIS /S install, actual default shortcut launch, actual installed
// uninstaller. Not extraction, /UPDATE, a manufactured old build or Android.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { rows, listeners, until, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { freePort } = require("./lib/windows-portable-qa-utils.cjs");
const { validateBuildEvidence } = require("./lib/windows-package-current-evidence.cjs");
const { validatePortableEvidence } = require("./lib/windows-portable-current-evidence.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Windows-Package-20261021-01";
const attempt = process.argv[2] || "06"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `runtime-${attempt}`); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const nativeUI = process.argv.includes("--native-ui"), prepareOnly = process.argv.includes("--prepare-only");
const nativeClose = process.argv.includes("--native-close"); assert(!nativeClose || nativeUI);
const sourceNumber = process.argv.find(a => a.startsWith("--native-ui-source="))?.split("=")[1];
const buildAuditNumber = process.argv.find(a => a.startsWith("--native-build-audit="))?.split("=")[1];
const portableNumber = process.argv.find(a => a.startsWith("--portable-source="))?.split("=")[1];
const payloadNumber = process.argv.find(a => a.startsWith("--payload-audit="))?.split("=")[1];
assert(!sourceNumber || (nativeUI && [sourceNumber, buildAuditNumber, portableNumber, payloadNumber].every(n => /^\d{2}$/.test(n))));
const sourceFile = path.join(qa, sourceNumber ? `editor-${sourceNumber}/report.json` : nativeUI ? "editor-03/report.json" : "editor-01/report.json"), source = read(sourceFile);
const auditFile = path.join(qa, sourceNumber ? `native-ui-audit-${buildAuditNumber}/report.json` : nativeUI ? "native-ui-audit-02/report.json" : "build-audit-01/report.json");
const sourceContext = nativeUI ? require("./lib/windows-current-native-source.cjs").loadNativeSource(sourceFile, auditFile) : undefined;
if (!nativeUI) validateBuildEvidence(source);
const audit = read(auditFile); assert.equal(audit.status, "PASS"); assert.equal(audit.source.sha256, sha(sourceFile));
const priorFile = path.join(qa, sourceNumber ? `runtime-${portableNumber}/report.json` : nativeUI ? "runtime-10/report.json" : "runtime-05/report.json"), prior = read(priorFile);
validatePortableEvidence(prior, { editorVersion: sourceContext?.editorVersion || "1.9.16",
  candidateBinding: sourceContext?.candidateBinding, nativeAuditPath: auditFile });
assert.equal(prior.sourceReport.sha256, sha(sourceFile));
const payloadFile = path.join(qa, sourceNumber ? `setup-payload-audit-${payloadNumber}/report.json` : nativeUI ? "setup-payload-audit-02/report.json" : "setup-payload-audit-01/report.json");
const payload = read(payloadFile); assert.equal(payload.status, "PASS");
if (sourceContext?.candidateBinding) {
  assert.deepEqual(payload.candidateBinding, sourceContext.candidateBinding);
  assert.equal(payload.source.sha256, sha(sourceFile)); assert.equal(payload.buildAudit.sha256, sha(auditFile));
}
const gameId = nativeUI ? source.projectId : source.cartridge.manifest.game_id;
const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const report = { status: "RUNNING", scope: "ACTUAL_GENERATED_WINDOWS_NSIS_INSTALL_SHORTCUT_RUNTIME_UNINSTALL",
  startedAt: new Date().toISOString(), editorVersion: sourceContext?.editorVersion || "1.9.16",
  ...(sourceContext?.candidateBinding ? { nativeCandidateBinding: sourceContext.candidateBinding } : {}),
  nativeUIBuildSource: nativeUI, nativePhysicalClose: false, gameId, productChanges: 0, builds: 0, modelRequests: 0,
  source: { path: sourceFile, sha256: sha(sourceFile) }, prior: { path: priorFile, sha256: sha(priorFile) },
  sourceAudit: { path: auditFile, sha256: sha(auditFile) }, payload: { path: payloadFile, sha256: sha(payloadFile) },
  checks: [], launches: [], cleanups: [], known: [], screenshots: [], errors: [],
  notRun: ["Credible old installer upgrade", ...(nativeUI ? [] : ["Normal Editor output chooser"]), "MSI",
    "Clean-machine independence", ...(nativeClose ? [] : ["Physical native close"]), "Android", "Final user project"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let profilePrepared = false, setupStarted = false, launch, browser, page, cdp, installed;
const target = path.join(out, "installed-client/saves", gameId, "preview_gamecli");
const legacy = "C:/Users/1/AppData/Roaming/com.agentvn.hidden.growth/saves/preview_gamecli";
function tool(name, action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts", name), "-Action", action, "-RunDirectory", out],
  { windowsHide: true, encoding: "utf8", timeout: 240000,
    env: { ...process.env, TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") } });
  fs.writeFileSync(path.join(out, `${name}-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.checks.push(row); save(); console.log("START", name);
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
  await until(() => !listeners([launch.port]).length, "exact installed Player cleanup");
  const live = rows();
  const remaining = report.known.filter(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
  report.cleanups.push({ port: launch.port, remaining, method: "ATTRIBUTED_TERMINATION_NOT_PHYSICAL_CLOSE" });
  assert.deepEqual(remaining, []); browser = page = cdp = launch = undefined; save();
}
async function physicalClose() {
  remember(); report.stage = "WAIT_NATIVE_PLAYER_CLOSE"; save(); console.log("WAIT_NATIVE_PLAYER_CLOSE", out);
  const receiptFile = path.join(out, "normal-close-completed.json");
  await until(() => fs.existsSync(receiptFile), "Computer Use native Player close receipt", 240000);
  const receipt = read(receiptFile);
  assert.equal(receipt.method, "SKY_NATIVE_ALT_F4_AND_EXIT_CONFIRMATION");
  assert.equal(receipt.pid, launch.pid); assert.equal(receipt.created, launch.created);
  await until(() => {
    const live = rows();
    return !report.known.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created))
      && !listeners([launch.port]).length;
  }, "normal Player close and owned WebView exit", 30000);
  report.nativeCloseReceipt = { path: receiptFile, sha256: sha(receiptFile), ...receipt };
  report.nativePhysicalClose = true;
  report.cleanups.push({ port: launch.port, remaining: [], method: "NATIVE_CONFIRMED_WINDOW_CLOSE" });
  await browser?.close().catch(() => {}); browser = page = cdp = launch = undefined;
  report.stage = "NATIVE_PLAYER_CLOSED"; save();
}
async function ready(screen) {
  await page.waitForFunction(s => {
    const e = document.querySelector("[data-runtime-screen-transition]");
    return e?.getAttribute("data-runtime-presented-screen") === s && e.getAttribute("data-runtime-screen-transition") === "idle";
  }, screen); await settleRuntime(page);
}
async function command(index) {
  await page.waitForFunction(i => {
    const e = document.querySelector('[data-testid="game-state-playing"]');
    return e?.getAttribute("data-current-scene-id") === "ui_acceptance" && Number(e.getAttribute("data-current-command-index")) === i
      && document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true";
  }, index);
  assert((await page.locator(".dialog-box").innerText()).includes(`${nativeUI ? (source.upgradeFixture?.marker || "QA_WINDOWS_NATIVE") : "QA_WINDOWS_SAVE"}_${index}`));
}
const native = (command, args = {}) => page.evaluate(({ command, args }) =>
  window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
function inventory(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith(".json")).sort()
    .map(name => ({ name, sha256: sha(path.join(dir, name)), bytes: fs.statSync(path.join(dir, name)).size })) : [];
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); save();
}
async function startShortcut() {
  const port = await freePort(); assert.equal(listeners([port]).length, 0);
  const link = installed.shortcuts.find(s => s.path.includes("Start Menu"));
  assert(link && link.exists && link.target === installed.executable.path);
  const cwd = path.join(out, "unrelated-cwd"); fs.mkdirSync(cwd, { recursive: true });
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_)/.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"), TEMP: path.join(out, "temporary"),
    TMP: path.join(out, "temporary"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_QA_SHORTCUT: link.path });
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "$ErrorActionPreference='Stop';$p=Start-Process -FilePath $env:AGENTVN_QA_SHORTCUT -WindowStyle " +
    (nativeClose ? "Normal" : "Hidden") + " -PassThru;" +
    "[Console]::WriteLine($p.Id)"], { cwd, env, windowsHide: true, encoding: "utf8", timeout: 30000 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr);
  const pid = Number(r.stdout.trim()); assert(Number.isInteger(pid) && pid > 0);
  const identity = rows().find(p => p.ProcessId === pid); assert(identity);
  assert.equal(path.resolve(identity.ExecutablePath).toLowerCase(), installed.executable.path.toLowerCase());
  launch = { pid, created: identity.Created, port, shortcut: link, executableSha256: sha(identity.ExecutablePath),
    at: new Date().toISOString(), identity };
  report.launches.push(launch); remember();
  await until(async () => { remember(); return (await fetch(`http://127.0.0.1:${port}/json/version`,
    { signal: AbortSignal.timeout(500) })).ok; }, "real shortcut-launched installed WebView", 60000);
  assert(listeners([port]).every(l => report.known.some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost")), "installed document");
  page.setDefaultTimeout(30000); page.on("pageerror", e => report.errors.push(String(e)));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: expected.width, height: expected.height,
    deviceScaleFactor: 1, mobile: false }); await page.emulateMedia({ reducedMotion: "no-preference" });
  await readInstalledViewport(page, expected); await ready("title_menu");
  assert.equal(await page.locator(".main-menu.mode-fixed").getAttribute("data-presentation-mode"), "release");
  launch.storage = await native("get_save_storage_info", { installId: "preview_gamecli" });
  assert(launch.storage.portable); assert.equal(path.resolve(launch.storage.targetDirectory), target);
  assert.equal(path.resolve(launch.storage.sourceDirectory), path.resolve(legacy)); save();
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
async function references() {
  const prefix = "https://raw.githubusercontent.com/tauri-apps/tauri/tauri-cli-v2.11.2/crates/tauri-bundler/src/bundle/windows/nsis/";
  report.references = [];
  for (const [name, expectedSha] of [["installer.nsi", "ee84148e405adc4d736a46456dd8345a644751bd1f28a335dd7fd833a32d7c3e"],
    ["mod.rs", "90f49793c93d80ab267c09188f40b94fd68542699fdbd278df99512db53e6d8b"]]) {
    const cached = path.join(qa, "runtime-07", name + ".reference.txt");
    const bytes = nativeUI ? fs.readFileSync(cached) : await (async () => {
      const r = await fetch(prefix + name, { signal: AbortSignal.timeout(20000) }); assert(r.ok);
      return Buffer.from(await r.arrayBuffer());
    })(); assert.equal(hash(bytes), expectedSha);
    const file = path.join(out, name + ".reference.txt"); fs.writeFileSync(file, bytes, { flag: "wx" });
    report.references.push({ url: prefix + name, path: file, sha256: expectedSha, executed: false });
  }
}
(async () => {
  save(); fs.mkdirSync(path.join(out, "temporary"));
  fs.mkdirSync(path.join(out, "tools"));
  for (const f of ["installed-windows-setup-current.cjs", "windows-setup-session.ps1", "windows-standalone-profile-session.ps1"])
    fs.copyFileSync(path.join(root, "scripts", f), path.join(out, "tools", f), fs.constants.COPYFILE_EXCL);
  if (nativeUI) fs.writeFileSync(path.join(out, "native-setup-source.json"), JSON.stringify({
    editorVersion: report.editorVersion, nativeUIBuildSource: true, source: report.source,
    audit: report.sourceAudit, payload: report.payload,
    ...(sourceContext?.candidateBinding ? { candidateBinding: sourceContext.candidateBinding } : {}),
  }, null, 2), { flag: "wx" });
  await references();
  tool("windows-setup-session.ps1", "SelfTest"); tool("windows-standalone-profile-session.ps1", "SelfTest");
  tool("windows-setup-session.ps1", "ValidateSource");
  if (prepareOnly) { report.status = "PREPARED_NOT_RUN"; return; }
  for (const f of source.protectedFiles) assert.equal(sha(f.path), f.sha256);
  profilePrepared = true; tool("windows-standalone-profile-session.ps1", "Prepare");
  await check("Actual ordinary-user setup installation, registration, default shortcuts and resource bytes", async () => {
    setupStarted = true; tool("windows-setup-session.ps1", "Install");
    installed = read(path.join(out, "installation.json")); assert.equal(installed.status, "PASS"); return installed;
  });
  await check("Actual installed Start Menu shortcut boot, UI preference and EXE-side manual save", async () => {
    await startShortcut(); assert(!fs.existsSync(target)); assert(!fs.existsSync(legacy));
    await page.getByTestId("start-new-game").click(); await ready("playing"); await command(0);
    await page.keyboard.press("Escape"); await ready("main_menu"); await page.getByTestId("open-settings").click(); await ready("settings");
    await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    await page.getByRole("checkbox", { name: "自动存档", exact: true }).setChecked(false);
    await page.getByTestId("settings-finish").click(); await ready("main_menu");
    await page.getByTestId("continue-game").click(); await ready("playing");
    await openSaves(); await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
    await page.waitForFunction(() => document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
    const value = read(path.join(target, "slot-01.json"));
    assert.equal(value.game_id, gameId); assert.equal(value.command_index, 0);
    await shot("setup-real-manual-save"); return { storage: launch.storage, value, files: inventory(target) };
  });
  await check("Real installed UI migrates and actually loads auto and quick saves without losing manual save", async () => {
    const sourceLegacy = path.join(path.dirname(priorFile), "profile-roaming/saves/preview_gamecli");
    fs.mkdirSync(legacy, { recursive: true });
    for (const name of ["auto-01.json", "quick-06.json"]) {
      const expected = prior.finalLegacy.find(f => f.name === name); assert(expected);
      assert.equal(sha(path.join(sourceLegacy, name)), expected.sha256);
      fs.copyFileSync(path.join(sourceLegacy, name), path.join(legacy, name), fs.constants.COPYFILE_EXCL);
    }
    const before = inventory(legacy); await page.getByTestId("save-storage-open").click();
    const dialog = page.getByRole("dialog", { name: "复制旧存档到游戏目录？", exact: true });
    await dialog.waitFor(); await dialog.getByRole("status").waitFor({ state: "detached" });
    await page.getByTestId("save-migration-confirm").click(); await dialog.waitFor({ state: "detached" });
    const loaded = [];
    for (const [label, kind, slot] of [["自动", "auto", 1], ["快存", "quick", 6], ["手动", "manual", 1]]) {
      await openSaves(); await page.getByRole("tab", { name: label, exact: true }).click();
      await page.getByRole("button", { name: "读取", exact: true }).click();
      await page.getByTestId(`save-slot-${kind}-${slot}`).locator(".save-card-main").click();
      await ready("playing"); await command(kind === "manual" ? 0 : 1);
      loaded.push({ kind, slot, command: kind === "manual" ? 0 : 1 });
      await shot(`setup-actually-loaded-${kind}`);
    }
    assert.deepEqual(inventory(legacy), before); return { controlledLegacySeedSource: sourceLegacy, before, loaded, files: inventory(target) };
  });
  await check("New shortcut-launched installed process retains saved data and preference", async () => {
    const before = inventory(target); await stop(); await startShortcut();
    assert.deepEqual(inventory(target), before);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("vn.runtime.settings.preview_gamecli")).autoSaveEnabled), false);
    await openSaves(); await page.getByRole("tab", { name: "自动", exact: true }).click();
    await page.getByRole("button", { name: "读取", exact: true }).click();
    await page.getByTestId("save-slot-auto-1").locator(".save-card-main").click(); await ready("playing"); await command(1);
    await shot("setup-shortcut-restart"); return { files: before, loadedKind: "auto", command: 1 };
  });
  if (nativeClose) await physicalClose(); else await stop();
  await check("Actual installed uninstaller removes program, registration and shortcuts but preserves saves", async () => {
    const before = inventory(target), old = inventory(legacy);
    tool("windows-setup-session.ps1", "Uninstall"); report.uninstalled = true;
    const result = read(path.join(out, "uninstallation.json")); assert.equal(result.status, "PASS");
    assert.deepEqual(inventory(target), before); assert.deepEqual(inventory(legacy), old);
    return { result, retainedSaves: before, retainedLegacy: old };
  });
  assert.equal(report.checks.length, 5); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) await shot("failure").catch(e => { report.captureError = String(e); });
}).finally(async () => {
  try {
    await stop();
    // Never treat a still-live installer as failed/terminated just because an
    // observation or transport timed out.
    const live = rows(), active = live.filter(p => p.ExecutablePath && path.resolve(p.ExecutablePath).toLowerCase()
      .startsWith(path.resolve(out).toLowerCase() + path.sep));
    for (const name of ["install-process.json", "uninstall-process.json"]) {
      const file = path.join(out, name);
      if (!fs.existsSync(file)) continue;
      const owned = read(file);
      const stillLive = live.find(p => p.ProcessId === owned.pid && (!owned.created || p.Created === owned.created));
      if (stillLive) active.push(stillLive);
    }
    assert.equal(active.length, 0, "Owned installer still live: keep journals and do not restart");
    if (setupStarted && !report.uninstalled && fs.existsSync(path.join(out, "installation.json"))) {
      const partial = read(path.join(out, "installation.json"));
      if (partial.uninstaller && fs.existsSync(partial.uninstaller.path)) {
        tool("windows-setup-session.ps1", "Uninstall"); report.uninstalled = true;
      }
    }
    if (fs.existsSync(path.join(out, "setup-protection.json"))) {
      tool("windows-setup-session.ps1", "Cleanup");
      assert.equal(read(path.join(out, "setup-cleanup.json")).status, "PASS"); report.setupCleanup = true;
    }
    report.finalSaves = inventory(target); report.finalLegacy = inventory(legacy);
    if (profilePrepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      tool("windows-standalone-profile-session.ps1", "Restore");
      assert.equal(read(path.join(out, "profile-restoration.json")).status, "PASS"); report.profilesRestored = true;
    }
    for (const f of source.protectedFiles) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(sourceFile), report.source.sha256); assert.equal(sha(priorFile), report.prior.sha256);
    assert.equal(listeners(report.launches.map(l => l.port)).length, 0);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.map(c => ({ name: c.name, status: c.status })),
    error: report.error, cleanupError: report.cleanupError, out }, null, 2));
});
