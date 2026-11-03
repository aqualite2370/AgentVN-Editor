"use strict";
// Evidence review explicitly preserves a product FAILED; it is not a green
// authorization suite or a substitute for real model/installed Editor testing.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { qa, summary, exe, load, sha, desc } = require("./packaged-backend-continuation.cjs");
const { stages } = require("./packaged-creation-authorization.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const option = flag => {
  const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1];
};
function audit(name, auditName) {
  assert(/^authorization-\d{2}$/.test(name)); assert(/^authorization-audit-\d{2}$/.test(auditName));
  const activeQa = option("--qa-root") || qa, fixed = process.argv.includes("--expect-fixed");
  assert(path.resolve(activeQa).toLowerCase().startsWith(path.resolve("F:/AgentVN/QA/").toLowerCase() + path.sep));
  const out = path.join(activeQa, auditName); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(activeQa, name, "report.json"), r = load(file);
  const prepFile = option("--preparation") || path.join(summary, "preparation.json"), prep = load(prepFile);
  const a = { status: "RUNNING", at: new Date().toISOString(), productStatus: fixed ? "PASS" : "FAILED",
    report: desc(file), checks: [], realModelRequests: 0 };
  const check = (label, fn) => { const detail = fn(); a.checks.push({ name: label, status: "PASS", detail }); };
  try {
    check("Nonempty complete matrix preserves the actual privacy result", () => {
      assert.equal(r.status, fixed ? "CURRENT_PACKAGED_CREATION_AUTHORIZATION_PASS" : "FAILED");
      assert.deepEqual(r.cases.map(c => c.name), stages);
      assert.deepEqual(r.cases.map(c => c.status), ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS", fixed ? "PASS" : "FAILED", "PASS"]);
      assert.equal(r.cases[0].detail.rejected, 6); assert.equal(r.cases[0].detail.durableTasks, 0);
      assert.deepEqual(r.cases[1].detail.tools, []);
      assert.equal(r.requests.length, 11); assert.equal(r.realModelRequests, 0); assert.equal(r.paidModelRequests, 0);
      assert.equal(r.productChanges, 0); assert.equal(r.providerErrors?.length ?? 0, 0);
      assert(r.cases[2].detail.authorUnchanged && r.cases[3].detail.authorUnchanged);
      assert(r.cases[3].detail.noRequestReplay);
      assert.equal(r.cases[3].detail.outcomes.length, 4);
      assert(r.cases[3].detail.outcomes.every(t => t.status === "failed" && !t.result && t.errorCode === "proposal_not_authorized"));
      assert.equal(r.cases[4].detail.errorCode, "provider_error");
      assert.deepEqual(r.cases[5].detail.denials, [409, 409, 409, 409, 422, 422, 409]);
      assert.equal(r.cases[5].detail.syntheticLocalReceipt, true);
      assert.equal(r.validationCredentialProbe.status, 422);
      assert.equal(r.validationCredentialProbe.exposesCredential, !fixed);
      if (fixed) {
        assert(r.validationCredentialProbe.response.detail.every(e => !("input" in e) && !("ctx" in e)));
        assert.equal(r.validationCredentialProbes.length, 2);
        assert.deepEqual(r.validationCredentialProbes.map(p => p.route), ["/api/assistant/chat", "/api/assistant/creation/component"]);
        assert(r.validationCredentialProbes.every(p => p.status === 422 && !p.exposesCredential &&
          p.response.detail.every(e => !("input" in e) && !("ctx" in e))));
        assert.equal(r.credentialExposures?.length ?? 0, 0);
        assert(r.logPrivacy.checked.length > 0); assert.deepEqual(r.logPrivacy.leakedFiles, []);
        for (const f of r.logPrivacy.checked) {
          assert.equal(sha(f.path), f.sha256);
          assert(!fs.readFileSync(f.path, "utf8").includes("test-only-secret"));
        }
      } else {
        assert.equal(r.validationCredentialProbe.response.detail[0].input.api_key, "[SIMULATED_KEY]");
        assert.equal(r.credentialExposures.length, r.validationCredentialProbes?.length || 1);
      }
      assert.equal(r.validationCredentialProbe.modelRequests, 11);
      return { passed: fixed ? 8 : 7, failed: fixed ? 0 : 1, controlledHttpRequests: 11, syntheticLocalReceipt: true };
    });
    check("Exact binary, source, author-asset and frozen-artifact hashes", () => {
      const protectedFiles = [r.executable, r.testSource, r.finalDatabase, ...r.authorAssets,
        ...prep.frozen, ...prep.products, prep.input, prep.original,
        ...prep.sources.filter(f => f.path.includes(`${path.sep}backend${path.sep}`) && f.path.endsWith(".py"))];
      for (const f of protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
      assert.equal(sha(exe), r.executable.sha256);
      assert.equal(sha(path.join(activeQa, name, "executed-test.cjs")), r.testSource.sha256);
      assert.equal(r.protectedInputsUnchanged, true);
      return { files: protectedFiles.length, executable: r.executable };
    });
    check("Independent read-only SQLite proves seven outcomes and no credential retention", () => {
      const before = sha(r.database);
      const code = [
        "import json,pathlib,sqlite3,sys",
        "c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
        "tasks=[dict(id=r[0],status=r[1],payload=json.loads(r[2]),result=json.loads(r[3]) if r[3] else None,errorCode=r[4]) for r in c.execute('SELECT id,status,payload_json,result_json,error_code FROM assistant_creation_processes ORDER BY sequence')]",
        "projects=[json.loads(r[0]) for r in c.execute('SELECT project_json FROM editor_project_details')]",
        "local=[dict(status=r[0],draft=r[1],result=r[2]) for r in c.execute('SELECT status,draft_json,result_json FROM assistant_creation_local_tools')]",
        "print(json.dumps(dict(tasks=tasks,projects=projects,local=local),ensure_ascii=False));c.close()",
      ].join("\n");
      const q = spawnSync("python", ["-c", code, r.database], { encoding: "utf8", windowsHide: true,
        timeout: 15000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
      assert.equal(q.status, 0, q.stderr); const actual = JSON.parse(q.stdout);
      assert.equal(actual.tasks.length, 7); assert.equal(actual.projects.length, 1);
      assert.deepEqual(actual.tasks.map(t => [t.id, t.status, t.errorCode]),
        r.finalTasks.map(t => [t.id, t.status, t.errorCode]));
      assert(actual.tasks.every(t => JSON.stringify(t.payload) === "{}"));
      assert(actual.tasks.filter(t => t.status === "failed").every(t => t.result === null));
      assert.equal(actual.local.length, 1); assert.equal(actual.local[0].status, "completed");
      assert.equal(actual.local[0].draft, "{}");
      const stable = p => ({ ...p, asset_manifest: p.asset_manifest.map(v => ({ ...v, metadata: { ...v.metadata, url: undefined } })) });
      assert.deepEqual(stable(actual.projects[0]), stable(r.originalProject));
      assert(!q.stdout.includes("test-only-secret"));
      assert.equal(sha(r.database), before);
      const snapshot = path.join(out, "readonly-sqlite-proof.json");
      fs.writeFileSync(snapshot, JSON.stringify(actual, null, 2), { flag: "wx" });
      return { tasks: 7, sourceProjectUnchanged: true, snapshot: desc(snapshot) };
    });
    check("Actual EXE ownership, restarts, cleanup and ports", () => {
      assert.equal(r.launches.length, 2); assert.equal(r.cleanups.length, 2); assert.equal(r.known.length, 4);
      for (const l of r.launches) {
        assert.equal(l.database, r.database); assert.equal(l.executable.sha256, r.executable.sha256);
        assert.equal(l.listeners.length, 1);
        assert(r.known.some(p => p.ProcessId === l.listeners[0].OwningProcess && p.ExecutablePath === r.executable.path));
      }
      for (const c of r.cleanups) {
        assert.equal(c.normalCloseClaimed, false); assert(c.killed.length > 0);
        assert.deepEqual(c.survivors, []); assert.deepEqual(c.listeners, []);
      }
      const current = rows(), identity = p => `${p.ProcessId}:${p.Created}`;
      assert(!r.known.some(p => current.some(n => identity(p) === identity(n))));
      const ports = [...r.launches.map(l => l.port), Number(new URL(r.controlledEndpoint).port)];
      assert.deepEqual(listeners(ports), []); assert.deepEqual(r.providerListenersAfterCleanup, []);
      return { identities: r.known.length, ports, normalWindowCloseTested: false };
    });
    assert.equal(a.checks.length, 4);
    a.status = fixed ? "CURRENT_PACKAGED_CREATION_AUTHORIZATION_AUDIT_PASS" : "EVIDENCE_VERIFIED_PRODUCT_CREDENTIAL_REFLECTION_FAILED";
  } catch (e) { a.status = "AUDIT_FAILED"; a.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    a.finishedAt = new Date().toISOString(); a.testSource = desc(__filename);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(a, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: a.status, productStatus: a.productStatus, checks: a.checks.length, out, error: a.error }));
  }
}
if (require.main === module) audit(...process.argv.slice(2));
