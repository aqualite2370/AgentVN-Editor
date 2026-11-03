"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const esbuild = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), run = path.join(root, "output/installed-asset-consumers-20261018-01");
const work = "F:/AgentVN-QA-InstalledAssetConsumers-20261018-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const exported = read(path.join(root, "output/installed-assets-20261018-01/cartridge-02/report.json")).cartridge;
const fixture = read(path.join(root, "output/installed-assets-20261018-01/fixtures.json"));
assert(fs.existsSync(work) && !fs.existsSync(path.join(run, "fixtures.json")));
const report = { status: "RUNNING", at: new Date().toISOString(), sourceCartridge: exported,
  scope: "CONTROLLED_DERIVATIVE_CONSUMER_SCRIPT_WITH_EXACT_UI_EXPORTED_NEW_ASSET_BYTES_NOT_REEXPORTED_EDITOR_PROJECT",
  mutationScope: ["script.json", "manifest.json", "checksum.json"], realModelRequests: 0, assetProofs: [], error: null };
(async () => {
  assert.equal(sha(fs.readFileSync(exported.path)), exported.sha256);
  const frozen = read(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
  report.candidateSources = [];
  for (const relative of ["shared/cartridge/packer.ts", "shared/cartridge/checksum.ts", "shared/cartridge/assetScanner.ts",
    "shared/cartridge/assetTaxonomy.ts", "GameCli_framework/src/cartridge/importCartridge.ts"]) {
    const file = path.join(root, relative), expected = frozen.source.find(r => path.resolve(r.path).toLowerCase() === file.toLowerCase());
    assert(expected, `Missing frozen source ${relative}`); assert.equal(sha(fs.readFileSync(file)), expected.sha256);
    report.candidateSources.push({ relative, sha256: expected.sha256 });
  }
  const built = esbuild.buildSync({ stdin: { contents: `
    export { packCartridgeToUint8Array } from "./shared/cartridge/packer";
    export { importRuntimeCartridgeFromArrayBuffer } from "./GameCli_framework/src/cartridge/importCartridge";
  `, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false,
    nodePaths: [path.join(root, "editor/node_modules")] });
  const mod = { exports: {} }; new Function("require", "module", "exports", built.outputFiles[0].text)(require, mod, mod.exports);
  const api = mod.exports, zip = await JSZip.loadAsync(fs.readFileSync(exported.path));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  // Preserve all asset identities and bytes; only introduce explicit consumer
  // commands. This is a diagnostic fixture, not falsely a real authoring flow.
  manifest.game_id = "qa-installed-replaced-asset-consumers-20261018";
  manifest.title = "替换素材真实消费探针_20261018";
  manifest.entry_scene_id = "consumer";
  script.game_id = manifest.game_id; script.title = manifest.title; script.entry_scene_id = "consumer";
  script.characters = [{ character_id: "qa_actor", name: "QA Actor" }];
  script.scenes = [{ scene_id: "consumer", title: "Consumer", summary: "Controlled installed-player consumption probe",
    chapter: 1, tags: ["qa"], is_ending: true, commands: [
      { type: "background", background_id: "qa_background", background_fit: "contain" },
      { type: "sprite", character_id: "qa_actor", sprite_id: "qa_sprite", visible: true, position: "left", scale: .5 },
      { type: "bgm", bgm_id: "qa_bgm", action: "play", volume: .5, fade_ms: 0 },
      { type: "dialog", character_id: "qa_actor", portrait: "qa_portrait", voice: "qa_voice", font_asset_id: "qa_font",
        text: "QA_CONSUMER_DIALOG_FONT_VOICE_SPRITE" },
      { type: "sfx", sfx_id: "qa_sfx", volume: .5 },
      { type: "narration", text: "QA_CONSUMER_SFX_HOLD" },
      { type: "show_image", image_id: "qa_ui", alt: "QA_CONSUMER_UI", caption: "QA_CONSUMER_UI" },
      { type: "show_image", image_id: "qa_other", alt: "QA_CONSUMER_OTHER", caption: "QA_CONSUMER_OTHER" },
      { type: "show_image", image_id: "qa_portrait", alt: "QA_CONSUMER_PORTRAIT", caption: "QA_CONSUMER_PORTRAIT" },
      { type: "video", video_id: "qa_video", video_fit: "contain", fade_in_ms: 0, fade_out_ms: 0 },
      { type: "narration", text: "QA_CONSUMER_FINISHED_AFTER_VIDEO" },
    ] }];
  const assets = [];
  for (const row of fixture.types) {
    const item = manifest.assets.find(a => a.asset_id === row.id); assert(item);
    const bytes = await zip.file(item.path).async("nodebuffer");
    assert.equal(sha(bytes), row.files.new.sha256);
    assets.push({ path: item.path, data: new Uint8Array(bytes) });
    report.assetProofs.push({ id: row.id, type: row.type, path: item.path, bytes: bytes.length, sha256: sha(bytes),
      consumedBy: row.type === "animation" ? "STORAGE_ONLY_LEGACY_OTHER_NO_RUNTIME_JSON_READER"
        : row.type === "portrait" ? "dialog-portrait-observation-and-generic-image-overlay"
        : row.type === "other" ? "supported-generic-show_image-not-specialized-selector" : "dedicated-runtime-command" });
  }
  const uiPath = manifest.ui_skin?.path, uiSkin = uiPath ? JSON.parse(await zip.file(uiPath).async("string")) : undefined;
  const gallery = JSON.parse(await zip.file("gallery.json").async("string"));
  const metadata = {};
  for (const field of ["credits", "changelog", "license"]) {
    const entry = zip.file(`metadata/${field}.json`);
    if (entry) metadata[field] = JSON.parse(await entry.async("string"));
  }
  const packed = await api.packCartridgeToUint8Array({ manifest, script, gallery, uiSkin, assets, metadata });
  const validated = await api.importRuntimeCartridgeFromArrayBuffer(packed.buffer, "consumer.vncart");
  assert.equal(validated.validation.ok, true);
  report.output = { path: path.join(work, "consumer.vncart"), sha256: sha(packed), bytes: packed.length,
    candidateValidation: "PASS", validationWarnings: validated.validation.warnings };
  fs.writeFileSync(report.output.path, packed, { flag: "wx" });
  const packedZip = await JSZip.loadAsync(packed);
  // Every original non-metadata payload, including ui/layout, is unchanged.
  report.unchangedEntries = [];
  for (const entry of Object.values(zip.files).filter(f => !f.dir && !report.mutationScope.includes(f.name))) {
    const newer = packedZip.file(entry.name); assert(newer, `Missing preserved entry ${entry.name}`);
    const originalBytes = await entry.async("nodebuffer"), nextBytes = await newer.async("nodebuffer");
    assert(originalBytes.equals(nextBytes), `Unexpected fixture change to ${entry.name}`);
    report.unchangedEntries.push({ path: entry.name, sha256: sha(originalBytes) });
  }
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(run, "fixtures.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, assets: report.assetProofs.length, output: report.output, error: report.error }, null, 2));
});
