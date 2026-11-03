"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { installChoiceFrameProbe, analyzeChoiceFrames, analyzeDialogFrames } = require("./lib/nvl-choice-frame-probe.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt, /^\d{2}$/);
const fullMatrix = process.argv.includes("--matrix");
assert(!(fullMatrix && process.argv.includes("--dialog-only")));
const out = `F:/AgentVN/QA/Narrative-Geometry-Source-20261024-01/run-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const exportedFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-49/report.json";
const exported = JSON.parse(fs.readFileSync(exportedFile, "utf8").replace(/^\uFEFF/, ""));
assert.equal(exported.status, "PASS"); assert.equal(exported.fixture.capacityVariant, "mixed-history-v2");
assert.equal(typeof exported.fixture.longTexts.voice_dialog, "string");
assert(exported.fixture.longTexts.voice_dialog.length > 10000);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], screenshots: [],
  fullMatrix,
  scope: "CURRENT_SOURCE_CHROMIUM_EXACT_UI_EXPORTED_FIXTURE_NOT_INSTALLED_ACCEPTANCE",
  modelRequests: 0, fixture: { path: exportedFile, sha256: sha(exportedFile) },
  sources: ["GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/components/player/ChoicePanel.tsx",
    "GameCli_framework/src/styles/player.css"].map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
let browser, server;
async function ready(page, screen) {
  await page.waitForFunction(s => {
    const e = document.querySelector("[data-runtime-screen-transition]");
    return e?.getAttribute("data-runtime-presented-screen") === s &&
      e.getAttribute("data-runtime-screen-transition") === "idle" && !document.querySelector(".game-launch-blackout") &&
      !document.querySelector(".boot-overlay,[data-testid='runtime-opening-screen']");
  }, screen);
}
async function done(page, scene, index) {
  await page.waitForFunction(({ scene, index }) => {
    const s = document.querySelector('[data-testid="game-state-playing"]'), d = document.querySelector(".dialog-box");
    return s?.getAttribute("data-current-scene-id") === scene &&
      Number(s.getAttribute("data-current-command-index")) === index && d?.getAttribute("data-dialog-page-done") === "true";
  }, { scene, index });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function sourceCase(config) {
  const cell = { ...config, status: "RUNNING" }; report.cases.push(cell); save();
  const context = await browser.newContext({ viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.dpr, reducedMotion: config.reduced ? "reduce" : "no-preference" });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const errors = []; page.on("pageerror", e => errors.push(String(e)));
  try {
    const cart = exported.cartridges.find(c => c.layout === config.layout);
    assert.equal(sha(cart.path), cart.sha256);
    await page.goto(`${server.url}/?mode=preview`);
    cell.actualViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
    assert.deepEqual(cell.actualViewport, { width: config.width, height: config.height,
      dpr: config.dpr, reduced: config.reduced });
    await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
    await page.evaluate(cartridgeBase64 => window.postMessage({ type: "agentvn.runtime.preview", cartridgeBase64,
      fileName: "narrative-geometry.vncart", previewNonce: "geometry" }, "*"), fs.readFileSync(cart.path).toString("base64"));
    await ready(page, "title_menu");
    await page.getByTestId("open-settings").click(); await ready(page, "settings");
    await page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }).click();
    await page.locator('[data-settings-tab-current="text"]').waitFor();
    const speed = page.getByRole("slider", { name: "Text speed", exact: true });
    await speed.focus(); await page.keyboard.press("Home"); assert.equal(await speed.inputValue(), "0");
    await page.getByTestId("settings-finish").click(); await ready(page, "title_menu");
    await page.getByTestId("start-new-game").click(); await ready(page, "playing"); await done(page, "narrative_entry", 0);
    await page.locator(".dialog-box").click();
    await page.getByRole("button", { name: "选择：capacity", exact: true }).click(); await done(page, "capacity", 0);
    for (let i = 0; i < 24; i++) {
      await done(page, "capacity", i);
      const pieces = [];
      for (let turn = 0; ; turn++) {
        assert(turn < 1000);
        const state = await page.locator(".dialog-box").evaluate(n => ({ page: +n.dataset.dialogPage, pages: +n.dataset.dialogPages,
          text: n.querySelector('[data-nvl-current="true"] .nvl-page-text')?.textContent }));
        assert(state.text); pieces.push(state.text);
        if (state.page === state.pages) break;
        await page.locator(".dialog-box").click();
        await page.waitForFunction(p => +document.querySelector(".dialog-box").dataset.dialogPage > p, state.page);
        await done(page, "capacity", i);
      }
      assert.equal(pieces.join(""), exported.fixture.capacityTexts[i]);
      if (i === 23 && config.kind === "nvl-choice") {
        await page.evaluate(installChoiceFrameProbe);
        await page.evaluate(() => window.__QA_NVL_CHOICE_PROBE__.start());
      }
      await page.locator(".dialog-box").click();
    }
    await page.getByRole("button", { name: "选择：离开NVL容量页", exact: true }).waitFor();
    if (config.kind === "dialog") {
      await page.getByRole("button", { name: "选择：离开NVL容量页", exact: true }).click(); await done(page, "capacity_end", 0);
      await page.keyboard.press("Escape"); await ready(page, "main_menu");
      await page.getByTestId("start-new-game").click(); await ready(page, "playing"); await done(page, "narrative_entry", 0);
      await page.locator(".dialog-box").click();
      await page.getByRole("button", { name: "选择：voice_dialog", exact: true }).waitFor();
      await page.evaluate(installChoiceFrameProbe, { kind: "dialog" });
      await page.evaluate(() => window.__QA_NVL_CHOICE_PROBE__.start());
      await page.getByRole("button", { name: "选择：voice_dialog", exact: true }).click(); await done(page, "voice_dialog", 0);
    }
    await page.waitForFunction(() => window.__QA_NVL_CHOICE_PROBE__.read().active === false);
    const frames = await page.evaluate(() => window.__QA_NVL_CHOICE_PROBE__.finish());
    const name = `${config.width}-${config.dpr}-${config.reduced}-${config.layout}-${config.kind}`;
    cell.trace = path.join(out, `${name}.json`); fs.writeFileSync(cell.trace, JSON.stringify(frames, null, 2), { flag: "wx" });
    cell.traceSha256 = sha(cell.trace);
    cell.analysis = config.kind === "dialog" ? analyzeDialogFrames(frames) : analyzeChoiceFrames(frames);
    cell.actualGeometry = await page.locator(".dialog-box").evaluate(panel => {
      const text = panel.querySelector(".dialog-text") || panel.querySelector('[data-nvl-current="true"] .nvl-page-text');
      const css = text && getComputedStyle(text), span = text?.firstElementChild, c = span && getComputedStyle(span);
      const leafRects = [], walker = text && document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
      if (walker) while (walker.nextNode()) {
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        leafRects.push(...[...range.getClientRects()].map(r => r.toJSON()));
      }
      return { region: text?.getBoundingClientRect().toJSON(), css: css && { font: css.fontSize, lineHeight: css.lineHeight,
        width: css.width, height: css.height, textWrap: css.textWrap, whiteSpace: css.whiteSpace, padding: css.padding },
        child: span && { rect: span.getBoundingClientRect().toJSON(), font: c.fontSize, lineHeight: c.lineHeight,
          textWrap: c.textWrap, whiteSpace: c.whiteSpace }, leafRects };
    });
    if (config.kind === "dialog" && process.argv.includes("--probe"))
      cell.measurementProbe = await page.locator(".dialog-text").evaluate(text => {
      const css = getComputedStyle(text), fontSize = parseFloat(css.fontSize);
      const result = [];
      for (const width of [text.clientWidth, Math.floor(parseFloat(css.width)), parseFloat(css.width)])
      for (const wrap of ["wrap", "pretty"]) for (const nested of [false, true]) {
        const p = document.createElement("p");
        for (const key of ["fontFamily", "fontWeight", "fontStyle", "letterSpacing", "wordBreak",
          "overflowWrap", "hyphens", "padding", "boxSizing"]) p.style[key] = css[key];
        Object.assign(p.style, { position: "fixed", left: "-10000px", top: "0", visibility: "hidden",
          whiteSpace: "pre-wrap", width: `${width}px`, height: "auto",
          maxHeight: "none", overflow: "visible", margin: "0", fontSize: css.fontSize,
          lineHeight: String(parseFloat(css.lineHeight) / fontSize), textWrap: wrap });
        p.style.setProperty("transition", "none", "important");
        p.style.setProperty("animation", "none", "important");
        if (nested) {
          const child = document.createElement("span");
          Object.assign(child.style, { display: "block", whiteSpace: "pre-wrap" });
          child.textContent = text.textContent; p.appendChild(child);
        } else p.textContent = text.textContent;
        document.body.appendChild(p);
        result.push({ wrap, nested, height: p.getBoundingClientRect().height,
          scrollHeight: p.scrollHeight, width: p.getBoundingClientRect().width,
          fontFamily: getComputedStyle(p).fontFamily, lineHeight: getComputedStyle(p).lineHeight,
          actualHeight: text.getBoundingClientRect().height, actualScrollHeight: text.scrollHeight,
          styleDifferences: [...css].filter(key => /font|text|spacing|white|line|direction|zoom|writing/.test(key))
            .flatMap(key => {
              const measured = getComputedStyle(p).getPropertyValue(key);
              const parent = css.getPropertyValue(key);
              const child = getComputedStyle(text.firstElementChild).getPropertyValue(key);
              return measured === parent && parent === child ? [] : [{ key, measured, parent, child }];
            }) });
        p.remove();
      }
      return result;
    });
    const image = path.join(out, `${name}.png`); await page.screenshot({ path: image });
    const b = fs.readFileSync(image); assert.equal(b.readUInt32BE(16), config.width * config.dpr);
    assert.equal(b.readUInt32BE(20), config.height * config.dpr);
    assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches })), cell.actualViewport);
    report.screenshots.push({ path: image, sha256: sha(image) });
    assert.deepEqual(errors, []);
    assert.equal(cell.analysis.classification, "NO_OVERFLOW_OBSERVED", "No transient or persistent glyph/region overflow");
    if (config.kind === "nvl-choice") {
      assert(frames.some(f => f.choiceEnabled && f.choiceHit), "Choice must become genuinely clickable");
      await page.getByRole("button", { name: "选择：离开NVL容量页", exact: true }).click();
      await done(page, "capacity_end", 0);
      cell.choiceNavigated = true;
    } else {
      const pages = [], initialCount = await page.locator(".dialog-box").getAttribute("data-dialog-pages");
      for (let i = 1; i <= Number(initialCount); i++) {
        await done(page, "voice_dialog", 0);
        const state = await page.locator(".dialog-box").evaluate(n => ({ page: +n.dataset.dialogPage,
          pages: +n.dataset.dialogPages, text: n.querySelector(".dialog-text").textContent,
          overflow: n.querySelector(".dialog-text").scrollHeight - n.querySelector(".dialog-text").clientHeight }));
        assert.equal(state.page, i); assert.equal(state.pages, Number(initialCount)); assert(state.overflow <= 1);
        pages.push(state.text);
        if (i < Number(initialCount)) {
          await page.locator(".dialog-box").click();
          await page.waitForFunction(i => +document.querySelector(".dialog-box").dataset.dialogPage === i + 1, i);
        }
      }
      assert.equal(pages.join(""), exported.fixture.longTexts.voice_dialog, "All ordinary dialogue bytes remain reachable");
      cell.ordinaryPages = pages.length;
    }
    cell.status = "PASS";
  } catch (e) { cell.status = "FAILED"; cell.error = String(e.stack || e); }
  finally { await context.close(); cell.contextClosed = true; save();
    console.log(JSON.stringify({ ...config, status: cell.status, classification: cell.analysis?.classification, error: cell.error?.slice(0, 1500) })); }
}
(async () => {
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "server.log") });
  report.owner = { pid: server.pid, url: server.url, runId: server.runId };
  browser = await chromium.launch();
  await server.run(async () => {
    if (fullMatrix) {
      const matrix = [];
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
        for (const dpr of [1, 2]) for (const reduced of [false, true])
          for (const layout of ["agentvn", "renpy"]) for (const kind of ["nvl-choice", "dialog"])
            matrix.push({ width, height, dpr, reduced, layout, kind });
      // Contexts do not share storage or inputs. Two workers bound memory and
      // avoid serially replaying unrelated fixture paths for twelve minutes.
      let cursor = 0;
      await Promise.all([0, 1].map(async () => {
        while (cursor < matrix.length) await sourceCase(matrix[cursor++]);
      }));
    } else {
      if (!process.argv.includes("--dialog-only"))
        await sourceCase({ width: 1920, height: 1080, dpr: 1, reduced: true, layout: "renpy", kind: "nvl-choice" });
      await sourceCase({ width: 3840, height: 2160, dpr: 1, reduced: false, layout: "renpy", kind: "dialog" });
    }
  });
  assert.equal(report.cases.length, fullMatrix ? 48 : process.argv.includes("--dialog-only") ? 1 : 2);
  assert.equal(new Set(report.cases.map(c => [c.width, c.dpr, c.reduced, c.layout, c.kind].join("/"))).size, report.cases.length);
  for (const f of report.sources) assert.equal(sha(path.join(root, f.file)), f.sha256);
  assert(report.cases.every(c => c.status === "PASS"));
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await server?.stop(); report.browserClosed = true; report.serverStopped = true;
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
