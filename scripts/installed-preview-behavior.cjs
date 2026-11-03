"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const [phase, destination] = process.argv.slice(2);
assert(["preflight", "external", "node", "maintenance"].includes(phase) && destination && !fs.existsSync(destination));
const root = path.resolve(__dirname, ".."), run = path.join(root, "output/installed-preview-20261018-01");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const launch = read(path.join(run, "launch.json"));
const report = { status: "RUNNING", phase, startedAt: new Date().toISOString(), checks: [], screenshots: [],
  scope: "G11_ACTUAL_INSTALLED_RELEASE_REAL_UI_AND_EXTERNAL_PROCESS_NOT_SOURCE_PREVIEW",
  executable: { path: path.join(launch.installRoot, "agentvn-editor.exe"), sha256: launch.executableSha256 },
  viewportScope: "Real native WebView emulated 1920x1080 DPR1 ordinary, not complete desktop matrix",
  realModelRequests: 0, playerProcesses: [], error: null };
fs.mkdirSync(destination);
let browser, playerBrowser;
const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
function check(name, condition, detail) {
  report.checks.push({ name, status: condition ? "PASS" : "FAILED", detail });
  assert(condition, name);
}
function players() {
  const text = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "@(Get-CimInstance Win32_Process -Filter \"Name='agentvn-player.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate)|ConvertTo-Json -Depth 5"],
  { encoding: "utf8", windowsHide: true });
  const parsed = text.trim() ? JSON.parse(text.replace(/^\uFEFF/, "")) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}
async function geometry(locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll("button")].filter(b =>
      b.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      && !b.closest("details:not([open])") && b.getBoundingClientRect().width > 0).map(button => {
      const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { text: button.textContent, disabled: button.disabled, rect: r.toJSON(),
        hit: !!hit && (hit === button || button.contains(hit)),
        inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    });
    return { rect: rect.toJSON(), width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth, controls };
  });
}
async function projectState() {
  const response = await fetch("http://127.0.0.1:8278/api/project/state", { signal: AbortSignal.timeout(10000) });
  assert(response.ok);
  const body = await response.json();
  assert(body.ok && body.data?.project_metadata?.projectId);
  const savedResponse = await fetch(`http://127.0.0.1:8278/api/project/projects/${encodeURIComponent(body.data.project_metadata.projectId)}`,
    { signal: AbortSignal.timeout(10000) });
  assert(savedResponse.ok);
  const saved = await savedResponse.json();
  assert(saved.ok && saved.data?.project_id === body.data.project_metadata.projectId);
  return { metadata: body.data.project_metadata,
    graph: { nodes: saved.data.nodes, edges: saved.data.edges },
    legacySharedGraph: body.data.project_graph };
}
(async () => {
  assert.equal(sha(report.executable.path), report.executable.sha256);
  const backend = read(path.join(run, "backend-ready.json"));
  assert.equal(backend.status, "PASS");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
  assert(page);
  page.setDefaultTimeout(20000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const before = await projectState();
  assert(!before.metadata.title.includes("隐忍的成长"), "Do not consume final user project");
  if (phase === "preflight") assert.equal(before.metadata.projectId, launch.projectId);
  report.projectBefore = before;
  async function shot(name) {
    report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, `${name}.png`), expected));
  }
  if (phase === "node") {
    await page.getByRole("navigation", { name: "编辑器工作区" }).getByRole("button", { name: "编辑", exact: true }).click();
    const panel = page.locator(".preview-panel.is-expanded");
    if (!(await panel.isVisible())) await page.locator('[data-help-key="preview.openPanel"]').click();
    const frame = page.frameLocator('iframe[title="GameCLI 内嵌预览"]');
    await frame.getByTestId("game-state-playing").waitFor();
    const narration = before.graph.nodes.flatMap(n => n.data.scene?.commands || []).find(c => c.type === "narration").text;
    await frame.locator(".dialog-box").filter({ hasText: narration }).waitFor();
    const dimensions = await geometry(panel);
    check("Node preview frame remains visible and bounded", dimensions.rect.width > 0
      && dimensions.rect.left >= 0 && dimensions.rect.right <= dimensions.width + 1 && dimensions.overflow <= 1, dimensions);
    const frameRect = await page.locator('iframe[title="GameCLI 内嵌预览"]').boundingBox();
    check("Node preview uses an independent actual embedded Runtime", !!frameRect && frameRect.width > 0 && frameRect.height > 0
      && players().length === 0, { frameRect, nativePlayers: players() });
    await panel.getByRole("button", { name: "设置", exact: true }).click();
    await frame.getByTestId("settings-screen").waitFor();
    await shot("node-settings");
    await panel.getByRole("button", { name: "播放", exact: true }).click();
    await frame.getByTestId("game-state-playing").waitFor();
    check("Node preview real page controls return from settings to scene", true);
    await shot("node-playing");
    return;
  }
  await page.getByRole("navigation", { name: "编辑器工作区" }).getByRole("button", { name: "预览", exact: true }).click();
  const panel = page.getByTestId("preview-launch-panel");
  await panel.waitFor();
  await page.waitForFunction(() => !document.querySelector(".workspace-task-panel.is-morphing"));
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
  });
  const status = page.getByTestId("preview-window-status");
  await status.filter({ hasText: "已关闭" }).waitFor();
  check("Real top preview is a confirmation/log page and does not spawn player", players().length === 0
    && await panel.locator("iframe").count() === 0);
  report.confirmationGeometry = await geometry(panel);
  check("Confirmation panel has bounded, hittable launch actions", report.confirmationGeometry.overflow <= 1
    && report.confirmationGeometry.controls.filter(c => !c.disabled).every(c => c.inside && c.hit), report.confirmationGeometry);
  await shot("confirmation");
  if (phase === "maintenance") {
    await panel.locator(".preview-launch-maintenance summary").click();
    await panel.locator('[data-help-key="preview.reload-project"]').click();
    await panel.locator(".gamecli-preview-progress.is-success, .gamecli-preview-progress.is-error").waitFor();
    report.maintenanceText = await panel.innerText();
    report.renderedNodeIds = await page.locator(".react-flow__node").evaluateAll(nodes =>
      nodes.filter(n => !n.closest("[data-editor-transition-snapshot], [data-transition-ghost]"))
        .map(n => n.getAttribute("data-id")).sort());
    report.expectedNodeIds = before.graph.nodes.map(n => n.id).sort();
    report.projectAfter = await projectState();
    await shot("maintenance-reload-result");
    check("Real backend reload succeeds without replacing current project graph with another graph",
      /重载完成/.test(report.maintenanceText)
      && JSON.stringify(report.renderedNodeIds) === JSON.stringify(report.expectedNodeIds),
      { expected: report.expectedNodeIds, actual: report.renderedNodeIds,
        currentProjectId: before.metadata.projectId, legacyIds: before.legacySharedGraph.nodes.map(n => n.id).sort() });
    return;
  }
  await panel.locator('[data-help-key="preview.open"]').click();
  if (phase === "preflight") {
    await panel.locator(".gamecli-preview-progress.is-error").waitFor();
    report.errorText = await panel.innerText();
    check("Incomplete isolated project is rejected before launching a player",
      players().length === 0 && /预览失败|导出校验|失败/.test(report.errorText), report.errorText);
    check("Failure offers a real retry action", await panel.getByRole("button", { name: "重试 GameCLI 预览", exact: true }).isEnabled());
    await shot("validation-error");
    return;
  }
  await status.filter({ hasText: "运行中" }).waitFor({ timeout: 60000 });
  const children = players();
  const player = children.find(p => p.ParentProcessId === launch.editorPid);
  check("Exactly one real player is owned by installed Editor", children.length === 1 && !!player, children);
  check("Actual player comes from this installation, never source workspace",
    player.ExecutablePath.toLowerCase() === path.join(launch.installRoot, "agentvn-player.exe").toLowerCase()
    && /--mode preview --preview-root/.test(player.CommandLine), player);
  report.playerProcesses.push({ ...player, sha256: sha(player.ExecutablePath) });
  const rootMatch = player.CommandLine.match(/--preview-root\s+(?:"([^"]+)"|(\S+))/);
  assert(rootMatch);
  report.previewRoot = rootMatch[1] || rootMatch[2];
  report.exportedScript = read(path.join(report.previewRoot, "script.json"));
  check("Actual exported script belongs to isolated UI project",
    report.exportedScript.game_id === before.metadata.projectId, { previewRoot: report.previewRoot, gameId: report.exportedScript.game_id });
  playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.playerCdpPort}`, { timeout: 30000 });
  const game = playerBrowser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
  assert(game);
  const gameCdp = await game.context().newCDPSession(game);
  await gameCdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await game.getByTestId("start-new-game").waitFor();
  await game.locator(".boot-overlay").waitFor({ state: "detached" });
  report.screenshots.push(await captureInstalledWebview(game, gameCdp, path.join(destination, "external-title.png"), expected));
  await game.getByTestId("start-new-game").click();
  const narration = before.graph.nodes.flatMap(n => n.data.scene?.commands || []).find(c => c.type === "narration").text;
  await game.getByTestId("game-state-playing").waitFor();
  await game.locator(".dialog-box").filter({ hasText: narration }).waitFor({ timeout: 30000 });
  check("Real external player runs exact project narration", true, { narration });
  report.screenshots.push(await captureInstalledWebview(game, gameCdp, path.join(destination, "external-playing.png"), expected));
  await page.locator('[data-help-key="preview.close"]').click();
  await status.filter({ hasText: "已关闭" }).waitFor();
  check("Real editor close action terminates player and reflects OS state", players().length === 0);
  await shot("external-closed");
})().catch(error => { report.error = String(error.stack || error); })
  .finally(async () => {
    await playerBrowser?.close().catch(() => {});
    await browser?.close().catch(() => {});
    report.status = report.error || !report.checks.length || report.checks.some(c => c.status !== "PASS") ? "FAILED" : "PASS";
    report.finishedAt = new Date().toISOString();
    const filename = path.join(destination, "report.json");
    fs.writeFileSync(filename, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, phase, checks: report.checks.map(c => ({ name: c.name, status: c.status })),
      error: report.error, filename }, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  });
