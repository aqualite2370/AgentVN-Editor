"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const esbuild = requireEditor("esbuild");
const compiled = esbuild.buildSync({
  stdin: {
    contents: `export { exportCustomComponentArchive, scanCustomComponentArchive } from "./editor/src/renpy/customComponentArchive";`,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(loaded, loaded.exports, requireEditor);

const source = [{
  id: "card-a",
  name: "中文卡片",
  description: "可分享组件",
  html: `<div class="root"><span class="title" data-bind="project.title">标题</span>
    <img class="icon" data-asset="preview" aria-label="预览图" />
    <button type="button" class="button" data-action="open_save_load">存档</button></div>`,
  css: `.root { display: flex; gap: 8px; } .icon { width: 32px; height: 32px; object-fit: contain; }
    .button:hover { background-color: #304050; }`,
  assets: [{
    id: "preview",
    filename: "预览.png",
    mimeType: "image/png",
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  }],
}];

async function main() {
  const archive = await loaded.exports.exportCustomComponentArchive(source);
  const scan = await loaded.exports.scanCustomComponentArchive(archive);
  assert.equal(scan.ok, true, JSON.stringify(scan.issues));
  assert.equal(scan.components.length, 1);
  assert.equal(scan.components[0].name, "中文卡片");
  assert.equal(scan.components[0].definition.root.children[0].binding, "project.title");
  assert.equal(scan.components[0].definition.root.children[1].assetId, "preview");
  assert.deepEqual([...scan.components[0].assets[0].bytes], [...source[0].assets[0].bytes]);

  const JSZip = requireEditor("jszip");
  const archiveZip = await JSZip.loadAsync(archive);
  const manifestObject = JSON.parse(await archiveZip.file("manifest.json").async("string"));
  assert.deepEqual(Object.keys(manifestObject).sort(), ["components", "format", "schemaVersion"],
    "分享包不得夹带工程 ID、会话或凭据");
  const attacks = [
    { files: { "../escape.txt": "x" }, message: "不安全路径" },
    { files: { "assets/0-0.bin": "one", "assets/0-0.BIN": "two" }, message: "重复文件名" },
    { files: { "assets/a.bin": "x".repeat(8 * 1024 * 1024 + 1) }, message: "超过单文件" },
  ];
  for (const { files, message } of attacks) {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "agentvn-component-library", schemaVersion: 1, components: [] }));
    for (const [name, value] of Object.entries(files)) zip.file(name, value, { createFolders: false });
    const hostile = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const result = await loaded.exports.scanCustomComponentArchive(hostile);
    assert.equal(result.ok, false, `${message}归档必须拒绝`);
    assert(result.issues.length > 0);
    assert.match(result.issues.join(" "), new RegExp(message, "u"));
  }

  const symlinkZip = new JSZip();
  symlinkZip.file("manifest.json", JSON.stringify(manifestObject));
  symlinkZip.file("assets/0-0.bin", "link", { createFolders: false, unixPermissions: 0o120777 });
  const symlinkScan = await loaded.exports.scanCustomComponentArchive(
    await symlinkZip.generateAsync({ type: "uint8array", platform: "UNIX" }),
  );
  assert.equal(symlinkScan.ok, false);
  assert.match(symlinkScan.issues.join(" "), /符号链接/u);

  const futureZip = new JSZip();
  futureZip.file("manifest.json", JSON.stringify({ format: "agentvn-component-library", schemaVersion: 2, components: [] }));
  const futureScan = await loaded.exports.scanCustomComponentArchive(
    await futureZip.generateAsync({ type: "uint8array" }),
  );
  assert.equal(futureScan.ok, false);
  assert.match(futureScan.issues.join(" "), /不支持组件包版本/u);

  const tamperedZip = await JSZip.loadAsync(archive);
  tamperedZip.file("assets/0-0.bin", new Uint8Array([1, 2, 3]), { createFolders: false });
  const tamperedScan = await loaded.exports.scanCustomComponentArchive(
    await tamperedZip.generateAsync({ type: "uint8array" }),
  );
  assert.equal(tamperedScan.ok, false);
  assert.match(tamperedScan.issues.join(" "), /SHA-256 校验失败/u);

  const badMarkup = [{
    ...source[0],
    html: `<div class="root"><button onclick="alert(1)">恶意</button></div>`,
  }];
  await assert.rejects(
    () => loaded.exports.exportCustomComponentArchive(badMarkup),
    /安全/iu,
    "导出前也必须拒绝未通过安全转换的标记",
  );
  await assert.rejects(
    () => loaded.exports.exportCustomComponentArchive([{
      ...source[0],
      id: "missing-asset-reference",
      html: `<div class="root"><img data-asset="not-declared" /></div>`,
      css: "",
      assets: [],
    }]),
    /未声明素材/u,
    "组件包必须包含结构引用的全部素材",
  );
  console.log("custom-component-archive-test: PASS");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
