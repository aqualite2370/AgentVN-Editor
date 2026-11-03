const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("node:module");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const shared = read("shared/cartridge/uiSkin.ts");
const defaults = read("shared/cartridge/quickMenuDefaults.ts");
const metricsSource = read("shared/cartridge/quickMenuMetrics.ts");
const bundledShared = read("editor/src-tauri/bundle-workspace/shared/cartridge/uiSkin.ts");
const runtime = read("GameCli_framework/src/components/player/PlaybackControls.tsx");
const runtimeSkin = read("GameCli_framework/src/uiSkin/uiSkinRuntime.tsx");
const prototype = read("GameCli_framework/src/prototypes/QuickMenuPrototype.tsx");
const prototypeCss = read("GameCli_framework/src/prototypes/quickMenuPrototype.css");
const designer = read("editor/src/components/advanced/RuntimeLayoutDesigner.tsx");
const layoutCss = read("editor/src/styles/layout.css");
const previewCss = read("editor/src/styles/quick-menu-preview.css");

function loadUiSkinApi() {
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        'export { getDefaultUISkinLayout, validateUISkinLayout } from "./shared/cartridge/uiSkin";',
      ].join("\n"),
      loader: "ts",
      resolveDir: root,
      sourcefile: "output/automated/quick-menu-direction-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    write: false,
    logLevel: "silent",
  });
  const compiled = new Module(
    path.join(root, "output/automated/quick-menu-direction-entry.cjs"),
    module,
  );
  compiled.filename = path.join(root, "output/automated/quick-menu-direction-entry.cjs");
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(result.outputFiles[0].text, compiled.filename);
  return compiled.exports;
}

assert.match(shared, /UI_LAYOUT_VERSION = "2\.0\.0"/, "quick-menu direction must use the current layout version");
assert.match(shared, /quickMenuDirection\?:\s*UILayoutQuickMenuDirection/, "layout style must expose quickMenuDirection");
assert.equal(
  bundledShared.replace(/\r\n/g, "\n"),
  shared.replace(/\r\n/g, "\n"),
  "bundled workspace uiSkin.ts must match the shared source",
);
assert.match(shared, /currentDefaultQuickMenuRect[\s\S]{0,260}QUICK_MENU_DEFAULT_RECT/, "desktop quick-menu default must use the shared standard placement");
assert.match(shared, /currentDefaultQuickMenuMobileRect[\s\S]{0,260}QUICK_MENU_DEFAULT_MOBILE_RECT/, "mobile quick-menu default must use the shared standard placement");
assert.match(defaults, /QUICK_MENU_DEFAULT_SURFACE_STYLE[\s\S]{0,500}quickMenuDirection:\s*"auto"/, "default quick-menu must use the shared automatic direction");
function loadMetricsApi() {
  const result = esbuild.buildSync({
    stdin: {
      contents: 'export { resolveQuickMenuDirection } from "./shared/cartridge/quickMenuMetrics";',
      loader: "ts",
      resolveDir: root,
      sourcefile: "output/automated/quick-menu-direction-metrics-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    write: false,
    logLevel: "silent",
  });
  const compiled = new Module(
    path.join(root, "output/automated/quick-menu-direction-metrics-entry.cjs"),
    module,
  );
  compiled.filename = path.join(root, "output/automated/quick-menu-direction-metrics-entry.cjs");
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(result.outputFiles[0].text, compiled.filename);
  return compiled.exports;
}
const { resolveQuickMenuDirection } = loadMetricsApi();
assert.equal(resolveQuickMenuDirection({ variant: "C", configuredDirection: "auto", anchor: "top_right" }), "up", "C automatic direction must resolve upward");
assert.equal(resolveQuickMenuDirection({ variant: "C", configuredDirection: undefined, anchor: "top_right" }), "up", "C missing direction must default upward");
assert.equal(resolveQuickMenuDirection({ variant: "C", configuredDirection: "down", anchor: "top_right" }), "down", "C explicit down direction must remain compatible");
assert.match(shared, /quickMenuClusterMatchesKnownDefault[\s\S]{0,500}QUICK_MENU_KNOWN_DEFAULT_FINGERPRINTS/, "legacy default migration must be guarded by a full cluster fingerprint");

assert.match(runtimeSkin, /"--runtime-quick-menu-direction"/, "runtime must preserve legacy quick-menu direction tokens for skin compatibility");
assert.doesNotMatch(runtimeSkin, /componentType === "quick_menu"[\s\S]{0,600}overflow:\s*"hidden"/, "quick-menu runtime style must not clip the morph surface");
assert.match(runtime, /data-quick-menu-direction/, "runtime must expose the resolved quick-menu direction");
assert.match(runtime, /data-quick-menu-fixed="true"/, "formal client must mark the fixed runtime quick-menu");
assert.match(runtime, /dialogRect:\s*dialogLayout\.rect/, "formal client must derive quick-menu geometry from the dialog top-right anchor");
assert.match(runtime, /const quickMenuVariant = "C"/, "formal client must use the fixed C drawer");
assert.match(runtime, /const menuDirection = "up"/, "formal client must use the fixed upward direction");

assert.match(prototype, /type VariantKey = "A" \| "C"/, "prototype must keep only A and C");
assert.doesNotMatch(prototype, /VariantD|VariantE|variant === "D"|variant === "E"/, "prototype must remove D/E");
assert.match(prototype, /type MenuDirection = "auto" \| "up" \| "down" \| "left" \| "right"/, "prototype must provide direction choices");
assert.match(prototype, /const DIRECTIONS_C[\s\S]{0,260}"auto"[\s\S]{0,260}"up"[\s\S]{0,260}"down"/, "C prototype must expose only automatic, upward, and downward directions");
assert.match(prototype, /variant === "C" && \(direction === "left" \|\| direction === "right"\)/, "C prototype must normalize unsupported horizontal directions");
assert.match(prototype, /data-testid="prototype-direction-picker"/, "prototype must expose a direction picker");
assert.match(prototype, /setVariantInUrl[\s\S]{0,500}direction/, "prototype direction must be shareable in URL");

assert.doesNotMatch(designer, /<summary>展开方向<\/summary>/, "layout designer must not expose quick-menu direction editing");
assert.doesNotMatch(designer, /setQuickMenuPreviewVariant\(/, "layout designer must not persist quick-menu variant changes");
assert.match(designer, /data-testid="runtime-quick-menu-preview-controls"/, "layout designer must expose quick-menu preview controls");
assert.match(designer, /data-preview-quick-menu-state/, "layout designer must expose expanded/collapsed preview state");
assert.match(previewCss, /Sole editor-preview owner for quick-menu geometry/, "quick-menu preview must have one explicit CSS owner");
assert.match(previewCss, /\.preview-quick-menu-preview/, "preview owner must style the real quick-menu preview");
assert.match(previewCss, /data-preview-quick-menu-direction="down"/, "layout preview must react to a downward direction");
assert.match(previewCss, /data-preview-quick-menu-direction="right"/, "layout preview must react to a rightward direction");
assert.doesNotMatch(previewCss, /data-preview-quick-menu-direction="left"\]\s+\.preview-quick-menu-preview-c/, "C editor preview must not expose horizontal expansion");
assert.doesNotMatch(layoutCss, /\.preview-quick-menu-preview/, "layout.css must not reintroduce a competing quick-menu preview contract");

const { getDefaultUISkinLayout, validateUISkinLayout } = loadUiSkinApi();
const defaultLayoutValidation = validateUISkinLayout(getDefaultUISkinLayout());
assert.equal(
  defaultLayoutValidation.ok,
  true,
  `default UI skin must validate when quickMenuDirection is present: ${JSON.stringify(defaultLayoutValidation.errors)}`,
);

const invalidDirectionLayout = structuredClone(getDefaultUISkinLayout());
const quickMenu = invalidDirectionLayout.screens
  .find((screen) => screen.screen_id === "player")
  .components.find((component) => component.component_type === "quick_menu");
quickMenu.style.quickMenuDirection = "diagonal";
const invalidDirectionValidation = validateUISkinLayout(invalidDirectionLayout);
assert.equal(invalidDirectionValidation.ok, false, "unsupported quick-menu direction must fail schema validation");
assert(
  invalidDirectionValidation.errors.some(
    (error) => error.code === "ui_quick_menu_direction"
      && error.path.endsWith(".quickMenuDirection"),
  ),
  `unsupported quick-menu direction must have a stable validation error: ${JSON.stringify(invalidDirectionValidation.errors)}`,
);

const legacyDirectionLayout = structuredClone(getDefaultUISkinLayout());
const legacyQuickMenu = legacyDirectionLayout.screens
  .find((screen) => screen.screen_id === "player")
  .components.find((component) => component.component_type === "quick_menu");
legacyDirectionLayout.ui_layout_version = "1.2.0";
legacyQuickMenu.style.quickMenuDirection = "left";
const normalizedLegacy = require("../editor/node_modules/esbuild").buildSync({
  stdin: {
    contents: 'export { migrateLegacyUISkinLayout } from "./shared/cartridge/uiSkin";',
    loader: "ts",
    resolveDir: root,
    sourcefile: "output/automated/quick-menu-direction-migration-entry.ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const migrationModule = { exports: {} };
new Function("module", "exports", normalizedLegacy)(migrationModule, migrationModule.exports);
delete legacyQuickMenu.style.quickMenuDirection;
const migratedLegacy = migrationModule.exports.migrateLegacyUISkinLayout(legacyDirectionLayout);
const migratedQuickMenu = migratedLegacy.screens
  .find((screen) => screen.screen_id === "player")
  .components.find((component) => component.component_type === "quick_menu");
assert.equal(migratedQuickMenu.style.quickMenuDirection, "up", "legacy default quick-menu layouts must receive upward direction");
assert.equal(validateUISkinLayout(migratedLegacy).ok, true, "migrated legacy layout must pass schema validation");

console.log("quick-menu-direction-contract: PASS");
