"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { validateConfig, adapt } = require("./editor-candidate-upgrade.cjs");
const c = {
  oldVersion: "1.9.30", version: "1.9.31",
  out: "F:/AgentVN/QA/Editor-Upgrade-1931-20261027-01",
  checkpoint: "F:/AgentVN/Checkpoints/Editor-Upgrade-1931-20261027-01",
  preparation: "F:/AgentVN/QA/Editor-1.9.31-20261027-01/upgrade-preparation-01",
  oldInstaller: { path: "D:/AgentVN/releases/editor/AgentVN_Editor_v1.9.30_20261026_122725.exe", sha256: "a".repeat(64) },
  actualInstallation: { path: "F:/AgentVN/QA/candidate/actual.json", sha256: "b".repeat(64) },
  installerSHA256: "c".repeat(64),
};
const registration = { path: "F:/AgentVN/QA/Editor-1.9.27-20261026-01/installed-editor" };
validateConfig(c);
let rejected = 0;
for (const mutate of [
  x => x.out = "F:/AgentVN", x => x.out = "F:/AgentVN/QA/../../unsafe",
  x => x.checkpoint = "C:/Users/1", x => x.preparation = x.out,
  x => x.version = x.oldVersion, x => x.version = "1.9.29",
  x => x.actualInstallation.sha256 = "", x => x.installerSHA256 = "",
]) {
  const bad = structuredClone(c); mutate(bad);
  assert.throws(() => validateConfig(bad)); rejected++;
}
for (const kind of ["business", "session", "audit"]) {
  const name = `candidate-1924-editor-upgrade${kind === "business" ? ".cjs" : kind === "session" ? "-session.ps1" : "-audit.cjs"}`;
  const source = adapt(kind, fs.readFileSync(path.join(__dirname, name), "utf8"), c, registration).source;
  assert(!source.includes("Editor-Upgrade-1930-20261026-01"));
  assert(!source.includes("1.9.29"));
  if (kind === "session") {
    assert(source.includes(`$old='${c.oldInstaller.path.replaceAll("/", "\\")}'`), "Must not rewrite old installer filename to new version");
    assert(source.includes("$version=if($Action -ceq 'InstallOld'){'1.9.30'}else{'1.9.31'}"));
    assert(source.includes("$originalInstall='F:/AgentVN/QA/Editor-1.9.27-20261026-01/installed-editor'"));
  } else if (kind === "business") {
    assert(source.includes('await launch("old","1.9.30")'));
    assert(source.includes('await launch("new","1.9.31")'));
    assert(source.includes('await launch("restart","1.9.31")'));
    assert(source.includes("REAL_NSIS_1_9_30_TO_1_9_31_DEFAULT_PATHS"));
    assert(source.includes("Computer Use Alt+F4"));
  } else {
    assert(source.includes('actualVersion,"1.9.30"'));
    assert(source.includes('actualVersion,"1.9.31"'));
    assert(source.includes('old.cacheEditorVersion,"1.9.30"'));
    assert(source.includes('next.cacheEditorVersion,"1.9.31"'));
  }
}
console.log(JSON.stringify({ status: "PASS", nativeApps: 0, modelRequests: 0, fullWorkflowBindings: 3, rejected }));
