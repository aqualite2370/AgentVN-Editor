"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, ".."), [phase, attempt, matrixAttempt = "08"] = process.argv.slice(2);
assert(["support", "build"].includes(phase)); assert.match(attempt, /^\d{2}$/); assert.match(matrixAttempt, /^\d{2}$/);
const base = "F:/AgentVN/QA/Narrative-Geometry-Source-20261024-01", out = path.join(base, `${phase}-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedUtc: fs.statSync(file).mtime.toISOString() });
const report = { phase, status: "RUNNING", startedAt: new Date().toISOString(), commands: [], modelRequests: 0,
  scope: "CURRENT_SOURCE_AND_DEV_NOT_FROZEN_INSTALLATION_ACCEPTANCE",
  sources: ["GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/components/player/ChoicePanel.tsx",
    "GameCli_framework/src/styles/player.css"].map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(label, exe, args, env = {}) {
  const c = { label, command: [exe, ...args], env, log: path.join(out, `${label}.log`),
    startedAt: new Date().toISOString() };
  report.commands.push(c); save();
  const fd = fs.openSync(c.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true,
      stdio: ["ignore", fd, fd] });
    c.pid = child.pid; save();
    c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(c.exitCode, 0, `${label} failed; see ${c.log}`);
    assert(fs.statSync(c.log).size > 0, "Empty test/build output cannot pass");
    c.status = "PASS";
  } catch (e) { c.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ label, status: c.status, exitCode: c.exitCode, log: c.log })); }
}
(async () => {
  if (phase === "support") {
    for (const name of ["nvl-runtime-acceptance", "dialogue-mode-layout-model-test", "dialogue-mode-layout-export-test",
      "dialog-presentation-inheritance-test", "installed-dialog-pagination-test", "nvl-choice-frame-probe-test",
      "runtime-screen-transition-contract"]) {
      await command(name, process.execPath, [path.join(root, `scripts/${name}.cjs`)], {
        AGENTVN_WORKSPACE_OUTPUT: path.join(out, name), AGENTVN_TEST_PROJECT: "isolated-narrative-geometry-fixture",
      });
    }
    await command("compact-node-preview", process.execPath,
      [path.join(root, "scripts/runtime-dialog-measurement-stability-playwright.cjs"), "06"]);
    const compactFile = "F:/AgentVN/QA/Runtime-Dialog-Measurement-20261021-01/browser-06/report.json";
    const compact = read(compactFile);
    assert.equal(compact.status, "PASS"); assert.equal(compact.cases.length, 16);
    assert(compact.cases.every(c => c.status === "PASS"));
    assert.equal(compact.cleanup, "OWNED_BROWSER_AND_SERVICE_STOPPED");
    report.compact = desc(compactFile);
    assert.equal(report.commands.length, 8);
  } else {
    const matrixFile = path.join(base, `run-${matrixAttempt}/report.json`), matrix = read(matrixFile);
    assert.equal(matrix.status, "PASS"); assert.equal(matrix.fullMatrix, true);
    assert.equal(matrix.cases.length, 48); assert(matrix.browserClosed && matrix.serverStopped);
    assert.deepEqual(matrix.sources, report.sources, "Build only the source that passed");
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
      for (const layout of ["agentvn", "renpy"]) for (const kind of ["nvl-choice", "dialog"]) {
        const matches = matrix.cases.filter(c => c.width === width && c.dpr === dpr && c.reduced === reduced
          && c.layout === layout && c.kind === kind);
        assert.equal(matches.length, 1); const c = matches[0];
        assert.equal(c.status, "PASS"); assert(c.contextClosed);
        assert.equal(c.analysis.classification, "NO_OVERFLOW_OBSERVED");
        assert.equal(sha(c.trace), c.traceSha256);
        if (kind === "nvl-choice") {
          assert(c.choiceNavigated);
          const trace = read(c.trace);
          assert(trace.every(f => f.animations.every(a => a.name !== "font-size")),
            "Reading budget cannot lag behind a font-size transition");
          if (!reduced) assert(trace.some(f => f.animations.some(a => a.name === "choice-fade-in")),
            "The layout repair must retain the real choice entrance animation");
        } else assert(c.ordinaryPages > 0);
      }
    assert.equal(matrix.screenshots.length, 48);
    for (const s of matrix.screenshots) {
      assert.equal(sha(s.path), s.sha256);
      const c = matrix.cases.find(c => path.basename(s.path) === `${c.width}-${c.dpr}-${c.reduced}-${c.layout}-${c.kind}.png`);
      assert(c); const png = fs.readFileSync(s.path);
      assert.equal(png.readUInt32BE(16), c.width * c.dpr); assert.equal(png.readUInt32BE(20), c.height * c.dpr);
    }
    const supportFile = path.join(base, "support-02/report.json"), support = read(supportFile);
    assert.equal(support.status, "PASS"); assert.equal(support.commands.length, 8);
    assert(support.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    assert.deepEqual(support.sources, report.sources);
    report.behavior = desc(matrixFile); report.support = desc(supportFile);
    const frozen = read("F:/AgentVN/Checkpoints/Runtime-Opening-20261023-01/manifest.json").products
      .filter(f => !f.file.endsWith("AgentVN Dev.exe"));
    frozen.push({ file: "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/creator-backend.exe",
      sha256: "826177bda832ffc97948895355f79bdea4af5bcf2b95d5e519dfd77de833b3de" });
    assert(frozen.length >= 2); for (const f of frozen) assert.equal(sha(f.file), f.sha256);
    report.frozenInstallation = frozen;
    const backup = path.join("F:/AgentVN/Checkpoints/Narrative-Geometry-20261024-01", `build-${attempt}`);
    assert(!fs.existsSync(backup)); fs.mkdirSync(backup);
    report.backups = [];
    for (const file of ["AgentVN Dev.exe", "editor/src-tauri/binaries/agentvn-player.exe",
      "GameCli_framework/src-tauri/target/release/agentvn-player.exe", "editor/src-tauri/target/debug/agentvn-editor.exe"]) {
      const source = path.join(root, file);
      if (!fs.existsSync(source)) continue;
      const target = path.join(backup, file); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(target)); report.backups.push({ original: desc(source), retained: desc(target) });
    }
    await command("editor-typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run typecheck"]);
    await command("editor-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run build"]);
    await command("runtime-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
    await command("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    report.dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    report.preview = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(report.preview.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    report.bundledSources = report.sources.map(f => {
      const target = path.join(root, "editor/src-tauri/bundle-workspace", f.file);
      assert.equal(sha(target), f.sha256); return desc(target);
    });
    for (const f of frozen) assert.equal(sha(f.file), f.sha256);
  }
  for (const f of report.sources) assert.equal(sha(path.join(root, f.file)), f.sha256);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
  save(); console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
