"use strict";
// Release-sidecar provenance and real EXE API acceptance; never an installer
// or native-picker substitute. All mutable QA data stays below F:/AgentVN.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), label = "Packaged-Backend-Continuation-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/packaged-backend-continuation-20261020-01");
const exe = path.join(root, "editor/src-tauri/binaries/creator-backend.exe");
const load = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedAt: fs.statSync(f).mtime.toISOString() });
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Do not follow checkpoint links: ${file}`);
    return entry.isDirectory() ? entry.name === "__pycache__" ? [] : walk(file) : [file];
  });
}
function prepare() {
  for (const directory of [qa, checkpoint, summary]) {
    assert(!fs.existsSync(directory)); fs.mkdirSync(directory, { recursive: true });
  }
  const preflightFile = "F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-07/audit.json";
  const frozen = load(preflightFile).artifactChecks.filter(f => f.label.startsWith("frozen installed "));
  assert.equal(frozen.length, 3);
  for (const f of frozen) assert.equal(sha(f.path), f.sha256);
  const sources = [...walk(path.join(root, "backend/app")).filter(f => f.endsWith(".py")),
    ...["backend/backend_launcher.py", "backend/pyproject.toml", "scripts/build-backend-sidecar.ps1",
      "scripts/backend-payload-source-audit.py", "scripts/lib/controlled-novel-failure-provider.cjs",
      "scripts/lib/owned-process-tree.cjs", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
      path.relative(root, __filename)].map(f => path.join(root, f))];
  const copied = [];
  for (const file of [...sources, exe, path.join(root, "backend/dist/creator-backend.exe"),
    path.join(root, "backend/creator-backend.spec")]) {
    if (!fs.existsSync(file)) continue;
    const target = path.join(checkpoint, path.relative(root, file));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    copied.push({ ...desc(file), checkpoint: desc(target) });
  }
  const original = "F:/AgentVN/QA/Data-URL-Repair-20261020-01/charset素材临时工程.vnproj";
  const input = path.join(qa, "charset素材隔离工程.vnproj");
  fs.copyFileSync(original, input, fs.constants.COPYFILE_EXCL);
  const fixture = load(input); assert.equal(fixture.asset_manifest.length, 7);
  const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
    "editor/src-tauri/binaries/agentvn-player.exe"].map(f => desc(path.join(root, f)));
  fs.writeFileSync(path.join(summary, "preparation.json"), JSON.stringify({
    at: new Date().toISOString(), frozen, preflight: desc(preflightFile), copied,
    input: desc(input), original: desc(original), products, sources: sources.map(desc),
    boundary: "No product-source edits; preserve frozen installed candidates and prior artifacts; no model charges",
  }, null, 2), { flag: "wx" });
  console.log(`PREPARED ${qa}`);
}
async function build(name) {
  assert(/^build-\d{2}$/.test(name));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json"));
  const r = { status: "RUNNING", at: new Date().toISOString(), before: desc(exe), steps: [] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  const unchanged = () => {
    for (const f of [...prep.frozen, ...prep.products, prep.input, prep.original,
      ...prep.sources.filter(f => f.path.includes(`${path.sep}backend${path.sep}`) && f.path.endsWith(".py"))])
      assert.equal(sha(f.path), f.sha256, `Protected input/source/product changed: ${f.path}`);
  };
  async function command(label, args, cwd = root) {
    const file = path.join(out, `${label}.log`), fd = fs.openSync(file, "wx");
    const s = { label, executable: args[0], args: args.slice(1), cwd, status: "RUNNING",
      startedAt: new Date().toISOString() }; r.steps.push(s); save();
    try {
      console.log(`START ${label}`);
      const child = spawn(args[0], args.slice(1), { cwd, windowsHide: true, stdio: ["ignore", fd, fd],
        env: { ...process.env, PYTHONIOENCODING: "utf-8", AGENTVN_TEST_PROJECT: prep.input.path,
          AGENTVN_WORKSPACE_OUTPUT: out, TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") } });
      s.pid = child.pid; save();
      s.code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
      assert.equal(s.code, 0, `${label} failed; inspect ${file}`); s.status = "PASS"; console.log(`PASS ${label}`);
    } catch (error) { s.status = "FAILED"; s.error = String(error.stack || error); throw error; }
    finally { fs.closeSync(fd); s.log = desc(file); s.finishedAt = new Date().toISOString(); save(); }
  }
  try {
    unchanged(); fs.mkdirSync(path.join(out, "temporary"));
    await command("source-regressions", ["python", "-m", "pytest",
      "tests/test_novel_process_service.py", "tests/test_novel_import_api.py",
      "tests/test_project_data_url.py", "tests/test_assistant_agent_tool_protocol.py",
      "tests/test_assistant_creation_queue.py", "-q", `--junitxml=${path.join(out, "source-regressions.xml")}`],
    path.join(root, "backend"));
    const xml = fs.readFileSync(path.join(out, "source-regressions.xml"), "utf8");
    const suite = xml.match(/<testsuite\s[^>]*>/)?.[0]; assert(suite);
    r.tests = Object.fromEntries(["tests", "errors", "failures", "skipped"].map(key =>
      [key, Number(suite.match(new RegExp(`\\b${key}="(\\d+)"`))?.[1])]));
    assert(r.tests.tests > 0 && r.tests.errors === 0 && r.tests.failures === 0 && r.tests.skipped === 0);
    await command("bounded-packaging", ["node", "scripts/package-backend-size-contract.cjs"]);
    // Keep artifacts avoids the official script's optional recursive cleanup.
    // The former sidecar/dist/spec have already been copied to the checkpoint.
    await command("official-sidecar-build", ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/build-backend-sidecar.ps1"), "-KeepPyInstallerArtifacts"]);
    r.built = desc(exe); r.dist = desc(path.join(root, "backend/dist/creator-backend.exe"));
    assert.equal(r.built.sha256, r.dist.sha256);
    assert(Date.parse(r.built.modifiedAt) >= Date.parse(r.steps.at(-1).startedAt));
    await command("embedded-current-source", ["python", "scripts/backend-payload-source-audit.py",
      path.join(out, "embedded-source.json")]);
    const audit = load(path.join(out, "embedded-source.json"));
    assert.equal(audit.status, "PASS"); assert.equal(audit.sha256, r.built.sha256);
    assert(audit.appModules > 0); r.embeddedSource = desc(path.join(out, "embedded-source.json"));
    unchanged(); r.status = "CURRENT_PACKAGED_BACKEND_BUILD_SOURCE_MATCH_PASS";
  } catch (error) { r.status = "FAILED"; r.error = String(error.stack || error); process.exitCode = 1; }
  finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, tests: r.tests, error: r.error })); }
}
if (require.main === module) {
  const [mode, name] = process.argv.slice(2);
  Promise.resolve().then(() => {
    if (mode === "prepare") return prepare();
    if (mode === "build") return build(name);
    throw Error("Expected prepare or build build-NN");
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { root, qa, checkpoint, summary, exe, load, sha, desc };
