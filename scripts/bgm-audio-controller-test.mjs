#!/usr/bin/env node

import assert from "node:assert/strict";

import { BgmAudioController } from "../GameCli_framework/src/components/player/bgmAudioController.ts";

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.loop = false;
    this.paused = true;
    this.currentTime = 0;
    this.volume = 1;
    this.playCount = 0;
    this.pauseCount = 0;
  }

  play() {
    this.paused = false;
    this.playCount += 1;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.pauseCount += 1;
  }
}

class ManualFrames {
  now = 0;
  nextId = 1;
  callbacks = new Map();

  request = (callback) => {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  };

  cancel = (id) => {
    this.callbacks.delete(id);
  };

  advance(ms) {
    this.now += ms;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback(this.now));
  }
}

function createHarness() {
  const frames = new ManualFrames();
  const audios = [];
  const controller = new BgmAudioController({
    createAudio: (url) => {
      const audio = new FakeAudio(url);
      audios.push(audio);
      return audio;
    },
    requestFrame: frames.request,
    cancelFrame: frames.cancel,
    now: () => frames.now,
    onPlayError: (error) => {
      throw error;
    },
  });
  return { frames, audios, controller };
}

{
  const { frames, audios, controller } = createHarness();
  controller.setMasterVolume(0.5);
  controller.play({ url: "theme-a", volume: 0.8, fadeMs: 500 });

  assert.equal(audios.length, 1);
  assert.equal(audios[0].volume, 0, "淡入播放应从静音开始");

  frames.advance(250);
  assert(audios[0].volume > 0 && audios[0].volume < 0.4, "淡入中途应处于目标音量之间");

  frames.advance(250);
  assert(Math.abs(audios[0].volume - 0.4) < 0.001, "淡入结束应达到总音量与事件音量的乘积");
}

{
  const { frames, audios, controller } = createHarness();
  controller.play({ url: "theme-a", volume: 0.6, fadeMs: 0 });
  controller.stop({ fadeMs: 500 });

  frames.advance(250);
  assert.equal(audios[0].paused, false, "淡出过程中音乐不应提前暂停");
  assert(audios[0].volume > 0 && audios[0].volume < 0.6, "淡出中途应保留递减的可听音量");

  frames.advance(250);
  assert.equal(audios[0].paused, true, "淡出完成后应暂停音乐");
  assert.equal(audios[0].currentTime, 0, "淡出完成后应重置播放位置");
  assert.equal(audios[0].volume, 0, "淡出完成后音量应归零");
}

{
  const { audios, controller } = createHarness();
  controller.play({ url: "theme-a", volume: 0.6, fadeMs: 0 });
  controller.stop({ fadeMs: 0 });

  assert.equal(audios[0].paused, true, "立即停止模式应同步暂停音乐");
  assert.equal(audios[0].volume, 0, "立即停止模式应同步归零音量");
}

{
  const { frames, audios, controller } = createHarness();
  controller.play({ url: "theme-a", volume: 0.6, fadeMs: 0 });
  controller.play({ url: "theme-b", volume: 0.8, fadeMs: 500 });

  assert.equal(audios.length, 2, "切换音乐应只同时保留旧曲和新曲两条音轨");
  assert.equal(audios[0].paused, false, "交叉淡化开始时旧曲仍应播放");
  assert.equal(audios[1].volume, 0, "交叉淡化开始时新曲应从静音开始");

  frames.advance(250);
  assert(audios[0].volume > 0 && audios[0].volume < 0.6, "交叉淡化中旧曲应逐渐淡出");
  assert(audios[1].volume > 0 && audios[1].volume < 0.8, "交叉淡化中新曲应逐渐淡入");

  frames.advance(250);
  assert.equal(audios[0].paused, true, "交叉淡化完成后旧曲应被停止");
  assert(Math.abs(audios[1].volume - 0.8) < 0.001, "交叉淡化完成后新曲应达到目标音量");
}

{
  const { frames, audios, controller } = createHarness();
  controller.play({ url: "theme-a", volume: 1, fadeMs: 0 });
  controller.stop({ fadeMs: 500 });
  frames.advance(250);
  controller.play({ url: "theme-b", volume: 1, fadeMs: 500 });

  frames.advance(500);
  assert.equal(audios.length, 2, "打断淡出后不应创建多余音轨");
  assert.equal(audios[0].paused, true, "被打断的旧曲最终必须停止");
  assert.equal(audios[1].paused, false, "新曲必须继续播放");
  assert.equal(audios[1].volume, 1, "新曲淡入完成后必须达到目标音量");
}

{
  const { frames, audios, controller } = createHarness();
  controller.play({ url: "theme-a", volume: 0.8, fadeMs: 500 });
  frames.advance(250);
  controller.setMasterVolume(0.5);
  assert(audios[0].volume > 0 && audios[0].volume < 0.4, "总音量变化应作用于正在淡入的音轨");

  frames.advance(250);
  controller.play({ url: "theme-a", volume: 0.4, fadeMs: 0 });
  assert.equal(audios.length, 1, "重复播放同一首音乐不应重建音频对象");
  assert(Math.abs(audios[0].volume - 0.2) < 0.001, "同曲更新应立即使用新的事件音量和总音量");
}

console.log("[PASS] BGM audio controller");
