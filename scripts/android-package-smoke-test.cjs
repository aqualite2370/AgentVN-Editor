"use strict";
const assert = require("node:assert/strict");
const { validatePackageSmokeInput, packageSmokeCoverage, packageSmokeStatus } =
  require("./lib/android-package-smoke.cjs");
const fixture = { projectId: "qa_android_pkg_20261021_08", title: "AVN Android QA 20261021",
  sceneId: "ui_acceptance", texts: Array.from({ length: 3 }, (_, n) => `QA_ANDROID_${n}：隔离旁白`) };
const project = { project_id: fixture.projectId, title: fixture.title, asset_manifest: [], editor_settings: {},
  nodes: [{ data: { scene: { scene_id: fixture.sceneId,
    commands: fixture.texts.map(text => ({ type: "narration", text })) } } }] };
const manifest = { game_id: fixture.projectId, title: fixture.title, assets: [], entry_scene_id: fixture.sceneId };
const script = { scenes: [{ scene_id: fixture.sceneId,
  commands: fixture.texts.map(text => ({ type: "narration", text })) }] };
const layout = { layout_type: "agentvn" };
validatePackageSmokeInput(fixture, project, manifest, script, layout);
const bad = [
  (f, p) => { p.project_id = "user_project"; },
  (f, p, m) => { m.game_id = "different_qa_project"; },
  (f, p, m, s) => { s.scenes[0].commands[1].text = "not the exported line"; },
  (f, p, m, s) => { s.scenes.push({ scene_id: "unexpected" }); },
  (f, p, m) => { m.assets.push({ asset_id: "unclaimed" }); },
  (f, p) => { p.asset_manifest.push({ asset_id: "unclaimed" }); },
  (f, p, m, s, l) => { l.layout_type = "renpy"; },
  f => { f.projectId = "project_msiz08p7_0_89ebc8a8cb"; },
  (f, p, m, s) => { s.scenes[0].commands[0].type = "dialogue"; },
  (f, p, m) => { m.entry_scene_id = "wrong"; },
];
for (const change of bad) {
  const copies = structuredClone([fixture, project, manifest, script, layout]);
  change(...copies); assert.throws(() => validatePackageSmokeInput(...copies));
}
const coverage = packageSmokeCoverage();
assert(Object.keys(coverage).length >= 10);
assert(Object.values(coverage).every(v => v === "NOT_RUN"));
const stages = { build: "PASS", runtime: "PASS", provenance: "PASS", cleanup: "PASS", audio: "BLOCKED" };
const complete = Object.fromEntries(Object.keys(coverage).map(k => [k, "PASS"]));
assert.equal(packageSmokeStatus(stages, complete), "INSTALLED_PACKAGE_SMOKE_PASS");
assert.equal(packageSmokeStatus(stages, {}), "BLOCKED", "Empty coverage must not pass");
for (const name of Object.keys(coverage)) {
  const missing = { ...complete }; delete missing[name];
  assert.equal(packageSmokeStatus(stages, missing), "BLOCKED", name);
  assert.equal(packageSmokeStatus(stages, { ...complete, [name]: "FAILED" }), "FAILED", name);
}
for (const name of ["build", "runtime", "provenance", "cleanup"]) {
  assert.equal(packageSmokeStatus({ ...stages, [name]: "NOT_RUN" }, complete), "BLOCKED", name);
  assert.equal(packageSmokeStatus({ ...stages, [name]: "FAILED" }, complete), "FAILED", name);
}
assert.equal(packageSmokeStatus(stages, coverage), "BLOCKED", "No fixture run must not pass");
console.log("android-package-smoke: PASS (exact isolated fixture, ten bad inputs, nonempty coverage, scoped status)");
