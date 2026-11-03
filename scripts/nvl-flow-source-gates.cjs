"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/NVL-Flow-Source-20261020-01";
const result = path.join(root, "output/nvl-flow-source-20261020-01");
const [phase = "check"] = process.argv.slice(2);
assert(["check", "dev"].includes(phase));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const behaviorFile = process.env.AGENTVN_NVL_FLOW_GREEN;
assert(behaviorFile, "Explicit current full matrix required");
const behavior = read(behaviorFile);
assert.equal(behavior.status, "PASS"); assert.equal(behavior.cases.length, 48);
assert.equal(new Set(behavior.cases.map(c => c.key)).size, 48);
for (const c of behavior.cases) {
  assert.equal(c.status, "PASS");
  assert.equal(c.checks.length, c.scenario === "capacity-choices" ? 7 : c.layout === "agentvn" ? 6 : 3);
  assert(c.checks.every(t => t.status === "PASS"));
  assert.deepEqual(c.screenshot.before, c.screenshot.after);
  assert.deepEqual(c.screenshot.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
  assert.equal(sha(c.screenshot.path), c.screenshot.sha256);
  const png = fs.readFileSync(c.screenshot.path);
  assert.equal(png.readUInt32BE(16), c.width * c.dpr); assert.equal(png.readUInt32BE(20), c.height * c.dpr);
}
assert.equal(behavior.sources.length, 8);
function validateReport(r, reportFile) {
  assert.equal(r.status, "PASS"); assert.equal(r.cleanup.status, "PASS"); assert.equal(r.modelRequests, 0);
  assert.equal(sha(path.join(path.dirname(reportFile), "executed-test.cjs")), r.testSha256);
  for (const s of r.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
}
validateReport(behavior, behaviorFile);
const supplemental = ["nvl-regression-01", "nvl-authored-regression-01"].map(name => {
  const file = path.join(qa, name, "report.json"), r = read(file);
  validateReport(r, file);
  assert.equal(r.cases.length, name === "nvl-regression-01" ? 15 : 9);
  assert(r.cases.every(c => c.status === "PASS"));
  assert.deepEqual([...r.sources].sort((a, b) => a.file.localeCompare(b.file)),
    [...behavior.sources].sort((a, b) => a.file.localeCompare(b.file)));
  return { path: file, sha256: sha(file), cases: r.cases.length };
});
const attempt = process.env.AGENTVN_NVL_FLOW_GATE_ATTEMPT ?? "01";
assert(/^\d{2}$/.test(attempt), "A two-digit fresh attempt id is required");
const out = path.join(result, `${phase}-${attempt}`);
assert(!fs.existsSync(out), "Do not overwrite a gate");
if (phase === "dev") {
  const prior = read(path.join(result, "check-01/report.json"));
  assert.equal(prior.status, "PASS"); assert.deepEqual(prior.sources, behavior.sources);
}
fs.mkdirSync(out, { recursive: true });
const commands = phase === "check" ? [
  ...["nvl-runtime-acceptance", "installed-dialog-pagination-test", "dialogue-mode-layout-model-test",
    "dialogue-mode-layout-export-test", "quick-save-runtime-test", "quick-menu-metrics-contract",
    "quick-menu-container-contract", "runtime-screen-transition-contract", "editor-workspace-contract"]
    .map(name => [`node scripts/${name}.cjs`, {}]),
  ["node scripts/dialog-presentation-inheritance-test.cjs",
    { AGENTVN_WORKSPACE_OUTPUT: path.join(qa, "inheritance-01") }],
  ["npm --prefix D:\\AgentVN\\editor run typecheck", {}],
  ["npm --prefix D:\\AgentVN\\editor run build", {}],
  ["npm --prefix D:\\AgentVN\\GameCli_framework run build", {}],
] : [["powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1", {}]];
const report = { status: "RUNNING", phase, at: new Date().toISOString(), layer: "GameCLI Runtime",
  sources: behavior.sources, behavior: { path: behaviorFile, sha256: sha(behaviorFile) },
  supplemental, commands: [], modelRequests: 0 };
const target = path.join(root, "AgentVN Dev.exe");
let watcher;
if (phase === "dev") {
  report.devReplacement = { target, beforeSha256: sha(target), events: [] };
  watcher = fs.watch(root, (event, file) => {
    if (String(file).toLowerCase() === "agentvn dev.exe")
      report.devReplacement.events.push({ event, at: new Date().toISOString() });
  });
  watcher.on("error", e => { report.devReplacement.observerError = String(e); });
}
(async () => {
  for (const [index, [command, env]] of commands.entries()) {
    const logFile = path.join(out, `${String(index + 1).padStart(2, "0")}.log`), fd = fs.openSync(logFile, "wx");
    console.log(`START ${command}`);
    const child = spawn("powershell.exe", ["-NoProfile", "-Command",
      `$ErrorActionPreference='Stop'; ${command}; exit $LASTEXITCODE`],
    { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", fd, fd] });
    const item = { command, env, logFile, pid: child.pid, startedAt: new Date().toISOString() };
    report.commands.push(item);
    item.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    }).finally(() => fs.closeSync(fd));
    item.finishedAt = new Date().toISOString(); item.status = item.exitCode === 0 ? "PASS" : "FAILED";
    console.log(`${item.status} ${command}`);
    assert.equal(item.exitCode, 0, `Required gate failed; Dev prohibited: ${logFile}`);
  }
  if (phase === "dev") {
    report.devReplacement.afterSha256 = sha(target);
    assert.equal(sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), sha(target));
    assert(report.devReplacement.events.length > 0 && !report.devReplacement.observerError);
  }
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  watcher?.close(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ phase, status: report.status, commands: report.commands.length, out }));
});
