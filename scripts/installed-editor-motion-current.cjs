"use strict";
// Actual installed Release only; reuse the full 16-path oracle, not Dev results.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const zlib = require("node:zlib"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { validateMatrix, verifyTrace } = require("./native-editor-motion-audit.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { policy } = require("./lib/installed-editor-motion-workspace-policy.cjs");
const root = path.resolve(__dirname, "..");
const { motionBinding } = require("./lib/installed-editor-motion-binding.cjs");
const currentBinding = motionBinding(process.argv.slice(3));
const explicitInstallation = process.argv.find(a => a.startsWith("--installed="))?.slice("--installed=".length);
if (explicitInstallation && !currentBinding) assert.equal(path.resolve(explicitInstallation),
  path.resolve("F:/AgentVN/QA/Editor-Repair-Release-20261024-01/installation.json"));
const qa = currentBinding?.qa || (explicitInstallation ? "F:/AgentVN/QA/Editor-Repair-Release-20261024-01"
  : "F:/AgentVN/QA/Installed-Editor-Motion-20261021-01");
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const current1922 = process.argv.includes("--current-1922"), smoke = process.argv.includes("--smoke");
for (const arg of process.argv.slice(3)) assert(["--current-1922", "--smoke"].includes(arg)
  || arg === `--installed=${explicitInstallation}`
  || currentBinding && arg === `--candidate=${currentBinding.version}`, `Unknown argument ${arg}`);
assert(!explicitInstallation || !current1922, "Use exactly one candidate selector");
const modern = current1922 || !!explicitInstallation;
assert(!smoke || modern, "Smoke mode requires explicit current candidate");
const out = path.join(qa, `${explicitInstallation ? "editor-motion" : "editor"}-${attempt}`); assert(!fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const installationFile = explicitInstallation || (current1922
  ? "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"
  : "F:/AgentVN/QA/Component-Preview-Release-20261021-02/installation.json");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const scope = "CURRENT_INSTALLED_RELEASE_EDITOR_MOTION_NOT_RUNTIME_OR_PHYSICAL";
const tools = ["scripts/installed-editor-motion-current.cjs", "scripts/native-editor-motion-playwright.cjs",
  "scripts/native-editor-motion-audit.cjs", "scripts/lib/installed-editor-motion-sampler.cjs",
  "scripts/lib/installed-editor-motion-workspace-policy.cjs",
  "scripts/lib/installed-release-session.cjs", "scripts/installed-layout-cache-session.ps1",
  "scripts/lib/installed-editor-motion-binding.cjs", "scripts/candidate-1930-exit.cjs",
  ...(currentBinding ? ["scripts/lib/installed-editor-motion-cache.cjs",
    "scripts/lib/installed-editor-motion-cache-test.cjs",
    "scripts/lib/candidate-1924-quick-adapter.cjs"] : [])];
const report = { status: "RUNNING", scope, startedAt: new Date().toISOString(), launches: [], cleanups: [],
  candidateVersion: currentBinding?.version || (explicitInstallation ? "1.9.23" : current1922 ? "1.9.22" : "1.9.16"), smoke,
  workspacePolicy: modern ? policy : "LEGACY_NO_INSPECTOR_OVERLAP",
  screenshots: [], errors: [], modelRequests: 0, productChanges: 0, builds: 0, deviceOperations: 0,
  commands: [], installation: desc(installationFile), tools: tools.map(p => desc(path.join(root, p))),
  protectedFiles: ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
    "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe"]
    .map(p => desc(path.join(root, p))),
  boundaries: ["Real installed WebView emulation, not physical 4K", "No native picker or physical close proof",
    "RAF sampler is not a cold-start performance benchmark", "Runtime animations are not tested here"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, worker, cachePrepared = false;
function cache(action) {
  let script = path.join(root, "scripts/installed-layout-cache-session.ps1");
  if (currentBinding) {
    const { buildCache } = require("./lib/installed-editor-motion-cache.cjs");
    const adapted = buildCache(fs.readFileSync(script, "utf8"));
    const executed = path.join(out, "executed-cache.ps1");
    if (action === "SelfTest") {
      fs.writeFileSync(executed, adapted.source, { flag: "wx" });
      report.cacheAdapter = { original: desc(script), executed: desc(executed), adaptations: adapted.adaptations };
      save();
    } else {
      assert.equal(sha(script), report.cacheAdapter.original.sha256);
      assert.equal(sha(executed), report.cacheAdapter.executed.sha256);
      assert.equal(fs.readFileSync(executed, "utf8"), adapted.source);
    }
    script = executed;
  }
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    script, "-Action", action, "-RunDirectory", out,
    ...(currentBinding ? ["-AllowedRunRoot", qa] : []),
    ...(modern ? ["-CodexCacheView"] : [])],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), result.stdout + result.stderr, { flag: "wx" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function unchanged() {
  for (const f of [...report.protectedFiles, ...report.tools, report.installation])
    assert.equal(sha(f.path), f.sha256, f.path);
}
(async () => {
  const receipt = read(installationFile);
  assert.equal(current1922 || currentBinding ? receipt.version : receipt.executable.version, report.candidateVersion);
  if (current1922) {
    assert.equal(receipt.executable.sha256, "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc");
    assert.equal(path.resolve(receipt.installRoot), path.resolve("F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis"));
    for (const original of [receipt.originalAudit, receipt.originalInstallation]) assert.equal(sha(original.path), original.sha256);
  }
  for (const p of tools) fs.copyFileSync(path.join(root, p), path.join(out, path.basename(p)), fs.constants.COPYFILE_EXCL);
  const input = path.join(out, "安装版 动效临时工程.vnproj");
  const project = fixture(`installed-editor-motion-20261021-${attempt}`);
  project.title = `安装版完整Editor动效回测 ${attempt}`;
  fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" }); report.input = desc(input);
  unchanged(); save(); cache("SelfTest"); cachePrepared = true; cache("Prepare");
  host = installedReleaseSession({ installationFile, out, report, save, input });
  await host.start();
  const prep = { scope, run: out, smoke, installationFile,
    ...(currentBinding ? { candidateVersion: currentBinding.version } : {}),
    ...(modern ? { workspacePolicy: policy } : {}),
    fixture: { input, title: project.title, projects: [{ input }] },
    launch: { executable: host.installation.executable.path,
      executableSha256: host.installation.executable.sha256,
      backendUrl: `http://127.0.0.1:${host.current.ports[0]}`, cdpPort: host.current.ports[1] } };
  const prepFile = path.join(out, "collector-preparation.json");
  fs.writeFileSync(prepFile, JSON.stringify(prep), { flag: "wx" });
  const log = path.join(out, "collector.log"), fd = fs.openSync(log, "wx");
  const command = { command: [process.execPath, "scripts/native-editor-motion-playwright.cjs", prepFile],
    startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(command); save();
  try {
    worker = spawn(process.execPath, command.command.slice(1), { cwd: root, windowsHide: true,
      env: { ...process.env, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out },
      stdio: ["ignore", fd, fd] });
    command.pid = worker.pid; save();
    command.exitCode = await new Promise((resolve, reject) => { worker.once("exit", resolve); worker.once("error", reject); });
    command.status = command.exitCode === 0 ? "PASS" : "FAILED";
  } finally { fs.closeSync(fd); command.finishedAt = new Date().toISOString(); command.log = desc(log); save(); }
  const rawFile = path.join(out, "motion/report.json");
  assert(fs.existsSync(rawFile), `Collector produced no evidence (exit ${command.exitCode}); see ${log}`);
  const raw = read(rawFile);
  report.raw = desc(rawFile); report.matrix = raw.matrix.length;
  report.failedEpisodes = raw.matrix.flatMap(m => m.episodes.filter(e => e.status !== "PASS")
    .map(e => ({ combination: m.key, episode: e.name, failures: e.checks.filter(c => c.status !== "PASS") })));
  report.matrixErrors = raw.matrix.filter(m => m.error).map(m => ({ key: m.key, error: m.error }));
  save();
  assert.equal(command.exitCode, 0, "Collector failed; preserve raw episodes and diagnostics");
  validateMatrix(raw, smoke, false, scope);
  assert.equal(raw.workspacePolicy, report.workspacePolicy);
  let frames = 0, traces = 0, assertions = 0;
  for (const m of raw.matrix) for (const e of m.episodes) {
    assert.equal(sha(e.trace.path), e.trace.sha256);
    const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
    assert.equal(t.frames.length, e.trace.frames); verifyTrace(m, e, t, modern ? policy : undefined);
    frames += t.frames.length; traces++; assertions += e.checks.length;
  }
  for (const s of raw.screenshots) {
    assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
    const bytes = fs.readFileSync(s.path);
    assert.equal(bytes.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
    assert.equal(bytes.readUInt32BE(20), Math.round(s.before.height * s.before.dpr));
  }
  assert.equal(traces, smoke ? 32 : 192); assert.equal(raw.screenshots.length, smoke ? 2 : 12);
  report.audit = { status: "PASS", frames, traces, assertions, pngs: raw.screenshots.length };
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); unchanged();
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    assert(!worker || worker.exitCode !== null, "Live collector must finish before cleanup");
    await host?.stop("Installed Editor motion finally; attributed teardown, not physical close");
    if (cachePrepared) { cache("Restore"); assert.equal(read(path.join(out, "native-cache-restoration.json")).status, "PASS"); report.cacheRestored = true; }
    const live = rows();
    assert(!(report.knownProcesses || []).some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
    const ports = report.cleanups.flatMap(c => c.ports);
    assert.equal(listeners(ports).length, 0); unchanged(); report.protectedUnchanged = true;
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, matrix: report.matrix, audit: report.audit,
    failedEpisodes: report.failedEpisodes?.map(e => `${e.combination}/${e.episode}`), error: report.error,
    cleanupError: report.cleanupError, out }, null, 2));
});
