#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const settings = fs.readFileSync(path.join(root, "GameCli_framework/src/components/shell/SettingsScreen.tsx"), "utf8");
const displayMode = fs.readFileSync(path.join(root, "GameCli_framework/src/engine/displayMode.ts"), "utf8");
const player = fs.readFileSync(path.join(root, "GameCli_framework/src/components/player/PlaybackControls.tsx"), "utf8");
const storyPlayer = fs.readFileSync(path.join(root, "GameCli_framework/src/components/player/StoryPlayer.tsx"), "utf8");
const preferences = fs.readFileSync(path.join(root, "GameCli_framework/src/store/runtimePreferences.ts"), "utf8");
if (/显示模式|全屏独占|Fullscreen|Maximize2/.test(settings)) throw new Error("settings screen still exposes a display-mode/fullscreen control");
if (/语音优先|语音延续|菜单中继续语音/.test(settings)) throw new Error("removed voice settings are still visible");
if (/桌面侧边回退|移动端侧边回退|Desktop rollback side|Mobile rollback side/.test(settings)) throw new Error("settings screen still exposes side rollback controls");
if (/rollbackSideDesktop|rollbackSideMobile/.test(storyPlayer)) throw new Error("story player still implements configurable side rollback behavior");
if (!/delete source\.rollbackSideDesktop/.test(preferences) || !/delete source\.rollbackSideMobile/.test(preferences)) {
  throw new Error("settings migration does not discard legacy side rollback preferences");
}
if (/applyFullscreen|requestFullscreen|setFullscreen/.test(displayMode + player)) throw new Error("runtime still exposes dynamic fullscreen switching");
console.log("settings-display-mode-contract: PASS");
