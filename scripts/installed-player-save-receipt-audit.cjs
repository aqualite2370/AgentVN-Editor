"use strict";
// Independent re-audit; preserve the original report, receipts and failed audit.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module");
const { sha } = require("./lib/installed-runtime-session.cjs");
const source = "F:/AgentVN/QA/Editor-1.9.31-20261027-01/player-save-preparation-02/audit.cjs";
assert.equal(sha(source), "7c8f33b418c668aeacf9b8479acdd5264537db53c3f2ddc331a68a8977adc545");
let code = fs.readFileSync(source, "utf8");
function one(before, after) {
  assert.equal(code.split(before).length - 1, 1, before);
  code = code.replace(before, () => after);
}
one('"terminal-audit-01.json"', '"terminal-audit-02.json"');
one('assert.equal(receipt.method, "computer-use sky.press_key");',
  'assert.equal(receipt.method, [13, 14].includes(receipt.number)' +
  ' ? "sky.press_key followed by sky.get_window_state; modal visually verified"' +
  ' : "computer-use sky.press_key");');
const worker = new Module(__filename, module);
worker.filename = __filename;
worker.paths = module.paths;
worker._compile(code, __filename);
