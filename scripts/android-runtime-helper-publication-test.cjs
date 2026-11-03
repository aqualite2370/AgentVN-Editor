"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts/standalone-build-scripts.json"), "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert(manifest.scripts.includes("android-runtime-activity.gradle"),
  "Installed Editor builds must ship the actual Android lifecycle Gradle helper");
const names = manifest.scripts;
assert.equal(new Set(names).size, names.length);
for (const name of names) {
  assert.equal(path.basename(name), name);
  assert(fs.statSync(path.join(root, "scripts", name)).isFile(), name);
}
console.log("PASS installed-build helper manifest contains the lifecycle adapter and only existing unique files");
