"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "installed-windows-portable-smoke.cjs"),
  "utf8",
);
const connect = source.indexOf('chromium.connectOverCDP(`http://127.0.0.1:${port}`)');
const titleReady = source.indexOf('page.getByTestId("start-new-game").waitFor({ state: "visible"');
const bootReady = source.indexOf('page.waitForFunction(() => !document.querySelector(".boot-overlay"))');
const viewportRead = source.indexOf("const viewport = await page.evaluate");
const errorListener = source.indexOf('page.on("pageerror"');

assert(connect >= 0 && titleReady > connect, "smoke must connect to the packaged WebView and await the real title control");
assert(bootReady > titleReady, "smoke must wait for boot completion before collecting title evidence");
assert(viewportRead > bootReady, "smoke must not evaluate page state during an initial WebView navigation");
assert(errorListener > connect && errorListener < titleReady,
  "frontend errors must be observed throughout initial navigation and boot");
assert(source.includes("INSTALLED_ACCEPTANCE_DPR") && source.includes("INSTALLED_ACCEPTANCE_REDUCED_MOTION"),
  "Actual portable acceptance must support the independently required DPR and reduced-motion matrix");
assert(source.includes('Emulation.setDeviceMetricsOverride') && source.includes('page.emulateMedia'),
  "DPR and reduced-motion configuration must affect the actual packaged WebView");
assert(source.includes('window.devicePixelRatio') && source.includes('matchMedia("(prefers-reduced-motion: reduce)")'),
  "Report must verify the actual DPR and media result, not only record requested values");

const { portableLayoutFlow, assertRenpyQuickBarGeometry } = require("./lib/installed-portable-layout.cjs");
assert.deepEqual(portableLayoutFlow({ layout_type: "renpy" }), {
  type: "renpy",
  quickActions: ["rollback", "history", "skip", "auto", "save-load", "save", "load", "settings", "hide"],
  menu: { key: "Escape" },
});
assert.deepEqual(portableLayoutFlow({}), {
  type: "agentvn", quickActions: [], menu: { toggle: "quick-menu-toggle", button: "open-main-menu" },
});
assert.equal(portableLayoutFlow({ layout_type: "agentvn" }).type, "agentvn");
assert.throws(() => portableLayoutFlow({ layout_type: "unsupported" }), /Unsupported/);
assert(source.includes('embedded-cartridge/ui/layout.json') && source.includes("portableLayoutFlow("),
  "Flow must derive from the actual exported layout, not the presence of an incidental DOM control");
assert(source.includes("assertRenpyQuickBarGeometry(") && source.includes("exerciseRenpyQuickBar("),
  "Ren'Py acceptance must verify geometry and actual quick-action behavior");
assert(source.includes("flow.menu.key") && source.includes("page.keyboard.press(flow.menu.key)"),
  "Ren'Py game menu must open through its real keyboard entry");
assert(!source.includes('|| "隐忍的成长"'),
  "Intermediate portable acceptance must require an explicit isolated project title");
assert(source.includes("await waitForDialogueRead();"),
  "Skip-state assertions must await the actual dialogue read state, including reduced motion");

const valid = {
  rect: { x: 100, y: 900, width: 900, height: 40 },
  buttons: ["回退", "历史", "快进", "自动", "存档", "快存", "快读", "设置", "隐藏"].map((label, i) => ({
    label, rect: { x: 100 + i * 100, y: 900, width: 90, height: 40 },
    hit: true, clipped: false,
  })),
  overflow: 0, pageOverflow: 0,
};
assertRenpyQuickBarGeometry(valid, { width: 1920, height: 1080 });
assert.throws(() => assertRenpyQuickBarGeometry({ ...valid, buttons: valid.buttons.slice(1) },
  { width: 1920, height: 1080 }), /nine/i);
for (const [change, message] of [
  [{ hit: false }, /hit/i], [{ clipped: true }, /clip/i],
  [{ rect: { x: 100, y: 850, width: 90, height: 40 } }, /row|overlap/i],
  [{ rect: { x: 1880, y: 900, width: 90, height: 40 } }, /bounds/i],
]) {
  const buttons = valid.buttons.map((button, i) => i === 2 ? { ...button, ...change } : button);
  assert.throws(() => assertRenpyQuickBarGeometry({ ...valid, buttons },
    { width: 1920, height: 1080 }), message);
}
assert.throws(() => assertRenpyQuickBarGeometry({ ...valid, overflow: 20 },
  { width: 1920, height: 1080 }), /scroll/i);
console.log("installed-windows-portable-smoke-contract-test: PASS (layout branches and geometry negative controls)");
