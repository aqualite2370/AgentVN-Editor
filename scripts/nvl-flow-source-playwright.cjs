"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip"), { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/NVL-Flow-Source-20261020-01";
const out = process.env.AGENTVN_NVL_FLOW_OUTPUT;
assert(out && !fs.existsSync(out), "Explicit fresh output required");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const fixture = read(path.join(qa, "manifest.json"));
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const report = { status: "RUNNING", at: new Date().toISOString(), layer: "GameCLI Runtime",
  scope: "Source Chromium/public preview protocol; not installed or Android", modelRequests: 0, cases: [],
  sources: fixture.files.filter(f => f.file.startsWith("GameCli_framework") || f.file.startsWith("shared/"))
    .concat([{ file: "GameCli_framework/src/components/player/useNvlPanelRect.ts" }])
    .map(f => ({ file: f.file, sha256: hash(fs.readFileSync(path.join(root, f.file))) })),
  testSha256: hash(fs.readFileSync(__filename)) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let server, browser;
async function ready(page, screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.dataset.runtimePresentedScreen === screen && n.dataset.runtimeTransitionPhase === "idle"
      && !document.querySelector(".game-launch-blackout");
  }, screen);
}
async function stable(page) {
  return page.evaluate(async () => {
    let previous = "", count = 0;
    for (let i = 0; i < 240; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const n = document.querySelector(".dialog-box");
      const current = JSON.stringify([n?.getBoundingClientRect().toJSON(), { ...n?.dataset },
        document.querySelector(".nvl-page")?.textContent]);
      count = current === previous ? count + 1 : 0; previous = current;
      if (count >= 4 && n?.dataset.dialogPageDone === "true") return;
    }
    throw Error("NVL measurement did not settle");
  });
}
async function initialize(page, payload) {
  await page.goto(`${server.url}/?mode=preview`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
  await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
    sessionId: `nvl-${Date.now()}`, revision: 1, requestId: "init", runId: "nvl-flow",
    screen: "title_menu", ...payload }, "*"), payload);
  await ready(page, "title_menu");
  await page.getByTestId("open-settings").click(); await ready(page, "settings");
  await page.getByRole("button", { name: "文字", exact: true }).click();
  const speed = page.getByRole("slider", { name: "Text speed", exact: true });
  await speed.focus(); await speed.press("Home"); assert.equal(await speed.inputValue(), "0");
  await page.getByTestId("settings-finish").click(); await ready(page, "title_menu");
  await page.getByTestId("start-new-game").click(); await ready(page, "playing");
}
async function observe(page) {
  return page.evaluate(() => {
    const rect = n => n?.getBoundingClientRect().toJSON();
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const panel = document.querySelector(".dialog-box.is-nvl-presentation"), content = panel?.querySelector(".nvl-page");
    const controls = [...document.querySelectorAll(".playback-controls button,.renpy-quick-bar button")]
      .filter(n => n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })).map(n => {
        const box = rect(n), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { id: n.dataset.testid || n.getAttribute("aria-label"), rect: box, disabled: n.disabled,
          hit: n.contains(hit) };
      });
    const glyphRects = [], controlHits = [];
    for (const n of content?.querySelectorAll(".nvl-page-text,.nvl-page-speaker") || []) {
      const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode;
        for (let offset = 0; offset < text.length; offset++) {
          if (!text.textContent[offset].trim()) continue;
          const range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + 1);
          const box = range.getBoundingClientRect().toJSON(); range.detach();
          if (box.width <= 0 || box.height <= 0) continue;
          glyphRects.push(box);
          for (const control of controls) if (overlap(box, control.rect))
            controlHits.push({ char: text.textContent[offset], control: control.id, rect: box });
        }
      }
    }
    const choices = [...document.querySelectorAll(".choice-option")].map(n => {
      const box = rect(n), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { text: n.textContent, rect: box, disabled: n.disabled, hit: n.contains(hit),
        glyphOverlap: glyphRects.some(g => overlap(g, box)) };
    });
    const contentBox = rect(content);
    return { panel: rect(panel), content: contentBox, controls, controlHits, choices,
      choicePanel: rect(document.querySelector(".choice-panel")), glyphCount: glyphRects.length,
      text: content?.textContent, lines: [...content?.querySelectorAll("[data-nvl-line]") || []]
        .map(n => n.querySelector(".nvl-page-text")?.textContent),
      page: Number(panel?.dataset.dialogPage), pages: Number(panel?.dataset.dialogPages),
      clippedGlyphs: glyphRects.filter(g => contentBox && (g.top < contentBox.top - 1
        || g.bottom > contentBox.bottom + 1 || g.left < contentBox.left - 1 || g.right > contentBox.right + 1)).length,
      nestedButtons: document.querySelectorAll("button button").length,
      scroll: content ? { x: content.scrollWidth - content.clientWidth, y: content.scrollHeight - content.clientHeight } : null,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
function check(c, name, ok, detail) { c.checks.push({ name, status: ok ? "PASS" : "FAILED", detail }); }
(async () => {
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "vite.log") });
  report.service = { pid: server.pid, runId: server.runId, url: server.url };
  browser = await chromium.launch({ headless: false });
  const smoke = process.env.AGENTVN_NVL_FLOW_SMOKE === "1";
  for (const p of fixture.packages) {
    const bytes = fs.readFileSync(p.path); assert.equal(hash(bytes), p.sha256);
    const zip = await JSZip.loadAsync(bytes), json = async file => JSON.parse(await zip.file(file).async("string"));
    const manifest = await json("manifest.json"), script = await json("script.json"), uiSkin = await json("ui/layout.json");
    const assetUrls = {};
    for (const asset of manifest.assets) {
      const file = zip.file(asset.path); assert(file);
      const url = `data:${asset.mime_type};base64,${await file.async("base64")}`;
      assetUrls[asset.asset_id] = url; assetUrls[asset.path] = url;
    }
    for (const [width, height] of smoke ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of smoke ? [1] : [1, 2]) for (const reduced of smoke ? [false] : [false, true])
        for (const scenario of ["capacity-choices", "long-text-controls"]) {
          const c = { key: `${p.layout}-${width}-${dpr}-${reduced}-${scenario}`, layout: p.layout,
            width, height, dpr, reduced, scenario, status: "RUNNING", checks: [], errors: [],
            input: scenario === "capacity-choices" ? "Exact historical UI cartridge JSON/asset bytes"
              : "Controlled numbered long NVL without voice; exact UI-exported skin" };
          report.cases.push(c); save();
          const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
            reducedMotion: reduced ? "reduce" : "no-preference" });
          const page = await context.newPage(); page.setDefaultTimeout(30000);
          page.on("pageerror", error => c.errors.push(String(error)));
          try {
            await server.run(async () => {
              const sample = structuredClone({ manifest, script, uiSkin, assetUrls });
              if (scenario === "long-text-controls") {
                const text = Array.from({ length: 340 * Math.ceil(width / 1920) ** 2 }, (_, i) =>
                  `NVL第${String(i + 1).padStart(3, "0")}段：月光映照石阶，远处传来清晰的脚步声；她停下来，确认每一页文字都完整保留。`).join("");
                sample.script.entry_scene_id = "nvl_probe";
                sample.manifest.entry_scene_id = "nvl_probe";
                sample.script.scenes = [{ scene_id: "nvl_probe", title: "长句与菜单", chapter: 1, tags: [], commands: [
                  { type: "dialog", character_id: "hero", text, presentation_mode: "nvl" },
                  { type: "dialog", character_id: "hero", text: "新一句", presentation_mode: "dialog" },
                ] }];
              }
              await initialize(page, sample);
              if (scenario === "capacity-choices") {
                // The exported project starts with an ordinary entry dialog.
                // Advance it through the real input path, rather than jumping scenes.
                await page.waitForFunction(() => document.querySelector(".story-player")?.dataset.currentSceneId === "qa_entry"
                  && document.querySelector(".story-player")?.dataset.currentCommandIndex === "1"
                  && document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
                await page.locator(".dialog-box").press("Enter");
                await page.getByRole("button", { name: "选择：进入NVL容量", exact: true }).click();
                for (let index = 0; index < 24; index++) {
                  await page.waitForFunction(index => document.querySelector(".story-player")?.dataset.currentSceneId === "nvl_capacity"
                    && document.querySelector(".story-player")?.dataset.currentCommandIndex === String(index)
                    && document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true", index);
                  await page.locator(".dialog-box").press("Enter");
                }
                await page.getByRole("button", { name: "选择：容量分支1", exact: true }).waitFor();
                await stable(page);
                await page.waitForFunction(() => [...document.querySelectorAll(".choice-option")].every(n =>
                  !n.disabled && n.getAnimations().every(a => a.playState !== "running")));
                c.observation = await observe(page);
                const b = c.observation.panel;
                check(c, "All three NVL choices stay within the NVL frame", c.observation.choices.length === 3
                  && c.observation.choices.every(n => b && n.rect.left >= b.left - 1 && n.rect.right <= b.right + 1
                    && n.rect.top >= b.top - 1 && n.rect.bottom <= b.bottom + 1), c.observation.choices);
                check(c, "Choices reserve space rather than overlay visible NVL glyphs",
                  c.observation.choices.every(n => !n.glyphOverlap));
                check(c, "Every branch remains enabled and actually hittable",
                  c.observation.choices.every(n => !n.disabled && n.hit));
                check(c, "NVL text advance and choices use separate native buttons",
                  c.observation.nestedButtons === 0
                  && await page.locator(".nvl-advance-surface").count() === 1);
              } else {
                await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.dataset.dialogPages) > 1);
                await stable(page);
                await page.locator(".dialog-box").press("Enter");
                await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPage === "2");
                await stable(page);
                c.observation = await observe(page);
                check(c, "Collapsed quick controls never cover non-whitespace NVL glyphs",
                  c.observation.controlHits.length === 0, c.observation.controlHits.slice(0, 50));
                if (p.layout === "agentvn") {
                  await page.getByTestId("quick-menu-toggle").click();
                  await page.waitForFunction(() => document.querySelector(".playback-controls")?.classList.contains("is-expanded"));
                  await page.locator(".quick-menu-surface").evaluate(async n => {
                    await Promise.all(n.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity)
                      .map(a => a.finished.catch(() => {})));
                  });
                  c.expanded = await observe(page);
                  check(c, "Expanded seven actions and toggle never cover NVL glyphs", c.expanded.controlHits.length === 0,
                    c.expanded.controlHits.slice(0, 50));
                  check(c, "All eight expanded controls remain visible and hittable", c.expanded.controls.length === 8
                    && c.expanded.controls.every(n => n.hit || n.disabled));
                  check(c, "Default AgentVN controls remain outside above the actual NVL frame",
                    [c.observation, c.expanded].every(o => o.controls.every(n => n.rect.bottom <= o.panel.top - 6
                      && n.rect.top >= 0 && n.rect.left >= 0 && n.rect.right <= width)));
                }
              }
              check(c, "NVL page has no scroll clipping or horizontal overflow", c.observation.scroll?.x <= 1
                && c.observation.scroll?.y <= 2 && c.observation.overflow <= 1 && c.observation.clippedGlyphs === 0);
              const before = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
                reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
              const file = path.join(out, `${c.key}.png`), png = await page.screenshot({ path: file });
              const after = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
                reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
              assert.deepEqual(before, { width, height, dpr, reduced }); assert.deepEqual(after, before);
              assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), height * dpr);
              c.screenshot = { path: file, sha256: hash(png), before, after };
              if (scenario === "capacity-choices") {
                const branch = page.getByRole("button", { name: "选择：容量分支1", exact: true });
                // Real keyboard activation in reduced motion; pointer in ordinary mode.
                if (reduced) { await branch.focus(); await branch.press("Enter"); }
                else await branch.click();
                await page.waitForFunction(() => document.querySelector(".story-player")?.dataset.currentSceneId === "nvl_after"
                  && document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
                const afterChoice = await observe(page);
                check(c, "Real branch click advances and clears the prior accumulated scene",
                  afterChoice.lines?.length === 1 && afterChoice.text?.includes("NVL_AFTER：")
                  && !afterChoice.text?.includes("NVL_CAP_"));
              }
              check(c, "No unhandled frontend errors", c.errors.length === 0, c.errors);
            });
            c.status = c.checks.every(t => t.status === "PASS") ? "PASS" : "FAILED";
          } catch (error) { c.status = "FAILED"; c.error = String(error.stack || error); }
          finally { await context.close(); save(); }
          console.log(JSON.stringify({ key: c.key, status: c.status,
            failed: c.checks.filter(t => t.status !== "PASS").map(t => t.name), error: c.error?.split("\n")[0] }));
        }
  }
  assert.equal(report.cases.length, smoke ? 4 : 48);
  report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => { report.status = "TOOL_FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await server?.stop();
  let responds = false;
  if (server) try { responds = (await fetch(server.url, { signal: AbortSignal.timeout(1200) })).ok; } catch {}
  report.cleanup = { serviceResponds: responds, status: responds ? "FAILED" : "PASS" };
  if (responds) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out }));
});
