"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module");
assert.equal(process.argv[2], "02");
const original = path.join(__dirname, "renpy-title-old-runtime-native.cjs");
let source = fs.readFileSync(original, "utf8");
assert.equal(crypto.createHash("sha256").update(source).digest("hex"),
  "f5cfae42ecc117d9a172d7406644cd2b9f3e17494370a3eb51a239bebb835e74");
const helper = "./lib/renpy-title-old-runtime-evidence.cjs";
assert.equal(source.split(helper).length - 1, 1);
source = source.replace(helper, "./lib/renpy-title-old-runtime-current-evidence.cjs");
const tools = 'const tools = [__filename, "scripts/lib/renpy-title-old-runtime-evidence.cjs",';
assert.equal(source.split(tools).length - 1, 1);
source = source.replace(tools, 'const tools = [__filename, "scripts/renpy-title-old-runtime-native.cjs", ' +
  '"scripts/lib/renpy-title-old-runtime-evidence.cjs", "scripts/lib/renpy-title-old-runtime-current-evidence.cjs",');
const author = "`author-export-${attempt}/report.json`";
assert.equal(source.split(author).length - 1, 1);
source = source.replace(author, '"author-export-01/report.json"');
const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
adapted._compile(source, __filename);
