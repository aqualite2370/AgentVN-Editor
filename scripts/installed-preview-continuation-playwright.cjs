"use strict";
// G11 real installed Editor -> real external Player, and independent node preview.
// Missing-player fault is a recoverable rename of exact QA installation bytes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-preview-20261018-02";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")), sha = f => sha256(fs.readFileSync(f));
const prep = read(path.join(run, "preparation.json"));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
if (process.argv[2] === "fixture") {
  const project = read(path.join(__dirname, "fixtures/installed-preview-isolated.vnproj"));
  project.project_id = "installed-preview-isolated-20261018-02"; project.title = "安装版预览重试矩阵20261018";
  const input = path.join(prep.workRoot, "预览重试 临时工程.vnproj");
  fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
  fs.writeFileSync(path.join(run, "fixtures.json"), JSON.stringify({
    status: "PASS", at: new Date().toISOString(), input, inputSha256: sha(input),
    projectId: project.project_id, title: project.title, project, controlledFixtureImport: true,
  }, null, 2), { flag: "wx" });
  console.log("PASS isolated preview retry fixture; no model or final project"); process.exit(0);
}
const out = process.argv[2]; assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
fs.mkdirSync(out);
const fixture = read(path.join(run, "fixtures.json")), launch = read(path.join(run, "launch.json"));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
const exe = path.join(prep.installRoot, "agentvn-player.exe"), held = `${exe}.qa-held-preview-failure-20261018-02`;
const playerSha = "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a";
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], matrix: [], screenshots: [],
  pageErrors: [], playerProcesses: [], fault: { type: "CONTROLLED_REAL_INSTALLED_PLAYER_FILE_TEMPORARILY_UNAVAILABLE",
    original: exe, held, originalSha256: playerSha, restored: false }, realModelRequests: 0, productChanges: 0,
  scope: "ACTUAL_NSIS_EDITOR_AND_OWNED_EXTERNAL_PLAYER; REAL_WEBVIEW_EMULATION_NOT_PHYSICAL4K; CONTROLLED_PROJECT_IMPORT",
  launch, fixture: { path: fixture.input, sha256: fixture.inputSha256, projectId: fixture.projectId },
  tool: { path: __filename, sha256: sha(__filename) }, error: null, cleanupError: null };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser, page, cdp, playerBrowser, expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
let current, panel, status;
async function step(name, fn, rows = report.checks) {
  const c = { name, status: "RUNNING" }; rows.push(c); save();
  try { c.detail = await fn(c); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { save(); console.log(`${c.status} ${current?.key || "preflight"} ${name}`); }
}
function players() {
  const text = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "@(Get-CimInstance Win32_Process -Filter \"Name='agentvn-player.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{n='createdUtc';e={$_.CreationDate.ToUniversalTime().ToString('o')}})|ConvertTo-Json -Depth 5"],
  { encoding: "utf8", windowsHide: true });
  const data = text.trim() ? JSON.parse(text.replace(/^\uFEFF/, "")) : [];
  return Array.isArray(data) ? data : [data];
}
async function viewport(p, session) {
  await session.send("Emulation.setDeviceMetricsOverride", { width: expected.width, height: expected.height, deviceScaleFactor: expected.dpr, mobile: false });
  await p.emulateMedia({ reducedMotion: expected.reduced ? "reduce" : "no-preference" });
  return readInstalledViewport(p, expected);
}
async function shot(p, session, name) {
  report.screenshots.push(await captureInstalledWebview(p, session, path.join(out, `${name}.png`), expected)); save();
}
async function geometry(locator) {
  return locator.evaluate(n => {
    const rect = n.getBoundingClientRect().toJSON(), visible = b => b.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      && !b.closest("details:not([open])") && b.getBoundingClientRect().width > 0;
    const buttons = [...n.querySelectorAll("button")].filter(visible).map(b => {
      const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { text: b.textContent.trim(), disabled: b.disabled, rect: r.toJSON(), hit: hit === b || b.contains(hit),
        inside: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
    });
    const overlaps = [];
    for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
      const a = buttons[i].rect, b = buttons[j].rect;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push([buttons[i].text, buttons[j].text]);
    }
    const focus = document.activeElement;
    return { rect, viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth,
      buttons, overlaps, focusUnavailable: !!focus?.closest('[inert],[aria-hidden="true"]') };
  });
}
function bounded(g) {
  assert(g.rect.width > 0 && g.rect.height > 0 && g.rect.left >= -1 && g.rect.top >= -1);
  assert(g.rect.right <= g.viewport.width + 1 && g.rect.bottom <= g.viewport.height + 1);
  assert(g.overflow <= 1); assert(g.buttons.length >= 2); assert.deepEqual(g.overlaps, []);
  assert(g.buttons.filter(b => !b.disabled).every(b => b.inside && b.hit), JSON.stringify(g));
  assert.equal(g.focusUnavailable, false);
}
async function previewPage() {
  await page.locator('[data-workspace-surface="preview"]:visible').click(); await settleEditor(page);
  panel = page.getByTestId("preview-launch-panel"); status = page.getByTestId("preview-window-status");
  await panel.waitFor(); await panel.locator('[data-help-key="preview.open"]').waitFor();
  await status.filter({ hasText: "已关闭" }).waitFor();
}
async function closePlayer() {
  await page.locator('[data-workspace-surface="preview"]:visible').click(); await settleEditor(page);
  panel = page.getByTestId("preview-launch-panel"); status = page.getByTestId("preview-window-status");
  const close = panel.locator('[data-help-key="preview.close"]');
  if (await close.isEnabled()) { await close.click(); await status.filter({ hasText: "已关闭" }).waitFor(); }
  await playerBrowser?.close().catch(() => {}); playerBrowser = null;
  assert.deepEqual(players(), []);
}
(async () => {
  assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), launch.executableSha256);
  assert.equal(sha(exe), playerSha); assert(!fs.existsSync(held)); assert.deepEqual(players(), []);
  assert.equal(sha(fixture.input), fixture.inputSha256);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page); page.setDefaultTimeout(30000);
  page.on("pageerror", e => { report.pageErrors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page); await viewport(page, cdp);
  await step("Controlled real packaged-backend fixture import then actual homepage entry; no final user project", async () => {
    const response = await fetch("http://127.0.0.1:8278/api/project/projects/import", { method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
      body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
    const payload = await response.json(); assert(response.ok && payload.ok && payload.data.project_id === fixture.projectId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    const actual = await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().projectId); assert.equal(actual, fixture.projectId);
    await previewPage(); return { projectId: actual, nativeProjectPickerClaim: false };
  });
  await page.evaluate(() => {
    window.__qaPreviewTrustedInputs = [];
    document.addEventListener("click", e => {
      const n = e.target instanceof Element ? e.target.closest("[data-help-key],[data-workspace-surface]") : null;
      if (n) window.__qaPreviewTrustedInputs.push({ trusted: e.isTrusted, key: n.getAttribute("data-help-key") || n.getAttribute("data-workspace-surface") });
    }, true);
  });
  await step("Real missing installed Player produces visible error and enabled Retry without source fallback", async c => {
    // Rename only this verified QA installation's exact PE; restore before any retry.
    fs.renameSync(exe, held); report.fault.injectedAt = new Date().toISOString(); save();
    try {
      assert.equal(sha(held), playerSha); assert(!fs.existsSync(exe));
      await panel.locator('[data-help-key="preview.open"]').click();
      await panel.locator(".gamecli-preview-progress.is-error").waitFor({ timeout: 60000 });
      c.observed = { text: await panel.innerText(), geometry: await geometry(panel), players: players() }; save();
      assert(c.observed.text.includes("GameCLI executable was not found"), c.observed.text);
      assert.deepEqual(c.observed.players, []);
      assert(await panel.getByRole("button", { name: "重试 GameCLI 预览", exact: true }).isEnabled());
      bounded(c.observed.geometry); await shot(page, cdp, "missing-player-error");
      return c.observed;
    } finally {
      if (fs.existsSync(held)) { assert(!fs.existsSync(exe)); assert.equal(sha(held), playerSha); fs.renameSync(held, exe); }
      assert.equal(sha(exe), playerSha); report.fault.restored = true; report.fault.restoredAt = new Date().toISOString(); save();
    }
  });
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    expected = { width, height, dpr, reduced };
    current = { key: `${width}x${height}-dpr${dpr}-${reduced ? "reduce" : "ordinary"}`, ...expected, status: "RUNNING", checks: [] };
    report.matrix.push(current); save(); await viewport(page, cdp); await previewPage();
    try {
      await step("Confirmation geometry, actual focus and no premature external process", async () => {
        const g = await geometry(panel); bounded(g); assert.deepEqual(players(), []); assert.equal(await panel.locator("iframe").count(), 0);
        return g;
      }, current.checks);
      await step("Real launch/retry opens exactly one installed Player and matching isolated script", async c => {
        const name = await panel.locator('[data-help-key="preview.open"]').innerText();
        if (report.matrix.length === 1) assert.equal(name, "重试 GameCLI 预览");
        await panel.locator('[data-help-key="preview.open"]').click();
        await status.filter({ hasText: "运行中" }).waitFor({ timeout: 60000 });
        const p = players(); c.observed = p; save(); assert.equal(p.length, 1);
        const child = p[0]; assert.equal(child.ParentProcessId, launch.editorPid);
        assert.equal(path.resolve(child.ExecutablePath), path.resolve(exe)); assert.equal(sha(child.ExecutablePath), playerSha);
        const match = child.CommandLine.match(/--preview-root\s+(?:"([^"]+)"|(\S+))/); assert(match);
        const previewRoot = match[1] || match[2], scriptFile = path.join(previewRoot, "script.json");
        const script = read(scriptFile); assert.equal(script.game_id, fixture.projectId);
        const narration = fixture.project.nodes.find(n => n.data.scene).data.scene.commands[0].text;
        assert(script.scenes.some(s => s.commands.some(c => c.type === "narration" && c.text === narration)));
        const identity = { ...child, sha256: playerSha, previewRoot, scriptSha256: sha(scriptFile), viewport: expected };
        report.playerProcesses.push(identity);
        fs.writeFileSync(path.join(run, `player-${report.matrix.length}-identity.json`),
          JSON.stringify({ processes: [child] }, null, 2), { flag: "wx" }); save();
        playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.playerCdpPort}`, { timeout: 30000 });
        const game = playerBrowser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(game);
        const gameCdp = await game.context().newCDPSession(game); await viewport(game, gameCdp);
        await game.getByTestId("start-new-game").waitFor(); await game.locator(".boot-overlay").waitFor({ state: "detached" });
        await settleRuntime(game); await game.getByTestId("start-new-game").click();
        await game.getByTestId("game-state-playing").waitFor(); await settleRuntime(game);
        await game.locator(".dialog-box").filter({ hasText: narration }).waitFor();
        const runtime = await game.locator(".dialog-box").evaluate(n => {
          const r = n.getBoundingClientRect();
          return { rect: r.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth, viewport: { width: innerWidth, height: innerHeight }, text: n.textContent };
        });
        assert(runtime.rect.left >= -1 && runtime.rect.right <= width + 1 && runtime.rect.top >= -1 && runtime.rect.bottom <= height + 1 && runtime.overflow <= 1);
        await shot(game, gameCdp, `${current.key}-external-playing`);
        await closePlayer(); return { identity, runtime, retryAfterRealFileRestoration: report.matrix.length === 1, originalButtonText: name };
      }, current.checks);
      await step("Independent embedded node preview keeps geometry, correct narration and settings roundtrip", async c => {
        await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
        const nodePanel = page.locator(".preview-panel.is-expanded");
        if (!await nodePanel.isVisible()) await page.locator('[data-help-key="preview.openPanel"]').click();
        await nodePanel.waitFor();
        const frame = page.frameLocator('iframe[title="GameCLI 内嵌预览"]');
        await nodePanel.getByRole("button", { name: "播放", exact: true }).click();
        await frame.getByTestId("game-state-playing").waitFor();
        const narration = fixture.project.nodes.find(n => n.data.scene).data.scene.commands[0].text;
        await frame.locator(".dialog-box").filter({ hasText: narration }).waitFor();
        const g = await geometry(nodePanel); c.observed = g; save(); bounded(g); assert.deepEqual(players(), []);
        await nodePanel.getByRole("button", { name: "设置", exact: true }).click();
        await frame.getByTestId("settings-screen").waitFor();
        await nodePanel.getByRole("button", { name: "播放", exact: true }).click();
        await frame.getByTestId("game-state-playing").waitFor();
        await frame.locator(".dialog-box").filter({ hasText: narration }).waitFor();
        await shot(page, cdp, `${current.key}-node-preview`);
        return { geometry: g, separateEmbeddedRuntime: true, noExternalPlayer: true, settingsReturnedToCorrectScene: true };
      }, current.checks);
      current.status = "PASS";
    } catch (e) {
      current.status = "FAILED"; current.error = String(e.stack || e); save();
      await closePlayer();
    } finally { save(); }
  }
  report.trustedInputs = await page.evaluate(() => window.__qaPreviewTrustedInputs);
  assert(report.trustedInputs.length > 30 && report.trustedInputs.every(i => i.trusted));
  assert.equal(report.matrix.length, 12); assert.equal(report.playerProcesses.length, 12);
  assert(report.matrix.every(r => r.status === "PASS")); assert.deepEqual(report.pageErrors, []);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    if (fs.existsSync(held)) { assert(!fs.existsSync(exe)); assert.equal(sha(held), playerSha); fs.renameSync(held, exe); }
    assert.equal(sha(exe), playerSha); report.fault.restored = true;
    if (page && players().length) await closePlayer();
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  await playerBrowser?.close().catch(() => {}); await browser?.close().catch(() => {});
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, preflight: report.checks.length, matrix: report.matrix.length,
    playerProcesses: report.playerProcesses.length, screenshots: report.screenshots.length, error: report.error, cleanupError: report.cleanupError, out }, null, 2));
});
