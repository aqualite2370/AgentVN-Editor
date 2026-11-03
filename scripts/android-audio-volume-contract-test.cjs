"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const coldBoot = fs.readFileSync(path.join(__dirname, "android-cold-boot.ps1"), "utf8");
const start = fs.readFileSync(path.join(__dirname, "start-android-acceptance.ps1"), "utf8");

assert.match(coldBoot, /Set-AndroidAcceptanceMediaVolume/, "cold boot must expose an explicit media-volume probe");
assert.match(coldBoot, /'cmd','media_session','volume'/, "media volume must use Android media_session, not microphone capture");
assert.match(coldBoot, /STREAM_MUSIC|stream.*3/i, "media-volume command must target STREAM_MUSIC");
assert.match(coldBoot, /audioVolumeBefore|mediaVolumeBefore/, "pre-change media volume must be recorded");
assert.match(coldBoot, /audioVolumeAfter|mediaVolumeAfter/, "post-change media volume must be recorded");
assert.match(start, /Start-AndroidAcceptanceBoot/, "administrator acceptance entry must invoke the cold boot path");
assert.match(coldBoot, /audioEnabled\s*=\s*\$true/, "audio must remain enabled");

console.log("android-audio-volume-contract: PASS");
