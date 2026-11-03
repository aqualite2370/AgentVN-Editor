"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Project-Import-Atomic-20261020-01";
const [mode, iteration = "01"] = process.argv.slice(2);
assert(["check", "dev"].includes(mode)); assert(/^\d{2}$/.test(iteration));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file));
const fullPath = path.join(qa, "green-03-full/report.json"), full = read(fullPath);
assert.equal(full.status, "PASS"); assert.equal(full.cases.length, 12);
assert(full.cases.every(c => c.status === "PASS" && c.attempts.length === 4 &&
  c.attempts.every(a => a.status === "PASS") && c.checks.length === 7));
assert.equal(full.cleanup.status, "PASS"); assert.equal(full.modelRequests, 0);
assert.equal(sha(full.testSource.path), full.testSource.sha256);
for (const s of full.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
const out = path.join(qa, `${mode}-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), steps: [],
  scope: "PROJECT_IMPORT_ATOMIC_REQUIRED_GATES_NOT_INSTALLED_ACCEPTANCE",
  behavior: { path: fullPath, sha256: sha(fullPath), displayCombinations: 12, rejectionChecks: 48 },
  sources: full.sources, modelRequests: 0 };
const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function run(command, args, cwd = root) {
  const step = { command: [command, ...args], cwd, at: new Date().toISOString(), status: "RUNNING",
    logPath: path.join(out, `${report.steps.length + 1}.log`) }; report.steps.push(step); persist();
  const log = fs.createWriteStream(step.logPath, { flags: "wx" });
  const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, TEMP: path.join(qa, "temp"), TMP: path.join(qa, "temp") } });
  step.pid = child.pid; persist();
  for (const stream of [child.stdout, child.stderr]) stream.pipe(log, { end: false });
  try {
    step.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    assert.equal(step.exitCode, 0, `Failed ${step.command.join(" ")}; see ${step.logPath}`);
    step.status = "PASS"; console.log(`PASS ${step.command.join(" ")}`);
  } finally { await new Promise(resolve => log.end(resolve)); step.finishedAt = new Date().toISOString(); persist(); }
}
(async () => {
  fs.mkdirSync(path.join(qa, "temp"), { recursive: true });
  if (mode === "check") {
    for (const file of ["project-state-save-order-test.cjs", "project-reload-generation-test.cjs",
      "project-save-asset-payload-contract.cjs", "project-create-safety-contract.cjs",
      "recent-projects-retention-contract.cjs", "project-storage-size-contract.cjs",
      "editor-workspace-contract.cjs"]) await run(process.execPath, [`scripts/${file}`]);
    await run("python", ["-m", "pytest", "tests/test_project_data_url.py", "tests/test_project_state_service.py",
      "tests/test_api.py", "-q", "--basetemp", path.join(out, "pytest")], path.join(root, "backend"));
    for (const [directory, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
      await run("cmd.exe", ["/c", "npm", "--prefix", path.join(root, directory), "run", task]);
  } else {
    const gates = read(path.join(qa, "check-01/report.json")); assert.equal(gates.status, "PASS");
    assert.equal(gates.steps.length, 11); assert(gates.steps.every(s => s.status === "PASS" && s.exitCode === 0));
    assert.deepEqual(gates.sources, full.sources);
    await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    const dev = path.join(root, "AgentVN Dev.exe"), player = path.join(root, "editor/src-tauri/binaries/agentvn-player.exe");
    assert.equal(sha(dev), sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert.equal(sha(player), sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    assert(!fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")));
    report.dev = { path: dev, sha256: sha(dev), generatedAt: fs.statSync(dev).mtime.toISOString(), pending: false };
    report.player = { path: player, sha256: sha(player), generatedAt: fs.statSync(player).mtime.toISOString() };
  }
  for (const s of full.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); report.testSource = { path: __filename, sha256: sha(__filename) };
  persist(); fs.copyFileSync(__filename, path.join(out, "executed-gates.cjs"), fs.constants.COPYFILE_EXCL);
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
