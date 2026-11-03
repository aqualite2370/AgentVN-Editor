"use strict";
// Release gates for the MSI directory repair. Payload extraction is not an install.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync, spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/MSI-Location-Repair-20261021-01";
const version = "1.9.18", mode = process.argv[2];
assert(["prepare", "check", "dev", "release", "payload"].includes(mode));
const out = path.join(qa, mode + "-01");
assert(!fs.existsSync(out), "Fresh evidence directory required");
fs.mkdirSync(out);
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const report = { status: "RUNNING", mode, version, startedAt: new Date().toISOString(),
  scope: "MSI_DIRECTORY_REPAIR_CANDIDATE_NOT_ACTUAL_INSTALLATION_OR_COMPLETE_ACCEPTANCE",
  commands: [], modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const versionFiles = ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/tauri.conf.json",
  "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"];
function sources() {
  return [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString("utf8").split("\0"))]
    .filter(f => /^(editor|GameCli_framework|backend|shared|scripts)\//.test(f)
      && fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile())
    .sort().map(f => desc(path.join(root, f)));
}
function verify(files) {
  for (const f of files) assert.equal(sha(f.path), f.sha256, f.path);
}
function prior(phase) {
  const file = path.join(qa, phase + "-01/report.json"), row = read(file);
  assert.equal(row.status, "PASS", file);
  if (phase !== "prepare") verify(row.sources);
  report.precondition = desc(file);
  return row;
}
async function command(label, exe, args, expectedExit = 0) {
  const log = path.join(out, `${report.commands.length + 1}.log`), fd = fs.openSync(log, "wx");
  const row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save(); console.log("START " + label);
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd],
      env: { ...process.env, TEMP: out, TMP: out, AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED: "",
        AGENTVN_TEST_PROJECT: "F:/AgentVN/QA/Home-Resume-Repair-20261021-01/首页标签 隔离小工程.vnproj",
        AGENTVN_WORKSPACE_OUTPUT: path.join(out, "test-" + report.commands.length) } });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    });
    row.status = row.exitCode === expectedExit ? "PASS" : "FAILED";
  } finally {
    fs.closeSync(fd); row.log = desc(log); row.finishedAt = new Date().toISOString(); save();
  }
  assert.equal(row.status, "PASS", log); console.log("PASS " + label);
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const checkpointFile = path.join(qa, "checkpoint.json"), checkpoint = read(checkpointFile);
  assert.equal(checkpoint.status, "PASS");
  report.checkpoint = desc(checkpointFile);
  if (mode === "prepare") {
    assert.equal(read(path.join(root, "editor/src-tauri/tauri.conf.json")).version, "1.9.17");
    report.protected = checkpoint.protected.filter(f => ![
      "AgentVN Dev.exe", "agentvn-editor.exe"
    ].includes(path.basename(f.path)));
    verify(report.protected);
    report.savedVersions = versionFiles.map(f => {
      const target = path.join(out, f); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, f), target, fs.constants.COPYFILE_EXCL); return desc(target);
    });
    report.history = fs.readdirSync(path.join(root, "releases/editor"))
      .filter(f => /\.(exe|msi)$/.test(f)).map(f => desc(path.join(root, "releases/editor", f)));
    await command("Forward-version guard must reject existing 1.9.17", process.execPath,
      ["scripts/editor-forward-version-test.cjs", path.join(out, "forward-red.json")], 1);
    assert.equal(read(path.join(out, "forward-red.json")).status, "FAILED");
    report.status = "PASS"; return;
  }
  const baseline = read(path.join(qa, "prepare-01/report.json"));
  assert.equal(baseline.status, "PASS");
  verify([...baseline.protected, ...baseline.history]);
  const previous = prior({ check: "prepare", dev: "check", release: "dev", payload: "release" }[mode]);
  assert.equal(read(path.join(root, "editor/src-tauri/tauri.conf.json")).version, version);
  report.sources = sources();
  if (mode === "check") {
    for (const name of ["package-version-contract", "package-version-encoding-regression-test",
      "editor-runtime-resource-wiring-contract", "installer-payload-provenance-test", "installer-backend-upgrade-contract"])
      await command(name, process.execPath, [`scripts/${name}.cjs`]);
    await command("Forward-version guard green", process.execPath,
      ["scripts/editor-forward-version-test.cjs", path.join(out, "forward-green.json")]);
    await command("Native source MSI with remembered directory: nine scenarios", process.execPath,
      ["scripts/msi-install-directory-source-test.cjs", "source-green-04"]);
    await command("Native source MSI without remembered directory: nine scenarios", process.execPath,
      ["scripts/msi-install-directory-source-test.cjs", "source-green-05", "--no-memory"]);
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
      await command(`${folder} ${task}`, process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
    assert.equal(report.commands.length, 11);
  } else if (mode === "dev") {
    assert.equal(previous.commands.length, 11);
    assert(previous.commands.every(c => c.status === "PASS"));
    await command("Full Dev launcher build", "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/build-dev-launcher.ps1"]);
    report.dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert(fs.statSync(report.dev.path).mtimeMs >= Date.parse(report.startedAt), "Root Dev not overwritten");
    await command("Installed version-resource fault regression", process.execPath,
      ["scripts/editor-installed-version-resources-test.cjs"]);
  } else if (mode === "release") {
    report.reusedBinaries = ["agentvn-player.exe", "creator-backend.exe"]
      .map(f => desc(path.join(root, "editor/src-tauri/binaries", f)));
    await command("Official Editor release", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "scripts/build-editor-windows.ps1", "-SkipBackendSidecar", "-SkipGameCliPlayer"]);
    verify(report.reusedBinaries);
    const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
    report.installers = [path.join(bundle, `nsis/AgentVN Editor_${version}_x64-setup.exe`),
      ...["en-US", "zh-CN"].map(l => path.join(bundle, `msi/AgentVN Editor_${version}_x64_${l}.msi`))].map(desc);
  } else {
    verify(previous.installers);
    await command("Three actual installer payloads", process.execPath,
      ["scripts/editor-installer-resources-acceptance.cjs", path.join(out, "deployments"), version]);
    const payload = read(path.join(out, "deployments/installer-resource-report.json"));
    assert.equal(payload.status, "PASS"); assert.equal(payload.deployments.length, 3);
    report.deployments = payload.deployments;
    report.archived = previous.installers.map((f, i) => {
      const target = path.join(root, "releases/editor",
        `AgentVN_Editor_v${version}_20261021_MSIDirectory${i === 0 ? ".exe" : i === 1 ? "_en-US.msi" : "_zh-CN.msi"}`);
      fs.copyFileSync(f.path, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(target), f.sha256); return desc(target);
    });
  }
  verify([...report.sources, ...baseline.protected, ...baseline.history]);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, mode, out, error: report.error })); });
