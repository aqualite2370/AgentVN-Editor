"use strict";
// Repro -> scoped repair -> gates -> official binaries. Never rewrite old runs
// or frozen installer evidence. All large copies/logs stay in F:/AgentVN.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { load, sha, desc } = require("./packaged-backend-continuation.cjs");
const root = path.resolve(__dirname, ".."), label = "Validation-Privacy-Repair-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/validation-privacy-repair-20261020-01");
const backend = path.join(root, "editor/src-tauri/binaries/creator-backend.exe");
const originalPrep = path.join(root, "output/packaged-backend-continuation-20261020-01/preparation.json");
function prepare() {
  for (const p of [qa, checkpoint, summary]) { assert(!fs.existsSync(p)); fs.mkdirSync(p, { recursive: true }); }
  const original = load(originalPrep);
  const copied = [];
  for (const file of ["backend/app/main.py", "backend/tests/test_validation_error_privacy.py",
    "scripts/packaged-creation-authorization.cjs", "scripts/packaged-creation-authorization-audit.cjs",
    "scripts/validation-privacy-repair.cjs", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
    "AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
    "editor/src-tauri/binaries/creator-backend.exe", "backend/dist/creator-backend.exe",
    "backend/creator-backend.spec", "editor/src-tauri/binaries/agentvn-player.exe"]) {
    const source = path.join(root, file); if (!fs.existsSync(source)) continue;
    const target = path.join(checkpoint, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); copied.push({ original: desc(source), checkpoint: desc(target) });
  }
  const input = path.join(qa, "隔离校验回执小工程.vnproj");
  fs.copyFileSync(original.input.path, input, fs.constants.COPYFILE_EXCL);
  const prep = { at: new Date().toISOString(), frozen: original.frozen.map(f => {
    assert.equal(sha(f.path), f.sha256); return f;
  }), products: original.products.map(f => desc(f.path)), input: desc(input),
    original: original.input, sources: original.sources.map(f => desc(f.path)), copied,
    oldBackend: desc(backend), originalPreparation: desc(originalPrep) };
  fs.writeFileSync(path.join(summary, "preparation.json"), JSON.stringify(prep, null, 2), { flag: "wx" });
  console.log(`CHECKPOINT_CREATED ${checkpoint}`);
}
async function run(mode, name) {
  assert(["red", "gates", "backend", "dev"].includes(mode)); assert(/^[a-z]+-\d{2}$/.test(name));
  const prep = load(path.join(summary, "preparation.json")), out = path.join(qa, name);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  fs.copyFileSync(__filename, path.join(out, "executed-runner.cjs"), fs.constants.COPYFILE_EXCL);
  const r = { status: "RUNNING", mode, at: new Date().toISOString(), steps: [], beforeBackend: desc(backend),
    beforeProducts: prep.products.map(f => desc(f.path)), frozen: prep.frozen, realModelRequests: 0 };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  const temp = path.join(out, "temporary"); fs.mkdirSync(temp);
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", AGENTVN_TEST_PROJECT: prep.input.path,
    AGENTVN_WORKSPACE_OUTPUT: out, AGENTVN_ERROR_LOG_DIR: path.join(out, "error-logs"),
    DATABASE_PATH: path.join(out, "isolated.db"), TEMP: temp, TMP: temp };
  for (const key of Object.keys(env)) if (/^(LLM_|EMBEDDING_|WEBVIEW2_)/.test(key)) delete env[key];
  function frozen() {
    for (const f of prep.frozen) assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(sha(prep.input.path), prep.input.sha256);
    assert.equal(sha(prep.original.path), prep.original.sha256);
  }
  async function command(label, executable, args, cwd = root, expectExit = 0) {
    const s = { label, executable, args, cwd, expectExit, startedAt: new Date().toISOString(), status: "RUNNING" };
    r.steps.push(s); save(); console.log(`START ${label}`);
    const log = path.join(out, `${label}.log`), fd = fs.openSync(log, "wx");
    try {
      const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ["ignore", fd, fd] });
      s.pid = child.pid; save();
      s.exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      assert.equal(s.exit, expectExit, `${label}: unexpected exit; see ${log}`);
      s.status = "PASS";
    } catch (e) { s.status = "FAILED"; s.error = String(e); throw e; }
    finally { fs.closeSync(fd); s.finishedAt = new Date().toISOString(); s.log = desc(log); save(); }
    console.log(`PASS ${label}`);
  }
  function requireTests(xmlFile, expectFailures = 0) {
    const suite = fs.readFileSync(xmlFile, "utf8").match(/<testsuite\s[^>]*>/)?.[0]; assert(suite);
    const counts = Object.fromEntries(["tests", "errors", "failures", "skipped"].map(k => [k,
      Number(suite.match(new RegExp(`\\b${k}="(\\d+)"`))?.[1])]));
    assert(counts.tests > 0); assert.equal(counts.errors, 0); assert.equal(counts.failures, expectFailures);
    assert.equal(counts.skipped, 0); r.tests = counts; save();
  }
  const shell = (label, text) => command(label, "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `${text}; exit $LASTEXITCODE`]);
  try {
    frozen();
    if (mode === "red") {
      const xml = path.join(out, "privacy.xml");
      await command("privacy-red", "python", ["-m", "pytest", "tests/test_validation_error_privacy.py",
        "-q", "--tb=short", "-p", "no:cacheprovider", `--junitxml=${xml}`], path.join(root, "backend"), 1);
      const raw = fs.readFileSync(xml, "utf8"), suite = raw.match(/<testsuite\s[^>]*>/)?.[0];
      assert(suite); assert(/failures="[1-9]\d*"/.test(suite));
      assert.equal(sha(path.join(root, "backend/app/main.py")), prep.copied.find(f =>
        f.original.path.endsWith(`${path.sep}backend${path.sep}app${path.sep}main.py`)).original.sha256);
      r.status = "RED_REPRODUCED_PRODUCT_FAILED";
    } else if (mode === "gates") {
      const xml = path.join(out, "source.xml");
      await command("source-regressions", "python", ["-m", "pytest", "tests/test_validation_error_privacy.py",
        "tests/test_error_logging.py", "tests/test_api.py", "tests/test_assistant_creation_authorization.py",
        "tests/test_assistant_agent_tool_protocol.py", "tests/test_assistant_creation_queue.py", "-q",
        "-p", "no:cacheprovider", `--junitxml=${xml}`], path.join(root, "backend"));
      requireTests(xml);
      await command("packaging-boundary", "node", ["scripts/package-backend-size-contract.cjs"]);
      await shell("editor-typecheck", "npm --prefix D:\\AgentVN\\editor run typecheck");
      await shell("editor-build", "npm --prefix D:\\AgentVN\\editor run build");
      await shell("gamecli-build", "npm --prefix D:\\AgentVN\\GameCli_framework run build");
      await command("editor-workspace-contract", "node", ["scripts/editor-workspace-contract.cjs"]);
      r.status = "VALIDATION_PRIVACY_SOURCE_GATES_PASS";
    } else if (mode === "backend") {
      assert.equal(load(path.join(qa, "gates-01/report.json")).status, "VALIDATION_PRIVACY_SOURCE_GATES_PASS");
      await command("official-sidecar-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", path.join(root, "scripts/build-backend-sidecar.ps1"), "-KeepPyInstallerArtifacts"]);
      r.built = desc(backend); r.dist = desc(path.join(root, "backend/dist/creator-backend.exe"));
      assert.equal(r.built.sha256, r.dist.sha256);
      await command("embedded-current-source", "python", ["scripts/backend-payload-source-audit.py",
        path.join(out, "embedded-source.json")]);
      const a = load(path.join(out, "embedded-source.json")); assert.equal(a.status, "PASS");
      assert.equal(a.sha256, r.built.sha256); r.embeddedSource = desc(path.join(out, "embedded-source.json"));
      const nativePrep = { ...prep, sources: prep.sources.map(f => desc(f.path)), products: prep.products.map(f => desc(f.path)) };
      fs.writeFileSync(path.join(summary, "native-preparation.json"), JSON.stringify(nativePrep, null, 2), { flag: "wx" });
      r.status = "CURRENT_PACKAGED_BACKEND_BUILD_SOURCE_MATCH_PASS";
    } else {
      assert.equal(load(path.join(qa, "backend-01/report.json")).status, "CURRENT_PACKAGED_BACKEND_BUILD_SOURCE_MATCH_PASS");
      assert.equal(load(path.join(qa, "authorization-audit-01/report.json")).status, "CURRENT_PACKAGED_CREATION_AUTHORIZATION_AUDIT_PASS");
      assert.equal(load(path.join(qa, "authorization-01/report.json")).status, "CURRENT_PACKAGED_CREATION_AUTHORIZATION_PASS");
      const start = Date.now();
      await command("complete-dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
      const dev = desc(path.join(root, "AgentVN Dev.exe")), debug = desc(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
      assert.equal(dev.sha256, debug.sha256); assert(Date.parse(dev.modifiedAt) >= start);
      r.dev = dev; r.debug = debug; r.player = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
      assert.equal(sha(backend), load(path.join(qa, "backend-01/report.json")).built.sha256);
      r.status = "VALIDATION_PRIVACY_COMPLETE_DEV_REPLACED_PASS";
    }
    frozen();
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    r.finishedAt = new Date().toISOString(); r.testSource = desc(__filename); save();
    console.log(JSON.stringify({ status: r.status, mode, steps: r.steps.length, tests: r.tests, out, error: r.error }));
  }
}
if (require.main === module) {
  const [mode, name] = process.argv.slice(2);
  Promise.resolve().then(() => mode === "prepare" ? prepare() : run(mode, name)).catch(e => { console.error(e); process.exitCode = 1; });
}
module.exports = { qa, summary };
