"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { validateNativeViewport } = require("./current-native-capture.cjs");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });

function readHistoricalTitlePlayer() {
  const base = "F:/AgentVN/QA/Editor-1.9.22-20261022-01";
  const installation = describe(path.join(base, "install-01/actual-installation.json"));
  const payload = describe(path.join(base, "payload-01/installer-resource-report.json"));
  const installed = read(installation.path), contents = read(payload.path);
  assert.equal(installed.status, "PASS"); assert.equal(installed.registryRestored, true);
  assert.equal(contents.status, "PASS"); assert.equal(contents.version, "1.9.22");
  assert.equal(contents.installerFormat, "nsis");
  assert.equal(path.resolve(installed.installRoot), path.resolve(base, "install-01/installed-nsis"));
  const deployment = contents.deployments.find(d => d.kind === "NSIS actual payload"
    && d.executable.sha256 === installed.executable.sha256);
  assert(deployment); assert.equal(sha(installed.executable.path), deployment.executable.sha256);
  assert.equal(sha(deployment.executable.path), deployment.executable.sha256);
  assert.equal(sha(deployment.versionResource.path), deployment.versionResource.sha256);
  assert.equal(read(deployment.versionResource.path).editorVersion, "1.9.22");
  const resource = contents.runtimeCandidate.find(f => f.name === "agentvn-player.exe");
  assert.equal(resource.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  const executable = describe(path.join(installed.installRoot, resource.name));
  assert.equal(executable.sha256, resource.sha256);
  assert.equal(sha(path.join(deployment.installedRoot, resource.name)), executable.sha256);
  return { installation, payload, executable, editorVersion: contents.version,
    provenance: "UNCHANGED_PLAYER_FROM_RETAINED_REAL_1_9_22_NSIS_INSTALLATION",
    runtimeVersion: "REQUIRES_ACTUAL_OLD_UI_OBSERVATION_NOT_INFERRED_FROM_FILENAME" };
}

function assertTitleProtocolRefusal(value, expected) {
  validateNativeViewport(value.viewport, expected);
  assert.equal(value.playingCount, 0, "Unsupported story must never mount");
  assert(!(value.start.visible && value.start.enabled), "Unsupported cartridge is playable");
  assert(Number.isFinite(value.overflow) && value.overflow <= 1);
  assert(/卡带要求\s*0\.26\.0/.test(value.text), "This must be the new title capability");
  assert(/当前\s*(?:Runtime|运行时)?\s*[:：]?\s*0\.25\.0/i.test(value.text),
    "A real 0.25 Runtime must identify itself in the refusal");
  assert(/版本|不兼容|不支持/.test(value.text) && /更新|升级/.test(value.text));
  assert(!/ui_layout_version|Unrecognized key|Invalid literal|未知字段|不认识.*字段/i.test(value.text),
    "An earlier schema rejection does not prove the minimum Runtime gate");
  const bounded = r => r && r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
    && r.right <= expected.width + 1 && r.bottom <= expected.height + 1;
  assert(bounded(value.alert?.rect), "Refusal panel is clipped or invisible");
  assert(value.alert.buttons.length > 0
    && value.alert.buttons.every(button => bounded(button.rect) && button.hit),
  "Recovery controls must remain visible and hittable");
  return { required: "0.26.0", actual: "0.25.0", stage: "RUNTIME_PROTOCOL_VALIDATION" };
}

module.exports = { assertTitleProtocolRefusal, readHistoricalTitlePlayer, describe };
