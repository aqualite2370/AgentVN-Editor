"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Layout-Opacity-Split-20261020-01";
const [mode, attempt = "01"] = process.argv.slice(2); assert(["check", "dev"].includes(mode)); assert(/^\d{2}$/.test(attempt));
const out = path.join(qa, `${mode}-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  generatedAt: fs.statSync(file).mtime.toISOString() });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", at: new Date().toISOString(), mode, commands: [], modelRequests: 0,
  scope: "OPACITY_SOURCE_REGRESSION_AND_DEV_ONLY_NOT_RELEASE_INSTALL" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(label, exe, args) {
  const logFile = path.join(out, `${String(report.commands.length + 1).padStart(2, "0")}.log`), fd = fs.openSync(logFile, "wx");
  const row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save(); console.log(`START ${label}`);
  const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd], env: {
    ...process.env, AGENTVN_TEST_PROJECT: path.join(qa, "分层透明度 隔离小工程.vnproj"),
    AGENTVN_WORKSPACE_OUTPUT: path.join(out, `test-${report.commands.length}`),
  } });
  row.pid = child.pid;
  try { row.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); }); }
  finally { fs.closeSync(fd); row.log = desc(logFile); row.finishedAt = new Date().toISOString(); }
  row.status = row.exitCode === 0 ? "PASS" : "FAILED"; save(); console.log(`${row.status} ${label}`);
  assert.equal(row.status, "PASS", `Gate failed: ${logFile}`);
}
function receipt(env, fallback) {
  const file = process.env[env] || fallback, value = read(file);
  assert.equal(value.status, "PASS", file); assert.equal(value.cleanup?.status, "PASS", "Owned source service must be stopped");
  assert.equal(value.modelRequests, 0);
  assert(value.sources?.length > 0); for (const s of value.sources) assert.equal(sha(path.join(root, s.file)), s.sha256, `Stale source: ${s.file}`);
  return { ...desc(file), value };
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  if (mode === "check") {
    const author = receipt("AGENTVN_OPACITY_AUTHOR_REPORT", path.join(qa, "browser-matrix-06/report.json"));
    const runtime = receipt("AGENTVN_OPACITY_RUNTIME_REPORT", path.join(qa, "runtime-green-07/report.json"));
    const portable = receipt("AGENTVN_OPACITY_PORTABLE_REPORT", path.join(qa, "source-roundtrip-02/report.json"));
    assert.equal(author.value.cases.length, 1); const business = author.value.cases[0];
    assert.equal(business.status, "PASS"); assert.equal(business.pages.length, 7);
    assert(business.persistedAndReopened && business.agentvn && business.staticTitle && business.independentReset);
    assert.equal(author.value.matrix.length, 12);
    assert.equal(new Set(author.value.matrix.map(c => `${c.width}/${c.dpr}/${c.motion}`)).size, 12);
    for (const c of author.value.matrix) {
      assert.equal(c.status, "PASS"); assert.equal(c.pages.length, 7);
      for (const page of c.pages.filter(p => ["save_grid", "gallery_grid"].includes(p.id))) {
        assert(page.actual.children.length >= 6);
        for (const child of page.actual.children) {
          assert(child.rect.top >= page.actual.rect.top - 1 && child.rect.bottom <= page.actual.rect.bottom + 1,
            `${c.width}/${page.id}: all entries must remain inside the visible grid`);
        }
      }
      const p = fs.readFileSync(c.screenshot.path);
      assert.equal(sha(c.screenshot.path), c.screenshot.sha256);
      assert.deepEqual(c.screenshot.before, c.screenshot.after);
      assert.equal(p.readUInt32BE(16), c.width * c.dpr); assert.equal(p.readUInt32BE(20), c.height * c.dpr);
    }
    assert.equal(runtime.value.cases.length, 14);
    assert(runtime.value.cases.every(c => c.status === "PASS" && c.matrix.length === 12 && c.matrix.every(m => m.status === "PASS")));
    assert.equal(portable.value.cases.length, 1);
    assert(portable.value.cases.every(c => c.status === "PASS" && c.checks.length >= 17
      && c.checks.every(t => t.status === "PASS") && c.portable?.sha256));
    const oldPath = process.env.AGENTVN_OPACITY_OLD_REPORT
      || "F:/AgentVN/QA/Native-Runtime-State-20261020-01/opacity-old-03/report.json", old = read(oldPath);
    assert.equal(old.status, "PASS"); assert.equal(old.cleanupError, null); assert.equal(old.cases.length, 3);
    assert(old.cases.every(c => c.status === "PASS"));
    assert(old.cases.filter(c => c.type !== "control").every(c => c.refusedBeforePlay
      && ["LEGACY_STYLE_VALIDATION_BEFORE_VERSION_PROMPT", "MINIMUM_RUNTIME_VERSION"].includes(c.refusalStage)));
    report.oldMinimumVersionPrompt = old.cases.filter(c => c.type !== "control").map(c => ({
      type: c.type, stage: c.refusalStage, minimumVersionPrompt: c.minimumVersionPrompt || "PASS",
    }));
    assert.equal(read(path.join(path.dirname(oldPath), "profile-restoration.json")).status, "PASS");
    report.behavior = [author, runtime, portable].map(({ value, ...file }) => file);
    report.oldRuntime = desc(oldPath); report.sources = author.value.sources;
    for (const name of ["layout-opacity-split-test", "layout-opacity-inheritance-test", "runtime-layout-profiles-test",
      "renpy-layout-runtime-test", "renpy-help-layout-test", "renpy-button-role-model-test", "renpy-gui-import-apply-test",
      "ui-skin-legacy-compat-contract", "ui-skin-style-component-health-contract", "gallery-manifest-test",
      "runtime-exit-flow-test", "runtime-system-back-test", "runtime-screen-transition-contract",
      "quick-menu-metrics-contract", "quick-menu-container-contract", "editor-workspace-contract"])
      await command(name, process.execPath, [`scripts/${name}.cjs`]);
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
      await command(`${folder} ${task}`, process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
  } else {
    const previousFile = process.env.AGENTVN_OPACITY_CHECK_REPORT || path.join(qa, "check-01/report.json"), previous = read(previousFile);
    assert.equal(previous.status, "PASS"); assert.equal(previous.commands.length, 19);
    assert(previous.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    report.sources = previous.sources; for (const s of report.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
    report.precondition = desc(previousFile);
    report.before = desc(path.join(root, "AgentVN Dev.exe"));
    await command("Complete Dev build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
      "editor/src-tauri/binaries/agentvn-player.exe", "GameCli_framework/src-tauri/target/release/agentvn-player.exe"]
      .map(f => desc(path.join(root, f)));
    assert.equal(report.products[0].sha256, report.products[1].sha256);
    assert.equal(report.products[2].sha256, report.products[3].sha256);
    assert.notEqual(report.products[0].sha256, report.before.sha256);
    assert(Date.parse(report.products[0].generatedAt) >= Date.parse(report.at));
    report.bundled = report.sources.filter(s => /^(shared\/|GameCli_framework\/)/.test(s.file)).map(s => {
      const target = path.join(root, "editor/src-tauri/bundle-workspace", s.file);
      assert.equal(sha(target), s.sha256); return { source: s.file, ...desc(target) };
    });
  }
  for (const s of report.sources) assert.equal(sha(path.join(root, s.file)), s.sha256, "Source changed during gate");
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
