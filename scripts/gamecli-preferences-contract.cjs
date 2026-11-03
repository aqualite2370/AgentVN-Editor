#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../GameCli_framework/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import {
    autoForwardDelayMs,
    migrateRuntimeSettings,
    runtimeSettingsKey,
  } from "./GameCli_framework/src/store/runtimePreferences";
  import {
    minimumRuntimeVersionForScript,
    runtimeScriptSchemaVersion,
  } from "./shared/cartridge/runtimeCapabilities";

  const migrated = migrateRuntimeSettings({
    schemaVersion: 7,
    textSpeed: 52,
    autoSpeed: 1200,
    skipUnread: true,
    volumeBgm: 0.4,
    titleBackgroundDimmingOverride: 0.7,
    settingsPanelBackgroundDimmingOverride: 0.6,
    rollbackSideDesktop: true,
    rollbackSideMobile: true,
  } as any);
  if (migrated.schemaVersion !== 8) throw new Error("settings schema must migrate to 8");
  if (migrated.textSpeedCps !== 52 || migrated.textSpeed !== 52) throw new Error("legacy text speed must migrate");
  if (migrated.autoForwardTime !== 6) throw new Error("legacy auto delay must map to six seconds per 250 characters");
  if (!migrated.skipUnread || migrated.volumeBgm !== 0.4) throw new Error("legacy preferences must be preserved");
  for (const retired of ["titleBackgroundDimmingOverride", "settingsPanelBackgroundDimmingOverride", "rollbackSideDesktop", "rollbackSideMobile"]) {
    if (retired in migrated) throw new Error("retired preference survived migration: " + retired);
  }
  if (runtimeSettingsKey("game-a") === runtimeSettingsKey("game-b")) throw new Error("preferences must be isolated per game");
  if (autoForwardDelayMs("你好", 0) !== undefined) throw new Error("zero auto-forward time must wait forever");
  if (autoForwardDelayMs("a".repeat(225), 6) !== 6000) throw new Error("auto-forward timing formula changed");
  const rollbackScript = {
    scenes: [{
      scene_id: "scene",
      commands: [{ type: "rollback", action: "block" }],
    }],
  } as any;
  if (runtimeScriptSchemaVersion(rollbackScript) !== "1.5.0") throw new Error("rollback commands require script schema 1.5.0");
  if (minimumRuntimeVersionForScript(rollbackScript) !== "0.6.0") throw new Error("rollback commands require runtime 0.6.0");
  console.log("PASS GameCLI preferences contract");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "gamecli-preferences-contract.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  target: "node20",
});

const moduleUnderTest = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(
  require,
  moduleUnderTest,
  moduleUnderTest.exports,
);
