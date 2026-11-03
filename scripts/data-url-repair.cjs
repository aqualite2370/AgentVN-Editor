"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), label = "Data-URL-Repair-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/data-url-repair-20261020-01");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const [mode, iteration = "01"] = process.argv.slice(2);
assert(["prepare", "red", "green", "gates", "backend", "dev", "candidate", "flow"].includes(mode));
const write = (f, value) => fs.writeFileSync(f, JSON.stringify(value, null, 2), { flag: "wx" });
const sources = ["backend/app/services/project_state_service.py", "backend/app/api/routes_project.py",
  "backend/tests/test_project_state_service.py", "backend/tests/test_api.py",
  "backend/tests/test_project_data_url.py", "scripts/data-url-repair.cjs",
  "scripts/lib/client-experience-current-flow.cjs", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"];
const products = ["AgentVN Dev.exe", "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe"];
if (mode === "prepare") {
  for (const dir of [qa, checkpoint, summary]) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const files = [...sources, ...products].map(file => {
    const target = path.join(checkpoint, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(target), sha(path.join(root, file))); return { file, sha256: sha(target) };
  });
  const original = "F:/AgentVN/QA/Client-Experience-Safe-20261020-01/客户端完整流程临时工程.vnproj";
  const input = path.join(qa, "charset素材临时工程.vnproj");
  fs.copyFileSync(original, input, fs.constants.COPYFILE_EXCL); assert.equal(sha(input), sha(original));
  write(path.join(summary, "fixture.json"), { input, sha256: sha(input), original, originalSha256: sha(original) });
  write(path.join(summary, "preparation.json"), { at: new Date().toISOString(), files, qa, checkpoint,
    scope: "Recoverable original product sources/binaries and exact original failing fixture; no user database or final project" });
  console.log(JSON.stringify({ status: "PASS", qa, checkpoint, files: files.length }));
} else if (mode === "candidate") {
  const old = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-06/audit.json"));
  const before = JSON.parse(fs.readFileSync(path.join(summary, "preparation.json")));
  const sourceChecks = old.sourceChecks.filter(s => !s.path.toLowerCase().includes("\\scripts\\")).map(s => {
    const current = sha(s.path);
    const authorized = ["backend/app/services/project_state_service.py", "backend/app/api/routes_project.py"]
      .some(file => path.resolve(root, file) === s.path);
    if (!authorized) assert.equal(current, s.actualSha256, s.path);
    return { ...s, previousSha256: s.actualSha256, actualSha256: current, sha256: current,
      supersession: authorized ? "DATAURL-01 authorized repair" : undefined };
  });
  for (const file of ["backend/app/services/project_state_service.py", "backend/app/api/routes_project.py"]) {
    const full = path.join(root, file);
    if (!sourceChecks.some(s => s.path === full)) sourceChecks.push({ path: full, actualSha256: sha(full), sha256: sha(full),
      previousSha256: before.files.find(f => f.file === file).sha256, supersession: "DATAURL-01 authorized repair" });
  }
  write(path.join(qa, "candidate.json"), { at: new Date().toISOString(), sourceChecks });
  console.log(JSON.stringify({ status: "PASS", sourceChecks: sourceChecks.length }));
} else if (mode === "flow") {
  const fixture = JSON.parse(fs.readFileSync(path.join(summary, "fixture.json")));
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(fixture.input));
  const api = require("./client-experience-final-e2e-playwright.cjs");
  require("./lib/client-experience-current-flow.cjs").run(api, { qa, summary, input: fixture.input,
    fixtureManifest: path.join(summary, "fixture.json"), auditFile: path.join(qa, "candidate.json") })
    .catch(e => { console.error(e); process.exitCode = 1; });
} else {
  const out = path.join(qa, `${mode}-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), steps: [] };
  const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function run(args, cwd = root, expected = 0) {
    const command = args.shift(), logPath = path.join(out, `${report.steps.length + 1}.log`);
    const step = { command: [command, ...args], cwd, logPath, status: "RUNNING" }; report.steps.push(step); persist();
    const log = fs.createWriteStream(logPath, { flags: "wx" });
    fs.mkdirSync(path.join(qa, "temp"), { recursive: true });
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TEMP: path.join(qa, "temp"), TMP: path.join(qa, "temp") } });
    step.pid = child.pid; persist();
    for (const s of [child.stdout, child.stderr]) s.pipe(log, { end: false });
    step.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    log.end(); step.finishedAt = new Date().toISOString();
    step.status = step.exitCode === expected ? "PASS" : "FAILED"; persist();
    assert.equal(step.exitCode, expected, `Failed ${step.command.join(" ")}; see ${logPath}`);
    console.log(`PASS ${step.command.join(" ")}`);
  }
  (async () => {
    if (mode === "red" || mode === "green") {
      const targets = mode === "red" ? ["tests/test_project_data_url.py"]
        : ["tests/test_project_data_url.py", "tests/test_project_state_service.py", "tests/test_api.py"];
      await run(["python", "-m", "pytest", ...targets, "-q", "--basetemp", path.join(out, "pytest")], path.join(root, "backend"),
        mode === "red" ? 1 : 0);
    } else if (mode === "gates") {
      for (const args of [
        ["cmd.exe", "/c", "npm", "--prefix", path.join(root, "editor"), "run", "typecheck"],
        ["cmd.exe", "/c", "npm", "--prefix", path.join(root, "editor"), "run", "build"],
        ["cmd.exe", "/c", "npm", "--prefix", path.join(root, "GameCli_framework"), "run", "build"],
      ]) await run(args);
    } else {
      await run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts", mode === "backend" ? "build-backend-sidecar.ps1" : "build-dev-launcher.ps1"),
        ...(mode === "backend" ? ["-KeepPyInstallerArtifacts"] : [])]);
    }
    report.status = "PASS";
  })().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString(); report.sources = sources.filter(f => fs.existsSync(path.join(root, f)))
      .map(file => ({ file, sha256: sha(path.join(root, file)) }));
    report.products = products.map(file => ({ file, sha256: sha(path.join(root, file)) }));
    persist(); console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  });
}
