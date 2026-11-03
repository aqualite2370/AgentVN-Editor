#!/usr/bin/env node
"use strict";

const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import {
    minimumRuntimeVersionForScript,
    runtimeScriptSchemaVersion,
  } from "./shared/cartridge/runtimeCapabilities";
  import {
    validateRuntimeScript,
    validateVersionCompatibility,
  } from "./shared/cartridge/validators";

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  const legacyScript = {
    schema_version: "1.1.0",
    game_id: "compat",
    title: "Compat",
    entry_scene_id: "start",
    scenes: [{
      scene_id: "start",
      title: "Start",
      summary: "",
      chapter: 1,
      tags: [],
      is_ending: true,
      commands: [{ type: "camera", action: "shake", params: { duration: 300 }, blocking: false }],
    }],
  };
  const structuredScript = {
    ...legacyScript,
    schema_version: "1.2.0",
    scenes: [{
      ...legacyScript.scenes[0],
      commands: [{
        type: "camera",
        motion: {
          schema_version: 1,
          kind: "impact",
          direction: "from_left",
          intensity: 0.65,
          duration_ms: 380,
        },
        blocking: false,
      }],
    }],
  };
  const manifest = (runtimeVersion: string) => ({
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: runtimeVersion,
    game_id: "compat",
    title: "Compat",
    author: "AgentVN",
    description: "",
    version: "1.0.0",
    language: "zh-CN",
    tags: [],
    entry_script: "script.json",
    entry_scene_id: "start",
    assets: [],
  });

  assert(minimumRuntimeVersionForScript(legacyScript) === "0.2.0", "0.2 content must not be upgraded");
  assert(runtimeScriptSchemaVersion(legacyScript) === "1.1.0", "legacy scripts must stay on schema 1.1");
  assert(validateRuntimeScript(legacyScript, manifest("0.2.0")).ok, "valid 0.2 camera content must still import");

  assert(minimumRuntimeVersionForScript(structuredScript) === "0.3.0", "structured motion must require runtime 0.3");
  assert(runtimeScriptSchemaVersion(structuredScript) === "1.2.0", "structured motion must use schema 1.2");
  assert(validateRuntimeScript(structuredScript, manifest("0.3.0")).ok, "0.3 content must pass strict validation");
  assert(!validateVersionCompatibility(manifest("0.3.0"), "0.2.0").ok, "0.2 runtime must reject 0.3 cartridges during import");
  assert(validateVersionCompatibility(manifest("0.3.0"), "0.3.0").ok, "0.3 runtime must accept structured camera cartridges");
  assert(validateVersionCompatibility(manifest("0.2.0"), "0.3.0").ok, "0.3 runtime must keep accepting 0.2 cartridges");

  const sequenceScript = {
    ...structuredScript,
    schema_version: "1.3.0",
    scenes: [{
      ...structuredScript.scenes[0],
      commands: [{
        type: "camera",
        motion: {
          schema_version: 1,
          kind: "sequence",
          shots: [
            { to: { center_x: 0.5, center_y: 0.5, zoom: 1.2 }, duration_ms: 500, easing: "linear" },
            { to: { center_x: 0.6, center_y: 0.5, zoom: 1.5 }, duration_ms: 900, easing: "ease-out" },
          ],
        },
        blocking: true,
      }],
    }],
  };
  assert(minimumRuntimeVersionForScript(sequenceScript) === "0.4.0", "sequence content must require runtime 0.4");
  assert(runtimeScriptSchemaVersion(sequenceScript) === "1.3.0", "sequence content must use schema 1.3");
  assert(validateRuntimeScript(sequenceScript, manifest("0.4.0")).ok, "0.4 sequence content must pass strict validation");
  assert(!validateVersionCompatibility(manifest("0.4.0"), "0.3.0").ok, "0.3 runtime must reject sequence cartridges");
  assert(validateVersionCompatibility(manifest("0.4.0"), "0.4.0").ok, "0.4 runtime must accept sequence cartridges");
  assert(validateVersionCompatibility(manifest("0.3.0"), "0.4.0").ok, "0.4 runtime must keep accepting 0.3 cartridges");

  const mixedScript = {
    ...structuredScript,
    scenes: [{
      ...structuredScript.scenes[0],
      commands: [{
        ...structuredScript.scenes[0].commands[0],
        action: "shake",
        params: {},
      }],
    }],
  };
  assert(
    validateRuntimeScript(mixedScript, manifest("0.3.0")).errors.some((issue) => issue.code === "camera_mixed_format"),
    "cartridge import must reject mixed legacy and structured camera fields",
  );
  const incompleteLegacy = {
    ...legacyScript,
    scenes: [{
      ...legacyScript.scenes[0],
      commands: [{ type: "camera", blocking: true }],
    }],
  };
  assert(!validateRuntimeScript(incompleteLegacy, manifest("0.2.0")).ok, "cartridge import must reject incomplete legacy camera fields");

  console.log("camera cartridge compatibility test OK");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "camera-cartridge-compatibility-test.ts",
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
