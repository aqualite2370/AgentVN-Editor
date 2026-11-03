"use strict";
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { validateMatrix, verifyTrace } = require("./native-editor-motion-audit.cjs");
const { policy } = require("./lib/installed-editor-motion-workspace-policy.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Editor-Motion-20261021-01";
const installationFile = "F:/AgentVN/QA/Editor-1.9.25-20261025-01/installation.json";
const args = process.argv.slice(2), full = args.includes("--full");
const attempt = args.find(arg => /^\d{2}$/.test(arg)) || (full ? "13" : "11");
assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const installation = read(installationFile); assert.equal(installation.status, "PASS");
assert.equal(installation.executable.version, "1.9.25");
const project = fixture(`editor-installed-motion-20261025-${attempt}`); project.title = `1.9.25安装版动效隔离工程${attempt}`;
const input = path.join(out, "安装版动效临时工程.vnproj"); fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const scope = "CURRENT_INSTALLED_RELEASE_EDITOR_MOTION_NOT_RUNTIME_OR_PHYSICAL";
const report = { status: "RUNNING", scope, startedAt: new Date().toISOString(), launches: [], cleanups: [],
  screenshots: [], errors: [], modelRequests: 0, productChanges: 0, builds: 0, commands: [],
  candidateVersion: "1.9.25", workspacePolicy: policy, installation: desc(installationFile), input: desc(input) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
    "-CodexCacheView"], { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), `${result.stdout || ""}\n${result.stderr || ""}`, { flag: "wx" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
let host, worker, cachePrepared = false;
(async () => {
  cache("SelfTest"); cachePrepared = true; cache("Prepare");
  host = installedReleaseSession({ installationFile, out, report, save, input });
  const page = await host.start();
  const preparation = path.join(out, "collector-preparation.json");
  fs.writeFileSync(preparation, JSON.stringify({ scope, run: out, smoke: !full,
    workspacePolicy: policy, installationFile,
    fixture: { input, title: project.title, projectId: project.project_id, projects: [{ input }] },
    launch: { executable: host.installation.executable.path, executableSha256: host.installation.executable.sha256,
      backendUrl: `http://127.0.0.1:${host.current.ports[0]}`, cdpPort: host.current.ports[1] } }, null, 2), { flag: "wx" });
  const log = path.join(out, "collector.log"), fd = fs.openSync(log, "wx");
  const command = { command: [process.execPath, "scripts/native-editor-motion-playwright.cjs", preparation],
    status: "RUNNING", startedAt: new Date().toISOString() };
  report.commands.push(command); save();
  worker = spawn(process.execPath, command.command.slice(1), { cwd: root, windowsHide: true,
    env: { ...process.env, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out }, stdio: ["ignore", fd, fd] });
  command.pid = worker.pid;
  command.exitCode = await new Promise((resolve, reject) => { worker.once("exit", resolve); worker.once("error", reject); });
  fs.closeSync(fd); command.finishedAt = new Date().toISOString(); command.status = command.exitCode === 0 ? "PASS" : "FAILED"; command.log = desc(log); save();
  assert.equal(command.exitCode, 0);
  const rawFile = path.join(out, "motion/report.json"); assert(fs.existsSync(rawFile));
  const raw = read(rawFile); report.raw = desc(rawFile); report.matrix = raw.matrix.length; report.errors = raw.errors; save();
  validateMatrix(raw, !full, false, scope);
  let traces = 0, frames = 0;
  for (const matrix of raw.matrix) for (const episode of matrix.episodes) {
    assert.equal(sha(episode.trace.path), episode.trace.sha256);
    const trace = JSON.parse(zlib.gunzipSync(fs.readFileSync(episode.trace.path)));
    verifyTrace(matrix, episode, trace, policy); traces++; frames += trace.frames.length;
  }
  for (const shot of raw.screenshots) {
    assert.equal(sha(shot.path), shot.sha256);
    const bytes = fs.readFileSync(shot.path);
    assert.equal(bytes.readUInt32BE(16), shot.before.width * shot.before.dpr);
    assert.equal(bytes.readUInt32BE(20), shot.before.height * shot.before.dpr);
  }
  report.audit = { status: "PASS", matrices: raw.matrix.length, traces, frames, screenshots: raw.screenshots.length };
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  try {
    assert(!worker || worker.exitCode !== null);
    await host?.stop("1.9.25 installed Editor motion smoke");
    if (cachePrepared) { cache("Restore"); report.cacheRestored = true; }
    assert.equal(listeners(report.cleanups.flatMap(c => c.ports || [])).length, 0);
    report.cleanupStatus = "PASS";
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, audit: report.audit, error: report.error, cleanupError: report.cleanupError }));
});
