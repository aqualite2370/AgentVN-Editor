"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { copyDirectory } = require("./lib/windows-portable-qa-utils.cjs");
const qa = "F:/AgentVN/QA/Windows-Package-20261021-01", target = path.join(qa, "copy-probe-01");
const report = JSON.parse(fs.readFileSync(path.join(qa, "editor-01/report.json")));
const source = path.join(path.dirname(report.artifacts.find(a => a.kind === "windows_portable_exe").path), "embedded-cartridge");
copyDirectory(source, target);
let count = 0;
function compare(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) compare(path.join(from, e.name), path.join(to, e.name));
    else { assert.deepEqual(fs.readFileSync(path.join(from, e.name)), fs.readFileSync(path.join(to, e.name))); count++; }
  }
}
compare(source, target); assert.equal(count, 5);
assert.throws(() => copyDirectory(source, target), /Never replace/);
console.log("PASS: individual-file directory copy retains five real package resources and refuses replacement");
