"use strict";
// Parameterize the established native UI/RunAs/task workflow. Frozen historical
// scripts stay unchanged; every generated input is archived and hash-bound.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const vm = require("node:vm"), Module = require("node:module");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { ps } = require("./lib/current-native-editor-session.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
const originals = {
  business: ["installed-android-package-current.cjs", "f59eb1602d70e6ce1bdd6bcd72184059532c23e576b8082ed4c14a3d9c7d41c0"],
  launcher: ["android-current-physical-host.ps1", "96ef23b6b92e0eae068f1d7b6801382488e3b58ae99a2756fad08889895fda5a"],
  cache: ["android-current-cache-session.ps1", "b9409011b6b77ff0ac603bdc9cc7ddacf8dc65974ad1fb7122fa22de8978dcad"],
};
function bounded(file) {
  const relative = path.relative(path.resolve("F:/AgentVN/QA"), path.resolve(file));
  assert(relative && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..");
  assert(!file.includes("'") && !file.includes('"'));
}
function validateConfig(c) {
  assert(c.outputDirectoryMode === undefined || c.outputDirectoryMode === "controlled-once",
    "Only the explicit user-authorized one-shot directory seam is supported");
  assert(c.fixtureKind === undefined || c.fixtureKind === "renpy-official",
    "Only the explicit, verified official-GUI fixture may replace the default upgrade fixture");
  assert.match(c.version, /^\d+\.\d+\.\d+$/);
  assert.match(c.attempt, /^\d{2}$/);
  assert.match(c.gameVersion, /^\d+\.\d+\.\d+$/);
  assert(Number.isSafeInteger(c.versionCode) && c.versionCode > 1002);
  const parts = c.gameVersion.split(".").map(Number);
  assert.equal(c.versionCode, parts[0] * 1000000 + parts[1] * 1000 + parts[2]);
  for (const field of ["preparation", "installation", "actualInstallation"]) {
    const value = typeof c[field] === "string" ? c[field] : c[field].path;
    bounded(value);
  }
  for (const field of ["installation", "actualInstallation"]) {
    assert.match(c[field].sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha(c[field].path), c[field].sha256);
  }
  const sealed = read(c.installation.path), actual = read(c.actualInstallation.path);
  assert.equal(sealed.status, "PASS"); assert.equal(sealed.metadataRestoration, "PASS");
  assert.equal(sealed.version, c.version); assert.deepEqual(sealed.actualInstallation, c.actualInstallation);
  assert.equal(actual.status, "PASS"); assert.equal(actual.exitCode, 0); assert(actual.registryRestored);
  assert.deepEqual(sealed.executable, actual.executable);
  assert.equal(path.resolve(sealed.installRoot), path.resolve(actual.installRoot));
  assert.equal(read(path.join(sealed.installRoot, "build-versions.json")).editorVersion, c.version);
  for (const file of [actual.installer, sealed.executable, ...sealed.resources, ...sealed.protectedFiles])
    assert.equal(sha(file.path), file.sha256, file.path);
  return sealed;
}
function build(kind, c, sample) {
  const file = path.join(__dirname, originals[kind][0]);
  assert.equal(sha(file), originals[kind][1], "Preserved original workflow drift");
  let source = sample === undefined ? fs.readFileSync(file, "utf8") : sample;
  const changes = [], one = (before, after, expected = 1) => {
    assert.equal(source.split(before).length - 1, expected, `${kind}: ${before}`);
    source = source.split(before).join(after); changes.push({ before, after, count: expected });
  };
  const prep = path.resolve(c.preparation), win = value => value.replaceAll("/", "\\");
  const runner = path.join(prep, "run.cjs"), cache = path.join(prep, "cache.ps1");
  if (kind === "cache") {
    one("$physical=($PhysicalPackageCache", "$physical=$true -or ($PhysicalPackageCache");
  } else if (kind === "launcher") {
    one("(Join-Path $repo 'scripts\\installed-android-package-current.cjs')", `'${win(runner)}'`, 2);
    one("(Join-Path $repo 'scripts\\android-current-cache-session.ps1')", `'${win(cache)}'`);
    one("Read 'F:\\AgentVN\\QA\\Editor-1.9.22-20261022-01\\baseline-01.json'",
      `Read '${win(c.installation.path)}'`);
    one("[DateTime]::Parse($taskState.at).ToUniversalTime()",
      "[DateTime]::Parse($taskState.at).ToUniversalTime().AddSeconds(-1)");
    if (c.fixtureKind === "renpy-official")
      one("scripts\\lib\\android-game-upgrade-fixture.cjs", "scripts\\lib\\candidate-1924-renpy-android-fixture.cjs");
  } else {
    one('nativeUpgrade ? "1.9.22" :', `nativeUpgrade ? ${JSON.stringify(c.version)} :`);
    one('read(nativeUpgrade ? "F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json" :',
      `read(nativeUpgrade ? ${JSON.stringify(c.installation.path)} :`);
    one('read(nativeUpgrade ? "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/actual-installation.json" :',
      `read(nativeUpgrade ? ${JSON.stringify(c.actualInstallation.path)} :`);
    one('nativeUpgrade ? "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json" :',
      `nativeUpgrade ? ${JSON.stringify(c.installation.path)} :`);
    one('path.join(root, "scripts/android-current-cache-session.ps1")', JSON.stringify(cache));
    one('"scripts/android-current-cache-session.ps1", "-Action"', `${JSON.stringify(cache)}, "-Action"`);
    one('"ELEVATED_ACTUAL_INSTALLED_1_9_22_NATIVE_UI_ANDROID_SAME_GAME_UPGRADE_BUILD"',
      JSON.stringify(`ELEVATED_ACTUAL_INSTALLED_${c.version.replaceAll(".", "_")}_NATIVE_UI_ANDROID_SAME_GAME_UPGRADE_BUILD`));
    one("timeout: 120000 });", "timeout: 600000 });");
    one("  const upgrade = nativeUpgrade ? retainedAndroidFixture() : null;",
      `  const upgrade = nativeUpgrade ? retainedAndroidFixture() : null;
  if (upgrade) { upgrade.gameVersion = ${JSON.stringify(c.gameVersion)}; upgrade.versionCode = ${c.versionCode}; }
  process.env.AGENTVN_TEST_PROJECT = path.join(out, "Android 隔离小工程.vnproj");
  process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  const qaBinding = ${JSON.stringify(path.join(prep, "binding.json"))};
  report.candidateBinding = desc(qaBinding);
  for (const item of read(qaBinding).sources) assert.equal(sha(item.path), item.sha256);
  fs.copyFileSync(${JSON.stringify(path.join(prep, "business.cjs"))}, path.join(out, "executed-business.cjs"), fs.constants.COPYFILE_EXCL);`);
    // A completed environment failure must propagate immediately, not be swallowed
    // and clicked repeatedly by the generic transport-readiness poller.
    one("      await until(async () => {",
      '      await (async (fn, label, timeout) => { const end=Date.now()+timeout; while(Date.now()<end) { if(await fn()) return; await new Promise(r=>setTimeout(r,150)); } throw Error("Timeout "+label); })(async () => {');
    if (c.fixtureKind === "renpy-official") {
      one('const { retainedAndroidFixture } = require("./lib/android-game-upgrade-fixture.cjs");',
        'const { renpyAndroidFixture: retainedAndroidFixture } = require("./lib/candidate-1924-renpy-android-fixture.cjs");');
      one("scripts/lib/android-game-upgrade-fixture.cjs", "scripts/lib/candidate-1924-renpy-android-fixture.cjs");
      one("  if (upgrade) report.upgradeFixture = upgrade;",
        "  if (upgrade) { report.upgradeFixture = upgrade; report.fixtureProvenance = upgrade.provenance; }");
      one('"QA_ANDROID_UPGRADE_NEW_2"', '"GUI_CONTINUE"');
      one('    report.cartridge = { ...desc(file), manifest, layoutSha256:',
        '    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer");\n' +
        '    assert.equal(JSON.parse(layoutBytes).layout_type, "renpy");\n' +
        '    const previous = await JSZip.loadAsync(fs.readFileSync(upgrade.provenance.priorCartridge.path));\n' +
        '    const originalLayout = JSON.parse(await previous.file("ui/layout.json").async("string"));\n' +
        '    const expectedLayout = require("./lib/gui-export-title-oracle.cjs").expectedExportLayout(originalLayout);\n' +
        '    assert.deepEqual(JSON.parse(layoutBytes), expectedLayout);\n' +
        '    report.titleStyleNormalization = { priorSha256: upgrade.provenance.priorCartridge.layoutSha256,\n' +
        '      exportedSha256: hash(layoutBytes), rule: "Only documented inherited title defaults; all other fields exact" };\n' +
        '    for (const asset of upgrade.provenance.priorCartridge.assets) {\n' +
        '      assert(zip.file(asset.path), asset.path);\n' +
        '      const bytes = await zip.file(asset.path).async("nodebuffer");\n' +
        '      assert.equal(hash(bytes), asset.sha256, asset.id); assert.equal(bytes.length, asset.bytes);\n' +
        '    }\n' +
        '    report.exportedAssetProofs = upgrade.provenance.priorCartridge.assets;\n' +
        '    report.cartridge = { ...desc(file), manifest, layoutSha256:');
      one("NATIVE_UI_ANDROID_SAME_GAME_UPGRADE_BUILD", "NATIVE_UI_RENPY_OFFICIAL_GUI_ANDROID_BUILD");
    }
    if (c.outputDirectoryMode === "controlled-once") {
      one('      report.nativeOutput = await nativeInput({ page, trigger: page.locator(\'[data-help-key="package.chooseOutputDir"]\'),\n' +
        '        out, name: "android-output-select", ownerPid: host.current.pid, selectedPath: destination, timeoutMs: 1200000 });',
        '      report.controlledOutput = await require("./lib/controlled-package-output.cjs").selectControlledPackageOutput({\n' +
        '        page, trigger: page.locator(\'[data-help-key="package.chooseOutputDir"]\'), out, destination, ownerPid: host.current.pid });\n' +
        '      report.nativePickerStatus = "NOT_RUN_CONTROLLED_INPUT";');
      one('"NATIVE_DIRECTORY_SELECTED_BUILD_PENDING"', '"CONTROLLED_DIRECTORY_BUILD_PENDING"');
      one('report.normalUIExportStatus = "PASS_NATIVE_UI"', 'report.normalUIExportStatus = "PASS_UI_CONTROLLED_DIRECTORY"');
      one('"Real Android publish UI, native picker and one elevated APK build"',
        '"Real Android publish UI, controlled directory and one elevated APK build"');
      one('  modelRequests: 0, productChanges: 0, builds: 0, sourceBuilderInvocation: false,',
        '  nativePickerStatus: "NOT_RUN_CONTROLLED_INPUT", outputDirectoryMode: "controlled-once",\n' +
        '  modelRequests: 0, productChanges: 0, builds: 0, sourceBuilderInvocation: false,');
      one('  normalUIExportStatus: "BLOCKED_NATIVE_DIRECTORY_PICKER"',
        '  normalUIExportStatus: "CONTROLLED_DIRECTORY_PENDING"');
    }
    new vm.Script(Module.wrap(source), { filename: file });
  }
  return { source, changes };
}
function prepare(c, configFile) {
  const sealed = validateConfig(c);
  const base = "F:/AgentVN/QA/Android-Package-20261021-01";
  for (const file of [c.preparation, path.join(base, `editor-${c.attempt}`), path.join(base, `administrator-${c.attempt}`)])
    assert(!fs.existsSync(file), "Fresh preparation and ownership directories required");
  const result = Object.fromEntries(Object.keys(originals).map(kind => [kind, build(kind, c)]));
  fs.mkdirSync(c.preparation);
  const save = (name, text) => fs.writeFileSync(path.join(c.preparation, name), text, { flag: "wx" });
  save("business.cjs", result.business.source);
  save("cache.ps1", result.cache.source); save("launcher.ps1", result.launcher.source);
  save("run.cjs", `"use strict";
const fs=require("node:fs"),Module=require("node:module"),path=require("node:path");
const filename=${JSON.stringify(path.join(__dirname, originals.business[0]))};
const worker=new Module(filename,module); worker.filename=filename;
worker.paths=Module._nodeModulePaths(path.dirname(filename));
worker._compile(fs.readFileSync(path.join(__dirname,"business.cjs"),"utf8"),filename);
`);
  save("binding.json", JSON.stringify({
    status: "PREPARED_NOT_PRODUCT_TESTED", config: c, productLaunches: 0, apkBuilds: 0, modelRequests: 0,
    installation: sealed,
    sources: [__filename, configFile, c.installation.path, c.actualInstallation.path,
      ...Object.values(originals).map(([name]) => path.join(__dirname, name)),
      ...(c.fixtureKind === "renpy-official"
        ? [path.join(__dirname, "lib/candidate-1924-renpy-android-fixture.cjs"),
          path.join(__dirname, "lib/gui-export-title-oracle.cjs")] : []),
      ...(c.outputDirectoryMode === "controlled-once"
        ? [path.join(__dirname, "lib/controlled-package-output.cjs")] : []),
      ...["business.cjs", "cache.ps1", "launcher.ps1", "run.cjs"].map(name => path.join(c.preparation, name))].map(describe),
    changes: Object.fromEntries(Object.entries(result).map(([kind, value]) => [kind, value.changes])),
  }, null, 2));
  return { status: "PREPARED_NOT_PRODUCT_TESTED", preparation: c.preparation, launches: 0, apkBuilds: 0 };
}
module.exports = { validateConfig, build, prepare };
if (require.main === module) {
  const [action, configFile] = process.argv.slice(2);
  assert(["prepare", "self-test"].includes(action)); const config = read(configFile);
  if (action === "prepare") console.log(JSON.stringify(prepare(config, configFile)));
  else {
    validateConfig(config); let rejected = 0;
    for (const mutate of [
      c => { c.version = "1.9.24"; }, c => { c.versionCode = 1002; },
      c => { c.gameVersion = "0.1.2"; }, c => { c.preparation = "F:/AgentVN"; },
      c => { c.installation.sha256 = "0".repeat(64); }, c => { c.actualInstallation.sha256 = "0".repeat(64); },
      c => { c.attempt = "../20"; },
    ]) {
      const copy = structuredClone(config); mutate(copy); assert.throws(() => validateConfig(copy)); rejected++;
    }
    for (const kind of Object.keys(originals)) {
      const file = path.join(__dirname, originals[kind][0]), sample = fs.readFileSync(file, "utf8");
      const result = build(kind, config);
      const mutation = sample.replace(result.changes[0].before, "QA_MISSING_REQUIRED_GUARD");
      assert.throws(() => build(kind, config, mutation)); rejected++;
    }
    console.log(JSON.stringify({ status: "PASS", rejected, sourceTransformations:
      Object.fromEntries(Object.keys(originals).map(kind => [kind, build(kind, config).changes.length])),
      productLaunches: 0, apkBuilds: 0 }));
  }
}
