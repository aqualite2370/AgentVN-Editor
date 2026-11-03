"use strict";

const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { freezeSettledVisualAnimations, resumeSettledVisualAnimations } =
  require("./advanced-layout-warm-opacity-equivalence-playwright.cjs");

// The screenshot comparison must sample an applied pause, not a pending
// compositor operation. Exercise both an already-running and a new animation.
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.setContent('<div id="sample" style="width:280px;height:88px;background:#cbd"></div>');
    for (const scenario of ["new", "running"]) {
      await page.evaluate(async scenario => {
        document.getAnimations().forEach(animation => animation.cancel());
        const animation = document.getElementById("sample").animate(
          [{ transform: "translateX(0px)", opacity: 0.2 },
            { transform: "translateX(100px)", opacity: 1 }],
          { duration: 4800, iterations: Infinity });
        if (scenario === "running") {
          await animation.ready;
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }, scenario);
      const paused = await freezeSettledVisualAnimations(page);
      assert.equal(paused.length, 1, `${scenario}: expected one sampled animation`);
      assert.equal(paused[0].pending, false, `${scenario}: screenshot helper returned before pause applied`);
      assert.equal(paused[0].playState, "paused");
      const times = await page.evaluate(async () => {
        const animation = document.getAnimations()[0];
        const times = [animation.currentTime];
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          times.push(animation.currentTime);
        }
        return times;
      });
      assert(times.every(time => Number.isFinite(time) && time === times[0]),
        `${scenario}: animation advanced after pause helper returned`);
      await resumeSettledVisualAnimations(page);
      const resumed = await page.evaluate(async () => {
        const animation = document.getAnimations()[0];
        await animation.ready;
        const before = animation.currentTime;
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
        return animation.playState === "running" && animation.currentTime > before;
      });
      assert(resumed, `${scenario}: sampled animation did not resume`);
    }
    console.log("prepaint-animation-pause-playwright: PASS (2 scenarios; applied pause, stable frames, resume)");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
