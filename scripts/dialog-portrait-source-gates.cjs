"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Dialog-Portrait-Source-20261019-01";
const resultRoot = path.join(root, "output/dialog-portrait-source-20261020-01");
const [phase = "check"] = process.argv.slice(2);
assert(["check", "dev"].includes(phase));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const greenFile = process.env.AGENTVN_DIALOG_PORTRAIT_GREEN;
const extendedFile = process.env.AGENTVN_DIALOG_PORTRAIT_EXTENDED;
assert(greenFile && extendedFile, "Explicit full current behavior and extended reports required");
const green = read(greenFile), extended = read(extendedFile);
assert.equal(green.status, "PASS"); assert.equal(green.placement, "name-left");
assert.equal(green.cases.length, 24); assert.equal(new Set(green.cases.map(c => c.key)).size, 24);
assert(green.cases.every(c => c.status === "PASS" && c.checks.length === 9
  && c.checks.every(t => t.status === "PASS")));
assert.equal(extended.status, "PASS"); assert.equal(extended.variants.length, 8);
assert(extended.variants.every(c => c.status === "PASS" && c.checks.length >= 2
  && c.checks.every(t => t.status === "PASS")));
for (const r of [green, extended]) {
  assert.equal(r.cleanup.status, "PASS"); assert.equal(r.modelRequests, 0);
  const reportFile = r === green ? greenFile : extendedFile;
  assert.equal(r.testSha256, sha(path.join(path.dirname(reportFile), "executed-test.cjs")));
  assert(r.sources.length === 3);
  r.sources.forEach(s => assert.equal(sha(path.join(root, s.file)), s.sha256));
}
assert.deepEqual(green.sources, extended.sources);
const out = path.join(resultRoot, `${phase}-01`);
assert(!fs.existsSync(out), "Never overwrite an existing gate");
if (phase === "dev") {
  const previous = read(path.join(resultRoot, "check-01/report.json"));
  assert.equal(previous.status, "PASS"); assert.deepEqual(previous.sources, green.sources);
}
fs.mkdirSync(out, { recursive: true });
const commands = phase === "check" ? [
  ...["installed-dialog-portrait-oracle-test", "installed-dialog-pagination-test",
    "dialogue-mode-layout-model-test", "dialogue-mode-layout-export-test",
    "quick-menu-metrics-contract", "quick-menu-container-contract",
    "runtime-screen-transition-contract", "editor-workspace-contract"]
    .map(name => [`node scripts/${name}.cjs`, {}]),
  ["node scripts/dialog-presentation-inheritance-test.cjs",
    { AGENTVN_WORKSPACE_OUTPUT: path.join(qa, "inheritance-01") }],
  ["npm --prefix D:\\AgentVN\\editor run typecheck", {}],
  ["npm --prefix D:\\AgentVN\\editor run build", {}],
  ["npm --prefix D:\\AgentVN\\GameCli_framework run build", {}],
] : [["powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1", {}]];
const report = { status: "RUNNING", phase, at: new Date().toISOString(), layer: "GameCLI Runtime",
  sources: green.sources, behavior: { path: greenFile, sha256: sha(greenFile) },
  extended: { path: extendedFile, sha256: sha(extendedFile) }, commands: [], modelRequests: 0 };
const target = path.join(root, "AgentVN Dev.exe");
let observer;
if (phase === "dev") {
  report.devReplacement = { target, beforeSha256: sha(target), events: [] };
  observer = fs.watch(root, (event, filename) => {
    if (String(filename).toLowerCase() === "agentvn dev.exe")
      report.devReplacement.events.push({ event, at: new Date().toISOString() });
  });
  observer.on("error", error => { report.devReplacement.observerError = String(error); });
}
(async () => {
  for (const [i, [command, env]] of commands.entries()) {
    const logFile = path.join(out, `${String(i + 1).padStart(2, "0")}.log`);
    const fd = fs.openSync(logFile, "wx");
    console.log(`START ${command}`);
    const child = spawn("powershell.exe", ["-NoProfile", "-Command",
      `$ErrorActionPreference='Stop'; ${command}; exit $LASTEXITCODE`],
    { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", fd, fd] });
    const item = { command, env, logFile, pid: child.pid, startedAt: new Date().toISOString() };
    report.commands.push(item);
    item.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    }).finally(() => fs.closeSync(fd));
    item.finishedAt = new Date().toISOString();
    item.status = item.exitCode === 0 ? "PASS" : "FAILED";
    console.log(`${item.status} ${command}`);
    assert.equal(item.exitCode, 0, `Required gate failed; Dev prohibited: ${logFile}`);
  }
  if (phase === "dev") {
    report.devReplacement.afterSha256 = sha(target);
    assert.equal(sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), sha(target));
    assert(report.devReplacement.events.length > 0 && !report.devReplacement.observerError,
      "Root Dev overwrite was not observed");
  }
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  observer?.close(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ phase, status: report.status, commands: report.commands.length, out, error: report.error }));
});
