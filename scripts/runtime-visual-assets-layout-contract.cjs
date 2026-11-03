const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "editor", "src", "styles", "layout.css"), "utf8");

const fixture = `
  <section class="runtime-visual-assets-panel package-appearance-setting">
    <header>
      <div>
        <strong>游戏内视觉资源</strong>
        <p>这些资源会写入导出的 manifest.shell，供标题页、设置页和设置入口按钮读取。</p>
      </div>
      <button type="button">清空</button>
    </header>
    <div class="runtime-visual-workbench">
      <div class="runtime-visual-group runtime-visual-group-assets">
        ${["软件包图标", "卡带封面"].map((label, index) => `
          <div class="asset-picker-field is-popover runtime-visual-slot">
            <div class="asset-picker-heading">
              <span class="asset-picker-heading-copy">
                <span class="asset-picker-label-text">${label}</span>
                <small class="asset-picker-guidance">推荐 ${index === 0 ? "1024×1024 (1:1)" : "1200×1600 (3:4)"}</small>
              </span>
              <span class="asset-picker-actions">
                <button type="button">清空</button>
                <button type="button">素材库</button>
              </span>
            </div>
            <div class="asset-picker is-popover-trigger">
              <button type="button" class="asset-picker-selected asset-picker-selected-button">
                <span class="asset-picker-selected-copy">
                    <strong>${index === 1 ? "cover_night_forest" : "尚未选择素材"}</strong>
                  <span>用于按钮、图标、对话框底图、标题页装饰和背景展示。例如一个很长但必须完整显示的素材说明。</span>
                </span>
                <span class="asset-picker-open-label">选择素材</span>
              </button>
            </div>
          </div>
        `).join("")}
      </div>
      <section class="runtime-visual-group runtime-visual-group-home">
        <div class="runtime-visual-group-heading">
          <strong>标题页</strong>
          <span>主菜单背景与标题页暗度。</span>
        </div>
        <div class="runtime-visual-group-grid">
          <div class="runtime-visual-fit-control runtime-visual-slot">
            <span class="runtime-visual-control-label">标题页背景显示模式与完整说明</span>
          </div>
        </div>
      </section>
      <section class="runtime-visual-group runtime-visual-group-settings">
        <div class="runtime-visual-group-heading">
          <strong>设置页</strong>
          <span>设置界面背景、入口图片与显示方式。</span>
        </div>
      </section>
    </div>
  </section>
`;

function columnCount(value) {
  return value.split(" ").filter(Boolean).length;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const results = [];

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
          --shadow-color: #4b2f28;
          --selection-bg: #f1ddd4;
          --radius: 10px;
        }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; font-family: sans-serif; }
        button { font: inherit; }
        ${css}
      </style>
      <main id="fixture">${fixture}</main>
    `);

    for (const width of [900, 300]) {
      await page.locator("#fixture").evaluate((element, nextWidth) => {
        element.style.width = `${nextWidth}px`;
      }, width);

      const metrics = await page.evaluate(() => {
        const nestedSelectors = [
          ".runtime-visual-assets-panel .asset-picker-heading-copy",
          ".runtime-visual-assets-panel .asset-picker-selected-copy",
          ".runtime-visual-assets-panel .runtime-visual-control-label",
        ];
        const nested = nestedSelectors.flatMap((selector) =>
          Array.from(document.querySelectorAll(selector)).map((element) => {
            const style = getComputedStyle(element);
            return {
              selector,
              overflowY: style.overflowY,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
            };
          }),
        );
        const assets = document.querySelector(".runtime-visual-group-assets");
        const workbench = document.querySelector(".runtime-visual-workbench");
        return {
          nested,
          assetColumns: assets ? getComputedStyle(assets).gridTemplateColumns : "",
          workbenchGap: workbench ? Number.parseFloat(getComputedStyle(workbench).gap) : 0,
        };
      });

      const badNested = metrics.nested.filter(
        (item) => ["auto", "scroll"].includes(item.overflowY) || item.scrollHeight > item.clientHeight + 1,
      );
      const columns = columnCount(metrics.assetColumns);
      const expectedColumns = width === 900 ? 2 : 1;
      results.push({
        width,
        pass: badNested.length === 0 && columns === expectedColumns && metrics.workbenchGap >= 16,
        badNested,
        columns,
        expectedColumns,
        workbenchGap: metrics.workbenchGap,
      });
    }
  } finally {
    await browser.close();
  }

  for (const result of results) {
    const marker = result.pass ? "PASS" : "FAIL";
    console.log(
      `${marker} runtime visual assets ${result.width}px: ` +
      `${result.columns}/${result.expectedColumns} columns, ${result.workbenchGap}px gap, ` +
      `${result.badNested.length} nested scroll/clipping region(s)`,
    );
    if (result.badNested.length > 0) console.log(JSON.stringify(result.badNested, null, 2));
  }

  if (results.some((result) => !result.pass)) process.exitCode = 1;
})();
