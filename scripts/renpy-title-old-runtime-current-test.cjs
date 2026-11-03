"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module");
const original = path.join(__dirname, "renpy-title-old-runtime-evidence-test.cjs");
let source = fs.readFileSync(original, "utf8");
const before = 'require("./lib/renpy-title-old-runtime-evidence.cjs")';
assert.equal(source.split(before).length - 1, 1);
source = source.replace(before, 'require("./lib/renpy-title-old-runtime-current-evidence.cjs")');
const point = '  report.status = "PASS";';
assert.equal(source.split(point).length - 1, 1);
source = source.replace(point, `
  const failedPath = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/title-old-026-01/report.json";
  const failed = JSON.parse(fs.readFileSync(failedPath, "utf8"));
  assert.equal(failed.status, "FAILED"); assert.match(failed.error, /must identify itself/);
  const native = failed.cases.find(c => !c.control);
  assert(native && native.text.includes("当前 GameCLI 为 0.25.0"));
  assert.throws(() => require("./lib/renpy-title-old-runtime-evidence.cjs").assertTitleProtocolRefusal(native, expected));
  assert.doesNotThrow(() => assertTitleProtocolRefusal(native, expected));
  report.cases.push({ name: "Classify actual unchanged native GameCLI wording, old classifier rejects", status: "PASS" });
  for (const actual of ["0.26.0", "0.25.01", "0.25.0.1"]) {
    const invalid = { ...native, text: native.text.replace("GameCLI 为 0.25.0", "GameCLI 为 " + actual) };
    assert.throws(() => assertTitleProtocolRefusal(invalid, expected));
    report.cases.push({ name: "Reject incorrect actual GameCLI " + actual, status: "PASS" });
  }
` + point);
const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
adapted._compile(source, __filename);
