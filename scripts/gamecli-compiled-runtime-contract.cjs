#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const distRoot = path.join(root, "GameCli_framework", "dist");
const playerExe = process.env.AGENTVN_TEST_PLAYER_EXE
  || path.join(root, "editor", "src-tauri", "binaries", "agentvn-player.exe");
const indexHtml = fs.readFileSync(path.join(distRoot, "index.html"), "utf8");
const assetPaths = [...indexHtml.matchAll(/(?:src|href)="\.?\/?([^"]+)"/g)]
  .map((match) => match[1])
  .filter((assetPath) => assetPath.startsWith("assets/"));

assert.ok(assetPaths.length > 0, "GameCLI dist index does not reference any built assets.");
assert.ok(fs.existsSync(playerExe), `Compiled preview player is missing: ${playerExe}`);

const distScripts = fs.readdirSync(path.join(distRoot, "assets"))
  .filter((fileName) => fileName.endsWith(".js"))
  .map((fileName) => ({
    fileName,
    content: fs.readFileSync(path.join(distRoot, "assets", fileName), "utf8"),
  }));
const rollbackChunk = distScripts.find(({ content }) => (
  content.includes("滚轮上滑 / PageUp")
  && content.includes("canRollback")
));
assert.ok(rollbackChunk, "Current GameCLI web build does not contain rollback controls.");

const executableText = fs.readFileSync(playerExe).toString("latin1");
for (const assetPath of assetPaths) {
  assert.ok(
    executableText.includes(assetPath),
    `Compiled preview player does not embed the current web asset: ${assetPath}`,
  );
}
assert.ok(
  executableText.includes(`assets/${rollbackChunk.fileName}`),
  `Compiled preview player does not embed the rollback UI chunk: ${rollbackChunk.fileName}`,
);

console.log(`PASS compiled GameCLI embeds current rollback runtime (${rollbackChunk.fileName})`);
