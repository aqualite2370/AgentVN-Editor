"use strict";
// Retain the six real upgrade flows, binding each to a frozen old installer.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Windows-Package-20261021-01";
const original = path.join(__dirname, "installed-windows-game-upgrade-current.cjs");
const originalSha = "df7d78a8ba59adc66d2ac889e25f2d63ab983bb3a0fcfaf76e072890ce4ffef8";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function adapt(sample) {
  assert(["oldest", "recent", "recent-fixed"].includes(sample));
  assert.equal(sha(original), originalSha);
  const recent = sample !== "oldest", fixed = sample === "recent-fixed";
  const attempt = fixed ? "22" : recent ? "21" : "20";
  let source = fs.readFileSync(original, "utf8");
  const changes = [];
  const replace = (before, after, count = 1) => {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after); changes.push({ before, after, count });
  };
  replace('process.argv[2] || "13"', `"${attempt}"`);
  replace('"editor-04/report.json"', '"editor-05/report.json"');
  replace('require("./installed-windows-native-ui-current-audit.cjs")', 'require("./candidate-1924-windows-native-audit.cjs")');
  replace('require("./lib/windows-game-upgrade-fixture.cjs")', 'require("./lib/windows-1924-upgrade-fixture.cjs")');
  replace('"native-ui-audit-03/report.json"', '"native-ui-audit-04/report.json"');
  replace('"setup-payload-audit-03/report.json"', '"setup-payload-audit-04/report.json"');
  replace('"windows-setup-session.ps1"', '"candidate-1924-windows-upgrade-session.ps1"', 7);
  replace('"installed-windows-game-upgrade-current.cjs"', '"candidate-1924-windows-upgrade.cjs"');
  replace('editorVersion: "1.9.22"', 'editorVersion: "1.9.24"');
  replace('"RETAINED_EDITOR_1_9_16_TO_INSTALLED_EDITOR_1_9_22_SAME_GAME_WINDOWS_SETUP_UPGRADE"',
    `"RETAINED_EDITOR_${recent ? "1_9_22" : "1_9_16"}_TO_INSTALLED_EDITOR_1_9_24_SAME_GAME_WINDOWS_SETUP_UPGRADE"`);
  replace('await startShortcut("1.0.1")', 'await startShortcut("1.0.2")');
  // The stored current sentence belongs to the old save. Only advancing consumes
  // new script bytes; verify the complete sentence, not a marker shared by builds.
  replace('assert((await page.locator(".dialog-box").innerText()).includes(`${marker}_${index}`));',
    `assert((await page.locator(".dialog-box").innerText()).includes(\`\${marker}_\${index}\`));
  if (launch.version === "1.0.2" && marker === "QA_WINDOWS_UPGRADE_NEW")
    assert((await page.locator(".dialog-box").innerText()).includes(
      current.upgradeFixture.project.nodes[1].data.scene.commands[index].text));`);
  if (fixed) {
    replace("async function command(index, marker)", "async function command(index, marker, validateNewScript = false)");
    replace('if (launch.version === "1.0.2" && marker === "QA_WINDOWS_UPGRADE_NEW")', "if (validateNewScript)");
    replace('await command(index + 1, "QA_WINDOWS_UPGRADE_NEW")', 'await command(index + 1, "QA_WINDOWS_UPGRADE_NEW", true)');
  }
  // Preserve native close waits; preparation and cleanup use exact bounded roots.
  if (recent) {
    replace('"editor-01/report.json"), old = read(oldFile); validateBuildEvidence(old)',
      '"editor-04/report.json"), old = read(oldFile); require("./installed-windows-native-ui-current-audit.cjs").validate(old)');
    replace('assert.equal(gameId, old.cartridge.manifest.game_id)', 'assert.equal(gameId, old.projectId)');
    replace('await startShortcut("1.0.0")', 'await startShortcut("1.0.1")');
    replace('"QA_WINDOWS_SAVE"', '"QA_WINDOWS_UPGRADE_NEW"', 3);
    // ValidateSource runs before profile preparation.
    replace('for (const action of ["SelfTest", "ValidateSource", "ValidateUpgrade"])',
      `fs.writeFileSync(path.join(out, "native-setup-source.json"), JSON.stringify({
    editorVersion: "1.9.22", nativeUIBuildSource: true,
    source: desc(oldFile), audit: desc(path.join(qa, "native-ui-audit-03/report.json")),
    payload: desc(path.join(qa, "setup-payload-audit-03/report.json")),
  }, null, 2), { flag: "wx" });
  for (const action of ["SelfTest", "ValidateSource", "ValidateUpgrade"])`);
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  return { source, changes, attempt };
}
function provenance() {
  const old = read(path.join(qa, "editor-01/report.json"));
  require("./lib/windows-package-current-evidence.cjs").validateBuildEvidence(old);
  require("./installed-windows-native-ui-current-audit.cjs").validate(read(path.join(qa, "editor-04/report.json")));
  const current = read(path.join(qa, "editor-05/report.json"));
  require("./candidate-1924-windows-native-audit.cjs").validate(current);
  require("./lib/windows-1924-upgrade-fixture.cjs").validateUpgradeFixture(current.upgradeFixture);
  for (const [a, b] of [["native-ui-audit-04", "editor-05"], ["setup-payload-audit-04", "editor-05"]]) {
    const r = read(path.join(qa, a, "report.json"));
    assert.equal(r.status, "PASS"); assert.equal(r.source.sha256, sha(path.join(qa, b, "report.json")));
  }
}
if (process.argv[2] === "--self-test") {
  provenance();
  (async () => {
    const fixture = read(path.join(qa, "editor-05/report.json")).upgradeFixture;
    function commandFrom(sample, text) {
      const source = adapt(sample).source;
      const body = source.slice(source.indexOf("async function command("), source.indexOf("async function shot("));
      return vm.runInNewContext(`(${body})`, { assert, launch: { version: "1.0.2" },
        current: { upgradeFixture: fixture }, page: { waitForFunction: async () => {},
          locator: () => ({ innerText: async () => text }) } });
    }
    const oldText = fixture.project.nodes[1].data.scene.commands[0].text.replace("1.0.2", "1.0.1");
    await assert.rejects(commandFrom("recent", oldText)(0, "QA_WINDOWS_UPGRADE_NEW"));
    await commandFrom("recent-fixed", oldText)(0, "QA_WINDOWS_UPGRADE_NEW");
    await assert.rejects(commandFrom("recent-fixed", oldText)(0, "QA_WINDOWS_UPGRADE_NEW", true));
    await commandFrom("recent-fixed", fixture.project.nodes[1].data.scene.commands[1].text)(1, "QA_WINDOWS_UPGRADE_NEW", true);
    console.log(JSON.stringify({ status: "PASS", adaptations: Object.fromEntries(
      ["oldest", "recent", "recent-fixed"].map(s => [s, adapt(s).changes.length])),
      restoredSentenceRegression: 4, productLaunches: 0 }));
  })().catch(e => { console.error(e); process.exitCode = 1; });
} else {
  const sample = process.argv[2]; provenance(); const adapted = adapt(sample);
  const checkpoint = `F:/AgentVN/Checkpoints/Windows-Upgrade-1924-20261025-${sample}`;
  fs.mkdirSync(checkpoint);
  const files = [__filename, original, path.join(__dirname, "candidate-1924-windows-upgrade-session.ps1"),
    path.join(__dirname, "windows-setup-session.ps1"), path.join(__dirname, "windows-standalone-profile-session.ps1"),
    path.join(__dirname, "../plans/ACTIVE_TASKS.md"), path.join(__dirname, "../plans/FULL_REGRESSION_20261017.md")];
  for (const file of files) fs.copyFileSync(file, path.join(checkpoint, path.basename(file)), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify(files.map(file => ({
    path: file, sha256: sha(file), bytes: fs.statSync(file).size })), null, 2), { flag: "wx" });
  fs.writeFileSync(path.join(qa, `candidate-1924-upgrade-${sample}-adaptations.json`),
    JSON.stringify({ source: original, sha256: originalSha, changes: adapted.changes }, null, 2), { flag: "wx" });
  process.argv = [process.argv[0], __filename, adapted.attempt];
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(adapted.source, __filename);
}
