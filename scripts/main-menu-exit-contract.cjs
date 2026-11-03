const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const shared = read("shared/cartridge/uiSkin.ts");
const runtimeSkin = read("GameCli_framework/src/uiSkin/uiSkinRuntime.tsx");
const mainMenu = read("GameCli_framework/src/components/shell/MainMenu.tsx");
const settingsScreen = read("GameCli_framework/src/components/shell/SettingsScreen.tsx");
const exitDialog = read("GameCli_framework/src/components/shell/ExitGameDialog.tsx");
const app = read("GameCli_framework/src/app/App.tsx");
const runtimeStore = read("GameCli_framework/src/store/runtimeStore.ts");
const shellCss = read("GameCli_framework/src/styles/shell.css");
const themeDesigner = read("editor/src/components/advanced/RuntimeThemeDesigner.tsx");
const themePresets = read("shared/cartridge/uiThemePresets.ts");
const permissions = JSON.parse(read("GameCli_framework/src-tauri/capabilities/default.json"));

assert.match(shared, /\|\s*"main_menu_exit_button"/, "shared layout type must keep the legacy exit type for migration");
assert.doesNotMatch(
  shared,
  /component_id:\s*"title_exit_button"[\s\S]{0,100}component_type:\s*"main_menu_exit_button"/,
  "default title layout must not expose the exit component",
);
assert.doesNotMatch(
  runtimeSkin,
  /titleMenuButtonComponentTypes[\s\S]{0,400}"main_menu_exit_button"/,
  "runtime title layering must not include exit",
);
const renpyTitleBranch = mainMenu.match(/if \(skin\.layout_type === "renpy"\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
assert.match(renpyTitleBranch, /add\("open-exit-confirmation",\s*"退出"/,
  "Ren'Py title must expose its explicitly requested exit entry");
const agentTitleBranch = mainMenu.slice(mainMenu.indexOf("\n  return (", mainMenu.indexOf('if (skin.layout_type === "renpy")')));
assert.doesNotMatch(agentTitleBranch, /open-exit-confirmation|退出游戏按钮/,
  "AgentVN title must retain its original layout without a new exit entry");
assert.doesNotMatch(mainMenu, /<Modal title="退出游戏？"/, "title menu must reuse the shared exit dialog");
assert.match(settingsScreen, /data-testid="open-exit-confirmation"/, "options screen must own the exit entry");
assert.match(settingsScreen, /openExitConfirmation/, "options exit must open the shared confirmation state");
assert.match(app, /exitConfirmationOpen && <ExitGameDialog \/>/,
  "all exit entry points must render the shared root confirmation");
assert.match(exitDialog, /<Modal title="退出游戏？"/, "exit must require a shared confirmation modal");
assert.match(exitDialog, /closeAfterSave\(flushAutoSave,\s*closeStandaloneRuntimeWindow\)/,
  "normal exit must await the save barrier before closing");
assert.match(exitDialog, /closeWithoutSave\(closeStandaloneRuntimeWindow\)/,
  "save loss must require the separate explicit discard confirmation");
assert.match(runtimeStore, /flushAutoSave: async \(\) =>/,
  "the autosave flush must resolve with the persisted outcome");
assert.match(exitDialog, /预览模式不会关闭编辑器。/, "embedded and browser previews must show a visible simulation message");
assert.match(exitDialog, /无法关闭游戏窗口/, "window close failures must be visible");
assert.doesNotMatch(themeDesigner, /\{ id: "main_menu_exit_button", label: "退出游戏按钮" \}/, "theme designer must not expose a title exit scope");
assert.doesNotMatch(themePresets, /main_menu_exit_button:\s*control/, "theme presets must not style a removed title exit control");
// The shipped settings footer uses a subdued outlined action, not the former
// borderless link. Keep its quiet treatment and visible keyboard focus.
const exitStyle = shellCss.match(/\.settings-screen \.settings-exit-link\s*\{([^}]+)\}/)?.[1] ?? "";
assert.match(exitStyle, /box-shadow:\s*none/, "options exit must remain visually subdued");
assert.match(exitStyle, /color:\s*color-mix[\s\S]*var\(--muted\)/, "options exit must use muted theme text");
assert.match(shellCss, /\.settings-exit-link:focus-visible\s*\{[^}]*outline:\s*2px/, "options exit requires visible keyboard focus");
assert.equal(permissions.permissions.includes("core:window:allow-close"), true, "Tauri window close permission is required");

console.log("main-menu-exit-contract: PASS");
