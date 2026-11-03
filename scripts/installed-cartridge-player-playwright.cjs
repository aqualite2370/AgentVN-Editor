"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readInstalledSession, inside } = require("./lib/installed-acceptance.cjs");
const { verifyInstalledCartridge } = require("./lib/installed-cartridge-player.cjs");
assert(process.argv[2] && process.argv[3] && process.argv[4],
  "usage: node installed-cartridge-player-playwright.cjs <installed-session> <resource-flow-report> <fresh-output>");
const root = path.resolve(process.argv[2]), sourceFile = path.resolve(process.argv[3]), out = path.resolve(process.argv[4]);
assert(inside(root, sourceFile) && inside(root, out));
assert(!fs.existsSync(out), "Never overwrite player evidence");
const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
assert.equal(source.status, "PASS");
assert.equal(source.cases.length, 7); assert.equal(source.runtimeMatrix.length, 12);
assert(source.cartridgeArtifact?.path, "Use the actual cartridge produced by the complete installed flow");
fs.mkdirSync(out);
const { state } = readInstalledSession(root);
verifyInstalledCartridge({ installRoot: state.installRoot, cartridge: source.cartridgeArtifact.path,
  expectedTitle: source.cartridgeArtifact.title, out }).then(result => {
  console.log(JSON.stringify({ status: result.status, cases: result.cases.length, cleanup: result.cleanup, out }));
}).catch(error => { console.error(error); process.exitCode = 1; });
