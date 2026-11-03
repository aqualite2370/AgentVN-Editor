"use strict";
// QA-only readiness correction. Execute and audit the unchanged business flow
// with exact replayable substitutions; keep all prior tools/receipts untouched.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { buildCurrentAbilitiesFlow } = require("./lib/candidate-1924-abilities-final-adapter.cjs");
const { validateAbilitiesPreparation, loadAdaptedFlow } = require("./lib/candidate-1924-abilities-adapter.cjs");
const mode = process.argv.splice(2, 1)[0];
assert(["session", "flow", "audit", "self-test"].includes(mode));
function exact(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  return source.replace(before, after);
}
function adapt(original) {
  const current = buildCurrentAbilitiesFlow(original);
  const before = '  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page); page.setDefaultTimeout(20000);';
  const after = `  report.targetReadiness ??= [];
  const readiness = { launch: report.launches.length,
    initialURLs: browser.contexts().flatMap(c => c.pages()).map(p => p.url()), events: [] };
  report.targetReadiness.push(readiness); save();
  page = await require("./lib/wait-native-runtime-page.cjs").waitNativeRuntimePage(browser, {
    observe: event => { readiness.events.push({ ...event, at: new Date().toISOString() }); save(); }
  });
  readiness.readyURL = page.url(); readiness.readyAt = new Date().toISOString(); save();
  page.setDefaultTimeout(20000);`;
  current.source = exact(current.source, before, after);
  current.adaptations.push({ before, after, reason: "Actual native document readiness, not endpoint readiness or a fixed sleep" });
  assert.equal(current.adaptations.length, 12);
  return current;
}
function compile(source) {
  new vm.Script(Module.wrap(source), { filename: __filename });
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(source, __filename);
}
if (mode === "flow") {
  const index = process.argv.indexOf("--current-native-preparation"); assert(index > 0);
  const prep = JSON.parse(fs.readFileSync(process.argv[index + 1], "utf8").replace(/^\uFEFF/, ""));
  validateAbilitiesPreparation(prep);
  const original = path.join(__dirname, "installed-runtime-abilities-playwright.cjs");
  const { source, adaptations } = adapt(fs.readFileSync(original, "utf8"));
  const out = path.resolve(process.argv[2]); assert.equal(path.dirname(out), prep.sessionRoot);
  assert.match(path.basename(out), /^cell-(0[1-9]|1[0-2])$/);
  const executed = out + "-executed.cjs";
  new vm.Script(Module.wrap(source), { filename: executed });
  fs.writeFileSync(executed, source, { flag: "wx" });
  fs.writeFileSync(out + "-adaptations.json", JSON.stringify({
    original: { path: original, sha256: sha(original) },
    executed: { path: executed, sha256: sha(executed) }, adaptations,
  }, null, 2), { flag: "wx" });
  loadAdaptedFlow(source, __filename, module);
} else if (mode === "session") {
  assert.equal(process.argv[2], "05");
  const file = path.join(__dirname, "candidate-1924-abilities-session.cjs");
  assert.equal(sha(file), "c6e8aa9d3c4413b7b8a11045faa796e72a9ace89473c78270dbae95dc2c88cac");
  let source = fs.readFileSync(file, "utf8");
  source = exact(source, "`fresh-export-audit-${attempt}/report.json`", '"fresh-export-audit-03/report.json"');
  source = exact(source, '["scripts/candidate-1924-abilities-flow.cjs", cellOut,',
    '["scripts/candidate-1924-abilities-ready.cjs", "flow", cellOut,');
  source = exact(source, "report.tools = [__filename,", 'report.tools = [__filename, ' +
    '"scripts/candidate-1924-abilities-session.cjs", "scripts/lib/candidate-1924-abilities-final-adapter.cjs", ' +
    '"scripts/lib/wait-native-runtime-page.cjs", "scripts/wait-native-runtime-page-test.cjs",');
  source = exact(source, 'await command(process.execPath, ["scripts/candidate-1924-abilities-adapter-test.cjs"], "adapter-guard");',
    'await command(process.execPath, ["scripts/candidate-1924-abilities-adapter-test.cjs"], "adapter-guard");\n' +
    '  await command(process.execPath, ["scripts/wait-native-runtime-page-test.cjs"], "readiness-guard");');
  compile(source);
} else if (mode === "audit") {
  assert.equal(process.argv[2], "05");
  const file = path.join(__dirname, "candidate-1924-abilities-audit.cjs");
  assert.equal(sha(file), "622c810a835f78951181f32a4c39a1ab3f46ec459101f371e4c5712d127b6688");
  let source = fs.readFileSync(file, "utf8");
  source = exact(source, "assert.equal(adapted.adaptations.length, 6);", "assert.equal(adapted.adaptations.length, 12);");
  source = exact(source, '["adapter-guard", "profile-prepare",', '["adapter-guard", "readiness-guard", "profile-prepare",');
  source = exact(source, '  report.status = "PASS";', `
  check("Live grids, inert retained cards, unique native logs and actual target readiness", () => {
    let probes = 0, readinessEvents = 0;
    for (const cell of session.cells) {
      const raw = read(cell.raw.path);
      assert.equal(raw.saveGridProbes.length, 2); assert.equal(raw.targetReadiness.length, 3);
      for (const p of raw.saveGridProbes) {
        probes++;
        assert.equal(p.liveGrids, 1); assert.equal(p.liveSlots, 6); assert.equal(p.liveSaved, 6);
        assert.equal(p.allSaved, p.liveSaved + p.retained.reduce((n, g) => n + g.saved, 0));
        for (const g of p.retained) {
          assert(g.inert); assert.equal(g.hidden, "true"); assert.equal(g.pointerEvents, "none");
          assert.equal(g.functionalMarkers, 0); assert.equal(g.hasFocus, false);
        }
      }
      for (const [index, ready] of raw.targetReadiness.entries()) {
        assert.equal(ready.launch, index + 1); assert(ready.readyAt && ready.events.length > 0);
        assert.equal(new URL(ready.readyURL).hostname, "tauri.localhost");
        assert.equal(ready.events.at(-1).candidates, 1);
        readinessEvents += ready.events.length;
      }
      const expectedLogs = ["agentvn-player-1.log", "agentvn-player-3.log", "renpy-player-2.log"];
      assert.deepEqual(fs.readdirSync(cell.out).filter(n => expectedLogs.includes(n)).sort(), expectedLogs);
    }
    assert.equal(probes, 24);
    return { probes, readinessEvents, actualLaunches: 36, exclusiveLogs: 36 };
  });
  report.status = "PASS";`);
  compile(source);
} else {
  const original = fs.readFileSync(path.join(__dirname, "installed-runtime-abilities-playwright.cjs"), "utf8");
  const { source, adaptations } = adapt(original);
  let replay = original;
  for (const a of adaptations) replay = exact(replay, a.before, a.after);
  assert.equal(replay, source); new vm.Script(Module.wrap(source));
  for (const text of ['business ? 16 : crossOnly ? 1', "assert.equal(retained.length, 6)",
    "assert.deepEqual(await saves(), before", "assert.equal(latest.command_index, 6)"])
    assert(source.includes(text), text);
  assert.throws(() => adapt(original.replace('assert(page); page.setDefaultTimeout(20000);', "")));
  assert.throws(() => adapt(original + '\n  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page); page.setDefaultTimeout(20000);'));
  console.log(JSON.stringify({ status: "PASS", exactTransformations: adaptations.length,
    scope: "QA_SOURCE_DRIFT_AND_BUSINESS_ASSERTIONS_NOT_NATIVE_ACCEPTANCE" }));
}
