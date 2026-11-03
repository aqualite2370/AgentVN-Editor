"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const source = fs.readFileSync(`${__dirname}/android-apk-runtime-qa.cjs`, "utf8");
async function scenario(initial, delayed, dropped = false, geometry = {}) {
  let expanded = initial, taps = 0, polls = 0, rectReads = 0;
  const context = vm.createContext({
    require: createRequire(__filename), __dirname, process, console, Buffer, setTimeout, clearTimeout, AbortSignal,
    touch: async () => { taps++; if (!delayed && !dropped) expanded = !expanded; },
    settle: async (_cdp, expression) => {
      assert.match(expression, /aria-expanded/);
      polls++;
      if (dropped) throw Error("menu did not expand");
      if (delayed) expanded = true;
      assert.equal(expanded, true);
    },
  });
  vm.runInContext(source.slice(0, source.indexOf("\nmain().catch(")) + `
    tapSelector = touch;
    waitFor = settle;
    globalThis.open = cdp => ensureQuickMenuExpanded(cdp, 'test menu');
  `, context);
  await context.open({ evaluate: async expression => {
    if (expression.includes("getBoundingClientRect")) {
      const after = rectReads++ > 0;
      if (geometry.missing) return null;
      return { x: 800 + (after ? geometry.dx || 0 : 0),
        y: 500 + (after ? geometry.dy || 0 : 0), width: 36, height: 36 };
    }
    assert.match(expression, /aria-expanded/);
    return expanded;
  } });
  assert.equal(rectReads, 2, "must measure the actual toggle before and after expansion");
  return { expanded, taps, polls };
}
(async () => {
  assert.deepEqual(await scenario(true, false), { expanded: true, taps: 0, polls: 1 });
  assert.deepEqual(await scenario(false, true), { expanded: true, taps: 1, polls: 1 });
  await assert.rejects(scenario(false, false, true), /menu did not expand/);
  assert.deepEqual(await scenario(false, false, false, { dx: 0.5, dy: -0.5 }),
    { expanded: true, taps: 1, polls: 1 });
  await assert.rejects(scenario(false, false, false, { dx: 2 }), /QUICK_MENU_TOGGLE_DRIFT/);
  await assert.rejects(scenario(false, false, false, { dy: -2 }), /QUICK_MENU_TOGGLE_DRIFT/);
  await assert.rejects(scenario(false, false, false, { missing: true }), /QUICK_MENU_TOGGLE_DRIFT/);
  console.log("android-menu-state: PASS (already expanded, delayed state, dropped touch, stable geometry, drift and missing geometry rejected)");
})().catch(error => { console.error(error); process.exitCode = 1; });
