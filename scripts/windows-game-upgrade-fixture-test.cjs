"use strict";
// QA contract only: keep the real retained game's identity and graph positions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { retainedUpgradeFixture, validateUpgradeFixture } = require("./lib/windows-game-upgrade-fixture.cjs");
const result = retainedUpgradeFixture();
assert.equal(result.version, "1.0.1");
assert.equal(result.marker, "QA_WINDOWS_UPGRADE_NEW");
const old = JSON.parse(fs.readFileSync(result.source.path, "utf8"));
assert.equal(result.project.project_id, old.project_id);
assert.equal(result.project.title, old.title);
assert.deepEqual(result.project.edges, old.edges);
assert.deepEqual(result.project.nodes.map(n => [n.id, n.type, n.position]),
  old.nodes.map(n => [n.id, n.type, n.position]));
assert.equal(result.project.nodes[1].data.scene.scene_id, old.nodes[1].data.scene.scene_id);
validateUpgradeFixture(result);
const mutations = [
  x => { x.project.project_id += "-wrong"; },
  x => { x.project.title += "-wrong"; },
  x => { x.project.nodes[1].id = "new-node"; },
  x => { x.project.nodes[1].data.scene.scene_id = "new-scene"; },
  x => { x.project.nodes[1].data.scene.commands.pop(); },
  x => { x.project.nodes[1].data.scene.commands[0].type = "choice"; },
  x => { x.project.nodes[1].data.scene.commands[1].text = old.nodes[1].data.scene.commands[1].text; },
  x => { x.version = "1.0.0"; },
  x => { x.source.sha256 = "0".repeat(64); },
];
for (const mutate of mutations) {
  const copy = structuredClone(result); mutate(copy);
  assert.throws(() => validateUpgradeFixture(copy));
}
console.log(JSON.stringify({ status: "PASS", identityAndGraphPreserved: true,
  rejectedVariants: mutations.length, version: result.version, source: result.source }));
const { validateRetained1924Source } = require("./lib/windows-current-native-source.cjs");
const retained = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Windows-Package-20261021-01/editor-05/report.json", "utf8"));
validateRetained1924Source(retained);
for (const mutate of [
  value => { value.status = "RUNNING"; },
  value => { value.windowsInstaller.sha256 = "0".repeat(64); },
  value => { value.upgradeFixture.version = "1.0.3"; },
  value => { value.priorUpgradeFixture.project.project_id = "other"; },
  value => { value.steps.pop(); },
]) {
  const changed = structuredClone(retained); mutate(changed);
  assert.throws(() => validateRetained1924Source(changed));
}
console.log("PASS: exact retained 1.9.24 report, historical audits and actual package bytes; five substitutions rejected");
