const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "editor", "src", "styles", "layout.css"), "utf8");

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

assert(
  /--asset-library-bottom-boundary:\s*clamp\(/.test(css),
  "Asset library must define a bounded bottom scroll reserve.",
);
assert(
  /\.advanced-tab-scroll:has\(\.asset-library-panel\)\s*\{[^}]*scroll-padding-block-end:\s*var\(--asset-library-bottom-boundary\)/s.test(css),
  "The active advanced tools scroller must reserve space for the asset library bottom boundary.",
);
assert(
  /\.asset-library-content\s*\{[^}]*padding:\s*12px 12px calc\(12px \+ var\(--asset-library-bottom-boundary\)\)/s.test(css),
  "Asset library content must add bottom padding for the boundary reserve.",
);
assert(
  /@media \(max-width:\s*640px\)[\s\S]*?\.asset-library-content\s*\{[^}]*padding:\s*9px 9px calc\(9px \+ var\(--asset-library-bottom-boundary\)\)/s.test(css),
  "Mobile asset library padding must preserve the bottom boundary reserve.",
);

const cards = Array.from({ length: 30 }, (_, index) => `
  <article class="asset-library-card${index === 29 ? " is-last" : ""}" role="option" tabindex="0">
    <div class="asset-card-preview is-cover">
      <div class="asset-placeholder"><span>background</span></div>
      <label class="asset-card-select"><input type="checkbox" /><span></span></label>
      <span class="asset-card-type-badge">背景图</span>
      <div class="asset-card-menu">
        <button type="button" aria-label="open menu">...</button>
        ${index === 29 ? `
          <div class="asset-card-menu-popover" role="menu">
            <button type="button" role="menuitem">修改类型</button>
            <button type="button" role="menuitem" class="is-danger">删除素材</button>
          </div>
        ` : ""}
      </div>
      <div class="asset-card-hover-info"><span>导入素材</span></div>
    </div>
    <div class="asset-card-copy">
      <strong>IMG_${String(index + 1).padStart(2, "0")}</strong>
      <small>IMG_${String(index + 1).padStart(2, "0")}.jpg</small>
    </div>
  </article>
`).join("");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 980, height: 720 } });
  try {
    await page.setContent(`
      <style>
        :root {
          --ink: #1d2430;
          --ink-strong: #f6fbff;
          --muted: #a9b6c8;
          --line: #32445c;
          --accent: #20c6d4;
          --accent-2: #6db8ff;
          --danger: #ff6a75;
          --surface: #172236;
          --surface-2: #21304a;
          --field: #101a2c;
          --stage-bg: #0c1320;
          --popover-bg: #111b2c;
          --panel-bg: #0d1624;
          --shadow-color: #000;
          --radius: 10px;
          --control-shadow: 0 1px 2px rgba(0, 0, 0, 0.24);
        }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; background: #07101d; font-family: sans-serif; }
        button { font: inherit; }
        ${css}
        .advanced-tab-scroll {
          width: 860px;
          height: 410px;
          overflow: auto;
          border: 1px solid var(--line);
        }
      </style>
      <div class="advanced-tab-scroll">
        <section class="advanced-card asset-library-panel">
          <div class="asset-library-header">
            <div><h3>素材库</h3><p>fixture</p></div>
          </div>
          <div class="asset-library-workspace">
            <aside class="asset-library-sidebar"><nav></nav></aside>
            <main class="asset-library-content">
              <div class="asset-library-content-toolbar">
                <nav class="asset-library-breadcrumbs"><button>未归档素材</button></nav>
                <span class="asset-library-item-count">30 个素材</span>
              </div>
              <div class="asset-library-grid-tools"><button>全选当前素材</button><span>fixture</span></div>
              <div class="asset-library-grid">${cards}</div>
            </main>
          </div>
        </section>
      </div>
    `);

    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector(".advanced-tab-scroll");
      const lastCard = document.querySelector(".asset-library-card.is-last");
      const lastMenu = document.querySelector(".asset-library-card.is-last .asset-card-menu-popover");
      if (!scroller || !lastCard || !lastMenu) return undefined;
      scroller.scrollTop = scroller.scrollHeight;
      const scrollRect = scroller.getBoundingClientRect();
      const cardRect = lastCard.getBoundingClientRect();
      const menuRect = lastMenu.getBoundingClientRect();
      const styles = getComputedStyle(document.querySelector(".asset-library-content"));
      return {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        bottomPadding: Number.parseFloat(styles.paddingBottom),
        cardBottomGap: scrollRect.bottom - cardRect.bottom,
        menuBottomGap: scrollRect.bottom - menuRect.bottom,
      };
    });

    assert(metrics, "Fixture did not render the asset library scroll boundary.");
    assert(metrics.scrollHeight > metrics.clientHeight, "Fixture must be scrollable.", metrics);
    assert(metrics.bottomPadding >= 96, "Asset library content must include a usable bottom boundary.", metrics);
    assert(metrics.cardBottomGap >= 84, "The final asset card must clear the scroll container bottom edge.", metrics);
    assert(metrics.menuBottomGap >= 84, "The final asset card menu must remain inside the scroll boundary.", metrics);
    console.log("Asset library scroll boundary contract passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
