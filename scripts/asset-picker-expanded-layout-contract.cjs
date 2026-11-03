const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "output", "playwright");
const css = fs.readFileSync(path.join(ROOT, "editor", "src", "styles", "layout.css"), "utf8");

const cards = Array.from({ length: 16 }, (_, index) => `
  <article class="asset-picker-card${index === 0 ? " is-selected" : ""}" role="listitem">
    <button type="button" class="asset-picker-card-main">
      <span class="asset-picker-placeholder"></span>
      <span class="asset-picker-card-copy">
        <strong>背景素材 ${index + 1}</strong>
        <small>background / scene-background-${index + 1}.png</small>
      </span>
    </button>
  </article>
`).join("");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  try {
    await page.setContent(`
      <style>
        :root {
          --ink: #2d2522;
          --ink-strong: #1f1917;
          --muted: #756963;
          --line: #d9c8bf;
          --accent: #8d4f43;
          --accent-2: #a66d59;
          --surface: #fffaf7;
          --surface-2: #fbf2ed;
          --field: #fffdfb;
          --stage-bg: #eee5df;
          --shadow-color: #4b2f28;
          --selection-bg: #f1ddd4;
          --radius: 10px;
        }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; font-family: sans-serif; }
        button, input { font: inherit; }
        ${css}
      </style>
      <section class="advanced-tools-panel layout-mode" style="width: 300px;">
        <div class="runtime-layout-inspector">
          <details class="runtime-layout-fieldset" open>
            <summary>设置页背景</summary>
            <div class="asset-picker-field">
              <div class="asset-picker-heading">
                <span class="asset-picker-heading-copy">
                  <span class="asset-picker-label-text">设置页背景图</span>
                  <small class="asset-picker-guidance">推荐 1920×1080 (16:9)</small>
                </span>
                <span class="asset-picker-actions">
                  <button type="button">清空</button>
                  <button type="button">素材库</button>
                </span>
              </div>
              <div class="asset-picker">
                <div class="asset-picker-selected">
                  <span class="asset-picker-selected-copy">
                    <strong>背景_分分委委</strong>
                    <span>分金委素.png / AI-generated visual novel artwork</span>
                  </span>
                </div>
                <div class="asset-picker-type-tabs"><button type="button">背景图</button></div>
                <label class="asset-picker-search"><input value="" placeholder="搜索背景图素材" /></label>
                <div class="asset-picker-list" role="list">${cards}</div>
              </div>
            </div>
          </details>
        </div>
      </section>
    `);

    const metrics = await page.evaluate(() => {
      const list = document.querySelector(".asset-picker-list");
      const items = Array.from(document.querySelectorAll(".asset-picker-card")).map((card) => {
        const main = card.querySelector(".asset-picker-card-main");
        const rect = card.getBoundingClientRect();
        const mainRect = main.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          mainHeight: mainRect.height,
          mainContained: mainRect.top >= rect.top - 1 && mainRect.bottom <= rect.bottom + 1,
        };
      });
      return {
        listClientHeight: list.clientHeight,
        listScrollHeight: list.scrollHeight,
        overflowY: getComputedStyle(list).overflowY,
        items,
      };
    });

    const overlapping = metrics.items.slice(1).filter(
      (item, index) => item.top < metrics.items[index].bottom + 7,
    );
    const collapsed = metrics.items.filter((item) => item.height < 90 || item.mainHeight < 78 || !item.mainContained);
    const listScrollable = metrics.listScrollHeight > metrics.listClientHeight && ["auto", "scroll"].includes(metrics.overflowY);
    const pass = overlapping.length === 0 && collapsed.length === 0 && listScrollable;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.locator(".asset-picker").screenshot({
      path: path.join(OUT_DIR, "asset-picker-expanded-layout.png"),
    });

    console.log(
      `${pass ? "PASS" : "FAIL"} expanded asset picker: ` +
      `${overlapping.length} overlap(s), ${collapsed.length} collapsed card(s), ` +
      `${metrics.listClientHeight}/${metrics.listScrollHeight}px viewport/content`,
    );
    if (!pass) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
