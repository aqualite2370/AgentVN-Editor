"use strict";
// Same independent package audit, bound to the fresh task17 evidence only.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const Module = require("node:module"), vm = require("node:vm");
const original = path.join(__dirname, "candidate-1924-android-package-audit.cjs");
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(original)).digest("hex"),
  "ab709bff3e26092dae452fadb7325fb14e511f3159b098fda0298580ad4a0fbc");
let source = fs.readFileSync(original, "utf8");
const before = '["16", "01", "--apk-terminal"]';
assert.equal(source.split(before).length - 1, 1);
source = source.replace(before, '["17", "01", "--apk-terminal"]');
new vm.Script(Module.wrap(source), { filename: __filename });
const worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
