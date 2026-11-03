const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildSync } = require("../GameCli_framework/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-unified-layout-"));
const out = path.join(dir, "uiSkin.cjs");
try {
  buildSync({ entryPoints: [path.join(root, "shared/cartridge/uiSkin.ts")], bundle: true, platform: "node", format: "cjs", outfile: out, logLevel: "silent" });
  const { UI_LAYOUT_VERSION, getDefaultUISkinLayout, migrateLegacyUISkinLayout, validateUISkinLayout } = require(out);
  assert.equal(UI_LAYOUT_VERSION, "2.0.0");
  const defaults = getDefaultUISkinLayout();
  assert.equal(JSON.stringify(defaults).includes("mobileRect"), false);
  const both = { ...defaults, ui_layout_version: "1.4.0", screens: defaults.screens.map((screen) => ({ ...screen, components: screen.components.map((component) => ({ ...component, mobileRect: { x: 1, y: 2, width: 3, height: 4 } })) })) };
  const migratedBoth = migrateLegacyUISkinLayout(both);
  assert.equal(migratedBoth.ui_layout_version, "2.0.0");
  assert.equal(JSON.stringify(migratedBoth).includes("mobileRect"), false);
  const mobileOnly = { ...defaults, ui_layout_version: "1.4.0", screens: defaults.screens.map((screen) => ({ ...screen, components: screen.components.map(({ rect, ...component }) => ({ ...component, mobileRect: rect ?? { x: 10, y: 10, width: 20, height: 20 } })) })) };
  const migratedMobileOnly = migrateLegacyUISkinLayout(mobileOnly);
  assert.equal(JSON.stringify(migratedMobileOnly).includes("mobileRect"), false);
  assert.ok(migratedMobileOnly.screens.every((screen) => screen.components.every((component) => component.rect)));
  const rawValidation = validateUISkinLayout(both);
  assert.equal(rawValidation.ok, false);
  assert.ok(rawValidation.errors.some((item) => item.code === "ui_layout_legacy_mobile_rect"));
  assert.equal(validateUISkinLayout(migratedBoth).ok, true);
  console.log("title-default-actions-migration-contract: PASS");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
