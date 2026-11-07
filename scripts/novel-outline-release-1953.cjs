"use strict";
// Editor-only delivery, gated on bounded recovery and ownership behavior.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), action = process.argv[2];
assert(["checkpoint", "build"].includes(action));
const base = "F:/AgentVN/QA/Novel-Outline-Release-1953-20261107-01";
const checkpoint = "F:/AgentVN/Checkpoints/Novel-Outline-Release-1953-20261107-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), bytes: fs.statSync(p).size,
  sha256: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") });
const versions = ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/tauri.conf.json",
  "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"];
const sources = ["backend/app/models/novel_import.py", "backend/app/services/novel_import_service.py",
  "backend/app/services/novel_outline_pipeline.py", "editor/src/store/novelImportStore.ts",
  "editor/src/novel-import/types.ts", "editor/src/novel-import/adaptationClient.ts",
  "editor/src/novel-import/novelProcessJobAdapter.ts",
  "editor/src/components/novel-import/NovelImportWizard.tsx"];
if (action === "checkpoint") {
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
  const saved = [...versions, "AgentVN Dev.exe"].map(relative => {
    const source = path.join(root, relative), backup = path.join(checkpoint, relative);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
    assert.equal(desc(source).sha256, desc(backup).sha256);
    return { relative, source: desc(source), backup: desc(backup) };
  });
  fs.writeFileSync(path.join(checkpoint, "checkpoint.json"),
    JSON.stringify({ status: "PASS", saved, at: new Date().toISOString() }, null, 2), { flag: "wx" });
  console.log("PASS checkpoint"); return;
}
assert.equal(read(path.join(checkpoint, "checkpoint.json")).status, "PASS");
assert(!fs.existsSync(base)); fs.mkdirSync(base);
const report = { status: "RUNNING", version: "1.9.53", startedAt: new Date().toISOString(),
  scope: "EDITOR_NOVEL_OUTLINE_RECOVERY_NO_PLAYER_CHANGE_NO_LIVE_D_DEV_RESTART",
  commands: [], sources: sources.map(f => desc(path.join(root, f))), modelRequests: 0, checkpoint };
const save = () => fs.writeFileSync(path.join(base, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(base, "executed.cjs"), fs.constants.COPYFILE_EXCL);
async function run(name, exe, args) {
  const row = { name, command: [exe, ...args], cwd: root, status: "RUNNING",
    startedAt: new Date().toISOString(), log: path.join(base, name + ".log") };
  report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    assert.equal(row.exitCode, 0, row.log); row.status = "PASS"; console.log("PASS", name);
  } catch (error) { row.status = "FAILED"; throw error; }
  finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); row.output = desc(row.log); save(); }
}
(async () => {
  const recoveryPath = "F:/AgentVN/QA/Novel-Outline-Recovery-20261107-13/report.json";
  const recovery = read(recoveryPath); assert.equal(recovery.status, "PASS");
  assert.equal(recovery.cases.length, 12); assert.equal(recovery.requests.length, 108);
  assert(recovery.cases.every(c => c.status === "PASS" && c.steps.length === 2));
  assert(Object.values(recovery.cleanup).every(v => v === true));
  report.behavior = [recoveryPath,
    "F:/AgentVN/QA/Novel-Outline-Ownership-20261107-02/report.json",
    "F:/AgentVN/QA/Novel-Outline-Idempotence-20261107-01/report.json",
    "F:/AgentVN/QA/Novel-Outline-Schema-20261107-01/report.json"].map(file => {
    assert.equal(read(file).status, "PASS"); return desc(file);
  });
  for (const f of versions.slice(0, 3)) assert.equal(read(path.join(root, f)).version, report.version);
  assert.equal(read(path.join(root, versions[1])).packages[""].version, report.version);
  report.versions = versions.map(f => desc(path.join(root, f)));
  report.playerBefore = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
  report.liveDevBefore = desc("D:/AgentVN/AgentVN Dev.exe");
  const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  await run("transport", process.execPath, ["scripts/novel-outline-transport-test.cjs"]);
  await run("core", process.execPath, ["scripts/novel-processing-core-test.cjs"]);
  await run("facts", process.execPath, ["scripts/novel-phase-facts-test.cjs"]);
  await run("typecheck", process.execPath, [npm, "--prefix", "editor", "run", "typecheck"]);
  await run("editor-build", process.execPath, [npm, "--prefix", "editor", "run", "build"]);
  await run("gamecli-build", process.execPath, [npm, "--prefix", "GameCli_framework", "run", "build"]);
  await run("dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/build-dev-launcher.ps1", "-SkipGameCliPlayer"]);
  report.workspaceDev = desc(path.join(root, "AgentVN Dev.exe"));
  assert.equal(report.workspaceDev.sha256,
    desc(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")).sha256);
  await run("editor-nsis", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/package-installers.ps1", "-Target", "editor", "-Version", report.version,
    "-ReleaseRoot", "releases/novel-outline-1953-20261107", "-ExpectedRoot", root, "-SkipClean"]);
  const release = path.join(root, "releases/novel-outline-1953-20261107/editor");
  const names = fs.readdirSync(release);
  assert(!names.some(n => /\.msi$/i.test(n)));
  const installers = names.filter(n => /\.exe$/i.test(n)); assert.equal(installers.length, 1);
  const retained = path.join(base, installers[0]);
  fs.copyFileSync(path.join(release, installers[0]), retained, fs.constants.COPYFILE_EXCL);
  report.installer = desc(retained);
  await run("payload", process.execPath, ["scripts/editor-installer-resources-acceptance.cjs",
    "F:/AgentVN/QA/Novel-Outline-Payload-1953-20261107-01", report.version, release]);
  const payload = "F:/AgentVN/QA/Novel-Outline-Payload-1953-20261107-01/installer-resource-report.json";
  assert.equal(read(payload).status, "PASS"); report.payload = desc(payload);
  for (const f of report.sources) assert.equal(desc(f.path).sha256, f.sha256);
  assert.equal(desc(report.playerBefore.path).sha256, report.playerBefore.sha256);
  assert.equal(desc(report.liveDevBefore.path).sha256, report.liveDevBefore.sha256);
  report.status = "BUILD_AND_PAYLOAD_PASS_INSTALLATION_PENDING_LIVE_DEV_PRESERVED";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, base, error: report.error })); });
