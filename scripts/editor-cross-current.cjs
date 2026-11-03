"use strict";
// Bind the preserved legacy-UI / physical migration workflow to the current
// installed candidate. Historical tools and evidence remain unchanged.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const [action, configFile, auditId] = process.argv.slice(2);
assert(["self-test", "run", "audit", "cleanup", "verify-cleanup"].includes(action));
const config = read(configFile);
assert.equal(config.version, "1.9.34"); assert.equal(config.oldVersion, "1.7.1");
require("./editor-candidate-upgrade.cjs").validateConfig(config);
assert.equal(path.resolve(config.preparation, ".."), path.resolve("F:/AgentVN/QA/Editor-1.9.34-20261029-01"));
assert.equal(config.closeMode, "computer-use");
const auditing = action === "audit";
if (auditing) assert.match(auditId || "", /^\d{2}$/);
const filename = path.join(__dirname, auditing ? "editor-cross-candidate-audit.cjs" : "editor-cross-candidate.cjs");
assert.equal(sha(filename), auditing
  ? "a0031356b79acbda46fd2e2a8cc318ae9a0aee126497a76ebd4313941cc19934"
  : "d5a772bd1d6c72b08eb7157202bd3dfc789ed84e1c0a127779d0727805c6ebee");
let source = fs.readFileSync(filename, "utf8");
assert(source.includes("1.9.31"));
// All occurrences refer to this workflow's former current-candidate version,
// including the authored QA marker; no old-binary version is rewritten.
source = source.replaceAll("1.9.31", config.version).replaceAll("1_9_31", "1_9_34")
  .replaceAll("Editor跨代1931", "Editor跨代1934");
if (!auditing) {
  const main = "if (require.main === module) main();";
  assert.equal(source.split(main).length - 1, 1); source = source.replace(main, "main();");
  const tools = "files: [__filename, configFile, c.actualInstallation.path, c.oldInstaller.path,";
  assert.equal(source.split(tools).length - 1, 1);
  source = source.replace(tools, `files: [__filename, ${JSON.stringify(filename)}, configFile, c.actualInstallation.path, c.oldInstaller.path,`);
}
new vm.Script(Module.wrap(source));
process.argv = [process.argv[0], __filename, ...(auditing ? [configFile, auditId] : [action, configFile])];
const worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
