"use strict";
// Reattach to one already-running build; NEVER invokes another build. Preserve
// the original QA failure and supplement it with independently traced terminal
// result, manifest, real permission probe, source bytes and attributed cleanup.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const qa = "F:/AgentVN/QA/Android-Package-20261021-01", attempt = process.argv[2];
assert.match(attempt || "", /^\d{2}$/);
const out = path.join(qa, "recovery-" + attempt), originalFile = path.join(qa, "editor-" + attempt, "report.json");
assert(!fs.existsSync(out), "Fresh recovery evidence required"); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const original = read(originalFile), helper = read(path.join(qa, "administrator-" + attempt, "result.json"));
assert.equal(original.scope, "TASK_ENGINE_ELEVATED_ACTUAL_MSI_EDITOR_CONTROLLED_NATIVE_ANDROID_NOT_NORMAL_USER_OR_PICKER");
assert.equal(original.builds, 1); assert(helper.isElevated && helper.taskEngine && !helper.finishedAt);
const launch = original.launches[0], installation = read(original.installation.path);
const cache = "C:/Users/1/AppData/Local/com.agentvn.editor/standalone-package";
const report = { status: "RUNNING", scope: "REATTACH_SAME_INSTALLED_ANDROID_BUILD_NO_NEW_BUILD_NOT_PICKER",
  startedAt: new Date().toISOString(), original: desc(originalFile), originalStatus: original.status,
  originalError: original.error, originalEvidenceModified: false, buildInvocations: 0, modelRequests: 0,
  administratorSource: path.join(qa, "administrator-" + attempt, "result.json"),
  knownProcesses: [], snapshots: [], nativeResult: null, cleanup: "NOT_RUN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const known = new Map(), key = p => `${p.ProcessId}:${p.Created}`;
let browser, page, terminal = false;
const safeFile = (source, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination); assert.equal(sha(source), sha(destination)); return desc(destination);
};
function observe() {
  const live = rows(), parent = live.find(p => p.ProcessId === helper.nodeProcessId && p.Created === helper.nodeCreated);
  assert(parent, "Original runner identity is no longer live");
  const tree = ownedProcessTree(live, helper.nodeProcessId, helper.nodeCreated);
  for (const p of tree) { const { CommandLine, ...safe } = p; known.set(key(safe), safe); }
  report.knownProcesses = [...known.values()];
  assert(tree.some(p => p.ProcessId === launch.pid && p.Created === launch.created));
  for (const entry of fs.readdirSync(cache, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d+$/.test(e.name))) {
    const base = path.join(cache, entry.name), workspace = path.join(base, "build-workspace");
    const log = path.join(base, "diagnostics/standalone-android-build.log");
    if (!fs.existsSync(log)) continue;
    const text = fs.readFileSync(log, "utf8");
    if (!text.includes("qa_android_pkg_20261021_" + attempt)) continue;
    assert(!report.cacheRoot || report.cacheRoot === base, "Ambiguous current build cache");
    report.cacheRoot = base;
    const sources = ["build-versions.json", "GameCli_framework/src-tauri/src/lib.rs",
      "scripts/build-runtime-standalone-android.cjs", "scripts/build-runtime-standalone-android.ps1"];
    if (!report.workspace && sources.every(f => fs.existsSync(path.join(workspace, f)))) {
      const actualVersion = read(path.join(workspace, sources[0])), installedVersion = read(path.join(installation.installRoot, sources[0]));
      assert.equal(actualVersion.editorVersion, "1.9.18"); assert.equal(installedVersion.editorVersion, "1.9.18");
      report.workspace = { path: workspace, observedAt: new Date().toISOString(), files: sources.map(relative => {
        const actual = desc(path.join(workspace, relative)), installed = desc(path.join(installation.installRoot, relative));
        if (relative !== "build-versions.json") assert.equal(actual.sha256, installed.sha256, relative);
        return { relative, actual, installed, comparison: relative === "build-versions.json" ? "SEMANTIC_EDITOR_VERSION" : "SHA256_BYTES" };
      }) };
    }
    for (const name of ["android-symlink-capability.json", "android-symlink-capability-runner.json",
      "android-env-check.json", "package-build-manifest.json", "standalone-android-build.log"]) {
      const source = path.join(base, "diagnostics", name);
      if (fs.existsSync(source)) {
        const snapshot = safeFile(source, path.join(out, "live-diagnostics", name));
        report.snapshots = report.snapshots.filter(s => path.basename(s.path) !== name); report.snapshots.push(snapshot);
      }
    }
    const tail = text.slice(-1600);
    if (tail !== report.lastTail) { report.lastTail = tail; console.log(tail); }
  }
  save();
}
(async () => {
  const token = ps("$i=[Security.Principal.WindowsIdentity]::GetCurrent();" +
    "ConvertTo-Json -Compress @{elevated=([Security.Principal.WindowsPrincipal]::new($i)).IsInRole(" +
    "[Security.Principal.WindowsBuiltInRole]::Administrator);sid=$i.User.Value}");
  report.token = JSON.parse(token); assert(report.token.elevated && report.token.sid === helper.userSid); save();
  browser = await chromium.connectOverCDP("http://127.0.0.1:" + launch.ports[1]);
  page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())); assert(page);
  while (true) {
    observe(); report.nativeResult = await page.evaluate(() => window.__qaAndroidBuild); save();
    assert(report.nativeResult, "Original build promise missing");
    if (report.nativeResult.status !== "RUNNING") { terminal = true; break; }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  observe();
  assert.equal(report.nativeResult.status, "TERMINAL", report.nativeResult.error);
  const result = report.nativeResult.result; report.featureStatus = result.status; save();
  if (report.cacheRoot) {
    const diagnostics = path.join(report.cacheRoot, "diagnostics");
    for (const entry of fs.readdirSync(diagnostics, { withFileTypes: true })) if (entry.isFile())
      safeFile(path.join(diagnostics, entry.name), path.join(out, "terminal-diagnostics", entry.name));
  }
  assert.equal(result.status, "PASS", result.message); assert.equal(result.ok, true); assert(report.workspace);
  const probe = read(path.join(out, "terminal-diagnostics/android-symlink-capability.json"));
  assert(probe.success && probe.isElevated);
  report.probe = probe;
  report.artifacts = result.artifacts.map(a => ({ kind: a.kind, ...desc(a.path.replace(/^\\\\\?\\/, "")) }));
  assert(report.artifacts.some(a => a.path.endsWith(".apk")));
  report.androidBuildStatus = "STATIC_ONLY"; report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    assert(terminal, "Build not terminal: preserve original owner, cache and policies");
    await browser?.close(); browser = undefined;
    // The original QA runner is still connected to the host. Keep it alive
    // until native tasks are terminal, host cleanup and cache restoration finish.
    const live = rows(), own = known.get(`${helper.nodeProcessId}:${helper.nodeCreated}`); assert(own);
    for (const p of [...known.values()].reverse()) {
      if (p.ProcessId === helper.nodeProcessId || !live.some(n => key(n) === key(p))) continue;
      ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
        `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
    }
    await until(() => !rows().some(p => p.ProcessId !== helper.nodeProcessId && known.has(key(p)))
      && listeners(launch.ports).length === 0, "Original build host cleanup", 20000);
    const restoration = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "D:/AgentVN/scripts/android-current-cache-session.ps1", "-Action", "Restore",
      "-RunDirectory", path.join(qa, "editor-" + attempt), "-PhysicalPackageCache", "-PhysicalEnvironmentCache"],
    { encoding: "utf8", windowsHide: true, timeout: 120000 });
    fs.writeFileSync(path.join(out, "cache-restore.log"), restoration.stdout + restoration.stderr);
    assert.equal(restoration.status, 0, restoration.stdout + restoration.stderr);
    report.cacheRestoration = desc(path.join(qa, "editor-" + attempt, "cache-restoration.json"));
    assert.equal(read(report.cacheRestoration.path).status, "PASS");
    for (const f of original.protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
    for (const f of original.physicalHostAbsentFiles || []) assert(!fs.existsSync(f.path), f.path);
    assert.equal(sha(originalFile), report.original.sha256);
    const owner = rows().find(p => key(p) === key(own)); assert(owner);
    ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${own.ProcessId}';` +
      `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${own.Created}'){Stop-Process -Id ${own.ProcessId} -Force -ErrorAction Stop}`);
    report.cleanup = "PASS";
  } catch (e) { report.status = "FAILED"; report.cleanup = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  await browser?.close().catch(() => {});
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, androidBuildStatus: report.androidBuildStatus,
    cleanup: report.cleanup, error: report.error, cleanupError: report.cleanupError, out }));
});
