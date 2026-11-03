"use strict";
// QA binding only. Keep the previous installed migration evidence reproducible.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), Module = require("node:module");
const { sha } = require("./lib/installed-runtime-session.cjs");
const [action, configFile] = process.argv.slice(2);
assert(["self-test", "run", "cleanup", "verify-cleanup", "audit"].includes(action));
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
assert.equal(config.version, "1.9.40");
assert.equal(config.oldVersion, "1.7.1");
assert.equal(config.closeMode, "computer-use");
const original = path.join(__dirname, "editor-cross-computer-use-current.cjs");
assert.equal(sha(original), "f77ae75a7507d31ba0b438c449e9c10eaba84dd67f701cd66c4dde7a07fe4794");
assert(config.protectedFiles.some(f => path.resolve(f.path) === original && f.sha256 === sha(original)));
const actual = JSON.parse(fs.readFileSync(config.actualInstallation.path, "utf8"));
assert.equal(actual.scope, "SCHEMA_ADAPTER_OF_EXISTING_ACTUAL_NSIS_INSTALLATION_NOT_A_NEW_INSTALLATION");
assert.equal(sha(actual.sourceReceipt.path), actual.sourceReceipt.sha256);
assert(config.protectedFiles.some(f => path.resolve(f.path) === path.resolve(actual.sourceReceipt.path)
  && f.sha256 === actual.sourceReceipt.sha256));
const raw = JSON.parse(fs.readFileSync(actual.sourceReceipt.path, "utf8"));
assert.equal(raw.metadataRestoration, "PASS");
for (const field of ["status", "version", "installer", "installRoot", "executable", "exitCode"])
  assert.deepEqual(actual[field], raw[field], field);
assert.equal(raw.actualRegistration.values.find(v => v.name === "DisplayVersion").value, config.version);
let source = fs.readFileSync(original, "utf8");
for (const [before, after] of [
  ["1.9.35", "1.9.40"], ["1_9_35", "1_9_40"], ["Editor跨代1935", "Editor跨代1940"],
]) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, () => after);
}
assert.match(source, /\nif \(require.main === module\) main\(\);\s*$/);
source = source.replace(/\nif \(require.main === module\) main\(\);\s*$/, "\nmain();\n");
const worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
