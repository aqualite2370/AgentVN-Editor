"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { root, qa, out, sources, sha } = require("./layout-resources-source-test.cjs");
const phase = process.argv[2]; assert(["check", "dev"].includes(phase));
const attempt = process.env.AGENTVN_RESOURCES_GATE_ATTEMPT || "01"; assert(/^\d{2}$/.test(attempt));
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const evidenceFile = process.env.AGENTVN_RESOURCES_GREEN; assert(evidenceFile);
const behavior = read(evidenceFile);
assert.equal(behavior.status, "PASS"); assert.equal(behavior.cleanup.status, "PASS"); assert.equal(behavior.modelRequests, 0);
assert.equal(behavior.cases.length, phase === "dev" ? 12 : 1);
assert(behavior.cases.every(c => c.status === "PASS" && c.checks.length === 7 && c.checks.every(t => t.status === "PASS")));
for (const s of behavior.sources) assert.equal(sha(fs.readFileSync(path.join(root, s.file))), s.sha256);
if (phase === "dev") {
  const prior = read(path.join(out, "check-02/report.json"));
  assert.equal(prior.status, "PASS"); assert(prior.commands.every(c => c.exitCode === 0));
  assert.deepEqual(prior.sources, behavior.sources);
  for (const c of behavior.cases) {
    assert.equal(c.cartridges.length, 3); assert(c.portable.reimported);
    assert.equal(sha(fs.readFileSync(c.portable.path)), c.portable.sha256);
    for (const artifact of c.cartridges) assert.equal(sha(fs.readFileSync(artifact.path)), artifact.sha256);
  }
  const playerFile = process.env.AGENTVN_RESOURCES_PLAYER; assert(playerFile);
  const player = read(playerFile);
  assert.equal(player.status, "PASS"); assert.equal(player.cleanup.status, "PASS");
  assert.equal(player.cases.length, 24); assert.equal(player.modelRequests, 0);
  assert(player.cases.every(c => c.status === "PASS" && c.checks.length === 3 && c.checks.every(t => t.status === "PASS")));
  assert.equal(player.source.sha256, sha(fs.readFileSync(evidenceFile)));
}
const output = path.join(out, `${phase}-${attempt}`); assert(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
const commands = phase === "check" ? [
  `node scripts/layout-resources-source-test.cjs ${path.join(output, "direct-extended.json")} --extended`,
  `node scripts/layout-resources-font-reference-test.cjs ${path.join(output, "font-reference.json")}`,
  ...["runtime-layout-profiles-test", "custom-component-project-export-test", "dialogue-mode-layout-export-test",
    "renpy-gui-import-apply-test", "layout-opacity-inheritance-test", "native-cartridge-image-path-regression",
    "opening-audio-contract", "camera-cartridge-compatibility-test", "editor-workspace-contract"]
    .map(name => `node scripts/${name}.cjs`),
  "npm --prefix D:\\AgentVN\\editor run typecheck",
  "npm --prefix D:\\AgentVN\\editor run build",
  "npm --prefix D:\\AgentVN\\GameCli_framework run build",
] : ["powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1"];
const report = { status: "RUNNING", at: new Date().toISOString(), phase, sources: behavior.sources,
  behavior: { path: evidenceFile, sha256: sha(fs.readFileSync(evidenceFile)) }, commands: [], modelRequests: 0 };
let watcher;
if (phase === "dev") {
  report.devReplacement = { path: path.join(root, "AgentVN Dev.exe"),
    beforeSha256: sha(fs.readFileSync(path.join(root, "AgentVN Dev.exe"))), events: [] };
  watcher = fs.watch(root, (event, file) => {
    if (String(file).toLowerCase() === "agentvn dev.exe") report.devReplacement.events.push({ event, at: new Date().toISOString() });
  });
  watcher.on("error", error => { report.devReplacement.observerError = String(error); });
}
(async () => {
  for (const [i, command] of commands.entries()) {
    const logFile = path.join(output, `${String(i + 1).padStart(2, "0")}.log`), fd = fs.openSync(logFile, "wx");
    console.log(`START ${command}`);
    const child = spawn("powershell.exe", ["-NoProfile", "-Command",
      `$ErrorActionPreference='Stop'; ${command}; exit $LASTEXITCODE`], {
      cwd: root, windowsHide: true, stdio: ["ignore", fd, fd], env: { ...process.env,
        AGENTVN_TEST_PROJECT: path.join(qa, "双布局资源 隔离小工程.vnproj"),
        AGENTVN_WORKSPACE_OUTPUT: path.join(qa, `gates-${phase}-${attempt}-${i + 1}`),
      },
    });
    const item = { command, logFile, pid: child.pid, startedAt: new Date().toISOString() }; report.commands.push(item);
    item.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); })
      .finally(() => fs.closeSync(fd));
    item.finishedAt = new Date().toISOString(); item.status = item.exitCode === 0 ? "PASS" : "FAILED";
    console.log(`${item.status} ${command}`); assert.equal(item.exitCode, 0, `Failed gate: ${logFile}`);
  }
  for (const file of sources) assert.equal(sha(fs.readFileSync(path.join(root, file))),
    report.sources.find(s => s.file === file).sha256);
  if (phase === "dev") {
    report.devReplacement.afterSha256 = sha(fs.readFileSync(report.devReplacement.path));
    assert.equal(report.devReplacement.afterSha256,
      sha(fs.readFileSync(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"))));
    assert(report.devReplacement.events.length && !report.devReplacement.observerError);
  }
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  watcher?.close(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, phase, commands: report.commands.length, output }));
});
