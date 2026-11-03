"use strict";
// These are evidence-classifier controls, never a substitute for an old EXE.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const out = process.argv[2];
assert(out && path.resolve(out).startsWith("F:\\AgentVN\\QA\\") && !fs.existsSync(out));
fs.mkdirSync(out);
const report = { status: "RUNNING", scope: "QA_CLASSIFIER_CONTROLS_NOT_PRODUCT_ACCEPTANCE",
  startedAt: new Date().toISOString(), cases: [], modelRequests: 0, productChanges: 0 };
try {
  const { assertTitleProtocolRefusal } = require("./lib/renpy-title-old-runtime-evidence.cjs");
  const rect = { left: 20, top: 20, right: 800, bottom: 600, width: 780, height: 580 };
  const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  const observation = {
    text: "运行时版本不兼容。卡带要求 0.26.0，当前 Runtime 0.25.0。请更新客户端。",
    start: { visible: false, enabled: false }, playingCount: 0,
    viewport: expected, overflow: 0, alert: { rect, buttons: [{ rect, hit: true }] },
  };
  assert.doesNotThrow(() => assertTitleProtocolRefusal(observation, expected));
  report.cases.push({ name: "Explicit 0.26 refusal from 0.25 is classifiable", status: "PASS" });
  const bad = [
    ["older capability refusal", v => { v.text = v.text.replace("0.26.0", "0.22.0"); }],
    ["new binary pretending to be old", v => { v.text = v.text.replace("0.25.0", "0.26.0"); }],
    ["earlier layout schema failure", v => { v.text += " ui_layout_version: Invalid literal"; }],
    ["generic error with both version strings", v => { v.text = "读取失败 0.26.0 0.25.0"; }],
    ["playable unsupported cartridge", v => { v.start = { visible: true, enabled: true }; }],
    ["unsupported story mounted", v => { v.playingCount = 1; }],
    ["wrong viewport", v => { v.viewport = { ...v.viewport, width: 1919 }; }],
    ["wrong DPR", v => { v.viewport = { ...v.viewport, dpr: 2 }; }],
    ["wrong motion mode", v => { v.viewport = { ...v.viewport, reduced: true }; }],
    ["horizontal overflow", v => { v.overflow = 20; }],
    ["clipped alert", v => { v.alert.rect.bottom = 1082; }],
    ["invisible alert", v => { v.alert.rect.width = 0; }],
    ["missing recovery controls", v => { v.alert.buttons = []; }],
    ["unclickable recovery control", v => { v.alert.buttons[0].hit = false; }],
    ["offscreen recovery control", v => { v.alert.buttons[0].rect.left = -10; }],
  ];
  for (const [name, mutate] of bad) {
    const value = structuredClone(observation); mutate(value);
    assert.throws(() => assertTitleProtocolRefusal(value, expected), undefined, name);
    report.cases.push({ name: `Reject ${name}`, status: "PASS" });
  }
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report));
}
