"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), cp = require("node:child_process");
const Module = require("node:module"), { createHash } = require("node:crypto"), JSZip = require("../editor/node_modules/jszip");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { show, hide, line, script } = require("./sprite-hide-rollback-regression.cjs");
const base = "F:/testavn/Windows-Isolated-1987-20261117-01";
const hash = b => createHash("sha256").update(b).digest("hex");
(async () => {
  const source = path.join(__dirname, "renpy-quick-placement-install-stage.cjs");
  let text = fs.readFileSync(source, "utf8");
  function replace(a, b) { assert.equal(text.split(a).length, 2, "Exact staging seam: " + a); text = text.replace(a, b); }
  text = text.replaceAll("Windows-Isolated-1981-20261116-", "Windows-Isolated-1987-20261117-");
  text = text.replaceAll("Editor-Quick-Placement-Release-1981-20261116-01", "Sprite-Position-Gallery-Release-1987-20261117-01");
  replace('assert.equal(release.version, "1.9.81");', 'assert.equal(release.version, "1.9.87");');
  text = text.replaceAll("renpy-quick-placement-installed.cjs", "sprite-position-gallery-installed-1987.cjs");
  const project = fixture("qa-position-gallery1987"); project.title = "站位与画廊验收1987";
  const begin = text.indexOf("let fixture;"), end = text.indexOf("for (const [name, value]", begin);
  assert(begin > 0 && end > begin);
  text = text.slice(0, begin) + `const fixture = ${JSON.stringify(project)};\n` + text.slice(end);
  replace('scope: "NEW1981_DEFAULT_QA_INSTALL_UI_AUTHOR_RESTART_UI_EXPORT_NATIVE032_AND_REAL031_REFUSAL_NOT_UPGRADE",',
    'scope: "NEW1987_DEFAULT_QA_INSTALL_NATIVE_POSITION_GALLERY_PREVIEW_RESTART_FIXED_CARTRIDGES",');
  const runner = new Module(source, module);
  runner.filename = source; runner.paths = Module._nodeModulePaths(path.dirname(source)); runner._compile(text, source);
  const art = JSON.parse(cp.execFileSync("python", ["-c", `
import zipfile,json,base64
with zipfile.ZipFile(r'C:\\Users\\1\\Downloads\\隐忍的成长_20261109_003641.vnproj') as z:
 rows=[]
 for key,needle in [('portrait','乌赫_大衣_常态'),('companion','毕特雷尔_无语'),('background','工业区-')]:
  name=next(n for n in z.namelist() if needle in n)
  rows.append(dict(id=key,path=name,data=base64.b64encode(z.read(name)).decode()))
 print(json.dumps(rows))
`], { encoding: "utf8", windowsHide: true, maxBuffer: 24 * 1024 * 1024 }));
  const prior = JSON.parse(fs.readFileSync("F:/testavn/Windows-Isolated-1985-20261116-02/resource-01/report.json", "utf8"));
  const receipts = [];
  for (const theme of ["agentvn", "renpy"]) for (const project of ["A", "B"]) {
    const exported = prior.exports.find(e => e.type === theme);
    assert.equal(hash(fs.readFileSync(exported.path)), exported.sha256);
    const original = await JSZip.loadAsync(fs.readFileSync(exported.path), { checkCRC32: true });
    const manifest = JSON.parse(await original.file("manifest.json").async("string"));
    const s = script([{ type: "background", background_id: "background" },
      { ...show(), position: "right" }, line("SOLO"),
      { ...show("bob", "companion"), position: "left" }, line("PAIR"),
      { ...show("carol", "companion"), position: "center" }, line("TRIO"),
      hide("bob"), hide("carol"), line("SOLO_AGAIN"),
      { type: "gallery_anchor", anchor_id: "shared_anchor", title: "试玩持久化", asset_id: "background" },
      line("UNLOCKED"), line("AFTER")]);
    const gameId = "qa-position1987-" + theme + "-" + project;
    manifest.game_id = s.game_id = gameId; manifest.title = "站位与画廊验收";
    manifest.runtime_version = "0.32.0";
    manifest.assets = art.map(a => ({ asset_id: a.id, asset_type: a.id === "background" ? "background" : "sprite",
      path: a.path, filename: path.basename(a.path), mime_type: a.path.endsWith(".png") ? "image/png" : "image/jpeg",
      size_bytes: Buffer.from(a.data, "base64").length }));
    const gallery = { gallery_version: "1.0.0", items: [{ item_id: "shared_anchor", anchor_id: "shared_anchor",
      title: "试玩持久化", asset_id: "background", scene_id: "scene", command_index: 10 }] };
    const zip = new JSZip(), files = new Map([
      ["manifest.json", Buffer.from(JSON.stringify(manifest))],
      [manifest.entry_script, Buffer.from(JSON.stringify(s))],
      ["gallery.json", Buffer.from(JSON.stringify(gallery))],
      ["ui/layout.json", await original.file("ui/layout.json").async("nodebuffer")],
    ]);
    for (const a of art) files.set(a.path, Buffer.from(a.data, "base64"));
    for (const [name, bytes] of files) zip.file(name, bytes);
    zip.file("checksum.json", JSON.stringify({ checksum_version: "1.0.0", algorithm: "sha256",
      files: [...files].map(([name, bytes]) => ({ path: name, size_bytes: bytes.length, hash_sha256: hash(bytes) })) }));
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const target = path.join(base, theme + "-" + project + ".vncart");
    fs.writeFileSync(target, bytes, { flag: "wx" });
    receipts.push({ theme, project, gameId, path: target, sha256: hash(bytes), bytes: bytes.length, originalUILayout: exported,
      controlledScript: true, assets: art.map(a => ({ path: a.path, sha256: hash(Buffer.from(a.data, "base64")) })) });
  }
  fs.writeFileSync(path.join(base, "cartridges.json"), JSON.stringify(receipts, null, 2), { flag: "wx" });
  console.log("Four controlled real-art cartridges staged; not new UI-author-export evidence.");
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
