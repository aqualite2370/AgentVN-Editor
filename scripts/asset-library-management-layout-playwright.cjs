#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const CSS_PATH = path.join(ROOT, "editor", "src", "styles", "layout.css");
const OUT_DIR = path.join(ROOT, "output", "playwright", "asset-library-management-layout");
const REPORT_PATH = path.join(OUT_DIR, "report.json");
const css = fs.readFileSync(CSS_PATH, "utf8");

const viewports = [
  { label: "reported-1000", width: 1000, height: 760 },
  { label: "desktop-1440", width: 1440, height: 900 },
  { label: "narrow-760", width: 760, height: 760 },
];

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

function fixtureHtml() {
  const select = (helpKey, label, ariaLabel, className = "") => `
    <span class="rich-select is-compact ${className}">
      <button
        type="button"
        class="rich-select-trigger is-compact has-value"
        role="combobox"
        aria-label="${ariaLabel}"
        data-help-key="${helpKey}"
      >
        <span class="rich-select-value"><span class="rich-select-value-label">${label}</span></span>
        <span class="rich-select-chevron">⌄</span>
      </button>
    </span>
  `;

  return `
    <style>
      :root {
        --ink: #4f453f;
        --ink-strong: #211b18;
        --muted: #80726b;
        --line: #dfc9bf;
        --accent: #cf5972;
        --danger: #d64b55;
        --success: #2f8a62;
        --warning: #b97a24;
        --surface: #fffaf7;
        --surface-2: #faeee8;
        --field: #fff8f3;
        --stage-bg: #f7eee8;
        --shadow-color: #6f4a3b;
        --radius: 10px;
        --control-shadow: 0 1px 2px rgba(91, 55, 43, 0.12);
        --motion-scale: 0;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-width: 0; background: #f4ece8; font-family: "Segoe UI", sans-serif; }
      body { padding: 24px; }
      button, input { min-width: 0; font: inherit; }
      button {
        min-height: 36px;
        padding: 7px 10px;
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--ink-strong);
        background: var(--field);
      }
      input {
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--ink-strong);
        background: var(--field);
      }
      ${css}
      .advanced-tab-scroll {
        width: calc(100vw - 48px);
        height: calc(100vh - 48px);
        overflow: auto;
      }
      .asset-library-panel { width: 100%; }
      .asset-library-sidebar nav { min-height: 300px; }
      .asset-library-content { min-height: 620px; }
      .asset-library-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .fixture-card { min-height: 180px; }
    </style>
    <div class="advanced-tab-scroll">
      <section class="advanced-card asset-library-panel">
        <div class="asset-library-header">
          <div><h3>素材库</h3><p>自动化布局回归测试</p></div>
          <div class="row-actions">
            <button type="button">新建文件夹</button>
            <button type="button">导入字体</button>
            <button type="button">导入素材</button>
          </div>
        </div>
        <div class="asset-library-workspace">
          <aside class="asset-library-sidebar" aria-label="素材文件夹">
            <div class="asset-library-sidebar-header"><strong>文件夹</strong><span>2 个素材 · 0 个文件夹</span></div>
            <nav></nav>
          </aside>
          <main class="asset-library-content">
            <div class="asset-library-content-toolbar">
              <nav class="asset-library-breadcrumbs"><button type="button" class="is-current">未归档素材</button></nav>
              <span class="asset-library-item-count">2 个素材</span>
            </div>
            <div class="asset-library-managementbar" role="search" aria-label="筛选素材">
              <label class="asset-library-search">
                <span aria-hidden="true">⌕</span>
                <input type="search" aria-label="搜索素材" placeholder="搜索名称、ID、文件名或授权备注" />
              </label>
              ${select("asset.filterType", "全部类型", "按素材类型筛选", "asset-library-type-filter")}
              ${select("asset.filterSource", "全部来源", "按素材来源筛选", "asset-library-source-filter")}
              ${select("asset.sort", "最近加入", "素材排序方式", "asset-library-sort")}
              <button type="button" class="asset-library-reset-filters" aria-label="重置素材筛选">↺</button>
            </div>
            <div class="asset-library-grid-tools">
              <div class="asset-library-selection-tools">
                <button type="button">取消全选</button>
                <button type="button">反选</button>
              </div>
              <span>已选 2 个；当前显示 2 个</span>
            </div>
            <div class="asset-library-batchbar" role="region" aria-label="批量整理素材">
              <div class="asset-library-batch-summary">
                <strong>已选择 2 个素材</strong>
                <small>批量操作只作用于已选项目</small>
              </div>
              <div class="asset-library-batch-group">
                ${select("asset.batch.changeType", "背景图", "批量素材类型")}
                <button type="button">应用类型</button>
              </div>
              <div class="asset-library-batch-divider" aria-hidden="true"></div>
              <div class="asset-library-batch-group">
                ${select("asset.batch.target", "未归档素材", "批量目标文件夹")}
                <button type="button">移动</button>
                <button type="button">复制分类</button>
              </div>
              <button type="button" class="is-danger">删除</button>
              <button type="button" class="asset-library-clear-selection" aria-label="取消选择素材">×</button>
            </div>
            <div class="asset-library-grid">
              <article class="asset-library-card fixture-card"></article>
              <article class="asset-library-card fixture-card"></article>
            </div>
          </main>
        </div>
      </section>
    </div>
  `;
}

async function auditSurface(page, selector) {
  return page.locator(selector).evaluate((surface, surfaceSelector) => {
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity || "1") > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const surfaceRect = rectOf(surface);
    const children = Array.from(surface.children).filter(visible);
    const childRects = children.map((element) => ({
      node: element.className || element.tagName.toLowerCase(),
      rect: rectOf(element),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    const outside = childRects.filter(({ rect }) => (
      rect.left < surfaceRect.left - 1
      || rect.right > surfaceRect.right + 1
      || rect.top < surfaceRect.top - 1
      || rect.bottom > surfaceRect.bottom + 1
    ));
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < childRects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < childRects.length; rightIndex += 1) {
        const left = childRects[leftIndex];
        const right = childRects[rightIndex];
        const overlapWidth = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left);
        const overlapHeight = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top);
        if (overlapWidth > 1 && overlapHeight > 1) {
          overlaps.push({ left: left.node, right: right.node, overlapWidth, overlapHeight });
        }
      }
    }
    return {
      selector: surfaceSelector,
      rect: surfaceRect,
      scrollWidth: surface.scrollWidth,
      clientWidth: surface.clientWidth,
      horizontalOverflow: surface.scrollWidth > surface.clientWidth + 1,
      outside,
      overlaps,
      childRects,
    };
  }, selector);
}

async function auditPopover(page, triggerSelector) {
  return page.locator(triggerSelector).evaluate((trigger) => {
    const triggerRect = trigger.getBoundingClientRect();
    const viewportGap = 12;
    const gap = 8;
    const width = Math.max(triggerRect.width, 180);
    const belowSpace = window.innerHeight - triggerRect.bottom - viewportGap;
    const aboveSpace = triggerRect.top - viewportGap;
    const placeTop = belowSpace < 220 && aboveSpace > belowSpace;
    const maxHeight = Math.max(156, Math.min(320, (placeTop ? aboveSpace : belowSpace) - gap));
    const left = Math.min(
      Math.max(viewportGap, triggerRect.left),
      Math.max(viewportGap, window.innerWidth - width - viewportGap),
    );
    const top = placeTop ? Math.max(viewportGap, triggerRect.top - gap - maxHeight) : triggerRect.bottom + gap;
    return {
      trigger: {
        left: triggerRect.left,
        top: triggerRect.top,
        right: triggerRect.right,
        bottom: triggerRect.bottom,
      },
      popover: {
        left,
        top,
        right: left + width,
        bottom: top + maxHeight,
        width,
        maxHeight,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

async function runViewport(browser, viewport) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(fixtureHtml(), { waitUntil: "domcontentloaded" });
    await page.locator(".asset-library-managementbar").waitFor({ state: "visible" });
    const management = await auditSurface(page, ".asset-library-managementbar");
    const batch = await auditSurface(page, ".asset-library-batchbar");
    const batchGroups = [
      await auditSurface(page, ".asset-library-batchbar > .asset-library-batch-group:nth-child(2)"),
      await auditSurface(page, ".asset-library-batchbar > .asset-library-batch-group:nth-child(4)"),
    ];
    const popovers = [];
    for (const selector of [
      '[data-help-key="asset.sort"]',
      '[data-help-key="asset.batch.changeType"]',
      '[data-help-key="asset.batch.target"]',
    ]) {
      popovers.push({ selector, ...(await auditPopover(page, selector)) });
    }
    const screenshot = path.join(OUT_DIR, `${viewport.label}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });

    assert(!management.horizontalOverflow, `${viewport.label}: management bar must not require horizontal scrolling.`, management);
    assert(management.outside.length === 0, `${viewport.label}: management controls must stay inside the management bar.`, management);
    assert(management.overlaps.length === 0, `${viewport.label}: management controls must not overlap.`, management);
    assert(!batch.horizontalOverflow, `${viewport.label}: batch bar must not require horizontal scrolling.`, batch);
    assert(batch.outside.length === 0, `${viewport.label}: batch sections must stay inside the batch bar.`, batch);
    assert(batch.overlaps.length === 0, `${viewport.label}: batch sections must not overlap.`, batch);
    for (const group of batchGroups.filter(Boolean)) {
      assert(!group.horizontalOverflow, `${viewport.label}: batch action group must not overflow horizontally.`, group);
      assert(group.outside.length === 0, `${viewport.label}: batch controls must remain inside their group.`, group);
      assert(group.overlaps.length === 0, `${viewport.label}: batch controls must not overlap.`, group);
    }
    for (const popover of popovers) {
      assert(popover.trigger.left >= 0 && popover.trigger.right <= viewport.width, `${viewport.label}: select trigger is clipped by the viewport.`, popover);
      assert(popover.popover.left >= 8 && popover.popover.right <= viewport.width - 8, `${viewport.label}: select popover would be clipped horizontally.`, popover);
      assert(popover.popover.top >= 8 && popover.popover.bottom <= viewport.height - 8, `${viewport.label}: select popover would be clipped vertically.`, popover);
    }
    return { viewport, ok: true, management, batch, batchGroups, popovers, screenshot };
  } finally {
    await page.close();
  }
}

(async () => {
  ensureDir(OUT_DIR);
  const browser = await chromium.launch({ headless: true });
  const report = { ok: true, at: new Date().toISOString(), results: [], error: undefined };
  try {
    for (const viewport of viewports) {
      report.results.push(await runViewport(browser, viewport));
    }
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    throw error;
  } finally {
    await browser.close();
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ok: report.ok, reportPath: REPORT_PATH, results: report.results.map((item) => ({ viewport: item.viewport, screenshot: item.screenshot })) }, null, 2));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
