#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const playback = fs.readFileSync(path.join(root, "GameCli_framework/src/components/player/PlaybackControls.tsx"), "utf8");

assert.match(playback, /displayLabel\??:\s*string/, "quick buttons must separate visible short labels from accessible labels");
assert.match(playback, /aria-label=\{label\}/, "full quick-button state must remain in aria-label");
assert.match(playback, /title=\{title\}/, "full quick-button state must remain in title");
for (const label of ["回退", "自动", "快进", "存档", "历史", "隐藏", "菜单"]) {
  assert.match(playback, new RegExp(`displayLabel="\\${label}"|displayLabel=\\{[^}]*\\?\\s*"\\${label}"`), `visible quick-menu label ${label} is missing`);
}
assert.match(playback, /displayLabel=\{?["']?自动/, "auto state must keep a stable two-character visible label");
assert.match(playback, /displayLabel=\{?["']?快进/, "skip state must keep a stable two-character visible label");
assert.match(playback, /label=\{autoLabel\}/, "auto full state label must remain dynamic");
assert.match(playback, /label=\{skipLabel\}/, "skip full state label must remain dynamic");
assert.match(playback, /label=\{galleryReplayActive \? "画廊回放中不可存档" : "打开存档读档"\}/, "save full state label must remain descriptive");
assert.match(playback, /label=\{galleryReplayActive \? "返回画廊" : "打开主菜单"\}/, "menu full state label must remain descriptive");

console.log("quick-menu-button-label-contract: PASS");
