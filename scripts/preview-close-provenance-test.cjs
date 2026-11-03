"use strict";
// Verify the new provenance against original red evidence and frozen install scope.
// No product, service, model, installation or desktop input is started.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01";
const out = "F:/AgentVN/QA/Preview-Close-Provenance-20261020-01";
assert(!fs.existsSync(out), "A new verification must not overwrite previous evidence");
fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f) });
const redPath = "F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-11/audit.json";
const greenPath = "F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-12/audit.json";
const receiptPath = path.join(root, "output/native-dev-preview-repair-20261020-01/receipt-01.json");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
  fullAcceptance: false, scope: "PROVENANCE_ONLY_NOT_NEW_PRODUCT_OR_INSTALL_ACCEPTANCE",
  productChanges: 0, builds: 0, modelRequests: 0, deviceOperations: 0 };
function check(name, fn) {
  const entry = { name, status: "RUNNING" }; report.checks.push(entry);
  try { entry.detail = fn(); entry.status = "PASS"; }
  catch (e) { entry.status = "FAILED"; entry.error = String(e.stack || e); throw e; }
}
try {
  const red = read(redPath), green = read(greenPath), receipt = read(receiptPath);
  check("Original twenty-receipt source/EXE rejection stays FAILED", () => {
    assert.equal(red.provenanceStatus, "FAILED"); assert.equal(red.receipts.length, 20);
    assert.equal(red.errors.length, 6);
    for (const suffix of ["main.rs", "owned_process.rs"])
      assert(red.sourceChecks.some(s => s.path.endsWith(path.sep + suffix) && s.status === "FAILED"));
    assert.equal(red.artifactChecks.filter(s => s.status === "FAILED").length, 4);
    assert(!red.sourceChecks.some(s => s.path.endsWith(path.sep + "preview_process.rs")));
    return describe(redPath);
  });
  check("New receipt is explicit and preserves previous source identities", () => {
    assert.equal(green.provenanceStatus, "PASS"); assert.equal(green.errors.length, 0);
    assert.equal(green.receipts.length, 21);
    assert.equal(green.receipts.at(-1).id, "PREVIEW-CLOSE-ARGS-01");
    assert.equal(green.receipts.at(-1).sha256, sha(receiptPath));
    assert.equal(receipt.status, "SOURCE_AND_DEV_PREVIEW_CLOSE_REPAIR_PASS");
    for (const name of ["main.rs", "owned_process.rs"]) {
      const current = green.sourceChecks.find(s => s.path.endsWith(path.sep + name));
      const prior = red.sourceChecks.find(s => s.path === current.path);
      assert.equal(current.receiptId, "PREVIEW-CLOSE-ARGS-01");
      assert.equal(current.sha256, sha(current.path)); assert.notEqual(current.sha256, prior.sha256);
      assert(current.previous.some(s => s.receiptId === prior.receiptId && s.sha256 === prior.sha256));
    }
    const added = green.sourceChecks.find(s => s.path.endsWith(path.sep + "preview_process.rs"));
    assert.equal(added.receiptId, "PREVIEW-CLOSE-ARGS-01"); assert.deepEqual(added.previous, []);
    return { receipt: describe(receiptPath), sourceCount: green.sourceChecks.length };
  });
  check("All referenced receipts, sources, logs, bundled files and artifacts still match", () => {
    const groups = ["receipts", "sourceChecks", "evidenceChecks", "bundledChecks", "artifactChecks"];
    const counts = {};
    for (const name of groups) {
      assert(green[name].length > 0, `Empty ${name}`);
      counts[name] = green[name].length;
      for (const entry of green[name]) assert.equal(sha(entry.path), entry.sha256, entry.path);
    }
    assert.equal(green.artifactChecks.find(s => s.label === "latest root Dev").sha256, receipt.dev.sha256);
    assert(green.artifactChecks.filter(s => s.label === "current rebuilt Player")
      .every(s => s.sha256 === receipt.player.sha256));
    return counts;
  });
  check("Original failures, unchanged backend and frozen-install limitations are not promoted", () => {
    assert.equal(read(path.join(qa, "red-owner-01/report.json")).status, "FAILED");
    assert.equal(read(path.join(qa, "green-owner-01/report.json")).status, "FAILED");
    assert.equal(green.backendRevalidation.currentSha256, receipt.backend.sha256);
    assert.equal(green.backendRevalidation.buildCommandOrigin, "RECORDED_OFFICIAL_BUILD");
    assert.equal(green.fullAcceptance, false); assert.equal(green.acceptanceStatus, "BLOCKED");
    assert.equal(green.releaseStatus, "NOT_BUILT_OR_INSTALLED_WITH_ALL_REPAIRS");
    assert.deepEqual(green.historical.counts, { FAILED: 9, BLOCKED: 6, PASS: 3 });
    const frozen = green.artifactChecks.filter(s => s.label.startsWith("frozen installed "));
    assert.equal(frozen.length, 3);
    return { frozen, qualification: "Previous same-SHA controlled backend evidence referenced, not replayed" };
  });
  report.audit = describe(greenPath); report.originalRejection = describe(redPath);
  report.status = "PROVENANCE_REFRESH_PASS";
} catch (e) {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.testSource = describe(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(path.join(root, "scripts/repair-candidate-preflight.cjs"),
    path.join(out, "executed-preflight.cjs"), fs.constants.COPYFILE_EXCL);
  report.preflightSource = describe(path.join(out, "executed-preflight.cjs"));
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status,
    checks: report.checks.map(c => ({ name: c.name, status: c.status })), error: report.error }, null, 2));
}
