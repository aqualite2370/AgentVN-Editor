"use strict";
// Evidence guard tests, not product execution or a substitute for installed UI.
const assert = require("node:assert/strict");
const { validate } = require("./lib/installed-components-current-evidence.cjs");
const good = {
  status: "PASS", version: "1.9.14", scope: "CURRENT_INSTALLED_COMPONENT_ZIP_AUTHOR_RESTART_REIMPORT_EXPORT",
  modelRequests: 0, productChanges: 0, errors: [], cacheRestored: true, protectedUnchanged: true,
  executable: { sha256: "57e280c16cea0cadf41fe55608e94c5216e46cf15c71c75872a2acf415c867af" },
  steps: Array.from({ length: 9 }, (_, i) => ({ name: String(i), status: "PASS" })),
  cases: ["traversal", "duplicate-case", "symlink", "compression-ratio", "entry-limit",
    "future-version", "missing-asset", "bad-hash", "script", "handler", "css-url"]
    .map(name => ({ name, status: "PASS", noPollution: true })),
  matrix: [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
    [false, true].map(reduced => ({ width, height: { 1920: 1080, 2560: 1440, 3840: 2160 }[width],
      dpr, reduced, status: "PASS", hit: true, overflow: 0, stable: true })))),
  archive: { components: 2, dependencies: 4, sha256: "a".repeat(64) },
  portable: { assets: 4, sha256: "b".repeat(64) },
  cartridge: { components: 3, assets: 6, sha256: "c".repeat(64) },
  restart: { projectEqual: true, libraryEqual: true, actualNativeRestart: true },
  freshImport: { freshLibrary: true, importedRecords: 2, copiedToProject: true,
    noLibraryOriginalMutation: true, sourcePortableEqual: true },
  launches: [{ pid: 100 }, { pid: 101 }, { pid: 102 }],
  cleanups: [1, 2, 3].map(() => ({ status: "PASS", normalCloseClaimed: false })),
  downloadCleanup: { status: "PASS", sourceRetained: true, deletedUserFiles: 0 },
};
validate(good);
const currentExpected = { version: "1.9.22", sha256: "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc" };
const current = { ...good, version: currentExpected.version, executable: { sha256: currentExpected.sha256 } };
validate(current, currentExpected);
assert.throws(() => validate(good, currentExpected));
assert.throws(() => validate(current));
assert.throws(() => validate({ ...current, version: "1.9.21" }, currentExpected));
assert.throws(() => validate({ ...current, executable: { sha256: "f".repeat(64) } }, currentExpected));
const continued = structuredClone(good);
continued.continuation = { reason: "PORTABLE_IMPORT_METADATA_ORACLE", inheritedPassedSteps: 7, source: { sha256: "e".repeat(64) } };
continued.launches = continued.launches.slice(0, 1); continued.cleanups = continued.cleanups.slice(0, 1);
for (const s of continued.steps.slice(0, 7)) s.inheritedFrom = "e".repeat(64);
validate(continued);
assert.throws(() => validate({ ...continued, continuation: { ...continued.continuation, inheritedPassedSteps: 0 } }));
assert.throws(() => validate({ ...continued, continuation: { ...continued.continuation, source: { sha256: "wrong" } } }));
const invalid = [
  r => { r.status = "FAILED"; }, r => { r.steps = []; }, r => { r.matrix = []; },
  r => { r.matrix[1] = structuredClone(r.matrix[0]); }, r => { r.cases.pop(); },
  r => { r.cases[1].noPollution = false; }, r => { r.matrix[1].hit = false; },
  r => { r.matrix[1].overflow = 20; }, r => { r.matrix[1].stable = false; },
  r => { r.modelRequests = 1; }, r => { r.errors.push("ignored"); },
  r => { r.cacheRestored = false; }, r => { r.protectedUnchanged = false; },
  r => { r.executable.sha256 = "d".repeat(64); }, r => { r.version = "1.9.9"; },
  r => { r.archive.dependencies = 0; }, r => { r.restart.actualNativeRestart = false; },
  r => { r.freshImport.copiedToProject = false; }, r => { r.cleanups.pop(); },
  r => { r.downloadCleanup.status = "FAILED"; }, r => { r.cartridge.assets = 4; },
  r => { r.portable.sha256 = ""; }, r => { r.productChanges = 1; },
];
for (const mutate of invalid) { const copy = structuredClone(good); mutate(copy); assert.throws(() => validate(copy)); }
console.log(JSON.stringify({ status: "PASS", invalidReportsRejected: invalid.length + 6, launches: 0 }));
