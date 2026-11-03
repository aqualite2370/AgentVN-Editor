#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const navigator = fs.readFileSync(
  path.join(root, "GameCli_framework/src/app/RuntimeScreenNavigator.tsx"),
  "utf8",
);
const menuFrame = fs.readFileSync(
  path.join(root, "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx"),
  "utf8",
);
const menuNavigation = fs.readFileSync(
  path.join(root, "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx"),
  "utf8",
);
const shell = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/shell.css"), "utf8");
const app = fs.readFileSync(path.join(root, "GameCli_framework/src/app/App.tsx"), "utf8");
const appCss = fs.readFileSync(path.join(root, "GameCli_framework/src/app/App.css"), "utf8");

assert.match(navigator, /data-runtime-screen-transition=/, "runtime navigator must expose its transition state");
assert.match(navigator, /data-runtime-transition-phase=/, "runtime navigator must expose loading/covering/swap/revealing phases");
assert.match(navigator, /data-runtime-presented-screen=/, "runtime navigator must expose the currently presented page");
assert.match(navigator, /pendingScreenNavigation\?\.id === pending\.id/, "stale page loads must not commit over a newer request");
assert.match(navigator, /generationRef\.current/, "navigation effects must invalidate stale async responses");
assert.match(navigator, /RUNTIME_BLACKOUT_COVER_DURATION_MS/, "normal navigation must reuse the established blackout cover timing");
assert.match(navigator, /RUNTIME_BLACKOUT_REVEAL_DURATION_MS/, "normal navigation must reuse the established blackout reveal timing");
assert.match(navigator, /RUNTIME_BLACKOUT_REDUCED_DURATION_MS/, "reduced-motion navigation must retain a gentle opacity-only blackout");
assert.match(navigator, /requestAnimationFrame/, "screen content must be committed behind the fully opaque cover");
assert.match(navigator, /setPhase\(style === "crossfade" \? "crossfade-swap" : "covering"\)/,
  "ready changes must choose Renpy non-gameplay crossfade or established black cover");
assert.match(navigator, /from !== "playing" && pending\.toScreen !== "playing"/,
  "Renpy crossfade must not replace gameplay boundary blackout");
assert.match(navigator, /duration, easing:/, "crossfade must reuse full blackout duration");
assert.match(navigator, /entering\.finished, leaving\.finished/,
  "crossfade must end on actual animation completion");
assert.match(navigator, /getAnimations\(\{ subtree: true \}\)/,
  "curtain completion must include the actual pseudo-element animation");
assert.match(navigator, /animation\.effect\.pseudoElement === "::before"/,
  "descendant opacity effects must not own curtain completion");
assert.match(navigator, /transitions\.map\(animation => animation\.finished\)/,
  "cover and reveal must wait for real visual completion");
assert.doesNotMatch(navigator, /startedAt|coverDuration - elapsed/,
  "nominal JS elapsed time must not advance the curtain before its CSS transition finishes");
assert.match(navigator, /setPresented\(/, "the requested page must be presented at the black peak");
assert.match(menuFrame, /<RenpyMenuNavigation/, "menu navigation must remain mounted alongside changing content");
assert.match(menuNavigation, /data-testid="renpy-menu-navigation"/, "navigation must expose a stable real-browser test seam");
assert.match(menuNavigation, /activeScreen === action\.screen \? "page"/, "navigation must report the active page without changing its geometry");
assert.match(shell, /\.runtime-screen-transition::before\s*\{[\s\S]*content:\s*["']["']/, "the runtime page seam must render its global blackout layer");
assert.match(shell, /\.runtime-screen-transition::before[\s\S]*background:\s*#000/, "the global page-transition layer must be black");
assert.match(shell, /\.runtime-screen-transition-layer\s*\{[\s\S]*opacity:\s*1/, "the current page layer must not fade to a blank frame");
assert.match(shell, /\.runtime-screen-transition\.is-active\.is-covering::before[\s\S]*opacity:\s*1/, "cover phase must reach an opaque black peak");
assert.match(shell, /\.runtime-screen-transition\.is-active\.is-swap::before[\s\S]*opacity:\s*1/, "page content must swap while the cover stays opaque");
assert.match(shell, /\.runtime-screen-transition\.is-active\.is-revealing::before[\s\S]*opacity:\s*0/, "reveal phase must uncover the requested page");
assert.match(shell, /@media \(prefers-reduced-motion: reduce\)/, "runtime shell must retain an explicit reduced-motion path");
assert.match(navigator, /正在加载页面/, "async page loading must provide visible status feedback");
assert.match(navigator, /重试/, "page-load failures must offer retry");
assert.match(navigator, /留在当前页面/, "page-load failures must allow staying on the current page");

assert.match(app, /data-testid="game-launch-blackout"/, "entering or returning to gameplay must retain its separate blackout layer");
assert.match(app, /completeLaunchCover\(\)/, "gameplay blackout must complete only through the launch flow");
assert.match(app, /completeLaunchReveal\(\)/, "gameplay reveal must complete only through the launch flow");
assert.match(appCss, /\.game-launch-blackout[\s\S]*transition:\s*opacity/, "gameplay launch/return must retain a dedicated opacity transition");

console.log("runtime-screen-transition-contract: PASS");
