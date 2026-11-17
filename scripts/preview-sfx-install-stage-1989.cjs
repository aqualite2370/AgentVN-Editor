"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Windows-Isolated-1989-20261117-01";
const source = path.join(__dirname, "renpy-quick-placement-install-stage.cjs");
let text = fs.readFileSync(source, "utf8")
  .replaceAll("Windows-Isolated-1981-20261116-", "Windows-Isolated-1989-20261117-")
  .replaceAll("Editor-Quick-Placement-Release-1981-20261116-01", "Preview-Sfx-Release-1989-20261117-01")
  .replaceAll('"1.9.81"', '"1.9.89"').replaceAll('"0.32.0"', '"0.33.0"').replaceAll("RUNTIME032", "RUNTIME033")
  .replaceAll("renpy-quick-placement-installed.cjs", "preview-sfx-installed-1989.cjs");
const begin = text.indexOf("let fixture;"), end = text.indexOf("for (const [name, value]", begin);
assert(begin > 0 && end > begin);
const project = require("./lib/editor-ui-acceptance.cjs").fixture("qa-preview-sfx-1989");
project.title = "画廊选项与音效1989";
text = text.slice(0, begin) + `const fixture = ${JSON.stringify(project)};\n` + text.slice(end);
const runner = new Module(source, module);
runner.filename = source; runner.paths = Module._nodeModulePaths(path.dirname(source)); runner._compile(text, source);
const m = { exports: {} };
new Function("module", "exports", "require", buildSync({ stdin: { resolveDir: root, contents: `
export {packCartridgeToUint8Array} from './shared/cartridge/packer';
export {createRenpyUILayout} from './shared/cartridge/uiLayoutProfiles';
export {getDefaultUISkinLayout} from './shared/cartridge/uiSkin';` },
  platform: "node", format: "cjs", bundle: true, write: false,
  nodePaths: [path.join(root, "editor/node_modules")] }).outputFiles[0].text)(m, m.exports, require);
(async () => {
  const samples = 8000 * 20, wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(120 * Math.sin(i * Math.PI * 2 * 220 / 8000)), 44 + i * 2);
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#66557e"/></svg>';
  const rows = [];
  for (const theme of ["agentvn", "renpy"]) {
    const id = "qa-preview-sfx-1989-" + theme;
    const manifest = { manifest_version: "1.0.0", cartridge_version: "1.0.0", game_id: id, title: "音效与画廊选项", author: "QA", version: "1.0.0",
      description: "", entry_script: "script.json", runtime_version: "0.33.0", tags: [], language: "zh-CN",
      entry_scene_id: "main", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      ui_skin: { path: "ui/layout.json", version: "1.0.0" },
      assets: [{ asset_id: "cg", asset_type: "ui", path: "assets/cg.svg", mime_type: "image/svg+xml", size_bytes: image.length },
        ...["tone", "other"].map(asset_id => ({ asset_id, asset_type: "sfx", path: `assets/${asset_id}.wav`, mime_type: "audio/wav", size_bytes: wav.length }))] };
    const script = { schema_version: "1.0.0", game_id: id, title: manifest.title, entry_scene_id: "main", scenes: [{
      scene_id: "main", title: "测试剧情", summary: "", tags: [], chapter: 1, commands: [
        { type: "sfx", sfx_id: "tone", volume: .8 }, { type: "sfx", sfx_id: "tone", volume: .6 }, { type: "sfx", sfx_id: "other", volume: .5 },
        { type: "narration", text: "PLAYING" }, { type: "sfx", sfx_id: "tone", action: "stop", fade_ms: 750 },
        { type: "narration", text: "STOPPING" }, { type: "sfx", sfx_id: "tone" }, { type: "narration", text: "NEW_SOUND" },
        { type: "sfx", sfx_id: "", action: "stop", fade_ms: 0 }, { type: "narration", text: "ALL_STOPPED" },
        { type: "gallery_anchor", anchor_id: "anchor", title: "画廊", asset_id: "cg" }, { type: "narration", text: "UNLOCKED" },
      ],
    }] };
    const bytes = await m.exports.packCartridgeToUint8Array({ manifest, script,
      uiSkin: theme === "renpy" ? m.exports.createRenpyUILayout() : m.exports.getDefaultUISkinLayout(),
      gallery: { gallery_version: "1.0.0", items: [{ item_id: "anchor", anchor_id: "anchor", scene_id: "main", command_index: 10, title: "画廊", asset_id: "cg" }] },
      assets: [{ path: "assets/cg.svg", data: image }, ...["tone", "other"].map(id => ({ path: `assets/${id}.wav`, data: wav }))] });
    const target = path.join(base, theme + ".vncart"); fs.writeFileSync(target, bytes, { flag: "wx" });
    rows.push({ theme, gameId: id, path: target, sha256: require("./lib/file-sha256-bounded.cjs").hashFileSha256(target) });
  }
  fs.writeFileSync(path.join(base, "cartridges.json"), JSON.stringify(rows, null, 2), { flag: "wx" });
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
