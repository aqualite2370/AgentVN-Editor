"use strict";
// Keep the sealed session unchanged; bind the re-audit of actual native02.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module"), vm = require("node:vm");
assert.equal(process.argv[2], "02");
const original = path.join(__dirname, "candidate-1924-abilities-session.cjs");
let source = fs.readFileSync(original, "utf8");
assert.equal(crypto.createHash("sha256").update(source).digest("hex"),
  "c6e8aa9d3c4413b7b8a11045faa796e72a9ace89473c78270dbae95dc2c88cac");
const token = "`fresh-export-audit-${attempt}/report.json`";
assert.equal(source.split(token).length - 1, 1);
source = source.replace(token, '"fresh-export-audit-03/report.json"');
const tools = 'report.tools = [__filename, "scripts/candidate-1924-abilities-flow.cjs"';
assert.equal(source.split(tools).length - 1, 1);
source = source.replace(tools, 'report.tools = [__filename, "scripts/candidate-1924-abilities-session.cjs", ' +
  '"scripts/candidate-1924-export-consume-audit-recheck.cjs", "scripts/candidate-1924-abilities-flow.cjs"');
new vm.Script(Module.wrap(source), { filename: __filename });
const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
adapted._compile(source, __filename);
