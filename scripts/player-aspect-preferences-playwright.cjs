"use strict";
// Current Runtime source + real cartridge import. No native install/device claim.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.toLowerCase().startsWith("f:\\agentvn\\qa\\") && !fs.existsSync(out), "Fresh F:\\AgentVN\\QA directory required");
fs.mkdirSync(out, { recursive: true });
const smoke = process.argv.includes("--smoke");
const isolationOnly = process.argv.includes("--isolation-only");
const types = process.argv.find(a => a.startsWith("--types="))?.slice(8).split(",") ?? ["renpy", "agentvn"];
assert(types.length && types.every(t => ["renpy", "agentvn"].includes(t)));
const inheritedFile = process.argv.find(a => a.startsWith("--inherit="))?.slice(10);
const priorFile = process.argv.find(a => a.startsWith("--inputs="))?.slice(9)
  ?? "F:\\AgentVN\\QA\\Viewport-Ratios-20261102-01\\browser-matrix-01\\report.json";
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "RUNNING", scope: "CURRENT_SOURCE_BROWSER_PLAYER_PREFERENCES",
  startedAt: new Date().toISOString(), smoke, isolationOnly, inputs: [], cases: [], screenshots: [], errors: [],
  cleanup: "PENDING", modelRequests: 0 };
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
report.testIdentity = { file: path.join(out, "executed-test.cjs"), sha256: sha(__filename) };
const files = ["shared/cartridge/gameViewport.ts", "GameCli_framework/src/types/settings.ts",
  "GameCli_framework/src/store/settingsStore.ts", "GameCli_framework/src/store/runtimePreferences.ts",
  "GameCli_framework/src/store/runtimeStore.ts",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx", "GameCli_framework/src/components/shell/SettingsScreen.tsx",
  "GameCli_framework/src/styles/shell.css", "GameCli_framework/src/styles/player.css"];
const sourceHashes = () => Object.fromEntries(files.map(f => [f, sha(path.join(root, f))]));
report.sourceHashes = sourceHashes();
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function pass(name, data = {}) { report.cases.push({ name, status: "PASS", ...data }); save(); }
let server, browser, activePage;
async function prepareInputs() {
  const prior = JSON.parse(fs.readFileSync(priorFile, "utf8"));
  assert.equal(prior.status, "PASS");
  report.inputReport = { file: priorFile, sha256: sha(priorFile), purpose: "Historical cartridge bytes only, not reused acceptance" };
  for (const type of ["renpy", "agentvn"]) {
    if (inheritedFile && !types.includes(type)) {
      const priorRun = JSON.parse(fs.readFileSync(inheritedFile, "utf8"));
      assert.equal(priorRun.cleanup, "PASS");
      assert.deepEqual(priorRun.sourceHashes, report.sourceHashes);
      const passed = priorRun.cases.filter(c => c.type === type && c.status === "PASS");
      assert.equal(passed.length, 15, "Only reuse a complete layout matrix plus actual process restart and shared-install isolation");
      report.cases.push(...passed.map(c => ({ ...c, evidenceReusedFrom: inheritedFile })));
      report.screenshots.push(...priorRun.screenshots.filter(s => path.basename(s.file).startsWith(`${type}-`)));
      report.inputs.push(priorRun.inputs.find(i => i.type === type));
      report.inherited = { file: inheritedFile, sha256: sha(inheritedFile), status: priorRun.status,
        purpose: "Completed cases only; the original failure is preserved" };
      continue;
    }
    const c = prior.cases.find(c => c.name === "real-ui-cartridge-export" && c.type === type && c.ratio === "4:3");
    assert(c); assert.equal(sha(c.file), c.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(c.file));
    assert.equal(JSON.parse(await zip.file("ui/layout.json").async("string")).gameViewport.aspectRatio, "4:3");
    const originalLayout = await zip.file("ui/layout.json").async("string");
    // A second distinct game permits real UI A -> B -> A persistence tests.
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    manifest.game_id += "-player-B"; manifest.title = "玩家比例隔离B";
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    const script = JSON.parse(await zip.file("script.json").async("string"));
    script.game_id = manifest.game_id; script.title = manifest.title;
    zip.file("script.json", JSON.stringify(script, null, 2));
    const checksum = JSON.parse(await zip.file("checksum.json").async("string"));
    for (const item of checksum.files) {
      const bytes = await zip.file(item.path).async("nodebuffer");
      item.size_bytes = bytes.length; item.hash_sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    zip.file("checksum.json", JSON.stringify(checksum, null, 2));
    assert.equal(await zip.file("ui/layout.json").async("string"), originalLayout);
    const second = path.join(out, `${type}-game-B.vncart`);
    fs.writeFileSync(second, await zip.generateAsync({ type: "nodebuffer" }), { flag: "wx" });
    report.inputs.push({ type, file: c.file, sha256: sha(c.file), defaultRatio: "4:3",
      second, secondSha256: sha(second), secondIsControlledIdentityFixture: true });
  }
  save();
}
async function frame(page, ratio) {
  await settleRuntime(page);
  const value = await page.locator(".runtime-layout-frame").evaluate(e => {
    const r = e.getBoundingClientRect(), s = e.closest(".ui-skin-scope"), b = s.getBoundingClientRect();
    return { rect: r.toJSON(), scope: b.toJSON(), ratio: s.dataset.gameAspectRatio,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const [a, b] = ratio.split(":").map(Number), r = value.rect, s = value.scope;
  assert.equal(value.ratio, ratio);
  assert(Math.abs(r.width / r.height - a / b) < .003);
  assert(r.width > 0 && r.height > 0 && r.left >= s.left - 1 && r.right <= s.right + 1
    && r.top >= s.top - 1 && r.bottom <= s.bottom + 1);
  assert(Math.abs((r.left + r.right) - (s.left + s.right)) <= 2);
  assert(Math.abs((r.top + r.bottom) - (s.top + s.bottom)) <= 2);
  assert(value.overflow <= 1);
  return value;
}
async function clickRatio(page, ratio) {
  const button = page.getByTestId(`settings-aspect-${ratio}`);
  await button.click();
  await page.waitForFunction(({ ratio }) => document.querySelector(".ui-skin-scope")?.dataset.gameAspectRatio
    === (ratio === "default" ? "4:3" : ratio), { ratio });
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  assert(await button.evaluate(e => e === document.activeElement), "Ratio selection retains keyboard focus");
  const geometry = await page.getByRole("group", { name: "画面比例", exact: true }).evaluate(e =>
    [...e.querySelectorAll("button")].map(b => {
      const r = b.getBoundingClientRect(), panel = b.closest(".settings-content").getBoundingClientRect();
      return { r: r.toJSON(), panel: panel.toJSON(),
        hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    }));
  assert.equal(geometry.length, 4);
  for (const g of geometry) {
    assert(g.hit, "Ratio button hit target blocked");
    assert(g.r.left >= g.panel.left - 1 && g.r.right <= g.panel.right + 1
      && g.r.top >= g.panel.top - 1 && g.r.bottom <= g.panel.bottom + 1, "Ratio control clipped");
  }
  return { value: await frame(page, ratio === "default" ? "4:3" : ratio), geometry };
}
async function launch(page) {
  await page.locator(".launch-panel").getByRole("button", { name: "启动卡带", exact: true }).click();
  await page.getByTestId("start-new-game").waitFor(); await settleRuntime(page);
}
async function importGame(page, file) {
  await page.goto(`${server.url}/?mode=library`);
  await page.getByTestId("web-cartridge-file").setInputFiles(file);
  // An existing game's launch button stays usable while a new import validates.
  // Bind launch to the newly imported source, rather than whichever card was selected.
  try {
    await page.waitForFunction(name => {
      const error = document.querySelector(".cartridge-rail .inline-error");
      if (error?.textContent) throw new Error(`Cartridge rejected: ${error.textContent}`);
      const detail = document.querySelector(".launch-panel .meta-grid");
      const input = document.querySelector('[data-testid="web-cartridge-file"]');
      return detail?.textContent.includes(name) && input && !input.disabled;
    }, path.basename(file));
  } catch (error) {
    report.importFailureText = await page.locator("body").innerText(); save(); throw error;
  }
  await launch(page);
}
async function settings(page) {
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-finish").waitFor(); await settleRuntime(page);
}
async function finish(page) {
  await page.getByTestId("settings-finish").click();
  // idle alone can describe the old settings page before React commits a
  // navigation request. Wait for the actual destination as well.
  await page.waitForFunction(() => {
    const frame = document.querySelector("[data-runtime-screen-transition]");
    return frame?.getAttribute("data-runtime-presented-screen") !== "settings"
      && frame?.getAttribute("data-runtime-screen-transition") === "idle";
  });
  await settleRuntime(page);
}
async function capture(page, name) {
  const before = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, animations: "allow" });
  const after = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  assert.deepEqual(after, before);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32BE(16), before.w * before.dpr);
  assert.equal(bytes.readUInt32BE(20), before.h * before.dpr);
  report.screenshots.push({ file, sha256: sha(file), ...before }); save();
}
const matrix = smoke ? [{ width: 1920, height: 1080, dpr: 1, reduced: false }]
  : [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
async function runCase(game, m) {
  const context = await browser.newContext({
    viewport: { width: m.width, height: m.height }, deviceScaleFactor: m.dpr,
    reducedMotion: m.reduced ? "reduce" : "no-preference",
    ...(m.mobile ? { isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 15; QA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" } : {}),
  });
  try {
    const page = activePage = await context.newPage(); page.setDefaultTimeout(20000);
    await importGame(page, game.file);
    await frame(page, "4:3"); await settings(page);
    assert.equal(await page.getByTestId("settings-aspect-default").getAttribute("aria-pressed"), "true");
    const choices = [];
    for (const ratio of ["16:9", "16:10", "4:3"]) choices.push({ ratio, ...await clickRatio(page, ratio) });
    // A keyboard selection immediately takes effect; no separate apply timer.
    await page.getByTestId("settings-aspect-16:10").focus(); await page.keyboard.press("Space");
    await frame(page, "16:10"); await finish(page); await frame(page, "16:10");
    await page.reload(); await launch(page); await frame(page, "16:10");
    await page.getByTestId("start-new-game").click(); await page.getByTestId("game-state-playing").waitFor();
    if (m.mobile) await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:android-insets", {
      detail: { left: 60, top: 0, right: 24, bottom: 28, coordinateSpace: "css", revision: 1 },
    })));
    await frame(page, "16:10");
    const command = await page.getByTestId("game-state-playing").getAttribute("data-current-command-index");
    // Escape is the supported story -> game menu path for both layouts.
    await page.keyboard.press("Escape"); await settleRuntime(page); await settings(page);
    await clickRatio(page, "16:9"); await finish(page);
    // Use the menu's explicit resume action; don't assume an Escape pressed
    // during the launch handoff has already become an input to the next page.
    const screen = await page.locator("[data-runtime-screen-transition]").getAttribute("data-runtime-presented-screen");
    assert(["playing", "main_menu"].includes(screen), `Unexpected settings return screen: ${screen}`);
    if (screen === "main_menu") await page.getByTestId("continue-game").click();
    await page.getByTestId("game-state-playing").waitFor();
    const playing = await frame(page, "16:9");
    assert.equal(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index"), command);
    let dock;
    if (game.type === "renpy") {
      dock = await page.getByTestId("renpy-quick-bar").evaluate(e => ({
        bar: e.getBoundingClientRect().toJSON(), frame: e.closest(".runtime-layout-frame").getBoundingClientRect().toJSON(),
        buttons: [...e.querySelectorAll("button")].map(b => {
          const r = b.getBoundingClientRect();
          return { rect: r.toJSON(), disabled: b.disabled, hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
        }),
      }));
      assert.equal(dock.buttons.length, 9);
      const gap = dock.frame.bottom - dock.bar.bottom;
      assert(gap >= -1 && gap <= dock.frame.height * .025 + (m.mobile ? 30 : 2));
      if (m.mobile) assert(gap >= 27);
      for (const b of dock.buttons) {
        assert(Math.abs(b.rect.y - dock.buttons[0].rect.y) < 1);
        if (!b.disabled) assert(b.hit);
      }
    }
    await page.keyboard.press("Escape"); await settleRuntime(page); await settings(page);
    await clickRatio(page, "default");
    await frame(page, "4:3");
    if (!m.reduced && (m.dpr === 2 || m.mobile || smoke)) await capture(page,
      `${game.type}-${m.width}-d${m.dpr}${m.mobile ? "-mobile" : ""}`);
    await page.getByTestId("settings-aspect-16:10").click();
    await page.getByTestId("settings-reset-default").click();
    await frame(page, "4:3");
    assert.equal(await page.getByTestId("settings-aspect-default").getAttribute("aria-pressed"), "true");
    await finish(page); await page.reload(); await launch(page); await frame(page, "4:3");
    pass("player-ratio-title-settings-story-reload-reset", { type: game.type, ...m, choices, playing, dock,
      mobileEvidence: m.mobile ? "BROWSER_TOUCH_UA_CONTROLLED_NATIVE_INSETS_NOT_DEVICE" : undefined });
  } catch (error) {
    report.failedCase = { type: game.type, ...m,
      visibleText: (await activePage.locator("body").innerText().catch(() => "")).slice(-9000),
      navigation: await activePage.evaluate(async () => {
        const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
        const s = useRuntimeStore.getState();
        return { screen: s.screen, returnScreen: s.returnScreen, pending: s.pendingScreenNavigation,
          launchTransition: s.launchTransition, activeElement: document.activeElement?.outerHTML,
          presented: document.querySelector("[data-runtime-screen-transition]")?.outerHTML.slice(0, 800) };
      }).catch(error => String(error)) };
    await activePage.screenshot({ path: path.join(out, "failed-case.png") }).catch(() => {}); save();
    throw error;
  } finally { await context.close(); }
}
async function isolation(game) {
  const profile = path.join(out, `${game.type}-persistent-browser`);
  let context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1920, height: 1080 } });
  try {
    const page = activePage = await context.newPage(); page.setDefaultTimeout(20000);
    await importGame(page, game.file); await settings(page); await clickRatio(page, "16:10"); await finish(page);
    const a = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("vn.runtime.settings."))));
    assert.equal(Object.keys(a).length, 1);
    await importGame(page, game.second); await frame(page, "4:3");
    await settings(page); await clickRatio(page, "16:9"); await finish(page);
    const both = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("vn.runtime.settings."))));
    assert.equal(Object.keys(both).length, 2);
    assert.equal(both[Object.keys(a)[0]], a[Object.keys(a)[0]], "B cannot rewrite A preferences");
    await context.close();
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1920, height: 1080 } });
    const reopened = activePage = await context.newPage(); reopened.setDefaultTimeout(20000);
    await reopened.goto(`${server.url}/?mode=library`);
    await reopened.locator(".cartridge-spine").filter({ hasText: "玩家比例隔离B" }).click();
    await launch(reopened); await frame(reopened, "16:9");
    const persisted = await reopened.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("vn.runtime.settings."))));
    assert.deepEqual(persisted, both, "Real browser process restart must preserve both preferences");
    await reopened.goto(`${server.url}/?mode=library`);
    await reopened.locator(".cartridge-spine").filter({ hasText: "画面比例隔离工程" }).click();
    await launch(reopened); await frame(reopened, "16:10");
    await settings(reopened); await clickRatio(reopened, "default"); await finish(reopened); await reopened.reload();
    await reopened.locator(".cartridge-spine").filter({ hasText: "玩家比例隔离B" }).click();
    await launch(reopened); await frame(reopened, "16:9");
    pass("actual-ui-A-B-A-isolation-and-independent-reset", { type: game.type, a, both, persisted,
      browserProcessRestart: true, profile });
  } finally { await context.close(); }
}
async function sharedInstallIsolation(game) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  try {
    const page = activePage = await context.newPage(); page.setDefaultTimeout(20000);
    await page.goto(`${server.url}/?mode=library`);
    await page.getByTestId("web-cartridge-file").waitFor();
    const identities = [];
    async function load(file) {
      const zip = await JSZip.loadAsync(fs.readFileSync(file));
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      // Use the actual complete-cartridge editor preview protocol. Its shared
      // preview_gamecli install ID reproduces fixed-player identity semantics.
      await page.evaluate(({ base64, name, nonce }) => window.postMessage({
        type: "agentvn.runtime.preview", cartridgeBase64: base64, fileName: name, previewNonce: nonce,
      }, location.origin), { base64: fs.readFileSync(file).toString("base64"), name: path.basename(file),
        nonce: `${Date.now()}-${identities.length}` });
      await page.waitForFunction(async gameId => {
        const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
        const s = useRuntimeStore.getState();
        return s.currentGame?.game_id === gameId && s.screen === "title_menu" && s.launchTransition === "idle";
      }, manifest.game_id);
      await page.getByTestId("start-new-game").waitFor(); await settleRuntime(page);
      const identity = await page.evaluate(async () => {
        const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
        const g = useRuntimeStore.getState().currentGame;
        return { installId: g.install_id, gameId: g.game_id, authoredRatio: g.uiSkin.gameViewport.aspectRatio };
      });
      assert.equal(identity.installId, "preview_gamecli"); assert.equal(identity.authoredRatio, "4:3");
      identities.push(identity);
    }
    await load(game.file); await frame(page, "4:3");
    await settings(page); await clickRatio(page, "16:10"); await finish(page);
    await load(game.second); await frame(page, "4:3");
    await settings(page); await clickRatio(page, "16:9"); await finish(page);
    await load(game.file); await frame(page, "16:10");
    await page.reload(); await page.getByTestId("web-cartridge-file").waitFor();
    await load(game.second); await frame(page, "16:9");
    assert.equal(identities[0].gameId, identities[2].gameId);
    assert.notEqual(identities[0].gameId, identities[1].gameId);
    pass("shared-install-actual-preview-protocol-game-identity-isolation", { type: game.type, identities,
      scope: "SOURCE_BROWSER_PUBLIC_PREVIEW_PROTOCOL_NOT_NATIVE_EXE" });
  } finally { await context.close(); }
}
(async () => {
  save();
  try {
    await prepareInputs();
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 0, logFile: path.join(out, "runtime.log") });
    report.owner = { pid: server.pid, runId: server.runId, url: server.url }; save();
    browser = await chromium.launch({ headless: true });
    await server.run(async () => {
      for (const game of report.inputs) {
        if (!types.includes(game.type)) continue;
        if (!isolationOnly) {
          for (const m of [...matrix, { width: 2400, height: 1080, dpr: 1, reduced: false, mobile: true }])
            await runCase(game, m);
        }
        await isolation(game);
        await sharedInstallIsolation(game);
      }
    });
    const expectedTypes = inheritedFile ? 2 : types.length;
    assert.equal(report.cases.filter(c => c.name.startsWith("player-ratio-")).length,
      isolationOnly ? 0 : expectedTypes * (matrix.length + 1));
    assert.equal(report.cases.filter(c => c.name.startsWith("actual-ui-")).length, expectedTypes);
    assert.equal(report.cases.filter(c => c.name.startsWith("shared-install-")).length, expectedTypes);
    assert.deepEqual(sourceHashes(), report.sourceHashes, "Runtime source changed during test");
    for (const input of report.inputs) assert.equal(sha(input.file), input.sha256, "Original cartridge bytes changed");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.errors.push(error.stack);
    if (activePage && !activePage.isClosed()) {
      report.visibleText = (await activePage.locator("body").innerText().catch(() => "")).slice(-9000);
      await activePage.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
    }
  } finally {
    await browser?.close(); await server?.stop();
    let alive = false;
    if (server) { try { await fetch(server.url, { signal: AbortSignal.timeout(900) }); alive = true; } catch {} }
    report.cleanup = alive ? "FAILED_LIVE_SERVICE" : "PASS";
    if (alive) report.status = "FAILED";
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, errors: report.errors }));
    if (report.status !== "PASS") process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
