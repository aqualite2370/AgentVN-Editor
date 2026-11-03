"use strict";
// QA-only worktree path adaptation. The original signed-resource/device
// validator, actual touches and finally cleanup are retained.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module");
const file = require.resolve("./android-candidate-renpy.cjs");
function adapter() {
  let source = fs.readFileSync(file, "utf8");
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  };
  one(String.raw`(Join-Path 'D:\\AgentVN\\scripts' 'android-current-navigation.cjs')`,
    `(Join-Path '${__dirname.replaceAll("\\", "\\\\").replaceAll("'", "''")}' 'android-current-navigation.cjs')`);
  one('const sources = [__filename, configFile, auditFile, startFile, runnerSource,',
    'const sources = [__filename, module.deviceAdapter, configFile, auditFile, startFile, runnerSource,');
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  worker.deviceAdapter = __filename; worker._compile(source, file); return worker.exports;
}
if (require.main === module) {
  const [mode, config, audit, device] = process.argv.slice(2);
  if (mode === "self-test") {
    const tool = adapter(), generated = tool.deviceSource();
    assert(generated.includes("First exit must persist the post-quick-load branch"));
    assert(generated.includes("Reopened branch must persist its new history"));
    console.log(JSON.stringify({ status: "PASS", originalDeviceSourceParsed: true,
      saveHistoryAssertionsRetained: true, worktreePathAdapted: true,
      deviceOperations: 0, builds: 0, productChanges: 0 }));
  } else { assert.equal(mode, "prepare"); console.log(JSON.stringify(adapter().prepare(config, audit, device))); }
}
