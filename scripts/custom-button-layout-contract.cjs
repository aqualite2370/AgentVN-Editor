const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require(path.join(__dirname, "..", "editor", "node_modules", "esbuild"));

const root = path.resolve(__dirname, "..");
const output = esbuild.buildSync({
  entryPoints: [path.join(root, "editor", "src", "utils", "customButtonLayout.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  logLevel: "silent",
}).outputFiles[0]?.text;

assert.ok(output, "custom-button layout helper must bundle");
const compiled = new Module(path.join(root, "output", "custom-button-layout-contract.cjs"), module);
compiled.filename = path.join(root, "output", "custom-button-layout-contract.cjs");
compiled.paths = module.paths;
compiled._compile(output, compiled.filename);

const { findAvailableCustomButtonRect } = compiled.exports;
assert.equal(typeof findAvailableCustomButtonRect, "function", "layout helper must export slot selection");

const container = {
  component_id: "title_custom_button_container",
  component_type: "main_menu_custom_button_container",
  rect: { x: 5, y: 87, width: 66, height: 9 },
  mobileRect: { x: 5, y: 89, width: 87, height: 8 },
};
const button = (id, x) => ({
  component_id: id,
  component_type: "main_menu_custom_button",
  rect: { x, y: 88, width: 20, height: 7 },
  mobileRect: { x: x === 6 ? 6 : x === 50 ? 64 : 35, y: 90, width: 27, height: 6 },
});

const desktopHole = findAvailableCustomButtonRect(
  [container, button("first", 6), button("third", 50)],
  container,
  "desktop",
);
assert.deepEqual(desktopHole, { x: 28, y: 88, width: 20, height: 7 }, "desktop add must reuse the first free grid slot");

const mobileHole = findAvailableCustomButtonRect(
  [container, button("first", 6), button("third", 50)],
  container,
  "mobile",
);
assert.deepEqual(mobileHole, desktopHole, "legacy mobile callers must use the same authored slot, not resurrect mobileRect");

console.log("custom button layout contract: PASS");
