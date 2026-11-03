"use strict";
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateReport } = require("./lib/native-runtime-motion-oracle.cjs");
const { validateCriticalTrace } = require("./native-runtime-motion-audit.cjs");
const { validateQuickBar } = require("./lib/installed-runtime-motion-1922-policy.cjs");
const { rows, ps, listeners } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function validateTerminal(owner, raw) {
  assert(owner.finishedAt && raw.finishedAt);
  assert.equal(owner.scope, "ACTUAL_1922_INSTALLED_SHIPPED_PLAYER_PREVIEW_NO_STANDALONE_SAVE_OR_NORMAL_EXIT_CLAIM");
  assert.equal(owner.normalCloseClaimed, false);
  for (const k of ["productChanges", "builds", "modelRequests"]) assert.equal(owner[k], 0);
  assert.equal(owner.status, "PASS"); assert(!owner.error && !owner.cleanupError);
  assert.equal(owner.commands.length, 6);
  assert.deepEqual(owner.commands.map(c => c.label), [
    "guard-installed-runtime-motion-1922-policy-test.cjs", "guard-native-runtime-motion-audit-test.cjs",
    "guard-native-runtime-state-viewport-test.cjs", "profile-prepare", "motion", "profile-restore",
  ]);
  assert(owner.commands.every(c => c.status === "PASS" && c.exitCode === 0 && c.finishedAt));
  validateReport(raw, owner.smoke, { preview1922: true });
  assert.equal(owner.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  assert.equal(raw.provenance, "ACTUAL_1922_NSIS_SHIPPED_PLAYER_PREVIEW");
  assert.equal(raw.screenshots.length, owner.smoke ? 4 : 24);
  for (const m of raw.matrix) {
    const common = ["title-to-settings", ...["text", "audio", "skip", "system"].map(c => `settings-category-${c}`),
      "exit-modal-open-cancel", "exit-modal-interrupted-close-reopen"];
    const middle = m.layout === "renpy"
      ? ["settings-to-about", "about-to-help-keyboard", "help-to-history", "history-to-save-load", "rapid-menu-redirect", "menu-to-title"]
      : ["settings-to-title", "title-to-about", "about-to-title", "title-to-save-load", "save-load-to-title"];
    assert.deepEqual(m.episodes.map(e => e.name), [...common, ...middle, "title-to-playing",
      ...(m.layout === "agentvn" ? ["quick-menu-expand-collapse"] : []),
      "playing-to-main-menu-Escape", "main-menu-to-settings", "settings-to-main-menu", "main-menu-continue-playing",
      "Escape-during-menu-cover"]);
    if (m.layout === "renpy") {
      assert.equal(validateQuickBar({ ...m.quickGeometry, width: m.width }).status, "PASS");
      for (const b of m.quickGeometry.buttons)
        assert(b.rect.top >= -1 && b.rect.bottom <= m.height + 1, "Quick action vertically clipped");
    }
  }
  assert.equal(raw.launches.length, 2);
  for (const l of raw.launches) {
    assert.equal(l.executableSha256, owner.executable.sha256);
    assert.equal(path.resolve(l.identity.ExecutablePath), path.resolve(owner.executable.path));
    assert.equal(l.provenance, "ACTUAL_1922_NSIS_SHIPPED_PLAYER_PREVIEW_NOT_STANDALONE");
    assert(l.knownProcesses.length >= 2);
  }
}
function verifyAdditionalTrace(m, e, t) {
  validateCriticalTrace(m, e, t);
  if (e.name.startsWith("settings-category-")) {
    const id = e.name.replace("settings-category-", ""), fade = t.frames.filter(f => f.categoryPhase === "crossfading");
    assert(fade.length >= 3);
    assert(fade.every(f => f.categoryDuration === (m.reduced ? 816 : 1632) && f.black < .01));
    assert(fade.some(f => f.category.opacity > .01 && f.category.opacity < .99));
    assert.equal(t.frames.at(-1).categoryId, id);
    assert(!t.frames.at(-1).unavailableFocus);
  }
  if (e.name === "quick-menu-expand-collapse") {
    const clips = t.frames.filter(f => f.quickSurface?.animations.some(a => a.name === "clip-path" && a.state === "running"));
    const fades = t.frames.filter(f => f.quickButtons.some(b => b.opacity > .01 && b.opacity < .99));
    assert(m.reduced ? fades.length >= 2
      : clips.length >= 2 && new Set(clips.map(f => f.quickSurface.clipPath)).size >= 3);
    assert(t.frames.every(f => f.screen === "playing" && f.black < .01));
  }
}
async function main() {
  const [attempt, auditAttempt] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(auditAttempt, /^\d{2}$/);
  const source = path.join(base, `installed-motion-1922-${attempt}`);
  const out = path.join(base, `installed-motion-1922-${attempt}-audit-${auditAttempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "INDEPENDENT_CURRENT_INSTALLED_PREVIEW_MOTION_EVIDENCE_NO_STANDALONE_OR_EXIT_CLAIM", checks: [], sources: [] };
  const load = f => { report.sources.push(desc(f)); return read(f); };
  const check = (name, fn) => {
    const c = { name, status: "RUNNING" }; report.checks.push(c);
    try { c.detail = fn(); c.status = "PASS"; } catch (e) { c.status = "FAILED"; throw e; }
  };
  try {
    const owner = load(path.join(source, "session.json")), raw = load(path.join(source, "motion.json"));
    check("Current actual installation, original UI export bytes, terminal nonempty matrix and executed tools", () => {
      validateTerminal(owner, raw);
      const installation = load(owner.installation.path);
      assert.equal(installation.version, "1.9.22"); assert.equal(installation.status, "PASS");
      for (const f of [owner.installation, owner.executable, installation.originalAudit, installation.originalInstallation,
        installation.executable, ...installation.resources, ...owner.protectedProducts, ...owner.cartridges, ...owner.sources])
        assert.equal(sha(f.path), f.sha256);
      for (const f of owner.tools)
        assert.equal(sha(path.join(source, "tools", path.basename(f.path))), f.sha256);
      return { combinations: raw.matrix.length, paths: raw.matrix.reduce((n, m) => n + m.episodes.length, 0),
        twoActualInstalledUIExports: true, productVersion: installation.version };
    });
    check("Every raw frame independently re-evaluated, including category, modal, quick menu and interrupted page transitions", () => {
      let frames = 0, assertions = 0;
      for (const m of raw.matrix) for (const e of m.episodes) {
        assert(path.resolve(e.trace.path).startsWith(path.resolve(source, "traces") + path.sep));
        assert.equal(sha(e.trace.path), e.trace.sha256);
        const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
        assert.equal(t.frames.length, e.trace.frames); verifyAdditionalTrace(m, e, t);
        frames += t.frames.length; assertions += e.checks.length;
      }
      return { frames, assertions, pageErrors: raw.pageErrors.length };
    });
    check("All PNGs have matching before/after real metrics, correct DPR pixels and decompressible payloads", () => {
      for (const s of raw.screenshots) {
        assert.equal(sha(s.path), s.sha256);
        const m = raw.matrix.find(m => m.width === s.before.width && m.height === s.before.height
          && Math.abs(m.dpr - s.before.dpr) <= 1e-6 && m.reduced === s.before.reduced && s.path.includes(m.key));
        assert(m); assert.deepEqual(s.before, s.after);
        const b = fs.readFileSync(s.path), chunks = []; assert.equal(b.subarray(1, 4).toString(), "PNG");
        assert.equal(b.readUInt32BE(16), m.width * m.dpr); assert.equal(b.readUInt32BE(20), m.height * m.dpr);
        let cursor = 8;
        while (cursor < b.length) {
          const n = b.readUInt32BE(cursor), tag = b.toString("ascii", cursor + 4, cursor + 8);
          assert(cursor + n + 12 <= b.length);
          if (tag === "IDAT") chunks.push(b.subarray(cursor + 8, cursor + 8 + n));
          cursor += n + 12;
        }
        assert(chunks.length);
        assert(zlib.inflateSync(Buffer.concat(chunks)).length > m.width * m.height * m.dpr * m.dpr);
      }
      return { pngs: raw.screenshots.length, physical4KClaimed: false };
    });
    check("Explicit profile view restored by ID and original bytes; owned processes/ports absent", () => {
      const protection = load(path.join(source, "profile-protection.json"));
      const restored = load(path.join(source, "profile-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert.equal(protection.records.length, 2); assert.equal(restored.restored.length, 2);
      let protectedBytes = 0;
      for (const original of protection.records) {
        assert(original.original.startsWith("C:\\Users\\1\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\"));
        assert.equal(original.storage, "Junction"); assert(!fs.existsSync(original.held));
        const match = restored.restored.find(r => r.original === original.original); assert(match);
        assert.equal(match.directoryId, original.directoryId); assert.deepEqual(match.files, original.files);
        if (original.existed) {
          const result = ps(`& fsutil.exe file queryfileid '${original.original}'`);
          assert(result.toLowerCase().includes(original.directoryId));
        } else assert(!fs.existsSync(original.original));
        for (const f of original.files) { assert.equal(sha(path.join(original.original, f.relative)), f.sha256); protectedBytes++; }
      }
      const current = rows(), identities = raw.launches.flatMap(l => l.knownProcesses);
      assert(!identities.some(p => current.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
      const ports = raw.launches.map(l => l.port); assert.deepEqual(listeners(ports), []);
      return { restoredOriginalFiles: protectedBytes, identities: identities.length, ports,
        teardown: "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE", defaultStorageOrStandaloneClaimed: false };
    });
    report.status = "EVIDENCE_AUDIT_PASS_LIMITED_RUNTIME_MOTION_PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error, out }));
}
module.exports = { validateTerminal, verifyAdditionalTrace };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
