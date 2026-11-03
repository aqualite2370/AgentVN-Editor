"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Runtime-Dialog-Measurement-20261021-01";
const [mode, attempt = "01"] = process.argv.slice(2);
assert(["check", "dev", "audit"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `${mode}-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), mode, commands: [], modelRequests: 0,
  scope: "RUNTIME_DIALOG_MEASUREMENT_SOURCE_AND_DEV_NOT_NEW_INSTALLED_RELEASE" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(label, exe, args) {
  const logPath = path.join(out, `${String(report.commands.length + 1).padStart(2, "0")}.log`);
  const fd = fs.openSync(logPath, "wx");
  const row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save(); console.log(`START ${label}`);
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd],
      env: { ...process.env,
        AGENTVN_TEST_PROJECT: "F:/AgentVN/QA/Installed-Portrait-20261021-01/头像布局隔离小工程.vnproj",
        AGENTVN_WORKSPACE_OUTPUT: path.join(out, `test-${report.commands.length}`) } });
    row.pid = child.pid;
    row.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    row.status = row.exitCode === 0 ? "PASS" : "FAILED";
  } finally { fs.closeSync(fd); row.log = desc(logPath); row.finishedAt = new Date().toISOString(); save(); }
  console.log(`${row.status} ${label}`); assert.equal(row.status, "PASS", `Gate failed: ${logPath}`);
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  if (mode === "check") {
    const redPath = path.join(qa, "browser-03/report.json"), greenPath = path.join(qa, "browser-05/report.json");
    const red = read(redPath), green = read(greenPath);
    assert.equal(red.status, "FAILED"); assert(red.errors.some(e => e.error.includes("Maximum update depth")));
    assert.equal(green.status, "PASS"); assert.equal(green.cases.length, 56);
    assert(green.cases.every(c => c.status === "PASS" && c.pages.length > 0));
    assert.equal(green.cleanup, "OWNED_BROWSER_AND_SERVICE_STOPPED"); assert.deepEqual(green.errors, []);
    assert.equal(green.modelRequests, 0);
    const boundary = green.cases.filter(c => c.variant === "boundary");
    assert.equal(boundary.length, 48);
    assert.equal(new Set(boundary.map(c => `${c.profile}/${c.width}/${c.dpr}/${c.reduced}/${c.pane.width}`)).size, 48);
    const oldCss = red.sourceFiles.find(s => s.path.endsWith("player.css"));
    assert.equal(sha(path.join(green.checkpoint, "GameCli_framework/src/styles/player.css")), oldCss.sha256);
    assert.notEqual(sha(path.join(root, "GameCli_framework/src/styles/player.css")), oldCss.sha256);
    report.behavior = { red: desc(redPath), green: desc(greenPath) }; report.sources = green.sourceFiles;
    for (const f of report.sources) assert.equal(sha(f.path), f.sha256);
    const names = ["dialog-portrait-layout-model-test", "dialogue-mode-layout-model-test", "dialogue-mode-layout-export-test",
      "runtime-layout-profiles-test", "renpy-layout-runtime-test", "ui-skin-legacy-compat-contract",
      "ui-skin-style-component-health-contract", "runtime-exit-flow-test", "runtime-screen-transition-contract",
      "quick-menu-metrics-contract", "quick-menu-container-contract", "editor-workspace-contract",
      "runtime-render-diagnostic-test"];
    for (const name of names) await command(name, process.execPath, [`scripts/${name}.cjs`]);
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
      await command(`${folder} ${task}`, process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
    assert.equal(report.commands.length, 16);
  } else if (mode === "dev") {
    const file = path.join(qa, "check-01/report.json"), prior = read(file);
    assert.equal(prior.status, "PASS"); assert.equal(prior.commands.length, 16);
    assert(prior.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    report.precondition = desc(file); report.sources = prior.sources;
    for (const f of report.sources) assert.equal(sha(f.path), f.sha256);
    report.before = desc(path.join(root, "AgentVN Dev.exe"));
    await command("Complete Dev build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
      "editor/src-tauri/binaries/agentvn-player.exe", "GameCli_framework/src-tauri/target/release/agentvn-player.exe"].map(f => desc(path.join(root, f)));
    assert.equal(report.products[0].sha256, report.products[1].sha256);
    assert.equal(report.products[2].sha256, report.products[3].sha256);
    assert.notEqual(report.products[0].sha256, report.before.sha256);
    assert(Date.parse(report.products[0].generatedAt) >= Date.parse(report.startedAt));
    const source = path.join(root, "GameCli_framework/src/styles/player.css");
    report.bundledCss = desc(path.join(root, "editor/src-tauri/bundle-workspace/GameCli_framework/src/styles/player.css"));
    assert.equal(report.bundledCss.sha256, sha(source));
  } else {
    const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
    const { spawnSync } = require("node:child_process");
    const portraitQA = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
    const checkFile = path.join(qa, "check-01/report.json"), devFile = path.join(qa, "dev-01/report.json");
    const check = read(checkFile), built = read(devFile);
    const nativeFile = path.join(qa, "native-02/report.json"), native = read(nativeFile);
    assert.equal(check.status, "PASS"); assert.equal(built.status, "PASS");
    assert.equal(native.status, "PASS"); assert.equal(native.cases.length, 4);
    assert(native.cases.every(c => c.status === "PASS" && c.samples.length === 30
      && c.samples.every(s => s.layout === c.type && s.text.startsWith("PORTRAIT_LAYOUT"))));
    assert.deepEqual(native.errors, []); assert.equal(native.modelRequests, 0); assert.equal(native.cleanupError, undefined);
    const failedNative = read(path.join(qa, "native-01/report.json"));
    assert.equal(failedNative.status, "FAILED"); assert.match(failedNative.error, /row.trace/);
    assert.deepEqual(failedNative.errors, []);
    report.sources = check.sources;
    const ids = new Set(), ports = new Set();
    const nativeInputs = [failedNative, native];
    report.reproductions = [];
    for (const n of ["04", "05"]) {
      const file = path.join(portraitQA, `editor-${n}/report.json`), value = read(file);
      assert.equal(value.status, "FAILED"); assert(value.errors.some(e => e.includes("#185")));
      assert.equal(value.steps.length, 6); assert(value.steps.every(s => s.status === "PASS"));
      const failure = value.frameErrors.find(e => e.message.includes("#185"));
      assert(failure && failure.frameOwner.title === "GameCLI 内嵌预览" && !failure.frameOwner.ghost);
      const dialogs = failure.trace.snapshots.filter(s => s.dialogs.length);
      assert(dialogs.length >= 40);
      assert.equal(new Set(dialogs.slice(-10).map(s => s.dialog.pages)).size, 2);
      if (n === "05") assert.deepEqual([...new Set(dialogs.slice(-10).map(s => s.text.client[0]))].sort(), [295, 310]);
      report.reproductions.push({ ...desc(file), frame: failure.frameOwner, commits: failure.trace.commits,
        finalTen: dialogs.slice(-10).map(s => ({ at: s.at, pages: s.dialog.pages, fontScale: s.dialog.font,
          text: s.text ? { client: s.text.client, font: s.text.fontSize } : undefined })) });
      nativeInputs.push(value);
    }
    const replayFile = path.join(portraitQA, "init-replay-01/report.json"), replay = read(replayFile);
    assert.equal(replay.status, "CONTROLLED_REPLAY_NOT_REPRODUCED_ORIGINAL_FAILURE_REMAINS_OPEN");
    assert.equal(replay.replays.length, 6);
    assert.equal(replay.replays.flatMap(r => r.result.responses).length, 8);
    assert.deepEqual(replay.errors, []); assert.equal(replay.cleanupError, undefined); nativeInputs.push(replay);
    const baseline = read(read(path.join(portraitQA, "editor-05/report.json")).nativeCacheRestoration.path);
    const directory = baseline.originalDirectory;
    const directoryId = ps(`$v=(& fsutil.exe file queryfileid '${directory.replace(/'/g, "''")}'|Out-String);` +
      `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'ID unavailable'};$Matches[0].ToLowerInvariant()`);
    assert.equal(directoryId, baseline.originalDirectoryId);
    for (const f of baseline.originalFiles) assert.equal(sha(path.join(directory, f.relative)), f.sha256);
    report.cacheBoundary = { restoredBaseline: "POST_DIAGNOSTIC01_ONLY", originalBytesNotRecovered: true };
    for (const r of nativeInputs) {
      for (const p of r.known ?? r.knownProcesses) ids.add(`${p.ProcessId}:${p.Created}`);
      for (const l of r.launches) for (const p of l.ports) ports.add(p);
      assert(r.cleanups.length);
      for (const c of r.cleanups) {
        if ("survivors" in c) {
          assert.equal(c.survivors.length, 0); assert.equal(c.listeners.length, 0); assert.equal(c.normalExitClaimed, false);
        } else { assert.equal(c.status, "PASS"); assert.equal(c.normalCloseClaimed, false); }
      }
    }
    const processes = rows();
    assert(!processes.some(p => ids.has(`${p.ProcessId}:${p.Created}`)));
    const browserFile = path.join(qa, "browser-05/report.json"), browserResult = read(browserFile);
    assert.equal(browserResult.status, "PASS"); assert.equal(browserResult.cases.length, 56);
    assert(!processes.some(p => p.ProcessId === browserResult.service.pid && p.CommandLine.includes(browserResult.service.runId)));
    ports.add(Number(new URL(browserResult.service.url).port));
    assert.equal(listeners([...ports]).length, 0);
    for (const c of browserResult.cases.filter(c => c.screenshot)) {
      assert.equal(sha(c.screenshot.path), c.screenshot.sha256);
      const png = fs.readFileSync(c.screenshot.path);
      assert.equal(png.readUInt32BE(16), c.width * c.dpr); assert.equal(png.readUInt32BE(20), c.height * c.dpr);
    }
    const prep = read(path.join(portraitQA, "preparation.json"));
    const protectedFiles = prep.immutable.filter(f => path.resolve(f.path) !== path.resolve(built.products[0].path));
    for (const f of protectedFiles) assert.equal(sha(f.path), f.sha256);
    for (const p of built.products) assert.equal(sha(p.path), p.sha256);
    assert.equal(sha(built.bundledCss.path), built.bundledCss.sha256);
    report.evidence = [checkFile, devFile, nativeFile, browserFile, replayFile,
      path.join(portraitQA, "probe-audit-02/report.json")].map(desc);
    report.cleanup = { processIdentities: ids.size, ports: [...ports], protectedUnchangedFiles: protectedFiles.length,
      authorizedDevReplacement: built.products[0], normalCloseClaimed: false };
    const gitRead = args => {
      const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
      assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout.trim();
    };
    const head = gitRead(["rev-parse", "HEAD"]);
    const index = path.resolve(root, gitRead(["rev-parse", "--git-path", "index"])), indexHash = sha(index);
    const files = ["scripts/runtime-dialog-measurement-stability-playwright.cjs", "scripts/runtime-dialog-measurement-native.cjs",
      "scripts/runtime-dialog-measurement-gates.cjs", "scripts/installed-portrait-current.cjs",
      "scripts/installed-portrait-init-replay.cjs", "scripts/lib/runtime-render-diagnostic.cjs",
      "scripts/installed-portrait-probe-audit.cjs", "scripts/runtime-render-diagnostic-test.cjs"];
    for (const file of files) {
      await command(`Syntax ${file}`, process.execPath, ["--check", file]);
      assert.equal(spawnSync("git", ["check-ignore", "--", file], { cwd: root, windowsHide: true }).status, 1);
    }
    await command("Read-only publication preflight", "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/push-agentvn-editor.ps1"), "-CheckOnly"]);
    assert.equal(gitRead(["rev-parse", "HEAD"]), head); assert.equal(sha(index), indexHash);
    assert.equal(spawnSync("git", ["check-ignore", "--", "output/runtime-dialog-measurement-repair-20261021-01/REPORT.md"],
      { cwd: root, windowsHide: true }).status, 0);
    report.git = { head, indexSha256: indexHash, actualPush: false, gitignoreChangeNeeded: false };
    report.installedCandidateStatus = "FAILED_UNCHANGED";
    report.nextRequirement = "NEW_RELEASE_INSTALLATION_AND_ORIGINAL_UI_EXPORT_FLOW_RETEST";
  }
  for (const f of report.sources) assert.equal(sha(f.path), f.sha256, "Source changed during gate");
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
