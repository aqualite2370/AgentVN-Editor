#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

function requireJsZip() {
  for (const candidate of ["../editor/node_modules/jszip", "../GameCli_framework/node_modules/jszip", "jszip"]) {
    try {
      return require(candidate);
    } catch {
      // Try the next workspace dependency location.
    }
  }
  throw new Error("Unable to load jszip from the workspace.");
}

const JSZip = requireJsZip();
const root = path.resolve(__dirname, "..");
const defaultSample = "C:\\Users\\1\\Downloads\\水の神殿.flac";
const samplePath = path.resolve(process.env.AGENTVN_FLAC_SAMPLE || process.argv[2] || defaultSample);
const outputPath = path.join(root, "output", "test-fixtures", "flac-opening-audio.vncart");

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(fs.existsSync(samplePath), `FLAC sample does not exist: ${samplePath}`);
  const audio = fs.readFileSync(samplePath);
  assert(audio.subarray(0, 4).toString("ascii") === "fLaC", "The sample does not have a native FLAC stream header.");

  const audioHash = sha256(audio);
  const assetPath = "assets/bgm/opening_flac.flac";
  const now = new Date().toISOString();
  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "0.5.0",
    game_id: "flac_opening_audio_acceptance",
    title: "FLAC Opening Audio Acceptance",
    author: "AgentVN",
    description: "Generated from a real FLAC opening-audio sample.",
    version: "0.1.0",
    language: "zh-CN",
    tags: ["test", "flac", "opening-audio"],
    entry_script: "script.json",
    entry_scene_id: "scene_start",
    assets: [{
      asset_id: "opening_flac",
      asset_type: "bgm",
      path: assetPath,
      filename: path.basename(samplePath),
      mime_type: "audio/flac",
      size_bytes: audio.byteLength,
      hash_sha256: audioHash,
      preload: false,
      tags: ["test", "opening_audio"],
    }],
    created_at: now,
    updated_at: now,
  };
  const script = {
    schema_version: "1.4.0",
    game_id: manifest.game_id,
    title: manifest.title,
    entry_scene_id: "scene_start",
    loading_animation: { kind: "default" },
    opening_audio: [{ asset_id: "opening_flac", asset_type: "bgm", playback: "loop" }],
    scenes: [{
      scene_id: "scene_start",
      title: "Start",
      summary: "FLAC opening audio acceptance scene.",
      chapter: 1,
      tags: ["test"],
      commands: [{ type: "narration", text: "FLAC opening audio acceptance." }],
      is_ending: true,
      ending_id: "ending_sample",
    }],
  };
  const files = new Map([
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2))],
    ["script.json", Buffer.from(JSON.stringify(script, null, 2))],
    ["gallery.json", Buffer.from(JSON.stringify({ gallery_version: "1.0.0", items: [] }, null, 2))],
    [assetPath, audio],
  ]);
  const zip = new JSZip();
  const checksumFiles = [];
  for (const [filePath, data] of files) {
    zip.file(filePath, data, { compression: "STORE" });
    checksumFiles.push({ path: filePath, size_bytes: data.byteLength, hash_sha256: sha256(data) });
  }
  zip.file("checksum.json", JSON.stringify({
    checksum_version: "1.0.0",
    algorithm: "sha256",
    generated_at: now,
    files: checksumFiles.sort((a, b) => a.path.localeCompare(b.path)),
  }, null, 2), { compression: "STORE" });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }));

  const verification = spawnSync(process.execPath, [path.join(root, "scripts", "verify-vncart.cjs"), outputPath], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (verification.status !== 0) {
    throw new Error(`verify-vncart failed:\n${verification.stdout}\n${verification.stderr}`);
  }

  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "audio/flac",
      "Content-Length": audio.byteLength,
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(samplePath).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const media = await page.evaluate((url) => new Promise((resolve) => {
      const element = document.createElement("audio");
      const timeout = window.setTimeout(() => resolve({
        error: "metadata-timeout",
        canPlay: element.canPlayType("audio/flac"),
        readyState: element.readyState,
      }), 30_000);
      element.preload = "metadata";
      element.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve({
          canPlay: element.canPlayType("audio/flac"),
          readyState: element.readyState,
          duration: element.duration,
        });
      };
      element.onerror = () => {
        window.clearTimeout(timeout);
        resolve({
          error: "media-error",
          canPlay: element.canPlayType("audio/flac"),
          readyState: element.readyState,
          code: element.error?.code,
        });
      };
      element.src = url;
      element.load();
    }), `http://127.0.0.1:${port}/opening.flac`);
    assert(!media.error, `Browser FLAC metadata probe failed: ${JSON.stringify(media)}`);
    assert(media.canPlay === "probably" || media.canPlay === "maybe", `Browser rejected audio/flac: ${JSON.stringify(media)}`);
    assert(media.readyState >= 1 && Number.isFinite(media.duration) && media.duration > 0, `Browser did not load FLAC metadata: ${JSON.stringify(media)}`);
    console.log(`Browser canPlayType(audio/flac): ${media.canPlay}`);
    console.log(`Browser loadedmetadata duration: ${media.duration.toFixed(3)}s`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`FLAC sample: ${samplePath}`);
  console.log(`Bytes: ${audio.byteLength}`);
  console.log(`MIME: ${manifest.assets[0].mime_type}`);
  console.log(`Cartridge: ${outputPath}`);
  console.log("FLAC opening-audio acceptance: PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
