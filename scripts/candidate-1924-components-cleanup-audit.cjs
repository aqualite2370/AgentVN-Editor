"use strict";
// Supplemental read-only audit; original product reports and audit-04 stay intact.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA";
const inputs = [
  [`${qa}/Installed-Components-20261021-01/editor-10/report.json`, "06a804a95f08e70b613cb65ffc54b0a5ceb03927e36f9f71e2d8bff0a575e949"],
  [`${qa}/Native-Runtime-State-20261020-01/components-installed-1924-01/report.json`, "a0724f641bec1c7b71877a7071078ac26084d3d992c769b61feaf4af37201c98"],
  [`${qa}/Installed-Components-20261021-01/audit-04/report.json`, "733b76ec456a27f74e55139a437ef5ab72bc6cf5c2dc94c7bec5f0209c35fdd8"],
];
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const identity = p => `${p.ProcessId}:${p.Created}`;
function evidence(e, r, a) {
  for (const q of [e, r, a]) assert.equal(q.status, "PASS");
  assert.equal(e.launches.length, 3); assert.equal(e.cleanups.length, 3);
  assert.equal(r.launches.length, 1); assert.equal(r.cleanups.length, 1);
  assert.equal(a.groups.length, 6); assert(a.groups.every(g => g.status === "PASS"));
  assert(e.cacheRestored && r.profileRestored && e.protectedUnchanged && r.protectedUnchanged);
  const ids = new Set(), ports = new Set();
  for (const q of [e, r]) {
    for (const p of q.knownProcesses) ids.add(identity(p));
    q.launches.forEach((l, i) => {
      const c = q.cleanups[i]; assert.equal(c.status, "PASS");
      assert(c.killed.includes(`${l.pid}:${l.created}`), "Launch identity not in its cleanup");
      const lp = l.ports || [l.port], cp = c.ports || [c.port];
      assert.deepEqual(cp, lp);
      for (const p of lp) ports.add(p);
      for (const id of c.killed) {
        assert.match(id, /^\d+:\d{4}-\d\d-\d\dT[\d:.]+Z$/); ids.add(id);
      }
      ids.add(`${l.pid}:${l.created}`);
      if (l.backend) ids.add(identity(l.backend));
    });
  }
  assert.equal(ports.size, 7); assert.equal(ids.size, 38);
  return { identities: [...ids], ports: [...ports] };
}
const [e, r, a] = inputs.map(([p, hash]) => { assert.equal(sha(p), hash); return read(p); });
if (process.argv.includes("--self-test")) {
  evidence(e, r, a);
  for (const mutate of [
    q => { q[0].cleanups.pop(); }, q => { q[0].cleanups[0].killed = []; },
    q => { q[1].cleanups[0].port++; }, q => { q[1].profileRestored = false; },
    q => { q[2].groups[0].status = "FAILED"; },
  ]) { const q = structuredClone([e, r, a]); mutate(q); assert.throws(() => evidence(...q)); }
  console.log(JSON.stringify({ status: "PASS", rejectedCounterexamples: 5, scope: "READ_ONLY_AUDIT_SELF_TEST" }));
} else {
  assert.equal(process.argv[2], "01"); assert.equal(process.argv.length, 3);
  const out = `${qa}/Editor-1.9.24-20261024-01/components-cleanup-audit-01`;
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "SUPPLEMENTAL_ALL_LAUNCH_CLEANUP_IDENTITIES_NOT_NORMAL_EXIT_OR_FULL_ACCEPTANCE",
    inputs: inputs.map(([p, hash]) => ({ path: p, sha256: hash })), launches: 0, modelRequests: 0, productChanges: 0 };
  try {
    Object.assign(report, evidence(e, r, a));
    const active = rows();
    report.remaining = active.filter(p => report.identities.includes(identity(p)));
    report.listeners = listeners(report.ports);
    assert.deepEqual(report.remaining, []); assert.deepEqual(report.listeners, []);
    const dirs = e.launches.map(l => l.webview).concat(r.launches.map(l => l.isolation.webview));
    assert(!active.some(p => p.Name === "msedgewebview2.exe" &&
      dirs.some(d => (p.CommandLine || "").includes(d))));
    const cacheFile = path.join(path.dirname(inputs[0][0]), "native-cache-restoration.json");
    const profileFile = r.profileRestoration.path;
    const cache = read(cacheFile); assert.equal(cache.status, "PASS");
    assert.equal(cache.deletedUserFiles, 0);
    assert(ps(`fsutil.exe file queryfileid '${cache.originalDirectory}'`).toLowerCase().includes(cache.originalDirectoryId));
    for (const f of cache.originalFiles) assert.equal(sha(path.join(cache.originalDirectory, f.relative)), f.sha256);
    assert.equal(sha(profileFile), r.profileRestoration.sha256);
    const profile = read(profileFile); assert.equal(profile.status, "PASS");
    report.restorations = [cacheFile, profileFile].map(p => ({ path: p, sha256: sha(p) }));
    for (const f of e.protectedFiles) assert.equal(sha(f.path), f.sha256);
    for (const p of profile.restored) {
      assert(!fs.existsSync(p.held));
      if (p.existed) {
        assert(ps(`fsutil.exe file queryfileid '${p.original}'`).toLowerCase().includes(p.directoryId));
        if (p.byteInventory) for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      }
    }
    const failed = read(`${qa}/Installed-Components-1924-20261025-01/editor-01/report.json`);
    assert.equal(failed.status, "FAILED"); assert.equal(failed.steps.length, 0);
    assert.equal(failed.launches.length, 0); assert.equal(failed.cleanups.length, 0);
    assert.match(failed.error, /Exact installed-layout run boundary required/);
    report.originalAuditFinalKnownCount = 18;
    report.cleanupAndKnownUnion = 37;
    report.additionalLaunchBackend = e.launches[0].backend;
    report.totalExactIdentities = report.identities.length;
    report.status = "PASS";
  } catch (err) { report.status = "FAILED"; report.error = String(err.stack || err); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = { path: __filename, sha256: sha(__filename) };
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, identities: report.totalExactIdentities, error: report.error, out }));
  }
}
