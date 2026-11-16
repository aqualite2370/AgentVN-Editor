"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const original = "F:/testavn/Windows-Isolated-1986-20261117-01";
const prior = JSON.parse(fs.readFileSync(path.join(original, "resource-01/report.json"), "utf8"));
const retired = JSON.parse(fs.readFileSync(path.join(original, "account-retirement-01.json"), "utf8"));
assert.equal(prior.status, "FAILED"); assert(prior.stages.slice(0, 2).every(s => s.status === "PASS"));
assert.equal(prior.cases[0].rollback.length, 2); assert.match(prior.error, /112:76/);
assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
const source = path.join(__dirname, "sprite-hide-rollback-installed-1986.cjs");
let text = fs.readFileSync(source, "utf8");
const base = path.resolve(process.argv[2]);
assert(["02", "03"].some(suffix => base === path.resolve("F:/testavn/Windows-Isolated-1986-20261117-" + suffix)));
text = text.replaceAll("Windows-Isolated-1986-20261117-01", path.basename(base));
const start = text.indexOf('  await step("actual-nsis-install-new-native-player"'), end = text.indexOf('  for (const theme of ["agentvn"', start);
assert(start > 0 && end > start);
text = text.slice(0, start) + `  await step("reuse-actual1986-install-without-reinstall-or-editor-replay", async () => {
    installation = read("${original}/install-new.json");
    assert.equal(installation.executable.version, "1.9.86");
    assert.equal(sha(path.join(installation.installRoot, "agentvn-player.exe")), candidate.player.sha256);
    report.inheritedEditor = { path: "${original}/resource-01/report.json", passedStages: 2,
      originalStatus: "FAILED", rollbackBeforeForwardAlreadyPassed: true };
    return installation.executable;
  });\n` + text.slice(end);
const restore = '  await step("restore-QA-install-registration", async () => { install("Restore"); return read(path.join(base, "metadata-restoration.json")); });';
assert(text.includes(restore)); text = text.replace(restore, "");
const runner = new Module(source, module);
runner.filename = source; runner.paths = Module._nodeModulePaths(path.dirname(source)); runner._compile(text, source);
