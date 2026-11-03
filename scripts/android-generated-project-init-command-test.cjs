#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const helper = path.join(root, "scripts", "ensure-android-generated-project.cjs");

function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function readStrictJson(filePath) {
  const bytes = fs.readFileSync(filePath);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.equal(text.includes("\uFFFD"), false, "health report must not contain replacement characters");
  return JSON.parse(text);
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-android-init-command-"));
const runtimeRoot = path.join(fixtureRoot, "Build Workspace With Spaces", "GameCli_framework");
const diagnosticsRoot = path.join(fixtureRoot, "Diagnostics Output");
const commandRoot = path.join(fixtureRoot, "Tools With Spaces");
const fakeInitScript = path.join(commandRoot, "fake-init.cjs");
const fakeNpm = path.join(commandRoot, "npm.cmd");
const reportPath = path.join(diagnosticsRoot, "android-generated-project-health.json");
const initSource = [
  'const fs = require("node:fs");',
  'const path = require("node:path");',
  'const root = process.env.AGENTVN_TEST_RUNTIME_ROOT;',
  'const bootstrapOnly = process.env.AGENTVN_TEST_INIT_STAGE === "bootstrap";',
  'const android = path.join(root, "src-tauri", "gen", "android");',
  'const write = (relative, value) => { const target = path.join(android, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value, "utf8"); };',
  'write("settings.gradle", "include(\\":app\\")\\n");',
  'write("build.gradle.kts", "plugins {}\\n");',
  'write("app/build.gradle.kts", "plugins {}\\n");',
  'write("app/src/main/AndroidManifest.xml", "<manifest />\\n");',
  'write("gradlew", "#!/bin/sh\\n");',
  'write("gradlew.bat", "@echo off\\r\\n");',
  'write("gradle/wrapper/gradle-wrapper.jar", "jar");',
  'write("gradle/wrapper/gradle-wrapper.properties", "distributionUrl=https://example.invalid/gradle.zip\\n");',
  'write("app/src/main/java/com/example/MainActivity.kt", "package com.example\\nclass MainActivity\\n");',
  'write("app/src/main/java/com/example/generated/TauriActivity.kt", "package com.example.generated\\nimport app.tauri.plugin.PluginManager\\nabstract class TauriActivity { fun getPluginManager(): PluginManager { return PluginManager } }\\n");',
  'if (!bootstrapOnly) {',
  '  write("app/tauri.properties", "tauri.android.versionName=0.1.0\\n");',
  '  write("tauri.settings.gradle", "include(\\":app\\")\\n");',
  '  write("app/tauri.build.gradle.kts", "// generated\\n");',
  '}',
  'process.stderr.write("Android 初始化完成：中文输出\\\\r\\\\n");',
].join("\n");

try {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  write(fakeInitScript, initSource);
  write(fakeNpm, `@echo off\r\nnode "%~dp0fake-init.cjs"\r\n`);
  const argsBase64 = Buffer.from(
    JSON.stringify(["run", "tauri", "--", "android", "init", "--ci", "--skip-targets-install"]),
    "utf8",
  ).toString("base64");
  const result = childProcess.spawnSync(
    process.execPath,
    [
      helper,
      "--runtime-root",
      runtimeRoot,
      "--report",
      reportPath,
      "--init-command",
      fakeNpm,
      "--init-args-base64",
      argsBase64,
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, AGENTVN_TEST_RUNTIME_ROOT: runtimeRoot },
    },
  );
  const report = readStrictJson(reportPath);
  assert.equal(result.status, 0, `helper must launch a .cmd path containing spaces:\n${result.stdout}\n${result.stderr}\n${JSON.stringify(report)}`);
  assert.equal(report.status, "PASS");
  assert.equal(report.initializationExitCode, 0);
  assert.equal(report.finalProjectComplete, true);
  assert.equal(report.initializationStderr.includes("Android 初始化完成"), true);

  fs.rmSync(path.join(runtimeRoot, "src-tauri", "gen", "android"), { recursive: true, force: true });
  process.env.AGENTVN_TEST_INIT_STAGE = "bootstrap";
  const bootstrapReportPath = path.join(diagnosticsRoot, "android-generated-project-bootstrap-health.json");
  const bootstrapArgsBase64 = Buffer.from(
    JSON.stringify(["run", "tauri", "--", "android", "init", "--ci", "--skip-targets-install"]),
    "utf8",
  ).toString("base64");
  const bootstrap = childProcess.spawnSync(
    process.execPath,
    [
      helper,
      "--runtime-root",
      runtimeRoot,
      "--report",
      bootstrapReportPath,
      "--init-command",
      fakeNpm,
      "--init-args-base64",
      bootstrapArgsBase64,
      "--required-stage",
      "bootstrap",
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, AGENTVN_TEST_RUNTIME_ROOT: runtimeRoot },
    },
  );
  const bootstrapHealth = readStrictJson(bootstrapReportPath);
  assert.equal(
    bootstrap.status,
    0,
    `bootstrap stage must allow Tauri-delayed files to be absent:\n${bootstrap.stdout}\n${bootstrap.stderr}\n${JSON.stringify(bootstrapHealth)}`,
  );
  assert.equal(bootstrapHealth.requiredStage, "bootstrap");
  assert.equal(bootstrapHealth.finalProjectComplete, true);
  assert.equal(bootstrapHealth.fullProjectComplete, false);
  assert.deepEqual(
    bootstrapHealth.deferredFilesAfter,
    ["tauri.settings.gradle", "app/tauri.build.gradle.kts", "app/tauri.properties"],
  );

  const fullAfterBootstrap = childProcess.spawnSync(
    process.execPath,
    [
      helper,
      "--runtime-root",
      runtimeRoot,
      "--report",
      path.join(diagnosticsRoot, "android-generated-project-full-health.json"),
      "--init-command",
      fakeNpm,
      "--init-args-base64",
      bootstrapArgsBase64,
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, AGENTVN_TEST_RUNTIME_ROOT: runtimeRoot },
    },
  );
  assert.equal(fullAfterBootstrap.status, 2, "full stage must still reject missing Tauri-delayed files");

  const staleRuntimeRoot = path.join(fixtureRoot, "Stale Workspace", "GameCli_framework");
  const staleAndroidRoot = path.join(staleRuntimeRoot, "src-tauri", "gen", "android");
  const staleTauriSource = path.join(fixtureRoot, "tauri-registry", "tauri-2.11.2", "mobile", "android");
  const escapedTauriSource = staleTauriSource.replaceAll("\\", "\\\\");
  const staleFiles = new Map([
    ["settings.gradle", 'apply from: "tauri.settings.gradle"\n'],
    ["build.gradle.kts", "plugins {}\n"],
    ["app/build.gradle.kts", "plugins {}\n"],
    ["app/src/main/AndroidManifest.xml", "<manifest />\n"],
    ["gradlew", "#!/bin/sh\n"],
    ["gradlew.bat", "@echo off\r\n"],
    ["gradle/wrapper/gradle-wrapper.jar", "jar"],
    ["gradle/wrapper/gradle-wrapper.properties", "distributionUrl=https://example.invalid/gradle.zip\n"],
    ["app/src/main/java/com/example/MainActivity.kt", "package com.example\nclass MainActivity : TauriActivity()\n"],
    ["app/src/main/java/com/example/generated/TauriActivity.kt", "package com.example.generated\nabstract class TauriActivity\n"],
    ["tauri.settings.gradle", `include ':tauri-android'\nproject(':tauri-android').projectDir = new File("${escapedTauriSource}")\n`],
    ["app/tauri.build.gradle.kts", "// generated\n"],
    ["app/tauri.properties", "tauri.android.versionName=0.1.0\n"],
  ]);
  for (const [relative, contents] of staleFiles) write(path.join(staleAndroidRoot, relative), contents);
  write(
    path.join(staleRuntimeRoot, "src-tauri", "Cargo.lock"),
    'version = 4\n\n[[package]]\nname = "tauri"\nversion = "2.11.2"\n',
  );
  write(
    path.join(staleTauriSource, "..", "android-codegen", "TauriActivity.kt"),
    "package app.tauri\nimport app.tauri.plugin.PluginManager\nabstract class TauriActivity { fun getPluginManager(): PluginManager { return PluginManager } }\n",
  );
  const staleReportPath = path.join(diagnosticsRoot, "android-generated-project-stale-health.json");
  const staleRun = childProcess.spawnSync(
    process.execPath,
    [
      helper,
      "--runtime-root",
      staleRuntimeRoot,
      "--report",
      staleReportPath,
      "--init-command",
      fakeNpm,
      "--init-args-base64",
      argsBase64,
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        AGENTVN_TEST_RUNTIME_ROOT: staleRuntimeRoot,
        AGENTVN_TEST_INIT_STAGE: "full",
      },
    },
  );
  const staleHealth = readStrictJson(staleReportPath);
  assert.equal(
    staleRun.status,
    0,
    `stale Tauri Android template must be regenerated:\n${staleRun.stdout}\n${staleRun.stderr}\n${JSON.stringify(staleHealth)}`,
  );
  assert.equal(staleHealth.compatibilityBefore.status, "incompatible");
  assert.equal(staleHealth.compatibilityBefore.reasons.some((reason) => reason.includes("getPluginManager")), true);
  assert.equal(staleHealth.reinitialized, true);
  assert.equal(staleHealth.compatibilityAfter.status, "compatible");
  console.log("Android generated-project init command test OK");
} finally {
  delete process.env.AGENTVN_TEST_INIT_STAGE;
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
