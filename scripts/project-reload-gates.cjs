"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Project-Reload-20261019-01";
const [phase = "check"] = process.argv.slice(2);
assert(["check", "dev"].includes(phase));
const output = path.join(root, `output/project-reload-20261019-01/${phase}-01`);
assert(!fs.existsSync(output), "Do not overwrite historical logs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sources = [
  "editor/src/components/advanced/PreviewWindowControls.tsx", "editor/src/store/editorStore.ts",
].map(file => ({ file, sha256: sha(path.join(root, file)) }));
const core = read(path.join(qa, "green-03/report.json"));
const lifetime = read(path.join(qa, "lifetime-02/report.json"));
assert(core.finishedAt && lifetime.finishedAt, "Do not certify in-progress results");
const matrix = core.cases.filter(row => row.name === "legacy-shared-divergence");
const controlled = core.cases.filter(row => row.name !== "legacy-shared-divergence" && !row.name.startsWith("unmount-"));
assert.equal(matrix.length, 12);
assert.equal(new Set(matrix.map(row => `${row.width}:${row.height}:${row.dpr}:${row.motion}`)).size, 12);
assert.equal(controlled.length, 9);
assert.equal(core.cases.length, 23);
assert.equal(new Set(controlled.map(row => row.name)).size, 9);
assert([...matrix, ...controlled].every(row => row.status === "PASS"));
assert.deepEqual(core.cases.filter(row => row.status !== "PASS").map(row => row.name).sort(),
  ["unmount-late-error", "unmount-late-success"]);
assert(core.cases.filter(row => row.status !== "PASS").every(row =>
  row.error?.includes("page.waitForFunction: Timeout")), "Only the documented diagnostic harness failures may be superseded");
// The original full run used an invalid diagnostic harness. Its two FAILED
// rows remain unchanged; both exact lifetime scenarios were rerun separately.
assert.equal(lifetime.subset, "component-lifetime-only");
assert.equal(lifetime.status, "PASS");
assert.deepEqual(lifetime.cases.map(row => row.name).sort(), ["unmount-late-error", "unmount-late-success"]);
assert(lifetime.cases.every(row => row.status === "PASS" && row.diagnostics.some(log =>
  log.context?.operation === "reload-project" && log.context?.stale === true)));
for (const result of [core, lifetime]) {
  assert.equal(result.modelSubmissions, 0);
  assert.deepEqual(result.cleanupSurvivors, []);
}
for (const row of matrix) {
  assert(row.geometry.inside && row.geometry.hit && row.geometry.overflow <= 1);
  assert.equal(sha(row.screenshot.path), row.screenshot.sha256);
  const png = fs.readFileSync(row.screenshot.path);
  assert.equal(png.readUInt32BE(16), row.width * row.dpr);
  assert.equal(png.readUInt32BE(20), row.height * row.dpr);
}
if (phase === "dev") {
  const previous = read(path.join(root, "output/project-reload-20261019-01/check-01/report.json"));
  assert.equal(previous.status, "PASS");
  assert.deepEqual(sources, previous.sources, "Product code changed after regression/build gates");
}
fs.mkdirSync(output, { recursive: true });
const commands = phase === "check" ? [
  "node scripts/project-reload-generation-test.cjs",
  "node scripts/project-state-save-order-test.cjs",
  "node scripts/preview-entry-path-test.cjs",
  "node scripts/editor-workspace-contract.cjs",
  "node scripts/gamecli-preview-progress-ui-contract.cjs",
  "node scripts/gamecli-preview-directory-contract.cjs",
  "node scripts/gamecli-preview-protocol-contract.cjs",
  "npm --prefix D:\\AgentVN\\editor run typecheck",
  "npm --prefix D:\\AgentVN\\editor run build",
  "npm --prefix D:\\AgentVN\\GameCli_framework run build",
] : ["powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1"];
const report = { status: "RUNNING", phase, startedAt: new Date().toISOString(), sources,
  behavior: { matrix: 12, controlled: 9, lifetime: 2,
    coreReport: path.join(qa, "green-03/report.json"),
    lifetimeReport: path.join(qa, "lifetime-02/report.json"),
    originalHarnessFailuresPreserved: true }, commands: [] };
(async () => {
  for (const [index, command] of commands.entries()) {
    console.log(`Running ${command}`);
    const logFile = path.join(output, `${String(index + 1).padStart(2, "0")}.log`);
    const log = fs.openSync(logFile, "wx");
    const child = spawn("powershell.exe", ["-NoProfile", "-Command",
      `$ErrorActionPreference='Stop'; ${command}; exit $LASTEXITCODE`],
    { cwd: root, stdio: ["ignore", log, log], windowsHide: true });
    const item = { command, pid: child.pid, logFile, startedAt: new Date().toISOString() };
    report.commands.push(item);
    item.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    }).finally(() => fs.closeSync(log));
    item.finishedAt = new Date().toISOString();
    item.status = item.exitCode === 0 ? "PASS" : "FAILED";
    if (item.status !== "PASS") throw Error(`Gate failed: ${command}; see ${logFile}`);
  }
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
});
