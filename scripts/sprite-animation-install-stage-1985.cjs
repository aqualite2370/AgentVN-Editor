"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { createSpritePreview } = require("./lib/sprite-preview-fixture.cjs");
const JSZip = require("../editor/node_modules/jszip");
(async () => {
const source = path.join(__dirname, "renpy-quick-placement-install-stage.cjs");
let text = fs.readFileSync(source, "utf8");
function replace(a, b) { assert.equal(text.split(a).length, 2, "Exact staging seam: " + a); text = text.replace(a, b); }
text = text.replaceAll("Windows-Isolated-1981-20261116-", "Windows-Isolated-1985-20261116-");
text = text.replaceAll("Editor-Quick-Placement-Release-1981-20261116-01", "Sprite-Animation-Release-1985-20261116-01");
replace('assert.equal(release.version, "1.9.81");', 'assert.equal(release.version, "1.9.85");');
replace('for (const name of ["renpy-quick-placement-installed.cjs", "audit-installed-editor-marker.cjs"]) stage(name);',
  'for (const name of ["sprite-animation-installed-1985.cjs", "audit-installed-editor-marker.cjs"]) stage(name);');
replace('const entry = path.join(staged, "renpy-quick-placement-installed.cjs");',
  'const entry = path.join(staged, "sprite-animation-installed-1985.cjs");');
if (process.argv[2] === "--remaining-03")
  text = text.replaceAll("sprite-animation-installed-1985.cjs", "sprite-animation-runtime-1985.cjs");
const project = fixture("qa-sprite-animation-1985");
project.title = "全局立绘动画与尺寸1985";
const generated = createSpritePreview({ manifest: {}, script: {}, uiSkin: {}, type: "agentvn" });
project.asset_manifest = generated.message.manifest.assets.map(asset => ({
  asset_id: asset.asset_id, asset_type: "sprite",
  metadata: { filename: path.basename(asset.path), mime_type: "image/png", size_bytes: asset.size_bytes,
    data_url: generated.message.assetUrls[asset.asset_id], source: "imported" },
}));
project.nodes[1].data.scene.commands = generated.message.script.scenes[0].commands;
if (process.argv[2] === "--remaining") {
  const prior = "F:/testavn/Windows-Isolated-1985-20261116-01";
  const retired = JSON.parse(fs.readFileSync(path.join(prior, "account-retirement-01.json"), "utf8").replace(/^\uFEFF/, ""));
  assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
  Object.assign(project, JSON.parse(fs.readFileSync(path.join(prior, "resource-01/authored.vnproj"), "utf8")));
  const previous = JSON.parse(fs.readFileSync(path.join(prior, "resource-01/report.json"), "utf8"));
  const zip = await JSZip.loadAsync(fs.readFileSync(previous.exports[0].path), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  // Rehydrate from the retained actual UI cartridge after the old QA profile retires.
  for (const asset of project.asset_manifest) {
    const exported = manifest.assets.find(item => item.asset_id === asset.asset_id); assert(exported);
    const bytes = await zip.file(exported.path).async("nodebuffer");
    const original = Buffer.from(generated.message.assetUrls[asset.asset_id].split(",")[1], "base64");
    assert.deepEqual(bytes, original);
    asset.metadata = { filename: asset.metadata.filename, mime_type: "image/png", size_bytes: bytes.length,
      source: "imported", data_url: "data:image/png;base64," + bytes.toString("base64") };
  }
}
const start = text.indexOf("let fixture;"), end = text.indexOf("for (const [name, value]", start);
assert(start >= 0 && end > start);
text = text.slice(0, start) + `const fixture = ${JSON.stringify(project)};\n` + text.slice(end);
replace('scope: "NEW1981_DEFAULT_QA_INSTALL_UI_AUTHOR_RESTART_UI_EXPORT_NATIVE032_AND_REAL031_REFUSAL_NOT_UPGRADE",',
  'scope: "NEW1985_DEFAULT_QA_INSTALL_GLOBAL_SPRITE_SAVE_RESTART_TWO_THEME_UI_EXPORT_NATIVE_RASTER_CONSUMPTION",');
const preparer = new Module(source, module);
preparer.filename = source; preparer.paths = Module._nodeModulePaths(path.dirname(source));
preparer._compile(text, source);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
