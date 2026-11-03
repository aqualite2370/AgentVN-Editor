"use strict";
// One complete display-preference repair group: evidence, linked regressions,
// ordered builds and real Dev/native/bundled-byte provenance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, ".."), [attempt, matrixFile] = process.argv.slice(2);
assert.match(attempt || "", /^\d{2}$/); assert(matrixFile && fs.existsSync(matrixFile));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedUtc: fs.statSync(f).mtime.toISOString() });
const base = "F:/AgentVN/QA/Settings-Rendering-20261029-01", out = path.join(base, `gates-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), commands: [], modelRequests: 0,
  scope: "SOURCE_DISPLAY_PREFERENCES_LINKED_NARRATIVE_AND_DEV_NOT_INSTALLED_ANDROID_OR_NEW_LISTENING",
  matrix: desc(matrixFile), sources: ["GameCli_framework/src/components/player/DialogBox.tsx",
    "GameCli_framework/src/styles/player.css"].map(f => desc(path.join(root, f))) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(label, exe, args, extra = {}) {
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary, { recursive: true });
  const row = { label, command: [exe, ...args], log: path.join(out, `${label}.log`),
    status: "RUNNING", startedAt: new Date().toISOString(), env: extra };
  report.commands.push(row); save(); console.log(`START ${label}`);
  const fd = fs.openSync(row.log, "wx");
  try {
    const env = { ...process.env, TEMP: temporary, TMP: temporary,
      AGENTVN_TEST_PROJECT: path.join(out, "isolated-small.vnproj"),
      AGENTVN_WORKSPACE_OUTPUT: path.join(out, `${label}-evidence`), ...extra };
    if (exe === "powershell.exe") env.PSModulePath = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules");
    const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, 0, row.log); row.status = "PASS";
  } catch (e) { row.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); row.logIdentity = desc(row.log); save(); console.log(`${row.status} ${label}`); }
}
const node = (label, args = [], env) => command(label, process.execPath, [`scripts/${label}.cjs`, ...args], env);
(async () => {
  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const matrix = read(matrixFile);
  assert.equal(matrix.status, "PASS"); assert.equal(matrix.cases.length, 192); assert.equal(matrix.screenshots.length, 96);
  assert.equal(matrix.cleanup.status, "PASS"); assert.deepEqual(matrix.pageErrors, []);
  assert(matrix.cases.every(c => c.status === "PASS" && c.assertions.length === 5 && c.assertions.every(a => a.status === "PASS")));
  assert.equal(new Set(matrix.cases.map(c => [c.layout, c.width, c.dpr, c.reduced, c.mode, c.authored].join("/"))).size, 192);
  for (const layout of ["agentvn", "renpy"]) for (const width of [1920, 2560, 3840])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) for (const mode of ["dialog", "nvl", "bubble", "centered"])
      for (const authored of [false, true]) assert(matrix.cases.some(c => c.layout === layout && c.width === width
        && c.height === width * 9 / 16 && c.dpr === dpr && c.reduced === reduced && c.mode === mode && c.authored === authored));
  for (const s of matrix.sources) { assert.equal(sha(s.path), s.sha256); if (s.snapshot) assert.equal(sha(s.snapshot), s.sha256); }
  for (const s of matrix.screenshots) {
    assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
    const c = matrix.cases.find(c => !c.authored && path.basename(s.path) === `${c.layout}-${c.width}-${c.dpr}-${c.reduced}-${c.mode}.png`);
    assert(c); assert.deepEqual(s.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
    const png = fs.readFileSync(s.path); assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);
    assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr);
  }
  report.red = desc(path.join(base, "red-04/report.json"));
  const red = read(report.red.path); assert.equal(red.status, "FAILED"); assert.equal(red.cases.length, 12);
  assert(red.cases.every(c => !c.error && c.assertions.some(a => a.status === "FAILED")));
  const narrativeAttempt = String(8 + Number(attempt)).padStart(2, "0");
  await node("narrative-geometry-source-playwright", [narrativeAttempt, "--matrix"]);
  const narrativeFile = `F:/AgentVN/QA/Narrative-Geometry-Source-20261024-01/run-${narrativeAttempt}/report.json`;
  const narrative = read(narrativeFile); assert.equal(narrative.status, "PASS"); assert.equal(narrative.cases.length, 48);
  report.narrative = desc(narrativeFile);
  await command("nvl-default", process.execPath, ["scripts/nvl-page-playwright.cjs"], { AGENTVN_NVL_PAGE_OUTPUT: path.join(out, "nvl-default"),
    PROFILE_DPR: "1", PROFILE_REDUCED: "", AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd" });
  await command("nvl-authored", process.execPath, ["scripts/nvl-page-playwright.cjs", "--authored-layout", "--case=compact"], {
    AGENTVN_NVL_PAGE_OUTPUT: path.join(out, "nvl-authored"), PROFILE_DPR: "2", PROFILE_REDUCED: "1",
    AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd" });
  for (const [dir, count] of [["nvl-default", 15], ["nvl-authored", 9]]) {
    const file = path.join(out, dir, "report.json"), r = read(file);
    assert.equal(r.status, "PASS"); assert.equal(r.cases.length, count); assert.equal(r.cleanup.status, "PASS");
    (report.nvl ??= []).push(desc(file));
  }
  for (const label of ["nvl-runtime-acceptance", "installed-dialog-pagination-test",
    "dialog-presentation-inheritance-test", "dialogue-mode-layout-model-test", "dialogue-mode-layout-export-test",
    "runtime-save-queue-test", "runtime-exit-flow-test", "runtime-terminal-save-test", "runtime-system-back-test",
    "quick-save-runtime-test", "editor-workspace-contract"]) await node(label);
  await node("editor-forward-version-test", [path.join(out, "version-forward.json")]);
  for (const label of ["package-version-contract", "package-version-encoding-regression-test", "installer-payload-provenance-test"])
    await node(label);
  const checkpoint = path.join("F:/AgentVN/Checkpoints/Settings-Effects-20261029-01", `before-dev-${attempt}`);
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
  report.before = [];
  for (const file of ["AgentVN Dev.exe", "GameCli_framework/src-tauri/target/release/agentvn-player.exe"]) {
    const source = desc(path.join(root, file)), copy = path.join(checkpoint, path.basename(file));
    fs.copyFileSync(source.path, copy, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(copy), source.sha256); report.before.push({ source, copy: desc(copy) });
  }
  for (const [prefix, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
    await command(`${prefix}-${task}`, "cmd.exe", ["/d", "/s", "/c", `npm --prefix D:\\AgentVN\\${prefix} run ${task}`]);
  await command("full-dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
  report.dev = desc(path.join(root, "AgentVN Dev.exe"));
  assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
  assert(new Date(report.dev.modifiedUtc) >= new Date(report.commands.at(-1).startedAt));
  report.nativePlayer = desc(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe"));
  assert.equal(report.nativePlayer.sha256, sha(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")));
  report.resources = collectStageResourceEvidence(root, report.sources.map(s => path.relative(root, s.path).replaceAll("\\", "/")));
  await node("editor-installed-version-resources-test");
  for (const s of report.sources) assert.equal(sha(s.path), s.sha256);
  assert(report.commands.length >= 18 && report.commands.every(c => c.status === "PASS"));
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
