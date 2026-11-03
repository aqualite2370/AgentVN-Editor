"use strict";
// QA/provenance only. Does not build/install/run a product or contact a model.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), label = "Repair-Candidate-Integration-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/repair-candidate-integration-20261020-01");
const [mode, iteration = "01"] = process.argv.slice(2);
assert(["prepare", "red", "green", "integrate", "verify"].includes(mode));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
if (mode === "prepare") {
  for (const directory of [qa, checkpoint, summary]) {
    assert(!fs.existsSync(directory)); fs.mkdirSync(directory, { recursive: true });
  }
  const saved = ["scripts/lib/repair-candidate-provenance.cjs", "scripts/repair-candidate-provenance-test.cjs",
    "scripts/repair-candidate-preflight.cjs", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]
    .map(file => {
      const target = path.join(checkpoint, file); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(target), sha(path.join(root, file))); return { file, sha256: sha(target) };
    });
  const products = ["AgentVN Dev.exe", "editor/src-tauri/binaries/agentvn-player.exe", "editor/src-tauri/binaries/creator-backend.exe"]
    .map(file => ({ file, sha256: sha(path.join(root, file)) }));
  const report = { status: "PASS", at: new Date().toISOString(), saved, products, qa, checkpoint,
    scope: "Recoverable QA source snapshots and current product hashes, not duplicated binaries or product changes" };
  for (const file of [path.join(checkpoint, "manifest.json"), path.join(summary, "preparation.json")])
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
} else {
  const out = path.join(qa, `${mode}-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), mode, steps: [],
    scope: "QA_VALIDATOR_AND_CURRENT_SOURCE_PROVENANCE_NOT_INSTALLED_ACCEPTANCE",
    modelRequests: 0, productChanges: 0, newBuilds: 0 };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-runner.cjs"), fs.constants.COPYFILE_EXCL);
  async function run(name, args) {
    const step = { name, command: [process.execPath, ...args], status: "RUNNING", at: new Date().toISOString() };
    report.steps.push(step); save();
    const log = fs.createWriteStream(path.join(out, `${name}.log`), { flags: "wx" });
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    step.pid = child.pid; save(); let text = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { log.write(data); text = (text + data).slice(-20000); });
    try {
      step.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
      assert.equal(step.exitCode, 0, text); step.status = "PASS";
    } finally { if (step.status !== "PASS") step.status = "FAILED"; log.end(); step.finishedAt = new Date().toISOString(); save(); }
    console.log(`PASS ${name}`);
  }
  (async () => {
    if (mode === "red" || mode === "green") {
      await run("provenance-validator", ["scripts/repair-candidate-provenance-test.cjs"]);
      if (mode === "green") await run("full-regression-evidence-validator", ["scripts/full-regression-evidence-test.cjs"]);
    } else {
      const prior = read(path.join(qa, "green-01/report.json")); assert.equal(prior.status, "PASS");
      const destination = `F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-${iteration}`;
      report.destination = destination;
      if (mode === "integrate") await run("integrated-preflight", ["scripts/repair-candidate-preflight.cjs", destination,
          "F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-01/current-backend-regression-01/agent-tools/2026-10-19T19-37-34-330Z/report.json",
          "F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-01/backend-payload-02.json"]);
      const actual = read(path.join(destination, "audit.json"));
      assert.equal(actual.provenanceStatus, "PASS"); assert.equal(actual.receipts.length, 18);
      assert(actual.qaToolRepair?.originalStatus === "QA_TOOL_REPAIR_PASS",
        "Integrated report omitted QA tool receipt; reject its broader PASS claim");
      assert.equal(actual.errors.length, 0); assert.equal(actual.fullAcceptance, false);
      report.integrated = { sources: actual.sourceChecks.length, references: actual.evidenceChecks.length,
        bundled: actual.bundledChecks.length, artifacts: actual.artifactChecks.length,
        receipts: actual.receipts.length, qaToolRepair: actual.qaToolRepair };
    }
    const prep = read(path.join(summary, "preparation.json"));
    for (const product of prep.products) assert.equal(sha(path.join(root, product.file)), product.sha256);
    report.products = prep.products; report.status = "PASS";
  })().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
}
