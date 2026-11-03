"use strict";
// Keep the archived business flow intact. Every source adaptation is explicit,
// count-checked and retained, with no product, engine or audio replacement.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateCandidateNarrativePreparation } = require("./lib/candidate-1924-narrative-preparation.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const prep = read(process.argv[2]); validateCandidateNarrativePreparation(prep);
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(prep.fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), prep.sessionRoot);
const original = path.join(__dirname, "dev-narrative-playwright.cjs");
let source = fs.readFileSync(original, "utf8");
const adaptations = [];
function replace(before, after, reason) {
  assert.equal(source.split(before).length - 1, 1, reason);
  source = source.replace(before, after); adaptations.push({ before, after, reason });
}
replace('const { validateDevNarrativePreparation } = require("./lib/dev-narrative-preparation.cjs");',
  'const { validateCandidateNarrativePreparation: validateDevNarrativePreparation } = require("./lib/candidate-1924-narrative-preparation.cjs");\n' +
  'const { assertRestoredNarrativeState } = require("./lib/narrative-restoration-state.cjs");\n' +
  'const { installChoiceFrameProbe, analyzeChoiceFrames, analyzeDialogFrames } = require("./lib/nvl-choice-frame-probe.cjs");',
  "Bind this exact installed candidate, reuse independently tested persistence and first-frame assertions");
replace('scope: "CURRENT_DEV_NATIVE_LIBRARY_NVL_CAPACITY_AND_VOICE_RESTORATION_NOT_INSTALLED",',
  'scope: '+JSON.stringify(prep.scope)+',',
  "Report actual scope, never relabel historical Dev or fresh authoring");
replace("const player = new NarrativePlayer(prep, report, save);",
  "const player = new NarrativePlayer(prep, report, save, validateDevNarrativePreparation);\n" +
  `async function beginFrameProbe(kind) {
    await page().evaluate(installChoiceFrameProbe, { kind });
    await page().evaluate(() => window.__QA_NVL_CHOICE_PROBE__.start());
  }
  async function finishFrameProbe(kind) {
    await page().waitForFunction(() => window.__QA_NVL_CHOICE_PROBE__.read().active === false,
      null, { timeout: 15000 });
    const frames = await page().evaluate(() => window.__QA_NVL_CHOICE_PROBE__.finish());
    const file = path.join(out, cell.name + "-" + kind + "-frames.json");
    fs.writeFileSync(file, JSON.stringify(frames, null, 2), { flag: "wx" });
    const observation = kind === "dialog" ? analyzeDialogFrames(frames) : analyzeChoiceFrames(frames);
    cell.frameTraces ??= []; cell.frameTraces.push({ path: file, sha256: sha(file), kind, observation }); save();
    assert.equal(observation.classification, "NO_OVERFLOW_OBSERVED",
      "Retain mutation and first-render failures, not just final screenshot geometry");
    await page().evaluate(() => { delete window.__QA_NVL_CHOICE_PROBE__; });
  }`,
  "Use explicit installed validator and read-only DOM/RAF probes; never the default Dev validator");
replace('await page().getByRole("button", { name: `选择：${name}`, exact: true }).click(); return command(name, 0);',
  'if (name === "voice_dialog") await beginFrameProbe("dialog");\n' +
  '  await page().getByRole("button", { name: `选择：${name}`, exact: true }).click();\n' +
  '  const state = await command(name, 0);\n' +
  '  if (name === "voice_dialog") await finishFrameProbe("dialog");\n  return state;',
  "Observe the ordinary dialogue first paint from the real branch click");
replace('    await page().locator(".dialog-box").click();\n    if (i < 23)',
  '    if (i === 23) await beginFrameProbe("nvl-choice");\n' +
  '    await page().locator(".dialog-box").click();\n    if (i < 23)',
  "Start NVL choice sampling before its real advancing input");
replace('  const choice = await snapshot(); geometry(choice, true);',
  '  await finishFrameProbe("nvl-choice");\n  const choice = await snapshot(); geometry(choice, true);',
  "Assert all first-render choice frames before final geometry");
replace("assert.deepEqual(restored.nvl, choice.nvl);",
  "assertRestoredNarrativeState(restored, choice, cell.viewport);",
  "Exact restored narrative content/font/page plus independently bounded actual geometry");
replace("assert.equal(restored.scene, name); assert.equal(restored.page, 2); assert.equal(restored.text, interior.text);",
  "assertRestoredNarrativeState(restored, interior, cell.viewport);",
  "Also require complete restored NVL content and actual glyph geometry at interior pages");
replace("assert.deepEqual(forward.nvl, next.nvl);",
  "assertRestoredNarrativeState(forward, next, cell.viewport);",
  "Rollforward restores content and fonts, not nonpersisted fractional layout boxes");
replace("assert.deepEqual(s.nvl, saved.interior.nvl); geometry(s);",
  "assertRestoredNarrativeState(s, saved.interior, cell.viewport); geometry(s);",
  "Fresh-process restoration uses exact persisted identity and independent bounds");
replace("qa_dev_narrative_",
  `qa_installed_${(prep.candidateVersion || "1.9.24").replaceAll(".", "")}_narrative_`,
  "Separate test save identities from historical Dev runs");
const executed = path.join(prep.sessionRoot, "executed-flow.cjs");
if (process.argv.includes("--validate-adapter")) {
  new (require("node:vm").Script)(Module.wrap(source), { filename: executed });
  console.log(JSON.stringify({ status: "PASS", adaptations: adaptations.length, productStarted: false }));
} else {
  fs.writeFileSync(executed, source, { flag: "wx" });
  fs.writeFileSync(path.join(prep.sessionRoot, "flow-adaptations.json"), JSON.stringify({
    original: { path: original, sha256: sha(original) },
    executed: { path: executed, sha256: sha(executed) }, adaptations,
  }, null, 2), { flag: "wx" });
  const worker = new Module(path.join(__dirname, "__candidate-1924-narrative-flow.cjs"), module);
  worker.filename = path.join(__dirname, "__candidate-1924-narrative-flow.cjs");
  worker.paths = Module._nodeModulePaths(__dirname);
  worker._compile(source, worker.filename);
}
