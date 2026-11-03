"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const { allowed, inside, ROOT } = require("./output-cache-inventory.cjs");
const cases = [
  ["historical GPU cache", "old-test/webview/EBWebView/Default/DawnWebGPUCache", true],
  ["root shader cache", "old-test/webview/EBWebView/GrShaderCache", true],
  ["persistent graphics cache", "old-test/webview/EBWebView/GPUPersistentCache/DawnGraphiteCache", true],
  ["entire profile forbidden", "old-test/webview/EBWebView", false],
  ["database forbidden", "old-test/webview/EBWebView/Default/Local Storage", false],
  ["unknown cache forbidden", "old-test/Cache", false],
  ["nested evidence forbidden", "old-test/webview/EBWebView/Default/DawnWebGPUCache/report", false],
  ["checkpoint protected", "checkpoints/old/webview/EBWebView/Default/Cache", false],
  ["final delivery protected", "final-hidden-growth-installed-20261017-01/webview/EBWebView/Default/Cache", false],
  ["actual installation protected", "novel-card-position-release-20261017-01/webview/EBWebView/Default/Cache", false],
  ["cleanup evidence protected", "cleanup-audit-test/webview/EBWebView/Default/Cache", false],
  ["outside root forbidden", "../data/test/EBWebView/Default/Cache", false],
];
for (const [name, rel, expected] of cases) assert.equal(allowed(ROOT, path.resolve(ROOT, rel)), expected, name);
assert.equal(inside(ROOT, ROOT), false);
assert.equal(inside(ROOT, `${ROOT}-neighbor`), false);
console.log(`PASS: ${cases.length + 2} cleanup path boundary checks; no files deleted`);
