"use strict";
// Editor E2: actual Options entry, owned fixture/server. No AI or user projects.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { inspectGuiDialogPaint, assertGuiDialogPaint } = require("./lib/gui-dialog-paint.cjs");
const { viewports, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const paths = require.main === module ? resolveAcceptancePaths() : null;
const requested = (process.env.GUI_DIALOG_VIEWPORTS || "1080p,1440p,4k").split(",");
const matrix = viewports.filter(v => requested.includes(v.name));
const dpr = Number(process.env.GUI_DIALOG_DPR || 1);
const reduced = process.env.GUI_DIALOG_REDUCED === "1";
const report = { status: "RUNNING", scope: "Editor E2 GUI import modal, not Runtime or installed Release",
  isolation: paths, dpr, reduced, cases: [], failures: [] };
let activePageForRecovery, frameCaptureIndex = 0;
async function check(name, fn) {
  const item = { name, status: "PASS" };
  try { item.evidence = await fn(); }
  catch (error) {
    item.status = "FAILED"; item.error = error.stack; report.failures.push(name);
    // Preserve this failure, then restore the test's own modal before independent probes.
    // Otherwise an assertion before Escape turns all later clicks into cascading timeouts.
    try {
      if (activePageForRecovery && await activePageForRecovery.getByTestId("renpy-gui-import-dialog").count()) {
        await activePageForRecovery.keyboard.press("Escape");
        await activePageForRecovery.getByTestId("renpy-gui-import-dialog").waitFor({ state: "detached", timeout: 3000 });
        item.recovery = "OWNED_MODAL_CLOSED";
      }
    } catch (recoveryError) { item.recoveryError = String(recoveryError); }
  }
  report.cases.push(item);
  console.log(`${item.status} ${name}`);
}
async function startFrames(page) {
  await page.evaluate(() => {
    window.__guiFrames = [];
    window.__guiSampling = true;
    const sample = () => {
      if (!window.__guiSampling) return;
      const node = document.querySelector('[data-testid="renpy-gui-import-dialog"]');
      const layer = node?.parentElement;
      const style = node && getComputedStyle(node);
      window.__guiFrames.push({ time: performance.now(), present: Boolean(node),
        visibility: document.visibilityState, actualDpr: devicePixelRatio,
        opacity: style && Number(style.opacity), transform: style?.transform,
        rect: node?.getBoundingClientRect().toJSON(), phase: layer?.dataset.phase,
        inert: Boolean(layer?.inert), focusInside: Boolean(node?.contains(document.activeElement)),
        animations: layer ? layer.getAnimations({ subtree: true }).map(a => ({
          state: a.playState, duration: a.effect?.getTiming().duration,
          progress: a.effect?.getComputedTiming().progress })) : [],
        dialogAnimations: node ? node.getAnimations().map(a => ({
          state: a.playState, duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing,
        })) : [] });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}
async function stopFrames(page, present) {
  await page.waitForFunction(present => {
    const frames = window.__guiFrames;
    if (frames.length < 3) return false;
    return frames.slice(-2).every(f => f.present === present && (!present || f.opacity >= .999)
      && f.animations.every(a => a.state !== "running"));
  }, present);
  const frames = await page.evaluate(() => { window.__guiSampling = false; return window.__guiFrames; });
  if (paths?.output) fs.writeFileSync(path.join(paths.output, `raw-frames-${++frameCaptureIndex}.json`),
    JSON.stringify({ present, viewport: page.viewportSize(), frames }, null, 2));
  return frames;
}
function assertMotion(frames, direction) {
  const visible = frames.filter(f => f.present);
  const intermediate = visible.filter(f => f.opacity > .005 && f.opacity < .995);
  assert(intermediate.length >= 2, `${direction} must have continuous intermediate frames, not mount/unmount hard cut`);
  assert(visible.some(f => f.animations.some(a => a.state === "running")), `${direction} must own a real animation`);
  const owners = visible.flatMap(f => f.dialogAnimations).filter(a => a.state === "running");
  assert(owners.some(a => a.duration >= 480), `${direction} must not be truncated to a fast cut`);
  assert(owners.every(a => a.easing === "cubic-bezier(0.23, 1, 0.32, 1)"), "GUI presentation must reuse Editor content easing");
  for (const f of visible) assert(f.rect.left >= -1 && f.rect.top >= -1, "Dialog must not clip during motion");
  if (direction === "exit") assert(visible.filter(f => f.opacity < .99).every(f => f.inert), "Leaving controls must be inert");
  const observable = direction === "exit" ? visible.find(f => f.opacity < .999)
    : visible.find(f => f.opacity > .001);
  return { intermediate: intermediate.length, nominalMs: owners[0]?.duration,
    observedMs: observable ? frames.at(-1).time - observable.time : null,
    first: visible[0], last: visible.at(-1), frames };
}
async function main() {
  let env, browser;
  fs.mkdirSync(paths.output, { recursive: true });
  try {
    assert.equal(matrix.length, requested.length, "No empty/unknown matrix");
    env = await startEditorAcceptance(paths.output);
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    const angle = process.env.GUI_DIALOG_ANGLE ?? (process.platform === "win32" ? "d3d11" : undefined);
    browser = await chromium.launch({ headless: process.env.GUI_DIALOG_HEADFUL !== "1",
      args: angle ? [`--use-angle=${angle}`] : [] });
    report.requestedAngle = angle ?? "browser-default";
    const system = await browser.newBrowserCDPSession();
    const gpu = (await system.send("SystemInfo.getInfo")).gpu;
    report.gpu = { devices: gpu.devices, auxAttributes: gpu.auxAttributes, featureStatus: gpu.featureStatus };
    await system.detach();
    const zip = new JSZip();
    zip.file("gui.rpy", 'define gui.navigation_xpos = 44\ndefine gui.navigation_spacing = 12\n');
    zip.file("gui/button/idle.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Lz4AAAAASUVORK5CYII=", "base64"));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    for (const viewport of matrix) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      activePageForRecovery = page;
      page.setDefaultTimeout(20000);
      const pageErrors = [];
      page.on("pageerror", error => pageErrors.push(String(error)));
      await env.server.run(async () => {
        await env.open(page);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
        await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
          && !document.querySelector(".toolbar-popover.advanced.is-morphing"));
        const editor = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
        await editor.locator('[data-layout-type-option="renpy"]').click();
        const trigger = editor.getByTestId("renpy-gui-import-open");
        const dialog = page.getByTestId("renpy-gui-import-dialog");
        await trigger.waitFor();
        await startFrames(page);
        await trigger.click();
        const entry = await stopFrames(page, true);
        await check(`${viewport.name}:entry`, () => assertMotion(entry, "entry"));
        await check(`${viewport.name}:initial-focus`, async () => {
          assert(await dialog.evaluate(n => n.contains(document.activeElement)), "Focus must enter the import dialog on opening");
        });
        await check(`${viewport.name}:focus-fence`, async () => {
          await dialog.getByRole("button", { name: "关闭导入预览", exact: true }).focus();
          await page.keyboard.press("Shift+Tab");
          assert(await dialog.evaluate(n => n.contains(document.activeElement)), "Shift+Tab must stay inside modal");
          for (let i = 0; i < 8; i++) {
            await page.keyboard.press("Tab");
            assert(await dialog.evaluate(n => n.contains(document.activeElement)), "Tab must stay inside modal");
          }
          assert(await editor.evaluate(n => Boolean(n.closest("[inert]"))), "Background workbench must be inert, not just covered");
        });
        await page.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({
          name: "中文模板 GUI.zip", mimeType: "application/zip", buffer });
        await dialog.locator(".renpy-gui-import-summary").waitFor();
        await check(`${viewport.name}:theme-selects`, async () => {
          assert.equal(await dialog.locator("select").count(), 0, "GUI mapping must use themed selectors, not native browser selects");
          const purpose = dialog.getByRole("combobox", { name: "gui/button/idle.png 游戏界面用途", exact: true });
          await purpose.click();
          const popup = page.getByRole("listbox", { name: "gui/button/idle.png 游戏界面用途", exact: true });
          await popup.getByRole("option", { name: "标题页主视觉", exact: true }).click();
          assert.match(await purpose.innerText(), /标题页主视觉/);
          await purpose.click();
          await page.keyboard.press("Escape");
          assert.equal(await popup.count(), 0, "Escape first closes the topmost selector");
          assert.equal(await dialog.count(), 1, "Escape from a selector must not dismiss the import dialog");
        });
        await check(`${viewport.name}:geometry`, async () => {
          const value = await dialog.evaluate(n => {
            const box = n.getBoundingClientRect(), body = n.querySelector(".renpy-gui-import-body");
            return { box: box.toJSON(), overflow: n.scrollWidth - n.clientWidth,
              documentOverflow: document.documentElement.scrollWidth - innerWidth,
              body: body.getBoundingClientRect().toJSON(), footer: n.querySelector("footer").getBoundingClientRect().toJSON(),
              buttons: [...n.querySelectorAll("footer button")].map(b => {
                const r = b.getBoundingClientRect();
                return { box: r.toJSON(), disabled: b.disabled, hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
              }) };
          });
          assert(value.box.right <= viewport.width + 1 && value.box.bottom <= viewport.height + 1 && value.box.left >= 0 && value.box.top >= 0);
          assert(value.overflow <= 1 && value.documentOverflow <= 1, "No horizontal overflow");
          assert(value.body.bottom <= value.footer.top + 1, "Scrollable body must not overlap actions");
          for (const b of value.buttons) assert(b.disabled || b.hit, "Actions must receive actual clicks");
          return value;
        });
        const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
        assert.deepEqual(actual, { width: viewport.width, height: viewport.height, dpr, reduced });
        const importScreenshot = await page.screenshot({ path: path.join(paths.output, `${viewport.name}-import.png`) });
        assert.equal(importScreenshot.readUInt32BE(16), actual.width * actual.dpr);
        assert.equal(importScreenshot.readUInt32BE(20), actual.height * actual.dpr);
        assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches })), actual);
        report.actualParameters ??= []; report.actualParameters.push(actual);
        await check(`${viewport.name}:painted-shell`, async () => {
          const evidence = await inspectGuiDialogPaint(page, dialog, importScreenshot);
          fs.writeFileSync(path.join(paths.output, `${viewport.name}-paint.json`), JSON.stringify(evidence, null, 2));
          assertGuiDialogPaint(evidence);
          return evidence;
        });
        await startFrames(page);
        await dialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click();
        const exit = await stopFrames(page, false);
        await check(`${viewport.name}:exit`, () => assertMotion(exit, "exit"));
        await check(`${viewport.name}:focus-restore`, async () => {
          assert(await trigger.evaluate(n => n === document.activeElement), "Focus must restore to the actual import trigger");
          assert(!(await editor.evaluate(n => Boolean(n.closest("[inert]")))), "Background input must be restored");
        });
        await trigger.click();
        await dialog.waitFor();
        await page.keyboard.press("Escape");
        await check(`${viewport.name}:escape`, async () => {
          await dialog.waitFor({ state: "detached", timeout: 3000 });
          assert.equal(await editor.locator(".renpy-title-editor").count(), 1, "Escape must not close the underlying workbench");
        });
        await check(`${viewport.name}:keyboard-entry`, async () => {
          await trigger.focus();
          await startFrames(page);
          await page.keyboard.press("Enter");
          const frames = await stopFrames(page, true);
          assertMotion(frames, "keyboard entry");
          assert(await dialog.evaluate(n => n.contains(document.activeElement)));
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "detached" });
          return frames;
        });
        await check(`${viewport.name}:reverse`, async () => {
          await trigger.click();
          await page.waitForFunction(() => {
            const node = document.querySelector('[data-testid="renpy-gui-import-dialog"]');
            const opacity = node && Number(getComputedStyle(node).opacity);
            return opacity > .15 && opacity < .85;
          });
          await page.keyboard.press("Escape");
          assert(await trigger.evaluate(n => n === document.activeElement), "Input returns at close request, not after decorative exit");
          await page.waitForFunction(() => document.querySelector('.renpy-gui-import-backdrop[data-phase="closing"]'));
          await page.evaluate(() => {
            const dialog = document.querySelector('[data-testid="renpy-gui-import-dialog"]');
            // Observe the actual trusted trigger click just before React retargets it.
            document.querySelector('[data-testid="renpy-gui-import-open"]').addEventListener("click", () => {
              window.__guiReverseBefore = Number(getComputedStyle(dialog).opacity);
            }, { once: true });
          });
          // pointerdown/up is a real click without waiting for the moving overlay to settle.
          const box = await trigger.boundingBox();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForFunction(() => document.querySelector('.renpy-gui-import-backdrop[data-phase="entering"]'));
          const reversal = await dialog.evaluate(node => ({
            before: window.__guiReverseBefore,
            start: Number(node.getAnimations()[0]?.effect.getKeyframes()[0].opacity),
            layers: document.querySelectorAll('[data-testid="renpy-gui-import-dialog"]').length,
          }));
          assert(Number.isFinite(reversal.start) && Math.abs(reversal.start - reversal.before) <= .1,
            `Reverse must start at live opacity, not endpoint: ${JSON.stringify(reversal)}`);
          assert.equal(reversal.layers, 1, "Reverse must keep a unique presentation/input owner");
          await page.waitForFunction(() => document.querySelector('.renpy-gui-import-backdrop[data-phase="open"]'));
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "detached" });
          return reversal;
        });
        await check(`${viewport.name}:late-file-read`, async () => {
          await trigger.click();
          await dialog.waitFor();
          await page.evaluate(() => {
            const original = File.prototype.arrayBuffer;
            window.__guiOriginalArrayBuffer = original;
            File.prototype.arrayBuffer = function () {
              if (this.name !== "延迟扫描.zip") return original.call(this);
              window.__guiReadPending = true;
              return new Promise(resolve => { window.__guiReleaseRead = async () => {
                window.__guiReadBytes = await original.call(this);
                resolve(window.__guiReadBytes);
              }; });
            };
          });
          try {
            await page.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({
              name: "延迟扫描.zip", mimeType: "application/zip", buffer });
            await page.waitForFunction(() => window.__guiReadPending);
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "detached" });
            await trigger.click();
            await dialog.waitFor();
            await page.evaluate(async () => { await window.__guiReleaseRead(); });
            // Await the archive scanner's actual delivery in the test, not a guessed delay.
            await page.evaluate(async () => {
              const { scanRenpyGuiArchive } = await import("/src/renpy/renpyGuiImport.ts");
              const scan = await scanRenpyGuiArchive(new Uint8Array(window.__guiReadBytes));
              if (!scan.assets.length) throw new Error("Late-response barrier must use the actual valid archive");
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });
            assert.equal(await dialog.locator(".renpy-gui-import-summary").count(), 0,
              "A cancelled file read must not populate a new import session");
            assert.equal(await dialog.getByRole("button", { name: "确认入库，不修改工程", exact: true }).count(), 0,
              "A cancelled scan cannot expose a library commit action in the new session");
            assert.equal(await dialog.getByRole("button", { name: "确认应用到当前工程", exact: true }).count(), 0,
              "A cancelled scan cannot become a project application");
            assert.equal(await dialog.getByTestId("renpy-gui-library").count(), 1);
          } finally {
            await page.evaluate(() => { File.prototype.arrayBuffer = window.__guiOriginalArrayBuffer; });
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "detached" });
          }
        });
        assert.deepEqual(pageErrors, [], "GUI behavior must not hide browser exceptions");
      });
      await page.close();
      activePageForRecovery = undefined;
    }
    assert.equal(report.cases.length, matrix.length * 12, "Missing behavior cases");
    report.status = report.failures.length ? "FAILED" : "PASS";
  } catch (error) { report.status = "FAILED"; report.error = error.stack; }
  finally {
    await browser?.close(); await env?.stop();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failures: report.failures,
      error: report.error, output: paths.output }));
  }
  if (report.status !== "PASS") process.exitCode = 1;
}
module.exports = { startFrames, stopFrames, assertMotion };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
