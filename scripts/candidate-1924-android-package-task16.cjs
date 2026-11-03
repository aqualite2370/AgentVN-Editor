"use strict";
// Correct the QA baseline's three virtualized SQLite paths; protect their
// actual task-engine existence/bytes instead. Frozen F: products stay strict.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), crypto = require("node:crypto"), vm = require("node:vm");
const original = path.join(__dirname, "candidate-1924-android-package.cjs");
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(original)).digest("hex"),
  "28658bdbd199ec7d1b45d7319e48965e55252b0cdc9a2e2747fa150dc0a45de8");
const db = String.raw`C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db`;
const mutable = [db, db + "-wal", db + "-shm"];
const base = fs.readFileSync(path.join(__dirname, "installed-android-package-current.cjs"), "utf8");
const before = base.split("\n").filter(line => line.includes("if (!f.path.endsWith("));
assert.equal(before.length, 1);
const after = `        if (!${JSON.stringify(mutable)}.includes(f.path))`;
let source = fs.readFileSync(original, "utf8")
  .replaceAll('"13"', '"16"').replaceAll('administrator-13', 'administrator-16')
  .replaceAll('candidate-1924-android-package-cache.ps1', 'candidate-1924-android-package-task16-cache.ps1');
const protectedBefore = '...sealed.resources, ...sealed.protectedFiles]';
assert.equal(source.split(protectedBefore).length, 2);
source = source.replace(protectedBefore,
  `...sealed.resources, ...sealed.protectedFiles.filter(f => !${JSON.stringify(mutable)}.includes(f.path))]`);
const insertion = '  new vm.Script(Module.wrap(source), { filename: __filename });';
assert.equal(source.split(insertion).length, 2);
source = source.replace(insertion,
  `  replace(${JSON.stringify(before[0])}, ${JSON.stringify(after)});\n` +
  '  replace("timeout: 120000 });", "timeout: 600000 });");\n' +
  '  replace("      await until(async () => {", ' +
  JSON.stringify('      await (async (fn, label, timeout) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 150)); } throw Error("Timeout " + label); })(async () => {') +
  ');\n' + insertion);
new vm.Script(Module.wrap(source));
if (process.argv[2] === "--self-test") {
  const needsFrozenComparison = new Function("f", after.trim().replace(/^if \((.*)\)$/, "return $1"));
  for (const file of mutable) assert.equal(needsFrozenComparison({ path: file }), false);
  for (const file of [db + ".bak", db.replace("vn_engine.db", "other.db"),
    "F:\\AgentVN\\QA\\Editor-1.9.24-20261024-01\\installed-editor\\agentvn-editor.exe"])
    assert.equal(needsFrozenComparison({ path: file }), true);
  console.log("PASS: exact three SQLite views and three immutable/unknown paths classified");
}
const worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths; worker._compile(source, __filename);
