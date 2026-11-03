"use strict";
// Read-only evidence audit. A green audit never promotes a failed business run.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { validateBusiness } = require("./installed-runtime-settings-1922.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, ps, listeners } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
async function main() {
  const [attempt, auditAttempt] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(auditAttempt, /^\d{2}$/);
  const source = path.join(base, `installed-settings-1922-${attempt}`);
  const out = path.join(base, `installed-settings-1922-${attempt}-audit-${auditAttempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const result = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
    scope: "INDEPENDENT_CURRENT_SHIPPED_PREVIEW_SETTINGS_EVIDENCE_NOT_ALL_PRODUCT_ACCEPTANCE",
    productChanges: 0, builds: 0, modelRequests: 0, negativeChecks: 0 };
  const check = (name, fn) => {
    const c = { name, status: "RUNNING" }; result.checks.push(c);
    try { c.detail = fn(); c.status = "PASS"; }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  };
  try {
    const file = path.join(source, "report.json"), r = read(file);
    result.source = { path: file, sha256: sha(file), businessStatus: r.status };
    check("Nonempty exact requirements, trusted inputs, real restart and shared preview identity", () => {
      validateBusiness(r);
      assert.deepEqual(r.commands.map(c => c.label), [
        "guard-installed-runtime-settings-1922-profile-test.cjs", "guard-native-runtime-state-viewport-test.cjs",
        "profile-prepare", "profile-restore",
      ]);
      assert(r.commands.every(c => c.status === "PASS" && c.exitCode === 0 && c.finishedAt));
      const mutations = [
        c => { c.status = "FAILED"; }, c => { c.matrix = []; }, c => { c.checks = []; },
        c => { c.matrix.pop(); }, c => { c.matrix[1] = c.matrix[0]; },
        c => { c.matrix[0].categories = []; },
        c => { c.matrix[0].categories[0].geometry.controls[0].hit = false; },
        c => { c.matrix[0].categories[0].focused = false; },
        c => { c.matrix[0].prefs.fontScale = 0; },
        c => { c.matrix[0].screenshot.before.dpr = 9; },
        c => { c.executable.sha256 = "0".repeat(64); },
        c => { c.launches[0].cleanup = undefined; },
        c => { c.launches[1].identity = c.launches[0].identity; },
        c => { c.normalCloseClaimed = true; }, c => { c.modelRequests = 1; },
        c => { c.identity = "real_game"; }, c => { c.inputs = []; },
        c => { c.inputs[0].trusted = false; }, c => { c.pageErrors = ["unexpected"]; },
      ];
      for (const mutate of mutations) {
        const clone = structuredClone(r); mutate(clone);
        assert.throws(() => validateBusiness(clone)); result.negativeChecks++;
      }
      return { requirements: r.checks.length, combinations: r.matrix.length,
        categoryClicks: r.matrix.reduce((n, m) => n + m.categories.length, 0),
        trustedInputs: r.inputs.length, actualNativeStarts: r.launches.length,
        fixedPreviewIdentityNotIndependentGameIds: true };
    });
    check("Frozen installation, original UI exports, executed tool copies and protected artifacts", () => {
      for (const f of [r.installation, r.executable, r.checkpoint,
        ...r.sources, ...r.cartridges, ...r.protectedProducts, ...r.tools]) assert.equal(sha(f.path), f.sha256, f.path);
      for (const f of r.tools) assert.equal(sha(f.copy), f.sha256, f.copy);
      const installed = read(r.installation.path);
      assert.equal(installed.version, "1.9.22"); assert.equal(installed.status, "PASS");
      assert.equal(path.resolve(r.executable.path), path.join(installed.installRoot, "agentvn-player.exe"));
      for (const f of [installed.executable, ...installed.resources, installed.originalAudit, installed.originalInstallation])
        assert.equal(sha(f.path), f.sha256);
      return { version: installed.version, playerSha256: r.executable.sha256,
        copiedTools: r.tools.length, actualUiExports: r.sources.length };
    });
    check("All24 screenshots have actual unchanged viewport/media and native PNG pixel dimensions", () => {
      const matrixPaths = r.matrix.map(m => path.resolve(m.screenshot.path));
      assert.equal(new Set(matrixPaths).size, 24);
      assert.deepEqual(r.screenshots.map(s => path.resolve(s.path)), matrixPaths);
      for (const m of r.matrix) {
        const s = m.screenshot, png = fs.readFileSync(s.path);
        assert.equal(sha(s.path), s.sha256);
        assert.deepEqual(s.before, s.after);
        assert.equal(png.readUInt32BE(16), m.width * m.dpr);
        assert.equal(png.readUInt32BE(20), m.height * m.dpr);
      }
      return { screenshots: r.screenshots.length, pixelChecks: 48, simulatedViewportNotPhysical4K: true };
    });
    check("Original profile directory identities/bytes restored; attributed processes and ports absent", () => {
      assert.equal(sha(r.restoration.path), r.restoration.sha256);
      const restore = read(r.restoration.path), journal = read(path.join(source, "profile-protection.json"));
      assert.equal(restore.status, "PASS"); assert.equal(journal.records.length, 2);
      let originalFiles = 0;
      for (const p of journal.records) {
        assert(!fs.existsSync(p.held));
        if (p.existed) {
          assert(fs.existsSync(p.original));
          const raw = ps(`& fsutil.exe file queryfileid '${p.original.replaceAll("'", "''")}'`);
          assert(raw.toLowerCase().includes(p.directoryId.toLowerCase()));
          for (const f of p.files) {
            const original = path.join(p.original, f.relative);
            assert.equal(sha(original), f.sha256); assert.equal(fs.statSync(original).size, f.bytes); originalFiles++;
          }
        } else assert(!fs.existsSync(p.original));
      }
      const known = r.launches.flatMap(l => l.knownProcesses);
      const keys = new Set(known.map(p => `${p.ProcessId}:${p.Created}`));
      assert.deepEqual(rows().filter(p => keys.has(`${p.ProcessId}:${p.Created}`)), []);
      const ports = r.launches.map(l => l.port); assert.deepEqual(listeners(ports), []);
      return { originalFiles, profileDirectories: 2, processIdentities: keys.size,
        absentPorts: ports, terminationNotNaturalClose: true };
    });
    result.status = "PASS";
  } catch (e) { result.status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1; }
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, out, negativeChecks: result.negativeChecks, error: result.error }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
