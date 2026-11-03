"use strict";
// Same candidate/UI workflow, separate terminal evidence and unvirtualized host.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), crypto = require("node:crypto"), vm = require("node:vm");
const original = path.join(__dirname, "candidate-1924-android-package.cjs");
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(original)).digest("hex"),
  "28658bdbd199ec7d1b45d7319e48965e55252b0cdc9a2e2747fa150dc0a45de8");
let source = fs.readFileSync(original, "utf8")
  .replaceAll('"13"', '"14"').replaceAll('administrator-13', 'administrator-14')
  .replaceAll('candidate-1924-android-package-cache.ps1', 'candidate-1924-android-package-task-cache.ps1');
const insertion = '  new vm.Script(Module.wrap(source), { filename: __filename });';
assert.equal(source.split(insertion).length, 2);
// Inventory checks can take longer than two minutes. Waiting here does not
// retry product actions. A failed environment must stop at its first failure.
source = source.replace(insertion,
  '  replace("timeout: 120000 });", "timeout: 600000 });");\n' +
  '  replace("      await until(async () => {", ' +
  JSON.stringify('      await (async (fn, label, timeout) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 150)); } throw Error("Timeout " + label); })(async () => {') +
  ');\n' + insertion);
new vm.Script(Module.wrap(source));
const worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths; worker._compile(source, __filename);
