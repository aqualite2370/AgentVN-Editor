#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

const editorPackage = JSON.parse(read("editor", "package.json"));
const tauriConfig = JSON.parse(read("editor", "src-tauri", "tauri.conf.json"));
const releaseBuild = read("scripts", "build-editor-windows.ps1");
const preparationScriptPath = path.join(root, "scripts", "prepare-editor-runtime-resources.ps1");

assert.match(
  editorPackage.scripts["prepare:runtime-resources"] ?? "",
  /prepare-editor-runtime-resources\.ps1/,
  "Editor package must expose the runtime-resource preparation step.",
);
assert.match(
  tauriConfig.build.beforeBuildCommand ?? "",
  /prepare:runtime-resources/,
  "Direct `tauri build` must refresh the preview player and standalone build workspace.",
);
assert.match(
  releaseBuild,
  /AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED/,
  "The Windows release wrapper must avoid rebuilding runtime resources twice.",
);
assert.match(
  releaseBuild,
  /prepare-editor-runtime-resources\.ps1/,
  "The Windows release wrapper must use the common resource preparation entry.",
);
assert.ok(fs.existsSync(preparationScriptPath), "Runtime-resource preparation script is missing.");

const preparationScript = fs.readFileSync(preparationScriptPath, "utf8");
assert.match(preparationScript, /build-game-shell-windows\.ps1/, "Preparation must rebuild the GameCLI preview executable.");
assert.match(preparationScript, /bundle-workspace/, "Preparation must refresh the standalone packaging workspace.");
assert.match(preparationScript, /GameCli_framework/, "Preparation must copy the current GameCLI source.");
assert.match(preparationScript, /shared/, "Preparation must copy current shared cartridge contracts.");
assert.match(preparationScript, /Source \(Join-Path \$RuntimeSource "node_modules"\)/,
  "Common preparation must copy node_modules separately from workspace-output filters.");
assert.match(preparationScript, /lucide-react\\dist\\cjs\\lucide-react\.js/,
  "Common preparation must validate lucide-react runtime files.");
assert.match(preparationScript, /sharp\\dist\\index\.cjs/,
  "Common preparation must validate sharp runtime files.");

const bundledPlaybackControls = read(
  "editor",
  "src-tauri",
  "bundle-workspace",
  "GameCli_framework",
  "src",
  "components",
  "player",
  "PlaybackControls.tsx",
);
const bundledApp = read(
  "editor",
  "src-tauri",
  "bundle-workspace",
  "GameCli_framework",
  "src",
  "app",
  "App.tsx",
);
const bundledPreferences = read(
  "editor",
  "src-tauri",
  "bundle-workspace",
  "GameCli_framework",
  "src",
  "store",
  "runtimePreferences.ts",
);

assert.match(
  bundledPlaybackControls,
  /QuickMenuButton\s+componentId="quick_rollback_button"\s+label="回退"/,
  "Bundled standalone source is missing the rollback button.",
);
assert.doesNotMatch(bundledPlaybackControls, /aria-label="前滚"/, "Bundled standalone source must not expose a roll-forward button.");
assert.match(bundledApp, /addEventListener\("wheel"/, "Bundled standalone source is missing wheel rollback.");
assert.match(bundledPreferences, /RUNTIME_SETTINGS_SCHEMA_VERSION\s*=\s*8/, "Bundled standalone source is missing Preferences schema 8.");

console.log("PASS editor runtime resources are refreshed for preview and standalone packaging");
