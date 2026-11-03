const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const runtime = read("GameCli_framework/src/uiSkin/uiSkinRuntime.tsx");
const mainMenu = read("GameCli_framework/src/components/shell/MainMenu.tsx");
const shellCss = read("GameCli_framework/src/styles/shell.css");
const designer = read("editor/src/components/advanced/RuntimeLayoutDesigner.tsx");
const uiSkin = read("shared/cartridge/uiSkin.ts");

assert.match(runtime, /titleMenuButtonComponentTypes/, "title button layer set is missing");
assert.match(
  runtime,
  /titleMenuButtonComponentTypes\.has\(componentType\)[\s\S]{0,160}Math\.max\(component\?\.zIndex \?\? 30, 30\)/,
  "title buttons must be clamped to the foreground layer",
);
assert.match(
  runtime,
  /masks\.length > 0 && screen !== "title"/,
  "title masks must be rendered inside the title menu layer stack",
);
assert.match(mainMenu, /useUILayoutMasks\("title"\)/, "title menu must consume title masks");
assert.match(mainMenu, /main-menu-title-hero-background/, "title hero background must render as a separate layer");
assert.match(mainMenu, /main-menu-title-mask/, "title mask layer is missing");
assert.match(mainMenu, /main-menu-title-actions-layer/, "title actions must render in an independent full-frame layer");
assert.doesNotMatch(mainMenu, /title_library_button|data-testid="open-library"/, "title menu must not expose the cartridge-library button");
assert.match(
  mainMenu,
  /zIndex: Math\.min\(Math\.max\(component\.zIndex \?\? 20, 20\) \+ index, 29\)/,
  "title masks must stay in the 20-29 layer above title background",
);
assert.match(mainMenu, /zIndex: 10/, "title hero content must render above the title mask");
assert.match(shellCss, /\.main-menu-title-hero-background[\s\S]*z-index:\s*1/, "title hero background layer must be below masks");
assert.match(shellCss, /\.main-menu-title-mask[\s\S]*z-index:\s*20/, "title mask layer must be above title background");
assert.match(
  shellCss,
  /\.main-menu \.menu-actions\.menu-actions-individual[\s\S]*z-index:\s*30/,
  "title actions must render above the title mask",
);
assert.match(
  shellCss,
  /\.main-menu-title-actions-layer[\s\S]*position:\s*absolute[\s\S]*inset:\s*0[\s\S]*pointer-events:\s*none/,
  "title actions layer must preserve the runtime frame positioning reference",
);
assert.match(designer, /part-main_menu_hero-background/, "editor preview must render a separate hero background layer");
assert.doesNotMatch(designer, /main_menu_exit_button/, "editor preview must not expose a removed exit title layer");
assert.match(designer, /zIndex: 1, pointerEvents: "none"/, "editor preview hero background must be non-interactive");
assert.match(
  designer,
  /component\.component_type === "main_menu_hero"[\s\S]{0,900}zIndex: 10/,
  "editor preview hero content must render above the mask",
);
assert.match(uiSkin, /UI_LAYOUT_VERSION = "2\.0\.0"/, "title default-action migration must keep the current UI layout version");
assert.match(uiSkin, /DEFAULT_TITLE_ACTION_MASK_COMPONENT_ID = "title_default_action_mask"/, "default title mask must use a stable editable component id");
assert.doesNotMatch(
  uiSkin.match(/const requiredByScreen[\s\S]*?\n};/)?.[0] || "",
  /main_menu_library_button/,
  "the cartridge-library title button must not remain a required component",
);

console.log("title-layout-layering-contract: PASS");
