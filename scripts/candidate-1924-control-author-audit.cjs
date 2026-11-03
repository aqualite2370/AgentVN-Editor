"use strict";
// Independent terminal audit of the actual installed safe-control author flow.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const source = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-53";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const describe = p => ({ path: p, sha256: sha(p), bytes: fs.statSync(p).size });
const r = read(path.join(source, "report.json"));
const key = d => `${d.width}/${d.height}/${d.dpr}/${d.reduced}`;
const matrix = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
  [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
const names = [
  "Ordinary preview selection, actual project image bytes/fit and inherited font",
  "Safe HTML slot and CSS override retain button content; graphical conflict visible",
  "Invalid CSS and executable HTML refused; save blocked and last valid preview retained",
  "Disabling code restores graphical appearance without deleting persisted source",
  "Reenable restores source and appearance; other layout remains byte-equivalent",
  "Actual installed Runtime iframe consumes safe structure, color and image bytes",
];
function validate(report) {
  assert.equal(report.status, "PASS"); assert(report.finishedAt && !report.error && !report.cleanupError && !report.captureError);
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); assert.equal(report.blockedModelRequests || 0, 0);
  assert.equal(report.cases.length, 12);
  for (const d of matrix) {
    const matches = report.cases.filter(c => key(c.display) === key(d)); assert.equal(matches.length, 1);
    const c = matches[0]; assert.equal(c.status, "PASS"); assert(c.finishedAt);
    assert.deepEqual(c.checks.map(x => x.name), names); assert(c.checks.every(x => x.status === "PASS"));
    const [image, code, , paused, , actual] = c.checks.map(x => x.detail);
    assert.equal(image.fit, "contain"); assert(image.font && image.bytes.includes("<svg"));
    assert(code.html.includes('<slot name="content"></slot>')); assert.equal(code.tag, "BUTTON");
    assert.equal(paused.presentation.css, code.css); assert.equal(paused.presentation.html, code.html);
    assert.equal(actual.image, image.bytes); assert.equal(actual.tag, "BUTTON"); assert.equal(actual.slotCount, "1");
    const expectedHex = /background-color:\s*(#[a-f\d]{6})/i.exec(code.css)?.[1]; assert(expectedHex);
    const rgb = `rgb(${[1, 3, 5].map(i => parseInt(expectedHex.slice(i, i + 2), 16)).join(", ")})`;
    assert.equal(actual.color, rgb);
    assert(actual.overflow <= 1 && actual.rect.width > 0 && actual.rect.height > 0
      && actual.rect.left >= 0 && actual.rect.top >= 0 && actual.rect.right <= actual.width + 1
      && actual.rect.bottom <= actual.height + 1);
  }
  assert.equal(report.restart.status, "PASS"); assert.equal(report.restart.fullProcessRestart, true);
  return { displays: 12, actualBusinessChecks: 72, actualRestart: true,
    excludes: ["portable save/reopen", "exported Player actions", "all control types", "Android"] };
}
if (process.argv[2] === "--self-test") {
  const changed = mutator => { const bad = structuredClone(r); mutator(bad); assert.throws(() => validate(bad)); };
  // Validate the positive baseline first; a bad or incomplete source cannot
  // manufacture a successful negative-control self-test.
  validate(r);
  for (const mutate of [
    x => { x.status = "RUNNING"; }, x => { x.cases = []; }, x => { x.cases[0] = x.cases[1]; },
    x => { x.cases[0].checks.pop(); }, x => { x.cases[0].checks[5].detail.image = "wrong bytes"; },
    x => { x.cases[0].checks[5].detail.rect.right = 99999; }, x => { x.restart.status = "NOT_RUN"; },
  ]) changed(mutate);
  console.log(JSON.stringify({ status: "PASS", badEvidenceRejected: 7, scope: "AUDIT_ONLY" }));
} else {
  assert.equal(process.argv[2], "01");
  const out = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/control-author-audit-01";
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), input: describe(path.join(source, "report.json")),
    groups: [], scope: "INSTALLED_SAFE_CONTROL_AUTHORING_NOT_PORTABLE_OR_EXPORT_OR_ANDROID",
    productChanges: 0, modelRequests: 0, builds: 0 };
  function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = fn(); g.status = "PASS"; } catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
  }
  try {
    group("Complete 12-condition ordinary/safe-code behavior and actual restart", () => validate(r));
    group("Actual frozen installation, controlled author inputs and both layout profiles", () => {
      const install = read(r.installation); assert.equal(install.status, "PASS"); assert.equal(install.metadataRestoration, "PASS");
      assert.equal(install.executable.version, "1.9.24");
      for (const f of [install.executable, ...install.resources, ...install.protectedFiles]) assert.equal(sha(f.path), f.sha256);
      assert.equal(sha(r.fixture.path), r.fixture.sha256); assert.equal(sha(r.fixture.profilesSource), r.fixture.profilesSourceSha256);
      const prior = read(r.fixture.profilesSource), fixture = read(r.fixture.path);
      assert.equal(prior.status, "PASS");
      assert.deepEqual(fixture.editor_settings.runtimeUILayoutProfiles.profiles.agentvn, prior.profiles.profiles.agentvn);
      assert.deepEqual(r.profiles.profiles.agentvn, prior.profiles.profiles.agentvn);
      const final = r.profiles.profiles.renpy.screens.find(s => s.screen_id === "title")
        .components.find(c => c.component_id === "title_start_button");
      assert.equal(r.profiles.profiles.renpy.advancedPresentationEnabled, true);
      assert.equal(final.presentation.css, r.cases.at(-1).checks[1].detail.css);
      assert.equal(final.presentation.html, r.cases.at(-1).checks[1].detail.html);
      assert.equal(sha(r.tool.path), r.tool.sha256); assert.equal(sha(path.join(source, "executed-test.cjs")), r.tool.sha256);
      assert.equal(r.launches.length, 2);
      for (const l of r.launches) {
        assert.equal(l.executable.version, "1.9.24"); assert.equal(l.sourceServer, false); assert.equal(l.manualBackendSpawn, false);
        assert.equal(l.dataDirectoryOverride, true); assert.equal(l.webviewDirectoryOverride, true);
        assert.equal(path.resolve(l.isolation.AGENTVN_WORKSPACE_OUTPUT), path.resolve(source));
        assert.equal(sha(l.backend.ExecutablePath), l.backend.sha256);
      }
      return { actualInstalledLaunches: 2, sourceServer: false, graphicalAndCodeSourcesPreserved: true };
    });
    group("12 actual display/PNG receipts, exact processes, ports and original cache restored", () => {
      assert.equal(r.screenshots.length, 12); assert.equal(new Set(r.screenshots.map(s => s.path)).size, 12);
      for (const s of r.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after); assert(matrix.some(d => key(d) === key(s.before)));
        const png = fs.readFileSync(s.path);
        assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);
        assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr);
      }
      assert.equal(r.nativeCacheRestoration, "PASS");
      assert.deepEqual(r.cache.map(c => c.action), ["SelfTest", "Prepare", "Restore"]); assert(r.cache.every(c => c.exitCode === 0));
      const p = read(path.join(source, "native-cache-protection.json")), restored = read(path.join(source, "native-cache-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert.equal(restored.originalDirectory, p.original); assert.equal(restored.originalDirectoryId, p.directoryId);
      assert(!fs.existsSync(p.held)); for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      assert(ps(`fsutil file queryfileid '${p.original}';if($LASTEXITCODE){throw 'Missing directory identity'}`).includes(p.directoryId));
      assert.equal(r.cleanups.length, 2); assert(r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
      assert.deepEqual(listeners(r.cleanups.flatMap(c => c.ports)), []);
      const current = rows(); assert(r.knownProcesses.length > 0);
      for (const p of r.knownProcesses) assert(!current.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
      return { pngs: 12, exactProcessIdentities: r.knownProcesses.length, restoredCacheFiles: p.files.length };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = describe(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  }
}
