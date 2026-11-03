"use strict";
const { idle } = require("../editor-selection-mask-motion-playwright.cjs");
const root = ".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)";
async function settled(page, tab) {
  await idle(page,tab);
  await page.evaluate(async root => {
    let last, stable = 0;
    const deadline = performance.now()+15000;
    while (performance.now()<deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const node = document.querySelector(root), nav = node?.querySelector("nav");
      if (!node || !nav) { stable=0; continue; }
      const boxes = [node,nav].flatMap(n => {
        const r=n.getBoundingClientRect(); return [r.x,r.y,r.width,r.height];
      });
      const running = [node, nav].some(n => n.getAnimations().some(a => a.playState==="running"));
      stable = !running && last && boxes.every((v,i) => Math.abs(v-last[i])<.05) ? stable+1 : 0;
      last=boxes;
      if(stable>=8) return;
    }
    throw Error("Workbench/navigation geometry did not settle");
  },root);
}
module.exports = {settled,root};
