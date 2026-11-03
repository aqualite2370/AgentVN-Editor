#!/usr/bin/env node
"use strict";

// E2 only: real Options navigation and structured layout workbench presentation.
// No AI requests, user projects, Runtime modifications or installed-final claim.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { root, viewports, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

const paths = resolveAcceptancePaths();
const selected = (process.env.LAYOUT_POLISH_VIEWPORTS || "").split(",").filter(Boolean);
const matrix = selected.length ? viewports.filter(viewport => selected.includes(viewport.name)) : viewports;
const report = {
  runId: crypto.randomUUID(),
  scope: "Editor E2 source Vite; not production, Release or Android acceptance",
  isolation: paths,
  status: "RUNNING",
  cases: [],
  failures: [],
};
const dpr = Number(process.env.LAYOUT_POLISH_DPR || 1);

async function settled(page) {
  await page.waitForFunction(() => {
    const panel = document.querySelector(".advanced-tools-panel");
    return panel?.classList.contains("is-tab-idle")
      && panel.querySelector(".advanced-tab-content.is-active")?.dataset.tab === "layout"
      && !document.querySelector(".toolbar-popover.advanced.is-morphing");
  });
}

async function captureGeometry(page) {
  return page.evaluate(() => {
    const selectors = {
      panel: ".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)",
      toolbar: ".editor-toolbar",
      rail: ".node-palette",
      switch: ".runtime-layout-type-control",
      sidebar: ".renpy-title-editor .runtime-layout-sidebar",
      center: ".renpy-title-editor .runtime-layout-center",
      inspector: ".renpy-title-editor .runtime-layout-inspector",
    };
    const regions = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const node = document.querySelector(selector);
      if (!node) return [name, null];
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return [name, {
        rect: box.toJSON(),
        filter: style.filter,
        visibility: style.visibility,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      }];
    }));
    return { regions, pageOverflow: document.documentElement.scrollWidth - innerWidth };
  });
}

function overlap(a, b) {
  return a && b
    && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
}

async function check(name, viewport, operation) {
  try {
    const evidence = await operation();
    report.cases.push({ name, viewport, dpr, status: "PASS", evidence });
  } catch (error) {
    report.failures.push({ name, viewport, dpr, error: error.stack || String(error) });
    report.cases.push({ name, viewport, dpr, status: "FAILED" });
  }
}

async function captureTypeIndicator(page, target, keyboard = false) {
  // Do not start a second interaction while the previous pseudo-element
  // transition is still running.  A near-final transform value is not the
  // same thing as transitionend: the selected type can already be committed
  // while the compositor is still finishing the indicator handoff.
  await page.evaluate(async () => {
    const root = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
    const group = root?.querySelector(".runtime-layout-type-switch");
    if (!group) return;
    const animations = group.getAnimations?.({ subtree: true }) ?? [];
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
  });
  await page.evaluate(target => {
    const root = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
    const group = root.querySelector(".runtime-layout-type-switch");
    const before = getComputedStyle(group, "::before");
    const offset = value => value === "none" ? 0 : new DOMMatrixReadOnly(value).m41;
    const origin = offset(before.transform);
    const outerWidth = parseFloat(before.width) + (before.boxSizing === "border-box" ? 0
      : parseFloat(before.borderLeftWidth) + parseFloat(before.borderRightWidth));
    const destination = target === "renpy" ? outerWidth + 3 : 0;
    const frames = [];
    const events = [];
    const start = performance.now();
    let transitionStartedAt = null;
    let transitionEndedAt = null;
    const record = event => {
      if (event.target !== group || event.propertyName !== "transform") return;
      const at = performance.now() - start;
      events.push({ type: event.type, at,
        property: event.propertyName, pseudoElement: event.pseudoElement, elapsedTime: event.elapsedTime });
      if (event.type === "transitionrun" && event.pseudoElement === "::before" && transitionStartedAt === null) {
        transitionStartedAt = at;
      }
      if (event.type === "transitionend" && event.pseudoElement === "::before") {
        transitionEndedAt = at;
      }
    };
    for (const name of ["transitionrun", "transitionend", "transitioncancel"]) group.addEventListener(name, record);
    window.__typeIndicatorProbe = { origin, destination, frames, events, status: "sampling",
      declared: { duration: before.transitionDuration, easing: before.transitionTimingFunction },
      transitionStartedAt: null, transitionEndedAt: null };
    let lastSettled = false;
    let settledFrames = 0;
    function sample() {
      const style = getComputedStyle(group, "::before");
      const x = offset(style.transform);
      const selected = group.querySelector('[aria-pressed="true"]')?.getAttribute("data-layout-type-option");
      const busy = document.querySelector(".runtime-layout-designer")?.getAttribute("aria-busy") === "true";
      const at = performance.now() - start;
      const settled = selected === target && Math.abs(x - destination) < 0.01;
      frames.push({ at, x, selected, busy });
      settledFrames = settled ? settledFrames + 1 : 0;
      const transitionComplete = transitionEndedAt !== null && settledFrames >= 2;
      if (transitionComplete || at > 10000) {
        window.__typeIndicatorProbe.status = transitionComplete ? "settled" : "timeout";
        window.__typeIndicatorProbe.transitionStartedAt = transitionStartedAt;
        window.__typeIndicatorProbe.transitionEndedAt = transitionEndedAt;
        for (const name of ["transitionrun", "transitionend", "transitioncancel"]) group.removeEventListener(name, record);
      } else requestAnimationFrame(sample);
      lastSettled = settled;
    }
    requestAnimationFrame(sample);
  }, target);
  const button = page.locator(`.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) [data-layout-type-option="${target}"]`);
  if (keyboard) { await button.focus(); await page.keyboard.press("Enter"); }
  else await button.click();
  await page.waitForFunction(() => window.__typeIndicatorProbe?.status !== "sampling");
  const evidence = await page.evaluate(() => window.__typeIndicatorProbe);
  const first = evidence.frames.findIndex(frame => Math.abs(frame.x - evidence.origin) > 0.01);
  evidence.effectiveVisibleMs = first < 0 || evidence.transitionEndedAt === null
    ? 0
    : evidence.transitionEndedAt - evidence.frames[first].at;
  evidence.intermediateFrames = evidence.frames.filter(frame =>
    Math.abs(frame.x - evidence.origin) > 0.01 && Math.abs(frame.x - evidence.destination) > 0.01).length;
  return evidence;
}

async function main() {
  fs.mkdirSync(paths.output, { recursive: true });
  let env, browser, currentPage;
  try {
    assert(matrix.length > 0, "Empty viewport matrix is not acceptance");
    env = await startEditorAcceptance(paths.output);
    report.owner = { editorPid: env.server.pid, runId: env.server.runId, url: env.url, backendUrl: env.backendUrl };
    report.sourceHashes = Object.fromEntries([
      "editor/src/components/advanced/RuntimeLayoutTypeControls.tsx",
      "editor/src/components/advanced/RenpyTitleEditor.tsx",
      "editor/src/components/advanced/renpy-title-editor.css",
    ].map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
    browser = await chromium.launch({ headless: process.env.LAYOUT_POLISH_HEADFUL !== "1" });
    report.browser = browser.version();
    for (const viewport of matrix) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: dpr,
        reducedMotion: process.env.LAYOUT_POLISH_REDUCED === "1" ? "reduce" : "no-preference",
      });
      currentPage = page;
      page.setDefaultTimeout(20000);
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      await env.server.run(async () => {
        await env.open(page);
        const originalRail = await page.locator(".node-palette").boundingBox();
        await check("node-rail-seventy-percent-and-buttons-fit", viewport, async () => {
          const expected = Math.min(360, Math.max(280, viewport.width * .15)) * .7;
          assert(Math.abs(originalRail.width - expected) <= 1,
            `Node rail must be 70% of the former track: actual ${originalRail.width}, expected ${expected}`);
          const buttons = page.locator(".node-palette button");
          for (const button of await buttons.all()) {
            const geometry = await button.evaluate(node => {
              const box = node.getBoundingClientRect();
              const bounds = node.closest('.node-palette').getBoundingClientRect();
              const label = node.querySelector('span');
              const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return { box: box.toJSON(), bounds: bounds.toJSON(), disabled: node.disabled,
                hit: node.contains(at), labelClipped: label && label.scrollWidth > label.clientWidth + 1 };
            });
            assert(geometry.box.left >= geometry.bounds.left && geometry.box.right <= geometry.bounds.right,
              "Narrower rail must retain entire button");
            assert(!geometry.labelClipped, "Node label must not truncate");
            assert(geometry.disabled || geometry.hit, "Node action must remain clickable");
          }
          return { originalRail, expected };
        });
        await page.locator('[data-workspace-surface="options"]:visible').click();
        const tab = page.locator('[data-help-key="advanced.tab.layout"]:visible');
        await tab.scrollIntoViewIfNeeded();
        await tab.click();
        await settled(page);
        // A morph snapshot may deliberately remain visible after state handoff.
        // Only the real panel owns clicks; never confuse a cloned control with it.
        const workbench = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
        const control = workbench.locator('[data-testid="runtime-layout-type-control"]');
        const typeButton = workbench.locator('[data-layout-type-option="renpy"]');
        await typeButton.scrollIntoViewIfNeeded();
        await check("type-name-and-readable-label", viewport, async () => {
          const text = (await typeButton.innerText()).trim();
          const visible = await typeButton.evaluate(node => {
            const box = node.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(node);
            const content = range.getBoundingClientRect();
            return { box: box.toJSON(), content: content.toJSON() };
          });
          assert.equal(text, "Ren'Py（进阶）", "Use the latest user-approved layout name");
          assert(visible.content.left >= visible.box.left && visible.content.right <= visible.box.right,
            "Full type label must fit inside its button");
          return { text, visible };
        });
        await typeButton.click();
        await page.waitForFunction(() =>
          document.querySelector(".runtime-layout-designer")?.getAttribute("data-layout-type") === "renpy"
          && document.querySelector(".renpy-title-editor")
          && !document.querySelector(".runtime-layout-designer")?.hasAttribute("inert"));
        await check("type-description", viewport, async () => {
          const text = await control.innerText();
          assert(text.includes("Ren'Py（进阶）专用布局编辑"), "Active mode must be explicit");
          assert((await workbench.locator(".renpy-title-editor h4").first().innerText()).includes("Ren'Py（进阶）"));
          return { text };
        });
        await check("workbench-and-top-navigation-do-not-cover-node-rail", viewport, async () => {
          const value = await captureGeometry(page);
          report.cases.push({ name: "geometry-diagnostic", viewport, dpr, evidence: value });
          assert(value.pageOverflow <= 1, "Page must not overflow horizontally");
          const { panel, rail, toolbar } = value.regions;
          assert(rail && panel && toolbar, "Original workbench regions remain mounted");
          assert.equal(rail.visibility, "visible");
          assert.equal(rail.filter, "none", "Node rail stays sharp");
          for (const key of ["x", "y", "width", "height"])
            assert(Math.abs(originalRail[key] - rail.rect[key]) <= 1, `Node rail ${key} changed`);
          assert(!overlap(panel.rect, rail.rect), "Ren'Py workbench must not cover the node rail");
          assert(!overlap(panel.rect, toolbar.rect), "Ren'Py workbench must not cover top navigation");
          for (const key of ["sidebar", "center", "inspector"]) {
            const region = value.regions[key];
            assert(region && region.rect.width > 0, `${key} must remain visible`);
            assert(region.scrollWidth <= region.clientWidth + 2, `${key} has horizontal overflow`);
            assert(region.rect.left >= panel.rect.left - 1 && region.rect.right <= panel.rect.right + 1,
              `${key} exceeds workbench horizontal bounds`);
          }
          return value;
        });
        await check("font-selector-uses-editor-control-and-real-hit", viewport, async () => {
          const sidebar = workbench.locator(".renpy-title-editor .runtime-layout-sidebar");
          const fonts = sidebar.getByRole("combobox", { name: "Ren'Py（进阶）全局界面字体", exact: true });
          assert.equal(await fonts.count(), 1, "Font selector uses the approved mode name");
          assert.equal(await sidebar.locator("select").count(), 0, "Do not expose unthemed browser-native select");
          await fonts.scrollIntoViewIfNeeded();
          report.cases.push({ name: "font-hit-diagnostic", viewport, dpr, evidence: await fonts.evaluate(node => {
            const box = node.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            const ancestors = [];
            for (let parent = node; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              ancestors.push({ class: parent.className, box: parent.getBoundingClientRect().toJSON(),
                scrollTop: parent.scrollTop, overflowY: style.overflowY, contain: style.contain });
            }
            return { box: box.toJSON(), hit: hit?.outerHTML.slice(0, 250), ancestors };
          }) });
          const computed = await fonts.evaluate(node => ({
            className: node.className,
            background: getComputedStyle(node).backgroundColor,
            radius: getComputedStyle(node).borderRadius,
          }));
          assert.match(computed.className, /rich-select/, "Reuse established Editor select component");
          await fonts.click();
          const option = page.getByRole("option", { name: "主题默认 / 系统字体回退", exact: true });
          await option.click();
          assert.equal(await fonts.getAttribute("aria-expanded"), "false");
          await fonts.focus();
          await page.keyboard.press("ArrowDown");
          await option.waitFor({ state: "visible" });
          await page.keyboard.press("Enter");
          assert.equal(await fonts.getAttribute("aria-expanded"), "false");
          return computed;
        });
        await check("button-role-controls-use-theme-and-preserve-editing", viewport, async () => {
          const inspector = workbench.locator('[data-testid="renpy-button-role-editor"]');
          assert.equal(await inspector.locator("select").count(), 0,
            "Role, scope and state selectors must also reuse themed Editor controls");
          const choices = [
            ["按钮角色", "页面导航", "标题操作"],
            ["按钮样式范围", "共享样式", "当前页面覆盖"],
            ["按钮状态", "悬停", "普通"],
          ];
          for (const [name, next, original] of choices) {
            const trigger = inspector.getByRole("combobox", { name, exact: true });
            await trigger.scrollIntoViewIfNeeded();
            await trigger.click();
            await page.getByRole("option", { name: next, exact: true }).click();
            assert((await trigger.innerText()).includes(next));
            await trigger.click();
            await page.getByRole("option", { name: original, exact: true }).click();
          }
          const width = inspector.getByRole("spinbutton", { name: "按钮宽度", exact: true });
          await width.scrollIntoViewIfNeeded();
          const originalWidth = await width.inputValue();
          await width.fill(String(Number(originalWidth) + 8));
          assert.equal(await inspector.getByTestId("renpy-title-button-role-source").innerText(), "覆盖",
            "Themed selectors must retain authoring mutations and inheritance semantics");
          const undo = workbench.locator('[data-help-key="layout.undo"]');
          await undo.scrollIntoViewIfNeeded();
          await undo.click();
          assert.equal(await width.inputValue(), originalWidth, "One real undo restores edited geometry");
          if (viewport.width >= 1920) {
            const sidebar = await workbench.locator(".renpy-title-editor .runtime-layout-sidebar").boundingBox();
            assert(sidebar.width >= 288, "Desktop authoring sidebar needs room for imported-resource actions and page navigation");
          }
          return { choices };
        });
        await check("page-selection-visible-state-and-hit", viewport, async () => {
          const sidebar = workbench.locator(".renpy-title-editor .runtime-layout-sidebar");
          const about = sidebar.getByRole("button", { name: "关于", exact: true });
          await about.scrollIntoViewIfNeeded();
          await about.click();
          await page.waitForFunction(() =>
            document.querySelector(".renpy-title-editor")?.getAttribute("data-editor-page") === "about");
          const state = await about.evaluate(node => {
            const style = getComputedStyle(node);
            const other = [...node.parentElement.querySelectorAll("button")]
              .find(button => button.textContent.trim() === "标题主页");
            return {
              current: node.getAttribute("aria-current"),
              active: { background: style.backgroundImage, color: style.color, border: style.borderColor },
              inactive: other && { background: getComputedStyle(other).backgroundImage,
                color: getComputedStyle(other).color, border: getComputedStyle(other).borderColor },
            };
          });
          assert.equal(state.current, "page");
          assert(state.inactive && JSON.stringify(state.active) !== JSON.stringify(state.inactive),
            "Current page needs a visually distinct themed selected state");
          return state;
        });
        await check("return-switching-restores-per-type-page-and-navigation", viewport, async () => {
          await workbench.locator('[data-help-key="layout.save"]').scrollIntoViewIfNeeded();
          await workbench.locator('[data-help-key="layout.save"]').click();
          await page.waitForFunction(() => document.querySelector('[data-help-key="layout.save"]')?.getAttribute("data-save-state") === "saved");
          await control.scrollIntoViewIfNeeded();
          const before = await control.boundingBox();
          await workbench.locator('[data-layout-type-option="agentvn"]').click();
          await page.waitForFunction(() => document.querySelector(".runtime-layout-designer")?.getAttribute("data-layout-type") === "agentvn");
          await workbench.locator('[data-layout-type-option="renpy"]').click();
          await page.waitForFunction(() => document.querySelector(".renpy-title-editor")?.getAttribute("data-editor-page") === "about");
          await control.scrollIntoViewIfNeeded();
          const after = await control.boundingBox();
          for (const key of ["x", "y", "width", "height"])
            assert(Math.abs(before[key] - after[key]) <= 1, `Type switch ${key} must remain stable`);
          const options = page.locator('[data-workspace-surface="options"]:visible');
          await options.click({ trial: true });
          await page.waitForFunction(() =>
            document.querySelector(".renpy-editor-runtime-viewport")?.getAttribute("data-preview-phase") === "ready",
          undefined, { timeout: 30000 });
          return { before, after };
        });
        await check("type-indicator-pointer-and-keyboard-continuity", viewport, async () => {
          await control.scrollIntoViewIfNeeded();
          const pointer = await captureTypeIndicator(page, "agentvn");
          const keyboard = await captureTypeIndicator(page, "renpy", true);
          report.cases.push({ name: "type-indicator-motion-diagnostic", viewport, dpr, evidence: { pointer, keyboard } });
          for (const [name, evidence] of [["pointer", pointer], ["keyboard", keyboard]]) {
            assert.equal(evidence.status, "settled", `${name} type transition must actually finish`);
            assert(evidence.intermediateFrames >= 3, `${name} must not hard-cut its selected-state indicator`);
            // 2026-10-11 user prefers faster early response. The old 2x visible
            // duration floor is superseded; actual continuous frames and real
            // completion remain required for both pointer and keyboard.
            assert(evidence.effectiveVisibleMs > 0, `${name} must have an observed visual interval`);
            assert(evidence.events.some(event => event.type === "transitionrun"
              && event.pseudoElement === "::before"), `${name} must actually start its indicator transition`);
            assert(evidence.events.some(event => event.type === "transitionend"
              && event.pseudoElement === "::before" && event.elapsedTime > 0),
            `${name} must complete the actual transition`);
            assert(!evidence.events.some(event => event.type === "transitioncancel"),
              `${name} uninterrupted switch must not cancel its visual owner`);
          }
          return { pointerMs: pointer.effectiveVisibleMs, keyboardMs: keyboard.effectiveVisibleMs };
        });
        await check("personal-library-themed-controls-and-sidebar-density", viewport, async () => {
          const details = workbench.locator(".renpy-personal-component-library");
          await details.locator("summary").scrollIntoViewIfNeeded();
          await details.locator("summary").click();
          const library = details.getByTestId("custom-component-library");
          await library.waitFor({ state: "visible" });
          const evidence = await library.evaluate(node => {
            const box = node.getBoundingClientRect();
            const html = node.querySelector('textarea[aria-label="组件 HTML"]').getBoundingClientRect();
            const css = node.querySelector('textarea[aria-label="组件 CSS"]').getBoundingClientRect();
            const file = node.querySelector('input[aria-label="添加组件图片依赖"]');
            const fileBox = file.getBoundingClientRect();
            return { box: box.toJSON(), html: html.toJSON(), css: css.toJSON(),
              file: { width: fileBox.width, height: fileBox.height, opacity: getComputedStyle(file).opacity },
              overflow: node.scrollWidth - node.clientWidth };
          });
          report.cases.push({ name: "personal-library-density-diagnostic", viewport, dpr, evidence });
          assert(evidence.file.width <= 1 || evidence.file.height <= 1 || Number(evidence.file.opacity) === 0,
            "Image upload must use a themed action rather than the native file selector");
          assert(evidence.html.width >= evidence.box.width - 40 && evidence.css.width >= evidence.box.width - 40,
            "Sidebar code editors must use readable full-width rows, not two cramped columns");
          assert(evidence.overflow <= 1, "Expanded library must not overflow the sidebar");
          const upload = library.getByRole("button", { name: "添加图片依赖", exact: true });
          await upload.scrollIntoViewIfNeeded();
          const chooser = page.waitForEvent("filechooser");
          await upload.click();
          await (await chooser).setFiles({ name: "组件验收.png", mimeType: "image/png", buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/4GkAAAAASUVORK5CYII=", "base64") });
          await library.getByText(/已添加 1 个图片依赖/).waitFor();
          await library.getByTestId("component-save").scrollIntoViewIfNeeded();
          await library.getByTestId("component-save").click();
          await library.locator(".custom-component-list li").first().waitFor();
          const savedName = await library.locator(".custom-component-list li > label").first().evaluate(node => ({
            width: node.getBoundingClientRect().width,
            available: node.parentElement.clientWidth - 14,
          }));
          assert(savedName.width >= savedName.available - 1,
            "Saved component name needs its own readable row, not a sliver beside actions");
          for (const control of await library.locator('.custom-component-list button,.custom-component-library-actions button,.custom-component-library-actions label').all()) {
            await control.scrollIntoViewIfNeeded();
            const hit = await control.evaluate(node => {
              const box = node.getBoundingClientRect();
              const bounds = node.closest('.custom-component-library').getBoundingClientRect();
              const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              const style = getComputedStyle(node);
              return { box: box.toJSON(), bounds: bounds.toJSON(), hit: node.contains(at),
                disabled: node.disabled, background: style.backgroundImage };
            });
            assert(hit.box.left >= hit.bounds.left && hit.box.right <= hit.bounds.right,
              "Library action must fit without clipping");
            assert(hit.disabled || hit.hit, "Library action center must remain clickable");
            assert.notEqual(hit.background, "none", "Authoring actions must inherit Editor material");
          }
          await page.screenshot({ path: path.join(paths.output, `${viewport.name}-component-controls.png`) });
          await details.locator("summary").scrollIntoViewIfNeeded();
          await details.locator("summary").click();
          return evidence;
        });
        await page.screenshot({ path: path.join(paths.output, `${viewport.name}-dpr${dpr}.png`) });
        await check("no-browser-errors", viewport, async () => {
          assert.deepEqual(errors, []);
          return errors;
        });
      });
      await page.close();
    }
    report.status = report.failures.length ? "FAILED" : "PASS";
    report.behaviorChecks = report.cases.filter(item => item.status).length;
  } catch (error) {
    report.status = "FAILED";
    report.failures.push({ name: "runner", error: error.stack || String(error) });
    report.failureGeometry = await currentPage?.evaluate(() => [...document.querySelectorAll(
      ".runtime-layout-header,.runtime-layout-type-control,[data-layout-type-option],.toolbar-popover.advanced,.advanced-tab-scroll")]
      .map(node => ({ className: node.className, text: node.textContent.slice(0, 100),
        rect: node.getBoundingClientRect().toJSON(), scrollTop: node.scrollTop, scrollHeight: node.scrollHeight,
        styles: { width: getComputedStyle(node).width, grid: getComputedStyle(node).gridTemplateColumns } }))).catch(() => null);
    await currentPage?.screenshot({ path: path.join(paths.output, "runner-failure.png") }).catch(() => {});
  } finally {
    await browser?.close();
    await env?.stop();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    failures: report.failures.map(item => ({ name: item.name, viewport: item.viewport?.name, error: item.error.split("\n")[0] })),
    output: paths.output }));
  if (report.status !== "PASS") process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
