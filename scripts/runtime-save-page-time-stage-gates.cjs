"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), phase = process.argv[2], attempt = process.argv[3];
assert(["checkpoint", "support", "build"].includes(phase)); assert.equal(attempt, "01");
const base = "F:/AgentVN/QA/Runtime-SavePage-Time-20261024-01";
const checkpoint = "F:/AgentVN/Checkpoints/Runtime-SavePage-Time-20261024-01";
const out = phase === "checkpoint" ? checkpoint : path.join(base, `${phase}-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedUtc: fs.statSync(f).mtime.toISOString() });
const openingBuild = read("F:/AgentVN/QA/Runtime-Opening-Time-20261024-01/build-02/report.json");
const sources = ["GameCli_framework/src/components/shell/SavePageTransition.tsx",
  "GameCli_framework/src/components/shell/SaveLoadScreen.tsx", "GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/styles/variables.css", "GameCli_framework/src/components/common/OpeningScreen.tsx"];
const report = { status: "RUNNING", phase, startedAt: new Date().toISOString(), commands: [], modelRequests: 0,
  scope: "SAVE_PAGE_CSS_TIME_UNITS_NOT_INSTALLATION_OR_ANDROID",
  frozen: openingBuild.frozen, sources: sources.map(f => desc(path.join(root, f))) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function unchanged(files) { for (const f of files) assert.equal(sha(f.path), f.sha256, f.path); }
async function command(label, exe, args) {
  const row = { label, command: [exe, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
    log: path.join(out, label + ".log") }; report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd],
      env: { ...process.env,
        AGENTVN_TEST_PROJECT: "F:/AgentVN/QA/Project-Directory-Write-20261024-01/red-02/isolated-small.vnproj",
        AGENTVN_WORKSPACE_OUTPUT: out } });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, 0, row.log); row.status = "PASS";
  } catch (error) { row.status = "FAILED"; throw error; }
  finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  save(); unchanged(report.frozen);
  const openingAuditFile = "F:/AgentVN/QA/Runtime-Opening-Time-20261024-01/native-audit-01/report.json";
  const openingAudit = read(openingAuditFile);
  assert.equal(openingAudit.status, "PASS"); assert.equal(openingAudit.cases.length, 32);
  report.openingNativeEvidence = desc(openingAuditFile);
  // The previous repair and its clock/curve are outside this product change.
  unchanged(openingBuild.sources.filter(s => /OpeningScreen\.tsx$|shell\.css$|variables\.css$/.test(s.path)));
  if (phase === "checkpoint") {
    const red = read(path.join(base, "red-01/report.json"));
    assert.equal(red.status, "FAILED");
    assert.equal(red.cases.filter(c => c.spelling === "production-seconds" && c.status === "FAILED").length, 2);
    assert(red.cases.filter(c => c.spelling === "milliseconds").every(c => c.status === "PASS"));
    assert.equal(sha(red.source.path), red.source.sha256);
    report.copies = [];
    for (const relative of [...sources, "AGENTS.md", "plans/ACTIVE_TASKS.md",
      "plans/FULL_REGRESSION_20261017.md", "scripts/runtime-save-page-time-unit-regression.cjs",
      "scripts/runtime-save-page-time-stage-gates.cjs", "scripts/runtime-screen-polish-playwright.cjs"]) {
      const source = path.join(root, relative), copy = path.join(out, "files", relative);
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
      report.copies.push({ source: desc(source), copy: desc(copy) });
    }
    for (const file of [openingBuild.dev, openingBuild.player]) {
      const copy = path.join(out, path.basename(file.path));
      assert.equal(sha(file.path), file.sha256); fs.copyFileSync(file.path, copy, fs.constants.COPYFILE_EXCL);
      report.copies.push({ source: desc(file.path), copy: desc(copy) });
    }
    fs.writeFileSync(path.join(out, "tracked.patch"), execFileSync("git",
      ["-c", "core.safecrlf=false", "diff", "--binary", "HEAD"],
      { cwd: root, maxBuffer: 192 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }), { flag: "wx" });
    unchanged(report.copies.map(c => c.copy));
  } else {
    const saved = read(path.join(checkpoint, "report.json")); assert.equal(saved.status, "PASS");
    unchanged(saved.copies.map(c => c.copy));
    if (phase === "support") {
      await command("same-component-green", process.execPath,
        ["scripts/runtime-save-page-time-unit-regression.cjs", "green-01"]);
      await command("runtime-pagination-matrix", process.execPath,
        ["scripts/runtime-screen-polish-playwright.cjs", "matrix-02", "--matrix", "--motion-supplement"]);
      const matrixFile = "F:/AgentVN/QA/Runtime-Screen-Polish-20261022-01/matrix-02/report.json", matrix = read(matrixFile);
      assert.equal(matrix.status, "PASS"); assert.equal(matrix.cases.length, 48);
      assert(matrix.cases.every(c => c.status === "PASS"));
      assert.equal(matrix.contexts.length, 24);
      assert(matrix.contexts.every(c => c.closed && JSON.stringify(c.before) === JSON.stringify(c.after)));
      report.matrix = desc(matrixFile);
      for (const file of ["runtime-save-queue-test", "runtime-exit-flow-test", "runtime-screen-transition-contract"])
        await command(file, process.execPath, [`scripts/${file}.cjs`]);
    } else {
      const support = read(path.join(base, "support-01/report.json"));
      assert.equal(support.status, "PASS"); assert.equal(support.commands.length, 5);
      assert(support.commands.every(c => c.status === "PASS" && c.exitCode === 0));
      unchanged(support.sources); unchanged([support.matrix]);
      await command("editor-typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run typecheck"]);
      await command("editor-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run build"]);
      await command("gamecli-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
      await command("full-dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
      report.dev = desc(path.join(root, "AgentVN Dev.exe"));
      report.player = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
      assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
      assert.equal(report.player.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
      report.bundled = report.sources.map(source => {
        const copy = desc(path.join(root, "editor/src-tauri/bundle-workspace", path.relative(root, source.path)));
        assert.equal(copy.sha256, source.sha256); return copy;
      });
    }
  }
  unchanged(report.sources); unchanged(report.frozen); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, phase, out, commands: report.commands.length, error: report.error }));
});
