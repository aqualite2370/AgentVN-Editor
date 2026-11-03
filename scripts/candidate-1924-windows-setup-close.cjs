"use strict";
// Narrow supplement for the missing native-close step; do not repeat the save matrix.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = "F:/AgentVN/QA/Windows-Package-20261021-01";
const trace = path.join(root, "candidate-1924-setup-run-18-adaptations.json");
assert.equal(sha(trace), "2ff90686fca7272e1b92956ca91ad49d86b2cdb4665e3f62202359b2fee117ea");
const prior = JSON.parse(fs.readFileSync(path.join(root, "runtime-18/report.json"), "utf8"));
assert.equal(prior.status, "FAILED"); assert(prior.error.includes("Timeout Computer Use native Player close receipt"));
assert.equal(prior.checks.length, 4); assert(prior.checks.every(c => c.status === "PASS"));
assert(prior.uninstalled && prior.setupCleanup && prior.profilesRestored && !prior.cleanupError);
const mapping = JSON.parse(fs.readFileSync(trace, "utf8"));
const original = path.join(__dirname, mapping.source); assert.equal(sha(original), mapping.sha256);
let source = fs.readFileSync(original, "utf8");
for (const { before, after, count } of mapping.changes) {
  assert.equal(source.split(before).length - 1, count); source = source.split(before).join(after);
}
const changes = [];
function replace(before, after, count = 1) {
  assert.equal(source.split(before).length - 1, count, before);
  source = source.split(before).join(after); changes.push({ before, after, count });
}
replace('"candidate-1924-windows-setup-session.ps1"', '"candidate-1924-windows-setup-close-session.ps1"', 7);
replace('"candidate-1924-windows-setup.cjs"', '"candidate-1924-windows-setup-close.cjs"');
replace('scope: "ACTUAL_GENERATED_WINDOWS_NSIS_INSTALL_SHORTCUT_RUNTIME_UNINSTALL"',
  'scope: "ACTUAL_NSIS_NATIVE_CLOSE_AND_UNINSTALL_SUPPLEMENT_NOT_SAVE_MATRIX"');
replace('  await until(() => fs.existsSync(receiptFile), "Computer Use native Player close receipt", 240000);',
  '  fs.writeFileSync(path.join(out,"native-input-request.json"),JSON.stringify({ownerPid:launch.pid,created:launch.created,completion:receiptFile,method:"SKY_NATIVE_ALT_F4_AND_EXIT_CONFIRMATION"},null,2),{flag:"wx"});\n' +
  '  await until(() => fs.existsSync(receiptFile), "Computer Use native Player close receipt", 1200000);');
const start = source.indexOf('  await check("Actual installed Start Menu shortcut boot, UI preference and EXE-side manual save"');
const end = source.indexOf('  if (nativeClose) await physicalClose(); else await stop();', start);
assert(start > 0 && end > start);
const omitted = source.slice(start, end);
assert.equal((omitted.match(/await check\(/g) || []).length, 3);
source = source.slice(0, start) +
  '  await check("Single default shortcut boot for actual native close",async()=>{\n' +
  '    await startShortcut(); await page.getByTestId("start-new-game").click();\n' +
  '    await ready("playing"); await command(0); await shot("before-native-close");\n' +
  '    return {pid:launch.pid,created:launch.created,port:launch.port,storage:launch.storage};\n' +
  '  });\n' + source.slice(end);
changes.push({ before: omitted, after: "NARROW_NATIVE_CLOSE_STEP_ONLY", count: 1 });
replace('assert.equal(report.checks.length, 5)', 'assert.equal(report.checks.length, 3)');
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv[2] === "--self-test") {
  console.log(JSON.stringify({ status: "PASS", scope: "NARROW_SUPPLEMENT_ADAPTATION_ONLY",
    transformations: changes.length, previousProductFlows: 4, repeatedSaveMatrix: false, productLaunches: 0 }));
} else {
  assert.equal(process.argv[2], "run");
  fs.writeFileSync(path.join(root,"candidate-1924-setup-close-19-adaptations.json"),
    JSON.stringify({ source: mapping, supplement: changes },null,2),{flag:"wx"});
  process.argv=[process.argv[0],__filename,"19","--native-ui","--native-close"];
  const worker=new Module(__filename,module); worker.filename=__filename; worker.paths=module.paths;
  worker._compile(source,__filename);
}
