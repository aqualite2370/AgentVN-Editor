"use strict";
// One candidate build, resumable only between checkpoint and packaging.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), [mode, output] = process.argv.slice(2);
const out = path.resolve(output || ""), version = "1.9.36";
assert(["checkpoint", "build"].includes(mode));
assert(out.startsWith("F:\\AgentVN\\QA\\Player-Aspect-20261102-01\\") && path.dirname(out)
  === "F:\\AgentVN\\QA\\Player-Aspect-20261102-01");
const file = path.join(out, "report.json");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ file: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const versionFiles = ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/tauri.conf.json",
  "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"];
if (mode === "checkpoint") {
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "CHECKPOINT_SAVED", startedAt: new Date().toISOString(), version,
    scope: "EDITOR_ONLY_EXE_CANDIDATE_NOT_INSTALLED_ACCEPTANCE", snapshots: [], commands: [],
    modelRequests: 0, oldVersionEvidence: desc("F:/AgentVN/QA/Functional-Continuation-20261101/installed-editor-20261101-02/actual-installation.json") };
  const oldInstall = read(report.oldVersionEvidence.file);
  assert.equal(sha(oldInstall.executable.path), oldInstall.executable.sha256);
  assert.equal(read(path.join(oldInstall.installRoot, "build-versions.json")).editorVersion, "1.9.35");
  const sources = [...versionFiles, "editor/src-tauri/binaries/creator-backend.exe",
    "editor/src-tauri/target/release/agentvn-editor.exe",
    "editor/src-tauri/target/release/bundle/nsis/AgentVN Editor_1.9.35_x64-setup.exe",
    "editor/src-tauri/bundle-workspace/build-versions.json"];
  for (const relative of sources) {
    const source = path.join(root, relative); if (!fs.existsSync(source)) continue;
    const copy = path.join(out, "before", relative); fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(source), sha(copy)); report.snapshots.push({ source: desc(source), copy: desc(copy) });
  }
  fs.copyFileSync(__filename, path.join(out, "executed-build.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, snapshots: report.snapshots.length, out }));
} else {
  const report = read(file);
  assert.equal(report.status, "CHECKPOINT_SAVED"); assert.equal(report.commands.length, 0);
  assert.equal(sha(path.join(out, "executed-build.cjs")), sha(__filename));
  const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));
  async function run(name, exe, args) {
    const command = { name, command: [exe, ...args], cwd: root, startedAt: new Date().toISOString(),
      status: "RUNNING", log: path.join(out, `${name}.log`) };
    report.commands.push(command); save(); console.log(`START ${name}`);
    const fd = fs.openSync(command.log, "wx");
    try {
      const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
      command.pid = child.pid; save();
      command.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(command.exitCode, 0, `${name}: ${command.log}`); command.status = "PASS";
    } catch (error) { command.status = "FAILED"; throw error; }
    finally {
      fs.closeSync(fd); command.finishedAt = new Date().toISOString(); command.logIdentity = desc(command.log);
      save(); console.log(`${command.status} ${name}`);
    }
  }
  (async () => {
    for (const relative of ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/tauri.conf.json"])
      assert.equal(read(path.join(root, relative)).version, version);
    assert.equal(read(path.join(root, "editor/package-lock.json")).packages[""].version, version);
    for (const relative of ["editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"])
      assert(new RegExp(`name = "agentvn-editor"\\r?\\nversion = "${version.replace(/\./g, "\\.")}"`).test(
        fs.readFileSync(path.join(root, relative), "utf8")));
    const gates = read("F:/AgentVN/QA/Player-Aspect-20261102-01/gates-01/report.json");
    const audit = read("F:/AgentVN/QA/Player-Aspect-20261102-01/evidence-audit-01.json");
    assert.equal(gates.status, "PASS"); assert.equal(audit.status, "PASS");
    const browser = read(gates.browser.identity.file);
    for (const [relative, expected] of Object.entries(browser.sourceHashes)) assert.equal(sha(path.join(root, relative)), expected);
    assert.equal(sha(gates.dev.previewResource.file), gates.dev.previewResource.sha256);
    report.gates = desc("F:/AgentVN/QA/Player-Aspect-20261102-01/gates-01/report.json");
    report.audit = desc("F:/AgentVN/QA/Player-Aspect-20261102-01/evidence-audit-01.json");
    report.currentVersionSources = versionFiles.map(relative => desc(path.join(root, relative)));
    report.status = "RUNNING"; save();
    await run("exe-only-installers-test", process.execPath,
      ["scripts/exe-only-installers-test.cjs", path.join(out, "installer-contract")]);
    await run("package-editor", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/package-installers.ps1"), "-Target", "editor", "-Version", version,
      "-ReleaseRoot", "releases/player-aspect-20261102-01", "-ExpectedRoot", root, "-SkipClean"]);
    const release = path.join(root, "releases/player-aspect-20261102-01/editor");
    const installers = fs.readdirSync(release).filter(name => name.endsWith(".exe"));
    assert.equal(installers.length, 1); assert.equal(fs.readdirSync(release).filter(name => name.endsWith(".msi")).length, 0);
    report.installer = desc(path.join(release, installers[0]));
    const copy = path.join(out, installers[0]); fs.copyFileSync(report.installer.file, copy, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(copy), report.installer.sha256); report.retainedInstaller = desc(copy);
    assert.equal(read(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json")).editorVersion, version);
    assert.equal(sha(gates.dev.previewResource.file), gates.dev.previewResource.sha256);
    for (const original of report.currentVersionSources) assert.equal(sha(original.file), original.sha256);
    report.metadata = desc(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json"));
    report.releaseExecutable = desc(path.join(root, "editor/src-tauri/target/release/agentvn-editor.exe"));
    report.status = "PASS";
  })().catch(error => {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  }).finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(`Report: ${file}`); });
}
