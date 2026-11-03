"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), [mode, attempt = "01"] = process.argv.slice(2);
assert(["gates", "dev", "release"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Knowledge-Draft-Candidate-1937-20261102-01";
const out = path.join(qa, `${mode}-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: hash(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), mode, version: "1.9.37",
  scope: "CURRENT_SOURCE_BUILD_AND_PACKAGE_NOT_INSTALLED_FUNCTIONAL_ACCEPTANCE", commands: [],
  modelRequests: 0, before: ["AgentVN Dev.exe", "editor/src-tauri/target/release/agentvn-editor.exe",
    "editor/src-tauri/binaries/agentvn-player.exe", "editor/src-tauri/binaries/creator-backend.exe"]
    .map(file => desc(path.join(root, file))) };
fs.copyFileSync(__filename, path.join(out, "executed-build.cjs"), fs.constants.COPYFILE_EXCL);
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function run(name, exe, args) {
  const row = { name, executable: exe, arguments: args, cwd: root, startedAt: new Date().toISOString(),
    status: "RUNNING", log: path.join(out, `${report.commands.length + 1}-${name}.log`) };
  report.commands.push(row); save(); console.log("START " + name);
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, 0, row.log); row.status = "PASS";
  } catch (error) { row.status = "FAILED"; throw error; }
  finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); row.logIdentity = desc(row.log); save(); }
  console.log("PASS " + name);
}
function prior(stage) {
  const file = path.join(qa, stage, "report.json"), value = read(file);
  assert.equal(value.status, "PASS"); assert(value.commands.length && value.commands.every(c => c.exitCode === 0));
  report[stage] = desc(file); return value;
}
function assertVersion() {
  for (const file of ["editor/package.json", "editor/src-tauri/tauri.conf.json", "editor/package-lock.json"])
    assert.equal(read(path.join(root, file)).version, report.version, file);
  assert.equal(read(path.join(root, "editor/package-lock.json")).packages[""].version, report.version);
  for (const file of ["editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"])
    assert(/name = "agentvn-editor"\r?\nversion = "1\.9\.37"/.test(fs.readFileSync(path.join(root, file), "utf8")));
}
(async () => {
  assertVersion();
  if (mode === "gates") {
    const draft = read("F:/AgentVN/QA/Layout-Workspace-Draft-20261102-06/report.json");
    assert.equal(draft.status, "PASS"); assert.equal(draft.cases.length, 15);
    for (const source of draft.source) assert.equal(hash(source.path), source.sha256, source.path);
    const knowledgeFile = "F:/AgentVN/QA/Knowledge-Relevance-Delivery-20261102-01/browser-final/report.json";
    const knowledge = read(knowledgeFile);
    assert.equal(knowledge.status, "PASS"); assert.equal(knowledge.cases.length, 48); assert.equal(knowledge.cleanup, "PASS");
    assert(knowledge.cases.every(c => c.status === "PASS"));
    report.browser = desc(knowledgeFile);
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    await run("workspace-draft-contract", process.execPath, ["scripts/runtime-layout-workspace-draft-test.mjs"]);
    await run("knowledge-index", process.execPath, ["scripts/assistant-knowledge-index-test.cjs", path.join(out, "index")]);
    await run("knowledge-retrieval", process.execPath, ["scripts/assistant-knowledge-test.cjs", path.join(out, "retrieval")]);
    await run("knowledge-context", process.execPath, ["scripts/assistant-knowledge-context-test.cjs", path.join(out, "context")]);
    await run("knowledge-git-delivery", process.execPath, ["scripts/assistant-knowledge-delivery-test.cjs", path.join(out, "delivery")]);
    await run("editor-typecheck", process.execPath, [npm, "--prefix", "editor", "run", "typecheck"]);
    await run("editor-build", process.execPath, [npm, "--prefix", "editor", "run", "build"]);
    await run("gamecli-build", process.execPath, [npm, "--prefix", "GameCli_framework", "run", "build"]);
  } else if (mode === "dev") {
    prior("gates-01");
    await run("complete-dev-launcher", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.equal(report.dev.sha256, hash(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert.notEqual(report.dev.sha256, report.before[0].sha256);
    assert(Date.parse(report.dev.modifiedAt) >= Date.parse(report.startedAt));
    assert.equal(read(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json")).editorVersion, report.version);
  } else {
    prior("gates-01"); prior("dev-01");
    await run("exe-only-contract", process.execPath, ["scripts/exe-only-installers-test.cjs", path.join(out, "exe-contract")]);
    await run("editor-exe-package", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/package-installers.ps1"), "-Target", "editor", "-Version", report.version,
      "-ReleaseRoot", "releases/knowledge-draft-1937-20261102-01", "-ExpectedRoot", root, "-SkipClean"]);
    const release = path.join(root, "releases/knowledge-draft-1937-20261102-01/editor");
    const names = fs.readdirSync(release);
    assert.equal(names.filter(n => n.endsWith(".exe")).length, 1); assert(!names.some(n => n.endsWith(".msi")));
    report.installer = desc(path.join(release, names.find(n => n.endsWith(".exe"))));
    const copy = path.join(out, path.basename(report.installer.path));
    fs.copyFileSync(report.installer.path, copy, fs.constants.COPYFILE_EXCL);
    report.retainedInstaller = desc(copy); assert.equal(report.retainedInstaller.sha256, report.installer.sha256);
    report.releaseExe = desc(path.join(root, "editor/src-tauri/target/release/agentvn-editor.exe"));
  }
  assertVersion();
  report.metadata = desc(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json"));
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
