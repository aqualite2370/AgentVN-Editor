"use strict";
// Reuse the frozen product source bytes, install a fresh Python environment,
// and execute the archived backend tests. No user DB/config/provider access.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const attempt = process.argv[2] || "01";
assert.match(attempt, /^\d{2}$/);
const reuseNumber = process.argv.find(a => a.startsWith("--reuse-clean="))?.slice(14);
if (reuseNumber) assert.match(reuseNumber, /^\d{2}$/);
const testOverlay = process.argv.includes("--test-overlay");
const allowedOverlays = new Set(["backend/tests/test_api.py", "backend/tests/test_novel_process_service.py",
  "backend/tests/test_provider_structured_modes.py"]);
const out = `F:/AgentVN/QA/Source-Delivery-20261103-01/backend-clean-${attempt}`;
assert(!fs.existsSync(out), "Never overwrite evidence");
const preparationFile = "F:/AgentVN/QA/Source-Delivery-20261103-01/snapshot-02/report.json";
const preparation = JSON.parse(fs.readFileSync(preparationFile, "utf8"));
assert.equal(preparation.status, "PREPARED_NOT_BUILT");
const originalSource = path.join(path.dirname(preparationFile), "source");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
assert.equal(sha(preparation.archive.path), preparation.archive.sha256);
const python = "C:/Users/1/AppData/Local/Programs/Python/Python311/python.exe";
assert(fs.existsSync(python));
fs.mkdirSync(out);
const source = path.join(out, "source", "backend");
const reusedRoot = reuseNumber
  ? `F:/AgentVN/QA/Source-Delivery-20261103-01/backend-clean-${reuseNumber}` : null;
const envRoot = path.join(reusedRoot || out, "python-env");
const pythonEnv = path.join(envRoot, "Scripts", "python.exe");
for (const dir of ["temporary", "pip-cache", "runtime-data", "qa-support"])
  fs.mkdirSync(path.join(out, dir));
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "FROZEN_BACKEND_CLEAN_DEPENDENCIES_AND_ARCHIVED_TESTS_ONLY",
  sourceReceipt: describe(preparationFile), archive: preparation.archive,
  files: [], testOverlays: [], commands: [], productChanges: 0, modelRequests: 0, deviceLaunches: 0,
  releasesBuilt: 0, commits: 0, pushes: 0, cleanup: "PENDING",
  boundaries: ["Fresh venv; no system-site-packages or workspace environment.",
    "Python audit guard permits loopback HTTP only during pytest; not an OS sandbox.",
    "No packaged backend or native Rust build claim."],
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const guardFile = path.join(__dirname, "lib", "backend-clean-source-guard.py");
fs.copyFileSync(guardFile, path.join(out, "qa-support", "backend_clean_source_guard.py"),
  fs.constants.COPYFILE_EXCL);
report.guard = describe(path.join(out, "qa-support", "backend_clean_source_guard.py"));

function environment(guarded) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:AGENTVN_|VITE_|WEBVIEW2_|OPENAI_|DEEPSEEK_|ANTHROPIC_|LLM_|EMBEDDING_|PIP_|PYTHON|PYTEST)/i.test(key)
      || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|PROXY)$/i.test(key)
      || ["DATABASE_PATH", "VIRTUAL_ENV", "UV_CACHE_DIR"].includes(key))
      delete env[key];
  }
  Object.assign(env, {
    TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary"),
    PYTHONNOUSERSITE: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_CACHE_DIR: path.join(out, "pip-cache"),
    DATABASE_PATH: path.join(out, "runtime-data", "isolated.sqlite"),
    AGENTVN_BACKEND_DATA_DIR: path.join(out, "runtime-data"),
    AGENTVN_ERROR_LOG_DIR: path.join(out, "runtime-data", "logs"),
  });
  if (guarded) Object.assign(env, {
    PYTHONPATH: path.join(out, "qa-support"), PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1",
    AGENTVN_QA_GUARD_ROOT: path.resolve(out),
    AGENTVN_QA_ENV_ROOT: path.resolve(envRoot),
  });
  return env;
}
async function command(name, exe, args, guarded = false) {
  const logFile = path.join(out, `${name}.log`);
  const stream = fs.createWriteStream(logFile, { flags: "wx" });
  const row = { name, executable: exe, arguments: args, cwd: source,
    startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save(); console.log("START", name);
  await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: source, env: environment(guarded),
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    row.pid = child.pid; save();
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.once("error", reject);
    child.once("close", code => stream.end(() => {
      row.exitCode = code; row.finishedAt = new Date().toISOString();
      row.log = describe(logFile); row.status = code === 0 ? "PASS" : "FAILED";
      save(); console.log(row.status, name);
      code === 0 ? resolve() : reject(new Error(`${name}: exit ${code}; see ${logFile}`));
    }));
  });
}
function verifySources() {
  for (const file of report.files) {
    for (const candidate of [path.join(root, file.relative),
      path.join(out, "source", file.relative)])
      assert.equal(sha(candidate), file.sha256, "Source changed: " + candidate);
    assert.equal(sha(path.join(originalSource, file.relative)), file.archivedSha256,
      "Frozen source changed: " + file.relative);
  }
}
(async () => {
  save();
  const files = preparation.files.filter(f => f.relative.startsWith("backend/"));
  assert(files.length > 100 && files.some(f => f.relative === "backend/pyproject.toml"));
  for (const file of files) {
    const original = path.join(originalSource, file.relative), current = path.join(root, file.relative);
    assert.equal(sha(original), file.sha256);
    const currentSha = sha(current);
    if (currentSha !== file.sha256) {
      assert(testOverlay && allowedOverlays.has(file.relative), "Only explicitly listed tests may differ");
      report.testOverlays.push({ relative: file.relative, archivedSha256: file.sha256, sha256: currentSha });
    }
    const dest = path.join(out, "source", file.relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(currentSha === file.sha256 ? original : current, dest, fs.constants.COPYFILE_EXCL);
    report.files.push({ relative: file.relative, sha256: currentSha, archivedSha256: file.sha256 });
  }
  assert(!fs.existsSync(path.join(source, ".env")) && !fs.existsSync(path.join(source, "data")));
  save();
  if (reusedRoot) {
    const priorFile = path.join(reusedRoot, "report.json");
    const prior = JSON.parse(fs.readFileSync(priorFile, "utf8"));
    assert.equal(prior.cleanup, "PASS");
    assert.equal(prior.sourceBytesPreserved, true);
    assert.equal(prior.files.length, report.files.length);
    for (const file of report.files)
      assert.equal(prior.files.find(f => f.relative === file.relative)?.sha256, file.archivedSha256);
    const names = ["create-venv", "fresh-install", "dependency-check", "dependency-versions"];
    for (const name of names) {
      const command = prior.commands.find(c => c.name === name);
      assert.equal(command.status, "PASS"); assert.equal(command.exitCode, 0);
      assert.equal(sha(command.log.path), command.log.sha256);
    }
    assert(fs.existsSync(pythonEnv));
    report.reusedCleanEnvironment = { receipt: describe(priorFile),
      commands: names, reason: "Only the QA harness failed before product test execution; do not reinstall dependencies." };
  } else {
    await command("create-venv", python, ["-m", "venv", envRoot]);
    await command("fresh-install", pythonEnv, ["-m", "pip", "install", `${source}[dev]`]);
    await command("dependency-check", pythonEnv, ["-m", "pip", "check"]);
    await command("dependency-versions", pythonEnv, ["-m", "pip", "freeze", "--all"]);
  }
  assert.match(fs.readFileSync(path.join(envRoot, "pyvenv.cfg"), "utf8"), /include-system-site-packages = false/);
  report.pythonEnvironment = describe(path.join(envRoot, "pyvenv.cfg"));
  await command("backend-tests", pythonEnv, ["-m", "pytest", "tests", "-q",
    "--basetemp", path.join(out, "pytest-temp"),
    "-o", `cache_dir=${path.join(out, "pytest-cache")}`,
    "-o", `log_file=${path.join(out, "pytest-runtime.log")}`,
    "-p", "backend_clean_source_guard", "--junitxml", path.join(out, "junit.xml")], true);
  const boundaryFile = path.join(out, "test-boundary.json");
  const boundary = JSON.parse(fs.readFileSync(boundaryFile, "utf8"));
  assert.equal(boundary.status, "PASS");
  assert.equal(boundary.selfChecks.length, 5);
  assert.deepEqual(boundary.blockedUnexpectedOperations, []);
  assert.equal(boundary.platformMetadataProbe.method,
    "cached actual platform._syscmd_ver() default result");
  assert.equal(boundary.platformMetadataProbe.cache.misses, 1);
  assert(boundary.platformMetadataProbe.cache.hits > 0,
    "Actual OS metadata consumers must use the cached probe");
  report.boundary = describe(boundaryFile);
  const junitFile = path.join(out, "junit.xml"), xml = fs.readFileSync(junitFile, "utf8");
  const matches = [...xml.matchAll(/<testcase\b/g)];
  assert(matches.length > 100, "Do not accept a vacuous backend test suite");
  assert(!/<(?:failure|error|skipped)\b/.test(xml), "Failures/errors/skips cannot be PASS");
  report.tests = { count: matches.length, junit: describe(junitFile) };
  verifySources(); report.sourceBytesPreserved = true;
  assert.equal(report.commands.length, reusedRoot ? 1 : 5);
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED";
  report.error = String(error.stack || error); process.exitCode = 1;
  const junit = path.join(out, "junit.xml");
  if (fs.existsSync(junit)) report.junit = describe(junit);
}).finally(() => {
  try { verifySources(); report.sourceBytesPreserved = true; }
  catch (error) { report.sourceBytesPreserved = false; report.sourceError = String(error); process.exitCode = 1; }
  report.cleanup = report.commands.every(c => c.exitCode !== undefined) ? "PASS" : "FAILED";
  if (report.cleanup !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, tests: report.tests, out, error: report.error }));
});
