"use strict";
// Audit terminal evidence independently. Intact FAILED feature evidence is
// explicitly different from a passing feature or a passing installation.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { verifyTrace } = require("./native-editor-motion-audit.cjs");
const { policy } = require("./lib/installed-editor-motion-workspace-policy.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { motionBinding } = require("./lib/installed-editor-motion-binding.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const qa = "F:/AgentVN/QA/Installed-Editor-Motion-20261021-01";
const expectedEpisodes = ["home-to-editor", "edit-to-options", "options-to-ai", "ai-to-options-keyboard",
  ...["settings-layout", "layout-theme", "theme-assets", "assets-library", "library-animation",
    "animation-providers", "providers-history", "history-settings"].map(s => `tab-${s.replace("-", "-to-")}`),
  "same-tab-repeat-and-rapid-final-wins", "options-close-to-editor-keyboard",
  "open-reverse-and-close-reopen", "editor-to-home"];
function validateTerminal(owner, raw, version = "1.9.22") {
  const candidate = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
    ? require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate() : null;
  assert(["1.9.22", "1.9.30", ...(candidate ? [candidate.version] : [])].includes(version));
  assert(owner.finishedAt && raw.finishedAt && owner.smoke === false);
  assert.equal(owner.candidateVersion, version); assert.equal(owner.workspacePolicy, policy);
  assert.equal(raw.workspacePolicy, policy);
  assert.equal(owner.scope, "CURRENT_INSTALLED_RELEASE_EDITOR_MOTION_NOT_RUNTIME_OR_PHYSICAL");
  assert.equal(raw.scope, owner.scope);
  assert(["PASS", "FAILED"].includes(owner.status));
  assert.equal(owner.commands.length, 1); assert(owner.commands[0].finishedAt);
  assert.equal(owner.commands[0].exitCode, raw.status === "PASS" ? 0 : 1);
  assert.equal(owner.commands[0].status, raw.status);
  for (const key of ["productChanges", "modelRequests", "builds", "deviceOperations"]) assert.equal(owner[key], 0);
  assert.equal(raw.productChanges, 0); assert.equal(raw.realModelRequests, 0);
  assert.deepEqual(raw.errors, []); assert.deepEqual(raw.modelSubmissions, []); assert.equal(raw.error, null);
  assert.equal(owner.cacheRestored, true); assert.equal(owner.protectedUnchanged, true); assert(!owner.cleanupError);
  const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
    [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
  assert.deepEqual(raw.matrix.map(({ width, height, dpr, reduced }) => ({ width, height, dpr, reduced })), matrix);
  for (const m of raw.matrix) {
    assert(!m.error); assert.equal(m.nodeWidthCheck.status, "PASS");
    assert(Math.abs(m.nodeWidthCheck.actual - Math.max(196, Math.min(252, m.width * .105))) <= 2);
    assert.deepEqual(m.episodes.map(e => e.name), expectedEpisodes);
    for (const e of m.episodes) {
      assert(!e.actionError); assert(e.checks.length >= 5 && e.trace.frames >= 3);
      assert(e.checks.every(c => ["PASS", "FAILED"].includes(c.status)));
      assert.equal(e.status, e.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED");
    }
    assert.equal(m.status, m.episodes.every(e => e.status === "PASS") ? "PASS" : "FAILED");
  }
  assert.equal(raw.status, raw.matrix.every(m => m.status === "PASS") ? "PASS" : "FAILED");
}
async function main() {
  const [attempt, auditAttempt] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(auditAttempt, /^\d{2}$/);
  const binding = motionBinding(process.argv.slice(4));
  if (binding) assert.equal(process.argv.slice(4).length, 2);
  else assert.equal(process.argv.length, 4);
  const source = path.join(binding?.qa || qa, `${binding ? "editor-motion" : "editor"}-${attempt}`);
  const out = path.join(binding?.qa || qa, `${binding ? "editor-motion-audit" : "audit-1922"}-${attempt}-${auditAttempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", scope: "EVIDENCE_INTEGRITY_NOT_BLANKET_FEATURE_PASS",
    startedAt: new Date().toISOString(), checks: [], findings: [], sources: [] };
  const load = f => { report.sources.push(desc(f)); return read(f); };
  const check = (name, fn) => {
    const c = { name, status: "RUNNING" }; report.checks.push(c);
    try { c.detail = fn(); c.status = "PASS"; } catch (e) { c.status = "FAILED"; throw e; }
  };
  try {
    const owner = load(path.join(source, "report.json")), raw = load(path.join(source, "motion/report.json"));
    check("Explicit current installed candidate, terminal nonempty matrix and unchanged frozen tools", () => {
      validateTerminal(owner, raw, binding?.version);
      const install = load(owner.installation.path);
      assert.equal(install.version, binding?.version || "1.9.22");
      assert.equal(install.executable.sha256, binding?.installation.executable.sha256 ||
        "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc");
      if (binding) assert.equal(path.resolve(owner.installation.path), binding.installationFile);
      for (const item of [install.executable, ...install.resources,
        ...(binding ? [install.actualInstallation, ...install.protectedFiles] : [install.originalAudit, install.originalInstallation]),
        ...owner.protectedFiles, owner.installation, owner.input, ...owner.tools])
        assert.equal(sha(item.path), item.sha256, item.path);
      for (const tool of owner.tools) assert.equal(sha(path.join(source, path.basename(tool.path))), tool.sha256);
      if (binding) {
        const adapter = owner.cacheAdapter;
        assert(adapter, "Current candidate requires exact cache-protection adaptation");
        assert.equal(sha(adapter.original.path), adapter.original.sha256);
        assert.equal(sha(adapter.executed.path), adapter.executed.sha256);
        const rebuilt = require("./lib/installed-editor-motion-cache.cjs")
          .buildCache(fs.readFileSync(adapter.original.path, "utf8"));
        assert.equal(fs.readFileSync(adapter.executed.path, "utf8"), rebuilt.source);
        assert.deepEqual(adapter.adaptations, rebuilt.adaptations);
      }
      assert.equal(sha(owner.commands[0].log.path), owner.commands[0].log.sha256);
      return { combinations: raw.matrix.length, episodes: raw.matrix.reduce((n, m) => n + m.episodes.length, 0),
        candidate: install.executable, runtimeChangedOrTested: false };
    });
    check("Every original frame independently checked; business failures remain FAILED", () => {
      let frames = 0, passed = 0;
      for (const m of raw.matrix) for (const e of m.episodes) {
        assert(path.resolve(e.trace.path).startsWith(path.resolve(source, "motion/traces") + path.sep));
        assert.equal(sha(e.trace.path), e.trace.sha256);
        const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
        assert.equal(t.frames.length, e.trace.frames); frames += t.frames.length;
        assert(t.frames.every(f => f.width === m.width && f.height === m.height && Math.abs(f.dpr - m.dpr) <= 1e-6
          && f.reduced === m.reduced && !f.pageHidden && f.visibilityState === "visible" && f.overflow <= 1));
        assert(t.inputs.some(i => i.trusted)); assert(!t.limitReached);
        let error;
        try { verifyTrace(m, e, t, policy); } catch (err) { error = String(err); }
        if (e.status === "PASS") { assert.equal(error, undefined, `${m.key}/${e.name}`); passed++; }
        else {
          assert(error, `Failed collector episode lacks independent failing assertion: ${m.key}/${e.name}`);
          report.findings.push({ combination: m.key, episode: e.name, status: "FAILED",
            checks: e.checks.filter(c => c.status !== "PASS").map(c => c.name), independentFailure: error,
            clocks: [...new Set(t.frames.flatMap(f => f.layers.flatMap(l => l.animations.map(a => a.duration))))],
            tokens: t.frames[0].editorMotionTokens, trace: desc(e.trace.path) });
          const tokens = t.frames[0].editorMotionTokens;
          const wide = new Set(["layout", "theme", "assets", "animation"]);
          const match = /^tab-(.+)-to-(.+)$/.exec(e.name);
          if (match && wide.has(match[1]) === wide.has(match[2])) {
            const css = tokens[m.reduced ? "--motion-editor-sibling-reduced" : "--motion-editor-sibling"];
            const number = /^([\d.]+)(ms|s)$/.exec(css); assert(number, "Real root token has an unsupported time unit");
            const expectedMs = Number(number[1]) * (number[2] === "s" ? 1000 : 1)
              * (m.reduced ? 1 : Math.max(.25, Number(tokens["--motion-scale"])))
              / Number(tokens["--editor-workspace-playback-rate"]);
            const observed = [...new Set(t.frames.filter(f => f.phase?.includes("crossfading"))
              .flatMap(f => f.layers.filter(l => l.tab === match[2]).flatMap(l => l.animations.map(a => a.duration))))];
            report.findings.at(-1).siblingClock = { cssToken: css, expectedMs, observedMs: observed,
              matches: observed.length > 0 && observed.every(n => Math.abs(n - expectedMs) <= 1) };
          }
        }
      }
      report.businessStatus = raw.status;
      return { frames, passedEpisodes: passed, failedEpisodes: report.findings.length,
        noAnimationOrClockOverrides: true, screenshotsNotUsedAsSoleVerdict: true };
    });
    check("Actual PNG bytes, exact viewport/DPR/media before and after, one final capture per combination", () => {
      for (const m of raw.matrix)
        assert.equal(raw.screenshots.filter(s => path.basename(s.path) === `${m.key}-home-final.png`).length, 1);
      for (const s of raw.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        const m = raw.matrix.find(m => path.basename(s.path).startsWith(m.key + "-")); assert(m);
        validateNativeViewport(s.before, m);
        const b = fs.readFileSync(s.path); assert.equal(b.subarray(1, 4).toString(), "PNG");
        assert.equal(b.readUInt32BE(16), m.width * m.dpr); assert.equal(b.readUInt32BE(20), m.height * m.dpr);
        const chunks = []; let p = 8;
        while (p < b.length) {
          const n = b.readUInt32BE(p), tag = b.toString("ascii", p + 4, p + 8);
          assert(p + n + 12 <= b.length);
          if (tag === "IDAT") chunks.push(b.subarray(p + 8, p + 8 + n));
          p += n + 12;
        }
        assert(chunks.length > 0); assert(zlib.inflateSync(Buffer.concat(chunks)).length > m.width * m.height * m.dpr * m.dpr);
      }
      return { pngs: raw.screenshots.length, finalCaptures: 12, imagePayloadsInflated: true,
        scope: "Actual installed WebView metrics emulation; not physical 4K monitor" };
    });
    check("Exact cache restore and owned processes/ports absent; no normal-close claim", () => {
      const restore = load(path.join(source, "native-cache-restoration.json"));
      const protection = load(path.join(source, "native-cache-protection.json"));
      assert.equal(restore.status, "PASS"); assert.equal(restore.deletedUserFiles, 0);
      assert.equal(restore.originalDirectoryId, protection.directoryId);
      assert.deepEqual(restore.originalFiles, protection.files); assert(!fs.existsSync(protection.held));
      for (const item of protection.files) assert.equal(sha(path.join(restore.originalDirectory, item.relative)), item.sha256);
      const current = rows(); assert(!owner.knownProcesses.some(p =>
        current.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
      assert.equal(owner.launches.length, 1); assert.equal(owner.cleanups.length, 1);
      assert.equal(owner.cleanups[0].status, "PASS"); assert.equal(owner.cleanups[0].normalCloseClaimed, false);
      assert.deepEqual(listeners(owner.cleanups.flatMap(c => c.ports)), []);
      return { restoredCacheFiles: protection.files.length, identities: owner.knownProcesses.length,
        ports: owner.cleanups[0].ports, teardown: "Attributed cleanup, not normal window close proof" };
    });
    report.status = `EVIDENCE_AUDIT_PASS_FEATURE_${report.businessStatus}`;
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.source = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks,
    businessStatus: report.businessStatus, findings: report.findings.length, error: report.error, out }, null, 2));
}
module.exports = { validateTerminal };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
