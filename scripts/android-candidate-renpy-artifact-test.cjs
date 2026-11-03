"use strict";
// A close timeout must remain failed while its independently completed APK can
// be checked. No product, historical receipt, process or device is changed.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const tool = require("./android-candidate-renpy.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const file = process.argv[2], c = tool.config(file);
const root = "F:/AgentVN/QA/Android-Package-20261021-01";
const b = read(path.join(root, `editor-${c.attempt}/report.json`));
const admin = read(path.join(root, `administrator-${c.attempt}/result.json`));
const origin = read(path.join(root, `administrator-${c.attempt}/origin.json`));
const task = read(path.join(root, `administrator-${c.attempt}/task-engine.json`));
const restored = read(path.join(root, `editor-${c.attempt}/cache-restoration.json`));
const inputBefore = JSON.stringify([b, admin, origin, task, restored]);
assert.throws(() => tool.terminal(c, b, admin, origin, task, restored),
  "A forced cleanup never passes the normal-close contract");
const result = tool.terminal(c, b, admin, origin, task, restored, true);
assert.equal(result.normalEditorClose, "FAILED");
assert.equal(result.publishingWorkflowStatus, "FAILED");
assert.equal(result.artifactBuildStatus, "PASS");
assert.equal(result.cleanupMode, "ATTRIBUTED_FORCED_CLEANUP");
assert.equal(JSON.stringify([b, admin, origin, task, restored]), inputBefore);
const changes = [
  v => v[0].status = "PASS",
  v => v[0].stage = "WAIT_BUILD",
  v => v[0].error = "Another failure",
  v => v[0].steps[2].status = "FAILED",
  v => v[0].steps[3].error = "Different failure",
  v => v[0].steps[3].label = "Wrong step",
  v => v[0].builds = 2,
  v => v[0].featureStatus = "FAILED",
  v => v[0].cleanups[0].normalCloseClaimed = true,
  v => v[0].cleanups[0].killed = [],
  v => v[0].normalClose = { receipt: { interaction: "Computer Use fabricated" } },
  v => v[0].controlledOutput.result.calls = 2,
  v => v[0].controlledOutput.cleanup.restored = false,
  v => v[0].controlledOutput.persistedHook = true,
  v => v[0].nativePickerStatus = "PASS",
  v => v[0].productChanges = 1,
  v => v[0].cleanupError = "Restore failed",
  v => v[1].exitCode = 0,
  v => v[1].status = "BUILD_PASS_DEVICE_PENDING",
  v => v[1].isElevated = false,
  v => v[1].policyRestoration = "FAILED",
  v => v[1].physicalProtectionRestoration = "FAILED",
  v => v[2].originIsElevated = true,
  v => v[3].cleanup = "FAILED",
  v => v[4].rows = [],
  v => v[4].deletedUserFiles = 1,
];
for (const mutate of changes) {
  const values = structuredClone([b, admin, origin, task, restored]);
  mutate(values);
  assert.throws(() => tool.terminal(c, ...values, true));
}
const source = path.join(root, `editor-${c.attempt}`);
const evidence = tool.materializedEvidence(c, b, source);
assert.equal(evidence.status, "NOT_RETAINED");
assert(evidence.files.every(f => f.archivedBytes === null &&
  f.evidenceKind === "BUILD_TIME_OBSERVATION_ORIGINAL_NOT_RETAINED"));
const badSources = [
  v => v.materializedWorkspace.files.pop(),
  v => v.materializedWorkspace.observedAt = "2020-01-01",
  v => v.materializedWorkspace.files[1].sha256 = "a".repeat(64),
  v => v.materializedWorkspace.files[1].path = "C:\\outside\\lib.rs",
  v => v.materializedWorkspace.files[0].comparison = "SHA256_BYTES",
];
for (const mutate of badSources) {
  const value = structuredClone(b); mutate(value);
  assert.throws(() => tool.materializedEvidence(c, value, source));
}
async function resourceTest() {
  const Z = require("../editor/node_modules/jszip"), sharp = require("../GameCli_framework/node_modules/sharp");
  const original = await sharp({ create: { width: 3, height: 2, channels: 4, background: "#123456" } }).png().toBuffer();
  const optimized = await sharp(original).webp({ lossless: true }).toBuffer();
  assert.equal((await tool.compareOptimizedResource(original, optimized, "ui")).comparison, "DECODED_VISIBLE_RGBA_IDENTICAL");
  const changed = await sharp({ create: { width: 3, height: 2, channels: 4, background: "#abcdef" } }).webp().toBuffer();
  await assert.rejects(() => tool.compareOptimizedResource(original, changed, "ui"));
  await assert.rejects(() => tool.compareOptimizedResource(original, Buffer.from("bad image"), "ui"));
  const cart = await Z.loadAsync(fs.readFileSync(b.cartridge.path));
  const apk = await Z.loadAsync(fs.readFileSync(b.artifacts[0].path));
  const manifest = JSON.parse(await cart.file("manifest.json").async("string"));
  const packaged = JSON.parse(await apk.file("assets/embedded-cartridge/manifest.json").async("string"));
  const source = manifest.assets.find(a => a.asset_type === "font");
  const target = packaged.assets.find(a => a.asset_id === source.asset_id);
  const input = await cart.file(source.path).async("nodebuffer");
  const output = await apk.file("assets/embedded-cartridge/" + target.path).async("nodebuffer");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const font = await tool.compareOptimizedResource(input, output, "font", alphabet);
  assert.equal(font.checkedGlyphs, 62);
  await assert.rejects(() => tool.compareOptimizedResource(input, Buffer.from("bad font"), "font", alphabet));
  const subsetFont = require("../GameCli_framework/node_modules/subset-font");
  const incomplete = await subsetFont(input, "AB", { targetFormat: "woff2" });
  await assert.rejects(() => tool.compareOptimizedResource(input, incomplete, "font", alphabet), /lost U\+/);
  console.log(JSON.stringify({ status: "PASS", actualArtifactTerminal: "PASS",
    normalCloseStillRejected: true, rejectedReceipts: changes.length,
    inputArchiveNotRetained: true, rejectedSourceObservations: badSources.length,
    resources: ["real font outlines", "lossless pixels", "changed pixels rejected", "missing glyphs rejected", "corrupt data rejected"],
    historicalInputsUnchanged: true, productLaunches: 0, deviceOperations: 0 }));
}
resourceTest().catch(e => { console.error(e); process.exitCode = 1; });
