const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const designer = fs.readFileSync(path.join(root, "editor/src/components/advanced/RuntimeLayoutDesigner.tsx"), "utf8");
const advancedTools = fs.readFileSync(path.join(root, "editor/src/components/advanced/AdvancedToolsPanel.tsx"), "utf8");
const hoverHelp = fs.readFileSync(path.join(root, "editor/src/components/common/hoverHelpCatalog.ts"), "utf8");
const skin = fs.readFileSync(path.join(root, "shared/cartridge/uiSkin.ts"), "utf8");

assert.match(designer, /<h3>游戏客户端<\/h3>/);
assert.match(advancedTools, /layout:\s*"游戏客户端"/);
assert.doesNotMatch(designer, />PC authored（移动端等比缩放）</);
assert.doesNotMatch(designer, /手机布局|手机横屏布局|应用到手机|应用到桌面|同步两端|应用统一布局坐标/);
assert.doesNotMatch(designer, /copySelectedRectTo|UILayoutBreakpoint|data-layout-mode="pc"|data-preview-quick-menu-breakpoint/);
assert.doesNotMatch(hoverHelp, /"layout\.desktop"|"layout\.mobile"|"layout\.copyBreakpoint"|分别调整桌面与手机/);
assert.match(designer, /function getRect\(component: UILayoutComponent\): UILayoutRect/);
assert.match(designer, /return \{ \.\.\.component, rect \}/);
assert.match(skin, /function finalizeUnifiedLayout/);
assert.match(skin, /const \{ mobileRect, \.\.\.withoutMobileRect \} = component/);
assert.doesNotMatch(skin, /\? \[createDefaultTitleActionMask\(\), \.\.\.components\]/);
// Historical filename retained for callers. These are schema/entry contracts;
// real UI editing is covered by client-layout-editing-regression-playwright.cjs.
const esbuild = require("../editor/node_modules/esbuild");
const Module = require("node:module");
const code = esbuild.buildSync({
  stdin: { contents: 'export { getDefaultUISkinLayout, migrateLegacyUISkinLayout } from "./shared/cartridge/uiSkin";',
    loader: "ts", resolveDir: root },
  bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent",
}).outputFiles[0].text;
const compiled = new Module(__filename, module);
compiled.paths = module.paths;
compiled._compile(code, __filename);
const { getDefaultUISkinLayout, migrateLegacyUISkinLayout } = compiled.exports;
const source = getDefaultUISkinLayout();
const title = source.screens.find((screen) => screen.screen_id === "title");
title.components.push({
  component_id: "authored_group", component_type: "main_menu_custom_button_container",
  rect: { x: 12, y: 75, width: 30, height: 10 },
  mobileRect: { x: 80, y: 30, width: 5, height: 5 },
});
const restored = migrateLegacyUISkinLayout(JSON.parse(JSON.stringify(source)));
const group = restored.screens.find((screen) => screen.screen_id === "title")
  .components.find((component) => component.component_id === "authored_group");
assert.deepEqual(group?.rect, { x: 12, y: 75, width: 30, height: 10 }, "preserve authored group geometry");
assert(!("mobileRect" in group), "do not restore a second mobile layout");
console.log("mobile-unified-layout-editor-playwright: PASS (schema/entry contracts, not browser acceptance)");
