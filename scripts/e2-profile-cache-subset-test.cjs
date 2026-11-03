"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  cloneProfileForCacheSubset,
  inventoryProfile,
} = require("./lib/e2-profile-cache-subset.cjs");

const outputRoot = path.resolve("output/playwright");
const testRoot = fs.mkdtempSync(path.join(outputRoot, "e2-persistent-profile-subset-contract-"));
const source = path.join(testRoot, "source");
fs.mkdirSync(path.join(source, "GrShaderCache"), { recursive: true });
fs.mkdirSync(path.join(source, "Default", "GPUCache"), { recursive: true });
fs.mkdirSync(path.join(source, "Default", "Code Cache"), { recursive: true });
fs.writeFileSync(path.join(source, "Local State"), '{"isolated":true}');
fs.writeFileSync(path.join(source, "GrShaderCache", "cached-program"), "shader-bytes");
fs.writeFileSync(path.join(source, "Default", "GPUCache", "data_0"), "gpu-bytes");
fs.writeFileSync(path.join(source, "Default", "Code Cache", "entry"), "code-bytes");
const initial = inventoryProfile(source);

const complete = cloneProfileForCacheSubset({
  outputRoot, source, destination: path.join(testRoot, "complete"), omit: "none",
});
const subset = cloneProfileForCacheSubset({
  outputRoot, source, destination: path.join(testRoot, "subset"), omit: "GrShaderCache",
});
assert.equal(complete.kind, "profile-cache-subset-attribution-not-acceptance");
assert.equal(complete.performanceAcceptance, false);
assert.deepEqual(complete.omittedFiles, []);
assert.equal(complete.retainedFileCount, 4);
assert.equal(subset.retainedFileCount, 3);
assert.equal(subset.omittedFiles.length, 1);
assert.equal(subset.omittedFiles[0].relativePath, "GrShaderCache/cached-program");
assert.equal(subset.sourceUnchanged, true);
assert.equal(subset.retainedBytesIdentical, true);
assert(!fs.existsSync(path.join(testRoot, "subset", "GrShaderCache")));
assert.deepEqual(inventoryProfile(source), initial, "original baseline must remain unchanged");
assert.equal(
  fs.readFileSync(path.join(testRoot, "subset", "Default", "GPUCache", "data_0"), "utf8"),
  "gpu-bytes",
);

for (const options of [
  { destination: path.join(testRoot, "complete") },
  { destination: source },
  { destination: outputRoot },
  { destination: path.resolve("editor", "test-profile") },
  { omit: "Default" },
  { omit: "../GrShaderCache" },
  { source: path.resolve("editor") },
]) {
  assert.throws(() => cloneProfileForCacheSubset({
    outputRoot, source, destination: path.join(testRoot, "invalid"), omit: "none", ...options,
  }));
}

const missing = path.join(testRoot, "missing-required-cache");
fs.mkdirSync(missing);
fs.writeFileSync(path.join(missing, "Local State"), "{}");
assert.throws(() => cloneProfileForCacheSubset({
  outputRoot, source: missing, destination: path.join(testRoot, "invalid"), omit: "GrShaderCache",
}), /GrShaderCache/);
assert(!fs.existsSync(path.join(testRoot, "invalid")), "invalid inputs must not create destination");

const nestedDestination = path.join(source, "must-not-be-created");
assert.throws(() => cloneProfileForCacheSubset({
  outputRoot, source, destination: nestedDestination, omit: "none",
}), /destination must not be inside source/i);
assert(!fs.existsSync(nestedDestination), "nested destination must be rejected before any write");

// A junction cannot redirect this diagnostic into another workspace or profile.
const linkSource = path.join(testRoot, "linked-source");
fs.mkdirSync(linkSource);
fs.symlinkSync(source, path.join(linkSource, "nested"), process.platform === "win32" ? "junction" : "dir");
assert.throws(() => inventoryProfile(linkSource), /link/i);
assert.throws(() => cloneProfileForCacheSubset({
  outputRoot, source, destination: path.join(linkSource, "nested", "invalid"), omit: "none",
}), /link/i);

console.log("PASS: cache subset cloning, exact retained bytes, original preservation and path/link rejection");
