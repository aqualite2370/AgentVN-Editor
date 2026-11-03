"use strict";
// Current sealed install; controlled network failures, not natural outages,
// native pickers, default-profile or clean-machine claims.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), zlib = require("node:zlib");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Editor-Motion-20261021-01";
const attempt = process.argv[2] || "07"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const installationFile = "F:/AgentVN/QA/Component-Preview-Release-20261021-02/installation.json";
const baselineFile = "F:/AgentVN/QA/Installed-Components-20261021-01/editor-08/report.json";
assert.equal(sha(baselineFile), "49efb535c8986d5f46d4782130690fdc7d7479beb72d0bc3178b25f1de1e7a2a");
const scope = "CURRENT_INSTALLED_RELEASE_EDITOR_CONTROLLED_MODULE_NETWORK_FAULTS";
const tools = ["scripts/installed-editor-loading-current.cjs", "scripts/installed-editor-loading-playwright.cjs",
  "scripts/lib/installed-editor-motion-sampler.cjs", "scripts/lib/installed-release-session.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/installed-layout-cache-session.ps1"];
const report = { status: "RUNNING", scope, startedAt: new Date().toISOString(), launches: [], cleanups: [],
  screenshots: [], errors: [], modelRequests: 0, productChanges: 0, builds: 0, commands: [],
  protectedFiles: read(baselineFile).protectedFiles, tools: tools.map(p => desc(path.join(root, p))),
  installation: desc(installationFile), controlledFaults: true, nativePickerClaim: false };
let host, worker, cachePrepared = false;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function unchanged() {
  for (const f of [...report.protectedFiles, ...report.tools, report.installation]) assert.equal(sha(f.path), f.sha256, f.path);
}
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), r.stdout + r.stderr, { flag: "wx" }); assert.equal(r.status, 0);
}
(async () => {
  unchanged(); save();
  for (const t of tools) fs.copyFileSync(path.join(root, t), path.join(out, path.basename(t)), fs.constants.COPYFILE_EXCL);
  const input = path.join(out, "加载故障 临时工程.vnproj"), project = fixture(`installed-editor-loading-${attempt}`);
  project.title = `安装版加载故障回测 ${attempt}`;
  fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" }); report.input = desc(input);
  cache("SelfTest"); cachePrepared = true; cache("Prepare");
  host = installedReleaseSession({ installationFile, out, report, save, input }); await host.start();
  const target = path.join(out, "flow-01"), prepFile = path.join(out, "loading-preparation.json");
  fs.writeFileSync(prepFile, JSON.stringify({ scope, run: out, installationFile,
    fixture: { input, sha256: sha(input), title: project.title, projectId: project.project_id },
    launch: { ...host.current, installRoot: host.installation.installRoot,
      backendPort: host.current.ports[0], cdpPort: host.current.ports[1] } }), { flag: "wx" });
  const fd = fs.openSync(path.join(out, "collector.log"), "wx");
  const command = { command: [process.execPath, "scripts/installed-editor-loading-playwright.cjs", target],
    startedAt: new Date().toISOString() };
  report.commands.push(command); save();
  try {
    worker = spawn(process.execPath, command.command.slice(1), { cwd: root, windowsHide: true,
      env: { ...process.env, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: target,
        AGENTVN_INSTALLED_LOADING_PREPARATION: prepFile }, stdio: ["ignore", fd, fd] });
    command.pid = worker.pid; command.exitCode = await new Promise((resolve, reject) => {
      worker.once("exit", resolve); worker.once("error", reject);
    });
  } finally { fs.closeSync(fd); command.finishedAt = new Date().toISOString(); save(); }
  const rawFile = path.join(target, "report.json"), raw = read(rawFile); report.raw = desc(rawFile);
  report.featureStatus = raw.status; save(); assert.equal(command.exitCode, 0); assert.equal(raw.status, "PASS");
  assert.equal(raw.scope, scope); assert.equal(raw.matrix.length, 12); assert.equal(raw.timeoutCases.length, 2);
  let frames = 0, episodes = 0;
  for (const group of [...raw.matrix, ...raw.timeoutCases]) {
    assert.equal(group.status, "PASS"); assert(group.episodes.length > 0);
    assert((group.checks || []).every(c => c.status === "PASS"));
    for (const e of group.episodes) {
      assert.equal(e.status, "PASS"); assert(e.checks.length > 0 && e.checks.every(c => c.status === "PASS"));
      assert.equal(sha(e.trace.path), e.trace.sha256);
      const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
      assert(data.frames.length >= 3 && data.frames.length === e.trace.frames && !data.limitReached);
      assert(data.inputs.some(i => i.trusted));
      assert(data.frames.every(f => !f.pageHidden && f.width === group.width && f.height === group.height
        && Math.abs(f.dpr - group.dpr) <= 1e-6 && f.reduced === group.reduced));
      frames += data.frames.length; episodes++;
    }
  }
  assert.equal(episodes, 26); assert.equal(raw.screenshots.length, 26);
  for (const s of raw.screenshots) {
    assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
    const b = fs.readFileSync(s.path);
    assert.equal(b.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
    assert.equal(b.readUInt32BE(20), Math.round(s.before.height * s.before.dpr));
  }
  assert(raw.timeoutCases.every(c => c.checks[0].detail.elapsedMs >= 29000));
  assert.equal(raw.pageErrors.length, 0); assert.equal(raw.forbiddenRequests.length, 0);
  assert(raw.transport.filter(t => t.mode === "abort" && t.aborted).length >= 12);
  assert(raw.transport.filter(t => t.mode === "hold").length >= 14);
  assert(raw.transport.filter(t => t.mode === "hold").every(t => t.releasedAt && !t.releaseError));
  assert.equal(report.modelRequests, 0); unchanged();
  report.audit = { frames, episodes, pngs: raw.screenshots.length }; report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    assert(!worker || worker.exitCode !== null);
    await host?.stop("Installed loading finally; attributed teardown, not physical close");
    if (cachePrepared) { cache("Restore"); assert.equal(read(path.join(out, "native-cache-restoration.json")).status, "PASS"); report.cacheRestored = true; }
    unchanged(); report.protectedUnchanged = true;
    const live = rows(); assert(!(report.knownProcesses || []).some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
    assert.equal(listeners(report.cleanups.flatMap(c => c.ports)).length, 0);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, featureStatus: report.featureStatus, audit: report.audit,
    error: report.error, cleanupError: report.cleanupError, out }, null, 2));
});
