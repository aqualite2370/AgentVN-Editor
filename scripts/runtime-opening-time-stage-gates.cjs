"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), phase = process.argv[2], attempt = process.argv[3];
assert(["checkpoint", "support", "build"].includes(phase));
assert(["01", "02", "03"].includes(attempt)); assert(phase !== "checkpoint" || attempt === "01");
assert(attempt !== "03" || phase === "support");
const base = "F:/AgentVN/QA/Runtime-Opening-Time-20261024-01";
const checkpoint = "F:/AgentVN/Checkpoints/Runtime-Opening-Time-20261024-01";
const out = phase === "checkpoint" ? checkpoint : path.join(base, `${phase}-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedUtc: fs.statSync(f).mtime.toISOString() });
const installed = read("F:/AgentVN/QA/Editor-Repair-Release-20261024-01/installation.json");
const report = { status: "RUNNING", phase, at: new Date().toISOString(), commands: [],
  scope: "OPENING_TIME_UNIT_REPAIR_NOT_NEW_INSTALLER_ACCEPTANCE", modelRequests: 0,
  frozen: [installed.executable, ...installed.resources, ...installed.protectedFiles] };
const reportFile = path.join(out, "report.json"), save = () =>
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const sources = ["GameCli_framework/src/components/common/OpeningScreen.tsx",
  "GameCli_framework/src/components/common/BootAnimation.tsx", "GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/styles/variables.css", "GameCli_framework/src/app/App.tsx",
  "GameCli_framework/src/app/RuntimeScreenNavigator.tsx"];
function unchanged(files) { for (const f of files) assert.equal(sha(f.path), f.sha256, f.path); }
async function command(label, exe, args) {
  const c = { label, command: [exe, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
    log: path.join(out, `${label}.log`) };
  report.commands.push(c); save();
  const fd = fs.openSync(c.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
    c.pid = child.pid; save();
    c.exitCode = await new Promise((resolve, reject) => { child.once("close", resolve); child.once("error", reject); });
    assert.equal(c.exitCode, 0, c.log); c.status = "PASS";
  } catch (e) { c.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  save(); unchanged(report.frozen);
  if (phase === "checkpoint") {
    const nativeFile = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/opening-installed-1923-01/report.json";
    const native = read(nativeFile);
    assert.equal(native.status, "FAILED"); assert(native.finishedAt && !native.cleanupError);
    assert.equal(native.cases.length, 32);
    assert(native.launches.every(l => l.cleanup?.status === "PASS"));
    assert.equal(read(native.profileRestoration.path).status, "PASS");
    const red = path.join(base, "red-02/report.json"), r = read(red);
    assert.equal(r.status, "FAILED");
    assert.equal(r.cases.filter(c => c.status === "FAILED" && c.spelling === "production-seconds").length, 2);
    assert(r.cases.filter(c => c.spelling === "milliseconds").every(c => c.status === "PASS"));
    report.failureEvidence = [desc(nativeFile), desc(red)];
    report.copies = [];
    for (const relative of [...sources, "AGENTS.md", "plans/ACTIVE_TASKS.md",
      "plans/FULL_REGRESSION_20261017.md", "scripts/runtime-opening-playwright.cjs",
      "scripts/runtime-opening-time-unit-regression.cjs", "scripts/runtime-opening-time-stage-gates.cjs"]) {
      const source = path.join(root, relative), target = path.join(out, "files", relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      report.copies.push({ source: desc(source), copy: desc(target) });
    }
    for (const [name, file] of [["root-dev.exe", "AgentVN Dev.exe"],
      ["bundled-player.exe", "editor/src-tauri/binaries/agentvn-player.exe"]]) {
      const source = path.join(root, file), target = path.join(out, name);
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      report.copies.push({ source: desc(source), copy: desc(target) });
    }
    fs.writeFileSync(path.join(out, "tracked.patch"), execFileSync("git",
      ["-c", "core.safecrlf=false", "diff", "--binary", "HEAD"],
      { cwd: root, maxBuffer: 192 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }), { flag: "wx" });
    assert(report.copies.every(c => c.source.sha256 === c.copy.sha256));
  } else {
    const saved = read(path.join(checkpoint, "report.json")); assert.equal(saved.status, "PASS");
    unchanged(saved.copies.map(c => c.copy));
    report.sources = sources.map(f => desc(path.join(root, f)));
    if (phase === "support" && attempt === "03") {
      const basisFile = path.join(base, "support-02/report.json"), basis = read(basisFile);
      assert.equal(basis.status, "FAILED"); unchanged(basis.sources);
      report.boundaries = basis.boundaries;
      report.basis = desc(basisFile);
      await command("runtime-interruption-followup", process.execPath,
        ["scripts/runtime-opening-playwright.cjs", "matrix-07", "--interrupt-only", "--d3d11"]);
      await command("independent-32-flow-audit", process.execPath,
        ["scripts/runtime-opening-source-evidence-audit.cjs", "01"]);
      const auditFile = path.join(base, "source-evidence-audit-01/report.json"), audit = read(auditFile);
      assert.equal(audit.status, "PASS"); assert.equal(audit.cases.length, 32);
      report.validatedEvidence = [desc(auditFile), ...audit.evidence];
      report.effectiveCases = audit.cases.length;
    } else if (phase === "support") {
      if (attempt === "02") {
        // Keep support01/matrix05 FAILED. The new acceptance environment must
        // disclose and verify the real GPU; do not relax either frame assertion.
        const failed = read(path.join(base, "support-01/report.json"));
        assert.equal(failed.status, "FAILED");
        report.previousFailure = desc(path.join(base, "support-01/report.json"));
        const diagnosticFile = "F:/AgentVN/QA/Runtime-Opening-20261023-01/green-07/report.json";
        const diagnostic = read(diagnosticFile);
        assert.equal(diagnostic.status, "PASS"); assert.equal(diagnostic.cases.length, 1);
        assert.equal(diagnostic.renderer.features.gpu_compositing, "enabled");
        assert.equal(diagnostic.cases[0].presented.before.reduced, true);
        assert.equal(diagnostic.cases[0].presented.after.reduced, true);
        unchanged(diagnostic.sources.map(f => ({ ...f, path: path.join(root, f.file) })));
        report.diagnostic = desc(diagnosticFile);
        report.boundaries = [
          "Hardware-accelerated source browser acceptance, not software-renderer performance certification",
          "Original software-rendered matrix05 and later diagnostic failures remain FAILED",
          "No timing/curve/frame-threshold or product change made for renderer attribution",
          "Installed 1.9.23 is still the old build with the confirmed CSS time-unit defect",
        ];
        await command("presented-positive-negative", process.execPath,
          ["scripts/opening-presented-frames-test.cjs", "04"]);
        const observer = read(path.join(base, "presented-selftest-04/report.json"));
        assert.equal(observer.status, "PASS"); assert.equal(observer.cases.length, 4);
        assert(observer.cases.every(c => c.status === "PASS" && c.acceptedContinuous === (c.duration === 180)));
      }
      await command("same-component-green", process.execPath,
        ["scripts/runtime-opening-time-unit-regression.cjs", attempt === "02" ? "green-02" : "green-01"]);
      const matrix = attempt === "02" ? "matrix-06" : "matrix-05";
      await command("runtime-full-media", process.execPath,
        ["scripts/runtime-opening-playwright.cjs", matrix, "--matrix", ...(attempt === "02" ? ["--d3d11"] : [])]);
      const mediaFile = `F:/AgentVN/QA/Runtime-Opening-20261023-01/${matrix}/report.json`;
      const media = read(mediaFile);
      assert.equal(media.status, "PASS"); assert.equal(media.cases.length, 32);
      assert(media.cases.every(c => c.status === "PASS" && c.contextClosed));
      if (attempt === "02") assert.equal(media.renderer.features.gpu_compositing, "enabled");
      report.media = desc(mediaFile);
    } else {
      const support = read(path.join(base, `support-${attempt === "02" ? "03" : attempt}/report.json`));
      assert.equal(support.status, "PASS"); unchanged(support.sources);
      assert.equal(support.commands.length, 2);
      assert(support.commands.every(c => c.status === "PASS" && c.exitCode === 0));
      if (attempt === "02") {
        assert.equal(support.effectiveCases, 32);
        unchanged(support.validatedEvidence);
        report.boundaries = support.boundaries;
      }
      await command("editor-typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run typecheck"]);
      await command("editor-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run build"]);
      await command("gamecli-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
      await command("full-dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
      report.dev = desc(path.join(root, "AgentVN Dev.exe"));
      report.player = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
      assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
      assert.equal(report.player.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
      report.bundled = report.sources.map(f => {
        const copy = desc(path.join(root, "editor/src-tauri/bundle-workspace", path.relative(root, f.path)));
        assert.equal(copy.sha256, f.sha256); return copy;
      });
    }
    unchanged(report.sources);
  }
  unchanged(report.frozen); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, phase, out, commands: report.commands.length, error: report.error }));
});
