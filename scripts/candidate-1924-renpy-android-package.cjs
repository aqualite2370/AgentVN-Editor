"use strict";
// Direct, hash-locked executed workflow; do not add another task-wrapper chain.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module"), vm = require("node:vm");
const { selfTest: fixtureSelfTest } = require("./lib/candidate-1924-renpy-android-fixture.cjs");
const baseline = "F:/AgentVN/QA/Android-Package-20261021-01/editor-17/executed-business.cjs";
const expected = "f422e6d046c078081ca8bd2306558c84efd23665431503650fc0085b6e3806a8";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function adapt(input = fs.readFileSync(baseline)) {
  assert.equal(hash(input), expected, "Executed package workflow drift");
  let source = input.toString("utf8"); const changes = [];
  function replace(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after); changes.push({ before, after, count });
  }
  replace('const { retainedAndroidFixture } = require("./lib/android-game-upgrade-fixture.cjs");',
    'const { renpyAndroidFixture } = require("./lib/candidate-1924-renpy-android-fixture.cjs");');
  replace("scripts/lib/android-game-upgrade-fixture.cjs", "scripts/lib/candidate-1924-renpy-android-fixture.cjs");
  replace("candidate-1924-android-package-task17-cache.ps1", "candidate-1924-renpy-android-cache.ps1", 2);
  replace('  const upgrade = nativeUpgrade ? retainedAndroidFixture() : null;\n' +
    '  if (upgrade) { upgrade.gameVersion = "0.1.2"; upgrade.versionCode = 1002; }',
    '  assert.equal(attempt, "18"); assert(nativeUpgrade);\n' +
    '  const upgrade = renpyAndroidFixture();\n' +
    '  report.fixtureProvenance = upgrade.provenance;');
  replace("ELEVATED_ACTUAL_INSTALLED_1_9_24_NATIVE_UI_ANDROID_SAME_GAME_BUILD_NOT_DEVICE",
    "ELEVATED_ACTUAL_INSTALLED_1_9_24_NATIVE_UI_RENPY_OFFICIAL_GUI_ANDROID_NOT_DEVICE");
  replace('"QA_ANDROID_UPGRADE_NEW_2"', '"GUI_CONTINUE"');
  replace('    report.cartridge = { ...desc(file), manifest, layoutSha256:',
    '    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer");\n' +
    '    assert.equal(hash(layoutBytes), upgrade.provenance.priorCartridge.layoutSha256);\n' +
    '    for (const asset of upgrade.provenance.priorCartridge.assets) {\n' +
    '      assert(zip.file(asset.path), asset.path);\n' +
    '      const bytes = await zip.file(asset.path).async("nodebuffer");\n' +
    '      assert.equal(hash(bytes), asset.sha256, asset.id); assert.equal(bytes.length, asset.bytes);\n' +
    '    }\n' +
    '    report.exportedAssetProofs = upgrade.provenance.priorCartridge.assets;\n' +
    '    report.cartridge = { ...desc(file), manifest, layoutSha256:');
  // Bounded native interaction: a failed input must leave a terminal report and
  // restore caches, not another twenty-minute stale "waiting" anchor.
  replace('timeoutMs: 1200000 });', 'timeoutMs: 180000 });');
  replace('"Computer Use normal Editor close", 1200000);', '"Native normal Editor close", 180000);');
  replace('      assert(receipt.interaction.includes("Computer Use"));',
    '      assert(receipt.interaction.includes("Computer Use") || receipt.interaction === "USER_MANUAL");');
  new vm.Script(Module.wrap(source), { filename: __filename });
  return { source, changes };
}
if (process.argv[2] === "--self-test") {
  const adapted = adapt(), fixture = fixtureSelfTest();
  for (const mutated of [Buffer.from("wrong"), Buffer.concat([fs.readFileSync(baseline), Buffer.from("\n")])])
    assert.throws(() => adapt(mutated));
  console.log(JSON.stringify({ status: "PASS", transformations: adapted.changes.length,
    sourceDriftRejections: 2, fixture, productLaunches: 0, apkBuilds: 0 }));
} else {
  assert.deepEqual(process.argv.slice(2), ["18", "--physical-package-cache", "--physical-environment-cache",
    "--administrator-launch=F:\\AgentVN\\QA\\Android-Package-20261021-01\\administrator-18", "--native-upgrade"]);
  const adapted = adapt(), worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  Object.assign(worker, { qaSource: adapted.source, qaChanges: adapted.changes });
  worker._compile(adapted.source, __filename);
}
