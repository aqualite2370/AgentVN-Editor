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

const audio = read("GameCli_framework/src/components/player/RuntimeAudio.tsx");
const bgmController = read("GameCli_framework/src/components/player/bgmAudioController.ts");
const animation = read("GameCli_framework/src/components/player/runtimeAnimation.ts");

assert(audio.includes("sfxVolumeRef") && audio.includes("}, [sfxEvent?.id]);"), "SFX playback is keyed only by sfxEvent.id");
assert(audio.includes("voiceVolumeRef") && audio.includes("}, [dialog?.text_key, dialog?.voice, dialogRestored]);")
  && audio.includes("if (dialogRestored)"), "Voice playback uses dialog identity and blocks save/rollback replay");
assert(audio.includes("BgmAudioController") && audio.includes("normalizeBgmCommandFields"), "RuntimeAudio routes canonical BGM commands through the fade controller");
assert(audio.includes('recordRuntimeAudio({ phase: "play-request", kind: "bgm"'), "RuntimeAudio records observable BGM playback requests for device acceptance");
assert(bgmController.includes("kind: \"crossfade\"") && bgmController.includes("cancelTransition()"), "BGM controller supports interruptible crossfades");
assert(bgmController.includes("this.current?.url === options.url"), "Existing BGM is not recreated when the URL is unchanged");
assert(animation.includes("runtimePlaybackKey") && animation.includes("startedPlaybackKeyRef"), "Runtime animations keep a stable playback dedupe key");
assert(animation.includes("effect.playback_id?.trim()"), "Runtime animations can use an explicit semantic playback id");
assert(animation.includes("animation_id: effect.animation_id") && animation.includes("params: stableJsonValue(effect.params)"), "Runtime animation fallback playback key is semantic, not effect-id based");
assert(!animation.includes("effect.effect_id}:$" + "{effect.target}"), "Runtime animation playback key must not depend on fresh effect_id values");
assert(animation.includes("startedRuntimePlaybackKeyExpiry") && animation.includes("hasStartedRuntimePlaybackKey(playbackKey)"), "Runtime animation duplicate memory expires after a short replay guard window");
assert(animation.includes("startedPlaybackKeyRef.current === playbackKey") && animation.includes("animationRef.current === animation"), "Runtime animation cleanup only clears its own animation");

if (process.exitCode) process.exit(process.exitCode);
