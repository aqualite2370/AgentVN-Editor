"use strict";
// Offline tool checks: real exclusive log creation, observed native layer
// evidence and exact, drift-rejecting source changes. No Player is launched.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const attempt = process.argv[2]; assert.match(attempt || "", /^(red|green)-\d{2}$/);
const root = "F:/AgentVN/QA/Abilities-QA-20261024-01";
fs.mkdirSync(root, { recursive: true }); const out = path.join(root, attempt);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out, checks: [],
  scope: "OFFLINE_QA_TOOL_ONLY_NOT_NATIVE_BUSINESS", productChanges: 0, builds: 0, modelRequests: 0 };
function check(name, fn) { const detail = fn(); report.checks.push({ name, status: "PASS", detail }); }
try {
  const { buildCurrentAbilitiesFlow } = require("./lib/candidate-1924-abilities-final-adapter.cjs");
  const file = path.join(__dirname, "installed-runtime-abilities-playwright.cjs"), digest = sha(file);
  const original = fs.readFileSync(file, "utf8"), { source, adaptations } = buildCurrentAbilitiesFlow(original);
  check("Exact adapters retain all sixteen assertions and reject missing/duplicate seams", () => {
    assert.equal(adaptations.length, 11); let reconstructed = original;
    for (const change of adaptations) {
      assert.equal(reconstructed.split(change.before).length - 1, 1);
      reconstructed = reconstructed.replace(change.before, change.after);
    }
    assert.equal(source, reconstructed); new vm.Script(require("node:module").wrap(source));
    for (const fragment of ["assert.equal(retained.length, 6)", "assert.equal(latest.command_index, 6)",
      "assert.deepEqual(await saves(), before", 'assert.equal((await snapshot()).mode, "bubble")',
      "business ? 16 : crossOnly ? 1"]) assert(source.includes(fragment), fragment);
    for (const change of adaptations.filter(c => original.includes(c.before))) {
      assert.throws(() => buildCurrentAbilitiesFlow(original.replace(change.before, "")));
      assert.throws(() => buildCurrentAbilitiesFlow(original + "\n" + change.before));
    }
    assert.equal(sha(file), digest);
    return { adaptations: 11, originalUnchanged: true, completeBusinessAssertionsRetained: true };
  });
  function logs(text, directory) {
    fs.mkdirSync(directory);
    const statement = text.match(/const log = fs\.openSync\(path\.join\(out, `[^`]+`\), "wx"\);/u)?.[0];
    assert(statement); const state = { launches: [] };
    for (const current of ["agentvn", "renpy", "agentvn"]) {
      const fd = vm.runInNewContext(statement + "\nlog;", { fs, path, out: directory, current, report: state });
      fs.closeSync(fd); state.launches.push({ layout: current });
    }
    return fs.readdirSync(directory);
  }
  check("Actual filesystem reproduces old third-start EEXIST and new three-start logs are distinct", () => {
    assert.throws(() => logs(original, path.join(out, "original")), e => e.code === "EEXIST");
    const files = logs(source, path.join(out, "adapted"));
    assert.deepEqual(files.sort(), ["agentvn-player-1.log", "agentvn-player-3.log", "renpy-player-2.log"]);
    return { oldThirdStartRejected: true, newExclusiveLogs: files, productStarted: false };
  });
  check("Actual failed native03 distinguishes six live saves from two inert retained cards", () => {
    const file = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/abilities-installed-1924-03/cell-01/report.json";
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(r.status, "FAILED"); assert.match(r.error, /EEXIST/);
    assert.equal(r.checks.find(c => c.name.startsWith("Real quick-save actions")).status, "PASS");
    const p = r.saveGridProbes[0];
    assert.equal(p.liveGrids, 1); assert.equal(p.liveSaved, 6); assert.equal(p.allSaved, 8);
    assert.equal(p.retained.length, 1); assert.equal(p.retained[0].saved, 2);
    assert(p.retained[0].inert); assert.equal(p.retained[0].functionalMarkers, 0);
    assert.equal(p.retained[0].hasFocus, false);
    return { source: { path: file, sha256: sha(file) }, oldCountNotDurableSaveCount: true };
  });
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
