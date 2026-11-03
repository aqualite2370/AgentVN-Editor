"use strict";
// Review the completed download without rerunning or rewriting its failed test.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), JSZip = require("../editor/node_modules/jszip");
const { isDeepStrictEqual } = require("node:util");
const esbuild = require("../editor/node_modules/esbuild");
const { sha } = require("./lib/installed-runtime-session.cjs");
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const sourceRoot = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-56";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const source = read(path.join(sourceRoot, "report.json"));
const installation = read(path.join(base, "installation.json"));
assert.equal(source.status, "FAILED"); assert.equal(source.nativeCacheRestoration, "PASS");
assert.equal(source.cases[0].status, "PASS");
assert.match(source.error, /Expected values to be strictly deep-equal/);
assert.equal(source.cases.length, 2);
assert.equal(installation.executable.sha256, "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");
const sourceFiles = ["uiSkin.ts", "controlPresentation.ts"].map(f =>
  path.join(installation.installRoot, "shared/cartridge", f));
for (const f of sourceFiles) assert.equal(sha(f), sha(path.join(__dirname, "../shared/cartridge", path.basename(f))));
const compiled = esbuild.buildSync({ stdin: {
  contents: 'export { normalizeUISkinLayoutForRuntime } from "./uiSkin"; export { resolveLayoutPresentations } from "./controlPresentation";',
  resolveDir: path.dirname(sourceFiles[0]), loader: "ts",
}, bundle: true, platform: "node", format: "cjs", write: false });
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(loaded, loaded.exports, require);
const expected = loaded.exports.normalizeUISkinLayoutForRuntime(
  loaded.exports.resolveLayoutPresentations(source.profiles.profiles.renpy)).layout;
const files = fs.readdirSync(path.join(sourceRoot, "cartridge")).filter(f => f.endsWith(".vncart"));
assert.equal(files.length, 1);
const cartridgePath = path.join(sourceRoot, "cartridge", files[0]);
function validateLayout(layout) {
  assert.deepEqual(layout, JSON.parse(JSON.stringify(expected)));
  for (const id of ["title_start_button", "title_about_button"]) {
    const find = l => l.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === id);
    assert.deepEqual(find(layout).presentation, find(source.profiles.profiles.renpy).presentation);
  }
  assert.equal(layout.advancedPresentationEnabled, true);
}
(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridgePath), { checkCRC32: true });
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  validateLayout(layout);
  const before = source.profiles.profiles.renpy, changes = [];
  for (const screen of before.screens) for (const c of screen.components) {
    const after = layout.screens.find(s => s.screen_id === screen.screen_id).components.find(n => n.component_id === c.component_id);
    if (!isDeepStrictEqual(c.style, after.style)) {
      assert.equal(screen.screen_id, "title");
      assert.equal(c.titleButtonStyleSource, undefined);
      assert(c.component_type.startsWith("main_menu_"));
      assert.equal(after.style, undefined);
      assert.deepEqual(c.style, loaded.exports.normalizeUISkinLayoutForRuntime(
        { ...before, layout_type: "agentvn", screens: [{ ...screen, components: [c] }] }).layout.screens[0].components[0].style);
      changes.push({ screen: screen.screen_id, component: c.component_id, authoredStyle: c.style,
        reason: "Inherited legacy title base is intentionally not emitted for Renpy; explicit edits and code retained" });
    }
  }
  assert.equal(changes.length, 5);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const asset = manifest.assets.find(a => a.asset_id === "qa-control-image"); assert(asset);
  const prior = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-53/report.json");
  const fixture = read(prior.fixture.path);
  const image = Buffer.from(fixture.asset_manifest.find(a => a.asset_id === asset.asset_id).metadata.data_url.split(",")[1], "base64");
  assert.deepEqual(await zip.file(asset.path).async("nodebuffer"), image);
  const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
  assert(script.scenes.length > 0); assert.equal(manifest.title, fixture.title);
  const portable = await JSZip.loadAsync(fs.readFileSync(source.portable.path), { checkCRC32: true });
  const project = JSON.parse(await portable.file("project.json").async("string"));
  assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, source.profiles);
  assert.equal(sha(source.portable.path), source.portable.sha256);
  assert.equal(sha(source.portable.originalNativePath), source.portable.sha256);
  const mutations = [
    l => { l.advancedPresentationEnabled = false; },
    l => { l.screens[0].components.find(c => c.component_id === "title_start_button").presentation.css = ""; },
    l => { l.screens[0].components.find(c => c.component_id === "title_about_button").presentation.html = ""; },
    l => { l.screens[0].components.find(c => c.component_id === "title_start_button").style = {}; },
  ];
  for (const mutate of mutations) { const bad = structuredClone(layout); mutate(bad); assert.throws(() => validateLayout(bad)); }
  if (process.argv.includes("--self-test")) {
    console.log(JSON.stringify({ status: "PASS", badLayoutsRejected: mutations.length, intentionalInheritedChanges: changes.length }));
    return;
  }
  assert.equal(process.argv[2], "01");
  const out = path.join(base, "control-export-review-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "PASS", at: new Date().toISOString(), scope: "OFFLINE_COMPLETED_UI_DOWNLOAD_NORMALIZATION_AND_BYTES_REVIEW_NOT_PLAYER",
    source: desc(path.join(sourceRoot, "report.json")), installation: desc(path.join(base, "installation.json")),
    tool: desc(__filename), normalizationSources: sourceFiles.map(desc), compiledSourceSha256: hash(compiled.outputFiles[0].text),
    reason: "Raw authored layout equality ignored intentional inherited title-style normalization; historical FAILED preserved",
    inheritedChanges: changes, badLayoutsRejected: mutations.length,
    portable: source.portable, profiles: source.profiles, fixture: prior.fixture,
    nativePicker: source.nativePickerCompletion,
    cartridge: { ...desc(cartridgePath), manifest, layoutSha256: hash(await zip.file("ui/layout.json").async("nodebuffer")),
      image: { assetId: asset.asset_id, path: asset.path, sha256: hash(image), width: 96, height: 64 } },
    modelRequests: 0, productChanges: 0, builds: 0, playerConsumption: "NOT_RUN", nativeDownloadCleanup: "PENDING_PLAYER_CONSUMPTION" };
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, changes: changes.length }));
})().catch(e => { console.error(e); process.exitCode = 1; });
