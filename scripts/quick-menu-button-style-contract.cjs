const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const shared = read("shared/cartridge/uiSkin.ts");
const defaults = read("shared/cartridge/quickMenuDefaults.ts");
const runtime = read("GameCli_framework/src/components/player/PlaybackControls.tsx");
const runtimeSkin = read("GameCli_framework/src/uiSkin/uiSkinRuntime.tsx");
const playerCss = read("GameCli_framework/src/styles/quick-menu-contract.css");
const shellCss = read("GameCli_framework/src/styles/shell.css");
const designer = read("editor/src/components/advanced/RuntimeLayoutDesigner.tsx");
const previewCss = read("editor/src/styles/quick-menu-preview.css");
const precisionIcons = read("GameCli_framework/src/components/common/PrecisionIcon.tsx");

const buttonIds = [
  "quick_rollback_button",
  "quick_auto_button",
  "quick_skip_button",
  "quick_save_load_button",
  "quick_history_button",
  "quick_hide_ui_button",
  "quick_main_menu_button",
];

for (const id of buttonIds) {
  assert(defaults.includes(`component_id: "${id}"`), `shared quick-menu defaults are missing ${id}`);
  assert(runtime.includes(`componentId="${id}"`), `runtime mapping is missing ${id}`);
}

assert.match(shared, /missingQuickButtons[\s\S]*createDefaultQuickMenuButtons/, "legacy migration must add missing quick buttons");
assert.match(shared, /normalizeUISkinLayoutForRuntime/, "runtime compatibility normalization must be available");
assert.match(shared, /value === "transparent"/, "transparent must be accepted as a safe runtime color");
assert.match(shared, /styleTemplateComponentTypes[\s\S]*"quick_button"/, "quick buttons must not require independent layout rects");
assert.match(runtimeSkin, /\["dialog_panel", "choice_list", "choice_option", "quick_button", "main_menu_custom_button"\]/, "quick button images must use image-owned visual mode");
assert.match(runtimeSkin, /normalizeUISkinLayoutForRuntime\(currentGame\?\.uiSkin\)/, "runtime must normalize older UI skins before rendering");
assert.match(runtime, /<PrecisionIcon name="expand" size=\{33\}/, "collapsed quick-menu glyph must use the precision icon system at 1.5x visual size");
for (const iconName of ["rollback", "auto", "skip", "save", "history", "hide", "menu"]) {
  assert(runtime.includes(`<PrecisionIcon name="${iconName}"`), `runtime is missing the ${iconName} precision icon`);
}
assert.doesNotMatch(runtime, /quick_settings_button|<PrecisionIcon name="settings"/, "playback quick menu must not expose settings");
assert.doesNotMatch(runtime, /preview-badge|runtimeMode === "preview"\s*\?\s*8\s*:\s*7/, "preview mode must not add a synthetic quick-menu button");
assert.match(precisionIcons, /strokeWidth="1\.65"/, "precision icons must share a restrained 1.65px stroke");
assert.match(precisionIcons, /strokeLinecap="round"[\s\S]*strokeLinejoin="round"/, "precision icons must use rounded line terminals");
assert.match(runtimeSkin, /"--runtime-quick-menu-skin-background"[\s\S]{0,500}"--runtime-quick-menu-skin-radius"[\s\S]{0,300}"--runtime-quick-menu-skin-blur"/, "quick-menu skin values must be forwarded as local CSS variables");
assert.match(
  playerCss,
  /\.playback-controls\.ui-layouted\s*\{[\s\S]{0,500}width:\s*var\(--runtime-quick-menu-root-width,\s*var\(--runtime-quick-menu-surface-width\)\)[\s\S]{0,240}height:\s*var\(--runtime-quick-menu-root-height,\s*var\(--runtime-quick-menu-surface-height\)\)/,
  "quick-menu root must use root geometry with shared surface fallbacks",
);
assert.match(playerCss, /data-quick-menu-variant="C"[\s\S]*grid-template-columns:\s*minmax\(0, var\(--runtime-quick-menu-cell-width\)\)/, "C quick-menu must use the shared single-column grid");
assert.match(playerCss, /data-quick-menu-variant="C"[\s\S]*grid-template-rows:\s*repeat\(7, var\(--runtime-quick-menu-action-hit-size\)\)/, "C quick-menu must use seven action rows");
assert.doesNotMatch(playerCss, /data-quick-menu-variant="C"[\s\S]*repeat\(2/, "C quick-menu must not regress to a two-column grid");
assert.doesNotMatch(playerCss, /data-quick-menu-variant="C"[\s\S]*repeat\(4/, "C quick-menu must not regress to a four-row layout");
assert.match(playerCss, /grid-template-columns:\s*repeat\(7, var\(--runtime-quick-menu-action-hit-size\)\)/, "A quick-menu rail must keep seven fixed action hit slots");
assert.match(playerCss, /\.quick-menu-surface\s*\{[\s\S]{0,1200}inset:\s*0[\s\S]{0,900}height:\s*100%[\s\S]{0,700}border-radius:\s*var\(--runtime-quick-menu-surface-radius\)/, "expanded quick-menu surface must fill the authored container");
assert.match(runtime, /data-quick-menu-fixed="true"/, "runtime must mark the fixed quick-menu geometry");
assert.match(runtime, /const quickMenuVariant = "C"/, "runtime must use the fixed C drawer");
assert.match(runtime, /resolveQuickMenuPresentation/, "runtime must use the shared quick-menu presentation geometry");
assert.match(runtime, /dialogRect:\s*dialogLayout\.rect/, "runtime must anchor the fixed drawer to the dialog top-right geometry");
assert.match(runtime, /"--runtime-quick-menu-drawer-width"[\s\S]{0,180}"--runtime-quick-menu-drawer-height"/, "C quick-menu must expose shared drawer geometry");
assert.match(playerCss, /\.quick-menu-toggle-layer \.quick-menu-toggle[\s\S]{0,1000}width:\s*var\(--runtime-quick-menu-toggle-size\)[\s\S]{0,600}height:\s*var\(--runtime-quick-menu-toggle-size\)[\s\S]{0,600}border-radius:\s*50%/, "collapsed quick-menu toggle must be a circle tied to the shared surface geometry");
assert.match(playerCss, /\.quick-menu-action-layer > \.quick-menu-button:not\(\.is-image-owned\)::before\s*\{[\s\S]{0,120}content:\s*none[\s\S]{0,80}display:\s*none/, "quick-menu actions must paint their material on the real button");
assert.match(playerCss, /\.quick-menu-toggle::before\s*\{[\s\S]{0,120}content:\s*none[\s\S]{0,80}display:\s*none/, "quick-menu toggle must not retain a pseudo background or decorative arc");
assert.match(playerCss, /\[data-quick-menu-fixed="true"\]\[data-quick-menu-variant="C"\]\.is-expanded[\s\S]{0,700}border-radius:\s*50%/, "expanded fixed C toggle must remain circular");
assert.doesNotMatch(runtime, /quick-menu-toggle-surface/, "runtime toggle must not add a redundant nested visual container");
assert.match(playerCss, /-webkit-backdrop-filter:\s*blur\(var\(--runtime-quick-menu-glass-blur\)\) saturate\(var\(--runtime-quick-menu-surface-saturation\)\);[\s\S]{0,120}backdrop-filter:\s*blur\(var\(--runtime-quick-menu-glass-blur\)\) saturate\(var\(--runtime-quick-menu-surface-saturation\)\);/, "quick-menu glass must provide prefixed and standard low-saturation backdrop blur");
assert.match(playerCss, /--runtime-quick-menu-surface-saturation:\s*0\.5;/, "quick-menu glass must use 0.5 saturation");
assert.match(playerCss, /--runtime-quick-menu-glass-shadow:[\s\S]{0,240}inset 0 1px 0/, "quick-menu glass must keep a subtle static glow and inset highlight");
assert.doesNotMatch(playerCss, /\.quick-menu-(?:button|toggle):hover/, "quick menu must not define hover visual states");
assert.doesNotMatch(previewCss, /\.preview-quick-menu-(?:button|toggle):hover/, "editor preview quick menu must not define hover visual states");
assert.doesNotMatch(playerCss, /\.playback-controls[\s\S]{0,1200}transform:\s*translateY\(-2px\)/, "quick menu must not lift on hover");
const imageOwnedSelector = ".playback-controls .quick-menu-button.is-image-owned";
const imageOwnedStart = playerCss.indexOf(imageOwnedSelector);
assert(imageOwnedStart >= 0, "image-owned quick button rule must exist");
const imageOwnedEnd = playerCss.indexOf("\n}", imageOwnedStart);
const imageOwnedBlock = playerCss.slice(imageOwnedStart, imageOwnedEnd >= 0 ? imageOwnedEnd : undefined);
for (const property of [
  /background-color:\s*transparent\s*!important/,
  /border:\s*0\s*!important/,
  /box-shadow:\s*none\s*!important/,
]) {
  assert(property.test(imageOwnedBlock), `image-owned quick buttons must clear original frame styling (${property})`);
}
assert.doesNotMatch(shellCss, /\.ui-button:hover:not\(:disabled\)\s*\{/, "common runtime buttons must not define a hover visual state");
assert.doesNotMatch(shellCss, /\.ui-button:hover:not\(:disabled\)\s*\{[^}]*transform:/, "common button hover must not transform");
assert.match(shellCss, /\.ui-button\.ghost\s*\{[\s\S]{0,260}background-color:\s*color-mix\([^;]+var\(--runtime-panel-solid, var\(--surface-2\)\)\);/, "default ghost buttons must keep an opaque surface background");
assert.match(designer, /QUICK_MENU_BUTTON_DEFINITIONS/, "layout designer must understand fixed quick button definitions");
assert.doesNotMatch(designer, /quick_settings_button/, "layout designer preview must not expose the removed settings action");
assert.match(designer, /const buttonCount = Math\.max\(1, QUICK_MENU_BUTTON_DEFINITIONS\.length\)/, "layout designer quick slots must follow the shared action count");
assert.match(designer, /isStyleOnlyComponent[\s\S]*quick_button/, "layout designer must treat quick buttons as style-only");
assert.match(designer, /quick-button-image-owned-note/, "layout designer must explain image-owned override mode");
assert.match(designer, /preview-quick-menu-buttons/, "designer preview must render the real quick-menu button row");
assert.match(designer, /quickButtonIconNames/, "designer preview must render stable quick-button icon slots");
assert.match(designer, /data-precision-icon=\{iconName\}/, "designer preview quick-button icons must expose runtime semantic names");
assert.match(designer, /strokeWidth=\"1\.65\"/, "designer preview quick-button icons must use the restrained line weight");
assert.match(designer, /backgroundColor:\s*"transparent"/, "selection overlays must keep a transparent background");
assert.match(designer, /backgroundImage:\s*"none"/, "selection overlays must not paint an image over real button visuals");
assert.match(designer, /pointerEvents:\s*"none"/, "selection overlays must not intercept real button interaction");
assert.match(precisionIcons, /case "expand"[\s\S]*circle cx="6\.5" cy="12" r="1\.3" fill="currentColor" stroke="none"[\s\S]*circle cx="12" cy="12" r="1\.3" fill="currentColor" stroke="none"[\s\S]*circle cx="17\.5" cy="12" r="1\.3" fill="currentColor" stroke="none"/, "expand icon must use three evenly spaced dots");
assert.doesNotMatch(precisionIcons, /case "expand"[\s\S]*precision-icon__guide/, "expand icon must not include the old guide line");
assert.match(precisionIcons, /case "close":\s*return <path d="m6\.5 6\.5 11 11M17\.5 6\.5l-11 11" \/>;/, "close icon must not carry a decorative arc around X");
assert.match(runtime, /displayLabel="回退"[\s\S]*displayLabel="自动"[\s\S]*displayLabel="快进"[\s\S]*displayLabel="存档"[\s\S]*displayLabel="历史"[\s\S]*displayLabel="隐藏"[\s\S]*displayLabel="菜单"/, "runtime quick-menu actions must use the selected short labels");
assert.match(designer, /quickButtonDisplayLabels[\s\S]*quick_rollback_button:\s*"回退"[\s\S]*quick_main_menu_button:\s*"菜单"/, "editor preview quick-menu actions must use the selected short labels");

console.log(`quick-menu-button-style-contract: ${buttonIds.length} fixed quick buttons verified`);
