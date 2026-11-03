const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { portableLayoutFlow, assertRenpyQuickBarGeometry } = require("./lib/installed-portable-layout.cjs");
assert(process.argv[2], "explicit installed acceptance directory required");
const runRoot = path.resolve(process.argv[2]);
const portableCandidates = [
  path.join(runRoot, "windows-export/portable"),
  path.join(runRoot, "portable"),
];
const portable = portableCandidates.find(candidate => fs.existsSync(candidate));
assert(portable, `portable package folder was not found under ${runRoot}`);
const expectedTitle = process.env.INSTALLED_ACCEPTANCE_PROJECT_TITLE;
assert(expectedTitle && expectedTitle !== "隐忍的成长", "explicit isolated test project title required");
const executables = fs.readdirSync(portable).filter(name => name.endsWith(".exe"));
assert.equal(executables.length, 1);
const exe = path.join(portable, executables[0]);
const output = path.join(runRoot, `portable-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(output);
const port = 9496;
const report = { ok: false, exe, portable, output, startedAt: new Date().toISOString(), errors: [] };
let browser, page, child;
async function hash(file) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
async function beginTransitionCapture(page, key, selector, readFrame) {
  await page.evaluate(({ key, selector, readFrame }) => {
    window.__installedTransitionCapture ??= {};
    const record = { active: true, frames: [], animationFrameCount: 0, lastPhase: undefined };
    window.__installedTransitionCapture[key] = record;
    const sample = () => {
      if (!record.active) return;
      record.animationFrameCount += 1;
      const element = document.querySelector(selector);
      if (element) {
        const frame = readFrame === "launch"
          ? {
            phase: [...element.classList].find(value => value.startsWith("is-")) ?? "",
            opacity: Number(getComputedStyle(element).opacity),
            screen: document.querySelector("[data-runtime-screen-transition]")
              ?.getAttribute("data-runtime-committed-screen") ?? null,
          }
          : {
            phase: element.getAttribute("data-runtime-transition-phase"),
            state: element.getAttribute("data-runtime-screen-transition"),
            presented: element.getAttribute("data-runtime-presented-screen"),
            committed: element.getAttribute("data-runtime-committed-screen"),
            black: Number(getComputedStyle(element, "::before").opacity),
            rect: (() => {
              const rect = element.getBoundingClientRect();
              return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            })(),
            overflow: document.documentElement.scrollWidth - innerWidth,
          };
        // Preserve every state-boundary frame and sample the opacity curve at
        // ~20Hz. Full 60Hz traces are redundant for the contract and inflate
        // acceptance reports without improving phase or coverage detection.
        if (frame.phase !== record.lastPhase || record.animationFrameCount % 3 === 0) {
          record.frames.push(frame);
          record.lastPhase = frame.phase;
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { key, selector, readFrame });
}
async function endTransitionCapture(page, key) {
  return page.evaluate(key => {
    const record = window.__installedTransitionCapture?.[key];
    if (!record) throw new Error(`Missing transition capture: ${key}`);
    record.active = false;
    return record.frames;
  }, key);
}
function assertBlackout(frames, expectedScreen, viewport, label) {
  const phases = new Set(frames.map(frame => frame.phase));
  assert(phases.has("covering") && phases.has("swap") && phases.has("revealing"),
    `${label} must run cover → commit under black → reveal`, frames);
  assert(frames.some(frame => frame.phase === "covering" && frame.black > 0 && frame.black < 1),
    `${label} must visibly fade to black`, frames);
  assert(frames.some(frame => frame.phase === "swap" && frame.black >= 0.99
    && frame.presented === expectedScreen && frame.committed === expectedScreen),
  `${label} must commit ${expectedScreen} under an opaque full-screen cover`, frames);
  assert(frames.some(frame => frame.phase === "revealing" && frame.black > 0 && frame.black < 1),
    `${label} must visibly reveal the destination from black`, frames);
  assert(frames.every(frame => frame.rect.x <= 0.5 && frame.rect.y <= 0.5
    && Math.abs(frame.rect.width - viewport.width) <= 1
    && Math.abs(frame.rect.height - viewport.height) <= 1
    && frame.overflow <= 1),
  `${label} blackout must cover the viewport without horizontal overflow`, frames);
}
function assertCrossfade(frames, expectedScreen, viewport, label) {
  const phases = new Set(frames.map(frame => frame.phase));
  assert(phases.has("crossfading"),
    `${label} must use the shared-menu crossfade path`, frames);
  assert(!phases.has("covering") && !phases.has("revealing"),
    `${label} must not use the gameplay blackout path`, frames);
  assert(frames.some(frame => frame.phase === "crossfading" && frame.committed === expectedScreen),
    `${label} must commit ${expectedScreen} during content crossfade`, frames);
  assert(frames.every(frame => frame.rect.x <= 0.5 && frame.rect.y <= 0.5
    && Math.abs(frame.rect.width - viewport.width) <= 1
    && Math.abs(frame.rect.height - viewport.height) <= 1
    && frame.overflow <= 1),
  `${label} crossfade must preserve the full viewport without overflow`, frames);
}
function assertLaunchBlackout(frames, label) {
  assert(frames.some(frame => frame.phase === "is-covering" && frame.opacity > 0 && frame.opacity < 1),
    `${label} must visibly fade to black before gameplay`, frames);
  assert(frames.some(frame => frame.screen === "playing" && frame.phase !== "is-arming"),
    `${label} gameplay must commit only after its independent black cover begins`, frames);
}
async function waitForScreenIdle() {
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle"
    && !document.querySelector('[data-testid="game-launch-blackout"]'));
}
async function playerPosition() {
  return page.getByTestId("game-state-playing").evaluate(node => ({
    scene: node.dataset.currentSceneId, command: node.dataset.currentCommandIndex,
    ended: node.dataset.ended,
  }));
}
async function assertPlayingAt(position) {
  await page.getByTestId("game-state-playing").waitFor({ state: "visible" });
  await waitForScreenIdle();
  assert.deepEqual(await playerPosition(), position, "Menu/load must restore the same gameplay position");
}
async function waitForDialogueRead() {
  await page.waitForFunction(() => document.querySelector('[data-testid="game-state-playing"]')
    ?.getAttribute("data-is-typing") === "false");
}
async function exerciseRenpyQuickBar(viewport, manifest) {
  const bar = page.getByTestId("renpy-quick-bar");
  await bar.waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("quick-menu-toggle").count(), 0);
  const geometry = await bar.evaluate(node => ({
    rect: node.getBoundingClientRect().toJSON(),
    overflow: node.scrollWidth - node.clientWidth,
    pageOverflow: document.documentElement.scrollWidth - innerWidth,
    buttons: [...node.querySelectorAll("button")].map(button => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { id: button.dataset.testid, label: button.textContent.trim(), rect: rect.toJSON(),
        disabled: button.disabled, hit: hit === button || button.contains(hit),
        clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1 };
    }),
  }));
  assertRenpyQuickBarGeometry(geometry, viewport);
  report.quickBar = { geometry, actions: {} };
  const evidence = report.quickBar.actions;
  const position = await playerPosition();
  // This fixture has one narration and no earlier dialogue. Do not advance it
  // to manufacture rollback coverage, or claim a disabled control was clicked.
  assert(await page.getByTestId("renpy-quick-rollback").isDisabled());
  evidence.rollback = { status: "PASS", behavior: "Disabled at first dialogue; no earlier rollback target" };
  await waitForDialogueRead();
  for (const action of ["auto", "skip"]) {
    const button = page.getByTestId(`renpy-quick-${action}`);
    await button.click();
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    // The first real click retains button focus. Keyboard activation switches
    // it off without Playwright's second-click stability wait racing the 60ms
    // skip timer of this deliberately one-line fixture.
    await page.keyboard.press("Enter");
    assert.equal(await button.getAttribute("aria-pressed"), "false");
    evidence[action] = { status: "PASS", behavior: "Real click enables; focused Enter disables after dialogue read" };
  }
  await page.getByTestId("renpy-quick-history").click();
  await page.locator(".history-list").waitFor({ state: "visible" });
  await waitForScreenIdle();
  assert((await page.locator(".history-list").innerText()).includes(report.dialogue.trim()));
  await page.getByTestId("renpy-menu-return").click();
  await assertPlayingAt(position);
  evidence.history = { status: "PASS", behavior: "Dialogue history and return preserve position" };

  await page.getByTestId("renpy-quick-save").click();
  await page.getByRole("status").filter({ hasText: "快存已保存" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[data-testid="renpy-quick-save"]')?.disabled);
  evidence.save = { status: "PASS", behavior: "Native quick-save completion acknowledged" };
  await page.getByTestId("renpy-quick-load").click();
  const confirmation = page.getByRole("dialog", { name: "读取最新快存？" });
  await confirmation.waitFor({ state: "visible" });
  assert(await confirmation.evaluate(node => node.contains(document.activeElement)));
  await page.keyboard.press("Tab");
  assert(await confirmation.evaluate(node => node.contains(document.activeElement)));
  await confirmation.getByTestId("confirm-quick-load").click();
  await confirmation.waitFor({ state: "hidden" });
  await assertPlayingAt(position);
  evidence.load = { status: "PASS", behavior: "Confirmation, focus containment and native reload" };

  await page.getByTestId("renpy-quick-save-load").click();
  await page.getByTestId("save-slot-grid").waitFor({ state: "visible" });
  await waitForScreenIdle();
  const slot = page.getByTestId("save-slot-manual-1");
  await slot.getByRole("button", { name: /保存到手动存档 1|覆盖手动存档 1/ }).click();
  await page.getByRole("status").filter({ hasText: "存档已保存" }).waitFor({ state: "attached" });
  await slot.locator(".save-card-main:not([disabled])").waitFor();
  await page.locator(".save-mode-switch").getByRole("button", { name: "读取", exact: true }).click();
  await slot.getByRole("button", { name: "读取手动存档 1", exact: true }).click();
  await assertPlayingAt(position);
  evidence["save-load"] = { status: "PASS", behavior: "Manual slot 1 native write and actual reload" };

  await page.getByTestId("renpy-quick-settings").click();
  await page.getByTestId("settings-screen").waitFor({ state: "visible" });
  await waitForScreenIdle();
  await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
  assert(!await page.getByRole("checkbox", { name: "自动存档", exact: true }).isChecked());
  await page.getByTestId("settings-finish").click();
  await assertPlayingAt(position);
  evidence.settings = { status: "PASS", behavior: "Settings entry, preserved preference and return" };
  report.quickBar.saveScope = { gameId: manifest.game_id, source: "Actual packaged native save service; isolated fixture game" };
}
async function main() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
  report.exeSha256 = await hash(exe);
  const manifestPath = path.join(portable, "embedded-cartridge/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const layoutPath = path.join(portable, "embedded-cartridge/ui/layout.json");
  const flow = portableLayoutFlow(JSON.parse(fs.readFileSync(layoutPath, "utf8")));
  report.layout = { path: layoutPath, sha256: await hash(layoutPath), ...flow };
  report.manifestSha256 = await hash(manifestPath);
  assert.equal(manifest.title, expectedTitle);
  child = spawn(exe, [], { cwd: portable, windowsHide: true,
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*` },
    stdio: ["ignore", "pipe", "pipe"] });
  report.pid = child.pid;
  const log = fs.createWriteStream(path.join(output, "native.log"));
  child.stdout.pipe(log); child.stderr.pipe(log);
  for (let i = 0; i < 120; i++) {
    assert.equal(child.exitCode, null, "portable exited during startup");
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(60000);
  const acceptanceWidth = Number(process.env.INSTALLED_ACCEPTANCE_VIEWPORT_WIDTH || 1920);
  const acceptanceHeight = Number(process.env.INSTALLED_ACCEPTANCE_VIEWPORT_HEIGHT || 1080);
  const acceptanceDpr = Number(process.env.INSTALLED_ACCEPTANCE_DPR || 1);
  const reducedMotion = process.env.INSTALLED_ACCEPTANCE_REDUCED_MOTION === "1";
  assert(Number.isFinite(acceptanceWidth) && acceptanceWidth >= 1080);
  assert(Number.isFinite(acceptanceHeight) && acceptanceHeight >= 720);
  assert([1, 2].includes(acceptanceDpr), "Acceptance DPR must be 1 or 2");
  await page.setViewportSize({ width: acceptanceWidth, height: acceptanceHeight });
  const emulation = await page.context().newCDPSession(page);
  await emulation.send("Emulation.setDeviceMetricsOverride", {
    width: acceptanceWidth, height: acceptanceHeight, deviceScaleFactor: acceptanceDpr, mobile: false,
  });
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  report.emulation = { scope: "Actual exported Windows package WebView; CDP viewport emulation, not a physical display",
    width: acceptanceWidth, height: acceptanceHeight, dpr: acceptanceDpr, reducedMotion };
  report.mainFrameNavigations = [];
  page.on("framenavigated", frame => {
    if (frame === page.mainFrame()) {
      report.mainFrameNavigations.push({ url: frame.url(), at: new Date().toISOString() });
    }
  });
  page.on("pageerror", error => report.errors.push(String(error)));
  await page.getByTestId("start-new-game").waitFor({ state: "visible", timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector(".boot-overlay"));
  // Visibility alone can precede the title's measured viewport scale and
  // initial hit-test handoff. Trial uses the same real actionability checks
  // as a click, with a bounded timeout and without starting the game.
  await page.getByTestId("start-new-game").click({ trial: true, timeout: 10000 });
  // The packaged WebView can finish its initial Tauri navigation just after
  // CDP attaches. Avoid a one-shot evaluate during that document replacement;
  // wait for the actual title UI first, then collect viewport evidence.
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  report.viewport = viewport;
  report.actualMedia = await page.evaluate(() => ({ dpr: window.devicePixelRatio,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  assert.deepEqual(viewport, { width: acceptanceWidth, height: acceptanceHeight });
  assert.equal(report.actualMedia.dpr, acceptanceDpr);
  assert.equal(report.actualMedia.reducedMotion, reducedMotion);
  report.title = await page.getByTestId("start-new-game").evaluate(button => {
    const r = button.getBoundingClientRect(), s = getComputedStyle(button);
    return { background: s.backgroundColor, icons: button.querySelectorAll("svg").length,
      rect: r.toJSON(),
      hitTestId: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.getAttribute("data-testid"),
      clickable: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
  });
  assert.equal(report.title.background, "rgba(0, 0, 0, 0)");
  assert.equal(report.title.icons, 0);
  assert(report.title.clickable);
  await page.screenshot({ path: path.join(output, "title.png") });
  await beginTransitionCapture(page, "title-settings", "[data-runtime-screen-transition]", "screen");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-screen").waitFor();
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  report.transitions ??= {};
  report.transitions.titleToSettings = await endTransitionCapture(page, "title-settings");
  (flow.type === "renpy" ? assertCrossfade : assertBlackout)(
    report.transitions.titleToSettings, "settings", viewport, "Title → settings");
  const autosave = page.getByRole("checkbox", { name: "自动存档", exact: true });
  if (!await autosave.isVisible()) await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
  await autosave.uncheck(); // isolated WebView preference; no shared save writes
  assert(!await autosave.isChecked());
  report.autosaveDisabled = true;
  await beginTransitionCapture(page, "settings-title", "[data-runtime-screen-transition]", "screen");
  await page.getByTestId("settings-finish").click();
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  report.transitions.settingsToTitle = await endTransitionCapture(page, "settings-title");
  (flow.type === "renpy" ? assertCrossfade : assertBlackout)(
    report.transitions.settingsToTitle, "title_menu", viewport, "Settings → title");
  await page.getByTestId("open-about").click();
  await page.getByTestId("about-screen").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  const renpyReturn = page.locator('[data-testid="renpy-menu-return"]:visible');
  const legacyReturn = page.locator('[data-testid="back-to-main-menu"]:visible');
  if (await renpyReturn.count()) await renpyReturn.click();
  else await legacyReturn.click();
  await page.getByTestId("game-state-title").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  report.settingsAboutReturn = true;
  await beginTransitionCapture(page, "title-gameplay", '[data-testid="game-launch-blackout"]', "launch");
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor();
  await page.waitForSelector('[data-testid="game-launch-blackout"]', { state: "detached" });
  report.transitions.titleToGameplay = await endTransitionCapture(page, "title-gameplay");
  assertLaunchBlackout(report.transitions.titleToGameplay, "Title → gameplay");
  await page.waitForFunction(() => (document.querySelector(".dialog-text")?.textContent || "").trim().length > 3);
  report.background = await page.locator(".background-transition-frame.is-current").evaluate(async element => {
    const url = /^url\(["']?(.*?)["']?\)$/.exec(getComputedStyle(element).backgroundImage)?.[1];
    if (!url) return { loaded: false };
    const image = new Image(); image.src = url; await image.decode();
    return { loaded: image.naturalWidth > 0, assetId: element.getAttribute("data-background-id"), width: image.naturalWidth, height: image.naturalHeight };
  });
  assert(report.background.loaded && manifest.assets.some(asset => asset.asset_id === report.background.assetId));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  report.dialogue = await page.locator(".dialog-text").innerText();
  await page.screenshot({ path: path.join(output, "playing.png") });
  if (flow.type === "renpy") await exerciseRenpyQuickBar(viewport, manifest);
  else await page.getByTestId(flow.menu.toggle).click();
  await beginTransitionCapture(page, "gameplay-main-menu", "[data-runtime-screen-transition]", "screen");
  if (flow.menu.key) await page.keyboard.press(flow.menu.key);
  else await page.getByTestId(flow.menu.button).click();
  await page.getByTestId("continue-game").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  report.transitions.gameplayToMenu = await endTransitionCapture(page, "gameplay-main-menu");
  assertBlackout(report.transitions.gameplayToMenu, "main_menu", viewport, "Gameplay → game menu");
  await beginTransitionCapture(page, "menu-gameplay", '[data-testid="game-launch-blackout"]', "launch");
  await page.getByTestId("continue-game").click();
  await page.getByTestId("game-state-playing").waitFor();
  await page.waitForSelector('[data-testid="game-launch-blackout"]', { state: "detached" });
  report.transitions.menuToGameplay = await endTransitionCapture(page, "menu-gameplay");
  assertLaunchBlackout(report.transitions.menuToGameplay, "Game menu → gameplay");
  await page.screenshot({ path: path.join(output, "playing-after-return.png") });
  assert.deepEqual(report.errors, []);
  report.ok = true;
}
main().catch(async error => {
  report.error = String(error.stack || error); process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (child?.pid && child.exitCode === null) {
    const stopped = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
    report.cleanupExitCode = stopped.status;
    if (stopped.status !== 0) { report.ok = false; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  const transitions = Object.fromEntries(Object.entries(report.transitions || {}).map(([name, frames]) => {
    const opacityKey = frames.some(frame => Object.hasOwn(frame, "black")) ? "black" : "opacity";
    return [name, {
      frames: frames.length,
      phases: [...new Set(frames.map(frame => frame.phase))],
      minOpacity: Math.min(...frames.map(frame => frame[opacityKey])),
      maxOpacity: Math.max(...frames.map(frame => frame[opacityKey])),
      maxOverflow: Math.max(0, ...frames.map(frame => frame.overflow ?? 0)),
    }];
  }));
  console.log(JSON.stringify({
    ok: report.ok,
    exe: report.exe,
    exeSha256: report.exeSha256,
    manifestSha256: report.manifestSha256,
    output,
    viewport: report.viewport,
    emulation: report.emulation,
    actualMedia: report.actualMedia,
    title: report.title,
    transitions,
    autosaveDisabled: report.autosaveDisabled,
    settingsAboutReturn: report.settingsAboutReturn,
    background: report.background,
    layout: report.layout,
    quickBar: report.quickBar ? { actions: report.quickBar.actions, saveScope: report.quickBar.saveScope } : undefined,
    errors: report.errors,
    cleanupExitCode: report.cleanupExitCode,
    error: report.error,
    finishedAt: report.finishedAt,
  }, null, 2));
});
