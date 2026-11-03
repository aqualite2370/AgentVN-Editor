"use strict";
// Dry-run guard only: never moves a profile or starts a product.
const assert = require("node:assert/strict"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const source = path.resolve(__dirname, "native-dev-preview-profile.ps1");
const run = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-story-1922-01";
function probe(directory, storage) {
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", source, "-Action", "Prepare", "-RunDirectory", directory,
    "-Storage", storage, "-CodexCacheView", "-ValidateOnly"],
  { encoding: "utf8", windowsHide: true, timeout: 20000 });
}
for (const storage of ["NativeRoaming", "Junction"]) {
  const result = probe(run, storage);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const data = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  assert.equal(data.validationOnly, true);
  assert.equal(data.storage, storage);
  assert.equal(data.roots.length, 2);
  assert(data.roots.every(p => p.startsWith(
    "C:\\Users\\1\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\")));
}
for (const directory of ["F:/AgentVN/QA", "D:/AgentVN",
  "F:/AgentVN/QA/Native-Runtime-State-20261020-01/../installed-story-1922-01"]) {
  const result = probe(directory, "NativeRoaming");
  assert.notEqual(result.status, 0, "Broad or unrelated profile operation must be rejected");
}
console.log(JSON.stringify({ status: "PASS", accepted: 2, rejected: 3,
  scope: "QA_PROFILE_DRY_RUN_ONLY_NO_PRODUCT_OR_FILESYSTEM_MUTATION" }));
