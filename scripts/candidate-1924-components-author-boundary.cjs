"use strict";
// Preserve the failed new-root attempt. Use the existing permitted QA root and
// a new leaf instead of expanding or bypassing the cache protection boundary.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "candidate-1924-components-author.cjs");
assert.equal(sha(original), "b375985a88be0ab6899f5415d427635cffc778dba720e279d30905bca013520e");
let source = fs.readFileSync(original, "utf8");
for (const [a, b] of [
  ['qa = "F:/AgentVN/QA/Installed-Components-1924-20261025-01"', 'qa = "F:/AgentVN/QA/Installed-Components-20261021-01"'],
  ['assert.equal(attempt, "01")', 'assert.equal(attempt, "10")'],
  ['F:/AgentVN/QA/Installed-Components-1924-20261025-01/editor-01', 'F:/AgentVN/QA/Installed-Components-20261021-01/editor-10'],
]) { assert.equal(source.split(a).length - 1, 1); source = source.replace(a, b); }
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
