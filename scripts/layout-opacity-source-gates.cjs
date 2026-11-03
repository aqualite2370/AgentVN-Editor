"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Layout-Opacity-Source-20261020-01";
const outRoot = path.join(root, "output/layout-opacity-source-20261020-01");
const phase = process.argv[2] ?? "check";
assert(["check", "dev"].includes(phase));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const attempt = process.env.AGENTVN_OPACITY_GATE_ATTEMPT ?? "01";
assert(/^\d{2}$/.test(attempt));
const evidence = process.env.AGENTVN_OPACITY_GREEN;
assert(evidence, "Explicit passing behavior required");
const behavior = read(evidence);
assert.equal(behavior.status, "PASS"); assert.equal(behavior.cleanup.status, "PASS");
assert.equal(behavior.modelRequests, 0); assert.equal(behavior.sources.length, 4);
assert.equal(sha(path.join(path.dirname(evidence), "executed-test.cjs")), behavior.testSha256);
for (const s of behavior.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
assert.equal(behavior.cases.length, phase === "check" ? 1 : 12);
for (const c of behavior.cases) {
  assert.equal(c.status, "PASS"); assert(c.checks.length >= 8 && c.checks.every(t => t.status === "PASS"));
  if (phase === "dev") {
    assert.equal(c.otherPages.length, 6); assert(c.checks.length >= 17);
    assert.equal(sha(c.portable.path), c.portable.sha256);
    assert.deepEqual(c.screenshot.before, c.screenshot.after);
    const png = fs.readFileSync(c.screenshot.path);
    assert.equal(sha(c.screenshot.path), c.screenshot.sha256);
    assert.equal(png.readUInt32BE(16), c.width * c.dpr); assert.equal(png.readUInt32BE(20), c.height * c.dpr);
  }
}
if (phase === "dev") {
  const prior = read(path.join(outRoot, "check-01/report.json"));
  assert.equal(prior.status, "PASS"); assert.deepEqual(prior.sources, behavior.sources);
}
const output = path.join(outRoot, `${phase}-${attempt}`);
assert(!fs.existsSync(output), "Keep every previous attempt");
fs.mkdirSync(output, { recursive: true });
const commands = phase === "check" ? [
  ...["layout-opacity-inheritance-test", "runtime-layout-profiles-test", "renpy-layout-runtime-test",
    "renpy-help-layout-test", "renpy-button-role-model-test", "renpy-gui-import-apply-test",
    "quick-menu-metrics-contract", "quick-menu-container-contract", "editor-workspace-contract"]
    .map(n => `node scripts/${n}.cjs`),
  "npm --prefix D:\\AgentVN\\editor run typecheck",
  "npm --prefix D:\\AgentVN\\editor run build",
  "npm --prefix D:\\AgentVN\\GameCli_framework run build",
] : ["powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1"];
const report = { status: "RUNNING", at: new Date().toISOString(), phase,
  scope: "Author inheritance display and unchanged Runtime material defaults; not installed Release",
  sources: behavior.sources, behavior: { path: evidence, sha256: sha(evidence) },
  commands: [], modelRequests: 0 };
let watcher;
if (phase === "dev") {
  report.devReplacement = { target: path.join(root, "AgentVN Dev.exe"),
    beforeSha256: sha(path.join(root, "AgentVN Dev.exe")), events: [] };
  watcher = fs.watch(root, (event, file) => {
    if (String(file).toLowerCase() === "agentvn dev.exe")
      report.devReplacement.events.push({ event, at: new Date().toISOString() });
  });
  watcher.on("error", e => { report.devReplacement.observerError = String(e); });
}
(async () => {
  for (const [i, command] of commands.entries()) {
    const logFile = path.join(output, `${String(i + 1).padStart(2, "0")}.log`), fd = fs.openSync(logFile, "wx");
    console.log(`START ${command}`);
    const child = spawn("powershell.exe", ["-NoProfile", "-Command",
      `$ErrorActionPreference='Stop'; ${command}; exit $LASTEXITCODE`],
    { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd], env: { ...process.env,
      AGENTVN_TEST_PROJECT: path.join(qa, "布局透明度 隔离小工程.vnproj"),
      AGENTVN_WORKSPACE_OUTPUT: path.join(qa, `gates-${phase}-${attempt}-${i + 1}`) } });
    const item = { command, logFile, pid: child.pid, startedAt: new Date().toISOString() };
    report.commands.push(item);
    item.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    }).finally(() => fs.closeSync(fd));
    item.finishedAt = new Date().toISOString(); item.status = item.exitCode === 0 ? "PASS" : "FAILED";
    console.log(`${item.status} ${command}`); assert.equal(item.exitCode, 0, `Gate failed: ${logFile}`);
  }
  for (const s of report.sources) assert.equal(sha(path.join(root, s.file)), s.sha256, "Product changed during gate");
  if (phase === "dev") {
    report.devReplacement.afterSha256 = sha(report.devReplacement.target);
    assert.equal(report.devReplacement.afterSha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert(report.devReplacement.events.length > 0 && !report.devReplacement.observerError);
  }
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  watcher?.close(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ phase, status: report.status, commands: report.commands.length, output }));
});
