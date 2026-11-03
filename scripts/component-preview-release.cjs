"use strict";
// Candidate preparation only; payload extraction is not normal installation.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync, spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const [mode, attempt = "01", version = "1.9.15", repairEvidenceFile =
  "F:/AgentVN/QA/Component-Preview-Isolation-20261021-01/2026-10-21T00-20-05-185Z/report.json"] = process.argv.slice(2);
assert(["1.9.15", "1.9.16"].includes(version));
const suffix = version === "1.9.15" ? "01" : "02";
const qa = `F:/AgentVN/QA/Component-Preview-Release-20261021-${suffix}`;
const checkpoint = `F:/AgentVN/Checkpoints/Component-Preview-Release-20261021-${suffix}`;
assert(["checkpoint", "check", "dev", "release", "payload"].includes(mode));
assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `${mode}-${attempt}`);
assert(!fs.existsSync(out), "Never overwrite evidence"); fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const report = { status: "RUNNING", scope: "COMPONENT_PREVIEW_NEW_CANDIDATE_NOT_UPGRADE", version,
  mode, startedAt: new Date().toISOString(), commands: [], modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/agentvn-player.exe", "editor/src-tauri/binaries/creator-backend.exe"];
function sources() {
  return [...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0"))]
    .filter(f => /^(editor|GameCli_framework|backend|shared|scripts)\//.test(f)
      && fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile())
    .sort().map(file => ({ file, sha256: sha(path.join(root, file)) }));
}
function preserve(file, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(file), sha(target)); return desc(target);
}
async function command(label, executable, args) {
  const log = path.join(out, `${report.commands.length + 1}.log`), fd = fs.openSync(log, "wx");
  const row = { label, command: [executable, ...args], startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save(); console.log(`START ${label}`);
  try {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd],
      env: { ...process.env, TEMP: out, TMP: out, AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED: "",
        AGENTVN_TEST_PROJECT: "F:/AgentVN/QA/Installed-Components-20261021-01/editor-02/含组件 保存包.vnproj",
        AGENTVN_WORKSPACE_OUTPUT: path.join(out, `test-${report.commands.length}`) } });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    row.status = row.exitCode === 0 ? "PASS" : "FAILED";
  } finally { fs.closeSync(fd); row.log = desc(log); row.finishedAt = new Date().toISOString(); save(); }
  console.log(`${row.status} ${label}`); assert.equal(row.status, "PASS", log);
}
function prior(phase) {
  const file = path.join(qa, `${phase}-01/report.json`), value = read(file);
  assert.equal(value.status, "PASS"); assert(value.commands.length || phase === "checkpoint");
  assert(value.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  if (phase !== "checkpoint") for (const f of value.sources) assert.equal(sha(path.join(root, f.file)), f.sha256);
  report.precondition = desc(file); return value;
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  report.before = products.map(f => desc(path.join(root, f)));
  if (mode === "checkpoint") {
    assert.equal(read(path.join(root, "editor/src-tauri/tauri.conf.json")).version,
      version === "1.9.15" ? "1.9.14" : "1.9.15");
    assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
    fs.writeFileSync(path.join(checkpoint, "worktree.patch"), git(["diff", "--binary", "HEAD"]), { flag: "wx" });
    const names = git(["ls-files", "--modified", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0").filter(Boolean);
    report.snapshots = [...new Set(names)].map(file => {
      const source = path.resolve(root, file); assert(source.startsWith(root + path.sep));
      return fs.existsSync(source) ? { file, ...preserve(source, path.join(checkpoint, "worktree", file)) } : { file, deleted: true };
    });
    report.savedDev = preserve(path.join(root, products[0]), path.join(checkpoint, "pre-version-dev.exe"));
    const installed = read("F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json");
    report.frozen = [installed.executable, ...installed.resources];
    if (version === "1.9.16") {
      const previous = read("F:/AgentVN/QA/Component-Preview-Release-20261021-01/installation.json");
      assert.equal(previous.status, "PASS");
      report.frozen.push(previous.executable, ...previous.resources);
    }
    report.history = fs.readdirSync(path.join(root, "releases/editor")).filter(f => /\.(exe|msi)$/.test(f))
      .map(f => desc(path.join(root, "releases/editor", f)));
    const evidence = read(repairEvidenceFile);
    assert.equal(evidence.status, "PASS"); assert.equal(evidence.cases.length, 12);
    report.repairEvidence = desc(repairEvidenceFile);
  } else {
    assert.equal(read(path.join(root, "editor/src-tauri/tauri.conf.json")).version, version);
    const before = prior({ check: "checkpoint", dev: "check", release: "dev", payload: "release" }[mode]);
    report.sources = sources();
    if (mode === "check") {
      for (const name of ["custom-component-markup-test", "custom-component-archive-test",
        "custom-component-project-copy-test", "custom-component-project-export-test", "custom-component-library-playwright"])
        await command(name, process.execPath, [`scripts/${name}.cjs`]);
      for (const name of ["package-version-contract", "package-version-encoding-regression-test",
        "editor-runtime-resource-wiring-contract", "installer-payload-provenance-test", "installer-backend-upgrade-contract"])
        await command(name, process.execPath, [`scripts/${name}.cjs`]);
      await command("Forward version", process.execPath, ["scripts/editor-forward-version-test.cjs", path.join(out, "forward.json")]);
      const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
      for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
        await command(`${folder} ${task}`, process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
    } else if (mode === "dev") {
      await command("Complete Dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
      assert.equal(sha(path.join(root, products[0])), sha(path.join(root, products[1])));
      assert.notEqual(sha(path.join(root, products[0])), report.before[0].sha256);
      assert(fs.statSync(path.join(root, products[0])).mtimeMs >= Date.parse(report.startedAt));
      await command("Installed version resource faults", process.execPath, ["scripts/editor-installed-version-resources-test.cjs"]);
    } else if (mode === "release") {
      report.reusedBinaries = report.before.slice(2);
      await command("Official release", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts/build-editor-windows.ps1"), "-SkipBackendSidecar", "-SkipGameCliPlayer"]);
      for (const f of report.reusedBinaries) assert.equal(sha(f.path), f.sha256);
      const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
      report.installers = [path.join(bundle, `nsis/AgentVN Editor_${version}_x64-setup.exe`),
        ...["en-US", "zh-CN"].map(l => path.join(bundle, `msi/AgentVN Editor_${version}_x64_${l}.msi`))].map(desc);
    } else {
      for (const f of before.installers) assert.equal(sha(f.path), f.sha256);
      await command("Three actual installer payloads", process.execPath,
        ["scripts/editor-installer-resources-acceptance.cjs", path.join(out, "deployments"), version]);
      const payload = read(path.join(out, "deployments/installer-resource-report.json"));
      assert.equal(payload.status, "PASS"); assert.equal(payload.deployments.length, 3);
      report.deployments = payload.deployments;
      report.archived = before.installers.map((f, i) => preserve(f.path,
        path.join(root, "releases/editor", `AgentVN_Editor_v${version}_20261021_ComponentPreview${i === 0 ? ".exe" : i === 1 ? "_en-US.msi" : "_zh-CN.msi"}`)));
    }
    for (const f of report.sources) assert.equal(sha(path.join(root, f.file)), f.sha256, `Source changed: ${f.file}`);
    const baseline = read(path.join(qa, "checkpoint-01/report.json"));
    for (const f of [...baseline.frozen, ...baseline.history]) assert.equal(sha(f.path), f.sha256);
  }
  report.products = products.map(f => desc(path.join(root, f))); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
