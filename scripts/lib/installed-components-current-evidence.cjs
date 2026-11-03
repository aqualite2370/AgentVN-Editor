"use strict";
const assert = require("node:assert/strict");
function validate(r, expected = {
  version: "1.9.14", sha256: "57e280c16cea0cadf41fe55608e94c5216e46cf15c71c75872a2acf415c867af",
}) {
  assert.match(expected.version, /^\d+\.\d+\.\d+$/); assert.match(expected.sha256, /^[a-f0-9]{64}$/);
  assert.equal(r.status, "PASS"); assert.equal(r.version, expected.version);
  assert.equal(r.scope, "CURRENT_INSTALLED_COMPONENT_ZIP_AUTHOR_RESTART_REIMPORT_EXPORT");
  assert.equal(r.executable.sha256, expected.sha256);
  assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0); assert.deepEqual(r.errors, []);
  assert(r.cacheRestored && r.protectedUnchanged);
  assert(r.steps.length >= 9 && r.steps.every(s => s.status === "PASS"));
  assert.equal(r.cases.length, 11);
  assert.deepEqual(r.cases.map(c => c.name), ["traversal", "duplicate-case", "symlink", "compression-ratio",
    "entry-limit", "future-version", "missing-asset", "bad-hash", "script", "handler", "css-url"]);
  assert(r.cases.every(c => c.status === "PASS" && c.noPollution === true));
  assert.equal(r.matrix.length, 12);
  const keys = r.matrix.map(c => `${c.width}/${c.height}/${c.dpr}/${c.reduced}`);
  assert.equal(new Set(keys).size, 12);
  for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduce of [false, true]) assert(keys.includes(`${w}/${h}/${dpr}/${reduce}`));
  assert(r.matrix.every(c => c.status === "PASS" && c.hit === true && c.stable === true && c.overflow <= 1));
  assert.equal(r.archive.components, 2); assert.equal(r.archive.dependencies, 4);
  assert.equal(r.portable.assets, 4); assert.equal(r.cartridge.components, 3); assert.equal(r.cartridge.assets, 6);
  for (const a of [r.archive, r.portable, r.cartridge]) assert.match(a.sha256, /^[a-f0-9]{64}$/);
  assert(r.restart.projectEqual && r.restart.libraryEqual && r.restart.actualNativeRestart);
  assert(r.freshImport.freshLibrary && r.freshImport.copiedToProject && r.freshImport.noLibraryOriginalMutation
    && r.freshImport.sourcePortableEqual); assert.equal(r.freshImport.importedRecords, 2);
  const count = r.continuation ? 1 : 3;
  if (r.continuation) {
    assert.equal(r.continuation.reason, "PORTABLE_IMPORT_METADATA_ORACLE");
    assert.equal(r.continuation.inheritedPassedSteps, 7);
    assert.match(r.continuation.source.sha256, /^[a-f0-9]{64}$/);
    assert(r.steps.slice(0, 7).every(s => s.inheritedFrom === r.continuation.source.sha256));
  }
  assert.equal(r.launches.length, count); assert.equal(r.cleanups.length, count);
  assert(r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
  assert.equal(r.downloadCleanup.status, "PASS"); assert(r.downloadCleanup.sourceRetained);
  assert.equal(r.downloadCleanup.deletedUserFiles, 0);
}
module.exports = { validate };
