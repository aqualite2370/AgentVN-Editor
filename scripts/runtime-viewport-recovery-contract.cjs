#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const viewport = fs.readFileSync(path.join(root, "GameCli_framework/src/uiSkin/runtimeViewport.ts"), "utf8");
const math = fs.readFileSync(path.join(root, "GameCli_framework/src/uiSkin/runtimeViewportMath.mjs"), "utf8");
const playerCss = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/player.css"), "utf8");

assert.match(math, /isUsableViewportSize/, "viewport math must classify transient tiny measurements");
assert.match(math, /measuredSize[\s\S]{0,500}isUsableViewportSize/, "desktop viewport must reject transient tiny measurements");
assert.match(viewport, /measuredSizeRef/, "runtime viewport must retain a measurement cache");
assert.match(viewport, /isUsableViewportSize|lastValid|previous/, "viewport recovery must preserve a valid previous size");
assert.match(viewport, /agentvn:android-resume/, "runtime must schedule recovery after Android resume");
assert.match(viewport, /requestAnimationFrame[\s\S]{0,500}setTimeout/, "recovery must remeasure across frames and delayed layout settlement");
assert.match(playerCss, /\.runtime-layout-frame[\s\S]{0,220}min-width:\s*0/, "runtime frame must keep a zero-width-safe flex/grid constraint");
assert.match(playerCss, /\.runtime-layout-frame[\s\S]{0,220}min-height:\s*0/, "runtime frame must keep a zero-height-safe flex/grid constraint");

console.log("runtime-viewport-recovery-contract: PASS");
