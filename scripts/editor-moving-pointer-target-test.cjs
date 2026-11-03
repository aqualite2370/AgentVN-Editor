"use strict";
// QA seam regression: hit-test and input must use the same current rectangle.
// This fixture is not installed-product evidence.
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { visiblePointerClick } = require("./editor-selection-mask-motion-playwright.cjs");

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    async function fixture() {
      await page.setContent(`<div class="toolbar-popover advanced">
        <button data-help-key="advanced.tab.settings"
          style="position:absolute;left:100px;top:100px;width:160px;height:44px">设置</button>
        </div>`);
      await page.evaluate(() => {
        window.pointerEvents = [];
        document.addEventListener("click", e => window.pointerEvents.push({
          trusted: e.isTrusted, target: e.target.getAttribute("data-help-key"),
          x: e.clientX, y: e.clientY
        }));
      });
    }
    await fixture();
    // A real DOM move between legacy boundingBox and hit-test. New code must
    // take its coordinates from that hit-test rather than the stale first read.
    let moved = false;
    const movingPage = {
      mouse: page.mouse,
      evaluate: (...args) => page.evaluate(...args),
      locator: selector => {
        const actual = page.locator(selector);
        return {
          boundingBox: () => actual.boundingBox(),
          evaluate: async fn => {
            await actual.evaluate(n => { n.style.left = "600px"; });
            moved = true;
            return actual.evaluate(fn);
          }
        };
      }
    };
    await visiblePointerClick(movingPage, "settings");
    assert(moved, "Fixture must move the real target");
    const clicks = await page.evaluate(() => window.pointerEvents);
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0].target, "advanced.tab.settings", "Stale pointer coordinates missed moving target");
    assert.equal(clicks[0].trusted, true);
    assert.equal(clicks[0].x, 680);
    await fixture();
    await page.locator(".toolbar-popover").evaluate(n => n.classList.add("is-morphing"));
    let inputs = 0;
    const lateMovingPage = {
      locator: selector => page.locator(selector),
      evaluate: (...args) => page.evaluate(...args),
      mouse: { click: async (x, y) => {
        if (++inputs === 1) await page.locator("button").evaluate(n => { n.style.left = "1000px"; });
        return page.mouse.click(x, y);
      } }
    };
    await visiblePointerClick(lateMovingPage, "settings");
    const lateClicks = await page.evaluate(() => window.pointerEvents);
    assert.equal(lateClicks.length, 2, "Moving background miss must be explicit, then retargeted");
    assert.equal(lateClicks[0].target, null);
    assert.equal(lateClicks[1].target, "advanced.tab.settings");
    assert(lateClicks.every(e => e.trusted));
    await fixture();
    await page.locator(".toolbar-popover").evaluate(n => {
      n.classList.add("is-morphing");
      const other = document.createElement("button");
      other.dataset.helpKey = "advanced.tab.library";
      other.style.cssText = "position:absolute;left:600px;top:100px;width:160px;height:44px";
      n.append(other);
    });
    const wrongPage = {
      locator: selector => page.locator(selector), evaluate: (...args) => page.evaluate(...args),
      mouse: { click: () => page.mouse.click(680, 122) }
    };
    await assert.rejects(visiblePointerClick(wrongPage, "settings"), /different button/);
    assert.equal((await page.evaluate(() => window.pointerEvents)).length, 1, "Wrong-button hit must not retry");
    await fixture();
    await page.locator(".toolbar-popover").evaluate(n => n.classList.add("is-morphing"));
    let misses = 0;
    const missedPage = {
      locator: selector => page.locator(selector), evaluate: (...args) => page.evaluate(...args),
      mouse: { click: async (x, y) => {
        await page.locator("button").evaluate(n => {
          n.style.left = n.style.left === "100px" ? "1000px" : "100px";
        });
        misses++; await page.mouse.click(x, y);
      } }
    };
    await assert.rejects(visiblePointerClick(missedPage, "settings"), /four real pointer attempts/);
    assert.equal(misses, 4); assert.equal((await page.evaluate(() => window.pointerEvents)).length, 4);
    await fixture();
    await visiblePointerClick(page, "settings");
    assert.equal((await page.evaluate(() => window.pointerEvents))[0].target, "advanced.tab.settings");
    await fixture();
    await page.locator("button").evaluate(n => {
      const cover = document.createElement("div");
      cover.style.cssText = "position:absolute;inset:0;z-index:20";
      document.body.append(cover);
    });
    await assert.rejects(visiblePointerClick(page, "settings"), /covered/);
    assert.equal((await page.evaluate(() => window.pointerEvents)).length, 0);
    await fixture();
    await page.locator("button").evaluate(n => { n.style.display = "none"; });
    await assert.rejects(visiblePointerClick(page, "settings"), /Missing visible/);
    assert.equal((await page.evaluate(() => window.pointerEvents)).length, 0);
    console.log("PASS: moving/static trusted input, explicit late miss/retarget, wrong-button/4-miss stop, covered/hidden reject");
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
