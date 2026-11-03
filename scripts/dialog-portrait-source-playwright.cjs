"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { validatePortrait } = require("./installed-dialog-portrait-oracle.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Dialog-Portrait-Source-20261019-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const out = process.env.AGENTVN_DIALOG_PORTRAIT_OUTPUT;
assert(out && !fs.existsSync(out), "Explicit fresh output directory required");
const placement = process.env.AGENTVN_DIALOG_PORTRAIT_PLACEMENT || "name-left";
assert(["name-left", "legacy-text-left"].includes(placement));
fs.mkdirSync(out, { recursive: true });
const manifest = read(path.join(qa, "manifest.json"));
const report = { status: "RUNNING", at: new Date().toISOString(), layer: "GameCLI Runtime", cases: [],
  scope: "Current source Chromium; exact historical UI exports via controlled public live-preview protocol",
  modelRequests: 0, placement,
  placementScope: placement === "name-left"
    ? "Follow unchanged nameplate on its left, including outside panel; preserve full authored text area"
    : "Superseded body-left design; cannot close the current user requirement",
  packages: [], sources: [
    "GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/styles/player.css",
  ].map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) })) };
const hook = path.join(root, "GameCli_framework/src/components/player/useDialogPortrait.ts");
if (fs.existsSync(hook)) report.sources.push({
  file: "GameCli_framework/src/components/player/useDialogPortrait.ts", sha256: hash(fs.readFileSync(hook)),
});
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
report.testSha256 = hash(fs.readFileSync(__filename));
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let server, browser;
async function initialize(page, payload, instant = false) {
  await page.goto(`${server.url}/?mode=preview`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
  await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init",
    protocolVersion: 2, sessionId: `portrait-${Date.now()}`, revision: 1, requestId: "init",
    runId: "exact-ui-export", screen: "title_menu", ...payload }, "*"), payload);
  await ready(page, "title_menu");
  if (instant) {
    // A real existing user setting, via real UI; no direct store mutation or
    // artificial typing clock, even for the controlled extreme-text fixture.
    await page.getByTestId("open-settings").click(); await ready(page, "settings");
    await page.getByRole("button", { name: "文字", exact: true }).click();
    const speed = page.getByRole("slider", { name: "Text speed", exact: true });
    await speed.focus(); await speed.press("Home");
    // The styled slider deliberately hides the sibling numeric output.
    // Verify the value reached through real keyboard input, not visibility
    // of that hidden implementation label.
    assert.equal(await speed.inputValue(), "0");
    await page.getByTestId("settings-finish").click(); await ready(page, "title_menu");
  }
  await page.getByTestId("start-new-game").click(); await ready(page, "playing");
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
}
async function ready(page, screen) {
  await page.waitForFunction(screen => {
    const root = document.querySelector("[data-runtime-screen-transition]");
    return root?.getAttribute("data-runtime-presented-screen") === screen
      && root.getAttribute("data-runtime-transition-phase") === "idle"
      && !document.querySelector(".game-launch-blackout");
  }, screen, { timeout: 30000 });
}
async function observe(page, scene, bound) {
  return page.evaluate(async ({ scene, bound }) => {
    const dialog = document.querySelector(".dialog-box"), story = document.querySelector(".story-player");
    const images = [];
    for (const image of document.images) {
      const r = image.getBoundingClientRect(), css = getComputedStyle(image);
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const row = { tag: "IMG", visible: image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        insideViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        hit: hit === image || image.contains(hit), inDialog: !!image.closest(".dialog-box"),
        inStory: !!image.closest(".story-player"), portraitRole: /portrait|avatar/.test(image.className),
        width: r.width, height: r.height, rect: r.toJSON(), naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight, objectFit: css.objectFit, pointerEvents: css.pointerEvents,
        zIndex: css.zIndex, hitTarget: hit ? { tag: hit.tagName, className: hit.className,
          pointerEvents: getComputedStyle(hit).pointerEvents, zIndex: getComputedStyle(hit).zIndex } : null,
        src: image.currentSrc || image.src };
      try {
        const bytes = await (await fetch(row.src)).arrayBuffer();
        row.sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map(b => b.toString(16).padStart(2, "0")).join("");
      } catch (error) { row.error = String(error); }
      images.push(row);
    }
    const glyphRects = [];
    for (const element of dialog?.querySelectorAll(".dialog-text,.speaker,.continue-indicator") || []) {
      const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        if (!walk.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walk.currentNode);
        glyphRects.push(...[...range.getClientRects()].map(r => r.toJSON())); range.detach();
      }
    }
    const text = dialog?.querySelector(".dialog-text");
    const state = (await import("/src/store/runtimeStore.ts")).useRuntimeStore.getState().engineState;
    return { boundCommand: bound && story?.dataset.currentSceneId === scene
        && story?.dataset.currentCommandIndex === "0" && state.dialog?.portrait === "qa_portrait",
      enginePortrait: state.dialog?.portrait, scene: story?.dataset.currentSceneId,
      command: story?.dataset.currentCommandIndex,
      dialogVisible: !!dialog?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      dialogDone: dialog?.getAttribute("data-dialog-page-done") === "true", text: dialog?.textContent,
      images, glyphRects, dialogRect: dialog?.getBoundingClientRect().toJSON(),
      speakerRect: dialog?.querySelector(".speaker")?.getBoundingClientRect().toJSON(),
      textRect: text?.getBoundingClientRect().toJSON(),
      textPadding: text ? { authored: parseFloat(text.style.paddingLeft) || 0,
        actual: parseFloat(getComputedStyle(text).paddingLeft) || 0,
        reservation: text.style.getPropertyValue("--dialog-portrait-text-inset") } : null,
      textOverflow: text ? { x: text.scrollWidth - text.clientWidth, y: text.scrollHeight - text.clientHeight } : null,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
  }, { scene, bound });
}
function check(c, name, ok, detail) { c.checks.push({ name, status: ok ? "PASS" : "FAILED", detail }); }
(async () => {
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "vite.log") });
  report.service = { pid: server.pid, runId: server.runId, url: server.url };
  browser = await chromium.launch({ headless: false });
  const smoke = process.env.AGENTVN_DIALOG_PORTRAIT_SMOKE === "1";
  const extendedOnly = process.env.AGENTVN_DIALOG_PORTRAIT_EXTENDED_ONLY === "1";
  for (const p of manifest.packages) {
    const bytes = fs.readFileSync(p.path); assert.equal(hash(bytes), p.sha256);
    const zip = await JSZip.loadAsync(bytes);
    const json = async name => JSON.parse(await zip.file(name).async("string"));
    const gameManifest = await json("manifest.json"), script = await json("script.json");
    const skin = await json(gameManifest.ui_skin?.path || "ui/layout.json");
    const portrait = gameManifest.assets.find(a => a.asset_id === "qa_portrait");
    assert(portrait);
    const portraitBytes = await zip.file(portrait.path).async("nodebuffer");
    const expectedHash = "6ee60904616cc7d555748f43fd6439969fb5e2ae466a04193e9f9c89d066fb59";
    assert.equal(hash(portraitBytes), expectedHash);
    const scene = script.scenes.find(s => s.scene_id === script.entry_scene_id);
    assert.equal(scene.commands[0].portrait, "qa_portrait"); assert(!scene.commands[1].portrait);
    report.packages.push({ ...p, portraitSha256: expectedHash, scriptSha256: hash(await zip.file("script.json").async("nodebuffer")) });
    const assetUrls = { qa_portrait: `data:${portrait.mime_type};base64,${portraitBytes.toString("base64")}` };
    const payload = { manifest: gameManifest, script, uiSkin: skin, assetUrls };
    for (const [width, height] of extendedOnly ? [] : smoke ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of smoke ? [1] : [1, 2]) for (const reduced of smoke ? [false] : [false, true]) {
        const c = { key: `${p.layout}-${width}-${dpr}-${reduced}`, layout: p.layout, width, height, dpr, reduced,
          checks: [], errors: [], status: "RUNNING" }; report.cases.push(c); save();
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
          reducedMotion: reduced ? "reduce" : "no-preference" });
        const page = await context.newPage(); page.setDefaultTimeout(20000);
        page.on("pageerror", error => c.errors.push(String(error)));
        try {
          await server.run(async () => {
            await initialize(page, payload);
            c.bound = await observe(page, scene.scene_id, true);
            check(c, "Exported portrait binding reaches current engine dialogue", c.bound.boundCommand);
            try { validatePortrait(c.bound, expectedHash); check(c, "Dedicated visible portrait consumes exact exported bytes", true); }
            catch (error) { check(c, "Dedicated visible portrait consumes exact exported bytes", false, error.message); }
            const image = c.bound.images.find(i => i.sha256 === expectedHash && i.inDialog && i.visible);
            const r = image?.rect, b = c.bound.dialogRect;
            const noGlyphOverlap = !!r && c.bound.glyphRects.every(t => r.right <= t.left + 1 || r.left >= t.right - 1
              || r.bottom <= t.top + 1 || r.top >= t.bottom - 1);
            if (placement === "name-left") {
              const s = c.bound.speakerRect;
              check(c, "Default portrait sits left of the nameplate on the same header row",
                !!r && !!s && r.right <= s.left + 1 && r.top < s.bottom - 1 && r.bottom > s.top + 1,
                { portrait: r, nameplate: s, panelBoundary: "follow unchanged nameplate, including outside" });
              check(c, "Nameplate portrait never overlaps visible text", noGlyphOverlap);
              check(c, "Portrait does not reserve or shrink the authored body text area",
                !c.bound.textPadding.reservation
                && Math.abs(c.bound.textPadding.actual - c.bound.textPadding.authored) <= .1);
            } else {
              check(c, "Legacy portrait is inside left of dialog and never overlaps actual glyphs", !!r && !!b
                && r.left >= b.left - 1 && r.top >= b.top - 1 && r.right <= b.right + 1 && r.bottom <= b.bottom + 1
                && r.left < (b.left + b.right) / 2 && noGlyphOverlap);
            }
            check(c, "Portrait preserves image aspect and readable unclipped text", image?.objectFit === "contain"
              && image.naturalWidth === 900 && image.naturalHeight === 600
              && c.bound.textOverflow?.x <= 1 && c.bound.textOverflow?.y <= 1 && !c.bound.horizontalOverflow);
            const before = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
              reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
            const file = path.join(out, `${c.key}.png`), png = await page.screenshot({ path: file });
            const after = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
              reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
            assert.deepEqual(before, { width, height, dpr, reduced }); assert.deepEqual(before, after);
            assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), height * dpr);
            c.screenshot = { path: file, sha256: hash(png), before, after, pixels: [width * dpr, height * dpr] };
            if (image) await page.locator("img[data-dialog-portrait]").click();
            else await page.locator(".dialog-box").click();
            await page.waitForFunction(() => document.querySelector(".story-player")?.dataset.currentCommandIndex === "1"
              && document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
            c.control = await observe(page, scene.scene_id, false);
            check(c, "Next unbound dialogue removes portrait and keeps original text space",
              !c.control.enginePortrait && !c.control.images.some(i => i.inDialog && i.visible)
              && c.control.text.includes("PORTRAIT_CONTROL") && !c.control.horizontalOverflow
              && !c.control.textPadding.reservation
              && Math.abs(c.control.textPadding.actual - c.control.textPadding.authored) <= .1);
            if (placement === "name-left") {
              const unchangedRect = (a, b) => !!a && !!b
                && ["left", "top", "width", "height"].every(key => Math.abs(a[key] - b[key]) <= 1);
              check(c, "Portrait never moves the existing nameplate or text rectangle",
                unchangedRect(c.bound.speakerRect, c.control.speakerRect)
                && unchangedRect(c.bound.textRect, c.control.textRect));
            }
          });
          check(c, "No unhandled page errors", c.errors.length === 0, c.errors);
          c.status = c.checks.every(row => row.status === "PASS") ? "PASS" : "FAILED";
        } catch (error) { c.status = "TOOL_FAILED"; c.error = String(error.stack || error); }
        finally { await context.close(); save(); }
        console.log(JSON.stringify({ key: c.key, status: c.status, failed: c.checks.filter(v => v.status !== "PASS").map(v => v.name),
          error: c.error?.split("\n")[0] }));
      }
    if (extendedOnly) for (const variant of ["invalid-image", "unresolved-image", "authored-padding-path-url", "extreme-pages"]) {
      const c = { key: `${p.layout}-${variant}`, layout: p.layout, variant, status: "RUNNING", checks: [], errors: [],
        scope: "Controlled variant of exact exported fixture; 1080p/DPR1/normal; not a new cartridge export" };
      (report.variants ||= []).push(c);
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      page.on("pageerror", error => c.errors.push(String(error)));
      const sample = structuredClone(payload);
      if (variant === "invalid-image") sample.assetUrls.qa_portrait = "data:image/png;base64,bm90LWltYWdl";
      if (variant === "unresolved-image") sample.assetUrls = {};
      if (variant === "authored-padding-path-url") {
        sample.assetUrls = { [portrait.path]: assetUrls.qa_portrait };
        sample.uiSkin.screens.find(s => s.screen_id === "player").components
          .find(c => c.component_type === "dialog_text").style.padding = 12;
      }
      const fullText = "头像旁的超长对白必须完整分页，不能被遮住或丢失。".repeat(220);
      if (variant === "extreme-pages") sample.script.scenes.find(s => s.scene_id === scene.scene_id).commands[0].text = fullText;
      try {
        await server.run(async () => {
          await initialize(page, sample, true);
          if (variant === "invalid-image") await page.waitForFunction(() => {
            const n = document.querySelector("img[data-dialog-portrait]");
            return n?.complete && n.naturalWidth === 0;
          });
          if (variant === "authored-padding-path-url" || variant === "extreme-pages")
            await page.waitForSelector("img[data-portrait-ready='true']");
          c.observation = await observe(page, scene.scene_id, true);
          if (variant === "invalid-image" || variant === "unresolved-image") {
            check(c, "Missing/broken image keeps bound dialogue visible without a portrait reservation",
              c.observation.boundCommand && c.observation.dialogVisible && c.observation.dialogDone
              && !c.observation.images.some(i => i.inDialog && i.visible)
              && !c.observation.textPadding.reservation
              && Math.abs(c.observation.textPadding.actual - c.observation.textPadding.authored) <= .1
              && !c.observation.horizontalOverflow);
          } else {
            validatePortrait(c.observation, expectedHash);
            const image = c.observation.images.find(i => i.sha256 === expectedHash && i.inDialog && i.visible);
            const s = c.observation.speakerRect;
            check(c, "Exact portrait bytes sit left of the name without changing body padding",
              image && s && image.rect.right <= s.left + 1
              && image.rect.top < s.bottom && image.rect.bottom > s.top
              && !c.observation.textPadding.reservation
              && Math.abs(c.observation.textPadding.actual - c.observation.textPadding.authored) <= .1);
          }
          if (variant === "authored-padding-path-url") check(c, "Explicit authored padding stays intact",
            c.observation.textPadding.authored === 12 && c.observation.textPadding.actual === 12);
          if (variant === "extreme-pages") {
            await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-pages")) > 1);
            c.pages = [];
            for (let index = 1; index <= 60; index++) {
              await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
              const data = await page.locator(".dialog-box").evaluate(n => {
                const t = n.querySelector(".dialog-text");
                return { index: Number(n.dataset.dialogPage), count: Number(n.dataset.dialogPages),
                  font: parseFloat(getComputedStyle(t).fontSize), text: t.textContent,
                  x: t.scrollWidth - t.clientWidth, y: t.scrollHeight - t.clientHeight };
              });
              const o = await observe(page, scene.scene_id, true);
              const r = o.images.find(i => i.sha256 === expectedHash && i.inDialog && i.visible)?.rect;
              assert(r && o.glyphRects.every(t => r.right <= t.left + 1 || r.left >= t.right - 1
                || r.bottom <= t.top + 1 || r.top >= t.bottom - 1), "A paginated line overlaps the portrait");
              assert.equal(data.index, index); assert(data.font >= 12 && data.x <= 1 && data.y <= 1);
              c.pages.push(data);
              if (index === data.count) break;
              await page.locator(".dialog-box").click();
              await page.waitForFunction(previous => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) > previous, index);
            }
            check(c, "Every extreme page is readable, nonoverlapping and reconstructs exact full text",
              c.pages.length > 1 && c.pages.length === c.pages[0].count && c.pages.map(v => v.text).join("") === fullText);
          }
          await page.screenshot({ path: path.join(out, `${c.key}.png`) });
        });
        check(c, "No unhandled page errors", c.errors.length === 0, c.errors);
        c.status = c.checks.every(v => v.status === "PASS") ? "PASS" : "FAILED";
      } catch (error) { c.status = "FAILED"; c.error = String(error.stack || error); }
      finally { await context.close(); save(); }
      console.log(JSON.stringify({ key: c.key, status: c.status, error: c.error?.split("\n")[0] }));
    }
  }
  assert.equal(report.cases.length, extendedOnly ? 0 : smoke ? 2 : 24);
  if (extendedOnly) assert.equal(report.variants.length, 8);
  report.status = (extendedOnly ? report.variants : report.cases).every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => { report.status = "TOOL_FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await server?.stop();
  let responds = false;
  if (server) { try { responds = (await fetch(server.url, { signal: AbortSignal.timeout(1200) })).ok; } catch {} }
  report.cleanup = { serviceResponds: responds, status: responds ? "FAILED" : "PASS" };
  if (responds) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, combinations: report.cases.length, out }));
});
