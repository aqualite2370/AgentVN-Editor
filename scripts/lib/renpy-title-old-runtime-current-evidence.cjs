"use strict";
// Accept the real retained player's wording, in addition to the original
// Runtime wording. Version, protocol-stage and geometry checks remain strict.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module");
const original = path.join(__dirname, "renpy-title-old-runtime-evidence.cjs");
let source = fs.readFileSync(original, "utf8");
assert.equal(crypto.createHash("sha256").update(source).digest("hex"),
  "324178153fdf7c21429cb4744341200f871a3d2d60034acb7a50af4a7dc6d792");
const before = String.raw`/当前\s*(?:Runtime|运行时)?\s*[:：]?\s*0\.25\.0/i`;
const after = String.raw`/当前\s*(?:Runtime|运行时|GameCLI)?\s*(?:[:：]|为)?\s*0\.25\.0(?![\d.])/i`;
assert.equal(source.split(before).length - 1, 1); source = source.replace(before, after);
const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
adapted._compile(source, __filename); module.exports = adapted.exports;
