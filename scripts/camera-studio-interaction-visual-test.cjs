#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "output", "playwright", "camera-studio-interaction-visual");
const variablesCss = fs.readFileSync(path.join(root, "editor", "src", "styles", "variables.css"), "utf8");
const layoutCss = fs.readFileSync(path.join(root, "editor", "src", "styles", "layout.css"), "utf8");

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

async function readHandleStyle(handle) {
  return handle.evaluate((element) => {
    const style = getComputedStyle(element);
    const corner = getComputedStyle(element, "::after");
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      transform: style.transform,
      cornerWidth: corner.width,
      cornerHeight: corner.height,
      cornerTransform: corner.transform,
    };
  });
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.setContent(`
      <style>${variablesCss}\n${layoutCss}</style>
      <main
        class="camera-composition-stage"
        style="width: 800px; height: 450px; --studio-accent: var(--accent-2);"
      >
        <div
          class="camera-frame is-target"
          style="--frame-left: 18%; --frame-top: 14%; --frame-width: 64%; --frame-height: 68%;"
        >
          <button
            type="button"
            class="camera-frame-handle is-north-west"
            aria-label="拖动左上角调整取景框大小"
          ></button>
        </div>
        <svg class="camera-center-line" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line class="camera-center-line-underlay" x1="50" y1="50" x2="72" y2="36"></line>
          <line class="camera-center-line-main" x1="50" y1="50" x2="72" y2="36"></line>
        </svg>
        <div class="camera-center-marker is-current" style="--center-left: 50%; --center-top: 50%;"></div>
        <div class="camera-center-marker is-target" style="--center-left: 72%; --center-top: 36%;"></div>
      </main>
    `);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "white_gray";
    });

    const handle = page.getByRole("button", { name: "拖动左上角调整取景框大小" });
    await handle.hover();
    await page.waitForTimeout(220);
    const hoverStyle = await readHandleStyle(handle);
    await page.screenshot({ path: path.join(outputDir, "handle-hover.png") });

    assert(
      hoverStyle.backgroundImage === "none"
        && hoverStyle.backgroundColor === "rgba(0, 0, 0, 0)",
      "角点的 44 像素交互热区在悬停时必须保持完全透明。",
      hoverStyle,
    );
    assert(
      hoverStyle.borderTopWidth === "0px"
        && hoverStyle.boxShadow === "none"
        && hoverStyle.transform === "none",
      "角点热区不能继承普通按钮的边框、阴影或上浮效果。",
      hoverStyle,
    );

    await handle.focus();
    const focusStyle = await readHandleStyle(handle);
    assert(
      focusStyle.backgroundImage === "none"
        && focusStyle.backgroundColor === "rgba(0, 0, 0, 0)"
        && focusStyle.boxShadow === "none",
      "用键盘聚焦角点时也不能出现白色方框。",
      focusStyle,
    );

    const activeStyle = await handle.evaluate(async (element) => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      const style = getComputedStyle(element);
      const result = {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
        transform: style.transform,
      };
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      return result;
    });
    assert(
      activeStyle.backgroundImage === "none"
        && activeStyle.backgroundColor === "rgba(0, 0, 0, 0)"
        && activeStyle.boxShadow === "none"
        && activeStyle.transform === "none",
      "按住并拖动角点时，透明热区也不能显形。",
      activeStyle,
    );

    const markerStyles = await page.locator(".camera-center-marker").evaluateAll((elements) => (
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          width: style.width,
          height: style.height,
          borderRadius: style.borderRadius,
        };
      })
    ));
    assert(
      markerStyles.every((style) => style.width === style.height && style.borderRadius === "50%"),
      "中心引导端点必须使用固定像素的正圆，不能被宽屏画布拉成椭圆。",
      markerStyles,
    );

    await page.setContent(`
      <style>${variablesCss}\n${layoutCss}</style>
      <section class="camera-studio-dialog" style="width: 960px; height: 540px;">
        <main class="camera-composition-stage" style="width: 920px; height: 500px;">
          <div class="camera-frame is-current" style="--frame-left: 25%; --frame-top: 22%; --frame-width: 50%; --frame-height: 56%;"><span>起点</span></div>
          ${[
            ["is-shot-1 is-emphasized is-selected", "18%", "16%", "64%", "68%", "镜头 1"],
            ["is-shot-2 is-muted", "28%", "20%", "52%", "56%", "镜头 2"],
            ["is-shot-3 is-muted", "34%", "26%", "42%", "46%", "镜头 3"],
            ["is-shot-4 is-muted", "40%", "30%", "34%", "38%", "镜头 4"],
          ].map(([classes, left, top, width, height, label]) => `
            <div class="camera-frame is-target is-sequence-shot ${classes}" style="--frame-left:${left}; --frame-top:${top}; --frame-width:${width}; --frame-height:${height};">
              <span>${label}</span>
            </div>
          `).join("")}
          <svg class="camera-center-line is-sequence" viewBox="0 0 100 100" preserveAspectRatio="none">
            ${[1, 2, 3, 4].map((index) => `
              <g class="camera-sequence-guide is-shot-${index} ${index === 1 ? "is-emphasized" : "is-muted"}">
                <line class="camera-center-line-underlay" x1="${40 + index * 3}" y1="${55 - index * 2}" x2="${47 + index * 4}" y2="${48 - index * 2}"></line>
                <line class="camera-center-line-main" x1="${40 + index * 3}" y1="${55 - index * 2}" x2="${47 + index * 4}" y2="${48 - index * 2}"></line>
              </g>
            `).join("")}
          </svg>
          <section class="camera-shot-manager">
            <header><strong>连续镜头</strong><span>4 / 4</span></header>
            <div class="camera-shot-list">
              ${[1, 2, 3, 4].map((index) => `
                <div class="camera-shot-card is-shot-${index} ${index === 1 ? "is-active" : ""}">
                  <button class="camera-shot-select"><span>镜头 ${index}</span><small>1.40s</small></button>
                </div>
              `).join("")}
              <button class="camera-shot-add" disabled>已达上限</button>
            </div>
          </section>
        </main>
      </section>
    `);
    const sequenceFrames = page.locator(".camera-frame.is-sequence-shot");
    const sequenceStyles = await sequenceFrames.evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      return { borderColor: style.borderColor, opacity: style.opacity };
    }));
    await page.screenshot({ path: path.join(outputDir, "sequence-overview.png") });
    assert(
      new Set(sequenceStyles.map((style) => style.borderColor)).size === 4,
      "四个连续镜头必须使用四种不同的顺序色。",
      sequenceStyles,
    );
    assert(
      sequenceStyles[0].opacity === "1" && sequenceStyles.slice(1).every((style) => style.opacity === "0.25"),
      "选中镜头必须清晰显示，其他镜头必须降到四分之一透明度。",
      sequenceStyles,
    );
    const managerBox = await page.locator(".camera-shot-manager").boundingBox();
    assert(
      Boolean(managerBox && managerBox.x >= 0 && managerBox.y >= 0 && managerBox.x + managerBox.width <= 960),
      "连续镜头管理器必须完整停留在画布左下角。",
      managerBox,
    );
    await page.setViewportSize({ width: 640, height: 420 });
    await page.locator(".camera-studio-dialog").evaluate((element) => {
      element.style.width = "640px";
      element.style.height = "420px";
    });
    await page.locator(".camera-composition-stage").evaluate((element) => {
      element.style.width = "620px";
      element.style.height = "380px";
    });
    const narrowManagerBox = await page.locator(".camera-shot-manager").boundingBox();
    await page.screenshot({ path: path.join(outputDir, "sequence-narrow.png") });
    assert(
      Boolean(narrowManagerBox && narrowManagerBox.x >= 0 && narrowManagerBox.x + narrowManagerBox.width <= 640),
      "窄画布下连续镜头管理器必须保持可见，并通过内部横向滚动容纳卡片。",
      narrowManagerBox,
    );

    console.log("camera studio interaction visual test: PASS");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
