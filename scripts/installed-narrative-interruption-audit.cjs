"use strict";
// Separate, read-only proof for an interrupted run. Never stamps a terminal
// state into its original session or grants full-regression acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { narrativeCoverage } = require("./lib/narrative-coverage.cjs");
const { validateInterruptedNarrativeFacts } = require("./lib/interrupted-narrative-evidence.cjs");
const { validateNarrativePreparation } = require("./lib/installed-narrative-1922-policy.cjs");
const { validateCartridge } = require("./installed-narrative-1922-export.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
async function main() {
  const [attempt, auditAttempt] = process.argv.slice(2);
  for (const v of [attempt, auditAttempt]) assert.match(v, /^\d{2}$/);
  const source = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-narrative-1922-${attempt}`);
  const out = `${source}-interruption-audit-${auditAttempt}`;
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), source,
    scope: "INTERRUPTED_NARRATIVE_EVIDENCE_AND_RECOVERY_ONLY", sourceConclusion: "INTERRUPTED_NOT_ACCEPTED",
    productChanges: 0, modelRequests: 0, builds: 0, groups: [] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const originals = [path.join(source, "session.json"), path.join(source, "player.json")].map(desc);
  const s = read(originals[0].path), raw = read(originals[1].path);
  report.originals = originals;
  async function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g); save();
    try { g.detail = await fn(); g.status = "PASS"; }
    catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
    finally { save(); }
  }
  const facts = {
    sourceStatus: s.status, rawStatus: raw.status, sourceFinished: Boolean(s.finishedAt), rawFinished: Boolean(raw.finishedAt),
    sessionSha256: originals[0].sha256, rawSha256: originals[1].sha256, normalCloseClaimed: false,
    sourceFilesRewritten: false,
  };
  try {
    await group("Stopped original identities and exact listener ports", () => {
      const all = rows();
      facts.liveOriginalIdentities = all.filter(p => raw.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created));
      assert(!all.some(p => p.Name === "agentvn-player.exe" || p.Name === "node.exe" &&
        ((p.CommandLine || "").includes("installed-narrative-1922.cjs 02") ||
          (p.CommandLine || "").includes(path.join(source, "preparation.json")))));
      facts.occupiedOriginalPorts = listeners([...new Set(raw.launches.map(l => l.port))]);
      assert.deepEqual(facts.liveOriginalIdentities, []); assert.deepEqual(facts.occupiedOriginalPorts, []);
      return { originalIdentities: raw.knownProcesses.length, originalPorts: raw.launches.length,
        incompleteCleanupReceipts: raw.launches.filter(l => l.cleanup?.status !== "PASS").map(l => l.cell),
        historicalFinallyClaimed: false };
    });
    await group("Actual original profile identities and bytes restored", () => {
      const before = read(path.join(source, "profile-protection.json"));
      report.restoration = desc(path.join(source, "profile-restoration.json"));
      const restored = read(report.restoration.path);
      facts.restorationStatus = restored.status; facts.deletedUserFiles = restored.deletedUserFiles;
      facts.originalDirectoriesVerified = 0; facts.originalFilesVerified = 0;
      for (const old of before.records) {
        const current = restored.restored.find(r => r.original === old.original); assert(current);
        assert(!fs.existsSync(old.held) && !fs.existsSync(old.retained));
        assert.equal(current.directoryId, old.directoryId); assert.deepEqual(current.files, old.files);
        const result = spawnSync("fsutil.exe", ["file", "queryfileid", old.original],
          { windowsHide: true, encoding: "utf8", timeout: 10000 });
        assert.equal(result.status, 0); assert(result.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
        facts.originalDirectoriesVerified++;
        for (const file of old.files) {
          assert.equal(sha(path.join(old.original, file.relative)), file.sha256);
          facts.originalFilesVerified++;
        }
        assert(fs.existsSync(current.testProfileRetained));
      }
      return { directories: facts.originalDirectoriesVerified, files: facts.originalFilesVerified,
        recoveredAt: restored.at, noUserFileDeleted: restored.deletedUserFiles === 0 };
    });
    await group("Frozen installation, tools, real UI cartridges and explicit later Dev build", async () => {
      validateNarrativePreparation(read(s.preparation.path));
      facts.frozenToolsVerified = 0;
      for (const tool of s.tools) {
        assert.equal(sha(tool.path), tool.sha256); assert.equal(sha(tool.copy), tool.sha256);
        facts.frozenToolsVerified++;
      }
      facts.productExceptions = []; facts.installedProductsVerified = 0;
      report.currentProtectedProducts = [];
      const buildFile = "F:/AgentVN/QA/Runtime-Opening-20261023-01/build-01/report.json";
      const build = read(buildFile); report.laterOpeningBuild = desc(buildFile);
      assert.equal(build.status, "PASS"); assert(build.finishedAt);
      assert.equal(build.scope, "SOURCE_QA_AND_DEV_BUILD_NOT_INSTALLER_ACCEPTANCE");
      for (const product of s.protectedProducts) {
        const current = desc(product.path); report.currentProtectedProducts.push(current);
        if (current.sha256 === product.sha256) { facts.installedProductsVerified++; continue; }
        assert.equal(path.resolve(product.path).toLowerCase(), path.resolve(build.dev.path).toLowerCase());
        assert.equal(current.sha256, build.dev.sha256);
        const backup = build.backups.find(b => path.resolve(b.original.path).toLowerCase() === path.resolve(product.path).toLowerCase());
        assert(backup); assert.equal(backup.original.sha256, product.sha256);
        assert.equal(sha(backup.retained.path), product.sha256);
        assert(new Date(build.startedAt) > new Date(read(report.restoration.path).at));
        facts.productExceptions.push({ path: current.path, previousSha256: product.sha256,
          currentSha256: current.sha256, reason: "VERIFIED_OPENING_BUILD" });
      }
      for (const c of s.cartridges) await validateCartridge(c.path, s.fixture, c.layout);
      return { installedProducts: facts.installedProductsVerified, frozenTools: facts.frozenToolsVerified,
        cartridges: s.cartridges.length, authorizedLaterDevChanges: facts.productExceptions.length,
        currentDevSubstitutesInstalledRuntime: false };
    });
    await group("Partial coverage, original PNG pixels and durable snapshot bytes", () => {
      const coverage = narrativeCoverage(raw);
      Object.assign(facts, { expectedCells: coverage.expectedCells, actualCells: raw.cells.length,
        passedCells: raw.cells.filter(c => c.status === "PASS").length,
        failedCells: raw.cells.filter(c => c.status === "FAILED").length,
        runningCells: raw.cells.filter(c => c.status === "RUNNING").length,
        expectedChecks: coverage.expectedChecks, passedChecks: coverage.passedChecks,
        failedChecks: coverage.failedChecks, notRunChecks: coverage.notRunChecks });
      report.coverage = coverage; assert.equal(coverage.coverageComplete, false);
      for (const image of raw.screenshots) {
        assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
        const cell = raw.cells.find(c => path.basename(image.path).startsWith(c.name + "-")); assert(cell);
        const v = cell.viewport, bytes = fs.readFileSync(image.path);
        validateNativeViewport(image.before, v);
        assert.equal(bytes.readUInt32BE(16), v.width * v.dpr); assert.equal(bytes.readUInt32BE(20), v.height * v.dpr);
      }
      const protection = read(path.join(source, "profile-protection.json"));
      const archive = protection.records.find(r => r.storage === "NativeRoaming").target;
      for (const f of raw.nativeSaves) {
        assert.equal(sha(f.retained), f.sha256); assert.deepEqual(read(f.retained), f.data);
        assert.equal(sha(path.join(archive, "saves", f.data.install_id, path.basename(f.source))), f.sha256);
      }
      return { ...facts, screenshots: raw.screenshots.length, saveSnapshots: raw.nativeSaves.length,
        failures: raw.cells.filter(c => c.status === "FAILED").map(c => ({ cell: c.name, error: c.error })),
        missingChecksDoNotPass: true };
    });
    validateInterruptedNarrativeFacts(facts); report.facts = facts;
    report.status = "INTERRUPTED_EVIDENCE_AUDITED";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    for (const f of originals) assert.equal(sha(f.path), f.sha256, "Original reports must never be rewritten");
    report.finishedAt = new Date().toISOString();
    fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
    save(); console.log(JSON.stringify({ status: report.status, out, facts: report.facts, error: report.error }));
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
