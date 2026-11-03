"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildSource = fs.readFileSync(
  path.join(root, "scripts/build-runtime-standalone-windows.cjs"),
  "utf8",
);
const bundledBuildSource = fs.readFileSync(
  path.join(root, "editor/src-tauri/bundle-workspace/scripts/build-runtime-standalone-windows.cjs"),
  "utf8",
);
const tauriConfig = JSON.parse(fs.readFileSync(
  path.join(root, "GameCli_framework/src-tauri/tauri.conf.json"),
  "utf8",
));

assert.equal(
  bundledBuildSource,
  buildSource,
  "the installed Editor must ship the same freshness-protected Windows runner as the source workspace",
);
assert.equal(
  tauriConfig.build?.beforeBuildCommand,
  "",
  "the standalone packager must own the frontend build because Tauri has no beforeBuildCommand",
);

const modeSetup = buildSource.indexOf('writeJson(runtimeModePath, { mode: "fixed" })');
const releaseSetup = buildSource.indexOf('writeJson(releasePackagePath, { schemaVersion: 1, presentationMode: "release" })');
const releaseEnvSetup = buildSource.indexOf("const releaseBuildEnv = {");
const frontendBuild = buildSource.indexOf('"frontend runtime build"');
const tauriBuild = buildSource.indexOf('"tauri nsis build"');

assert(modeSetup >= 0 && releaseSetup > modeSetup, "fixed/release frontend mode must be staged before building");
assert(releaseEnvSetup > releaseSetup && releaseEnvSetup < frontendBuild,
  "release build environment must be defined before the frontend build");
assert(frontendBuild > releaseSetup, "standalone packaging must build the frontend after staging fixed/release mode");
assert(tauriBuild > frontendBuild, "Tauri packaging must not bundle dist before the frontend build finishes");
assert.match(
  buildSource.slice(frontendBuild, tauriBuild),
  /\["run",\s*"build"\]/,
  "the freshness step must execute the GameCLI production build, not only inspect source files",
);
assert.match(
  buildSource.slice(releaseEnvSetup, frontendBuild),
  /VITE_AGENTVN_RUNTIME_MODE:\s*"fixed"/,
  "the frontend build must use fixed runtime mode",
);
assert.match(
  buildSource.slice(releaseEnvSetup, frontendBuild),
  /VITE_AGENTVN_FIXED_ONLY:\s*"true"/,
  "the frontend build must use fixed-only release configuration",
);
assert.match(
  buildSource.slice(releaseEnvSetup, frontendBuild),
  /VITE_AGENTVN_RELEASE_PACKAGE:\s*"true"/,
  "the frontend build must use release presentation configuration",
);
assert.match(buildSource.slice(frontendBuild, tauriBuild), /releaseBuildEnv/,
  "the frontend build must receive the same release configuration object as Tauri");
assert.match(buildSource.slice(tauriBuild), /releaseBuildEnv/,
  "the Tauri build must receive the same release configuration object as the frontend build");

console.log("standalone-runtime-freshness-contract-test: PASS");
