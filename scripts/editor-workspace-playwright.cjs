#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const backendRoot = path.join(root, "backend");
let editorUrl;
let backendHealthUrl;
const acceptancePaths = resolveAcceptancePaths();
const outputDir = acceptancePaths.output;
const fixture = acceptancePaths.input;
const allViewports = [
  { name: "design", width: 1920, height: 1080 },
  { name: "qhd", width: 2560, height: 1440 },
  { name: "uhd", width: 3840, height: 2160 },
];
const requestedViewports = new Set(
  (process.env.AGENTVN_WORKSPACE_VIEWPORTS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const viewports = requestedViewports.size > 0
  ? allViewports.filter((viewport) => requestedViewports.has(viewport.name))
  : allViewports;
assert(viewports.length > 0 && viewports.length === requestedViewports.size || requestedViewports.size === 0,
  "Workspace acceptance accepts only 1080p, 2K and 4K landscape viewports.");

fs.mkdirSync(outputDir, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ready(url) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`editor is not ready: ${url}`);
}

function startEditor() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawn(npm, ["run", "dev", "--", "--host", "127.0.0.1", "--port", new URL(editorUrl).port, "--strictPort"], {
    cwd: editorRoot,
    env: { ...process.env, VITE_BACKEND_URL: new URL(backendHealthUrl).origin },
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: "ignore",
  });
}

function startBackend() {
  return spawn(process.env.PYTHON || "python", ["backend_launcher.py"], {
    cwd: backendRoot,
    env: { ...process.env, AGENTVN_EDITOR_DATA_DIR: path.join(outputDir, "isolated-data"),
      AGENTVN_BACKEND_DATA_DIR: path.join(outputDir, "isolated-data"),
      DATABASE_PATH: path.join(outputDir, "isolated-data", "vn_engine.db"),
      AGENTVN_BACKEND_PORT: new URL(backendHealthUrl).port, AGENTVN_LEGACY_DATABASE_PATHS: "" },
    shell: false,
    windowsHide: true,
    stdio: "ignore",
  });
}

function stop(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else child.kill("SIGTERM");
  } catch {}
}

async function openEditor(page) {
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    return !stage || !stage.classList.contains("is-home-hydrating");
  }, undefined, { timeout: 30_000 }).catch(() => {});
  if (await page.locator(".editor-toolbar").isVisible().catch(() => false)) return;
  const input = page.locator(".project-import-button input").first();
  await input.waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
    .some((candidate) => candidate instanceof HTMLInputElement && !candidate.disabled), undefined, { timeout: 60_000 });
  await input.setInputFiles(fixture);
  // Import itself enters the workspace; a second recent-project click races
  // that transition and can hit a hidden stale row.
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"), undefined, { timeout: 30_000 }).catch(() => {});
}

async function inspect(page) {
  return page.evaluate(() => {
    function intersection(left, right) {
      const x = Math.max(left.left, right.left);
      const y = Math.max(left.top, right.top);
      const rightEdge = Math.min(left.right, right.right);
      const bottom = Math.min(left.bottom, right.bottom);
      return {
        left: x,
        top: y,
        right: rightEdge,
        bottom,
        width: Math.max(0, rightEdge - x),
        height: Math.max(0, bottom - y),
      };
    }

    function visibleRect(element) {
      let result = element.getBoundingClientRect().toJSON();
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const clipsX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX);
        const clipsY = ["hidden", "clip", "auto", "scroll"].includes(style.overflowY);
        if (!clipsX && !clipsY) continue;
        const clipRect = ancestor.getBoundingClientRect();
        result = intersection(result, {
          left: clipsX ? clipRect.left : result.left,
          top: clipsY ? clipRect.top : result.top,
          right: clipsX ? clipRect.right : result.right,
          bottom: clipsY ? clipRect.bottom : result.bottom,
        });
      }
      return result;
    }

    const shell = document.querySelector(".editor-workspace-shell");
    const body = document.querySelector(".editor-workspace-body");
    const status = document.querySelector('[data-testid="workspace-status-bar"]');
    const drawer = document.querySelector('[data-testid="workspace-drawer"], .toolbar-popover:not(.toolbar-popover-morph-ghost)');
    const content = drawer?.querySelector(".workspace-drawer-content, .advanced-tab-viewport, .toolbar-popover-content");
    const toolbarContainers = [...document.querySelectorAll(".editor-workspace-toolbar .toolbar-tool-container")];
    const toolbarFrame = document.querySelector(".editor-workspace-toolbar");
    const toolbar = document.querySelector(".editor-workspace-toolbar > .editor-toolbar");
    const toolbarInner = toolbar?.querySelector(".toolbar-inner");
    const toolbarButtons = toolbarInner ? [...toolbarInner.querySelectorAll("button")] : [];
    const surfaceNav = document.querySelector('[data-testid="workspace-surface-nav"]');
    const surfaceNavButtons = surfaceNav ? [...surfaceNav.querySelectorAll("button[data-workspace-surface]")] : [];
    const palette = document.querySelector(".node-palette");
    const flow = document.querySelector(".flow-surface");
    const inspector = document.querySelector(".scene-editor-pane");
    const paletteButtons = [...document.querySelectorAll(".node-palette button")];
    const drawerRect = drawer?.getBoundingClientRect();
    const toolbarRect = toolbarFrame?.getBoundingClientRect();
    const toolbarInnerRect = toolbarInner?.getBoundingClientRect();
    const paletteRect = palette?.getBoundingClientRect();
    return {
      shell: shell?.getBoundingClientRect().toJSON(),
      body: body?.getBoundingClientRect().toJSON(),
      status: Boolean(status),
      drawer: drawerRect?.toJSON(),
      drawerScrollable: Boolean(content && content.scrollHeight > content.clientHeight),
      surfaceNav: surfaceNav?.getBoundingClientRect().toJSON(),
      surfaceNavButtons: surfaceNavButtons.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          surface: element.getAttribute("data-workspace-surface"),
          rect: rect.toJSON(),
          active: element.getAttribute("aria-current") === "page",
          inBounds: Boolean(surfaceNav)
            && rect.left >= surfaceNav.getBoundingClientRect().left - 1
            && rect.right <= surfaceNav.getBoundingClientRect().right + 1
            && rect.top >= surfaceNav.getBoundingClientRect().top - 1
            && rect.bottom <= surfaceNav.getBoundingClientRect().bottom + 1,
        };
      }),
      toolbarHeight: document.querySelector(".editor-workspace-toolbar")?.getBoundingClientRect().height ?? 0,
      windowWidth: window.innerWidth,
      compactMedia: window.matchMedia("(max-width: 900px)").matches,
      toolbarInnerDisplay: toolbarInner ? getComputedStyle(toolbarInner).display : "",
      toolbarClientWidth: toolbarInner?.clientWidth ?? 0,
      toolbarScrollWidth: toolbarInner?.scrollWidth ?? 0,
      toolbarRect: toolbarRect?.toJSON(),
      toolbarInnerRect: toolbarInnerRect?.toJSON(),
      toolbarButtonsInBounds: toolbarRect
        ? toolbarButtons
          .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const visible = visibleRect(element);
            const style = getComputedStyle(element);
            return {
              className: element.className,
              rect: rect.toJSON(),
              visible,
              outerHTML: rect.bottom > toolbarRect.bottom + 1 || rect.right > toolbarRect.right + 1
                ? element.outerHTML
                : undefined,
              ancestors: rect.bottom > toolbarRect.bottom + 1 || rect.right > toolbarRect.right + 1
                ? [element.parentElement, element.parentElement?.parentElement, element.parentElement?.parentElement?.parentElement]
                  .filter((ancestor) => ancestor instanceof HTMLElement)
                  .map((ancestor) => ({
                    tag: ancestor.tagName,
                    className: ancestor.className,
                    rect: ancestor.getBoundingClientRect().toJSON(),
                  }))
                : undefined,
              computed: rect.bottom > toolbarRect.bottom + 1 || rect.right > toolbarRect.right + 1
                ? {
                  position: style.position,
                  display: style.display,
                  alignSelf: style.alignSelf,
                  transform: style.transform,
                  margin: style.margin,
                  minHeight: style.minHeight,
                  height: style.height,
                  overflow: style.overflow,
                }
                : undefined,
              inBounds: rect.left >= toolbarRect.left - 1
                && rect.right <= toolbarRect.right + 1
                && rect.top >= toolbarRect.top - 1
                && rect.bottom <= toolbarRect.bottom + 1,
              visibleInBounds: visible.width > 0
                && visible.height > 0
                && visible.left >= toolbarRect.left - 1
                && visible.right <= toolbarRect.right + 1
                && visible.top >= toolbarRect.top - 1
                && visible.bottom <= toolbarRect.bottom + 1,
            };
          })
        : [],
      paletteRect: paletteRect?.toJSON(),
      paletteScrollable: Boolean(palette && palette.scrollWidth > palette.clientWidth),
      flowRect: flow?.getBoundingClientRect().toJSON(),
      inspectorRect: inspector?.getBoundingClientRect().toJSON(),
      workspaceOverlap: body && flow && inspector && palette
        ? (() => {
          const rects = [palette, flow, inspector].map((element) => element.getBoundingClientRect());
          const overlaps = [];
          for (let left = 0; left < rects.length; left += 1) {
            for (let right = left + 1; right < rects.length; right += 1) {
              const intersectionRect = intersection(rects[left], rects[right]);
              if (intersectionRect.width > 1 && intersectionRect.height > 1) {
                overlaps.push([left, right, intersectionRect]);
              }
            }
          }
          return overlaps;
        })()
        : [],
      workspaceGeometry: body && flow && inspector && palette
        ? {
          bodyArea: body.getBoundingClientRect().width * body.getBoundingClientRect().height,
          flowArea: flow.getBoundingClientRect().width * flow.getBoundingClientRect().height,
          flowWidthRatio: flow.getBoundingClientRect().width / Math.max(body.getBoundingClientRect().width, 1),
          inspectorWidth: inspector.getBoundingClientRect().width,
          paletteWidth: palette.getBoundingClientRect().width,
        }
        : undefined,
      paletteButtons: paletteRect
        ? paletteButtons.map((element) => {
          const rect = element.getBoundingClientRect();
          const visible = visibleRect(element);
          return {
            label: element.textContent?.trim(),
            rect: rect.toJSON(),
            visible,
            minHeight: parseFloat(getComputedStyle(element).minHeight),
            inBounds: rect.left >= paletteRect.left - 1
              && rect.right <= paletteRect.right + 1
              && rect.top >= paletteRect.top - 1
              && rect.bottom <= paletteRect.bottom + 1,
            visibleInBounds: visible.width > 0
              && visible.height > 0
              && visible.left >= paletteRect.left - 1
              && visible.right <= paletteRect.right + 1
              && visible.top >= paletteRect.top - 1
              && visible.bottom <= paletteRect.bottom + 1,
          };
        })
        : [],
      toolbarLayout: [...document.querySelectorAll(".editor-workspace-toolbar .toolbar-inner > *")].map((element) => ({
        className: element.className,
        rect: element.getBoundingClientRect().toJSON(),
        display: getComputedStyle(element).display,
        gridArea: getComputedStyle(element).gridArea,
        gridColumn: getComputedStyle(element).gridColumn,
        gridRow: getComputedStyle(element).gridRow,
        justifySelf: getComputedStyle(element).justifySelf,
      })),
      toolbarRightLayout: [...document.querySelectorAll(".editor-workspace-toolbar .toolbar-right > *")].map((element) => ({
        className: element.className,
        rect: element.getBoundingClientRect().toJSON(),
        flex: getComputedStyle(element).flex,
        minWidth: getComputedStyle(element).minWidth,
        width: getComputedStyle(element).width,
      })),
      toolbarMaterial: toolbarContainers.every((element) => {
        const style = getComputedStyle(element);
        return style.backdropFilter !== "none" || style.boxShadow !== "none";
      }),
      toolbarButtonsPremium: toolbarButtons
        .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
        .every((element) => {
        const style = getComputedStyle(element);
        return parseFloat(style.minHeight) >= 38
          && style.boxShadow !== "none"
          && (parseFloat(style.borderRadius) <= 10 || element.classList.contains("theme-tone-switch"));
      }),
      toolbarButtonStyles: toolbarButtons.map((element) => {
        const style = getComputedStyle(element);
        return {
          className: element.className,
          boxShadow: style.boxShadow,
          borderRadius: style.borderRadius,
          minHeight: style.minHeight,
          height: style.height,
        };
      }),
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    };
  });
}

function assertRectStable(viewportName, label, before, after) {
  assert.ok(before && after, `${viewportName}: ${label} rectangle missing`);
  for (const key of ["left", "top", "width", "height"]) {
    assert.ok(
      Math.abs(before[key] - after[key]) <= 1,
      `${viewportName}: ${label} geometry changed while opening Options (${key}: ${before[key]} -> ${after[key]})`,
    );
  }
}

async function run() {
  let env;
  let browser;
  let page;
  let shuttingDown = false;
  const report = { ok: true, at: new Date().toISOString(), viewports: [], pageErrors: [] };
  try {
    env = await startEditorAcceptance(outputDir);
    editorUrl = env.url;
    backendHealthUrl = `${env.backendUrl}/api/health`;
    report.owner = { pid: env.server.pid, runId: env.server.runId, backendUrl: env.backendUrl };
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: viewports[0].width, height: viewports[0].height } });
    page = await context.newPage();
    await page.route("http://127.0.0.1:8278/api/project/assets/**", async route => {
      try {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: `${env.backendUrl}${url.pathname}${url.search}` });
        await route.fulfill({ response });
      } catch (error) {
        // A page/browser teardown can dispose the request context while a
        // proxied font or asset request is still in flight. Ignore only that
        // teardown cancellation; failures during an active test stay fatal.
        if (shuttingDown || page?.isClosed() || !browser?.isConnected()) return;
        throw error;
      }
    });
    page.on("pageerror", error => report.pageErrors.push(String(error)));
    await openEditor(page);
    await page.locator('[data-workspace-surface="edit"]').click();
    assert.equal(await page.locator(".scene-editor-pane .preview-panel").count(), 1,
      "node live preview must remain available in the edit workspace");
    assert.equal(await page.locator(".preview-splitter").count(), 1,
      "node live preview vertical resize handle is missing");
    for (const viewport of viewports) {
      await env.server.assertAlive();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(500);
      await page.locator('[data-workspace-surface="edit"]:visible').click();
      await page.locator(".toolbar-popover:not(.toolbar-popover-morph-ghost)").waitFor({ state: "hidden" });
      assert.equal(await page.locator(".editor-workspace-body").evaluate(node =>
        !node.inert && getComputedStyle(node).visibility === "visible"), true,
      `${viewport.name}: returning to edit did not restore graph rendering and input`);
      if (viewport.width > 900) {
        const pane = page.locator(".scene-editor-pane");
        const resizer = page.locator(".panel-resizer");
        const before = await pane.boundingBox();
        const handle = await resizer.boundingBox();
        const dragStart = await page.evaluate(({ x, y }) => {
          window.__panelResizeCleanup?.();
          const element = document.elementFromPoint(x, y);
          const separator = document.querySelector(".panel-resizer");
          const workspace = document.querySelector(".editor-workspace");
          window.__panelResizeTrace = [];
          let tracking = false;
          const removers = [];
          const listen = (target, type, handler, options) => {
            target.addEventListener(type, handler, options);
            removers.push(() => target.removeEventListener(type, handler, options));
          };
          window.__panelResizeCleanup = () => {
            for (const remove of removers.splice(0)) remove();
            window.__panelResizeCleanup = undefined;
          };
          const snapshot = (event) => {
            const rail = document.querySelector(".scene-editor-pane");
            const currentHandle = document.querySelector(".panel-resizer");
            const grid = document.querySelector(".editor-workspace");
            return {
              type: event.type,
              targetIsHandle: event.target === currentHandle || currentHandle?.contains(event.target),
              pointerId: event.pointerId,
              pointerType: event.pointerType,
              clientX: event.clientX,
              buttons: event.buttons,
              hasCapture: currentHandle?.hasPointerCapture(event.pointerId) ?? false,
              inspectorWidth: grid?.style.getPropertyValue("--inspector-width") ?? "",
              gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : "",
              railWidth: rail?.getBoundingClientRect().width ?? null,
              resizingClass: document.body.classList.contains("is-resizing-panel"),
              activeElement: document.activeElement?.tagName ?? "",
              elementAtPointer: document.elementFromPoint(event.clientX, event.clientY)?.className?.toString() ?? "",
            };
          };
          listen(window, "blur", () => window.__panelResizeTrace.push({
            type: "window-blur",
            resizingClass: document.body.classList.contains("is-resizing-panel"),
            inspectorWidth: workspace?.style.getPropertyValue("--inspector-width") ?? "",
          }));
          listen(window, "focus", () => window.__panelResizeTrace.push({
            type: "window-focus",
            resizingClass: document.body.classList.contains("is-resizing-panel"),
            inspectorWidth: workspace?.style.getPropertyValue("--inspector-width") ?? "",
          }));
          if (separator) listen(separator, "lostpointercapture", event => window.__panelResizeTrace.push({
            type: "lostpointercapture",
            pointerId: event.pointerId,
            resizingClass: document.body.classList.contains("is-resizing-panel"),
            inspectorWidth: workspace?.style.getPropertyValue("--inspector-width") ?? "",
          }));
          for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
            listen(document, type, (event) => {
              if (type === "pointerdown") {
                tracking = element === separator || separator?.contains(element);
              }
              if (!tracking) return;
              const record = snapshot(event);
              window.__panelResizeTrace.push(record);
              if (type === "pointermove") {
                requestAnimationFrame(() => {
                  const afterFrame = snapshot(event);
                  afterFrame.sample = "after-frame";
                  window.__panelResizeTrace.push(afterFrame);
                });
              }
              if (type === "pointerup" || type === "pointercancel") tracking = false;
            }, true);
          }
          return {
            point: { x, y },
            targetIsHandle: element === separator || separator?.contains(element),
            targetClass: element?.className?.toString() ?? "",
            handleRect: separator?.getBoundingClientRect().toJSON(),
            workspaceColumns: workspace ? getComputedStyle(workspace).gridTemplateColumns : "",
            inspectorWidth: workspace?.style.getPropertyValue("--inspector-width") ?? "",
          };
        }, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 });
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        if (viewport.name === "desktop") {
          await page.evaluate(() => window.dispatchEvent(new Event("blur")));
          assert.equal(await page.evaluate(() => document.body.classList.contains("is-resizing-panel")), true,
            "desktop: transient window blur must not cancel a pointer-captured inspector resize");
        }
        await page.mouse.move(handle.x - 90, handle.y + handle.height / 2, { steps: 8 });
        await page.mouse.up();
        const after = await pane.boundingBox();
        const dragEnd = await page.evaluate(() => ({
          trace: window.__panelResizeTrace ?? [],
          inspectorWidth: document.querySelector(".editor-workspace")?.style.getPropertyValue("--inspector-width") ?? "",
          gridColumns: document.querySelector(".editor-workspace")
            ? getComputedStyle(document.querySelector(".editor-workspace")).gridTemplateColumns : "",
          rail: document.querySelector(".scene-editor-pane")?.getBoundingClientRect().toJSON(),
        }));
        await page.evaluate(() => window.__panelResizeCleanup?.());
        report.previewRailDrag = {
          viewport: viewport.name,
          before,
          handle,
          after,
          start: dragStart,
          end: dragEnd,
        };
        assert.ok(after.width > before.width + 60, `${viewport.name}: preview rail ignored width drag`);
        const splitter = page.locator(".preview-splitter");
        const previewBefore = await page.locator(".preview-panel").boundingBox();
        const splitRect = await splitter.boundingBox();
        const resizeDirection = previewBefore.height > after.height / 2 ? -1 : 1;
        await page.mouse.move(splitRect.x + splitRect.width / 2, splitRect.y + 5);
        await page.mouse.down();
        await page.mouse.move(splitRect.x + splitRect.width / 2, splitRect.y + resizeDirection * 70, { steps: 8 });
        await page.mouse.up();
        const previewAfter = await page.locator(".preview-panel").boundingBox();
        assert.ok(Math.abs(previewAfter.height - previewBefore.height) > 20, `${viewport.name}: node preview ignored height drag`);
        assert.equal(await page.locator(".preview-panel iframe").count(), 1);
        // Restore only this test's local preference for the baseline measurements.
        await page.mouse.move(handle.x - 90, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2, { steps: 8 });
        await page.mouse.up();
      }
      const editWorkspaceMetrics = await inspect(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator(".toolbar-popover:not(.toolbar-popover-morph-ghost):visible").waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForFunction(() => {
        const popover = document.querySelector(".toolbar-popover.advanced");
        const panel = popover?.querySelector(".advanced-tools-panel");
        return popover?.classList.contains("is-entered")
          && !popover.classList.contains("is-morphing")
          && panel?.classList.contains("is-tab-idle")
          && [...popover.getAnimations()].every(animation =>
            animation.playState === "finished" || animation.playState === "idle");
      }, undefined, { timeout: 30_000 });
      const optionTabs = ["settings", "layout", "theme", "assets", "library", "animation", "providers", "history"];
      const optionButtons = page.locator('.advanced-tools-panel > nav button[data-help-key]');
      await optionButtons.first().waitFor({ state: "visible", timeout: 30_000 });
      assert.deepEqual(await optionButtons.evaluateAll(buttons => buttons.map(button =>
        button.getAttribute("data-help-key").replace("advanced.tab.", ""))), optionTabs,
      `${viewport.name}: top Options must expose all eight original tools in order`);
      const optionTabGeometry = [];
      for (const tab of optionTabs) {
        const button = page.locator(`[data-help-key="advanced.tab.${tab}"]`);
        if (tab === "providers") {
          await page.evaluate(() => {
            const viewport = document.querySelector(".advanced-tools-panel > nav .glass-selection-viewport");
            const selectedButton = document.querySelector('[data-help-key="advanced.tab.providers"]');
            if (!(viewport instanceof HTMLElement) || !(selectedButton instanceof HTMLElement)) return;
            const sample = () => {
              const rect = selectedButton.getBoundingClientRect();
              window.__e2NavScrollTrace ??= [];
              window.__e2NavScrollTrace.push({
                at: performance.now(),
                scrollLeft: viewport.scrollLeft,
                buttonLeft: rect.left,
                buttonRight: rect.right,
                viewportLeft: viewport.getBoundingClientRect().left,
                viewportRight: viewport.getBoundingClientRect().right,
                scrollBehavior: getComputedStyle(viewport).scrollBehavior,
                focused: document.activeElement?.getAttribute?.("data-help-key") ?? "",
                selected: selectedButton.getAttribute("data-glass-selected"),
              });
            };
            window.__e2NavScrollTrace = [];
            window.__e2NavScrollCleanup = () => viewport.removeEventListener("scroll", sample);
            sample();
            viewport.addEventListener("scroll", sample, { passive: true });
          });
        }
        await button.scrollIntoViewIfNeeded();
        const before = await button.boundingBox();
        await button.click();
        const content = page.locator(`.advanced-tab-content[data-tab="${tab}"][data-advanced-tab-interactive="true"]`);
        await content.waitFor({ state: "visible" });
        await content.locator(".advanced-tab-loading").waitFor({ state: "hidden", timeout: 30_000 });
        await page.waitForFunction(() => document.querySelector(".advanced-tools-panel.is-tab-idle"));
        await page.waitForFunction(() => {
          const popover = document.querySelector(".toolbar-popover.advanced");
          return popover && !popover.classList.contains("is-morphing")
            && !popover.getAnimations().some(animation => animation.playState === "running");
        }, undefined, { timeout: 5000 });
        const geometry = await button.evaluate(element => {
          const box = element.getBoundingClientRect();
          const navElement = element.closest("nav");
          const nav = navElement.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          const clippingAncestors = [];
          for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (["hidden", "clip", "auto", "scroll"].includes(style.overflowX)
              || ["hidden", "clip", "auto", "scroll"].includes(style.overflowY)) {
              clippingAncestors.push({
                tag: ancestor.tagName,
                className: ancestor.className?.toString?.() ?? "",
                rect: ancestor.getBoundingClientRect().toJSON(),
                overflowX: style.overflowX,
                overflowY: style.overflowY,
                scrollLeft: ancestor.scrollLeft,
                scrollTop: ancestor.scrollTop,
                clientWidth: ancestor.clientWidth,
                clientHeight: ancestor.clientHeight,
                scrollWidth: ancestor.scrollWidth,
                scrollHeight: ancestor.scrollHeight,
              });
            }
          }
          const style = getComputedStyle(element);
          const unclipped = clippingAncestors.every(ancestor => (
            (!["hidden", "clip", "auto", "scroll"].includes(ancestor.overflowX)
              || (box.left >= ancestor.rect.left - 1 && box.right <= ancestor.rect.right + 1))
            && (!["hidden", "clip", "auto", "scroll"].includes(ancestor.overflowY)
              || (box.top >= ancestor.rect.top - 1 && box.bottom <= ancestor.rect.bottom + 1))
          ));
          return { width: box.width, height: box.height,
            rect: box.toJSON(),
            navRect: nav.toJSON(),
            navScroll: navElement ? {
              scrollLeft: navElement.scrollLeft,
              scrollTop: navElement.scrollTop,
              clientWidth: navElement.clientWidth,
              clientHeight: navElement.clientHeight,
              scrollWidth: navElement.scrollWidth,
              scrollHeight: navElement.scrollHeight,
            } : undefined,
            clippingAncestors,
            buttonStyle: { display: style.display, visibility: style.visibility, opacity: style.opacity, transform: style.transform },
            hitTarget: hit ? { tag: hit.tagName, className: hit.className?.toString?.() ?? "", text: hit.textContent?.trim().slice(0, 60) } : null,
            scrollTrace: window.__e2NavScrollTrace ?? [],
            unclipped,
            inBounds: box.left >= Math.max(0, nav.left) - 1 && box.right <= Math.min(innerWidth, nav.right) + 1
              && box.top >= 0 && box.bottom <= innerHeight,
            clickable: element.contains(hit),
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        if (tab === "providers") await page.evaluate(() => window.__e2NavScrollCleanup?.());
        assert.ok(geometry.inBounds && geometry.clickable && geometry.unclipped,
          `${viewport.name}/${tab}: selected tool clipped or obstructed ${JSON.stringify(geometry)}`);
        assert.ok(Math.abs(geometry.width - before.width) <= 1 && Math.abs(geometry.height - before.height) <= 1,
          `${viewport.name}/${tab}: selection changed button size ${JSON.stringify({ before, geometry })}`);
        assert.ok(geometry.overflow <= 1, `${viewport.name}/${tab}: horizontal overflow`);
        assert.ok((await content.innerText()).trim().length > 0, `${viewport.name}/${tab}: module did not render`);
        const selectionViewport = geometry.clippingAncestors.find(item => item.className.includes("glass-selection-viewport"));
        optionTabGeometry.push({
          tab,
          rect: geometry.rect,
          navRect: geometry.navRect,
          selectionViewportRect: selectionViewport?.rect,
          selectionViewportScrollLeft: selectionViewport?.scrollLeft,
          inBounds: geometry.inBounds,
          clickable: geometry.clickable,
          unclipped: geometry.unclipped,
          scrollTrace: tab === "providers" ? geometry.scrollTrace : undefined,
        });
      }
      await page.locator('[data-help-key="advanced.tab.settings"]').scrollIntoViewIfNeeded();
      await page.locator('[data-help-key="advanced.tab.settings"]').click();
      await page.waitForFunction(() => document.querySelector(".advanced-tools-panel.is-tab-idle"));
      await page.waitForTimeout(180);
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
      const openMetrics = await inspect(page);
      report.viewports.push({ viewport, editWorkspaceMetrics, openMetrics, optionTabGeometry });
      assert.equal(openMetrics.status, true, `${viewport.name}: status bar missing`);
      assert.equal(openMetrics.surfaceNavButtons.length, 5, `${viewport.name}: primary surface navigation is incomplete`);
      assert.deepEqual(
        openMetrics.surfaceNavButtons.map((item) => item.surface),
        ["edit", "options", "assistant", "preview", "publish"],
        `${viewport.name}: primary surface navigation order changed`,
      );
      assert.equal(await page.locator('[data-workspace-surface="assets"]').count(), 0, `${viewport.name}: legacy 素材一级入口 is still visible`);
      assert.deepEqual(
        await page.locator('[data-testid="workspace-surface-nav"] button').allTextContents(),
        ["编辑", "选项", "AI", "预览", "发布"],
        `${viewport.name}: primary navigation labels changed`,
      );
      await page.locator('[data-testid="workspace-surface-nav"]').evaluate(async nav => {
        await Promise.all(nav.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
      });
      const navMaterial = await page.evaluate(() => {
        const active = document.querySelector('[data-workspace-surface="options"]');
        const inactive = document.querySelector('[data-workspace-surface="edit"]');
        const indicator = document.querySelector('[data-testid="workspace-surface-nav"] .glass-selection-indicator');
        if (!(active instanceof HTMLElement) || !(inactive instanceof HTMLElement)) return undefined;
        const activeStyle = getComputedStyle(active);
        const inactiveStyle = getComputedStyle(inactive);
        return {
          activeColor: activeStyle.color,
          inactiveColor: inactiveStyle.color,
          activeBackground: activeStyle.backgroundImage,
          inactiveBackground: inactiveStyle.backgroundImage,
          activeShadow: activeStyle.boxShadow,
          inactiveShadow: inactiveStyle.boxShadow,
          activeOpacity: activeStyle.opacity,
          inactiveOpacity: inactiveStyle.opacity,
          indicatorVisible: indicator?.getAttribute("data-glass-visible"),
          indicatorMoving: indicator?.getAttribute("data-glass-moving"),
        };
      });
      assert.ok(navMaterial, `${viewport.name}: navigation material state missing`);
      assert.notEqual(navMaterial.activeColor, navMaterial.inactiveColor, `${viewport.name}: active navigation text lacks contrast`);
      assert.notEqual(navMaterial.activeShadow, navMaterial.inactiveShadow, `${viewport.name}: active navigation shadow is indistinct`);
      assert.ok(Number(navMaterial.activeOpacity) > Number(navMaterial.inactiveOpacity), `${viewport.name}: inactive navigation is not visually weakened`);
      assert.equal(navMaterial.indicatorVisible, "true", `${viewport.name}: liquid glass selection indicator is hidden`);
      await page.waitForTimeout(500);
      assert.notEqual(
        await page.locator('[data-testid="workspace-surface-nav"] .glass-selection-indicator').getAttribute("data-glass-moving"),
        "true",
        `${viewport.name}: navigation selection animation did not settle`,
      );
      assert.equal(await page.locator(".preview-panel iframe").count(), 0, `${viewport.name}: preview iframe mounted outside preview task`);
      assert.ok(openMetrics.surfaceNavButtons.every((item) => item.inBounds && item.rect.height >= 43), `${viewport.name}: primary navigation button is clipped or too small`);
      assert.ok(openMetrics.drawer, `${viewport.name}: surface panel missing`);
      assert.ok(openMetrics.overflow <= 1, `${viewport.name}: horizontal overflow ${openMetrics.overflow}`);
      assert.ok(openMetrics.drawer.left >= -1 && openMetrics.drawer.right <= viewport.width + 1, `${viewport.name}: drawer out of bounds`);
      assert.ok(openMetrics.workspaceGeometry, `${viewport.name}: workspace geometry missing`);
      assert.deepEqual(openMetrics.workspaceOverlap, [], `${viewport.name}: workspace panels overlap ${JSON.stringify(openMetrics.workspaceOverlap)}`);
      if (viewport.width > 900) {
        const minCanvasWidth = viewport.width >= 1920 ? 900 : viewport.width >= 1440 ? 600 : 480;
        assert.ok(
          openMetrics.flowRect.width >= minCanvasWidth,
          `${viewport.name}: canvas is narrower than its usable minimum (${openMetrics.flowRect.width}px; expected at least ${minCanvasWidth}px)`,
        );
        assert.ok(openMetrics.workspaceGeometry.inspectorWidth >= 300 && openMetrics.workspaceGeometry.inspectorWidth <= 560, `${viewport.name}: inspector width is unstable`);
        const expectedPaletteWidth = Math.min(360, Math.max(280, viewport.width * 0.15)) * 0.7;
        assert.ok(
          Math.abs(openMetrics.workspaceGeometry.paletteWidth - expectedPaletteWidth) <= 1,
          `${viewport.name}: node palette width does not match the responsive workspace track (${openMetrics.workspaceGeometry.paletteWidth}px; expected ${expectedPaletteWidth}px)`,
        );
      } else if (viewport.width >= 641 && viewport.height <= 480) {
        assert.ok(openMetrics.paletteRect.width >= 112, `${viewport.name}: compact node rail is too narrow`);
        assert.ok(openMetrics.flowRect.width >= 180, `${viewport.name}: compact canvas fell below its grid minimum`);
        assert.ok(
          openMetrics.drawer.left >= openMetrics.paletteRect.right - 1,
          `${viewport.name}: task panel overlaps the persistent node rail`,
        );
      } else {
        assert.ok(openMetrics.workspaceGeometry.flowWidthRatio >= 0.92, `${viewport.name}: narrow layout did not switch to a full-width task page`);
      }
      for (const [label, before, after] of [
        ["node palette", editWorkspaceMetrics.paletteRect, openMetrics.paletteRect],
        ["graph canvas", editWorkspaceMetrics.flowRect, openMetrics.flowRect],
        ["Inspector", editWorkspaceMetrics.inspectorRect, openMetrics.inspectorRect],
      ]) {
        assertRectStable(viewport.name, label, before, after);
      }
      assert.ok(
        openMetrics.toolbarClientWidth === 0
          || openMetrics.toolbarScrollWidth >= openMetrics.toolbarClientWidth,
        `${viewport.name}: toolbar geometry is invalid (${openMetrics.toolbarScrollWidth} < ${openMetrics.toolbarClientWidth})`,
      );
      assert.ok(
        openMetrics.toolbarButtonsInBounds
          .filter((item) => item.visible.width > 0 && item.visible.height > 0)
          .every((item) => item.visibleInBounds),
        `${viewport.name}: toolbar button escapes its container ${JSON.stringify(openMetrics.toolbarButtonsInBounds)}`,
      );
      assert.ok(
        openMetrics.toolbarButtonsInBounds.every((item) => item.rect.height >= 43),
        `${viewport.name}: toolbar button is too small ${JSON.stringify(openMetrics.toolbarButtonsInBounds)}`,
      );
      assert.ok(
        openMetrics.paletteButtons
        .filter((item) => item.visible.width > 0 && item.visible.height > 0)
          .every((item) => item.visibleInBounds && item.rect.height >= 44),
        `${viewport.name}: node palette button is too small or clipped ${JSON.stringify(openMetrics.paletteButtons)}`,
      );
      assert.ok(openMetrics.toolbarHeight >= 72, `${viewport.name}: toolbar is too short (${openMetrics.toolbarHeight}px)`);
      if (viewport.width <= 900) {
        assert.ok(
          openMetrics.toolbarHeight <= 150,
          `${viewport.name}: narrow toolbar is consuming too much vertical space (${openMetrics.toolbarHeight}px)`,
        );
      }
      assert.equal(openMetrics.toolbarMaterial, true, `${viewport.name}: toolbar lost its material surface styling`);
      assert.equal(openMetrics.toolbarButtonsPremium, true, `${viewport.name}: toolbar buttons lost their premium surface styling ${JSON.stringify(openMetrics.toolbarButtonStyles)}`);
      const compactMemory = page.locator('.editor-workspace-toolbar .memory-selector.compact').first();
      assert.equal(await compactMemory.isVisible().catch(() => false), false, `${viewport.name}: memory mode leaked into the project-level topbar`);
      assert.equal(openMetrics.surfaceNavButtons.length, 5, `${viewport.name}: top task navigation must contain exactly five surfaces`);
      assert.ok(
        openMetrics.surfaceNavButtons.every((item) => item.rect.height >= 43 && item.inBounds),
        `${viewport.name}: task navigation button is clipped or too small`,
      );
      assert.ok(openMetrics.toolbarButtonsInBounds.every((item) => item.rect.height >= 43), `${viewport.name}: toolbar button is too small ${JSON.stringify(openMetrics.toolbarButtonsInBounds)}`);
      await page.keyboard.press("Escape");
      await page.locator(".toolbar-popover:not(.toolbar-popover-morph-ghost)").waitFor({ state: "hidden", timeout: 2_000 });
      await page.locator('[data-workspace-surface="assistant"]:visible').click({ force: true });
      await page.locator(".toolbar-popover:not(.toolbar-popover-morph-ghost):visible").waitFor({ state: "visible", timeout: 30_000 });
      const assistantPanel = page.locator(".toolbar-popover:not(.toolbar-popover-morph-ghost):visible .assistant-chat-panel");
      await assistantPanel.waitFor({ state: "visible", timeout: 30_000 });
      await assistantPanel.getByRole("button", { name: "素材生成" }).waitFor({ state: "visible", timeout: 30_000 });
      await assistantPanel.getByRole("button", { name: "模型设置" }).waitFor({ state: "visible", timeout: 30_000 });
      assert.equal(await assistantPanel.getByRole("button", { name: "素材生成" }).count(), 1, `${viewport.name}: AI section lost 素材生成入口`);
      assert.equal(await assistantPanel.getByRole("button", { name: "模型设置" }).count(), 1, `${viewport.name}: AI section lost 模型设置入口`);
      await assistantPanel.getByRole("button", { name: "模型设置" }).click({ force: true });
      await page.locator(".provider-settings-panel:visible").waitFor({ state: "visible", timeout: 30_000 });
      assert.equal(await page.locator(".provider-settings-panel:visible").count(), 1, `${viewport.name}: AI model settings did not open`);
      await page.keyboard.press("Escape");
      await page.locator(".toolbar-popover:not(.toolbar-popover-morph-ghost)").waitFor({ state: "hidden", timeout: 2_000 });
      await page.locator('[data-workspace-surface="options"]:visible').click({ force: true });
      await page.locator('[data-help-key="advanced.tab.settings"]:visible').waitFor({ state: "visible", timeout: 30_000 });
      await page.locator('[data-help-key="advanced.tab.providers"]:visible').scrollIntoViewIfNeeded();
      await page.locator('[data-help-key="advanced.tab.providers"]:visible').click();
      await page.locator(".provider-settings-panel:visible").waitFor({ state: "visible", timeout: 30_000 });
      assert.equal(await page.locator(".provider-settings-panel:visible").count(), 1, `${viewport.name}: options model settings did not open`);
      await page.keyboard.press("Escape");
      await page.locator(".toolbar-popover:not(.toolbar-popover-morph-ghost)").waitFor({ state: "hidden", timeout: 2_000 });
      await page.locator('[data-workspace-surface="preview"]:visible').click();
      await page.locator('[data-workspace-surface="preview"][aria-current="page"]').waitFor({ state: "visible", timeout: 5_000 });
      const previewPanel = page.getByTestId("preview-launch-panel");
      await previewPanel.waitFor({ state: "visible" });
      await page.waitForFunction((panel) => {
        const popover = panel.closest(".toolbar-popover");
        const animations = popover?.getAnimations({ subtree: true }) ?? [];
        return animations.every((animation) => animation.playState === "finished" || animation.playState === "idle");
      }, await previewPanel.elementHandle(), { timeout: 5_000 });
      if (viewport.width >= 1280 && viewport.height >= 900) {
        const compact = await page.locator('.preview-launch-panel').evaluate(panel => {
          const bounds = panel.getBoundingClientRect();
          return { height: bounds.height, actionsBottom: panel.querySelector('.preview-launch-actions').getBoundingClientRect().bottom };
        });
        assert.ok(compact.height <= 740, `${viewport.name}: preview wastes vertical space (${compact.height}px)`);
        assert.ok(compact.actionsBottom <= 880, `${viewport.name}: preview actions are pushed to page bottom (${compact.actionsBottom}px)`);
      }
      assert.equal(await page.locator(".scene-editor-pane .inspector-panel").count(), 1, `${viewport.name}: external preview removed Inspector`);
      assert.equal(await page.locator("iframe").count(), 0, `${viewport.name}: external preview task mounted an embedded runtime`);
      assert.equal(await page.locator(".gamecli-preview-launch-button").count(), 0, `${viewport.name}: oversized preview entry button remains`);
      const previewEdge = await page.locator('.preview-launch-panel').evaluate((panel) => {
        const style = getComputedStyle(panel);
        const heading = panel.querySelector('h3').getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        const task = panel.closest('.toolbar-popover:not(.toolbar-popover-morph-ghost)');
        const header = panel.querySelector('.preview-launch-header');
        const headerStyle = getComputedStyle(header);
        return { innerBorder: parseFloat(style.borderTopWidth), headingInset: heading.left - bounds.left,
          headerPaddingInlineStart: parseFloat(headerStyle.paddingInlineStart),
          background: getComputedStyle(task).backgroundColor };
      });
      assert.equal(previewEdge.innerBorder, 0, `${viewport.name}: preview task has a redundant nested border`);
      const expectedPreviewInset = viewport.width <= 640 ? 12 : 16;
      assert.equal(previewEdge.headerPaddingInlineStart, expectedPreviewInset,
        `${viewport.name}: preview header has incorrect responsive padding: ${JSON.stringify(previewEdge)}`);
      assert.ok(Math.abs(previewEdge.headingInset - expectedPreviewInset) <= 0.25,
        `${viewport.name}: preview heading does not match its safe edge padding: ${JSON.stringify(previewEdge)}`);
      assert.ok(previewEdge.background !== 'rgba(0, 0, 0, 0)' && previewEdge.background !== 'transparent',
        `${viewport.name}: editor content bleeds through preview task background`);
      const previewBodyHeight = await page.locator(".preview-launch-body").evaluate((element) => element.clientHeight);
      assert.ok(previewBodyHeight >= 44, `${viewport.name}: preview summary/log area collapsed to ${previewBodyHeight}px`);
      for (const selector of [".preview-launch-header h3", ".preview-launch-summary", ".gamecli-preview-log header"]) {
        const target = page.locator(selector);
        await target.scrollIntoViewIfNeeded();
        const reachable = await target.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          let top = 0;
          let bottom = innerHeight;
          for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(ancestor).overflowY)) {
              const bounds = ancestor.getBoundingClientRect();
              top = Math.max(top, bounds.top);
              bottom = Math.min(bottom, bounds.bottom);
            }
          }
          return { top: rect.top, bottom: rect.bottom, clipTop: top, clipBottom: bottom };
        });
        assert.ok(reachable.top >= reachable.clipTop - 1 && reachable.bottom <= reachable.clipBottom + 1,
          `${viewport.name}: ${selector} remains clipped after scrolling: ${JSON.stringify(reachable)}`);
      }
      const launch = page.locator('[data-help-key="preview.open"]');
      await launch.click({ trial: true });
      const launchBounds = await launch.boundingBox();
      assert.ok(launchBounds.height >= 44 && launchBounds.height <= 60 && launchBounds.y + launchBounds.height <= viewport.height,
        `${viewport.name}: preview confirmation is clipped or oversized`);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}-preview-actions.png`) });
      await page.locator('.preview-launch-header h3').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}-preview-confirmation.png`) });
      await page.locator('[data-workspace-surface="edit"]:visible').click();
      await page.locator(".toolbar-popover:not(.toolbar-popover-morph-ghost)").waitFor({ state: "hidden" });
      assert.equal(await page.locator(".scene-editor-pane .inspector-panel").count(), 1, `${viewport.name}: Inspector did not return to edit`);
      assert.equal(await page.locator(".preview-panel iframe").count(), 1, `${viewport.name}: node preview did not return to edit`);
      await page.keyboard.press("Escape");
      await page.locator(".toolbar-popover:not(.toolbar-popover-morph-ghost)").waitFor({ state: "hidden", timeout: 2_000 });
      assert.equal(await page.locator(".toolbar-popover:not(.toolbar-popover-morph-ghost):visible").count(), 0, `${viewport.name}: Escape did not close surface panel`);
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`), fullPage: true });
    }
    await context.close();
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    if (page) {
      report.failureNavigation = await page.evaluate(() => ({
        panel: document.querySelector(".advanced-tools-panel")?.className,
        selected: [...document.querySelectorAll("[data-help-key^='advanced.tab.']")]
          .filter(node => node.dataset.glassSelected === "true").map(node => node.dataset.helpKey),
        layers: [...document.querySelectorAll(".advanced-tab-content")].map(node => ({
          tab: node.dataset.tab, className: node.className, hidden: node.hidden,
          inert: node.inert, children: node.querySelector(".advanced-tab-scroll")?.children.length,
          text: node.textContent.slice(0, 160),
        })),
        focused: document.activeElement?.outerHTML.slice(0, 300),
      })).catch(() => ({}));
      report.failureText = await page.locator("body").innerText().catch(() => "");
      await page.screenshot({ path: path.join(outputDir, "failure.png") }).catch(() => {});
    }
  } finally {
    shuttingDown = true;
    if (browser) await browser.close().catch(() => {});
    await env?.stop();
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

void run();
