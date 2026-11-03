"use strict";
// A command exit is process evidence only, never a substitute for behavior reports.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const [runArg, label, command, ...args] = process.argv.slice(2);
assert(runArg && /^[a-z0-9-]+$/.test(label || "") && command,
  "node full-regression-command.cjs <run-root> <unique-label> <command> [...args]");
const runRoot = path.resolve(runArg);
assert(runRoot.startsWith(path.join(root, "output", "full-regression-")));
assert.equal(JSON.parse(fs.readFileSync(path.join(runRoot, "checkpoint/manifest.json"))).status, "PASS");
const output = path.join(runRoot, "commands", label);
assert(!fs.existsSync(output), "Use a new label for every attempt; keep failures");
fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", scope: "COMMAND_EXIT_NOT_COMPLETE_FUNCTIONAL_ACCEPTANCE",
  startedAt: new Date().toISOString(), command: [command, ...args], cwd: root,
  stdout: path.join(output, "stdout.log"), stderr: path.join(output, "stderr.log") };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const stdout = fs.createWriteStream(report.stdout, { flags: "wx" });
const stderr = fs.createWriteStream(report.stderr, { flags: "wx" });
let displayedBytes = 0;
function display(stream, data) {
  // Preserve full raw logs, but do not flood the conversation with installer
  // listings or thousands of geometry rows.
  const remaining = Math.max(0, 8192 - displayedBytes);
  if (remaining) stream.write(data.subarray(0, remaining));
  displayedBytes += data.length;
  if (remaining && data.length > remaining)
    process.stdout.write(`\n[Further command output retained in ${output}]\n`);
}
const fixture = path.join(output, "isolated-small.vnproj");
fs.copyFileSync(path.join(root, "scripts/fixtures/editor-isolated-small.vnproj"), fixture, fs.constants.COPYFILE_EXCL);
const environment = { ...process.env, AGENTVN_TEST_PROJECT: fixture,
  AGENTVN_WORKSPACE_OUTPUT: path.join(output, "workspace"), AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd",
  PROFILE_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]",
  EXIT_VIEWPORTS: "1920x1080,2560x1440,3840x2160" };
report.isolation = { project: fixture, output: environment.AGENTVN_WORKSPACE_OUTPUT };
save();
(async () => {
  const child = spawn(command, args, { cwd: root, env: environment, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"] });
  report.pid = child.pid; save();
  child.stdout.on("data", data => { stdout.write(data); display(process.stdout, data); });
  child.stderr.on("data", data => { stderr.write(data); display(process.stderr, data); });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  Object.assign(report, result);
  report.status = result.exitCode === 0 ? "PASS" : "FAILED";
  process.exitCode = result.exitCode === 0 ? 0 : 1;
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  await Promise.all([new Promise(resolve => stdout.end(resolve)), new Promise(resolve => stderr.end(resolve))]);
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, evidence: path.join(output, "report.json") }));
});
