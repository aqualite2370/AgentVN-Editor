"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `export { scanRenpyGuiArchive } from './editor/src/renpy/renpyGuiImport';`,
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
new Function("module", "exports", "require", compiled.outputFiles[0].text)(
  loaded,
  loaded.exports,
  requireEditor,
);

(async () => {
  const zip = new (requireEditor("jszip"))();
  zip.file("gui.rpy", [
    "define gui.interface_text_size = 25",
    "define gui.navigation_xpos = 44",
  ].join("\n"));
  zip.file("gui/button/idle.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  zip.file("gui/fonts/中文字体.ttf", new Uint8Array([0, 1, 0, 0]));
  zip.file("screens.rpy", "screen arbitrary_code():\n    pass");
  const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const result = await loaded.exports.scanRenpyGuiArchive(bytes);

  assert.equal(result.parameters.values.shared.fontSize, 25);
  assert.equal(result.parameters.values.shared.x, 44);
  assert.deepEqual(result.assets.map(({ path: assetPath, kind }) => [assetPath, kind]), [
    ["gui/button/idle.png", "image"],
    ["gui/fonts/中文字体.ttf", "font"],
  ], "扫描应识别中文路径下的受支持图片和字体，只读预览字节");
  assert(result.issues.some((issue) => issue.code === "unsupported_script" && issue.path === "screens.rpy"),
    "screens.rpy 必须明确报告不导入，不能执行或静默忽略");
  assert.equal(result.complete, false);

  const traversalZip = new (requireEditor("jszip"))();
  traversalZip.file("aa/gui.rpy", "define gui.interface_text_size = 20");
  const safeBytes = Buffer.from(await traversalZip.generateAsync({ type: "uint8array" }));
  const safePathBytes = Buffer.from("aa/gui.rpy");
  const traversalPathBytes = Buffer.from("../gui.rpy");
  let replacements = 0;
  for (let offset = 0; (offset = safeBytes.indexOf(safePathBytes, offset)) >= 0; offset += safePathBytes.length) {
    traversalPathBytes.copy(safeBytes, offset);
    replacements += 1;
  }
  assert(replacements >= 2, "测试夹具应同时修改 ZIP 本地头和 central directory 路径");
  const traversal = await loaded.exports.scanRenpyGuiArchive(new Uint8Array(safeBytes));
  assert(traversal.issues.some((issue) => issue.code === "unsafe_path"),
    "ZIP 路径穿越必须拒绝整个导入，而不是只隐藏越界文件");
  assert.deepEqual(traversal.assets, []);

  const symlinkZip = new (requireEditor("jszip"))();
  symlinkZip.file("gui.rpy", "define gui.interface_text_size = 20");
  symlinkZip.file("gui/button/idle.png", "gui/button/normal.png", { unixPermissions: "120777" });
  const symlink = await loaded.exports.scanRenpyGuiArchive(
    new Uint8Array(await symlinkZip.generateAsync({ type: "uint8array", platform: "UNIX" })),
  );
  assert(symlink.issues.some((issue) => issue.code === "symbolic_link"),
    "ZIP 符号链接必须拒绝整个导入");
  assert.deepEqual(symlink.assets, []);

  const bombZip = new (requireEditor("jszip"))();
  bombZip.file("gui.rpy", "define gui.interface_text_size = 20");
  bombZip.file("gui/images/repeated.png", new Uint8Array(512 * 1024));
  const bomb = await loaded.exports.scanRenpyGuiArchive(
    new Uint8Array(await bombZip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    })),
  );
  assert(bomb.issues.some((issue) => issue.code === "archive_limit"),
    "超限压缩比必须在解压并读取素材字节前拒绝");
  assert.deepEqual(bomb.assets, []);

  const invalidAssetZip = new (requireEditor("jszip"))();
  invalidAssetZip.file("gui.rpy", "define gui.interface_text_size = 20");
  invalidAssetZip.file("gui/images/not-really.png", "not an image");
  const invalidAsset = await loaded.exports.scanRenpyGuiArchive(
    new Uint8Array(await invalidAssetZip.generateAsync({ type: "uint8array" })),
  );
  assert(invalidAsset.issues.some((issue) => issue.code === "invalid_asset"),
    "只允许内容签名与扩展名一致的图片/字体进入映射预览");
  assert.deepEqual(invalidAsset.assets, []);

  const duplicateZip = new (requireEditor("jszip"))();
  duplicateZip.file("gui.rpy", "define gui.interface_text_size = 20");
  duplicateZip.file("same.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  duplicateZip.file("diff.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  const duplicateBytes = Buffer.from(await duplicateZip.generateAsync({ type: "uint8array" }));
  const duplicateFrom = Buffer.from("diff.png");
  const duplicateTo = Buffer.from("same.png");
  let duplicateReplacements = 0;
  for (let offset = 0; (offset = duplicateBytes.indexOf(duplicateFrom, offset)) >= 0; offset += duplicateFrom.length) {
    duplicateTo.copy(duplicateBytes, offset);
    duplicateReplacements += 1;
  }
  assert(duplicateReplacements >= 2);
  const duplicate = await loaded.exports.scanRenpyGuiArchive(new Uint8Array(duplicateBytes));
  assert(duplicate.issues.some((issue) => issue.code === "unsafe_path" && /重名/.test(issue.message)),
    "原始 ZIP 中的重复条目必须在 JSZip 折叠文件名之前检测并拒绝");
  assert.deepEqual(duplicate.assets, []);
  console.log("PASS Ren’Py GUI archive read-only scan");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
