"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module");
assert.equal(process.argv[2], "04");
const original = path.join(__dirname, "candidate-1924-abilities-session.cjs");
let source = fs.readFileSync(original, "utf8");
assert.equal(crypto.createHash("sha256").update(source).digest("hex"),
  "c6e8aa9d3c4413b7b8a11045faa796e72a9ace89473c78270dbae95dc2c88cac");
const flow = "scripts/candidate-1924-abilities-flow.cjs";
assert.equal(source.split(flow).length - 1, 2);
source = source.replaceAll(flow, "scripts/candidate-1924-abilities-final-flow.cjs");
const predecessor = "`fresh-export-audit-${attempt}/report.json`";
assert.equal(source.split(predecessor).length - 1, 1);
source = source.replace(predecessor, '"fresh-export-audit-03/report.json"');
const tools = "report.tools = [__filename,";
assert.equal(source.split(tools).length - 1, 1);
source = source.replace(tools, tools + ' "scripts/candidate-1924-abilities-session.cjs", ' +
  '"scripts/lib/candidate-1924-abilities-final-adapter.cjs", "scripts/candidate-1924-abilities-qa-test.cjs",');
const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
adapted._compile(source, __filename);
