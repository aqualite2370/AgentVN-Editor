"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Runtime-Interactions-20261019-01";
const [phase = "check"] = process.argv.slice(2);
assert(["check", "dev"].includes(phase));
const fullReport = process.env.AGENTVN_RUNTIME_INTERACTIONS_GREEN;
assert(fullReport, "An explicit complete current green report is required");
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const green = read(fullReport);
assert.equal(green.status, "PASS"); assert.equal(green.cases.length, 24);
assert.equal(new Set(green.cases.map(c => c.key)).size, 24);
assert(green.cases.every(c => c.status === "PASS"
  && c.episodes.length === (c.layout === "agentvn" ? 5 : 4)
  && c.episodes.every(e => e.status === "PASS")));
assert.equal(green.cleanup.status, "PASS");
const out = path.join(root, `output/runtime-interactions-20261019-01/${phase}-01`);
assert(!fs.existsSync(out), "Never overwrite a previous gate");
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const sources = [
  "GameCli_framework/src/components/common/Modal.tsx", "GameCli_framework/src/utils/runtimeModalPresentation.ts",
  "GameCli_framework/src/app/App.tsx", "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
  "GameCli_framework/src/store/runtimeStore.ts", "GameCli_framework/src/utils/runtimeSystemBack.ts",
  "GameCli_framework/src/styles/quick-menu-contract.css",
].map(file => ({ file, sha256: sha(path.join(root, file)) }));
assert.equal(green.sourceHashes.length, sources.length);
for (const s of sources) assert.equal(green.sourceHashes.find(t => t.file === s.file)?.sha256, s.sha256,
  `Source changed since the passing behavior run: ${s.file}`);
if (phase === "dev") {
  const check = read(path.join(root, "output/runtime-interactions-20261019-01/check-01/report.json"));
  assert.equal(check.status, "PASS"); assert.deepEqual(sources, check.sources);
}
fs.mkdirSync(out, { recursive: true });
const commands = phase === "check" ? [
  ...["runtime-system-back-test", "runtime-exit-flow-test", "runtime-save-queue-test",
    "runtime-window-close-test", "runtime-screen-transition-contract", "main-menu-exit-contract",
    "quick-menu-metrics-contract", "quick-menu-container-contract", "editor-workspace-contract"]
    .map(name => [`node scripts/${name}.cjs`, {}]),
  ["node scripts/runtime-exit-behavior-playwright.cjs", {
    EXIT_VIEWPORTS: "1920x1080,2560x1440,3840x2160", PROFILE_DPR: "1",
    AGENTVN_RUNTIME_EXIT_OUTPUT: path.join(qa, "exit-safety-01"),
  }],
  ["node scripts/runtime-menu-motion-playwright.cjs", {
    RUNTIME_MOTION_VIEWPORTS: "1080p,1440p,4k", RUNTIME_MOTION_DPR: "1",
    RUNTIME_MOTION_REDUCED: "", AGENTVN_RUNTIME_MENU_MOTION_OUTPUT: path.join(qa, "menu-rules-01"),
  }],
  ["npm --prefix D:\\AgentVN\\editor run typecheck", {}],
  ["npm --prefix D:\\AgentVN\\editor run build", {}],
  ["npm --prefix D:\\AgentVN\\GameCli_framework run build", {}],
] : [["powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1", {}]];
const report = { status: "RUNNING", phase, at: new Date().toISOString(), sources,
  green: { path: fullReport, sha256: sha(fullReport), combinations: 24 }, commands: [] };
// Copy-Item may preserve the source binary's timestamp when only external
// Runtime resources changed. Observe the actual root-target write instead of
// requiring an unrelated Rust host hash/mtime change to prove replacement.
const rootDev = path.join(root, "AgentVN Dev.exe");
let devWatcher;
if (phase === "dev") {
  report.devReplacement = { beforeSha256: sha(rootDev), target: rootDev, events: [] };
  devWatcher = fs.watch(root, (event, filename) => {
    if (String(filename).toLowerCase() === "agentvn dev.exe")
      report.devReplacement.events.push({ event, at: new Date().toISOString() });
  });
  devWatcher.on("error", error => { report.devReplacement.observerError = String(error); });
}
(async () => {
  for (const [i, [command, env]] of commands.entries()) {
    console.log(`START ${command}`);
    const logFile = path.join(out, `${String(i + 1).padStart(2, "0")}.log`), fd = fs.openSync(logFile, "wx");
    const child = spawn("powershell.exe", ["-NoProfile", "-Command",
      `$ErrorActionPreference='Stop'; ${command}; exit $LASTEXITCODE`],
    { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", fd, fd] });
    const item = { command, env, pid: child.pid, startedAt: new Date().toISOString(), logFile };
    report.commands.push(item);
    item.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    }).finally(() => fs.closeSync(fd));
    item.finishedAt = new Date().toISOString(); item.status = item.exitCode === 0 ? "PASS" : "FAILED";
    assert.equal(item.exitCode, 0, `Required gate failed; Dev prohibited: ${logFile}`);
  }
  if (phase === "dev") {
    report.devReplacement.afterSha256 = sha(rootDev);
    assert(report.devReplacement.events.length > 0 && !report.devReplacement.observerError,
      "Root Dev replacement was not observed");
  }
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  devWatcher?.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
});
