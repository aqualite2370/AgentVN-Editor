"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), ts = require("../editor/node_modules/typescript");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), label = "Client-Experience-Safe-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/client-experience-safe-20261020-01");
const [mode, iteration = "01"] = process.argv.slice(2);
assert(["prepare", "red", "green"].includes(mode));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const script = "scripts/client-experience-final-e2e-playwright.cjs";
if (mode === "prepare") {
  for (const dir of [qa, checkpoint, summary]) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const saved = [script, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"].map(file => {
    const dest = path.join(checkpoint, file); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, file), dest, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(dest), sha(path.join(root, file))); return { file, sha256: sha(dest) };
  });
  const receipt = { at: new Date().toISOString(), status: "PASS", saved, qa, checkpoint,
    products: ["AgentVN Dev.exe", "editor/src-tauri/binaries/agentvn-player.exe"].map(file => ({ file, sha256: sha(path.join(root, file)) })) };
  for (const f of [path.join(summary, "preparation.json"), path.join(checkpoint, "manifest.json")])
    fs.writeFileSync(f, JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(JSON.stringify(receipt));
} else {
  const out = path.join(qa, `${mode}-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const source = fs.readFileSync(path.join(root, script), "utf8");
  const tree = ts.createSourceFile(script, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function extract(name, scope) {
    const node = tree.statements.find(s => ts.isFunctionDeclaration(s) && s.name.text === name);
    assert(node, name); return new Function(...Object.keys(scope), `${node.getText(tree)};return ${name};`)(...Object.values(scope));
  }
  const report = { at: new Date().toISOString(), status: "RUNNING", cases: [], scope: "QA_RUNNER_SAFETY_UNIT_NOT_PRODUCT_ACCEPTANCE" };
  const base = { root, path, assert, testDir: path.join(root, "test_AgentVN/final-e2e"),
    outputDir: path.join(root, "output/playwright/client-experience-enhancement/final-e2e") };
  async function check(name, fn) {
    const c = { name, status: "RUNNING" }; report.cases.push(c);
    try { c.detail = await fn(); c.status = "PASS"; } catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); }
    console.log(`${c.status} ${name}`);
  }
  (async () => {
    await check("Existing evidence directory rejected without deletion or mutation", () => {
      let erased = 0, created = 0;
      const fs = { existsSync: () => true, rmSync: () => erased++, mkdirSync: () => created++ };
      const reset = extract("resetDirectories", { ...base, fs,
        outputDir: path.join(qa, "existing-evidence"),
        process: { env: { AGENTVN_WORKSPACE_OUTPUT: path.join(qa, "existing-evidence"),
          AGENTVN_TEST_PROJECT: path.join(qa, "fixture.vnproj") } } });
      assert.throws(reset, /fresh|new|exist|isolated/i);
      assert.equal(erased, 0); assert.equal(created, 0); return { erased, created };
    });
    await check("Explicit fresh output and project input must be required", () => {
      const reset = extract("resetDirectories", { ...base,
        process: { env: {} },
        fs: { existsSync: () => false, mkdirSync: () => {}, rmSync: () => {} } });
      assert.throws(reset, /explicit|AGENTVN|isolated/i);
      return { defaultPathRejected: true };
    });
    await check("Unknown listening service is not reused; fresh owner required", async () => {
      let started = 0;
      const owner = { pid: 123, runId: "controlled-owned-service", url: "http://127.0.0.1:53210" };
      const fn = extract("ensureServer", { ...base, isListening: async () => true,
        startDevServer: () => { throw Error("Legacy spawn must not be called"); },
        startOwnedViteServer: async () => { started++; return owner; } });
      const result = await fn("editor", "http://127.0.0.1:6767", path.join(root, "editor"));
      assert.equal(started, 1); assert.equal(result, owner); return { started, identity: result.runId };
    });
    if (mode === "green") {
      for (const [name, configuredOutput, expected] of [
        ["Active runner rejects missing explicit output before services", undefined, /Fresh isolated output required/],
        ["Active runner rejects existing evidence before services", path.join(qa, "smoke-01"), /Fresh isolated output required/],
        ["Active runner rejects out-of-scope output before services", path.join(root, "output/client-e2e-forbidden"), /Fresh isolated output required/],
      ]) await check(name, () => {
        const input = path.join(qa, "客户端完整流程base64临时工程.vnproj");
        const originalInput = sha(input);
        const originalEvidence = sha(path.join(qa, "smoke-01/report.json"));
        const env = { ...process.env, AGENTVN_TEST_PROJECT: input };
        if (configuredOutput) env.AGENTVN_WORKSPACE_OUTPUT = configuredOutput;
        else delete env.AGENTVN_WORKSPACE_OUTPUT;
        const result = spawnSync(process.execPath, [path.join(root, script), "--smoke"],
          { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 15000 });
        assert.equal(result.status, 1); assert.match(result.stderr, expected);
        assert.equal(sha(input), originalInput);
        assert.equal(sha(path.join(qa, "smoke-01/report.json")), originalEvidence);
        if (configuredOutput && !configuredOutput.endsWith("smoke-01")) assert(!fs.existsSync(configuredOutput));
        return { exitCode: result.status, stderr: result.stderr, fixtureUnchanged: true, priorEvidenceUnchanged: true };
      });
    }
    report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  })().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
  .finally(() => {
    report.source = { file: script, sha256: sha(path.join(root, script)) };
    report.activeRunner = { file: "scripts/lib/client-experience-current-flow.cjs",
      sha256: sha(path.join(root, "scripts/lib/client-experience-current-flow.cjs")) };
    report.testSource = { file: __filename, sha256: sha(__filename) };
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
    if (report.status !== "PASS") process.exitCode = 1; console.log(JSON.stringify({ status: report.status, out }));
  });
}
