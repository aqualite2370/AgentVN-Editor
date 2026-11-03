"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/r2-runtime-flow-gates", runId);
fs.mkdirSync(output, { recursive: true });
const input = path.join(output, "isolated-r2.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture(`r2-gates-${runId}`), null, 2));
const files = ["shared/cartridge/quickMenuMetrics.ts", "GameCli_framework/src/components/player/DialogBox.tsx",
  "GameCli_framework/src/components/player/PlaybackControls.tsx", "GameCli_framework/src/engine/StoryEngine.ts",
  "editor/src/styles/quick-menu-preview.css"];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { runId, status: "RUNNING", scope: "R2-source-browser-and-Dev-not-installed-or-Android",
  output, input, checks: [], sources: files.map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
function matrixEvidence(file, runtime) {
  assert(file, "Explicit completed report path is required; do not select historical reports automatically");
  const fullPath = path.resolve(file), value = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  assert.equal(value.status, "PASS", fullPath);
  assert.equal(value.cases.length, runtime ? 288 : 36, "Complete current matrix is required");
  assert(value.cases.every(c => c.status === "PASS"));
  const keys = new Map();
  for (const c of value.cases) {
    assert(desktopViewports.some(([w, h]) => c.width === w && c.height === h));
    const key = [c.width, c.height, c.dpr, c.reduced, ...(runtime ? [c.mobile, c.authored] : [])].join(":");
    keys.set(key, (keys.get(key) ?? 0) + 1);
  }
  assert.equal(keys.size, runtime ? 48 : 12);
  assert([...keys.values()].every(count => count === (runtime ? 6 : 3)));
  if (runtime) assert.equal(value.pageErrors.length, 0);
  return { path: fullPath, sha256: sha(fullPath), status: value.status, cases: value.cases.length, owner: value.owner };
}
async function execute(label, command, args) {
  const log = path.join(output, `${String(report.checks.length + 1).padStart(2, "0")}-${label}.log`);
  const env = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: path.join(output, `${label}-workspace`),
    AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd" };
  const item = { label, command: [command, ...args], env, log, status: "RUNNING", startedAt: new Date().toISOString() };
  report.checks.push(item); persist(); console.log(`START ${label}`);
  item.exitCode = await new Promise(resolve => {
    const stream = fs.createWriteStream(log, { flags: "wx" });
    const child = spawn(command, args, { cwd: root, windowsHide: true,
      env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", data => stream.write(data));
    child.stderr.on("data", data => stream.write(data));
    child.on("error", error => { item.error = String(error); stream.write(String(error)); });
    child.on("close", code => stream.end(() => resolve(code)));
  });
  item.status = item.exitCode === 0 ? "PASS" : "FAILED"; item.finishedAt = new Date().toISOString();
  persist(); console.log(`${item.status} ${label}`);
  assert.equal(item.exitCode, 0, `Required R2 gate failed: ${label}; Dev prohibited`);
}
const test = name => execute(name, process.execPath, [`scripts/${name}.cjs`]);
const npm = (prefix, task) => execute(`${prefix}-${task}`, "cmd.exe", ["/d", "/s", "/c", `npm --prefix D:\\AgentVN\\${prefix} run ${task}`]);
(async () => {
  report.runtime = matrixEvidence(process.argv[2], true);
  report.editorPreview = matrixEvidence(process.argv[3], false);
  for (const name of ["quick-menu-metrics-contract", "quick-menu-container-contract", "quick-menu-size-parity-contract",
    "quick-menu-authored-position-recovery-contract", "quick-menu-collapse-contract", "quick-menu-preview-redesign-contract",
    "runtime-layout-quick-menu-controls-contract", "android-runtime-layout-contract", "runtime-save-queue-test",
    "runtime-exit-flow-test", "runtime-system-back-test", "runtime-window-close-test", "runtime-terminal-save-test",
    "live-scene-preview-engine-test", "quick-save-runtime-test", "quick-save-policy-test",
    "gamecli-rollback-contract", "dialog-presentation-inheritance-test"]) await test(name);
  await execute("android-runtime-viewport-test", process.execPath, ["scripts/android-runtime-viewport-test.mjs"]);
  await npm("editor", "typecheck"); await npm("editor", "build"); await npm("GameCli_framework", "build");
  await test("editor-workspace-contract"); await test("editor-workspace-playwright");
  if (process.argv.includes("--deliver-dev")) {
    const dev = path.join(root, "AgentVN Dev.exe");
    const before = { sha256: sha(dev), modifiedAt: fs.statSync(dev).mtime.toISOString() };
    fs.copyFileSync(dev, path.join(output, "AgentVN Dev-before.exe"), fs.constants.COPYFILE_EXCL);
    await execute("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    report.dev = { path: dev, before, sha256: sha(dev), modifiedAt: fs.statSync(dev).mtime.toISOString(),
      compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
      pendingExists: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
    assert.equal(report.dev.sha256, report.dev.compiledSha256);
    assert.notEqual(report.dev.modifiedAt, before.modifiedAt, "Root Dev must actually be replaced");
    assert.equal(report.dev.pendingExists, false, "Pending file does not count as delivery");
    report.resources = collectStageResourceEvidence(root, files);
    report.player = { path: path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"),
      sha256: sha(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")),
      builtSha256: sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")) };
    assert.equal(report.player.sha256, report.player.builtSha256);
    await execute("quick-menu-bundle-contract", process.execPath, ["scripts/quick-menu-metrics-contract.cjs", "--check-bundle"]);
  }
  assert(report.checks.length >= 18 && report.checks.every(c => c.status === "PASS"));
  report.status = process.argv.includes("--deliver-dev") ? "R2_SOURCE_AND_DEV_PASS" : "R2_SOURCE_PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
}).finally(() => { persist(); console.log(`Evidence: ${path.join(output, "report.json")}`); });
