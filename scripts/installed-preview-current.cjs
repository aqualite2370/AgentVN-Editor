"use strict";
// New actual NSIS install; real toolbar, native host, backend and Player.
// No renderer/store writes, no model requests, no native-input claim.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { captureInstalledWebview, validateNativeViewport } = require("./lib/current-native-capture.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";
// Retain the existing strictly bounded three-profile protection helper unchanged.
const work = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-02";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(work, `installed-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const input = path.join(out, "安装版外部预览隔离工程.vnproj");
const project = fixture(`installed-preview-current-20261021-${attempt}`);
project.title = "1.9.14安装版真实预览";
project.nodes[1].data.scene.commands = [
  { type: "narration", text: "INSTALLED_PREVIEW_FIRST：安装目录外部预览首句。" },
  { type: "narration", text: "INSTALLED_PREVIEW_SECOND：真实点击推进第二句。" },
];
fs.writeFileSync(input, JSON.stringify(project, null, 2), { flag: "wx" });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.14",
  scope: "NEW_NSIS_INSTALLED_TOP_PREVIEW_EXTERNAL_PLAYER_AND_INDEPENDENT_NODE_IFRAME",
  input: desc(input), steps: [], cases: [], players: [], launches: [], cleanups: [], screenshots: [], errors: [], modelRequests: 0,
  notProven: ["Physical native input", "Normal Editor close", "Standalone/setup", "Android", "Upgrade",
    "Source-workspace-independent machine", "Full motion audit"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const installation = read(path.join(qa, "installation.json"));
assert.equal(installation.executable.version, report.version);
const exe = path.join(installation.installRoot, "agentvn-player.exe"), held = exe + ".qa-held-installed-preview";
assert.equal(path.dirname(path.resolve(exe)), path.resolve(qa, "installed-editor"));
assert(!fs.existsSync(held)); report.player = desc(exe);
const protectedFiles = [...read(path.join(qa, "checkpoint-01/report.json")).frozen,
  ...installation.resources, installation.executable, desc(path.join(root, "AgentVN Dev.exe"))];
report.protectedFiles = protectedFiles;
let host, page, playerBrowser, playerPage, playerCdp, owned, profilesJournaled = false, playerHeld = false;
let currentMetrics = { width: 1920, height: 1080, dpr: 1, reduced: false };
const id = p => `${p.ProcessId}:${p.Created}`;
function profile(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function step(label, fn) {
  const row = { label, status: "RUNNING" }; report.steps.push(row); save(); console.log(`START ${label}`);
  try { row.result = await fn(); row.status = "PASS"; console.log(`PASS ${label}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
}
async function click(n) { await n.scrollIntoViewIfNeeded(); await n.click({ trial: true }); await n.click(); }
async function geometry(n) {
  const g = await n.evaluate(n => {
    const rect = n.getBoundingClientRect();
    return { rect: rect.toJSON(), width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth,
      focusUnavailable: !!document.activeElement?.closest('[inert],[aria-hidden="true"]'),
      buttons: [...n.querySelectorAll("button")].filter(b => b.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        && !b.closest("details:not([open])")).map(b => {
        const r = b.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { text: b.textContent.trim(), rect: r.toJSON(), disabled: b.disabled, hit: h === b || b.contains(h) };
      }) };
  });
  assert(g.rect.width > 0 && g.rect.height > 0 && g.rect.left >= -1 && g.rect.top >= -1 &&
    g.rect.right <= g.width + 1 && g.rect.bottom <= g.height + 1 && g.overflow <= 1 && !g.focusUnavailable);
  for (const b of g.buttons.filter(b => !b.disabled)) assert(b.hit && b.rect.width > 0 && b.rect.height > 0 &&
    b.rect.left >= -1 && b.rect.top >= -1 && b.rect.right <= g.width + 1 && b.rect.bottom <= g.height + 1);
  for (let i = 0; i < g.buttons.length; i++) for (let j = i + 1; j < g.buttons.length; j++) {
    const a = g.buttons[i].rect, b = g.buttons[j].rect;
    assert(!(Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1), "Preview controls overlap");
  }
  return g;
}
const status = () => page.getByTestId("preview-window-status");
async function top(surface) { await click(page.locator(`[data-workspace-surface="${surface}"]:visible`)); await settleEditor(page); }
async function startPlayer(port) {
  assert(!rows().some(p => p.Name === "agentvn-player.exe"));
  await click(page.locator('[data-help-key="preview.open"]:visible'));
  await status().filter({ hasText: "运行中" }).waitFor({ timeout: 60000 });
  const tree = ownedProcessTree(rows(), host.current.pid, host.current.created);
  const matches = tree.filter(p => p.Name === "agentvn-player.exe"); assert.equal(matches.length, 1);
  owned = matches[0]; assert.equal(owned.ParentProcessId, host.current.pid);
  assert.equal(path.resolve(owned.ExecutablePath), path.resolve(exe)); assert.equal(sha(owned.ExecutablePath), report.player.sha256);
  const match = owned.CommandLine.match(/--preview-root\s+(?:"([^"]+)"|(\S+))/); assert(match);
  const previewRoot = match[1] || match[2], script = read(path.join(previewRoot, "script.json"));
  assert.equal(script.game_id, project.project_id);
  assert(script.scenes.some(s => s.commands.some(c => c.text === project.nodes[1].data.scene.commands[0].text)));
  const value = { process: owned, previewRoot, script: desc(path.join(previewRoot, "script.json")),
    manifest: desc(path.join(previewRoot, "manifest.json")), executable: desc(owned.ExecutablePath) };
  report.players.push(value); save();
  await until(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, "owned installed external Player WebView");
  assert(listeners([port]).every(l => ownedProcessTree(rows(), host.current.pid, host.current.created)
    .some(p => p.ProcessId === l.OwningProcess)));
  playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  playerPage = playerBrowser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())); assert(playerPage);
  playerPage.setDefaultTimeout(30000); playerPage.on("pageerror", e => { report.errors.push(String(e)); save(); });
  playerCdp = await playerPage.context().newCDPSession(playerPage);
  await playerPage.getByTestId("start-new-game").waitFor(); await settleRuntime(playerPage);
  await click(playerPage.getByTestId("start-new-game")); await settleRuntime(playerPage);
  await playerPage.locator(".dialog-box").filter({ hasText: project.nodes[1].data.scene.commands[0].text }).waitFor();
  return value;
}
async function closePlayer(port) {
  const identity = id(owned);
  await click(page.locator('[data-help-key="preview.close"]:visible')); await status().filter({ hasText: "已关闭" }).waitFor();
  await playerBrowser?.close().catch(() => {}); playerBrowser = undefined;
  await until(() => !rows().some(p => id(p) === identity) && listeners([port]).length === 0, "UI close external Player", 15000);
  assert(await page.locator('[data-help-key="preview.close"]:visible').isDisabled());
}
(async () => {
  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  report.tools = ["scripts/lib/installed-release-session.cjs", "scripts/native-dev-preview-profile.ps1",
    "scripts/lib/current-native-capture.cjs"].map(f => desc(path.join(root, f)));
  for (const f of protectedFiles) assert.equal(sha(f.path), f.sha256);
  const port = await new Promise(resolve => {
    const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)); });
  }); report.previewPort = port;
  profilesJournaled = true; profile("Prepare");
  host = installedReleaseSession({ installationFile: path.join(qa, "installation.json"), out, report, save, input, previewPort: port });
  await step("Real installed home and top preview confirmation do not launch Player", async () => {
    page = await host.start();
    const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
      body: fs.readFileSync(input) });
    const p = await r.json(); assert(r.ok && p.ok); assert.equal(p.data.project_id, project.project_id);
    await page.reload(); await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }));
    await settleEditor(page); await top("preview"); await status().filter({ hasText: "已关闭" }).waitFor();
    const panel = page.getByTestId("preview-launch-panel"); assert.equal(await panel.locator("iframe").count(), 0);
    assert(!rows().some(p => p.Name === "agentvn-player.exe")); return geometry(panel);
  });
  await step("Missing installed Player produces visible failure; real retry after restoring exact bytes", async () => {
    assert.equal(sha(exe), report.player.sha256); assert(!fs.existsSync(held));
    fs.renameSync(exe, held); playerHeld = true;
    await click(page.locator('[data-help-key="preview.open"]:visible'));
    await page.locator(".gamecli-preview-progress.is-error").waitFor();
    await page.locator('[data-help-key="preview.open"]:visible').filter({ hasText: "重试" }).waitFor();
    const message = await page.locator(".gamecli-preview-detail").innerText();
    assert(message.includes("GameCLI executable was not found"));
    assert(!rows().some(p => p.Name === "agentvn-player.exe"));
    const result = { faultInjection: "Rename exact QA installation Player, never a user installation", message,
      geometry: await geometry(page.getByTestId("preview-launch-panel")) };
    assert.equal(sha(held), report.player.sha256); assert(!fs.existsSync(exe)); fs.renameSync(held, exe); playerHeld = false;
    result.retried = await startPlayer(port); return result;
  });
  await step("External preview viewport matrix and actual story advance", async () => {
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const m = { width, height: width * 9 / 16, dpr, reduced }, c = { ...m, status: "RUNNING" };
      report.cases.push(c); save(); currentMetrics = m; await host.metrics(m);
      await playerCdp.send("Emulation.setDeviceMetricsOverride", { width, height: m.height, deviceScaleFactor: dpr, mobile: false });
      await playerPage.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await settleEditor(page); await settleRuntime(playerPage);
      c.confirmation = await geometry(page.getByTestId("preview-launch-panel")); c.external = await geometry(playerPage.locator(".dialog-box"));
      c.externalText = await playerPage.locator(".dialog-text").innerText(); assert.equal(c.externalText, project.nodes[1].data.scene.commands[0].text);
      c.viewport = await playerPage.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches })); validateNativeViewport(c.viewport, m);
      if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
        report.screenshots.push(await captureInstalledWebview(playerPage, playerCdp, path.join(out, `external-${width}-${dpr}-${reduced}.png`), m));
      c.status = "EXTERNAL_PASS"; save(); console.log(`PASS external ${width}/${dpr}/${reduced}`);
    }
    await playerPage.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
    await click(playerPage.locator(".dialog-box"));
    await playerPage.locator(".dialog-text").filter({ hasText: "INSTALLED_PREVIEW_SECOND" }).waitFor();
    return { cases: 12, actualAdvance: true };
  });
  await step("Real close and relaunch creates a new owned Player", async () => {
    const first = id(owned); await closePlayer(port); currentMetrics = { width: 1920, height: 1080, dpr: 1, reduced: false };
    await host.metrics(currentMetrics); const second = await startPlayer(port); assert.notEqual(first, id(second.process));
    await closePlayer(port); return { first, second: id(second.process), closedThroughEditorUI: true };
  });
  await step("Independent real node iframe settings and play matrix with no external Player", async () => {
    await top("edit"); await click(page.locator('.react-flow__node[data-id="scene"]'));
    const panel = page.locator(".preview-panel.is-expanded");
    if (!await panel.isVisible()) await click(page.locator('[data-help-key="preview.openPanel"]:visible'));
    await panel.waitFor();
    const iframe = panel.locator('iframe[title="GameCLI 内嵌预览"]'); await iframe.waitFor();
    const frame = await (await iframe.elementHandle()).contentFrame(); assert(frame);
    for (const c of report.cases) {
      currentMetrics = { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced }; await host.metrics(currentMetrics); await settleEditor(page);
      await click(panel.getByRole("button", { name: "播放", exact: true }));
      await frame.getByTestId("game-state-playing").waitFor();
      await frame.locator(".dialog-text").filter({ hasText: project.nodes[1].data.scene.commands[0].text }).waitFor();
      await click(panel.getByRole("button", { name: "设置", exact: true })); await frame.getByTestId("settings-screen").waitFor();
      await click(panel.getByRole("button", { name: "播放", exact: true })); await frame.getByTestId("game-state-playing").waitFor();
      await frame.locator(".dialog-text").filter({ hasText: project.nodes[1].data.scene.commands[0].text }).waitFor();
      c.nodeText = await frame.locator(".dialog-text").innerText(); assert.equal(c.nodeText, project.nodes[1].data.scene.commands[0].text);
      c.node = await geometry(panel); assert(!rows().some(p => p.Name === "agentvn-player.exe"));
      c.status = "PASS"; save(); console.log(`PASS node ${c.width}/${c.dpr}/${c.reduced}`);
    }
    return { cases: 12, independentNodeIframe: true, externalPlayerAbsent: true };
  });
  assert.equal(report.steps.length, 5); assert(report.steps.every(s => s.status === "PASS"));
  assert.equal(report.cases.length, 12); assert(report.cases.every(c => c.status === "PASS"));
  assert.equal(report.players.length, 2); assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0);
  report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureDOM = await page.locator("body").innerText().catch(String);
    await captureInstalledWebview(page, host.cdp, path.join(out, "failure.png"), currentMetrics)
      .then(s => report.screenshots.push(s)).catch(e => { report.captureError = String(e); });
  }
}).finally(async () => {
  try {
    if (playerHeld) { assert(!fs.existsSync(exe)); assert.equal(sha(held), report.player.sha256); fs.renameSync(held, exe); playerHeld = false; }
    await playerBrowser?.close().catch(() => {}); await host?.stop("End installed top/node preview acceptance");
    if (profilesJournaled && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.path).status, "PASS");
    }
    if (report.previewPort) assert.equal(listeners([report.previewPort]).length, 0);
    for (const f of protectedFiles) assert.equal(sha(f.path), f.sha256);
    assert(!fs.existsSync(held)); assert.equal(sha(input), report.input.sha256);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error, cleanupError: report.cleanupError }));
});
