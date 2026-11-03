"use strict";
// Resume only the uncompleted checks. Keep the first 144 actual field jumps
// and the original FAILED result; scope the duplicate character input correctly.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Resource-Guidance-1.9.35-20261102-01";
const originalFile = path.join(__dirname, "current-resource-guidance-closure.cjs");
const priorFile = path.join(qa, "session-01/report.json");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  function region(start, end, replacement) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert(a > 0 && b > a); change(source.slice(a, b), replacement);
  }
  change('const out = path.join(qa, "session-01");', 'const out = path.join(qa, "session-02");');
  change('assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });',
    'assert(fs.existsSync(path.join(checkpoint, "receipt.json")));');
  change('scope: "EXACT_INSTALLED_RESOURCE_DIAGNOSTICS_NAVIGATION_CORRECTION_NATIVE_SAVE_RESTART_NO_MODEL",',
    'scope: "EXACT_INSTALLED_RESOURCE_GUIDANCE_REMAINING_ASSERTIONS_NO_MATRIX_REPLAY",\n' +
    '  continuedFrom: module.qaPrior, qaBinding: module.qaBinding, inheritedDisplayCombinations: 12,');
  region('for (const file of [__filename, "plans/ACTIVE_TASKS.md"', "const save = () =>",
    'fs.copyFileSync(module.qaExecuted.path, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);\n');
  change('  save(); cache("SelfTest"); cachePrepared = true; cache("Prepare");',
    `  fs.cpSync(path.join(qa, "session-01/data"), path.join(out, "data"), { recursive: true, errorOnExist: true, force: false });
  save(); cache("SelfTest"); cachePrepared = true; cache("Prepare");`);
  region('  await stage("installed-import-current-resource-protocol-twenty-one-required-no-fabricated-portrait"',
    '  await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });',
    `  await stage("resume-existing-corrected-database-without-repeating-display-matrix", async () => {
    page = await host.start(); await open();
    await page.waitForFunction(() => document.querySelectorAll(".inspector-asset-audit article:not(.is-optional)").length === 20);
    expected = await graph();
    const commands = structuredClone(project.nodes[1].data.scene.commands);
    commands[0].background_id = "valid_background";
    assert.deepEqual(expected.find(n => n.id === "scene").data.scene.commands, commands);
    assert.equal(expected.length, 3);
    return { originalRequired: 21, remainingRequired: 20, noDuplicateCommands: true,
      inheritedMatrix: module.qaPrior, newDisplayMatrixRuns: 0 };
  });
`);
  change('"actual-cancel-rebind-clear-optional-target-and-node-isolation"',
    '"remaining-scoped-optional-character-target-and-node-isolation"');
  region('    await audit().locator(\'article[data-command-index="0"][data-field="background_id"]\').getByRole("button", { name: /定位/ }).click();',
    '    await audit().getByRole("button", { name: /展开可选建议/ }).click();', "");
  change('    await page.waitForFunction(() => document.querySelector(\'[data-help-key="command.sprite.characterId"]\')?.value === "bob");',
    `    await until(() => workbench.locator('[data-help-key="command.sprite.characterId"]').inputValue()
      .then(value => value === "bob"), "bob in floating event workbench, not inline carol control");`);
  change('return { cancelledUnchanged: true, correctionRemovesExactlyOne: true, clearRequiresResourceAgain: true,\n      suggestionsPreserveCharacterWithoutInsertion: true, otherSceneRequired: 0, correctedSceneRequired: 20 };',
    'return { earlierCancelRebindClearEvidence: module.qaPrior,\n      suggestionsPreserveCharacterWithoutInsertion: true, otherSceneRequired: 0, correctedSceneRequired: 20 };');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode) {
  assert(["self-test", "run"].includes(mode));
  const result = build(fs.readFileSync(originalFile, "utf8"));
  if (mode === "self-test") {
    let replay = fs.readFileSync(originalFile, "utf8");
    for (const e of result.edits) replay = replay.replaceAll(e.before, () => e.after);
    assert.equal(replay, result.source); assert.throws(() => build(""));
    console.log(JSON.stringify({ status: "PASS", edits: result.edits.length, productStarts: 0 })); return;
  }
  const prior = read(priorFile);
  assert.equal(prior.status, "FAILED"); assert(prior.error.includes(":171:"));
  assert.equal(prior.cases.length, 3); assert(prior.cases.slice(0, 2).every(c => c.status === "PASS"));
  assert.equal(prior.matrix.length, 12); assert(prior.matrix.every(c => c.status === "PASS" && c.jumps.length === 12));
  assert(prior.cleanups.every(c => c.status === "PASS"));
  assert.equal(read(prior.cacheRestoration.path).status, "PASS");
  assert.equal(sha(originalFile), prior.source.sha256);
  assert(!rows().some(p => /^(agentvn-editor|creator-backend|agentvn-player)\.exe$/i.test(p.Name)));
  const binding = path.join(qa, "resume-binding.json"), executed = path.join(qa, "resume-executed.cjs");
  assert(!fs.existsSync(binding) && !fs.existsSync(executed));
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.writeFileSync(binding, JSON.stringify({ original: desc(originalFile), adapter: desc(__filename),
    prior: desc(priorFile), executed: desc(executed), edits: result.edits }, null, 2), { flag: "wx" });
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname),
    qaBinding: desc(binding), qaPrior: desc(priorFile), qaExecuted: desc(executed) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2]);
