"use strict";
// Supplement the existing semantic audit with deterministic adapter provenance.
// Inspect retained files only; never rerun the product or rewrite old reports.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const closure = require("./current-layout-closure.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Editor-1.9.35-20261101-01";
const layoutRoot = "F:/AgentVN/QA/Installed-Layout-20261101-01";
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
function checked(value) { assert.equal(sha(value.path), value.sha256, value.path); return value; }
const config = closure.validateCandidateConfig(read(path.join(qa, "current-layout-candidate.json")));
const actual = deriveActual(config.actual, config.version);
const out = path.join(qa, "layout-closure-bindings-audit-01.json");
assert(!fs.existsSync(out), "Never overwrite an audit result");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
  productChanges: 0, builds: 0, modelRequests: 0 };
function group(name, test) {
  const result = { name, status: "RUNNING" }; report.groups.push(result);
  try { result.detail = test(); result.status = "PASS"; }
  catch (error) { result.status = "FAILED"; result.error = String(error.stack || error); throw error; }
}
try {
  group("Exact original receipt, installed bytes and semantic audit", () => {
    const file = path.join(qa, "layout-consumption-audit-02-01/report.json"), audit = read(file);
    assert.equal(audit.status, "PASS_LIMITED_INSTALLED_AUTHOR_ROUNDTRIP_AND_PLAYER_MATERIAL_MATRIX");
    assert.equal(audit.groups.length, 7);
    assert(audit.groups.every(g => g.status === "PASS"));
    return { actual: checked(config.actual), executable: actual.executable, semanticAudit: describe(file) };
  });
  group("Frozen author and roundtrip adapters reproduce exactly; assertions unchanged", () => {
    const bindings = [];
    for (const [mode, prep] of [["author", "layout-consumption-preparation-02"],
      ["roundtrip", "layout-closure-roundtrip-preparation-03"],
      ["audit", "layout-closure-audit-preparation-01"]]) {
      const directory = path.join(qa, prep), file = path.join(directory, "binding.json"), b = read(file);
      for (const f of [b.source, b.executed, b.adapter]) checked(f);
      assert.equal(sha(path.join(directory, "frozen-adapter.cjs")), b.adapter.sha256);
      const original = fs.readFileSync(b.source.path, "utf8");
      const result = mode === "author"
        ? closure.build(original, path.join(directory, "derived-actual-installation.json"), b.options)
        : (() => { const moved = closure.relocate(original);
          return { source: moved.source, adaptations: moved.edits }; })();
      assert.equal(fs.readFileSync(b.executed.path, "utf8"), result.source);
      assert.deepEqual(b.adaptations, result.adaptations);
      bindings.push(describe(file));
    }
    return { bindings, deterministicAdapters: 3 };
  });
  group("Player only relocates outputs and selects exact scoped profile helper", () => {
    const directory = path.join(qa, "layout-closure-native-player-preparation-01");
    const file = path.join(directory, "binding.json"), b = read(file);
    for (const f of [b.source, b.executed, b.adapter, b.profileSource, b.profileExecuted]) checked(f);
    assert.equal(sha(path.join(directory, "frozen-adapter.cjs")), b.adapter.sha256);
    const moved = closure.relocate(fs.readFileSync(b.source.path, "utf8"));
    const needle = 'path.resolve(__dirname, "native-dev-preview-profile.ps1")';
    assert.equal(moved.source.split(needle).length - 1, 1);
    assert.equal(fs.readFileSync(b.executed.path, "utf8"),
      moved.source.replace(needle, () => JSON.stringify(b.profileExecuted.path)));
    assert.deepEqual(moved.edits, b.relocations);
    const source = fs.readFileSync(b.profileSource.path, "utf8");
    assert.equal(source.split(b.profileGuard.before).length - 1, 1);
    assert.equal(fs.readFileSync(b.profileExecuted.path, "utf8"),
      source.replace(b.profileGuard.before, () => b.profileGuard.after));
    assert.equal(b.profileGuard.after, "'^Native-Runtime-State-20261101-01$'");
    return { binding: describe(file), exactScopedProfile: checked(b.profileExecuted) };
  });
  group("All output chains bind the same candidate, source reports and retained exports", () => {
    const files = [`${layoutRoot}/editor-02/report.json`, `${layoutRoot}/editor-03/report.json`,
      `${playerRoot}/authored-layout-${config.version}-01/report.json`];
    const [author, roundtrip, player] = files.map(read);
    assert.equal(author.status, "PASS"); assert.equal(author.pages.length, 264);
    assert.equal(roundtrip.status, "PASS_LIMITED_NATIVE_PROJECT_ROUNDTRIP_AND_UI_CARTRIDGE_EXPORT");
    assert.equal(player.status, "PASS_LIMITED_INSTALLED_PLAYER_AUTHOR_MATERIAL_NAVIGATION_MATRIX");
    assert.deepEqual(roundtrip.source, describe(files[0]));
    assert.deepEqual(player.source, describe(files[1]));
    for (const launch of [...author.launches, ...roundtrip.launches])
      assert.equal(launch.executable.sha256, actual.executable.sha256);
    const expectedPlayer = actual.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
    assert.deepEqual(player.executable, expectedPlayer);
    for (const launch of player.launches)
      assert.deepEqual(launch.cartridge, roundtrip.cartridges.find(c => c.type === launch.type));
    return { reports: files.map(describe), retainedProject: checked(roundtrip.portable),
      cartridges: roundtrip.cartridges.map(checked), authorPages: author.pages.length,
      playerCases: player.cases.length, playerDisplays: player.matrix.length,
      screenshots: author.screenshots.length + roundtrip.screenshots.length + player.screenshots.length };
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, groups: report.groups.length, out, error: report.error }));
}
