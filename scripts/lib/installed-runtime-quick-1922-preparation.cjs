"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
function validateQuickPreparation(prep, out) {
  assert.equal(prep.status, "PASS"); assert.equal(prep.current1922Library, true);
  assert.equal(path.resolve(prep.sessionRoot), path.resolve(out));
  assert.equal(path.dirname(path.resolve(out)), "F:\\AgentVN\\QA\\Native-Runtime-State-20261020-01");
  assert.match(path.basename(out), /^installed-quick-1922-\d{2}$/);
  assert.equal(prep.installId, `qa_current_quick_1922_${path.basename(out).slice(-2)}`);
  assert.equal(prep.defaultStorage, "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION");
  assert.equal(prep.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  for (const f of [prep.installation, prep.executable, prep.originalExport, prep.originalFixture])
    assert.equal(sha(f.path), f.sha256);
  const installed = read(prep.installation.path), exported = read(prep.originalExport.path);
  assert.equal(installed.status, "PASS"); assert.equal(installed.version, "1.9.22");
  assert.equal(path.resolve(prep.executable.path), path.join(installed.installRoot, "agentvn-player.exe"));
  assert.equal(exported.installation.sha256, prep.installation.sha256);
  assert.equal(exported.status, "PASS"); assert(exported.finishedAt && !exported.cleanupError);
  assert.equal(exported.scope, "ACTUAL_1922_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE");
  assert.equal(exported.steps.length, 3); assert(exported.steps.every(s => s.status === "PASS"));
  assert.deepEqual(prep.cartridges, exported.cartridges); assert.equal(prep.cartridges.length, 2);
  for (const f of prep.cartridges) assert.equal(sha(f.path), f.sha256);
  assert.equal(prep.fixture.inputSha256, sha(prep.fixture.input));
  assert.equal(prep.fixture.inputSha256, exported.fixture.inputSha256);
  assert.equal(read(prep.originalFixture.path).inputSha256, prep.fixture.inputSha256);
  return { installedVersion: installed.version, libraryStorage: prep.defaultStorage };
}
module.exports = { validateQuickPreparation };
