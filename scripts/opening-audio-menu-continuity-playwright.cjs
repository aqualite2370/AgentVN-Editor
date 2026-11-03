#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "opening-audio-menu-continuity");
const cartridgePath = path.join(outputDir, "opening-audio-menu-continuity.vncart");
const baseUrl = "http://127.0.0.1:6868/";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function monoWav(seconds = 2, sampleRate = 8000) {
  const samples = Math.max(1, Math.floor(seconds * sampleRate));
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin(index / sampleRate * Math.PI * 2 * 220) * 1800);
    pcm.writeInt16LE(value, index * 2);
  }
  const out = Buffer.alloc(44 + pcm.length);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + pcm.length, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out;
}

async function buildCartridge() {
  const now = new Date().toISOString();
  const audio = monoWav();
  const assetPath = "assets/bgm/title-loop.wav";
  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "0.6.0",
    game_id: "opening-audio-menu-continuity",
    title: "主页音乐连续性",
    author: "AgentVN QA",
    version: "1.0.0",
    description: "主页进入选项与关于时音乐不能中断。",
    language: "zh-CN",
    entry_script: "script.json",
    entry_scene_id: "scene_main",
    assets: [{
      asset_id: "title_loop",
      asset_type: "bgm",
      path: assetPath,
      filename: "title-loop.wav",
      mime_type: "audio/wav",
      size_bytes: audio.length,
      hash_sha256: sha256(audio),
      preload: true,
      tags: ["opening_audio"],
    }],
    created_at: now,
    updated_at: now,
  };
  const script = {
    schema_version: "1.5.0",
    game_id: manifest.game_id,
    title: manifest.title,
    entry_scene_id: "scene_main",
    loading_animation: { kind: "default" },
    opening_audio: [{ asset_id: "title_loop", asset_type: "bgm", playback: "loop" }],
    scenes: [{
      scene_id: "scene_main",
      title: "Main",
      chapter: 1,
      tags: [],
      commands: [{ type: "narration", text: "音乐连续性测试。" }],
    }],
  };
  const gallery = { gallery_version: "1.0.0", items: [] };
  const entries = new Map([
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2))],
    ["script.json", Buffer.from(JSON.stringify(script, null, 2))],
    ["gallery.json", Buffer.from(JSON.stringify(gallery, null, 2))],
    [assetPath, audio],
  ]);
  const checksum = {
    checksum_version: "1.0.0",
    algorithm: "sha256",
    generated_at: now,
    files: [...entries].map(([filePath, data]) => ({
      path: filePath,
      size_bytes: data.length,
      hash_sha256: sha256(data),
    })).sort((left, right) => left.path.localeCompare(right.path)),
  };
  const zip = new JSZip();
  for (const [filePath, data] of entries) zip.file(filePath, data, { compression: "STORE" });
  zip.file("checksum.json", JSON.stringify(checksum, null, 2), { compression: "STORE" });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(cartridgePath, await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI Vite server did not become ready.");
}

function stop(child) {
  if (!child?.pid) return;
  try {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {}
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const staleError = path.join(outputDir, "error.txt");
  if (fs.existsSync(staleError)) fs.unlinkSync(staleError);
  await buildCartridge();

  const vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], {
    cwd: runtimeRoot,
    windowsHide: true,
    stdio: "ignore",
  });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1040, height: 559 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => errors.push(`requestfailed ${request.url()} ${request.failure()?.errorText ?? ""}`));
    await page.route("**/runtime-mode.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "library" }),
    }));
    await page.route("**/fixed-only.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fixedOnly: false }),
    }));
    await page.addInitScript(() => {
      localStorage.removeItem("agentvn.gamecli.webLibrary");
      const records = [];
      class FakeAudio {
        constructor(src = "") {
          this.src = src;
          this.currentSrc = src;
          this.loop = false;
          this.preload = "auto";
          this.paused = true;
          this.volume = 1;
          this.playCount = 0;
          this.pauseCount = 0;
          this._currentTime = 0;
          this._startedAt = 0;
          this.readyState = 4;
          this.networkState = 1;
          this.duration = 120;
          this.error = null;
          this.ended = false;
          records.push(this);
        }
        get currentTime() {
          return this.paused || !this._startedAt
            ? this._currentTime
            : this._currentTime + (performance.now() - this._startedAt) / 1000;
        }
        set currentTime(value) {
          this._currentTime = Number(value) || 0;
          this._startedAt = this.paused ? 0 : performance.now();
        }
        play() {
          if (this.paused) {
            this.paused = false;
            this._startedAt = performance.now();
          }
          this.playCount += 1;
          this.onplaying?.();
          return Promise.resolve();
        }
        pause() {
          if (!this.paused) this._currentTime = this.currentTime;
          this.paused = true;
          this._startedAt = 0;
          this.pauseCount += 1;
        }
        addEventListener() {}
        removeEventListener() {}
      }
      Object.defineProperty(window, "Audio", { configurable: true, value: FakeAudio });
      window.__AGENTVN_OPENING_AUDIO_RECORDS__ = records;
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="web-cartridge-file"]').waitFor({ state: "attached", timeout: 30_000 });
    await page.locator('[data-testid="web-cartridge-file"]').setInputFiles(cartridgePath);
    await page.locator(".cartridge-spine").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.locator(".launch-actions button").first().click();
    await page.getByTestId("game-state-title").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => {
      const records = window.__AGENTVN_OPENING_AUDIO_RECORDS__ ?? [];
      return records.length === 1 && records[0].paused === false && records[0].playCount === 1;
    }, undefined, { timeout: 30_000 });
    await page.waitForTimeout(300);

    const snapshot = () => page.evaluate(() => {
      const records = window.__AGENTVN_OPENING_AUDIO_RECORDS__ ?? [];
      return records.map((audio) => ({
        src: audio.src,
        paused: audio.paused,
        playCount: audio.playCount,
        pauseCount: audio.pauseCount,
        currentTime: audio.currentTime,
      }));
    });
    const before = await snapshot();

    await page.getByTestId("open-settings").click();
    await page.getByTestId("settings-screen").waitFor({ state: "visible", timeout: 30_000 });
    const inSettings = await snapshot();
    await page.getByTestId("back-to-main-menu").click();
    await page.getByTestId("game-state-title").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("open-about").click();
    await page.getByTestId("about-screen").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(300);
    const after = await snapshot();

    assert(inSettings.length === 1 && after.length === 1, "Shell navigation recreated the opening-audio element.", { before, inSettings, after });
    assert(inSettings[0].paused === false && after[0].paused === false, "Entering Options/About paused the title music.", { before, inSettings, after });
    assert(inSettings[0].playCount === 1 && after[0].playCount === 1, "Shell navigation restarted the title music.", { before, inSettings, after });
    assert(inSettings[0].pauseCount === 0 && after[0].pauseCount === 0, "Shell navigation disposed the title music.", { before, inSettings, after });
    assert(after[0].currentTime > before[0].currentTime + 0.25, "Title music playhead did not advance continuously.", { before, inSettings, after });
    assert(errors.length === 0, "Browser errors occurred during title-music continuity test.", errors);

    await page.screenshot({ path: path.join(outputDir, "about-with-continuous-title-music.png") });
    fs.writeFileSync(path.join(outputDir, "result.json"), JSON.stringify({ ok: true, before, inSettings, after }, null, 2));
    console.log(`opening-audio-menu-continuity-playwright: PASS (${outputDir})`);
  } finally {
    await browser?.close().catch(() => {});
    stop(vite);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error));
  console.error(error.stack || error);
  process.exitCode = 1;
});
