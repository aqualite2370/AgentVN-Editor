"use strict";
// The workspace intentionally retains the user's HEAD/index; verify the actual
// scoped delivery commit rather than claiming that the unrelated HEAD is current.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const ref = process.argv[3]; assert(/^[0-9a-f]{40}$/.test(ref || ""), "Explicit immutable commit required");
const source = path.join(__dirname, "assistant-knowledge-delivery-test.cjs");
let text = fs.readFileSync(source, "utf8");
assert.equal(text.split('"HEAD"').length - 1, 3);
assert.equal(text.split("`HEAD:${file}`").length - 1, 1);
text = text.replaceAll('"HEAD"', JSON.stringify(ref)).replace("`HEAD:${file}`", "`" + ref + ":${file}`");
const runner = new Module(source, module);
runner.filename = source; runner.paths = Module._nodeModulePaths(path.dirname(source)); runner._compile(text, source);
