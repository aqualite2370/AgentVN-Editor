"use strict";
// QA only: bind the existing real installed Android workflow to this worktree.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Functional-Continuation-20261101";
const adapterFile = require.resolve("./installed-editor-android-candidate.cjs");
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
function adapter() {
  let source = fs.readFileSync(adapterFile, "utf8");
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  };
  one('  } else if (kind === "launcher") {',
    `  } else if (kind === "launcher") {
    one(${JSON.stringify("$repo='D:\\AgentVN'")},${JSON.stringify("$repo='" + root + "'")});`);
  one("sources: [__filename, configFile,", `sources: [__filename, ${JSON.stringify(adapterFile)}, configFile,`);
  new vm.Script(Module.wrap(source));
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  worker._compile(source, __filename);
  return worker.exports;
}
function prepare(attempt) {
  assert.match(attempt, /^\d{2}$/);
  const installedReceipt = path.join(qa, "installed-editor-20261101-02/installer-resource-report.json");
  const installed = verifiedInstalledCandidate(installedReceipt);
  assert.equal(installed.executable.version, "1.9.35");
  assert.equal(installed.executable.sha256, "a1ece0a5d69cc0c319fd5d8fe6a9cdca8259f88fd7eeaeae1cc18e88c4fb5dd8");
  const actualReceipt = installed.sourceReceipt.actualInstallation;
  const actual = deriveActual(actualReceipt, "1.9.35");
  const derivedFile = path.join(qa, `android-installed-derived-${attempt}.json`);
  const configFile = path.join(qa, `android-current-config-${attempt}.json`);
  for (const f of [derivedFile, configFile]) assert(!fs.existsSync(f), "Fresh artifacts required");
  const protectedFiles = [actual.executable, ...actual.resources].map(file => describe(file.path));
  const defaultDb = "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db";
  if (fs.existsSync(defaultDb)) protectedFiles.push(describe(defaultDb));
  fs.writeFileSync(derivedFile, JSON.stringify({
    ...actual, protectedFiles, sourceResourceAudit: describe(installedReceipt),
  }, null, 2), { flag: "wx" });
  const config = {
    version: "1.9.35", attempt, gameVersion: "0.1.5", versionCode: 1005,
    preparation: path.join(qa, `android-current-preparation-${attempt}`),
    installation: describe(derivedFile), actualInstallation: actualReceipt,
  };
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { flag: "wx" });
  const prepared = adapter().prepare(config, configFile);
  console.log(JSON.stringify({ ...prepared, configFile,
    sourceInstallation: installedReceipt, modelRequests: 0, productChanges: 0 }));
}
if (require.main === module) {
  const [action, attempt] = process.argv.slice(2);
  assert.equal(action, "prepare");
  prepare(attempt);
}
module.exports = { adapter };
