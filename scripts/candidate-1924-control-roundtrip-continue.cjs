"use strict";
// New receipt for the interrupted native picker. Original failed receipts and
// their executed tools remain unchanged; no authoring or saving is repeated.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "candidate-1924-control-roundtrip-resume.cjs");
assert.equal(sha(previous), "a5d316befee5991b4d001610ec59edbf6d15cecd600ebc21bfe6af528b682ae1");
const old = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-55/report.json", "utf8"));
assert.equal(old.status, "FAILED");
assert.equal(old.nativeCacheRestoration, "PASS");
assert.match(old.error, /Timeout Computer Use native project selection/);
let source = fs.readFileSync(previous, "utf8");
const changes = [
  ["'assert.equal(process.argv[2], \"55\");'", "'assert.equal(process.argv[2], \"56\");'"],
  ["'out = \"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-55\";'",
    "'out = \"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-56\";'"],
];
for (const [before, after] of changes) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after);
}
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  assert(source.includes('native-picker-completed.json'));
  assert(source.includes("assert.equal(sha(resume.portable.originalNativePath), resume.portable.sha256)"));
  console.log(JSON.stringify({ status: "PASS", changes: changes.length,
    scope: "NEW_NATIVE_PICKER_RECEIPT_ONLY_NO_PRODUCT_RUN" }));
} else {
  assert.equal(process.argv[2], "56");
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(source, __filename);
}
