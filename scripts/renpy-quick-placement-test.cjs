"use strict";
// Focused source regression. Does not launch a model, application or user DB.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), out = process.argv[2];
assert(out && !fs.existsSync(out), "Use a fresh evidence directory");
fs.mkdirSync(out, { recursive: true });
const moduleValue = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
  export * from "./shared/cartridge/renpyQuickBar";
  export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";
  export {validateUISkinLayout,normalizeUISkinLayoutForRuntime} from "./shared/cartridge/uiSkin";
  export {minimumRuntimeVersionForLayout} from "./shared/cartridge/runtimeCapabilities";
  export {isRuntimeCompatible} from "./shared/cartridge/compatibility";
  export {SUPPORTED_RUNTIME_VERSION} from "./shared/cartridge/constants";
` }, bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(moduleValue, moduleValue.exports);
const api = moduleValue.exports, cases = [];
const frame = { width: 1280, height: 720 }, safe = { x: 0, y: 0, width: 100, height: 100 };
const check = (name, run) => { try { run(); cases.push({ name, status: "PASS" }); }
  catch (error) { cases.push({ name, status: "FAILED", error: String(error.stack || error) }); } };
const near = (a, b) => assert(Math.abs(a - b) < 0.00001, `${a} != ${b}`);
const layoutWith = placement => { const layout = api.createRenpyUILayout();
  const menu = layout.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu");
  menu.style = { ...menu.style, quickMenuPlacement: placement }; return layout; };
check("Default geometry unchanged", () => {
  const r = api.resolveRenpyQuickBar(frame, safe);
  near(r.x, 337); near(r.y, 680); near(r.width, 606); near(r.height, 32);
});
check("Explicit custom position consumed", () => {
  const r = api.resolveRenpyQuickBar(frame, safe, undefined, { x: 10, y: 15, width: 606 / 12.8, height: 32 / 7.2 });
  near(r.x, 128); near(r.y, 108); near(r.width, 606); near(r.height, 32);
});
check("Custom center anchor uses actual row envelope", () => {
  const r = api.resolveRenpyQuickBar(frame, safe, undefined, { x: 50, y: 50, width: 50, height: 10, anchor: "center" });
  near(r.x + r.width / 2, 640); near(r.y + r.height / 2, 360);
  near(r.width / r.height, 606 / 32);
});
check("Custom bottom/right clamped to safe area", () => {
  const bounds = { x: 3, y: 4, width: 94, height: 90 };
  const r = api.resolveRenpyQuickBar(frame, bounds, undefined, { x: 100, y: 100, width: 70, height: 10 });
  assert(r.x >= 38.4 && r.y >= 28.8); assert(r.x + r.width <= 1241.6001);
  assert(r.y + r.height <= 676.8001);
});
check("Custom uniform role geometry retained without mutation", () => {
  const rect = { x: 20, y: 20, width: 60, height: 8 }, copy = structuredClone(rect);
  const r = api.resolveRenpyQuickBar(frame, safe, { width: 80, height: 40 }, rect);
  assert.deepEqual(rect, copy); near(r.buttonWidth / r.height, 2);
  near(r.width, r.buttonWidth * 9 + r.gap * 8);
});
check("First custom enable starts at default bar", () => {
  const r = api.resolveRenpyQuickBar(frame, safe);
  const rect = api.defaultRenpyQuickBarRect(frame);
  const custom = api.resolveRenpyQuickBar(frame, safe, undefined, rect);
  for (const key of ["x", "y", "width", "height"]) near(custom[key], r[key]);
});
check("Both placement enum values accepted", () => {
  for (const value of ["bottom", "custom"])
    assert.deepEqual(api.validateUISkinLayout(layoutWith(value)).errors, []);
});
check("Invalid placement rejected", () => {
  for (const value of ["left", true, 1, null, {}])
    assert(api.validateUISkinLayout(layoutWith(value)).errors.some(e => e.code === "ui_quick_menu_placement"));
});
check("Custom placement without geometry rejected", () => {
  const layout = layoutWith("custom");
  delete layout.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu").rect;
  assert(api.validateUISkinLayout(layout).errors.some(e => e.code === "ui_quick_menu_rect"));
});
check("Normalization preserves authored custom rect and placement", () => {
  const layout = layoutWith("custom"), menu = layout.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu");
  menu.rect = { x: 50, y: 12, width: 55, height: 6, anchor: "top_center" };
  const normalized = api.normalizeUISkinLayoutForRuntime(JSON.parse(JSON.stringify(layout))).layout;
  assert.equal(normalized.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu").style.quickMenuPlacement, "custom");
  assert.deepEqual(normalized.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu").rect, menu.rect);
});
check("Only active Renpy custom bar requires Runtime 0.32", () => {
  assert.equal(api.minimumRuntimeVersionForLayout("0.31.0", layoutWith("custom")), "0.32.0");
  assert.equal(api.minimumRuntimeVersionForLayout("0.31.0", layoutWith("bottom")), "0.31.0");
  assert.equal(api.minimumRuntimeVersionForLayout("0.31.0", api.createRenpyUILayout()), "0.31.0");
  const ordinary = layoutWith("custom"); ordinary.layout_type = "agentvn";
  assert.equal(api.minimumRuntimeVersionForLayout("0.31.0", ordinary), "0.31.0");
});
check("Older runtime rejects and current source supports new capability", () => {
  const required = api.minimumRuntimeVersionForLayout("0.31.0", layoutWith("custom"));
  assert.equal(api.isRuntimeCompatible(required, "0.31.0"), false);
  assert.equal(api.isRuntimeCompatible(required, api.SUPPORTED_RUNTIME_VERSION), true);
});
check("Custom upper bar leaves dialogue and NVL reading space", () => {
  const bar = api.resolveRenpyQuickBar(frame, safe, undefined, { x: 10, y: 5, width: 60, height: 6 });
  const r = api.resolveRenpyQuickBarReadingBounds(frame, safe, bar, { x: 5, y: 80, width: 90, height: 12 }, true);
  near(r.dialogMaxHeight, 86.4); near(r.nvlBottomOffset, 50.4); near(r.nvlMaxHeight, 504);
});
check("Default dialogue dock reservation unchanged", () => {
  const bar = api.resolveRenpyQuickBar(frame, safe);
  const r = api.resolveRenpyQuickBarReadingBounds(frame, safe, bar, { x: 5, y: 80, width: 90, height: 12 }, false);
  near(r.dialogMaxHeight, 96); near(r.nvlBottomOffset, 50.4);
});
check("All seven anchors stay within safe frame across player ratios", () => {
  for (const height of [720, 800, 960]) for (const anchor of ["top_left", "top_center", "top_right", "center", "bottom_left", "bottom_center", "bottom_right"]) {
    const f = { width: 1280, height }, b = { x: 2, y: 3, width: 96, height: 92 };
    const r = api.resolveRenpyQuickBar(f, b, undefined, { x: 98, y: 98, width: 85, height: 20, anchor });
    assert(r.x >= 25.6 && r.y >= height * .03);
    assert(r.x + r.width <= 1254.4001 && r.y + r.height <= height * .95 + .0001);
    near(r.width, r.buttonWidth * 9 + r.gap * 8);
  }
});
const report = { status: cases.length === 15 && cases.every(c => c.status === "PASS") ? "PASS" : "FAILED",
  scope: "SOURCE_UNIT_NOT_BROWSER_OR_INSTALLED", cases, finishedAt: new Date().toISOString() };
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, count: cases.length, failures: cases.filter(c => c.status !== "PASS").map(c => c.name) }));
process.exitCode = report.status === "PASS" ? 0 : 1;
