"use strict";
// Versioned candidate gates. Extracted payloads never count as installation.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Android-RunId-Release-20261021-01";
const checkpoint = "F:/AgentVN/Checkpoints/Android-RunId-Release-20261021-01", version = "1.9.19";
const mode = process.argv[2]; assert(["checkpoint", "check", "dev", "release", "payload", "install"].includes(mode));
const out = path.join(qa, mode + "-01"); assert(!fs.existsSync(out), "Fresh evidence required");
fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const versions = ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json"];
const sourceFiles = [...versions, "editor/src-tauri/src/main.rs", "scripts/android-runid-repair-release.cjs",
  "scripts/runtime-dialog-installed-session.ps1", "scripts/installed-android-package-current.cjs",
  "scripts/android-current-physical-host.ps1", "scripts/android-current-package-device.cjs",
  "scripts/build-runtime-standalone-android.cjs", "scripts/build-runtime-standalone-android.ps1"];
const report = { status: "RUNNING", mode, version, startedAt: new Date().toISOString(),
  scope: "RUNID_CANDIDATE_NOT_INSTALLATION_OR_ANDROID_ACCEPTANCE", commands: [], modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const verify = files => { for (const f of files) assert.equal(sha(f.path), f.sha256, f.path); };
function prior(phase) {
  const file = path.join(qa, phase + "-01/report.json"), r = read(file);
  assert.equal(r.status, "PASS", file); if (phase !== "checkpoint") verify(r.sources);
  report.precondition = desc(file); return r;
}
async function command(label, exe, args) {
  const log = path.join(out, `${report.commands.length + 1}.log`), fd = fs.openSync(log, "wx");
  const row = { label, command: [exe, ...args], status: "RUNNING", startedAt: new Date().toISOString() };
  report.commands.push(row); save(); console.log("START " + label);
  try {
    const env = { ...process.env, TEMP: out, TMP: out,
      AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED: "",
      AGENTVN_TEST_PROJECT: path.join(root, "scripts/fixtures/dialog-presentation-isolated.vnproj"),
      AGENTVN_WORKSPACE_OUTPUT: path.join(out, "test-" + report.commands.length) };
    env.PSModulePath = [path.join(process.env.USERPROFILE, "Documents/WindowsPowerShell/Modules"),
      path.join(process.env.ProgramFiles, "WindowsPowerShell/Modules"),
      path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter);
    const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    });
    assert.equal(row.exitCode, 0, log); row.status = "PASS";
  } finally { fs.closeSync(fd); row.log = desc(log); row.finishedAt = new Date().toISOString(); save(); }
  console.log("PASS " + label);
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const sourceQa = "F:/AgentVN/QA/Android-RunId-Repair-20261021-01";
  const repaired = read(path.join(sourceQa, "dev-01/report.json"));
  assert.equal(repaired.status, "PASS");
  assert.equal(sha(repaired.sources.find(f => f.path.endsWith("main.rs")).path),
    repaired.sources.find(f => f.path.endsWith("main.rs")).sha256);
  if (mode === "checkpoint") {
    assert.equal(read(path.join(root, "editor/src-tauri/tauri.conf.json")).version, "1.9.18");
    assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
    report.fullWipCheckpoint = desc(path.join(sourceQa, "checkpoint.json"));
    report.frozen = read(path.join(sourceQa, "checkpoint.json")).protected;
    report.history = fs.readdirSync(path.join(root, "releases/editor")).filter(n => /\.(exe|msi)$/.test(n))
      .map(n => desc(path.join(root, "releases/editor", n)));
    report.beforeVersion = versions.map(f => desc(path.join(root, f)));
    report.saved = [...versions, "editor/src-tauri/src/main.rs", "AgentVN Dev.exe"].map(f => {
      const dest = path.join(checkpoint, f); fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(root, f), dest, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(dest), sha(path.join(root, f))); return desc(dest);
    });
    verify([...report.frozen, ...report.history]);
  } else {
    const baseline = read(path.join(qa, "checkpoint-01/report.json")); assert.equal(baseline.status, "PASS");
    const previous = prior({ check: "checkpoint", dev: "check", release: "dev",
      payload: "release", install: "payload" }[mode]);
    assert.equal(read(path.join(root, "editor/src-tauri/tauri.conf.json")).version, version);
    report.sources = sourceFiles.map(f => desc(path.join(root, f)));
    if (mode === "check") {
      await command("Native argument and real receiver regressions", process.execPath, ["scripts/android-direct-runner-cache-test.cjs"]);
      for (const name of ["android-runner-arguments-test", "package-version-contract",
        "package-version-encoding-regression-test", "editor-runtime-resource-wiring-contract",
        "installer-payload-provenance-test", "installer-backend-upgrade-contract"])
        await command(name, process.execPath, [`scripts/${name}.cjs`]);
      await command("Forward version guard", process.execPath,
        ["scripts/editor-forward-version-test.cjs", path.join(out, "forward.json")]);
      await command("New exact installation root", "powershell.exe", ["-NoProfile", "-File",
        "scripts/runtime-dialog-installed-session.ps1", "-Action", "SelfTest", "-QaRoot", qa, "-ExpectedVersion", version]);
      const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
      for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
        await command(`${folder} ${task}`, process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
    } else if (mode === "dev") {
      assert.equal(previous.commands.length, 12); assert(previous.commands.every(c => c.status === "PASS"));
      await command("Full versioned Dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        "scripts/build-dev-launcher.ps1"]);
      report.dev = desc(path.join(root, "AgentVN Dev.exe"));
      assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
      assert(fs.statSync(report.dev.path).mtimeMs >= Date.parse(report.startedAt));
      await command("Installed version resources fault regression", process.execPath, ["scripts/editor-installed-version-resources-test.cjs"]);
    } else if (mode === "release") {
      report.reusedBinaries = ["agentvn-player.exe", "creator-backend.exe"].map(f =>
        desc(path.join(root, "editor/src-tauri/binaries", f)));
      await command("Official Editor release", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", "scripts/build-editor-windows.ps1", "-SkipBackendSidecar", "-SkipGameCliPlayer"]);
      verify(report.reusedBinaries);
      const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
      report.installers = [path.join(bundle, `nsis/AgentVN Editor_${version}_x64-setup.exe`),
        ...["en-US", "zh-CN"].map(l => path.join(bundle, `msi/AgentVN Editor_${version}_x64_${l}.msi`))].map(desc);
    } else if (mode === "payload") {
      verify(previous.installers);
      await command("Three actual installer payloads", process.execPath,
        ["scripts/editor-installer-resources-acceptance.cjs", path.join(out, "deployments"), version]);
      const r = read(path.join(out, "deployments/installer-resource-report.json"));
      assert.equal(r.status, "PASS"); assert.equal(r.deployments.length, 3); report.deployments = r.deployments;
      report.archived = previous.installers.map((f, i) => {
        const dest = path.join(root, "releases/editor",
          `AgentVN_Editor_v${version}_20261021_AndroidRunId${i === 0 ? ".exe" : i === 1 ? "_en-US.msi" : "_zh-CN.msi"}`);
        fs.copyFileSync(f.path, dest, fs.constants.COPYFILE_EXCL); assert.equal(sha(dest), f.sha256); return desc(dest);
      });
    } else {
      await command("Actual isolated-directory NSIS install", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", "scripts/runtime-dialog-installed-session.ps1", "-Action", "Install", "-QaRoot", qa, "-ExpectedVersion", version]);
      const install = read(path.join(qa, "installation.json"));
      assert.equal(install.status, "PASS"); assert.equal(install.metadataRestoration, "PASS");
      report.installation = desc(path.join(qa, "installation.json"));
      report.protected = [...baseline.frozen.filter(f => !f.path.endsWith("editor-09\\report.json")
        && !f.path.includes("Android 输出")), desc(path.join(root, "AgentVN Dev.exe"))];
    }
    verify([...report.sources, ...baseline.frozen, ...baseline.history]);
  }
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, mode, out, dev: report.dev, error: report.error })); });
