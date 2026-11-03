"use strict";
// QA only. Fresh authored fixture -> actual installed Editor -> one APK build.
// The preserved generator and product sources are never rewritten.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const JSZip = require("../editor/node_modules/jszip");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const current = require("./installed-android-current-functional.cjs");
const wm = require("./android-current-controlled-wm.cjs");
const { validateConfig } = require("./installed-editor-android-candidate.cjs");
const qa = path.resolve("F:/AgentVN/QA/Functional-Continuation-20261101");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const one = (s, a, b) => { assert.equal(s.split(a).length - 1, 1, a); return s.replace(a, () => b); };
function within(file) {
  const relative = path.relative(qa, path.resolve(file));
  assert(relative && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..");
}
function narrativeFixture(receiptFile) {
  within(receiptFile);
  const receipt = read(receiptFile);
  assert.equal(receipt.status, "FIXTURE_VALIDATED");
  assert.equal(sha(receipt.input), receipt.sha256);
  assert.equal(sha(receipt.repackedProject.path), receipt.repackedProject.sha256);
  const project = read(receipt.repackedProject.path);
  assert.equal(project.project_id, receipt.projectId);
  assert(project.project_id.startsWith("installed_resource_flow_story_"));
  assert.deepEqual(project.nodes.filter(n => n.data?.scene).map(n => n.data.scene.scene_id).sort(),
    ["bubble", "finish", "main", "nvl"]);
  assert.equal(project.editor_settings.runtimeUILayoutProfiles.activeType, "renpy");
  assert.equal(project.asset_manifest.length, 3);
  for (const asset of project.asset_manifest) {
    assert.equal(asset.metadata.filePath, undefined); assert.equal(asset.metadata.url, undefined);
    assert.match(asset.metadata.data_url, /^data:(image\/png|audio\/wav);base64,/);
    const bytes = Buffer.from(asset.metadata.data_url.split(",")[1], "base64");
    assert.equal(require("node:crypto").createHash("sha256").update(bytes).digest("hex"), asset.metadata.hash_sha256);
  }
  const scenes = project.nodes.filter(n => n.data?.scene).map(n => n.data.scene);
  const nvl = scenes.find(s => s.scene_id === "nvl");
  assert(nvl.commands.some(c => c.clear_nvl_page_before === true));
  const bubble = scenes.find(s => s.scene_id === "bubble");
  assert(bubble.commands.some(c => c.bubble_position?.mode === "fixed"));
  assert(bubble.commands.some(c => c.type === "sprite" && c.visible === false));
  assert(!JSON.stringify(project).includes("provider_secrets"));
  return { project, gameVersion: "0.1.6", versionCode: 1006,
    applicationId: "com.agentvn.qa.narrative20261102", source: desc(receiptFile),
    provenance: { generator: receipt.generator, input: desc(receipt.input),
      project: receipt.repackedProject, preparedOnly: true, runtimeClaimed: false } };
}
function business(c, source) {
  source = wm.business(source);
  source = one(source, 'const { retainedAndroidFixture } = require("./lib/android-game-upgrade-fixture.cjs");',
    'const { narrativeFixture: retainedAndroidFixture } = require("./android-current-story-package.cjs");');
  source = one(source, 'retainedAndroidFixture() : null;',
    'retainedAndroidFixture(' + JSON.stringify(c.storyFixture.path) + ') : null;');
  source = one(source, '"QA_ANDROID_UPGRADE_NEW_2"', '"验收结束："');
  source = one(source, '    report.cartridge = { ...desc(file), manifest, layoutSha256:',
    '    assert.deepEqual(script.scenes.map(s => s.scene_id).sort(), ["bubble","finish","main","nvl"]);\n' +
    '    for (const authored of project.nodes.filter(n => n.data?.scene).map(n => n.data.scene)) {\n' +
    '      const exported = script.scenes.find(s => s.scene_id === authored.scene_id);\n' +
    '      assert.deepEqual(exported.commands.filter(c => c.text).map(c => c.text),\n' +
    '        authored.commands.filter(c => c.text).map(c => c.text));\n' +
    '    }\n' +
    '    report.storyFixture = upgrade.source;\n' +
    '    report.cartridge = { ...desc(file), manifest, layoutSha256:');
  source = one(source, '      report.materializedWorkspace = { path: workspace, observedAt: new Date().toISOString(), files };',
    '      for (const f of files) {\n' +
    '        const relative = path.relative(base, f.path);\n' +
    '        assert(relative && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..");\n' +
    '        const archived = path.join(out, "native-standalone-package", relative);\n' +
    '        fs.mkdirSync(path.dirname(archived), { recursive: true });\n' +
    '        fs.copyFileSync(f.path, archived, fs.constants.COPYFILE_EXCL);\n' +
    '        assert.equal(sha(archived), f.sha256); f.archivedBytes = desc(archived);\n' +
    '      }\n' +
    '      report.materializedWorkspace = { path: workspace, observedAt: new Date().toISOString(), files };');
  source = source.replaceAll("NATIVE_UI_ANDROID_SAME_GAME_UPGRADE_BUILD", "NATIVE_UI_AUTHORED_NARRATIVE_ANDROID_BUILD");
  new vm.Script(Module.wrap(source)); return source;
}
async function prepare(attempt) {
  assert.match(attempt, /^\d{2}$/);
  const out = path.join(qa, "android-story-input-" + attempt); within(out); assert(!fs.existsSync(out));
  const generator = require.resolve("./prepare-full-story-acceptance-input.cjs");
  let source = fs.readFileSync(generator, "utf8");
  source = one(source, 'path.join(root, "output")', JSON.stringify(qa));
  source = one(source, 'const output = path.resolve(process.argv[2] || "");',
    'const output = ' + JSON.stringify(out) + ';');
  source = one(source, 'assert(process.argv[2], "Pass a fresh isolated output directory");', 'assert(output);');
  source = one(source, 'assert(process.argv.slice(3).every(arg => arg === "--agentvn-default"), "Unknown fixture option");', '');
  source = one(source, 'const agentvnDefault = process.argv.includes("--agentvn-default");', 'const agentvnDefault = false;');
  source = one(source, 'main().catch(error => { console.error(error); process.exitCode = 1; });',
    'module.exports = { main };');
  const worker = new Module(generator, module); worker.filename = generator; worker.paths = module.paths;
  worker._compile(source, generator); await worker.exports.main();
  const receiptFile = path.join(out, "fixture-report.json"), receipt = read(receiptFile);
  const zip = await JSZip.loadAsync(fs.readFileSync(receipt.input), { checkCRC32: true });
  const project = JSON.parse(await zip.file("project.json").async("string"));
  for (const asset of project.asset_manifest) {
    const bytes = await zip.file(asset.metadata.project_path).async("nodebuffer");
    asset.metadata.data_url = `data:${asset.metadata.mime_type};base64,${bytes.toString("base64")}`;
  }
  const projectFile = path.join(out, "完整剧情 受控输入.json");
  fs.writeFileSync(projectFile, JSON.stringify(project), { flag: "wx" });
  receipt.repackedProject = desc(projectFile); receipt.generator = desc(generator);
  const finalReceipt = path.join(out, "transport-fixture.json");
  fs.writeFileSync(finalReceipt, JSON.stringify(receipt, null, 2), { flag: "wx" });
  narrativeFixture(finalReceipt);
  const original = read(path.join(qa, "android-current-config-34.json"));
  const c = { ...original, attempt, gameVersion: "0.1.6", versionCode: 1006,
    preparation: path.join(qa, "android-story-preparation-" + attempt), storyFixture: desc(finalReceipt) };
  const configFile = path.join(qa, "android-story-current-config-" + attempt + ".json");
  assert(!fs.existsSync(configFile)); validateConfig(c);
  fs.writeFileSync(configFile, JSON.stringify(c, null, 2), { flag: "wx" });
  current.adapter().prepare(c, configFile);
  const businessFile = path.join(c.preparation, "business.cjs");
  fs.writeFileSync(businessFile, business(c, fs.readFileSync(businessFile, "utf8")));
  const bindingFile = path.join(c.preparation, "binding.json"), b = read(bindingFile);
  b.sources = b.sources.map(f => desc(f.path));
  b.sources.push(...[__filename, finalReceipt, projectFile, receipt.input, generator,
    require.resolve("./android-current-controlled-wm.cjs"), require.resolve("./lib/editor-upgrade-wm-close.cjs"),
    require.resolve("./lib/windows-repository-native.cjs")].map(desc));
  b.inputBoundary = { directory: "CONTROLLED_ONCE", close: "WM_CLOSE", physicalInput: false };
  fs.writeFileSync(bindingFile, JSON.stringify(b, null, 2));
  console.log(JSON.stringify({ status: "PREPARED_NOT_LAUNCHED", configFile,
    bindingFile, launcher: path.join(c.preparation, "launcher.ps1"), storyFixture: finalReceipt }));
}
function selfTest(configFile) {
  const c = read(configFile); validateConfig(c);
  const fixture = narrativeFixture(c.storyFixture.path);
  const generated = business(c, current.adapter().build("business", c).source);
  assert(generated.includes('f.archivedBytes = desc(archived)'));
  assert(generated.includes('selectControlledPackageOutput'));
  const b = read(path.join(c.preparation, "binding.json"));
  for (const f of b.sources) assert.equal(sha(f.path), f.sha256);
  console.log(JSON.stringify({ status: "PASS", scenes: 4, assets: fixture.project.asset_manifest.length,
    installedWorkflowParsed: true, actualInputArchivalEnabled: true, productChanges: 0, builds: 0, modelRequests: 0 }));
}
module.exports = { narrativeFixture };
if (require.main === module) {
  const [action, arg] = process.argv.slice(2);
  Promise.resolve().then(() => {
    if (action === "prepare") return prepare(arg);
    assert.equal(action, "self-test"); return selfTest(arg);
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
