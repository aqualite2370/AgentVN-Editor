"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validateSolidComponentPreview: validate } = require("./lib/component-preview-style-evidence.cjs");
const sample = { label: "分享组件帮助", hovered: false,
  inline: { backgroundColor: "rgb(34, 51, 68)", color: "rgb(255, 255, 255)" },
  actual: { backgroundColor: "rgb(34, 51, 68)", color: "rgb(255, 255, 255)", backgroundImage: "none", opacity: "1" } };
validate(Array.from({ length: 24 }, () => structuredClone(sample)));
const invalid = [
  s => { s[0].actual.backgroundImage = "linear-gradient(white,white)"; },
  s => { s[0].label = "待导入组件"; },
  s => { s[0].actual.backgroundColor = "rgb(0, 0, 0)"; },
  s => { s[0].inline.backgroundColor = ""; },
];
for (const mutate of invalid) { const s = Array.from({ length: 8 }, () => structuredClone(sample)); mutate(s); assert.throws(() => validate(s)); }
assert.throws(() => validate([]));
const qa = "F:/AgentVN/QA/Installed-Components-20261021-01";
const wrongTarget = JSON.parse(fs.readFileSync(`${qa}/editor-05/report.json`, "utf8"));
const actual = JSON.parse(fs.readFileSync(`${qa}/editor-06/report.json`, "utf8"));
assert.equal(wrongTarget.status, "FAILED"); assert(wrongTarget.samples.at(-1).label === "待导入组件");
assert.equal(actual.status, "PASS"); assert(actual.styleMatchesDeclared);
assert(actual.samples.slice(-8).every(s => s.actual.backgroundImage.startsWith("linear-gradient(")));
assert.throws(() => validate(wrongTarget.samples));
assert.throws(() => validate(actual.samples), /Undeclared Editor background/);
console.log(JSON.stringify({ status: "PASS", badEvidenceRejected: 7, actualInstalledStyleFailureReproduced: true,
  scope: "EVIDENCE_GUARD_NOT_PRODUCT_FIX", launches: 0 }));
