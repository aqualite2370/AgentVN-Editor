#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const store = read("GameCli_framework/src/store/runtimeStore.ts");
const app = read("GameCli_framework/src/app/App.tsx");
const css = read("GameCli_framework/src/app/App.css");
const menu = read("GameCli_framework/src/components/shell/MainMenu.tsx");
const saves = read("GameCli_framework/src/components/shell/SaveLoadScreen.tsx");
const loader = read("GameCli_framework/src/engine/progressiveAssetLoader.ts");

for (const kind of ["new_game", "resume_active", "continue_latest", "load_slot"]) {
  assert(store.includes(`"${kind}"`), `game-entry coordinator must support ${kind}`);
}
for (const phase of ["arming", "covering", "preparing", "revealing"]) {
  assert(store.includes(`"${phase}"`), `game-entry coordinator must support ${phase}`);
}
assert(store.includes("launchTransitionId"), "game-entry requests must be guarded by a monotonic id");
assert(store.includes("beginLaunchCover"), "the blackout must mount before its cover transition starts");
assert(store.includes("completeLaunchCover"), "engine state must commit only after the blackout is opaque");
assert(store.includes("completeLaunchReveal"), "the blackout must have an explicit reveal completion");
assert(store.includes("validateSaveData"), "loads must validate save structure before restore");
assert(store.includes("saveCompatibilityError"), "loads must validate game, scene, and command compatibility");
assert(loader.includes("async prepareScene("), "asset loader must prepare arbitrary target scenes");
assert(app.includes("onTransitionEnd={handleLaunchTransitionEnd}"), "overlay transition events must drive the coordinator");
assert(app.includes("launchTransitionDurationMs + 80"), "lost transition events must have a reliable completion fallback");
assert(app.includes("}, 800)"), "loading feedback must stay hidden through the doubled cover transition");
assert(app.includes('phase === "covering" || phase === "preparing"'), "fast entries must not flash delayed loading feedback during reveal");
assert(css.includes("transition: opacity var(--game-launch-duration, 748ms) var(--ease-out)"), "blackout must use the doubled opacity transition");
assert(css.includes(".game-launch-blackout.is-revealing"), "blackout must expose the reveal state");
assert(css.includes("transition-duration: 408ms !important"), "reduced motion must use the doubled opacity crossfade");
assert(store.includes('"preview_scene"'), "scene preview must use the shared blackout coordinator");
assert(store.includes('"preview_start"'), "start preview must use the shared blackout coordinator");
assert(store.includes("state.startNewGame()"), "runtime screen requests for playing must use a shared launch");
assert(!css.includes("@keyframes game-launch-cover"), "legacy launch keyframes must be removed");
assert(!read("GameCli_framework/src/styles/player.css").includes("game-entry-fade"), "the duplicate player entrance animation must be removed");
assert(menu.includes("resumeActiveGame"), "in-game Continue must use the shared transition");
assert(menu.includes('launchTransition !== "idle"'), "menu entry actions must reject double activation");
assert(menu.includes("aria-busy"), "menu entry actions must expose their busy state");
assert(saves.includes('launchTransition !== "idle"'), "save/load actions must reject double activation");
assert(saves.includes("aria-busy"), "save/load actions must expose their busy state");

console.log("game entry transition contract OK");
