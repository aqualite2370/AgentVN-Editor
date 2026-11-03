"use strict";
// Actual installed Editor -> native output picker -> Windows export -> native
// player. No preview payloads, injected skins, or modified export artifacts.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const net = require("node:net"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const sharp = require("../GameCli_framework/node_modules/sharp");
const A = require("./lib/installed-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const root = path.resolve(__dirname, "..");
assert.equal(process.argv.length, 5, "node script <fresh-output> <actual-installation-audit> <AgentVN-default-fixture-report>");
assert.notEqual(process.env.E5_LIFECYCLE_SOURCE, "1");
const [out, auditFile, fixtureFile] = process.argv.slice(2).map(p => path.resolve(p));
assert(A.inside(path.join(root, "output"), out) && !fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const evidence = file => ({ path: file, sha256: A.sha256(fs.readFileSync(file)),
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const fixture = read(fixtureFile), audit = read(auditFile);
assert.equal(fixture.status, "FIXTURE_VALIDATED"); assert.equal(fixture.layoutType, "agentvn");
assert.equal(fixture.layoutSource, "absent-project-default");
assert(fixture.projectId.startsWith("installed_resource_flow_story_"));
assert.equal(evidence(fixture.input).sha256, fixture.sha256);
assert.equal(audit.status, "PASS");
const installations = audit.deployments.filter(d => d.kind === "NSIS actual isolated installation");
assert.equal(installations.length, 1);
const installed = installations[0], installRoot = installed.installedRoot;
assert.equal(evidence(path.join(installRoot, "agentvn-editor.exe")).sha256, installed.executable.sha256);
fs.mkdirSync(out);
const session = path.join(out, "installed-session"); fs.mkdirSync(session);
fs.copyFileSync(auditFile, path.join(session, "installer-resource-report.json"), fs.constants.COPYFILE_EXCL);
const input = path.join(session, path.basename(fixture.input));
fs.copyFileSync(fixture.input, input, fs.constants.COPYFILE_EXCL);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "Installed AgentVN default-title Windows export and native WebView consumption, not full-story or Android acceptance",
  fixture, fixtureEvidence: evidence(fixtureFile), input: evidence(input),
  installationAudit: evidence(auditFile), installRoot, executable: evidence(path.join(installRoot, "agentvn-editor.exe")),
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out,
    INSTALLED_ACCEPTANCE_PROJECT_TITLE: fixture.title },
  commands: [], cases: [], errors: [], processes: [] };
const reportFile = path.join(out, "report.json"), save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const delay = ms => new Promise(r => setTimeout(r, ms));
let owner, browser, page, player;
async function command(name, args) {
  const row = { name, command: [process.execPath, ...args], startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save();
  const log = fs.createWriteStream(path.join(out, `${name}.log`), { flags: "wx" });
  try {
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true,
      env: { ...process.env, ...report.environment }, stdio: ["ignore", "pipe", "pipe"] });
    row.pid = child.pid; save(); child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, 0, `${name} failed; retain original log`);
    row.status = "PASS"; console.log(`PASS: ${name}`);
  } catch (error) { row.status = "FAILED"; throw error; }
  finally { log.end(); row.finishedAt = new Date().toISOString(); save(); }
}
async function attach(port, child) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child) assert.equal(child.exitCode, null, "Owned executable exited");
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    await delay(150);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  while (!page && Date.now() < deadline) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|tauri:/.test(p.url()));
    if (!page) await delay(100);
  }
  assert(page, "Actual native WebView unavailable"); page.setDefaultTimeout(30000);
  page.on("pageerror", error => { report.errors.push(String(error.stack || error)); save(); });
}
async function detach() { await browser?.close(); browser = undefined; page = undefined; }
async function idle(screen) {
  await page.waitForFunction(expected => {
    const nav = document.querySelector("[data-runtime-screen-transition]");
    return nav?.getAttribute("data-runtime-screen-transition") === "idle"
      && (!expected || nav.getAttribute("data-runtime-presented-screen") === expected)
      && !document.querySelector(".boot-overlay, .game-launch-blackout");
  }, screen);
}
async function titleReady() {
  await idle("title_menu");
  await page.getByTestId("start-new-game").click({ trial: true });
}
function luminance(rgb) {
  const c = rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
async function titleMetrics() {
  return page.locator(".menu-hero h1").evaluate(node => {
    const box = n => n.getBoundingClientRect().toJSON();
    const scope = node.closest(".ui-skin-scope"), style = getComputedStyle(node);
    const buttons = [...document.querySelectorAll(".main-menu button")].filter(b => {
      const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    }).map(b => { const r = b.getBoundingClientRect(); return {
      label: b.textContent.trim(), rect: r.toJSON(), disabled: b.disabled,
      hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; });
    const range = document.createRange(); range.selectNodeContents(node);
    return { text: node.textContent, color: style.color, fontSize: style.fontSize,
      scopeInk: getComputedStyle(scope).getPropertyValue("--ink").trim(), rect: box(node),
      glyphs: [...range.getClientRects()].map(r => r.toJSON()),
      scopeType: scope.getAttribute("data-layout-type"), renpyCount: document.querySelectorAll(".renpy-title").length,
      overflow: document.documentElement.scrollWidth - innerWidth, buttons };
  });
}
async function assertTitle(row, file) {
  const metrics = await titleMetrics(); row.metrics = metrics;
  assert.equal(metrics.text, fixture.title); assert.equal(metrics.renpyCount, 0);
  assert.equal(metrics.color, "rgb(246, 248, 255)", "Installed default title must consume its own scope ink");
  assert(metrics.overflow <= 1); const { width, height, dpr } = row.viewport;
  for (const r of [metrics.rect, ...metrics.glyphs])
    assert(r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
      && r.right <= width + 1 && r.bottom <= height + 1, "Title/glyphs clipped or outside viewport");
  for (let i = 0; i < metrics.buttons.length; i++) {
    const b = metrics.buttons[i], r = b.rect;
    assert(r.left >= -1 && r.top >= -1 && r.right <= width + 1 && r.bottom <= height + 1, `Button clipped: ${b.label}`);
    if (!b.disabled) assert(b.hit, `Button not hit-testable: ${b.label}`);
    for (const previous of metrics.buttons.slice(0, i)) {
      const p = previous.rect;
      assert(Math.min(r.right, p.right) - Math.max(r.left, p.left) <= 1
        || Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top) <= 1, "Overlapping title buttons");
    }
  }
  const shot = await captureInstalledWebview(page, row.cdp, file, row.viewport);
  row.screenshots.push(shot);
  const bg = [...await sharp(file).removeAlpha().extract({ left: Math.round(width * dpr * .04),
    top: Math.round(height * dpr * .3), width: 1, height: 1 }).raw().toBuffer()].slice(0, 3);
  const fg = metrics.color.match(/[\d.]+/g).slice(0, 3).map(Number), a = luminance(fg), b = luminance(bg);
  row.backgroundPixel = bg; row.contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  assert(row.contrast >= 3, `Default title contrast ${row.contrast} < 3`);
  row.viewportChecks.push(await readInstalledViewport(page, row.viewport));
}
async function stopPlayer(row) {
  await detach();
  if (!player) return;
  if (player.exitCode === null) {
    const result = spawnSync("taskkill.exe", ["/PID", String(player.pid), "/T", "/F"],
      { windowsHide: true, encoding: "utf8" });
    row.cleanup = { pid: player.pid, exitCode: result.status, output: result.stdout, error: result.stderr };
    assert.equal(result.status, 0, "Owned player cleanup failed");
  } else row.cleanup = { pid: player.pid, alreadyExited: true, exitCode: player.exitCode };
  player = undefined;
}
(async () => {
  save();
  report.resources = ["GameCli_framework/src/styles/shell.css", "GameCli_framework/src/styles/variables.css",
    "GameCli_framework/src/components/shell/MainMenu.tsx", "shared/cartridge/uiLayoutProfiles.ts",
    "shared/cartridge/uiSkin.ts"].map(relative => {
    const source = evidence(path.join(root, relative)), actual = evidence(path.join(installRoot, relative));
    assert.equal(source.sha256, actual.sha256, `Installed source mismatch: ${relative}`);
    return { relative, source, installed: actual };
  });
  owner = await startInstalledEditor(session); report.owner = owner.state; save();
  await attach(owner.state.cdpPort); await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByLabel("创建或打开项目").waitFor(); await detach();
  await command("native-project-import", [path.join(__dirname, "installed-p1-native-input.cjs"), session,
    "open", input, path.join(session, "native-import")]);
  const snapshot = await A.projectSnapshot(owner.state.backendPort);
  assert.equal(snapshot.projectId, fixture.projectId); assert.equal(snapshot.title, fixture.title);
  report.imported = { projectId: snapshot.projectId, title: snapshot.title }; save();
  await attach(owner.state.cdpPort);
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.locator(".cartridge-export-panel").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="package-environment-operation-dialog"]')
    || ["passed", "failed"].includes(document.querySelector(".package-primary-action")?.getAttribute("data-environment-status")),
  null, { timeout: 180000 });
  const envDialog = page.getByTestId("package-environment-operation-dialog");
  if (await envDialog.isVisible().catch(() => false)) {
    await page.waitForFunction(() => ["completed", "failed"].includes(
      document.querySelector('[data-testid="package-environment-operation-dialog"]')?.getAttribute("data-environment-phase")),
    null, { timeout: 180000 });
    report.environmentResult = await envDialog.innerText(); save();
    assert.equal(await envDialog.getAttribute("data-environment-phase"), "completed", report.environmentResult);
    await envDialog.getByRole("button", { name: "完成", exact: true }).click(); await envDialog.waitFor({ state: "detached" });
  }
  await detach();
  await command("windows-ui-export", [path.join(__dirname, "installed-editor-windows-export-playwright.cjs"),
    session, path.join(session, "windows-export")]);
  const uiNames = fs.readdirSync(session).filter(n => n.startsWith("windows-export-ui-")); assert.equal(uiNames.length, 1);
  const uiFile = path.join(session, uiNames[0], "report.json"), ui = read(uiFile);
  assert.equal(ui.status, "RESULT_READY"); assert.match(ui.result, /Windows[\s\S]*构建成功/);
  report.uiExport = evidence(uiFile);
  const portable = path.join(session, "windows-export/portable"), cart = path.join(portable, "embedded-cartridge");
  const manifest = read(path.join(cart, "manifest.json")), layout = read(path.join(cart, "ui/layout.json"));
  assert.equal(manifest.game_id, fixture.projectId); assert.notEqual(layout.layout_type, "renpy");
  const hero = layout.screens.find(s => s.screen_id === "title").components.find(c => c.component_type === "main_menu_hero");
  assert.equal(hero.style?.color, undefined, "Cannot prove default fix with an explicit title color");
  for (const asset of manifest.assets) {
    assert(A.inside(cart, path.join(cart, asset.path)));
    assert.equal(evidence(path.join(cart, asset.path)).sha256, asset.hash_sha256);
  }
  report.cartridge = { manifest: evidence(path.join(cart, "manifest.json")), layout: evidence(path.join(cart, "ui/layout.json")),
    layoutType: layout.layout_type ?? "agentvn", heroStyle: hero.style };
  const exes = fs.readdirSync(portable).filter(n => n.endsWith(".exe")); assert.equal(exes.length, 1);
  const exe = path.join(portable, exes[0]); report.player = evidence(exe); save();
  report.editorCleanup = await owner.stop(); owner = undefined;
  assert.equal(report.editorCleanup.editor.exitCode, 0); assert.equal(report.editorCleanup.backend.exitCode, 0);
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const viewport = { width, height, dpr, reduced }, key = `${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}`;
      const row = { key, viewport, status: "RUNNING", screenshots: [], viewportChecks: [] };
      report.cases.push(row); save();
      try {
        const port = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once("error", reject);
          probe.listen(0, "127.0.0.1", () => { const n = probe.address().port; probe.close(() => resolve(n)); }); });
        const profile = path.join(out, `player-webview-${key}`);
        player = spawn(exe, [], { cwd: portable, windowsHide: true, stdio: "ignore",
          env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile,
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
        row.owner = { pid: player.pid, port, profile }; report.processes.push(row.owner); save();
        await attach(port, player); await page.setViewportSize({ width, height });
        const cdp = await page.context().newCDPSession(page);
        Object.defineProperty(row, "cdp", { value: cdp, enumerable: false });
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
        await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        await titleReady();
        await assertTitle(row, path.join(out, `${key}-title.png`));
        const color = row.metrics.color;
        await page.getByTestId("open-settings").click(); await idle("settings");
        await page.getByTestId("settings-finish").click(); await titleReady();
        await assertTitle(row, path.join(out, `${key}-return.png`));
        assert.equal(row.metrics.color, color, "Return changes title color");
        await page.getByTestId("start-new-game").click(); await idle("playing");
        await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.includes("第一句"));
        await page.locator(".dialog-box").press("Enter");
        assert.equal(await page.locator(".story-player").getAttribute("data-current-scene-id"), "main");
        assert.equal(await page.locator(".renpy-quick-bar").count(), 0);
        row.viewportChecks.push(await readInstalledViewport(page, viewport));
        row.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${key}-playing.png`), viewport));
        row.status = "PASS"; console.log(`PASS: ${key} title/return/start contrast=${row.contrast.toFixed(3)}`);
      } catch (error) {
        row.status = "FAILED"; row.error = String(error.stack || error);
        if (page) row.failureText = await page.locator("body").innerText().catch(() => "");
        throw error;
      } finally { await stopPlayer(row); save(); }
    }
  assert.equal(report.cases.length, 12); assert.deepEqual(report.errors, []);
  assert.equal(evidence(exe).sha256, report.player.sha256);
  report.status = "INSTALLED_AGENTVN_DEFAULT_TITLE_WINDOWS_PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    await detach().catch(() => {});
    if (player) await stopPlayer(report).catch(error => { report.status = "FAILED"; report.cleanupError = String(error); process.exitCode = 1; });
    if (owner) report.editorCleanup = await owner.stop();
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, reportFile, error: report.error }));
  });
