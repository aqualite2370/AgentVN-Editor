#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildSync } = require("../editor/node_modules/esbuild");
const fontkit = require("../editor/node_modules/fontkit");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "editor/src/renpy/fontCoverage.ts");
const compiled = buildSync({ entryPoints: [sourcePath], bundle: true, platform: "node", format: "cjs", write: false });
const loadedModule = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(loadedModule, loadedModule.exports, require);
const { analyzeFontCharacterCoverage, collectRenpyFontCoverageText } = loadedModule.exports;

const complete = analyzeFontCharacterCoverage([65, 66], "ABBA\u200b\uFE0F");
assert.deepEqual(complete, {
  totalCharacters: 2,
  coveredCharacters: 2,
  missingCharacters: 0,
  missingSamples: [],
}, "fully covered text should produce a complete result and ignore non-rendering controls");

const incomplete = analyzeFontCharacterCoverage([65], "ABA中中\uFE0F");
assert.equal(incomplete.totalCharacters, 3, "coverage counts distinct rendered code points");
assert.equal(incomplete.coveredCharacters, 1);
assert.equal(incomplete.missingCharacters, 2);
assert.deepEqual(incomplete.missingSamples, [
  { character: "B", codePoint: "U+0042" },
  { character: "中", codePoint: "U+4E2D" },
]);

const collected = collectRenpyFontCoverageText("项目标题", "作者", ["小雨"], [{
  data: {
    label: "第一章",
    scene: {
      title: "雨夜",
      commands: [
        { type: "dialog", text: "欢迎回来" },
        { type: "choice", choices: [{ choice_display_name: "继续", text: "进入下一幕" }] },
      ],
    },
  },
}]);
for (const text of ["项目标题", "作者", "小雨", "第一章", "雨夜", "欢迎回来", "进入下一幕", "开始游戏", "快读"]) {
  assert(collected.includes(text), `coverage input should include ${text}`);
}
assert(collected.indexOf("雨夜") < collected.indexOf("开始游戏"),
  "project text should be prioritized before shared Runtime labels in missing-glyph samples");

const fontFixtures = [
  ["NotoSans-Regular.ttf", "GameCli_framework/node_modules/harfbuzzjs/test/fonts/noto/NotoSans-Regular.ttf"],
  ["NotoSans-Regular.otf", "GameCli_framework/node_modules/harfbuzzjs/test/fonts/noto/NotoSans-Regular.otf"],
  ["Roboto-400.woff", "GameCli_framework/node_modules/fontverter/testdata/Roboto-400.woff"],
  ["Roboto-400.woff2", "GameCli_framework/node_modules/fontverter/testdata/Roboto-400.woff2"],
];
for (const [name, relativePath] of fontFixtures) {
  const filePath = path.join(root, relativePath);
  assert(fs.existsSync(filePath), `font fixture is missing: ${name}`);
  const parsed = fontkit.create(fs.readFileSync(filePath));
  const faces = parsed.fonts ?? [parsed];
  assert(faces.length > 0, `${name} should expose at least one font face`);
  assert(faces.every((face) => face.characterSet.length > 0), `${name} should expose its character set`);
}

console.log(JSON.stringify({
  status: "PASS",
  analyzer: ["complete", "incomplete", "deduplicated", "control-code filtering", "sample priority"],
  formats: fontFixtures.map(([name]) => name),
}, null, 2));
