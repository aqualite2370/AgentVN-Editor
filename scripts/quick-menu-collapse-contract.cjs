#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const playback = read("GameCli_framework/src/components/player/PlaybackControls.tsx");
const story = read("GameCli_framework/src/components/player/StoryPlayer.tsx");
const dialog = read("GameCli_framework/src/components/player/DialogBox.tsx");
const runtimeCss = read("GameCli_framework/src/styles/quick-menu-contract.css");
const playerCss = read("GameCli_framework/src/styles/player.css");
const mobileCss = read("GameCli_framework/src/styles/mobile.css");
const metrics = read("shared/cartridge/quickMenuMetrics.ts");

assert.match(story, /useState\(false\)/, "quick menu must be collapsed by default");
assert.match(playback, /data-testid="quick-menu-toggle"/, "collapsed menu must expose a stable toggle");
assert.match(playback, /aria-label=\{expanded \? "收起快捷菜单" : "展开快捷菜单"\}/, "toggle must describe both states");
assert.match(playback, /aria-expanded=\{expanded\}/, "toggle must expose aria-expanded");
assert.match(playback, /data-no-advance="true"/, "toggle must not advance the story");
assert.equal((playback.match(/componentId="quick_[^"]+_button"/g) || []).length, 7, "expanded menu must expose seven runtime actions");
assert.match(dialog, /onStoryInteraction\?\.\(\);[\s\S]{0,1200}next\(\);/, "dialog advance paths must notify before advancing");
assert.match(story, /collapseQuickMenu\(\);[\s\S]{0,900}next\(\);/, "stage advance must collapse the menu before next");
assert.doesNotMatch(story, /setTimeout\([\s\S]{0,200}setQuickMenuExpanded/, "quick menu must not use an inactivity timer");

const surface = runtimeCss.match(/\.playback-controls \.quick-menu-surface\s*\{[\s\S]*?\n\}/)?.[0] || "";
assert.match(surface, /clip-path 220ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/, "opening and closing must keep the shared 220ms clip reveal");
assert.match(surface, /opacity 180ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/, "surface must keep the shared opacity feedback");
assert.doesNotMatch(surface, /transition:\s*all|ease-in(?!-out)|transform\s+\d+ms/, "quick menu motion must not animate geometry or use transition: all/ease-in");
assert.match(runtimeCss, /\.quick-menu-button[\s\S]*transform:\s*none !important;/, "quick buttons must keep a stable non-moving transform contract");
assert.doesNotMatch(runtimeCss, /\.quick-menu-button:hover[^{]*\{[\s\S]*transition:\s*all/, "quick buttons must not opt into an all-property hover transition");
assert.match(runtimeCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.quick-menu-surface[\s\S]*transition:\s*opacity 80ms linear;/, "quick menu must provide a paint-only reduced-motion path");
assert.match(metrics, /const baseToggleHitSize = mobile[\s\S]{0,140}mobileToggleHitSize[\s\S]{0,80}desktopToggleHitSize/, "shared metrics must own mobile and desktop toggle hit sizes");
assert.match(metrics, /const baseActionHitSize = QUICK_MENU_DEFAULT_METRICS\.actionHitSize/, "shared metrics must keep 48px action hit targets");
assert.doesNotMatch(playerCss, /quick-menu|\.playback-controls/, "player.css must not retain a second quick-menu owner");
assert.doesNotMatch(mobileCss, /quick-menu|\.playback-controls/, "mobile.css must not retain quick-menu overrides");

console.log("quick-menu-collapse-contract: PASS");
