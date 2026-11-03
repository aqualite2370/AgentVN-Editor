"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha, InstalledRuntimeSession } = require("./lib/installed-runtime-session.cjs");
const { validateQuickPreparation } = require("./lib/installed-runtime-quick-1922-preparation.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sourcePath = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json";
const source = read(sourcePath), out = path.resolve(
  "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-quick-1922-01");
const fixturePath = path.join(source.out, "fixture.json");
const prep = {
  status: "PASS", current1922Library: true, sessionRoot: out,
  defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
  executable: source.protectedProducts.find(p => p.path.endsWith("agentvn-player.exe")),
  originalExport: { path: sourcePath, sha256: sha(sourcePath) },
  originalFixture: { path: fixturePath, sha256: sha(fixturePath) },
  installation: source.installation, fixture: source.fixture, cartridges: source.cartridges,
  profiles: [], installId: "qa_current_quick_1922_01",
};
assert.doesNotThrow(() => validateQuickPreparation(prep, out));
assert.doesNotThrow(() => new InstalledRuntimeSession({ prep, fixture: prep.fixture,
  cartridges: prep.cartridges, out, report: {}, save() {}, installId: prep.installId, currentNative: true }));
const variants = [
  p => { p.current1922Library = false; }, p => { p.executable.sha256 = "wrong"; },
  p => { p.originalExport.sha256 = "wrong"; }, p => { p.originalFixture.sha256 = "wrong"; },
  p => { p.installation.sha256 = "wrong"; }, p => { p.defaultStorage = "PHYSICAL_DEFAULT_PATH"; },
  p => { p.sessionRoot = "D:/AgentVN"; }, p => { p.installId = "preview_gamecli"; },
  p => { p.cartridges.pop(); }, p => { p.fixture.inputSha256 = "wrong"; },
];
for (const mutate of variants) {
  const p = structuredClone(prep); mutate(p);
  assert.throws(() => validateQuickPreparation(p, out));
}
const lockFile = path.resolve("scripts/installed-runtime-quick-gaps-lock.ps1");
const directory = "C:/Users/1/AppData/Roaming/com.agentvn.player/saves/qa_current_quick_1922_01_01";
function validateLock(target, run = out) {
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    lockFile, "-Target", target, "-Ready", path.join(run, "policy-ready"),
    "-Release", path.join(run, "policy-release"), "-RunDirectory", run, "-Current1922", "-ValidateOnly"],
  { encoding: "utf8", windowsHide: true, timeout: 15000 });
}
const allowed = validateLock(path.join(directory, "quick-01.json"));
assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
assert(allowed.stdout.includes("PASS_VALIDATED_ONLY"));
for (const target of [
  path.join(directory, "../preview_gamecli/quick-01.json"),
  path.join(directory, "slot-01.json"), path.join(directory, "../qa_current_quick_1922_02_01/quick-01.json"),
  path.join(directory, "quick-07.json"),
]) assert.notEqual(validateLock(target).status, 0, target);
assert.notEqual(validateLock(path.join(directory, "quick-01.json"), "F:/AgentVN/QA").status, 0);
console.log(JSON.stringify({ status: "PASS", accepted: 1, constructor: "PASS",
  rejectedVariants: variants.length, acceptedLock: 1, rejectedLocks: 5,
  scope: "QA_PREPARATION_GUARD_NO_PRODUCT_START_OR_LOCK" }));
