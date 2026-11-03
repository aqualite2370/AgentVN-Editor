"use strict";
// Frozen behavior receipts must match current sources before any Dev build.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Runtime-Gallery-Repair-20261020-01";
const run = process.argv[2] || "gates-01"; assert(/^gates-\d{2}$/.test(run));
const browserRun = process.argv[3] || "browser-03", stateRun = process.argv[4] || "state-04";
assert(/^browser-\d{2}$/.test(browserRun) && /^state-\d{2}$/.test(stateRun));
const withDev = process.argv.includes("--dev");
const sessionOnly = process.argv.includes("--session");
const out = path.join(qa, run); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedAt: fs.statSync(f).mtime.toISOString() });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", at: new Date().toISOString(), commands: [],
  scope: "SOURCE_REGRESSION_BUILDS_AND_OPTIONAL_DEV_NOT_RELEASE_INSTALL", sessionOnly, error: null };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function command(label, exe, args) {
  const row = { label, executable: exe, args, status: "RUNNING", startedAt: new Date().toISOString() };
  report.commands.push(row); save();
  const log = path.join(out, `${String(report.commands.length).padStart(2, "0")}.log`);
  const fd = fs.openSync(log, "wx");
  let result;
  try { result = spawnSync(exe, args, { cwd: root, env: process.env, windowsHide: true,
    stdio: ["ignore", fd, fd], timeout: 1800000 }); } finally { fs.closeSync(fd); }
  row.exitCode = result.status; row.error = result.error ? String(result.error) : null;
  row.log = desc(log); row.finishedAt = new Date().toISOString();
  row.status = result.status === 0 && !result.error ? "PASS" : "FAILED"; save();
  console.log(`${row.status}: ${label}`);
  assert.equal(row.status, "PASS", `${label} failed; inspect ${log}`);
}
try {
  fs.copyFileSync(__filename, path.join(out, path.basename(__filename)), fs.constants.COPYFILE_EXCL);
  report.beforeProducts = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
    "editor/src-tauri/binaries/agentvn-player.exe"].map(f => desc(path.join(root, f)));
  report.receipts = [browserRun, stateRun].map(n => {
    const file = path.join(qa, n, "report.json"), r = read(file);
    assert.equal(r.status, "PASS"); assert.equal(r.error, null);
    assert(r.cases.length > 0 && r.cases.every(c => c.status === "PASS"));
    for (const source of r.productSources) assert.equal(sha(source.path), source.sha256);
    return desc(file);
  });
  const browser = read(report.receipts[0].path), state = read(report.receipts[1].path);
  assert.equal(browser.cases.length, sessionOnly ? 4 : 8); assert.equal(browser.matrix.length, sessionOnly ? 0 : 24);
  assert(browser.matrix.every(c => c.status === "PASS")); assert.equal(browser.cleanupError, null);
  assert.equal(browser.ownedServiceStopped, true); assert.deepEqual(browser.pageErrors, []);
  assert.equal(state.cases.length, 8);
  if (sessionOnly) {
    assert.equal(browser.rollbackRequired, true); assert.equal(state.rollbackRequired, true);
    assert(browser.cases.every(c => c.rollbackRoundTrips?.length === 2));
    assert(state.cases.filter(c => c.entry !== "title_menu").every(c => c.rollback?.roundTrip === true));
  }
  process.env.AGENTVN_TEST_PROJECT = browser.isolation.AGENTVN_TEST_PROJECT;
  process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  process.env.TEMP = path.join(out, "temporary"); process.env.TMP = process.env.TEMP;
  fs.mkdirSync(process.env.TEMP);
  report.isolation = { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT,
    AGENTVN_WORKSPACE_OUTPUT: out, temporary: process.env.TEMP };
  for (const name of ["gallery-manifest-test", "gallery-anchor-runtime-test", "quick-save-runtime-test",
    "runtime-exit-flow-test", "runtime-system-back-test", "runtime-screen-transition-contract",
    "editor-runtime-resource-wiring-contract", "editor-workspace-contract",
    ...(sessionOnly ? ["playback-session-checkpoint-test", "gamecli-rollback-contract", "nvl-runtime-acceptance", "bubble-placement-contract"] : [])]) {
    command(name, process.execPath, [path.join(root, `scripts/${name}.cjs`)]);
  }
  for (const [folder, action] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]]) {
    command(`${folder} ${action}`, "cmd.exe", ["/d", "/s", "/c", `npm --prefix D:\\AgentVN\\${folder} run ${action}`]);
  }
  if (withDev) {
    command("Complete Dev build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.afterProducts = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
      "editor/src-tauri/binaries/agentvn-player.exe", "GameCli_framework/src-tauri/target/release/agentvn-player.exe"]
      .map(f => desc(path.join(root, f)));
    assert.equal(report.afterProducts[0].sha256, report.afterProducts[1].sha256);
    assert.equal(report.afterProducts[2].sha256, report.afterProducts[3].sha256);
    assert.notEqual(report.afterProducts[0].sha256, report.beforeProducts[0].sha256);
    assert(Date.parse(report.afterProducts[0].modifiedAt) >= Date.parse(report.at));
    report.resourcePairs = ["src/store/runtimeStore.ts", "src/components/shell/GalleryScreen.tsx", "src/styles/shell.css",
      ...(sessionOnly ? ["src/engine/StoryEngine.ts"] : [])]
      .map(relative => {
        const source = desc(path.join(root, "GameCli_framework", relative));
        const bundled = desc(path.join(root, "editor/src-tauri/bundle-workspace/GameCli_framework", relative));
        assert.equal(source.sha256, bundled.sha256);
        return { source, bundled };
      });
  }
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
}
