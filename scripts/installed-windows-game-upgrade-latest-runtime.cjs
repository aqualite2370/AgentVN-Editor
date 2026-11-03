"use strict";
// Latest traceable old runtime, with an actually newer game version and story bytes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-windows-game-upgrade-current.cjs");
assert.equal(sha(original), "cbab61f7eba4bd30d342b0bb43717e2acbea6ac4e96a9cdf069a77f84b5ba09c");
let code = fs.readFileSync(original, "utf8");
const one = (before, after) => {
  assert.equal(code.split(before).length - 1, 1, before); code = code.replace(before, () => after);
};
one('const recent = process.argv.includes("--recent");', 'const recent = true;');
one('"editor-05/report.json"', '"editor-16/report.json"');
one("validateRetained1924Source(old)", "validateRetained1934Source(old)");
one('const oldVersion = recent ? "1.0.2" : "1.0.0"', 'const oldVersion = "1.0.3"');
one('const oldMarker = recent ? "QA_WINDOWS_UPGRADE_NEW" : "QA_WINDOWS_SAVE";',
  'const oldMarker = "QA_WINDOWS_UPGRADE_CURRENT";');
one('${recent ? "1_9_24" : "1_9_16"}', '${"1_9_34"}');
one('oldEditorVersion: recent ? "1.9.24" : "1.9.16"', 'oldEditorVersion: "1.9.34"');
const begin = code.indexOf('  if (recent) fs.writeFileSync(path.join(out, "native-setup-source.json")');
const finish = code.indexOf('  for (const action of ["SelfTest"', begin);
assert(begin > 0 && finish > begin);
code = code.slice(0, begin) + [
  '  const retained = require("./lib/windows-current-native-source.cjs").validateRetained1934Source(old);',
  '  fs.writeFileSync(path.join(out, "native-setup-source.json"), JSON.stringify({',
  '    editorVersion: "1.9.34", nativeUIBuildSource: true, candidateBinding: retained.candidateBinding,',
  '    source: desc(oldFile), audit: desc(path.join(qa, "native-ui-audit-07/report.json")),',
  '    payload: desc(path.join(qa, "setup-payload-audit-07/report.json")),',
  '  }, null, 2), { flag: "wx" });',
  "",
].join("\n") + code.slice(finish);
const closeStart = code.indexOf("async function nativeClose(name) {");
const closeEnd = code.indexOf("\n(async () => {", closeStart);
assert(closeStart > 0 && closeEnd > closeStart);
code = code.slice(0, closeStart) + [
  "async function nativeClose(name) {",
  "  remember();",
  '  const result = await require("./lib/windows-player-native-close.cjs").normalPlayerClose({',
  "    page, launch, out, name, known: report.known });",
  '  report.cleanups.push({ port: launch.port, method: "NATIVE_CONFIRMED_CLOSE", remaining: [], ...result });',
  "  await browser?.close().catch(() => {}); browser = page = cdp = launch = undefined; save();",
  "}",
].join("\n") + code.slice(closeEnd);
const tag = 'gameId, productChanges: 0, builds: 0, modelRequests: 0, copiedOrSeededSaves: 0,';
one(tag, 'nativeAutomation: "repository-native-v1", nativeAutomationSources: ' +
  JSON.stringify([__filename, original, path.join(__dirname, "lib/windows-player-native-close.cjs"),
    path.join(__dirname, "lib/windows-repository-native.cjs")]) + '.map(desc), ' + tag);
new vm.Script(Module.wrap(code));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
module.exports = { validateAdaptation: () => new vm.Script(Module.wrap(code)) };
if (require.main === module) worker._compile(code, __filename);
