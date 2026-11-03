#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  DEFAULT_BGM_FADE_MS,
  normalizeBgmCommandFields,
} from "../shared/cartridge/bgmTransition.ts";

assert.deepEqual(
  normalizeBgmCommandFields({ action: "fade" }),
  { action: "stop", fade_ms: DEFAULT_BGM_FADE_MS },
  "旧 fade 动作应转换为默认 500ms 淡出的停止动作",
);

assert.deepEqual(
  normalizeBgmCommandFields({ action: "fade", fade_ms: 1200 }),
  { action: "stop", fade_ms: 1200 },
  "旧 fade 动作应保留有效的自定义淡出时长",
);

assert.deepEqual(
  normalizeBgmCommandFields({ action: "play", fade_ms: 1400 }),
  { action: "play", fade_ms: 1400 },
  "播放动作的正数 fade_ms 应表示淡入",
);

assert.deepEqual(
  normalizeBgmCommandFields({ action: "stop" }),
  { action: "stop", fade_ms: 0 },
  "缺少 fade_ms 的停止动作应保持立即停止",
);

console.log("[PASS] BGM command normalization");
