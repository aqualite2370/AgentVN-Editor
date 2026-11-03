"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module");
assert.equal(process.argv[2], "02");
const original = path.join(__dirname, "renpy-title-old-runtime-audit.cjs");
let source = fs.readFileSync(original, "utf8");
assert.equal(crypto.createHash("sha256").update(source).digest("hex"),
  "1ad16dcf368a1341a64fc75053a0a0eafe0b3e23b8daa006487db94dcc858902");
const helper = "./lib/renpy-title-old-runtime-evidence.cjs";
assert.equal(source.split(helper).length - 1, 1);
source = source.replace(helper, "./lib/renpy-title-old-runtime-current-evidence.cjs");
const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
adapted._compile(source, __filename);
