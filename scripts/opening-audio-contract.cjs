#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[PASS] ${message}`);
}

const sharedTypes = read("shared/cartridge/types.ts");
const capabilities = read("shared/cartridge/runtimeCapabilities.ts");
const editorExport = read("editor/src/utils/exportScript.ts");
const editorQueue = read("editor/src/utils/openingAudio.ts");
const editorOpening = read("editor/src/components/common/OpeningAnimationEditor.tsx");
const scanner = read("shared/cartridge/assetScanner.ts");
const runtimeAudio = read("GameCli_framework/src/components/common/OpeningAudioPlayer.tsx");
const runtimeApp = read("GameCli_framework/src/app/App.tsx");
const releaseMime = read("scripts/build-release-runtime-assets.cjs");
const flacAcceptance = read("scripts/flac-opening-audio-acceptance.cjs");

assert(sharedTypes.includes("interface OpeningAudioTrack"), "Runtime contract defines OpeningAudioTrack");
assert(sharedTypes.includes("opening_audio?: OpeningAudioTrack[]"), "Runtime script exposes opening_audio");
assert(capabilities.includes("OPENING_AUDIO_RUNTIME_VERSION = \"0.5.0\""), "Opening audio has a runtime capability version");
assert(capabilities.includes("OPENING_AUDIO_SCRIPT_SCHEMA_VERSION = \"1.4.0\""), "Opening audio has a script schema version");
assert(editorExport.includes("normalizeOpeningAudioTracks") && editorExport.includes("opening_audio:"), "Editor export normalizes and emits opening audio");
assert(editorQueue.includes("return [...tracks.filter") && editorQueue.includes("playback: \"once\""), "Queue normalization keeps loop tracks at the end");
assert(editorOpening.includes("image_sequence") && editorOpening.includes("importVideo"), "Shared opening animation editor supports video and image sequences");
assert(scanner.includes("opening_audio.") && scanner.includes("audio/flac"), "Asset scanning includes opening audio and FLAC MIME inference");
assert(releaseMime.includes('case ".flac": return "audio/flac";'), "Release MIME inference preserves FLAC");
assert(flacAcceptance.includes("canPlayType") && flacAcceptance.includes("loadedmetadata"), "Real FLAC acceptance probes browser media support");
assert(runtimeAudio.includes("audio.loop = track.playback === \"loop\""), "Runtime honors per-track loop mode");
assert(runtimeAudio.includes("normalizeOpeningTracks"), "Runtime normalizes malformed opening audio queues");
assert(runtimeAudio.includes("audio.onended") && runtimeAudio.includes("playAt(index + 1)"), "Runtime advances once tracks on ended");
assert(runtimeAudio.includes("window.addEventListener(\"pointerdown\""), "Runtime retries autoplay after user interaction");
assert(runtimeApp.includes("<OpeningAudioPlayer") && runtimeApp.includes("inStory={screen === \"playing\"}"), "App-level startup audio stops in story playback");
assert(runtimeApp.includes("boot-card-line-only") && runtimeApp.includes("<BootCircleLoader />"), "Client boot path uses the line loader-only overlay");

if (process.exitCode) process.exit(process.exitCode);
