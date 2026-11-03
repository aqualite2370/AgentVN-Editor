#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const CSS_PATH = path.join(ROOT, "editor", "src", "styles", "layout.css");
const RICH_SELECT_PATH = path.join(ROOT, "editor", "src", "components", "common", "RichSelect.tsx");
const ASSET_PICKER_PATH = path.join(ROOT, "editor", "src", "components", "common", "AssetPicker.tsx");
const OUT_DIR = path.join(ROOT, "output", "playwright", "editor-viewport-boundary");
const REPORT_PATH = path.join(OUT_DIR, "report.json");
const css = fs.readFileSync(CSS_PATH, "utf8");
const richSelectSource = fs.readFileSync(RICH_SELECT_PATH, "utf8");
const assetPickerSource = fs.readFileSync(ASSET_PICKER_PATH, "utf8");

const viewports = [
  { label: "reported-1280x720", width: 1280, height: 720 },
  { label: "wide-1440x1000", width: 1440, height: 1000 },
  { label: "narrow-760x720", width: 760, height: 720 },
];
const deviceScaleFactors = [1, 1.5];

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

function control(label, index) {
  return `
    <label class="fixture-control">
      <span>${label} ${index}</span>
      <input data-help-key="${label}.${index}" value="${label}-${index}" />
    </label>
  `;
}

function fixtureHtml() {
  const settingsControls = Array.from({ length: 26 }, (_, index) => control("settings", index)).join("");
  const providerControls = Array.from({ length: 26 }, (_, index) => control("provider", index)).join("");
  const assets = Array.from({ length: 30 }, (_, index) => `
    <article class="asset-library-card${index === 29 ? " is-last" : ""}" tabindex="0">
      <div class="asset-card-preview is-cover">
        <div class="asset-placeholder"><span>background</span></div>
        <button type="button" data-help-key="asset.menu.${index}">菜单</button>
      </div>
      <div class="asset-card-copy">
        <strong>IMG_${String(index + 1).padStart(2, "0")}</strong>
        <small>scene-background-${index + 1}.jpg</small>
      </div>
    </article>
  `).join("");

  return `
    <style>
      :root {
        --ink: #eaf5ff;
        --ink-strong: #ffffff;
        --muted: #a8b9cf;
        --line: #38506c;
        --divider: #38506c;
        --accent: #28d2e2;
        --accent-2: #78b9ff;
        --danger: #ff6f7d;
        --surface: #19273d;
        --surface-2: #223553;
        --field: #101b2f;
        --popover-bg: #101b2f;
        --panel-bg: #0b1527;
        --stage-bg: #08101d;
        --shadow-color: #000;
        --radius: 10px;
        --control-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
        --motion-scale: 0;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-width: 0; background: var(--stage-bg); color: var(--ink); font-family: "Segoe UI", sans-serif; }
      body { min-height: 100dvh; padding: 0; }
      button, input { min-width: 0; font: inherit; }
      button { min-height: 36px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink-strong); background: var(--field); }
      input { width: 100%; min-height: 36px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink-strong); background: var(--field); }
      ${css}
      .toolbar-popover.advanced {
        position: fixed;
        inset: 16px 12px 12px;
        width: auto;
        max-width: none;
        max-height: none;
        height: auto;
        opacity: 1;
        transform: none;
        padding: 12px;
      }
      .advanced-tools-panel {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        min-width: 0;
        min-height: 0;
        height: 100%;
      }
      .advanced-tools-panel > nav {
        display: flex;
        flex-wrap: nowrap;
        min-width: 0;
        overflow-x: auto;
      }
      .advanced-tab-viewport {
        height: 100%;
        min-width: 0;
        min-height: 0;
      }
      .advanced-tab-content.is-active {
        display: block;
        height: 100%;
      }
      .advanced-tab-viewport.has-managed-height .advanced-tab-content.is-active > .advanced-tab-scroll,
      .advanced-tab-scroll {
        height: 100%;
        overflow: auto;
      }
      .fixture-control {
        display: grid;
        gap: 5px;
        min-width: 0;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 8px;
      }
      .fixture-control span {
        overflow-wrap: anywhere;
      }
      .provider-settings-layout {
        display: grid;
        grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
        min-width: 0;
      }
      .provider-connection-detail,
      .provider-model-list,
      .advanced-grid-2 {
        min-width: 0;
      }
      .provider-model-item {
        min-width: 0;
      }
      .asset-library-panel,
      .project-settings-panel,
      .provider-settings-panel {
        min-width: 0;
        max-width: 100%;
      }
      .asset-library-workspace {
        min-width: 0;
        min-height: 0;
      }
      .asset-library-content {
        min-width: 0;
        min-height: 0;
      }
      .asset-library-grid {
        grid-template-columns: repeat(auto-fill, minmax(184px, 1fr));
      }
      .asset-library-card {
        min-width: 0;
      }
      .asset-card-preview {
        min-height: 120px;
      }
      .asset-card-preview > button {
        position: absolute;
        right: 6px;
        bottom: 6px;
      }
      .fixture-popover-trigger {
        position: absolute;
        left: 12px;
        bottom: 8px;
      }
      .rich-select-popover,
      .asset-picker-popover {
        position: fixed;
        display: block;
        max-width: calc(100vw - 24px);
        max-height: calc(100dvh - 24px);
        overflow: auto;
      }
    </style>
    <div class="toolbar-popover advanced">
      <section class="advanced-tools-panel">
        <nav aria-label="高级工具标签">
          <button type="button">项目设置</button>
          <button type="button">模型/连接</button>
          <button type="button">素材库</button>
        </nav>
        <div class="advanced-tab-viewport has-managed-height">
          <div class="advanced-tab-content is-active">
            <div class="advanced-tab-scroll" data-fixture-tab="settings">
              <section class="advanced-card project-settings-panel">
                <h3>项目设置</h3>
                <div class="form-grid">${settingsControls}</div>
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>
    <div class="fixture-popover-trigger">
      <button type="button">底部下拉触发器</button>
    </div>
  `;
}

async function inspectTab(page, tabSelector, panelSelector) {
  return page.evaluate(({ tabSelector: currentTabSelector, panelSelector: currentPanelSelector }) => {
    const scroll = document.querySelector(currentTabSelector);
    const panel = document.querySelector(currentPanelSelector);
    const viewport = document.querySelector(".advanced-tab-viewport");
    const popover = document.querySelector(".toolbar-popover.advanced");
    if (!(scroll instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(viewport instanceof HTMLElement) || !(popover instanceof HTMLElement)) {
      return { missing: true };
    }

    scroll.scrollTop = scroll.scrollHeight;
    const scrollRect = scroll.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const controls = [...panel.querySelectorAll("button, input, select, textarea, [role=combobox]")].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const bottomControl = controls.reduce((current, element) => {
      const rect = element.getBoundingClientRect();
      return !current || rect.bottom > current.rect.bottom ? { element, rect } : current;
    }, undefined);
    const clipped = controls
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const hasHorizontalOverflow = rect.left < scrollRect.left - 1
          || rect.right > scrollRect.right + 1
        const isBottomControl = bottomControl?.element === element;
        const bottomControlClipped = isBottomControl
          && (rect.top < scrollRect.top - 1 || rect.bottom > scrollRect.bottom + 1);
        return hasHorizontalOverflow || bottomControlClipped;
      })
      .map((element) => ({
        helpKey: element.getAttribute("data-help-key"),
        text: element.textContent?.trim().slice(0, 80),
        rect: element.getBoundingClientRect().toJSON(),
      }));
    const hitPoint = bottomControl
      ? {
          x: Math.min(innerWidth - 1, Math.max(1, bottomControl.rect.left + bottomControl.rect.width / 2)),
          y: Math.min(innerHeight - 1, Math.max(1, Math.min(bottomControl.rect.bottom - 1, scrollRect.bottom - 2))),
        }
      : undefined;
    const hit = hitPoint ? document.elementFromPoint(hitPoint.x, hitPoint.y) : undefined;
    const popoverStyle = getComputedStyle(popover);
    const viewportStyle = getComputedStyle(viewport);
    return {
      missing: false,
      dpr: devicePixelRatio,
      scroll: {
        clientHeight: scroll.clientHeight,
        scrollHeight: scroll.scrollHeight,
        scrollTop: scroll.scrollTop,
        rect: scrollRect.toJSON(),
      },
      panel: {
        clientWidth: panel.clientWidth,
        scrollWidth: panel.scrollWidth,
        rect: panelRect.toJSON(),
      },
      popover: {
        rect: popoverRect.toJSON(),
        overflowX: popoverStyle.overflowX,
        overflowY: popoverStyle.overflowY,
      },
      viewport: {
        overflowX: viewportStyle.overflowX,
        overflowY: viewportStyle.overflowY,
      },
      bottomControl: bottomControl
        ? {
            helpKey: bottomControl.element.getAttribute("data-help-key"),
            rect: bottomControl.rect.toJSON(),
            bottomGap: scrollRect.bottom - bottomControl.rect.bottom,
            hit: hit?.closest?.("button, input, select, textarea, [role=combobox]")?.getAttribute?.("data-help-key") ?? hit?.tagName,
          }
        : undefined,
      clipped,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, { tabSelector, panelSelector });
}

async function runViewport(browser, viewport, deviceScaleFactor) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor,
  });
  try {
    await page.setContent(fixtureHtml(), { waitUntil: "domcontentloaded" });
    const settings = await inspectTab(page, '[data-fixture-tab="settings"]', ".project-settings-panel");

    await page.evaluate(() => {
      const scroll = document.querySelector('[data-fixture-tab="settings"]');
      if (!(scroll instanceof HTMLElement)) throw new Error("settings fixture missing");
      scroll.innerHTML = `
        <section class="advanced-card provider-settings-panel">
          <h3>模型/连接</h3>
          <div class="provider-settings-layout">
            <aside class="provider-connection-list"><button type="button">连接</button></aside>
            <section class="provider-connection-detail">
              <article class="advanced-card">
                <div class="advanced-grid-2">
                  ${Array.from({ length: 30 }, (_, index) => `
                    <label class="fixture-control">
                      模型参数 ${index}
                      <input data-help-key="provider.parameter.${index}" value="value-${index}" />
                    </label>
                  `).join("")}
                </div>
              </article>
            </section>
          </div>
        </section>
      `;
    });
    const providers = await inspectTab(page, '[data-fixture-tab="settings"]', ".provider-settings-panel");

    await page.evaluate((cards) => {
      const scroll = document.querySelector('[data-fixture-tab="settings"]');
      if (!(scroll instanceof HTMLElement)) throw new Error("library fixture missing");
      scroll.innerHTML = `
        <section class="advanced-card asset-library-panel">
          <h3>素材库</h3>
          <div class="asset-library-workspace">
            <aside class="asset-library-sidebar"><nav></nav></aside>
            <main class="asset-library-content">
              <div class="asset-library-grid">${cards}</div>
            </main>
          </div>
        </section>
      `;
    }, assetsPlaceholder());
    const library = await inspectTab(page, '[data-fixture-tab="settings"]', ".asset-library-panel");
    return { viewport, deviceScaleFactor, settings, providers, library };
  } finally {
    await page.close();
  }
}

function assetsPlaceholder() {
  return Array.from({ length: 30 }, (_, index) => `
    <article class="asset-library-card${index === 29 ? " is-last" : ""}" tabindex="0">
      <div class="asset-card-preview is-cover">
        <div class="asset-placeholder"><span>background</span></div>
        <button type="button" data-help-key="asset.menu.${index}">菜单</button>
      </div>
      <div class="asset-card-copy">
        <strong>IMG_${String(index + 1).padStart(2, "0")}</strong>
        <small>scene-background-${index + 1}.jpg</small>
      </div>
    </article>
  `).join("");
}

function runSourceContracts() {
  assert(richSelectSource.includes("readViewportMetrics") && richSelectSource.includes("subscribeToViewportChanges"), "RichSelect must use the shared visual viewport boundary.");
  assert(assetPickerSource.includes("readViewportMetrics") && assetPickerSource.includes("subscribeToViewportChanges"), "AssetPicker must use the shared visual viewport boundary.");
  assert(!/Math\.max\(156,\s*Math\.min\(320,\s*available\s*-\s*gap\)\)/.test(richSelectSource), "RichSelect must not force a max-height larger than available space.");
  assert(!/Math\.max\(220,\s*Math\.min\(520,\s*available\s*-\s*gap\)\)/.test(assetPickerSource), "AssetPicker must not force a max-height larger than available space.");
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = { ok: true, results: [], sourceContracts: undefined };
  try {
    runSourceContracts();
    report.sourceContracts = { ok: true };
    const browser = await chromium.launch({ headless: true });
    try {
      for (const viewport of viewports) {
        for (const deviceScaleFactor of deviceScaleFactors) {
          report.results.push(await runViewport(browser, viewport, deviceScaleFactor));
        }
      }
    } finally {
      await browser.close();
    }
    for (const result of report.results) {
      for (const [name, metrics] of Object.entries({
        settings: result.settings,
        providers: result.providers,
        library: result.library,
      })) {
        assert(!metrics.missing, `${result.viewport.label} dpr ${result.deviceScaleFactor}: ${name} fixture must render.`, metrics);
        assert(metrics.scroll.scrollHeight > metrics.scroll.clientHeight, `${result.viewport.label} dpr ${result.deviceScaleFactor}: ${name} must be scrollable.`, metrics);
        assert(metrics.popover.overflowX !== "visible" && metrics.popover.overflowY !== "visible", `${result.viewport.label} dpr ${result.deviceScaleFactor}: advanced popover must own a bounded overflow region.`, metrics);
        assert(metrics.viewport.overflowX !== "visible" && metrics.viewport.overflowY !== "visible", `${result.viewport.label} dpr ${result.deviceScaleFactor}: advanced tab viewport must own a bounded overflow region.`, metrics);
        assert(metrics.panel.scrollWidth <= metrics.panel.clientWidth + 1, `${result.viewport.label} dpr ${result.deviceScaleFactor}: ${name} has horizontal overflow.`, metrics);
        assert(metrics.pageOverflow <= 1, `${result.viewport.label} dpr ${result.deviceScaleFactor}: page has horizontal overflow.`, metrics);
        assert(metrics.clipped.length === 0, `${result.viewport.label} dpr ${result.deviceScaleFactor}: ${name} has clipped controls.`, metrics);
        assert(metrics.bottomControl && metrics.bottomControl.bottomGap >= 24, `${result.viewport.label} dpr ${result.deviceScaleFactor}: ${name} bottom control has no scroll boundary.`, metrics);
        assert(metrics.bottomControl.hit, `${result.viewport.label} dpr ${result.deviceScaleFactor}: ${name} bottom control is not clickable.`, metrics);
      }
    }
    console.log(JSON.stringify({ ok: true, results: report.results.map((result) => ({ viewport: result.viewport, deviceScaleFactor: result.deviceScaleFactor })) }, null, 2));
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    console.error(report.error.message);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`[report] ${REPORT_PATH}`);
  }
})();
