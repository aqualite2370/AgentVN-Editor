"use strict";

// Exercises the authored full-story fixture in an actual exported native
// player. It never injects a script or drives the engine through internal APIs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const { assertRenpyQuickBarGeometry } = require("./lib/installed-portable-layout.cjs");
const { walkDialoguePages } = require("./lib/installed-dialog-pagination.cjs");
const { renderedDialogGlyphs } = require("./lib/rendered-dialog-glyphs.cjs");
const { measureSettingsIconProportions, assertSettingsIconProportions } = require("./lib/runtime-settings-proportions.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const sourceRepro = process.argv.includes("--source-repro");
const ownershipRepro = process.argv.includes("--ownership-repro");

assert(process.argv[2], "Explicit full-story installed acceptance directory required");
const root = path.resolve(process.argv[2]);
const fixture = JSON.parse(fs.readFileSync(process.env.FULL_STORY_FIXTURE_REPORT
  || path.join(root, "fixture-report.json"), "utf8"));
assert.equal(fixture.status, "FIXTURE_VALIDATED");
assert(fixture.projectId.startsWith("installed_resource_flow_story_"));
const attempt = process.env.FULL_STORY_ATTEMPT || "";
assert(!attempt || /^[a-z0-9-]+$/.test(attempt));
const exported = JSON.parse(fs.readFileSync(path.join(root, attempt ? `windows-installed-report-${attempt}.json` : "windows-installed-report.json"), "utf8"));
assert.equal(exported.status, "INSTALLED_WINDOWS_EXPORT_PASS_RUNTIME_PENDING");
const sessionName = process.env.FULL_STORY_SESSION || (attempt ? `nsis-session-${attempt}` : "nsis-session-01");
assert(/^nsis-session-[a-z0-9-]+$/.test(sessionName));
const portable = path.join(root, sessionName, "windows-export/portable");
const names = fs.readdirSync(portable).filter(name => name.endsWith(".exe"));
assert.equal(names.length, 1);
const executable = path.join(portable, names[0]);
const output = path.join(root, `full-story-runtime-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(output);
const width = Number(process.env.INSTALLED_ACCEPTANCE_VIEWPORT_WIDTH || 1920);
const height = Number(process.env.INSTALLED_ACCEPTANCE_VIEWPORT_HEIGHT || 1080);
const dpr = Number(process.env.INSTALLED_ACCEPTANCE_DPR || 1);
const reduced = process.env.INSTALLED_ACCEPTANCE_REDUCED_MOTION === "1";
assert([[1920, 1080], [2560, 1440], [3840, 2160]].some(([w, h]) => w === width && h === height));
assert([1, 2].includes(dpr));
const report = { status: "RUNNING", scope: "Actual installed-editor export; native player with WebView CDP viewport emulation",
  startedAt: new Date().toISOString(), executable, executableSha256: sha256(fs.readFileSync(executable)),
  viewport: { width, height, dpr, reduced }, cases: [], errors: [], output };
if (sourceRepro) report.scope = "Source browser reproduction with exact installed-export fixture; not native acceptance";
if (ownershipRepro) report.scope = "Diagnostic replay of prior exported product: manual-load ownership; not current-product acceptance";
let child, browser, page, sourceServer, evidenceCdp;
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
async function screenshot(name) {
  evidenceCdp ??= await page.context().newCDPSession(page);
  const captured = await captureInstalledWebview(page, evidenceCdp, path.join(output, name), report.viewport);
  (report.screenshots ??= []).push(captured); save();
}
async function test(name, action) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { row.evidence = await action(); row.status = "PASS"; console.log(`PASS: ${name}`); }
  catch (error) { row.status = "FAILED"; throw error; }
  finally { save(); }
}
async function idle(expectedScreen) {
  await page.waitForFunction(expected => {
    const navigator = document.querySelector("[data-runtime-screen-transition]");
    return navigator?.getAttribute("data-runtime-screen-transition") === "idle"
      && (!expected || navigator.getAttribute("data-runtime-presented-screen") === expected
        && navigator.getAttribute("data-runtime-committed-screen") === expected)
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, expectedScreen);
}
async function state(requirePlaying = true) {
  // The previous page can still report idle before React presents a newly
  // requested load. Engine state alone never proves input belongs to gameplay.
  if (requirePlaying) await idle("playing");
  return page.evaluate(async () => {
    let last = "", stable = 0;
    for (let frame = 0; frame < 180; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const player = document.querySelector(".story-player");
      const dialog = document.querySelector(".dialog-box");
      const value = { scene: player?.dataset.currentSceneId, command: player?.dataset.currentCommandIndex,
        choice: player?.dataset.waitingChoice === "true",
        page: Number(dialog?.dataset.dialogPage), pages: Number(dialog?.dataset.dialogPages),
        done: dialog?.dataset.dialogPageDone === "true", mode: dialog?.dataset.dialogueLayoutMode,
        anchor: dialog?.dataset.dialogBubbleAnchor,
        reveal: player?.dataset.typingRevealRequested === "true",
        label: dialog?.getAttribute("aria-label"), text: dialog?.querySelector(".dialog-text")?.textContent ?? "",
        nvl: [...document.querySelectorAll("[data-nvl-line] .nvl-page-text")].map(node => node.textContent) };
      const key = JSON.stringify({ ...value, text: undefined, nvl: undefined });
      stable = key === last ? stable + 1 : 0; last = key;
      if (stable >= 3 && !(value.reveal && !value.done && !value.choice)) return value;
    }
    throw Error("Dialogue state failed to settle within 180 rendered frames");
  });
}
async function reveal() {
  const before = await state();
  if (!before.done) {
    const script = JSON.parse(fs.readFileSync(path.join(portable, "embedded-cartridge/script.json"), "utf8"));
    const authored = script.scenes.find(scene => scene.scene_id === before.scene)?.commands[Number(before.command)]?.text;
    if (!authored || authored.length > 160) await page.locator(".dialog-box").press("Enter");
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
  }
  const after = await state();
  assert.equal(after.command, before.command, "Reveal must not advance the story");
  assert.equal(after.page, before.page, "Reveal must not change pages");
  return after;
}
async function next() {
  const before = await reveal();
  if (before.mode === "bubble") await page.evaluate(() => {
    const samples = [];
    const sample = () => {
      const dialog = document.querySelector(".dialog-box"), player = document.querySelector(".story-player");
      const value = { scene: player?.dataset.currentSceneId, command: player?.dataset.currentCommandIndex,
        page: dialog?.dataset.dialogPage, pages: dialog?.dataset.dialogPages, done: dialog?.dataset.dialogPageDone,
        typing: player?.dataset.isTyping, reveal: player?.dataset.typingRevealRequested,
        textLength: dialog?.querySelector(".dialog-text")?.textContent?.length };
      if (JSON.stringify(samples.at(-1)?.value) !== JSON.stringify(value))
        samples.push({ at: performance.now(), value });
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.querySelector(".story-player"), { attributes: true, childList: true,
      characterData: true, subtree: true });
    const keys = [], key = event => keys.push({ key: event.key, at: performance.now(), target: event.target.className });
    document.addEventListener("keydown", key, true);
    sample(); window.__installedPageInputTrace = { samples, observer, keys, key, sample };
  });
  try {
    await page.locator(".dialog-box").press("Enter");
    await page.waitForFunction(previous => {
      const player = document.querySelector(".story-player"), dialog = document.querySelector(".dialog-box");
      return player?.dataset.currentSceneId !== previous.scene
        || player?.dataset.currentCommandIndex !== previous.command
        || Number(dialog?.dataset.dialogPage) !== previous.page
        || player?.dataset.waitingChoice === "true";
    }, before);
    return await state();
  } finally {
    if (before.mode === "bubble") {
      const input = await page.evaluate(() => {
        const trace = window.__installedPageInputTrace;
        trace.sample(); trace.observer.disconnect(); document.removeEventListener("keydown", trace.key, true);
        delete window.__installedPageInputTrace;
        return { samples: trace.samples, keys: trace.keys };
      });
      (report.bubbleInputTrace ??= []).push({ before, ...input }); save();
    }
  }
}
async function geometry() {
  const viewport = await readInstalledViewport(page, report.viewport);
  (report.viewportChecks ??= []).push(viewport);
  const actual = await page.evaluate(collectSource => {
    const dialog = document.querySelector(".dialog-box");
    const text = dialog?.querySelector(".dialog-text") ?? dialog?.querySelector(".nvl-page");
    const bar = document.querySelector(".renpy-quick-bar");
    const box = node => node?.getBoundingClientRect().toJSON();
    const collect = new Function(`return (${collectSource})`)();
    const glyphs = collect(text);
    return { dialog: box(dialog), text: box(text), glyphs,
      fontMode: dialog?.dataset.dialogFontMode, fontSize: text ? parseFloat(getComputedStyle(text).fontSize) : null,
      textOverflowX: text ? text.scrollWidth - text.clientWidth : 0,
      textOverflowY: text ? text.scrollHeight - text.clientHeight : 0,
      bubbleChildren: [...(dialog?.children ?? [])].map(node => ({
        className: node.className, rect: box(node), scrollHeight: node.scrollHeight,
        height: getComputedStyle(node).height, fontSize: getComputedStyle(node).fontSize,
        lineHeight: getComputedStyle(node).lineHeight, flexShrink: getComputedStyle(node).flexShrink,
      })),
      nvlMeasurement: [".nvl-page-line.is-current", ".nvl-page-text", ".nvl-page-speaker",
        ".nvl-page-measure", ".nvl-page-measure .nvl-page-text"].map(selector => {
        const node = dialog?.querySelector(selector), style = node && getComputedStyle(node);
        return node ? { selector, rect: box(node), clientWidth: node.clientWidth,
          clientHeight: node.clientHeight, fontSize: style.fontSize, lineHeight: style.lineHeight,
          padding: style.padding, border: style.borderWidth, whiteSpace: style.whiteSpace,
          textLength: node.textContent.length } : null;
      }),
      bar: { rect: box(bar), overflow: bar.scrollWidth - bar.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        buttons: [...bar.querySelectorAll("button")].map(button => {
          const rect = button.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { label: button.textContent.trim(), rect: rect.toJSON(), hit: button.contains(hit),
            clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1 };
        }) } };
  }, renderedDialogGlyphs.toString());
  assertRenpyQuickBarGeometry(actual.bar, { width, height });
  if (actual.textOverflowX > 1 || actual.textOverflowY > 1) {
    report.failedGeometry = actual; save();
  }
  const bounds = actual.dialog;
  assert(bounds.x >= -1 && bounds.y >= -1 && bounds.right <= width + 1 && bounds.bottom <= height + 1,
    "Dialogue must remain inside the viewport");
  assert(actual.textOverflowX <= 1 && actual.textOverflowY <= 1, "Dialogue must not crop or scroll its text");
  for (const rect of actual.glyphs) {
    if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1
      || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) {
      report.failedGeometry = actual;
      report.failedGlyph = rect;
      save();
    }
    assert(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
      && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1, "Rendered glyphs must remain inside dialogue");
    const bar = actual.bar.rect;
    assert(Math.min(rect.right, bar.right) - Math.max(rect.left, bar.left) <= 1
      || Math.min(rect.bottom, bar.bottom) - Math.max(rect.top, bar.top) <= 1,
    "Rendered dialogue must not overlap the quick bar");
  }
  return actual;
}
async function menuRoundtrip() {
  const before = await reveal();
  await page.getByTestId("renpy-quick-settings").click();
  await page.getByTestId("settings-screen").waitFor(); await idle();
  await page.getByTestId("settings-finish").click(); await idle();
  const after = await state();
  for (const key of ["scene", "command", "page", "pages", "mode", "text", "nvl"]) {
    assert.deepEqual(after[key], before[key], `Settings return must preserve ${key}`);
  }
  assert(after.done, "Read dialogue must stay revealed after menu return");
  return { before, after };
}
async function quickRoundtrip() {
  const before = await reveal();
  await page.getByTestId("renpy-quick-save").click();
  await page.getByRole("status").filter({ hasText: "快存已保存" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[data-testid="renpy-quick-save"]')?.disabled);
  await page.getByTestId("renpy-quick-load").click();
  const modal = page.getByRole("dialog", { name: "读取最新快存？" });
  await modal.waitFor();
  assert(await modal.evaluate(node => node.contains(document.activeElement)));
  await modal.getByTestId("confirm-quick-load").click(); await modal.waitFor({ state: "hidden" }); await idle();
  const after = await reveal();
  for (const key of ["scene", "command", "page", "pages", "mode", "text", "nvl"]) {
    assert.deepEqual(after[key], before[key], `Native quick-load must restore ${key}`);
  }
  return { before, after };
}
async function pages(prefix) {
  const chunks = [], geometries = [];
  const initial = await state();
  const trace = { prefix, initial: { ...initial, label: undefined, text: undefined, nvl: undefined }, fragments: [] };
  (report.paginationTrace ??= []).push(trace); save();
  assert(initial.pages >= 1, `${prefix} must expose a valid measured page count`);
  const result = await walkDialoguePages({ initial, reveal, next, visit: async (current, index) => {
    // A fixed authored line can fit a larger 2K/4K reading area. Assert only
    // after reveal, when the actual text and late geometry have been measured.
    if (index === 1 && (prefix !== "nvl-long" || width === 1920)) assert(current.pages > 1,
      `${prefix} must exercise actual pagination at this viewport`);
    const text = current.mode === "nvl" ? current.nvl.at(-1) : current.text;
    assert(text);
    trace.fragments.push({
      index, page: current.page, pages: current.pages, textLength: text.length,
      textSha256: sha256(Buffer.from(text)),
      layout: await page.locator(".dialog-box").evaluate(node => {
        const text = node.querySelector(".dialog-text");
        return { rect: node.getBoundingClientRect().toJSON(), fontMode: node.dataset.dialogFontMode,
          font: text ? getComputedStyle(text).fontSize : null,
          lineHeight: text ? getComputedStyle(text).lineHeight : null,
          textWidth: text?.clientWidth, textHeight: text?.clientHeight };
      }),
    }); save();
    chunks.push(text);
    geometries.push(await geometry());
    if (index === 1) {
      await menuRoundtrip(); await quickRoundtrip();
      await screenshot(`${prefix}.png`);
    }
  } });
  const script = JSON.parse(fs.readFileSync(path.join(portable, "embedded-cartridge/script.json"), "utf8"));
  const expected = script.scenes.find(scene => scene.scene_id === initial.scene).commands[Number(initial.command)].text;
  trace.expectedLength = expected.length;
  trace.actualLength = chunks.join("").length; save();
  assert.equal(chunks.join(""), expected, "Every authored character must survive real packaged pagination");
  assert.equal(chunks.length, result.pages);
  return { pages: chunks.length, initialPages: initial.pages, textSha256: sha256(Buffer.from(chunks.join(""))),
    geometry: geometries.map(value => ({ fontMode: value.fontMode, fontSize: value.fontSize, dialog: value.dialog })) };
}
async function main() {
  const manifestPath = path.join(portable, "embedded-cartridge/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.game_id, fixture.projectId);
  report.manifestSha256 = sha256(fs.readFileSync(manifestPath));
  report.layoutSha256 = sha256(fs.readFileSync(path.join(portable, "embedded-cartridge/ui/layout.json")));
  if (sourceRepro) {
    sourceServer = await startOwnedViteServer({ root: path.resolve("GameCli_framework"), port: 0,
      logFile: path.join(output, "source-server.log") });
    report.sourceOwner = { pid: sourceServer.pid, runId: sourceServer.runId, url: sourceServer.url }; save();
    browser = await chromium.launch({
      ignoreDefaultArgs: process.argv.includes("--classic-scrollbars") ? ["--hide-scrollbars"] : [],
    });
    page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr,
      reducedMotion: reduced ? "reduce" : "no-preference" });
    page.on("pageerror", error => report.errors.push(String(error)));
    await page.goto(`${sourceServer.url}/?mode=preview`);
    await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
    const assetUrls = {};
    for (const asset of manifest.assets) {
      const bytes = fs.readFileSync(path.join(portable, "embedded-cartridge", asset.path));
      assetUrls[asset.asset_id] = `data:${asset.mime_type};base64,${bytes.toString("base64")}`;
    }
    await page.evaluate(data => window.postMessage(data, "*"), {
      type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "installed-fixture-source-repro",
      revision: 1, requestId: "source-repro", runId: "source-repro", screen: "title_menu",
      manifest, assetUrls,
      script: JSON.parse(fs.readFileSync(path.join(portable, "embedded-cartridge/script.json"), "utf8")),
      uiSkin: JSON.parse(fs.readFileSync(path.join(portable, "embedded-cartridge/ui/layout.json"), "utf8")),
    });
  } else {
  const port = await new Promise(resolve => { const server = net.createServer();
    server.listen(0, "127.0.0.1", () => { const selected = server.address().port; server.close(() => resolve(selected)); }); });
  child = spawn(executable, [], { cwd: portable, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  report.pid = child.pid;
  const log = fs.createWriteStream(path.join(output, "native.log")); child.stdout.pipe(log); child.stderr.pipe(log);
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(child.exitCode, null);
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push(String(error)));
  // Device-metrics overrides and capture must have one CDP session owner.
  // A second session can return CSS-sized pixels while the DOM still says DPR2.
  const cdp = evidenceCdp = await page.context().newCDPSession(page);
  await page.setViewportSize({ width, height });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  }
  page.setDefaultTimeout(30000);
  await page.evaluate(() => {
    const trace = [];
    const sample = event => {
      const navigator = document.querySelector("[data-runtime-screen-transition]");
      const player = document.querySelector(".story-player");
      const target = event?.target instanceof Element ? event.target : null;
      const focus = document.activeElement;
      const item = { at: performance.now(), event: event?.type, key: event?.key,
        target: target?.getAttribute("data-testid") ?? target?.className,
        focus: focus?.getAttribute("data-testid") ?? focus?.className,
        navigation: navigator ? { ...navigator.dataset } : null,
        launch: document.querySelector('[data-testid="game-launch-blackout"]')?.className,
        scene: player?.dataset.currentSceneId, command: player?.dataset.currentCommandIndex,
        choices: [...document.querySelectorAll(".choice-option")].map(button => ({
          text: button.textContent, disabled: button.disabled })) };
      const signature = JSON.stringify({ ...item, at: 0 });
      if (signature !== trace.at(-1)?.signature) trace.push({ ...item, signature });
      if (trace.length > 600) trace.shift();
    };
    for (const name of ["keydown", "keyup", "click", "focusin"]) document.addEventListener(name, sample, true);
    new MutationObserver(() => sample()).observe(document.getElementById("root"), {
      subtree: true, attributes: true, attributeFilter: ["data-runtime-screen-transition",
        "data-runtime-presented-screen", "data-runtime-committed-screen", "data-runtime-transition-phase",
        "data-current-command-index", "disabled"],
    });
    window.__installedOwnershipTrace = trace;
  });
  await page.getByTestId("start-new-game").click({ trial: true });
  await page.getByTestId("open-settings").click(); await idle();
  await test("installed settings icon/text proportions", async () => {
    const controls = await page.evaluate(measureSettingsIconProportions);
    report.settingsIconProportions = controls; save();
    if (ownershipRepro) report.settingsOpticalCheck = "NOT_APPLICABLE_PRIOR_PRODUCT_DIAGNOSTIC";
    else assertSettingsIconProportions(controls);
    await screenshot("settings-proportions.png");
    return controls;
  });
  await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
  await page.getByRole("checkbox", { name: "自动存档", exact: true }).uncheck();
  await page.getByTestId("settings-finish").click(); await idle();
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor(); await idle();
  await test("actual background, sprite, first dialogue and eight quick actions", async () => {
    const current = await reveal(); assert.equal(current.scene, "main"); assert.equal(current.command, "3");
    const background = await page.locator(".background-transition-frame.is-current").evaluate(async node => {
      const url = /^url\(["']?(.*?)["']?\)$/.exec(getComputedStyle(node).backgroundImage)?.[1];
      if (!url) return null;
      const image = new Image(); image.src = url; await image.decode();
      return { id: node.getAttribute("data-background-id"), width: image.naturalWidth, height: image.naturalHeight };
    });
    assert.equal(background?.id, "story_background");
    assert(background.width > 0 && background.height > 0);
    await page.locator('.sprite-slot[data-character-id="alice"] img').first().waitFor();
    const images = await page.locator(".sprite-slot img").evaluateAll(images => images.map(image =>
      ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })));
    assert(images.some(image => image.complete && image.width > 0));
    await screenshot("first-scene.png");
    return { current, background, images, geometry: await geometry() };
  });
  await next();
  await test("ordinary long dialogue, menu return and native quick-load", () => pages("dialog-long"));
  await next();
  await test("effective rollback and native manual save/load", async () => {
    const at = await reveal(); assert.equal(at.command, "5");
    const rollback = page.getByTestId("renpy-quick-rollback");
    assert(await rollback.isEnabled()); await rollback.click();
    await page.waitForFunction(() => document.querySelector(".story-player")?.dataset.currentCommandIndex === "4");
    let current = await reveal();
    while (current.page < current.pages) { await next(); current = await reveal(); }
    await next(); await reveal();
    await page.getByTestId("renpy-quick-save-load").click(); await idle();
    const slot = page.getByTestId("save-slot-manual-1");
    await slot.getByRole("button", { name: /保存到手动存档 1|覆盖手动存档 1/ }).click();
    await page.getByRole("status").filter({ hasText: "存档已保存" }).waitFor();
    await page.locator(".save-mode-switch").getByRole("button", { name: "读取", exact: true }).click();
    await slot.getByRole("button", { name: "读取手动存档 1", exact: true }).click(); await idle();
    const restored = await reveal(); assert.equal(restored.command, "5");
    return { before: at, restored };
  });
  await next();
  await test("branch selection and NVL accumulation", async () => {
    const choices = page.locator(".choice-option");
    assert.equal(await choices.count(), 2);
    await page.getByRole("button", { name: "选择：验证 NVL 累积阅读", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".story-player")?.dataset.currentSceneId === "nvl");
    await reveal(); await next();
    const current = await reveal();
    assert.equal(current.nvl.length, 2); assert(current.nvl[0].includes("第一行")); assert(current.nvl[1].includes("第二行"));
    await menuRoundtrip(); await quickRoundtrip();
    await screenshot("nvl-accumulation.png");
    return current;
  });
  await next();
  await test("explicit NVL clear, long sentence pagination and restoration", async () => {
    const current = await state(); assert.equal(current.nvl.length, 1);
    return pages("nvl-long");
  });
  await next();
  await page.getByRole("button", { name: "选择：继续验证气泡", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".story-player")?.dataset.currentSceneId === "bubble");
  await test("character bubble, camera transform, movement and disappearance", async () => {
    await reveal();
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogBubbleAnchor === "character");
    const initial = await geometry();
    await next(); await reveal();
    await page.waitForFunction(() => document.querySelector(".sprite-slot.is-right, .sprite-slot.right")
      && document.querySelector(".dialog-box")?.dataset.dialogBubbleAnchor === "character");
    await menuRoundtrip();
    await quickRoundtrip();
    const moved = await geometry();
    await screenshot("bubble-moved.png");
    await next(); await reveal();
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogBubbleAnchor === "fallback");
    const absent = await geometry();
    return { initial, moved, absent };
  });
  await next();
  await test("fixed bubble long text, pagination and native restoration", () => pages("bubble-long"));
  await next();
  await test("ending restores ordinary dialogue and remains usable", async () => {
    const current = await reveal();
    assert.equal(current.scene, "finish"); assert.equal(current.mode, "dialog");
    await menuRoundtrip(); await quickRoundtrip();
    await screenshot("finish.png");
    return { current, geometry: await geometry() };
  });
  assert.deepEqual(report.errors, []);
  assert(report.viewportChecks.length > 0 && report.screenshots.length > 0);
  report.finalViewport = await readInstalledViewport(page, report.viewport);
  report.status = ownershipRepro ? "PRIOR_PRODUCT_OWNERSHIP_REPLAY_PASS"
    : sourceRepro ? "SOURCE_FULL_STORY_REPRO_PASS" : "INSTALLED_FULL_STORY_RUNTIME_PASS";
}
main().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    report.lastState = await state(false).catch(() => null);
    report.ownershipTrace = await page.evaluate(() => window.__installedOwnershipTrace).catch(() => null);
    await screenshot("failure.png").catch(() => {});
  }
}).finally(async () => {
  if (page && !page.isClosed()) report.ownershipTrace = await page.evaluate(() => window.__installedOwnershipTrace).catch(() => null);
  await browser?.close().catch(() => {});
  await sourceServer?.stop();
  if (child?.pid && child.exitCode === null) {
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, encoding: "utf8" });
    report.cleanupExitCode = result.status;
    if (result.status !== 0) { report.status = "FAILED"; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, output, cases: report.cases.map(row => ({ name: row.name, status: row.status })),
    error: report.error, cleanupExitCode: report.cleanupExitCode }));
});
