"use strict";
// One frozen Editor-only delivery for the range/stream recovery fixes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), action = process.argv[2];
assert(["checkpoint", "build"].includes(action));
const base = "F:/AgentVN/QA/Novel-Range-Release-1954-20261108-02";
const checkpoint = "F:/AgentVN/Checkpoints/Novel-Range-Release-1954-20261108-02";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), bytes: fs.statSync(p).size,
  sha256: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") });
const versions = ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/tauri.conf.json",
  "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"];
const sources = ["backend/app/services/novel_import_service.py", "backend/app/services/novel_outline_pipeline.py",
  "backend/app/services/novel_realtime.py", "backend/tests/test_novel_outline_recovery.py",
  "backend/tests/test_novel_realtime_backpressure.py", "backend/tests/test_credential_boundaries.py",
  "editor/src/novel-import/persistence.ts", "editor/src/store/novelImportStore.ts",
  "scripts/novel-outline-recovery-playwright.cjs", "scripts/novel-recover-validated-batch.py",
  "scripts/novel-range-source-live.cjs", "scripts/novel-range-release-1954.cjs"];
const gitIdentity = () => ({
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(),
  index: desc(path.resolve(root, execFileSync("git", ["rev-parse", "--git-path", "index"],
    { cwd: root, encoding: "utf8", windowsHide: true }).trim())),
});
if (action === "checkpoint") {
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
  const saved = [...new Set([...versions, ...sources, "AgentVN Dev.exe", "AGENTS.md",
    "plans/ACTIVE_TASKS.md"])].map(relative => {
    const source = path.join(root, relative), backup = path.join(checkpoint, relative);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
    assert.equal(desc(source).sha256, desc(backup).sha256);
    return { relative, source: desc(source), backup: desc(backup) };
  });
  // Full tracked dirty diff is recoverable without touching the user's index.
  const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: root, windowsHide: true,
    maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  fs.writeFileSync(path.join(checkpoint, "tracked.patch"), diff, { flag: "wx" });
  fs.writeFileSync(path.join(checkpoint, "checkpoint.json"),
    JSON.stringify({ status: "PASS", saved, git: gitIdentity(), at: new Date().toISOString() }, null, 2),
    { flag: "wx" });
  console.log("PASS checkpoint"); return;
}
const prior = read(path.join(checkpoint, "checkpoint.json")); assert.equal(prior.status, "PASS");
assert(!fs.existsSync(base)); fs.mkdirSync(base);
const report = { status: "RUNNING", version: "1.9.54", startedAt: new Date().toISOString(),
  scope: "EDITOR_RANGE_AND_STREAM_FIX_NO_PLAYER_INSTALLER_NO_LIVE_D_DEV_RESTART",
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
  const browserPath = "F:/AgentVN/QA/Novel-Outline-Ranges-Browser-20261108-03/report.json";
  const b = read(browserPath);
  assert.equal(b.status, "PASS"); assert.equal(b.cases.length, 2); assert.equal(b.requests.length, 18);
  assert(b.cases.every(c => c.status === "PASS" && c.steps.length === 3
    && c.steps.some(s => s.startsWith("nested-tail-accepted"))
    && c.steps.some(s => s.startsWith("reload-manual-resume"))));
  assert(Object.values(b.cleanup).every(v => v === true)); report.behavior = desc(browserPath);
  const livePath = "F:/AgentVN/QA/Novel-Range-Source-Live-20261108-02/report.json";
  const live = read(livePath);
  assert.equal(live.status, "PASS_REAL_OUTLINE_REVIEW_REQUIRED");
  assert.equal(live.operations.length, 1); assert.equal(live.operations[0].operation, "build_outline");
  assert.equal(live.preflight.scans, 85); assert(live.terminal.chapters > 0 && !live.terminal.busy);
  report.liveSource = desc(livePath);
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
  const releaseRoot = "releases/novel-range-1954-20261108";
  await run("editor-nsis", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/package-installers.ps1", "-Target", "editor", "-Version", report.version,
    "-ReleaseRoot", releaseRoot, "-ExpectedRoot", root, "-SkipClean"]);
  const release = path.join(root, releaseRoot, "editor"), names = fs.readdirSync(release);
  assert(!names.some(n => /\.msi$/i.test(n)));
  const installers = names.filter(n => /\.exe$/i.test(n)); assert.equal(installers.length, 1);
  const retained = path.join(base, installers[0]);
  fs.copyFileSync(path.join(release, installers[0]), retained, fs.constants.COPYFILE_EXCL);
  report.installer = desc(retained);
  const payloadDir = "F:/AgentVN/QA/Novel-Range-Payload-1954-20261108-01";
  await run("payload", process.execPath, ["scripts/editor-installer-resources-acceptance.cjs",
    payloadDir, report.version, release]);
  const payload = path.join(payloadDir, "installer-resource-report.json");
  assert.equal(read(payload).status, "PASS"); report.payload = desc(payload);
  for (const f of report.sources) assert.equal(desc(f.path).sha256, f.sha256);
  assert.equal(desc(report.playerBefore.path).sha256, report.playerBefore.sha256);
  assert.equal(desc(report.liveDevBefore.path).sha256, report.liveDevBefore.sha256);
  const after = gitIdentity(); assert.equal(after.head, prior.git.head);
  assert.equal(after.index.sha256, prior.git.index.sha256); report.git = after;
  report.status = "BUILD_AND_PAYLOAD_PASS_INSTALLATION_PENDING_LIVE_DEV_PRESERVED";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, base, error: report.error })); });
