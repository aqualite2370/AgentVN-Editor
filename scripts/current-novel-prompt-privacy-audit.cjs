"use strict";
// Read-only audit of already captured synthetic model requests. Never opens
// provider settings, starts a product, or sends an HTTP request.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Novel-Prompt-Privacy-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Novel-Prompt-Privacy-20261102-01";
const inputs = [
  "F:/AgentVN/QA/Novel-Multichapter-1.9.35-20261102-01/session-01/report.json",
  "F:/AgentVN/QA/Novel-Backend-1.9.35-20261102-01/session-02/report.json",
];
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
function inspect(report) {
  assert(report.startedAt && report.finishedAt);
  assert.equal(report.realModelRequests, 0);
  assert.equal(report.productChanges, 0);
  assert.equal(report.modelBoundary.length, report.modelRequests);
  assert.equal(report.providerCleanup.stopped, true);
  assert.equal(report.providerCleanup.requests, report.modelRequests);
  assert.equal(report.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  assert(report.cache.some(c => c.action === "Restore" && c.exitCode === 0));
  assert(report.cleanups.length && report.cleanups.every(c => c.status === "PASS"));
  const leaks = report.modelBoundary.flatMap(request => {
    const messages = request.payload.messages;
    assert(Array.isArray(messages) && messages.length > 0);
    return messages.flatMap((message, messageIndex) => {
      if (!String(message.content).includes("test-only-secret")) return [];
      assert.equal(message.role, "user");
      const marker = "分块分析数据:\n";
      assert.equal(message.content.split(marker).length, 2);
      const promptData = JSON.parse(message.content.split(marker)[1].trim());
      assert.equal(promptData.provider_selection.api_key, "test-only-secret");
      const origin = new URL(promptData.provider_selection.base_url);
      assert.equal(origin.hostname, "127.0.0.1");
      return [{ index: request.index, stage: request.stage || "outline-mainline-rejected",
        messageIndex, role: message.role, field: "provider_selection.api_key",
        syntheticOnly: true, providerOrigin: origin.origin,
        promptContainsCompleteProviderSelection: true }];
    });
  });
  assert.equal(fs.readFileSync(report.finalDatabase.path).includes(Buffer.from("test-only-secret")), false);
  assert.equal(sha(report.finalDatabase.path), report.finalDatabase.sha256);
  return leaks;
}
function sourceProof() {
  // Execute only four pure prompt bodies, stripped of type annotations and
  // decorators. No backend imports, settings, credential files or networking.
  const program = String.raw`
import ast, json, pathlib
source = pathlib.Path("backend/app/services/novel_import_service.py").read_text(encoding="utf-8-sig")
tree = ast.parse(source)
names = ["_outline_mainline_user_prompt", "_outline_structure_user_prompt",
         "_outline_index_user_prompt", "_outline_user_prompt"]
class Dummy:
    document_id = "privacy_audit_document"
    title = "privacy_audit_title"
    total_chars = 10
    allow_branch_suggestions = False
    def model_dump_json(self, **kwargs):
        data = {"document_id": self.document_id, "analyses": [],
                "provider_selection": {"api_key": "AST_SYNTHETIC_PRIVATE_SENTINEL",
                    "base_url": "http://127.0.0.1:1/v1", "connection_id": "synthetic"}}
        for key in kwargs.get("exclude", []):
            data.pop(key, None)
        return json.dumps(data)
results = []
for name in names:
    method = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)
    line = method.lineno
    method.decorator_list = []
    method.returns = None
    for arg in method.args.args:
        arg.annotation = None
    module = ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[]))
    scope = {}
    exec(compile(module, "<extracted-prompt-only>", "exec"), scope)
    output = scope[name](*[Dummy() for _ in method.args.args])
    results.append({"method": name, "line": line,
                    "syntheticKeyInPrompt": "AST_SYNTHETIC_PRIVATE_SENTINEL" in output,
                    "providerSelectionInPrompt": "provider_selection" in output})
print(json.dumps(results))
`;
  const result = spawnSync("python", ["-I", "-c", program], {
    cwd: root, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const methods = JSON.parse(result.stdout);
  assert.equal(methods.length, 4);
  assert(methods.every(m => m.syntheticKeyInPrompt && m.providerSelectionInPrompt));
  return methods;
}
function main() {
  assert(!fs.existsSync(qa)); fs.mkdirSync(qa, { recursive: true });
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
  const result = { status: "RUNNING", productStatus: "FAILED", startedAt: new Date().toISOString(),
    scope: "RECORDED_ACTUAL_INSTALLED_BACKEND_SYNTHETIC_PROMPT_PRIVACY",
    productChanges: 0, builds: 0, paidRequests: 0, productStarts: 0, modelRequests: 0, cases: [] };
  const check = (name, fn) => {
    const row = { name, status: "RUNNING" }; result.cases.push(row);
    try { row.detail = fn(); row.status = "PASS"; }
    catch (error) { row.status = "FAILED"; throw error; }
  };
  try {
    const reports = inputs.map(read);
    result.inputs = inputs.map(desc);
    result.installation = descriptor();
    result.snapshots = [];
    for (const file of ["scripts/current-novel-prompt-privacy-audit.cjs",
      "backend/app/services/novel_import_service.py", "backend/app/models/novel_import.py",
      "backend/app/schemas/requests.py", "plans/ACTIVE_TASKS.md"]) {
      const source = path.join(root, file), destination = path.join(checkpoint, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      result.snapshots.push({ source: desc(source), copy: desc(destination) });
    }
    check("Two real packaged backend reports confirm key in user messages, not just HTTP auth", () => {
      assert.equal(reports[0].status, "FAILED"); assert.equal(reports[0].modelRequests, 4);
      assert.equal(reports[1].status, "PASS"); assert.equal(reports[1].modelRequests, 13);
      const current = inspect(reports[0]), prior = inspect(reports[1]);
      assert.equal(current.length, 1); assert.equal(current[0].index, 3);
      assert.deepEqual(prior.map(x => x.index), [3, 4, 5]);
      assert.deepEqual(prior.map(x => x.stage), ["outline-mainline", "outline-structure", "outline-index"]);
      const backendSource = path.join(root, "backend/app/services/novel_import_service.py");
      for (const report of reports) {
        const recorded = report.sources.find(s => path.resolve(s.path) === backendSource);
        assert(recorded); assert.equal(sha(backendSource), recorded.sha256);
      }
      return { failedMultichapter: current, priorSingleChapter: prior,
        priorFunctionalPassRetained: true, credentialSafetyFailed: true };
    });
    check("Pure extracted source prompts reproduce complete request serialization in four paths", sourceProof);
    check("Detector rejects missing and falsely clean evidence", () => {
      for (const mutate of [
        r => { r.modelBoundary = []; }, r => { r.realModelRequests = 1; },
        r => { r.credentialCleanup = "NOT_RUN"; },
        r => { r.providerCleanup.stopped = false; },
        r => { r.cache = []; },
      ]) { const changed = structuredClone(reports[0]); mutate(changed); assert.throws(() => inspect(changed)); }
      const changed = structuredClone(reports[0]);
      for (const r of changed.modelBoundary)
        for (const m of r.payload.messages) m.content = m.content.replaceAll("test-only-secret", "REMOVED");
      assert.equal(inspect(changed).length, 0); // Cannot manufacture a reproduced defect from an auth-only key.
      return { missingEvidenceRejected: 5, authOnlyKeyNotMisclassified: true };
    });
    check("Recorded cleanup and current owned process/port absence", () => {
      const known = reports.flatMap(r => r.knownProcesses);
      const ports = [...new Set(reports.flatMap(r => r.cleanups.flatMap(c => c.ports)))];
      const current = rows().filter(p => known.some(k =>
        p.ProcessId === k.ProcessId && p.Created === k.Created));
      assert.deepEqual(current, []); assert.deepEqual(listeners(ports), []);
      return { processIdentities: known.length, absentPorts: ports,
        databaseKeysCleared: 2, nativeCacheRestorationRecorded: 2 };
    });
    result.status = "PASS";
    result.interpretation = "EVIDENCE_VERIFIED_PRODUCT_FAILED_PROMPT_CREDENTIAL_DISCLOSURE";
    result.runtimeScope = "Three outline stages observed in actual binaries; fourth monolithic path source-only.";
    result.dependentPaidNovelStatus = "BLOCKED_PENDING_PRODUCT_FIX_AND_NEW_CANDIDATE_REGRESSION";
    result.notClaimed = ["No actual credential exposure proven", "No model-provider retention claim",
      "No full multi-chapter/branch acceptance", "No product remediation"];
  } catch (error) {
    result.status = "FAILED"; result.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(qa, "report.json"), JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: result.status, productStatus: result.productStatus,
      checks: result.cases.length, report: path.join(qa, "report.json"), error: result.error }));
  }
}
if (require.main === module) main();
