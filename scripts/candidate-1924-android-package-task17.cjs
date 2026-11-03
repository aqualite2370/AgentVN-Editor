"use strict";
// Fresh ownership/request after task16's native-input timeout. No product changes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), crypto = require("node:crypto"), vm = require("node:vm");
const original = path.join(__dirname, "candidate-1924-android-package-task16.cjs");
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(original)).digest("hex"),
  "f5d2741c4e101512f8fe9365cf79288e907f2323b0008f262721d01fc9125871");
let source = fs.readFileSync(original, "utf8");
for (const [before, after] of [
  ['\'"16"\'', '\'"17"\''],
  ["'administrator-16'", "'administrator-17'"],
  ["candidate-1924-android-package-task16-cache.ps1", "candidate-1924-android-package-task17-cache.ps1"],
]) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after);
}
new vm.Script(Module.wrap(source), { filename: __filename });
const worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
