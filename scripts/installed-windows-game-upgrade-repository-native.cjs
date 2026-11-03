"use strict";
// Reuse the real old/new NSIS workflow; make its close actor explicit.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-windows-game-upgrade-current.cjs");
assert.equal(sha(original), "cbab61f7eba4bd30d342b0bb43717e2acbea6ac4e96a9cdf069a77f84b5ba09c");
let code = fs.readFileSync(original, "utf8");
const start = code.indexOf("async function nativeClose(name) {");
const end = code.indexOf("\n(async () => {", start);
assert(start > 0 && end > start);
code = code.slice(0, start) + [
  "async function nativeClose(name) {",
  "  remember();",
  '  const result = await require("./lib/windows-player-native-close.cjs").normalPlayerClose({',
  "    page, launch, out, name, known: report.known });",
  '  report.cleanups.push({ port: launch.port, method: "NATIVE_CONFIRMED_CLOSE", remaining: [], ...result });',
  "  await browser?.close().catch(() => {}); browser = page = cdp = launch = undefined; save();",
  "}",
].join("\n") + code.slice(end);
const tag = 'gameId, productChanges: 0, builds: 0, modelRequests: 0, copiedOrSeededSaves: 0,';
assert.equal(code.split(tag).length - 1, 1);
code = code.replace(tag, 'nativeAutomation: "repository-native-v1", nativeAutomationSources: ' +
  JSON.stringify([__filename, original, path.join(__dirname, "lib/windows-player-native-close.cjs"),
    path.join(__dirname, "lib/windows-repository-native.cjs")]) + '.map(desc), ' + tag);
new vm.Script(Module.wrap(code));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(code, __filename);
