#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const mainMenu = read("GameCli_framework/src/components/shell/MainMenu.tsx");
const settings = read("GameCli_framework/src/components/shell/SettingsScreen.tsx");
const exitDialog = read("GameCli_framework/src/components/shell/ExitGameDialog.tsx");
const app = read("GameCli_framework/src/app/App.tsx");
const shellCss = read("GameCli_framework/src/styles/shell.css");
const uiSkin = read("shared/cartridge/uiSkin.ts");
const settingsHeader = settings.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? "";
const exitLinkRule = shellCss.match(/\.settings-screen \.settings-exit-link\s*\{([^}]*)\}/)?.[1] ?? "";

assert.doesNotMatch(mainMenu, /data-testid="open-exit-confirmation"/, "title menu must not render an exit action");
assert.match(mainMenu, /if \(skin\.layout_type === "renpy"\)[\s\S]{0,1800}open-exit-confirmation/,
  "the title exit entry must be scoped to the Ren'Py layout only");
assert.doesNotMatch(mainMenu, /<Modal title="退出游戏？"/, "title menu must reuse the shared exit confirmation");
assert.match(mainMenu, /aria-label=\{settingsButtonAriaLabel\}/, "title menu entry must use the resolved options accessible label");
assert.match(mainMenu, /<span className="menu-action-label">\{settingsButtonLabel\}<\/span>/, "title menu entry must use the resolved options label");
assert.match(mainMenu, /resolveTitleButtonLabel\(/, "title menu entry must consume layout-authored label overrides");

assert.match(settings, /data-testid="open-exit-confirmation"/, "options screen must expose the exit action");
assert.match(settings, /className="settings-exit-link"/, "exit action must use the borderless footer-link style");
assert.match(settings, /openExitConfirmation/, "options exit action must open the shared confirmation state");
assert.match(app, /exitConfirmationOpen && <ExitGameDialog \/>/,
  "the shared exit confirmation must be mounted at the Runtime root");
assert.match(exitDialog, /<Modal title="退出游戏？"/, "shared exit component must require confirmation");
assert.match(settings, /<RenpyMenuFrame activeScreen="settings"/, "settings must remain inside the shared menu frame");

assert.doesNotMatch(settingsHeader, /open-exit-confirmation|settings-exit-link|退出游戏/, "options header must not contain the exit action");
assert.match(exitLinkRule, /min-height:\s*32px/, "exit action must remain a compact footer control");
assert.match(exitLinkRule, /border:\s*1px solid color-mix/, "exit action must retain its subdued, bounded control edge");
assert.match(exitLinkRule, /font-size:\s*clamp/, "exit action must be smaller than normal controls");
assert.match(settings, /className="settings-footer-actions"/, "options footer must group exit and reset actions");
assert.match(settings, /data-testid="open-exit-confirmation"[\s\S]{0,220}退出游戏/, "footer exit action must remain discoverable");
assert.match(shellCss, /\.settings-footer-actions[\s\S]{0,500}grid-template-columns:\s*minmax\(0,\s*3fr\)\s+minmax\(0,\s*7fr\)/, "exit/reset footer group must reserve a 3:7 visual ratio");
assert.match(shellCss, /settings-footer-actions[\s\S]{0,700}data-ui-form-factor="handheld"|data-ui-form-factor="handheld"[\s\S]{0,700}settings-footer-actions/, "handheld options layout must adapt the exit/reset group");

const requiredTitle = uiSkin.match(/const requiredByScreen[\s\S]*?\n};/)?.[0] ?? "";
assert.doesNotMatch(requiredTitle, /main_menu_exit_button/, "title layout must no longer require an exit component");
assert.doesNotMatch(uiSkin, /function createDefaultTitleExitButton/, "default title layout must no longer create an exit component");

console.log("settings-exit-placement-contract: PASS");
