"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { correlatedCacheErrors } = require("./android-installed-terminal-audit.cjs");
const out = path.join(__dirname, "../output/android-terminal-audit-tests", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", cases: [] };
const pkg = "com.agentvn.test";
const line = text => `10-17 07:00:00.123  1234  5678 E chromium: ${text}`;
const missing = line(`[ERROR:simple_file_enumerator.cc(21)] opendir /data/user/0/${pkg}/cache/WebView/Default/HTTP Cache/Code Cache/js: No such file or directory (2)`);
const index = line("[ERROR:simple_index_file.cc(614)] Could not reconstruct index from disk");
function test(name, lines, expected, packageName = pkg) {
  assert.equal(correlatedCacheErrors(lines, packageName), expected, name);
  report.cases.push({ name, status: "PASS" });
}
try {
  test("no errors", [], true);
  test("exact same-event cache pair", [missing, index], true);
  test("standalone index cannot be excused", [index], false);
  test("wrong package", [missing, index], false, "com.agentvn.other");
  test("different thread", [missing, index.replace("5678", "5679")], false);
  test("different event time", [missing, index.replace("00.123", "00.124")], false);
  test("unknown raw app error", [missing, index, "unknown application error"], false);
  test("unexpected Chromium error", [line("[ERROR:other.cc(1)] error")], false);
  test("permission denied is not missing cache", [missing.replace("No such file or directory (2)", "Permission denied (13)")], false);
  test("different cache path", [missing.replace("/Code Cache/", "/Other Cache/")], false);
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
}
