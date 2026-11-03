"use strict";
// Offline only: preserve the complete established menu-motion/settings oracles.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { buildSession, buildFlow, buildAudit, buildViewport, validator, validateBinding,
  motionPredecessor, validateMotionPredecessor } = require("./candidate-1930-menus.cjs");
let rejected = 0;
for (const kind of ["motion", "settings"]) for (const [build, name] of [
  [buildSession, `installed-runtime-${kind}-current.cjs`],
  [buildFlow, kind === "motion" ? "native-runtime-motion-playwright.cjs" : "installed-runtime-settings-playwright.cjs"],
  [buildAudit, `installed-runtime-${kind}-current-audit.cjs`],
]) {
  const file = path.join(__dirname, name), hash = sha(file), original = fs.readFileSync(file, "utf8");
  const result = build(kind, original); new vm.Script(Module.wrap(result.source));
  let replay = original;
  for (const c of result.adaptations) {
    assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after);
    if (original.includes(c.before)) {
      assert.throws(() => build(kind, original.replace(c.before, "")));
      assert.throws(() => build(kind, original + "\n" + c.before)); rejected += 2;
    }
  }
  assert.equal(replay, result.source); assert.equal(sha(file), hash);
  if (name === "native-runtime-motion-playwright.cjs") for (const item of [
    'validateQuickBar({ ...g, width: current.width })', 'await modal(true)', 'await modal(false)',
    '"Escape-during-menu-cover"', '"rapid-menu-redirect"', 'current.episodes.length === 19',
    '["agentvn", "renpy"]', '[1, 2]', '[false, true]',
  ]) assert(result.source.includes(item), item);
  if (name === "installed-runtime-settings-playwright.cjs") for (const item of [
    'controls.length, 17', 'await s.stop(true)', 'async function changeAll',
    'async function readAll', 'inputs', 'await s.finishSettings()',
  ]) assert(result.source.includes(item), item);
}
for (const kind of ["motion", "settings"]) {
  const validate = validator(kind);
  assert.equal(typeof validate, "function");
  assert.throws(() => validate({ status: "RUNNING" }, {})); rejected++;
  assert.throws(() => validate({ status: "PASS", finishedAt: "done", version: "1.9.14" }, {})); rejected++;
}
{
  const file = path.join(__dirname, "native-runtime-state-viewport-test.cjs");
  const original = fs.readFileSync(file, "utf8"), result = buildViewport(original);
  new vm.Script(Module.wrap(result.source));
  for (const c of result.adaptations) {
    assert.throws(() => buildViewport(original.replace(c.before, "")));
    assert.throws(() => buildViewport(original + "\n" + c.before)); rejected += 2;
  }
  assert(result.source.includes('tolerance: 1e-6'));
  assert(result.source.includes('assert.throws(() => validateNativeViewport'));
  assert(result.source.includes('assert.equal(report.status, "FAILED")'));
}
let candidate = "1.9.30";
if (process.env.AGENTVN_EXIT_CANDIDATE_CONFIG) {
  const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
  const bindingFile = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG, b = read(bindingFile);
  const config = read(b.candidateConfig.path), exported = read(b.exported.path);
  candidate = config.version;
  const session = { version: candidate,
    candidateBindings: [bindingFile, ...["candidateConfig", "installation", "predecessor", "exported", "fixture"]
      .map(k => b[k].path)].map(desc),
    originalExport: desc(b.exported.path), originalFixture: desc(b.fixture.path),
    cartridges: exported.cartridges.map(c => ({ ...c, historicalSource: c.path })) };
  validateBinding(session);
  for (const mutate of [
    s => { s.version = "1.9.30"; }, s => { s.candidateBindings = []; },
    s => { s.candidateBindings[0].sha256 = "wrong"; },
    s => { s.candidateBindings[0].bytes++; },
    s => { s.originalExport.path = "D:/AgentVN/output/historical.json"; },
    s => { s.originalExport.sha256 = "wrong"; },
    s => { s.originalFixture.sha256 = "wrong"; },
    s => { s.cartridges.pop(); }, s => { s.cartridges[1] = s.cartridges[0]; },
    s => { s.cartridges[0].historicalSource = "D:/other.vncart"; },
    s => { s.cartridges[0].sha256 = "wrong"; },
  ]) {
    const wrong = structuredClone(session); mutate(wrong);
    assert.throws(() => validateBinding(wrong)); rejected++;
  }
  for (const kind of ["motion", "settings"]) {
    const built = buildSession(kind, fs.readFileSync(path.join(__dirname, `installed-runtime-${kind}-current.cjs`), "utf8"));
    assert(built.source.includes(`version: "${candidate}"`));
    assert(built.source.includes(JSON.stringify(b.exported.path)));
    assert(built.source.includes('validateBinding(s)'));
    assert(!built.source.includes('version: "1.9.30"'));
  }
  const audit = buildAudit("motion", fs.readFileSync(path.join(__dirname, "installed-runtime-motion-current-audit.cjs"), "utf8"));
  assert(audit.source.includes('const buttons = m.quickGeometry.buttons; assert.equal(buttons.length, 9);'));
  assert(!audit.source.includes('const buttons = m.quickGeometry.buttons; assert.equal(buttons.length, 8);'));
  const priorFile = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-motion-current-33-audit-01/report.json";
  if (candidate === "1.9.32" && fs.existsSync(priorFile)) {
    const evidence = motionPredecessor("33");
    assert.equal(evidence.originalStatus, "FAILED");
    assert.equal(evidence.decision, "INDEPENDENT_SETTINGS_ONLY_MOTION_TIMING_AUDIT_REMAINS_FAILED");
    const previous = read(priorFile), owner = read(previous.session.path), raw = read(previous.raw.path);
    for (const mutate of [
      a => { a[0].status = "PASS"; }, a => { a[0].groups[0].status = "FAILED"; },
      a => { a[0].groups = []; }, a => { a[0].error = "Unknown failure"; },
      a => { a[0].raw.sha256 = "wrong"; }, a => { a[1].status = "FAILED"; },
      a => { a[1].cleanupError = "not restored"; }, a => { a[2].matrix = []; },
    ]) {
      const wrong = structuredClone([previous, owner, raw]); mutate(wrong);
      assert.throws(() => validateMotionPredecessor(...wrong)); rejected++;
    }
  }
}
console.log(JSON.stringify({ status: "PASS", rejected, candidate, scope: "OFFLINE_INSTALLED_CANDIDATE_MENU_TOOLS",
  playerStarts: 0, profileMutations: 0, productChanges: 0, modelRequests: 0 }));
