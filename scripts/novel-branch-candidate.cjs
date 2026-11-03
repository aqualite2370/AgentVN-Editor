"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Novel-Branch-Completion-20261103-01";
const [mode, attempt = "01"] = process.argv.slice(2), version = "1.9.39";
assert(["gates", "dev", "release"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, mode + "-" + attempt); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedAt: fs.statSync(f).mtime.toISOString() });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const source = () => desc(path.join(root, "editor/src/store/novelImportStore.ts"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), mode, version,
  scope: "NOVEL_BRANCH_CANDIDATE_BUILD_NOT_INSTALLED_ACCEPTANCE", commands: [], paidRequests: 0,
  source: source(), beforeDev: desc(path.join(root, "AgentVN Dev.exe")) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
function prior(stage) {
  const f = path.join(qa, stage, "report.json"), r = read(f); assert.equal(r.status, "PASS");
  assert(r.commands.length && r.commands.every(c => c.exitCode === 0 && c.status === "PASS"));
  assert.equal(sha(r.source.path), r.source.sha256);
  for (const c of r.commands) assert.equal(sha(c.log.path), c.log.sha256);
  report[stage] = desc(f);
}
async function run(name, executable, args) {
  const log = path.join(out, name + ".log"), fd = fs.openSync(log, "wx");
  const c = { name, executable, arguments: args, cwd: root, status: "RUNNING", startedAt: new Date().toISOString() };
  report.commands.push(c); save(); console.log("START " + name);
  try {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
    c.pid = child.pid; save();
    c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(c.exitCode, 0, log); c.status = "PASS";
  } catch (e) { c.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); c.log = desc(log); c.finishedAt = new Date().toISOString(); save(); }
  console.log("PASS " + name);
}
function versions() {
  for (const f of ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/tauri.conf.json"])
    assert.equal(read(path.join(root, f)).version, version);
  assert.equal(read(path.join(root, "editor/package-lock.json")).packages[""].version, version);
  for (const f of ["editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"])
    assert(/name = "agentvn-editor"\r?\nversion = "1\.9\.39"/.test(fs.readFileSync(path.join(root, f), "utf8")));
}
(async () => {
  versions();
  const audit = path.join(qa, "audit-01.json"); assert.equal(read(audit).status, "PASS");
  const author = read(path.join(qa, "browser-04/report.json"));
  for (const s of author.source) assert.equal(sha(s.path), s.sha256);
  report.directEvidence = desc(audit);
  if (mode === "gates") {
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    await run("editor-typecheck", process.execPath, [npm, "--prefix", "editor", "run", "typecheck"]);
    await run("editor-build", process.execPath, [npm, "--prefix", "editor", "run", "build"]);
    await run("gamecli-build", process.execPath, [npm, "--prefix", "GameCli_framework", "run", "build"]);
  } else if (mode === "dev") {
    prior("gates-01");
    await run("complete-dev-launcher", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert.notEqual(report.dev.sha256, report.beforeDev.sha256);
    assert(Date.parse(report.dev.modifiedAt) >= Date.parse(report.startedAt));
    assert.equal(read(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json")).editorVersion, version);
  } else {
    prior("gates-01"); prior("dev-01");
    await run("exe-only-contract", process.execPath, ["scripts/exe-only-installers-test.cjs", path.join(out, "exe-contract")]);
    await run("editor-exe-package", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/package-installers.ps1"), "-Target", "editor", "-Version", version,
      "-ReleaseRoot", "releases/novel-branch-1939-20261103-01", "-ExpectedRoot", root, "-SkipClean"]);
    const dir = path.join(root, "releases/novel-branch-1939-20261103-01/editor");
    const files = fs.readdirSync(dir); assert.equal(files.filter(f => f.endsWith(".exe")).length, 1);
    assert(!files.some(f => f.endsWith(".msi")));
    report.installer = desc(path.join(dir, files.find(f => f.endsWith(".exe"))));
    const copy = path.join(out, path.basename(report.installer.path));
    fs.copyFileSync(report.installer.path, copy, fs.constants.COPYFILE_EXCL);
    report.retainedInstaller = desc(copy);
    report.releaseExe = desc(path.join(root, "editor/src-tauri/target/release/agentvn-editor.exe"));
    report.backendExe = desc(path.join(root, "editor/src-tauri/binaries/creator-backend.exe"));
  }
  versions(); assert.equal(source().sha256, report.source.sha256); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
