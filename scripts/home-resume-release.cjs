"use strict";
// New candidate for the exact home-label repair. Extracted payloads are not installs.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync, spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Home-Resume-Release-20261021-01";
const checkpoint = "F:/AgentVN/Checkpoints/Home-Resume-Release-20261021-01", version = "1.9.17";
const mode = process.argv[2];
assert(["checkpoint", "red", "check", "dev", "release", "payload", "install"].includes(mode));
const out = path.join(qa, mode + "-01");
assert(!fs.existsSync(out), "Never overwrite evidence"); fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const report = { status: "RUNNING", mode, version, startedAt: new Date().toISOString(),
  scope: "HOME_LABEL_CANDIDATE_NOT_COMPLETE_UPGRADE_OR_PLATFORM_ACCEPTANCE", commands: [], modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const versions = ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/tauri.conf.json",
  "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"];
function sources() {
  return [...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .toString("utf8").split("\0"))].filter(f => /^(editor|GameCli_framework|backend|shared|scripts)\//.test(f)
      && fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile())
    .sort().map(f => desc(path.join(root, f)));
}
function preserve(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(target)); return desc(target);
}
function prior(phase) {
  const file = path.join(qa, phase + "-01/report.json"), r = read(file);
  assert.equal(r.status, "PASS");
  if (phase !== "checkpoint") for (const f of r.sources) assert.equal(sha(f.path), f.sha256, f.path);
  report.precondition = desc(file); return r;
}
async function command(label, exe, args, expectFailure = false) {
  const log = path.join(out, `${report.commands.length + 1}.log`), fd = fs.openSync(log, "wx");
  const row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save(); console.log("START " + label);
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd],
      env: { ...process.env, TEMP: out, TMP: out, AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED: "",
        AGENTVN_TEST_PROJECT: "F:/AgentVN/QA/Home-Resume-Repair-20261021-01/首页标签 隔离小工程.vnproj",
        AGENTVN_WORKSPACE_OUTPUT: path.join(out, "test-" + report.commands.length) } });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    row.status = row.exitCode === 0 ? "PASS" : "FAILED";
  } finally { fs.closeSync(fd); row.log = desc(log); row.finishedAt = new Date().toISOString(); save(); }
  if (expectFailure) assert.notEqual(row.exitCode, 0, "Expected red guard");
  else assert.equal(row.status, "PASS", log);
  console.log(`${row.status} ${label}`);
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const repaired = read("F:/AgentVN/QA/Home-Resume-Repair-20261021-01/source-green-04/report.json");
  assert.equal(repaired.status, "PASS"); assert.equal(repaired.matrix.length, 12);
  assert.equal(sha(repaired.productSource.path), repaired.productSource.sha256);
  if (mode === "checkpoint") {
    assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
    assert.equal(read(path.join(root, versions[2])).version, "1.9.16");
    fs.writeFileSync(path.join(checkpoint, "worktree.patch"), git(["diff", "--binary", "HEAD"]), { flag: "wx" });
    const names = git(["ls-files", "--modified", "--others", "--exclude-standard", "-z"])
      .toString("utf8").split("\0").filter(Boolean);
    report.snapshots = [...new Set(names)].map(f => fs.existsSync(path.join(root, f))
      ? { file: f, ...preserve(path.join(root, f), path.join(checkpoint, "worktree", f)) }
      : { file: f, deleted: true });
    report.savedProducts = ["AgentVN Dev.exe", "editor/src-tauri/target/release/agentvn-editor.exe"]
      .map(f => preserve(path.join(root, f), path.join(checkpoint, "products", f)));
    const installed = read("F:/AgentVN/QA/Component-Preview-Release-20261021-02/installation.json");
    report.frozen = [installed.executable, ...installed.resources];
    report.history = fs.readdirSync(path.join(root, "releases/editor")).filter(f => /\.(exe|msi)$/.test(f))
      .map(f => desc(path.join(root, "releases/editor", f)));
    report.beforeVersion = versions.map(f => desc(path.join(root, f)));
    report.index = desc(path.join(root, ".git/index"));
  } else if (mode === "red") {
    prior("checkpoint"); report.sources = sources();
    await command("Forward version red", process.execPath,
      ["scripts/editor-forward-version-test.cjs", path.join(out, "forward.json")], true);
    assert.equal(read(path.join(out, "forward.json")).status, "FAILED");
    await command("New installation root not yet allowed", "powershell.exe", ["-NoProfile", "-File",
      "scripts/runtime-dialog-installed-session.ps1", "-Action", "SelfTest", "-QaRoot", qa, "-ExpectedVersion", version], true);
  } else {
    assert.equal(read(path.join(root, versions[2])).version, version);
    const baseline = read(path.join(qa, "checkpoint-01/report.json"));
    const previous = prior({ check: "checkpoint", dev: "check", release: "dev", payload: "release", install: "payload" }[mode]);
    report.sources = sources();
    if (mode === "check") {
      for (const name of ["package-version-contract", "package-version-encoding-regression-test",
        "editor-runtime-resource-wiring-contract", "installer-payload-provenance-test", "installer-backend-upgrade-contract"])
        await command(name, process.execPath, [`scripts/${name}.cjs`]);
      await command("Forward version green", process.execPath,
        ["scripts/editor-forward-version-test.cjs", path.join(out, "forward.json")]);
      await command("Installation root green", "powershell.exe", ["-NoProfile", "-File",
        "scripts/runtime-dialog-installed-session.ps1", "-Action", "SelfTest", "-QaRoot", qa, "-ExpectedVersion", version]);
      await command("Exact resume-label oracle", process.execPath, ["scripts/installed-home-resume-label.cjs", "--self-test"]);
      await command("Native cache boundaries", "powershell.exe", ["-NoProfile", "-File",
        "scripts/installed-layout-cache-session.ps1", "-Action", "SelfTest", "-RunDirectory", path.join(qa, "editor-01")]);
      await command("Isolated source backend contract", process.execPath, ["scripts/editor-ui-acceptance-isolation-contract-test.cjs"]);
      const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
      for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
        await command(`${folder} ${task}`, process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
    } else if (mode === "dev") {
      assert.equal(previous.commands.length, 13); assert(previous.commands.every(c => c.status === "PASS"));
      await command("Full Dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/build-dev-launcher.ps1"]);
      report.dev = desc(path.join(root, "AgentVN Dev.exe"));
      assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
      assert(fs.statSync(report.dev.path).mtimeMs >= Date.parse(report.startedAt));
      await command("Version resource faults", process.execPath, ["scripts/editor-installed-version-resources-test.cjs"]);
    } else if (mode === "release") {
      report.reusedBinaries = ["agentvn-player.exe", "creator-backend.exe"]
        .map(f => desc(path.join(root, "editor/src-tauri/binaries", f)));
      await command("Official Editor release", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", "scripts/build-editor-windows.ps1", "-SkipBackendSidecar", "-SkipGameCliPlayer"]);
      for (const f of report.reusedBinaries) assert.equal(sha(f.path), f.sha256);
      const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
      report.installers = [path.join(bundle, `nsis/AgentVN Editor_${version}_x64-setup.exe`),
        ...["en-US", "zh-CN"].map(l => path.join(bundle, `msi/AgentVN Editor_${version}_x64_${l}.msi`))].map(desc);
    } else if (mode === "payload") {
      for (const f of previous.installers) assert.equal(sha(f.path), f.sha256);
      await command("Three actual installer payloads", process.execPath,
        ["scripts/editor-installer-resources-acceptance.cjs", path.join(out, "deployments"), version]);
      const payload = read(path.join(out, "deployments/installer-resource-report.json"));
      assert.equal(payload.status, "PASS"); assert.equal(payload.deployments.length, 3);
      report.deployments = payload.deployments;
      report.archived = previous.installers.map((f, i) => preserve(f.path,
        path.join(root, "releases/editor", `AgentVN_Editor_v${version}_20261021_HomeResume${i === 0 ? ".exe" : i === 1 ? "_en-US.msi" : "_zh-CN.msi"}`)));
    } else {
      await command("Actual independent-directory NSIS installation", "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/runtime-dialog-installed-session.ps1",
          "-Action", "Install", "-QaRoot", qa, "-ExpectedVersion", version]);
      const installation = read(path.join(qa, "installation.json"));
      assert.equal(installation.status, "PASS"); assert.equal(installation.metadataRestoration, "PASS");
      report.installation = desc(path.join(qa, "installation.json"));
    }
    for (const f of [...report.sources, ...baseline.frozen, ...baseline.history, baseline.index])
      assert.equal(sha(f.path), f.sha256, f.path);
  }
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, mode, out, error: report.error })); });
