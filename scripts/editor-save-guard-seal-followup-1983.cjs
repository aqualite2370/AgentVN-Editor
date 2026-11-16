"use strict";
// Complete only the QA metadata omitted by the first seal; no rebuild or re-extraction.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Editor-Save-Guard-Release-1983-20261116-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const output = path.join(base, "release/build.json"); assert(!fs.existsSync(output));
const checkpoint = read(path.join(base, "checkpoint.json")), stages = read(path.join(base, "build-stages.json"));
assert.equal(stages.status, "PASS_BUILD_NOT_INSTALLED"); assert.equal(stages.stages.length, 4);
assert(stages.stages.every(s => s.status === "PASS")); assert.equal(stages.nativePlayerBuilds, 0);
for (const file of [checkpoint.daily, checkpoint.frozen.installer, checkpoint.frozen.player, checkpoint.git.index, ...checkpoint.sources])
  assert.equal(sha(file.path), file.sha256);
assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(), checkpoint.git.head);
const dir = path.join(base, "release/installers/editor"), names = fs.readdirSync(dir);
assert.equal(names.length, 1); assert.match(names[0], /^AgentVN_Editor_v1\.9\.83_.*\.exe$/);
const installer = path.join(dir, names[0]), sourceInstaller = path.join(root, "releases/editor-save-guard-1983/editor", names[0]);
assert.equal(sha(installer), sha(sourceInstaller));
const payloadReport = path.join(base, "release/payload/installer-resource-report.json");
assert.equal(read(payloadReport).status, "PASS");
const dev = path.join(root, "AgentVN Dev.exe"), player = path.join(root, "editor/src-tauri/binaries/agentvn-player.exe");
assert.equal(sha(dev), sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
assert.equal(sha(player), checkpoint.frozen.player.sha256);
const buildVersions = read(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json"));
assert.equal(buildVersions.editorVersion, "1.9.83");
fs.writeFileSync(path.join(base, "seal-01-failure.json"), JSON.stringify({
  status: "FAILED", reason: "QA-only test scripts incorrectly required in bundled runtime workspace",
  failedPath: "scripts/editor-autosave-boundaries-test.cjs", productBuildFailure: false,
  payloadReport: desc(payloadReport), buildsRepeated: 0, originalReleaseTreePreserved: true,
}, null, 2), { flag: "wx" });
const build = { status: "PASS_EDITOR_DEV_NSIS_RUNTIME032_PAYLOAD_NOT_INSTALLED", version: "1.9.83",
  runtimeVersion: "0.32.0", at: new Date().toISOString(), installer: desc(installer), sourceInstaller: desc(sourceInstaller),
  dev: desc(dev), player: desc(player), backend: desc(path.join(root, "editor/src-tauri/binaries/creator-backend.exe")),
  oldPlayer: checkpoint.frozen.player, sources: checkpoint.sources, bundledSources: [], buildVersions,
  payloadReport: desc(payloadReport), stages: desc(path.join(base, "build-stages.json")),
  checkpoint: desc(path.join(base, "checkpoint.json")), nativePlayerBuilds: 0, standalonePlayerInstallers: 0,
  msiInstallers: 0, androidBuilds: 0, modelRequests: 0, firstSealQaFailure: desc(path.join(base, "seal-01-failure.json")),
  boundaries: ["Only missing seal metadata completed; same original build and actual payload audit",
    "Installed autosave/native recovery/normal close/restart NOT_RUN", "No new Runtime or repeated Android/upgrade matrix"] };
fs.writeFileSync(output, JSON.stringify(build, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", installer: build.installer }));
