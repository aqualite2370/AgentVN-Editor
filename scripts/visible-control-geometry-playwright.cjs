"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { visibleControlRect, rectOutsideRoot } = require("./visible-control-geometry.cjs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 915, height: 412 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.setContent(`<style>
        body { margin: 0; }
        #menu { position: absolute; left: 20px; top: 20px; width: 270px; height: 280px; }
        #scroll { position: absolute; inset: 0 0 60px; overflow: auto; border: 2px solid; }
        #save { position: absolute; top: 184px; width: 248px; height: 48px; }
        #last { position: absolute; top: 340px; width: 248px; height: 48px; }
        #toggle { position: absolute; right: 0; bottom: 0; width: 50px; height: 50px; }
      </style><div id="menu"><div id="scroll"><button id="save">Save</button><button id="last">Menu</button></div><button id="toggle">Close</button></div>`);
      await page.addScriptTag({ content: `window.visibleControlRect = ${visibleControlRect.toString()};` });
      const measure = () => page.evaluate(() => {
        const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x))
          * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
        const save = document.querySelector("#save");
        const toggle = document.querySelector("#toggle");
        const last = document.querySelector("#last");
        return {
          rawOverlap: overlap(save.getBoundingClientRect(), toggle.getBoundingClientRect()),
          visibleOverlap: overlap(window.visibleControlRect(save), window.visibleControlRect(toggle)),
          hiddenHeight: window.visibleControlRect(last).height,
        };
      });
      const clipped = await measure();
      assert(clipped.rawOverlap > 0, "fixture must reproduce the Android raw-rectangle overlap");
      assert.equal(clipped.visibleOverlap, 0, "clipped-away pixels are not clickable overlap");
      assert.equal(clipped.hiddenHeight, 0, "off-scrollport action must not appear visible");
      await page.evaluate(() => { document.querySelector("#toggle").style.bottom = "80px"; });
      assert((await measure()).visibleOverlap > 0, "genuine control overlap must still fail the geometry check");
      await page.evaluate(() => { document.querySelector("#scroll").scrollTop = 400; });
      assert((await measure()).hiddenHeight > 0, "scrolling must expose the final action");
      const root = { width: viewport.width, height: viewport.height };
      assert(rectOutsideRoot({ x: 20, y: 20, right: viewport.width + 20, bottom: 50 }, root),
        "unreachable horizontal overflow must remain a failure");
      assert(rectOutsideRoot({ x: 20, y: 20, right: 100, bottom: viewport.height + 20 }, root),
        "raw off-frame scroll content cannot pass without a reachability measurement");
      const reachable = await page.locator("#last").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom };
      });
      assert(!rectOutsideRoot(reachable, root), "a scrolled fully reachable control should be inside the viewport");
      await page.close();
    }
    console.log("PASS visible-control geometry: clipped scrollports, real overlap, scroll accessibility, three viewports");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
