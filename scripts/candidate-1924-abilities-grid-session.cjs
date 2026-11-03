"use strict";
// Preserve the original failed matrix and sealed source; independent attempt03
// uses the same business assertions with live-grid diagnostics.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module"), vm = require("node:vm");
assert.equal(process.argv[2], "03");
const original = path.join(__dirname, "candidate-1924-abilities-session.cjs");
let source = fs.readFileSync(original, "utf8");
assert.equal(crypto.createHash("sha256").update(source).digest("hex"),
  "c6e8aa9d3c4413b7b8a11045faa796e72a9ace89473c78270dbae95dc2c88cac");
const flow = "scripts/candidate-1924-abilities-flow.cjs";
assert.equal(source.split(flow).length - 1, 2);
source = source.replaceAll(flow, "scripts/candidate-1924-abilities-grid-flow.cjs");
const tools = "report.tools = [__filename,";
assert.equal(source.split(tools).length - 1, 1);
source = source.replace(tools, tools + ' "scripts/candidate-1924-abilities-session.cjs", ' +
  '"scripts/candidate-1924-abilities-flow.cjs",');
new vm.Script(Module.wrap(source), { filename: __filename });
const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
adapted._compile(source, __filename);
