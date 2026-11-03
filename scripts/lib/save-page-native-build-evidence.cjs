"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const receipts = [
  { file: "F:/AgentVN/QA/Runtime-SavePage-Time-20261024-01/build-01/report.json", output: /^save-page-native-time01-\d{2}$/ },
  { file: "F:/AgentVN/QA/Runtime-SavePage-Handoff-20261024-01/build-03/report.json", output: /^save-page-handoff-native03-\d{2}$/ },
];
function savePageNativeBuildEvidence(file, output) {
  const receipt = receipts.find(item => path.resolve(file) === path.resolve(item.file));
  assert(receipt, "Exact named passing build receipt required");
  assert.equal(path.dirname(path.resolve(output)), path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
  assert.match(path.basename(output), receipt.output);
  const build = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  assert.equal(build.status, "PASS"); assert.equal(build.phase, "build");
  assert.deepEqual(build.commands.map(c => c.label), ["editor-typecheck", "editor-build", "gamecli-build", "full-dev"]);
  assert(build.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  assert.equal(path.resolve(build.dev.path), path.join(root, "AgentVN Dev.exe"));
  assert.equal(path.resolve(build.player.path), path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
  for (const item of [build.dev, build.player, ...build.sources, ...build.bundled, ...build.frozen])
    assert.equal(sha(item.path), item.sha256, item.path);
  assert.equal(build.player.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
  return { executable: build.player, receipt: { path: path.resolve(file), sha256: sha(file) } };
}
module.exports = { savePageNativeBuildEvidence };
