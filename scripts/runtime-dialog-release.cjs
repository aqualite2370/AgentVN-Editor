"use strict";
// Publish the already red/green-verified dialog repair as a distinct candidate.
// Payload deployment is not installation, upgrade, or standalone acceptance.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync, spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";
const checkpoint = "F:/AgentVN/Checkpoints/Runtime-Dialog-Release-20261021-01";
const [mode, attempt = "01"] = process.argv.slice(2);
assert(["checkpoint", "check", "dev", "release", "payload"].includes(mode));
assert.match(attempt, /^\d{2}$/);
const version = "1.9.14", previousVersion = "1.9.13";
const out = path.join(qa, `${mode}-${attempt}`);
assert(!fs.existsSync(out), "Do not overwrite evidence"); fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const config = () => read(path.join(root, "editor/src-tauri/tauri.conf.json"));
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/target/release/agentvn-editor.exe",
  "editor/src-tauri/binaries/agentvn-player.exe", "editor/src-tauri/binaries/creator-backend.exe"];
const report = { status: "RUNNING", mode, startedAt: new Date().toISOString(), version,
  scope: "DIALOG_REPAIR_RELEASE_CANDIDATE_NOT_INSTALLATION_OR_UPGRADE", commands: [],
  modelRequests: 0, before: products.map(f => desc(path.join(root, f))) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
function sources() {
  return [...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .toString("utf8").split("\0"))].filter(f => /^(editor|GameCli_framework|backend|shared|scripts)\//.test(f)
      && fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile())
    .sort().map(file => ({ file, sha256: sha(path.join(root, file)) }));
}
function prior(phase) {
  const file = path.join(qa, `${phase}-01/report.json`), data = read(file);
  assert.equal(data.status, "PASS", file);
  if (phase !== "checkpoint") assert(data.commands.length > 0 && data.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  for (const f of data.sources || []) assert.equal(sha(path.join(root, f.file)), f.sha256, f.file);
  report.precondition = desc(file); return data;
}
async function command(label, exe, args) {
  const log = path.join(out, `${String(report.commands.length + 1).padStart(2, "0")}.log`);
  const fd = fs.openSync(log, "wx"), row = { label, command: [exe, ...args], status: "RUNNING",
    startedAt: new Date().toISOString() };
  report.commands.push(row); save(); console.log(`START ${label}`);
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd], env: {
      ...process.env, TEMP: out, TMP: out, AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED: "",
      AGENTVN_TEST_PROJECT: "F:/AgentVN/QA/Installed-Portrait-20261021-01/头像布局隔离小工程.vnproj",
      AGENTVN_WORKSPACE_OUTPUT: path.join(out, `test-${report.commands.length}`),
    } });
    row.pid = child.pid;
    row.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    row.status = row.exitCode === 0 ? "PASS" : "FAILED";
  } finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); row.log = desc(log); save(); }
  console.log(`${row.status} ${label}`); assert.equal(row.status, "PASS", log);
}
function preserve(file, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(file), sha(target)); return desc(target);
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  if (mode === "checkpoint") {
    assert.equal(config().version, previousVersion);
    assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
    fs.writeFileSync(path.join(checkpoint, "worktree.patch"), git(["diff", "--binary", "HEAD"]), { flag: "wx" });
    const names = git(["ls-files", "--modified", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0").filter(Boolean);
    report.snapshots = [...new Set(names)].map(file => {
      const source = path.resolve(root, file); assert(source.startsWith(root + path.sep));
      return fs.existsSync(source) ? { file, ...preserve(source, path.join(checkpoint, "worktree", file)) } : { file, deleted: true };
    });
    report.savedProducts = products.map((f, i) => preserve(path.join(root, f), path.join(checkpoint, `product-${i}.exe`)));
    report.history = fs.readdirSync(path.join(root, "releases/editor")).filter(f => /\.(exe|msi)$/.test(f))
      .map(f => desc(path.join(root, "releases/editor", f)));
    const old = read("F:/AgentVN/QA/Installed-Candidate-20261021-01/installation.json");
    assert.equal(old.status, "PASS");
    report.frozen = [desc(old.executable.path), desc(path.join(old.installRoot, "agentvn-player.exe")),
      ...read("F:/AgentVN/QA/Installed-Portrait-20261021-01/preparation.json").immutable
        .filter(f => path.resolve(f.path) !== path.resolve(root, "AgentVN Dev.exe")).map(f => {
          assert.equal(sha(f.path), f.sha256); return desc(f.path);
        })];
    const existing = read("F:/AgentVN/QA/Runtime-Dialog-Measurement-20261021-01/audit-01/report.json");
    assert.equal(existing.status, "PASS");
    report.repairEvidence = desc("F:/AgentVN/QA/Runtime-Dialog-Measurement-20261021-01/audit-01/report.json");
    const currentPe = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "$rows=@(Get-ChildItem -LiteralPath $env:AGENTVN_HISTORY_DIR -Filter '*.exe' -File | ForEach-Object {[pscustomobject]@{path=$_.FullName;version=$_.VersionInfo.ProductVersion}});ConvertTo-Json -InputObject $rows -Compress"],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, AGENTVN_HISTORY_DIR: path.join(root, "releases/editor") } });
    report.historyVersions = JSON.parse(currentPe.replace(/^\uFEFF/, ""));
    const latest = report.historyVersions.filter(r => /^\d+\.\d+\.\d+$/.test(r.version || ""))
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
    assert.equal(latest.version, previousVersion); report.nextVersion = version;
  } else {
    assert.equal(config().version, version);
    const before = prior(mode === "check" ? "checkpoint" : mode === "dev" ? "check" : mode === "release" ? "dev" : "release");
    report.sources = sources();
    if (mode === "check") {
      for (const name of ["package-version-contract", "package-version-encoding-regression-test",
        "editor-runtime-resource-wiring-contract", "installer-payload-provenance-test", "installer-backend-upgrade-contract",
        "runtime-render-diagnostic-test", "ui-skin-style-component-health-contract"])
        await command(name, process.execPath, [`scripts/${name}.cjs`]);
      await command("Version strictly forward", process.execPath,
        ["scripts/editor-forward-version-test.cjs", path.join(out, "version-green.json")]);
      const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
      for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
        await command(`${folder} ${task}`, process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
      assert.equal(report.commands.length, 11);
    } else if (mode === "dev") {
      await command("Complete Dev build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
      assert.equal(sha(path.join(root, products[0])), sha(path.join(root, products[1])));
      assert.notEqual(sha(path.join(root, products[0])), report.before[0].sha256);
      assert(fs.statSync(path.join(root, products[0])).mtimeMs >= Date.parse(report.startedAt));
      await command("Installed version fault matrix", process.execPath, ["scripts/editor-installed-version-resources-test.cjs"]);
    } else if (mode === "release") {
      report.reusedBinaries = report.before.slice(3);
      await command("Official release using verified Player/backend", "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/build-editor-windows.ps1"),
          "-SkipBackendSidecar", "-SkipGameCliPlayer"]);
      for (const f of report.reusedBinaries) assert.equal(sha(f.path), f.sha256);
      const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
      report.installers = [path.join(bundle, `nsis/AgentVN Editor_${version}_x64-setup.exe`),
        ...["en-US", "zh-CN"].map(l => path.join(bundle, `msi/AgentVN Editor_${version}_x64_${l}.msi`))].map(desc);
    } else {
      for (const f of before.installers) assert.equal(sha(f.path), f.sha256);
      await command("Actual three payloads", process.execPath, ["scripts/editor-installer-resources-acceptance.cjs",
        path.join(out, "deployments"), version]);
      const payloadFile = path.join(out, "deployments/installer-resource-report.json"), payload = read(payloadFile);
      assert.equal(payload.status, "PASS"); assert.equal(payload.deployments.length, 3);
      const sourceFiles = report.sources.filter(f => /^(GameCli_framework\/src\/|GameCli_framework\/src-tauri\/src\/|shared\/)/.test(f.file));
      assert(sourceFiles.length >= 100);
      report.deployments = payload.deployments.map(d => {
        for (const f of sourceFiles) assert.equal(sha(path.join(d.installedRoot, f.file)), f.sha256, `${d.kind}/${f.file}`);
        assert.equal(read(d.versionResource.path).editorVersion, version);
        return { ...d, sourceFilesChecked: sourceFiles.length };
      });
      report.payloadReport = desc(payloadFile);
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
      report.archived = before.installers.map((f, i) => preserve(f.path,
        path.join(root, "releases/editor", `AgentVN_Editor_v${version}_${stamp}${i === 0 ? ".exe" : i === 1 ? "_en-US.msi" : "_zh-CN.msi"}`)));
    }
    for (const f of report.sources) assert.equal(sha(path.join(root, f.file)), f.sha256, `Source changed: ${f.file}`);
    const baseline = read(path.join(qa, "checkpoint-01/report.json"));
    for (const f of [...baseline.frozen, ...baseline.history]) assert.equal(sha(f.path), f.sha256, `Preserved file changed: ${f.path}`);
  }
  report.products = products.map(f => desc(path.join(root, f))); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
