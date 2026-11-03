"use strict";
const assert = require("node:assert/strict");
const { perfSelfcheckScript, parseSelfcheck } = require("./lib/android-perf-selfcheck.cjs");
const script = perfSelfcheckScript("safe-01");
assert.equal((script.match(/simpleperf record /g) || []).length, 5);
assert.equal((script.match(/-- \/system\/bin\/sleep 0.1/g) || []).length, 5);
assert(!/setenforce|chmod|chown|kill|pm |--app|-p /.test(script));
assert.throws(() => perfSelfcheckScript("../x"), /RUN_ID/);
const text = ["plain", "realtime", "dwarf", "fp", "cpu"].map((name, index) =>
  `SELF_CASE|${name}\noriginal error ${index}\nSELF_EXIT|${index === 1 ? 1 : 0}\nSELF_FILE_CLEANUP|0`).join("\n")
  + "\nSELF_DIRECTORY_CLEANUP|0";
const result = parseSelfcheck(text);
assert.equal(result.cases.length, 5); assert.equal(result.cases[1].exitCode, 1);
assert.match(result.cases[1].output, /original error/);
assert.equal(result.cleanupStatus, "PASS");
assert.equal(parseSelfcheck(text.replace("SELF_DIRECTORY_CLEANUP|0", "SELF_DIRECTORY_CLEANUP|1")).cleanupStatus, "FAILED");
console.log("android-perf-selfcheck: PASS (only owned sleep, bounded variants, exact temporary files, cleanup)");
