"use strict";
// Read-only audit of the frozen candidate ownership regression; no product launch.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-02/ownership-03";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const input = path.join(base, "report.json"), run = read(input);
const id = p => `${p.ProcessId}:${p.Created}`;
function business(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError);
  assert.equal(r.version, "1.9.24"); assert.equal(r.modelRequests, 0); assert.deepEqual(r.errors, []);
  assert.equal(r.steps.length, 3); assert(r.steps.every(s => s.status === "PASS"));
  assert.equal(r.launches.length, 1); const host = r.launches[0];
  assert.equal(r.owned.process.ParentProcessId, host.pid);
  assert.notEqual(r.sentinel.process.ParentProcessId, host.pid);
  assert.notEqual(id(r.owned.process), id(r.sentinel.process));
  assert.equal(r.owned.previewRoot, r.sentinel.previewRoot);
  assert.equal(r.owned.executable.path, r.sentinel.executable.path);
  assert.equal(r.owned.executable.sha256, r.sentinel.executable.sha256);
  assert(r.owned.process.CommandLine.includes(r.owned.previewRoot));
  assert(r.sentinel.process.CommandLine.includes(r.owned.previewRoot));
  const result = r.steps[2].result;
  assert.equal(result.ownedClosed, id(r.owned.process));
  assert.equal(result.independentAlive, id(r.sentinel.process));
  assert(result.sameExecutableAndRoot && result.actualIndependentStoryAdvance);
  assert(host.dataDirectoryOverride && host.webviewDirectoryOverride);
  assert(!host.sourceServer && !host.manualBackendSpawn);
  assert.equal(r.aliasProof.length, 3); assert(r.aliasProof.every(p => p.movedOnlyOnce));
  return { flows: 3, editorPid: host.pid, ownedPid: r.owned.process.ProcessId,
    independentPid: r.sentinel.process.ProcessId, actualIndependentStoryAdvance: true };
}
if (process.argv[2] === "--self-test") {
  business(run);
  const bad = [r => r.steps.pop(), r => r.steps[2].status = "FAILED", r => r.errors.push("error"),
    r => r.modelRequests++, r => r.sentinel.process.ParentProcessId = r.launches[0].pid,
    r => r.sentinel.previewRoot = "different", r => r.sentinel.executable.sha256 = "bad",
    r => r.steps[2].result.actualIndependentStoryAdvance = false,
    r => r.steps[2].result.ownedClosed = "wrong", r => r.aliasProof.pop(),
    r => r.cleanupError = "failed", r => r.launches[0].webviewDirectoryOverride = false];
  for (const mutate of bad) { const copy = structuredClone(run); mutate(copy); assert.throws(() => business(copy)); }
  console.log(JSON.stringify({ status: "PASS", rejectedBadEvidence: bad.length, productLaunches: 0 }));
} else {
  assert.equal(process.argv[2], "01");
  const out = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/preview-ownership-audit-01";
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), input: desc(input),
    groups: [], productChanges: 0, builds: 0, modelRequests: 0,
    scope: "INSTALLED_PREVIEW_OWNERSHIP_NOT_STANDALONE_OR_ANDROID" };
  function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = fn(); g.status = "PASS"; } catch (e) { g.status = "FAILED"; throw e; }
  }
  try {
    group("Three real ownership flows and distinct process identities", () => business(run));
    group("Frozen installation and exact executed business adaptations", () => {
      const installation = read("F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json");
      assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, "1.9.24");
      assert.equal(run.launches[0].executable.sha256, installation.executable.sha256);
      const player = installation.resources.find(f => path.basename(f.path) === "agentvn-player.exe"); assert(player);
      assert.equal(run.owned.executable.sha256, player.sha256);
      for (const f of [installation.executable, ...installation.resources, ...run.protectedFiles,
        ...run.tools, run.input, run.source, run.owned.executable, run.sentinel.executable, run.separateRecoveryAudit])
        assert.equal(sha(f.path), f.sha256);
      assert.equal(read(run.source.path).status, "FAILED");
      assert.equal(read(run.separateRecoveryAudit.path).status, "PASS");
      assert.equal(read(run.separateRecoveryAudit.cleanupCorrection.path).status, "PASS");
      assert.equal(sha(run.separateRecoveryAudit.cleanupCorrection.path), run.separateRecoveryAudit.cleanupCorrection.sha256);
      let source = fs.readFileSync("scripts/installed-preview-ownership-current.cjs", "utf8");
      const changes = read(path.join(base, "candidate-adaptations.json")); assert.equal(changes.length, 6);
      for (const c of changes) {
        assert.equal(source.split(c.before).length - 1, 1); source = source.replace(c.before, c.after);
      }
      assert.equal(fs.readFileSync(path.join(base, "executed-business.cjs"), "utf8"), source);
      assert.equal(sha(path.join(base, "executed-test.cjs")), sha("scripts/candidate-1924-preview-ownership.cjs"));
      return { version: "1.9.24", transformations: changes.length, originalPreviewStatusPreserved: "FAILED" };
    });
    group("PNG parameters, all six profile aliases and complete process/port cleanup", () => {
      assert.equal(run.screenshots.length, 1);
      for (const s of run.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        const b = fs.readFileSync(s.path);
        assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
        assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
      }
      assert.equal(sha(run.profileRestoration.path), run.profileRestoration.sha256);
      const restored = read(run.profileRestoration.path), journal = read(path.join(base, "profile-protection.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert(restored.removedOnlyOwnedJunctions); assert.equal(restored.restored.length, 3);
      assert.equal(journal.records.length, 3);
      function inventory(dir, relative = "") {
        const result = [];
        for (const e of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
          assert(!e.isSymbolicLink(), "Unexpected profile junction");
          const name = path.join(relative, e.name);
          if (e.isDirectory()) result.push(...inventory(dir, name));
          else if (e.isFile()) result.push({ relative: name, bytes: fs.statSync(path.join(dir, name)).size,
            sha256: sha(path.join(dir, name)) });
        }
        return result.sort((a, b) => a.relative.localeCompare(b.relative));
      }
      const fileId = f => {
        const match = ps(`fsutil file queryfileid '${f.replace(/'/g, "''")}'`).match(/0x[0-9a-f]+/i);
        assert(match); return match[0].toLowerCase();
      };
      for (const p of run.aliasProof) {
        const r = journal.records.find(r => path.resolve(r.original) === path.resolve(p.original)); assert(r);
        assert(!fs.existsSync(r.held)); assert(fs.statSync(r.target).isDirectory());
        assert.equal(fileId(p.original), r.directoryId); assert.equal(fileId(p.alias), r.directoryId);
        assert.equal(p.directoryId, r.directoryId);
        assert(!fs.lstatSync(p.original).isSymbolicLink() && !fs.lstatSync(p.alias).isSymbolicLink());
        if (r.byteInventory) for (const dir of [p.original, p.alias]) assert.deepEqual(inventory(dir),
          r.files.map(f => ({ relative: f.relative, bytes: f.bytes, sha256: f.sha256 }))
            .sort((a, b) => a.relative.localeCompare(b.relative)));
      }
      const allOwned = new Set([...run.observedProcesses, ...run.knownProcesses, run.owned.process, run.sentinel.process].map(id));
      for (const c of run.cleanups) {
        assert.equal(c.status, "PASS"); assert.equal(c.normalCloseClaimed, false);
        for (const k of c.killed) allOwned.add(k);
      }
      assert(!rows().some(p => allOwned.has(id(p))));
      const ports = [...new Set([...run.ports, ...run.launches.flatMap(l => l.ports)])];
      assert.equal(ports.length, 4); assert.deepEqual(listeners(ports), []);
      return { screenshots: 1, aliasViews: 6, physicalDirectories: 3, ownedIdentities: allOwned.size, ports };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  }
}
