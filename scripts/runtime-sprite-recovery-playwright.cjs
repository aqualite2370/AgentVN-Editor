#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "playwright", "runtime-sprite-recovery");
const REPORT = path.join(OUT, "report.json");

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
}

function runSceneIsolation() {
  let lastOutput = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = spawnSync(process.execPath, [path.join(__dirname, "gamecli-scene-sprite-isolation-playwright.cjs")], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) {
      const sceneReportPath = path.join(ROOT, "output", "playwright", "gamecli-scene-sprite-isolation", "report.json");
      return JSON.parse(fs.readFileSync(sceneReportPath, "utf8"));
    }
    lastOutput = `${result.stdout || ""}\n${result.stderr || ""}`;
  }
  throw new Error(`scene sprite isolation failed after retry\n${lastOutput}`);
}

function checkRecoveryContracts() {
  const store = fs.readFileSync(path.join(ROOT, "GameCli_framework", "src", "store", "runtimeStore.ts"), "utf8");
  const story = fs.readFileSync(path.join(ROOT, "GameCli_framework", "src", "components", "player", "StoryPlayer.tsx"), "utf8");
  const layer = fs.readFileSync(path.join(ROOT, "GameCli_framework", "src", "components", "player", "SpriteLayer.tsx"), "utf8");
  assert(store.includes('spritePresentationMode: "settle"'), "runtime store must expose a settled sprite presentation policy");
  assert(/rollback:[\s\S]*?spritePresentationMode: "settle"/.test(store), "rollback must settle sprite presentation");
  assert(/resumeActiveGame[\s\S]*?spritePresentationMode: "settle"/.test(store), "resume must settle sprite presentation");
  assert(/prepared\.save[\s\S]*?spritePresentationMode: "settle"/.test(store), "save restore must settle sprite presentation");
  assert(story.includes('window.addEventListener("pageshow", resetTransientPlayerUi)'), "pageshow must clear transient player UI");
  assert(story.includes('window.addEventListener("agentvn:android-resume", resetTransientPlayerUi)'), "Android resume must clear transient player UI");
  assert(story.includes('document.addEventListener("visibilitychange", handleVisibility)'), "visibility changes must clear transient player UI");
  assert(layer.includes("keyIndexRef"), "SpriteLayer must retain stable per-instance keys");
  assert(layer.includes("presentationMode === \"settle\""), "SpriteLayer must support settled recovery rendering");
  return {
    rollbackSettles: true,
    resumeSettles: true,
    saveRestoreSettles: true,
    transientUiResetEvents: ["pageshow", "agentvn:android-resume", "visibilitychange"],
    stableSpriteKeys: true,
  };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const startedAt = new Date().toISOString();
  const sceneReport = runSceneIsolation();
  const recoveryContracts = checkRecoveryContracts();
  const report = {
    status: "passed",
    startedAt,
    finishedAt: new Date().toISOString(),
    checks: {
      sceneIsolation: sceneReport.assertions?.length ?? 0,
      recoveryContracts,
      noDuplicateSpriteMounts: sceneReport.assertions?.some((item) => item.name === "scene C does not inherit old sprite id") ?? false,
    },
    delegatedReport: path.relative(ROOT, path.join(ROOT, "output", "playwright", "gamecli-scene-sprite-isolation", "report.json")),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`runtime sprite recovery acceptance: PASS (${report.checks.sceneIsolation} scene checks)`);
  console.log(REPORT);
}

try {
  main();
} catch (error) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify({ status: "failed", error: String(error?.stack || error) }, null, 2));
  console.error(error?.stack || error);
  process.exit(1);
}
