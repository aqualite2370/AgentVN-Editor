"use strict";
// Actual installed Editor -> real UI vncart export -> actual native build IPC.
// Explicit output path is a controlled integration input, NOT a native-picker
// or normal UI standalone-export pass. Never invokes source workspace builders.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Windows-Package-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `editor-${attempt}`);
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
assert.equal(fs.readdirSync(out).length, 0, "A new empty exact session is required");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size,
  generatedAt: fs.statSync(p).mtime.toISOString() });
const baselineFile = "F:/AgentVN/QA/Installed-Components-20261021-01/editor-08/report.json";
assert.equal(sha(baselineFile), "49efb535c8986d5f46d4782130690fdc7d7479beb72d0bc3178b25f1de1e7a2a");
const installationFile = "F:/AgentVN/QA/Component-Preview-Release-20261021-02/installation.json";
const tools = ["scripts/installed-windows-package-current.cjs", "scripts/windows-package-cache-session.ps1",
  "scripts/installed-layout-cache-session.ps1", "scripts/lib/installed-release-session.cjs"];
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_INSTALLED_EDITOR_UI_VNCART_THEN_CONTROLLED_NATIVE_WINDOWS_BUILD_NOT_PICKER",
  modelRequests: 0, productChanges: 0, builds: 0, sourceBuilderInvocation: false,
  normalStandaloneUIExportStatus: "BLOCKED_NATIVE_PICKER_TOOL_UNAVAILABLE",
  installation: desc(installationFile), protectedFiles: read(baselineFile).protectedFiles,
  tools: tools.map(t => desc(path.join(root, t))), steps: [], launches: [], cleanups: [], errors: [],
  screenshots: [], buildKnownProcesses: [], progress: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, windowsCachePrepared = false, packageCachePrepared = false, buildPending = false;
function unchanged() {
  for (const f of [...report.protectedFiles, ...report.tools, report.installation]) assert.equal(sha(f.path), f.sha256, f.path);
}
function cache(tool, action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, tool), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 120000 });
  fs.writeFileSync(path.join(out, `${path.basename(tool)}-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function step(label, fn) {
  const row = { label, status: "RUNNING", startedAt: new Date().toISOString() };
  report.steps.push(row); save(); console.log(`START ${label}`);
  try { row.result = await fn(); row.status = "PASS"; console.log(`PASS ${label}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
async function publishing() {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  const operation = page.getByTestId("package-environment-operation-dialog");
  await until(async () => {
    if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
    const setting = page.locator('[data-package-stage="settings"]');
    if (await setting.isVisible() && await setting.getAttribute("aria-current") !== "page") { await setting.click(); return false; }
    return await page.locator('[data-help-key="package.mode"]').isVisible();
  }, "real publishing environment terminal", 180000);
  if (await operation.isVisible()) {
    const phase = await operation.getAttribute("data-environment-phase");
    report.incidentalEnvironment = { phase, text: await operation.innerText(),
      scope: "Actual check under redirected test cache, not default-profile or clean-machine proof" }; save();
    await operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
    await operation.waitFor({ state: "detached" });
  }
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
}
function observeBuild() {
  const tree = ownedProcessTree(rows(), host.current.pid, host.current.created);
  for (const p of tree) if (!report.buildKnownProcesses.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created))
    report.buildKnownProcesses.push(p);
  const base = path.join(out, "package-cache");
  const directories = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d+$/.test(e.name));
  // The native host removes the entire successful build cache before its IPC
  // resolves. Preserve source provenance while observing the live build;
  // do not require an intentionally deleted workspace after success.
  for (const e of directories) {
    const workspace = path.join(base, e.name, "build-workspace");
    const versions = path.join(workspace, "build-versions.json");
    const runtime = path.join(workspace, "GameCli_framework/src-tauri/src/lib.rs");
    const builder = path.join(workspace, "scripts/build-runtime-standalone-windows.cjs");
    const readyLog = path.join(base, e.name, "diagnostics/standalone-windows-build.log");
    if (report.materializedWorkspace || ![versions, runtime, builder].every(f => fs.existsSync(f))) continue;
    if (!fs.existsSync(readyLog) || !fs.readFileSync(readyLog, "utf8").includes("== frontend runtime build ==")) continue;
    assert.equal(read(versions).editorVersion, "1.9.16");
    const sample = { path: workspace, observedAt: new Date().toISOString(),
      versions: desc(versions), runtime: desc(runtime), builder: desc(builder) };
    for (const [relative, item] of [["GameCli_framework/src-tauri/src/lib.rs", sample.runtime],
      ["scripts/build-runtime-standalone-windows.cjs", sample.builder]])
      assert.equal(item.sha256, sha(path.join(host.installation.installRoot, relative)));
    report.materializedWorkspace = sample;
  }
  const logs = directories.map(e => path.join(base, e.name, "diagnostics/standalone-windows-build.log")).filter(p => fs.existsSync(p));
  const log = logs.at(-1);
  const progress = { at: new Date().toISOString(), processIdentities: tree.map(p => `${p.ProcessId}:${p.Created}`),
    nativeBuildProcessCount: tree.filter(p => /^(node|cargo|rustc|link|makensis|tauri-cli)\.exe$/i.test(p.Name)).length };
  if (log) {
    progress.log = log; progress.logBytes = fs.statSync(log).size;
    const tail = fs.readFileSync(log, "utf8").slice(-800);
    if (tail !== report.lastBuildTail) { report.lastBuildTail = tail; console.log(tail); }
  }
  report.progress.push(progress); save();
}
(async () => {
  unchanged(); save();
  for (const t of tools) fs.copyFileSync(path.join(root, t), path.join(out, path.basename(t)), fs.constants.COPYFILE_EXCL);
  const project = fixture(`qa_windows_pkg_20261021_${attempt}`);
  project.schema_version = "1.1.0"; project.title = "AVN Windows QA 20261021";
  project.nodes[0].data.loadingAnimation = { kind: "default" }; project.nodes[0].data.openingAudio = [];
  project.nodes[1].data.scene.commands = [0,1,2].map(i => ({
    type: "narration", text: `QA_WINDOWS_SAVE_${i}：本轮独立小工程；验证EXE旁存档、重启与明确拒写。`
  }));
  const input = path.join(out, "独立 Windows 小工程.vnproj");
  fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" }); report.input = desc(input);
  cache("scripts/installed-layout-cache-session.ps1", "SelfTest");
  cache("scripts/windows-package-cache-session.ps1", "SelfTest");
  cache("scripts/installed-layout-cache-session.ps1", "Prepare"); windowsCachePrepared = true;
  cache("scripts/windows-package-cache-session.ps1", "Prepare"); packageCachePrepared = true;
  host = installedReleaseSession({ installationFile, out, report, save, input });
  await step("Actual 1.9.16 installed host and controlled isolated small-project import", async () => {
    assert.equal(host.installation.executable.version, "1.9.16");
    page = await host.start();
    const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
      body: fs.readFileSync(input), signal: AbortSignal.timeout(30000) });
    const value = await r.json(); assert(r.ok && value.ok && value.data.project_id === project.project_id);
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await host.shot("installed-small-project"); return { projectId: project.project_id, nativeProjectPicker: false };
  });
  await step("Actual publish UI exports new vncart bytes from the small project", async () => {
    await publishing();
    for (const [key, value] of [["gameId", project.project_id], ["title", project.title], ["author", "QA"],
      ["description", "Actual installed Editor small-project Windows package integration test."]])
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warnings.isVisible()) await warnings.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
    const dir = path.join(out, "cartridge"); fs.mkdirSync(dir);
    await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-help-key="package.export"]').click()]);
    const name = download.suggestedFilename(); assert.equal(path.basename(name), name); const file = path.join(dir, name);
    await until(() => fs.existsSync(file) && !fs.existsSync(file + ".crdownload"), "actual exported vncart", 60000);
    assert.equal(await download.failure(), null);
    const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const script = JSON.parse(await zip.file("script.json").async("string"));
    assert.equal(manifest.game_id, project.project_id); assert.equal(manifest.title, project.title);
    assert(JSON.stringify(script).includes("QA_WINDOWS_SAVE_2"));
    report.cartridge = { ...desc(file), manifest, layoutSha256: hash(await zip.file("ui/layout.json").async("nodebuffer")),
      scriptSha256: hash(await zip.file("script.json").async("nodebuffer")) };
    await host.shot("real-ui-vncart-exported"); return report.cartridge;
  });
  await step("Actual installed native package upload and Windows build; explicit output is controlled input", async () => {
    const bytes = fs.readFileSync(report.cartridge.path);
    const upload = await page.evaluate(async ({ name, bytes }) => {
      const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
      const begin = await invoke("begin_standalone_package_upload", { fileName: name, expectedSize: bytes.length });
      let offset = 0;
      for (let i = 0; i < bytes.length; i += 65536) {
        const chunk = bytes.slice(i, i + 65536);
        const result = await invoke("append_standalone_package_upload_chunk", {
          uploadId: begin.uploadId, fileKind: "cartridge", offsetBytes: offset, chunkBytes: chunk
        });
        offset += chunk.length;
        if (result.writtenBytes !== offset) throw Error("Native package upload byte count mismatch");
      }
      return { ...begin, writtenBytes: offset };
    }, { name: path.basename(report.cartridge.path), bytes: [...bytes] });
    assert.equal(upload.writtenBytes, bytes.length); report.upload = upload;
    const destination = path.join(out, "中文 Windows 输出"); fs.mkdirSync(destination);
    const identity = { schemaVersion: 1, gameId: project.project_id, title: project.title,
      versionName: "1.0.0", versionCode: 1, androidApplicationId: "com.agentvn.qa.windows20261021" };
    report.buildRequest = { uploadId: upload.uploadId, targetPlatform: "windows", outputDir: destination,
      runId: `windows-package-${attempt}-20261021`, optimizationProfile: "off", releaseIdentity: identity, iconSource: "default" };
    report.builds = 1; buildPending = true; save();
    await page.evaluate(request => {
      window.__qaWindowsPackageBuild = { status: "RUNNING", startedAt: performance.now() };
      window.__TAURI_INTERNALS__.invoke("build_standalone_package_from_upload", request).then(
        result => { window.__qaWindowsPackageBuild = { status: "TERMINAL", result }; },
        error => { window.__qaWindowsPackageBuild = { status: "REJECTED", error: String(error) }; });
    }, report.buildRequest);
    let state;
    while (true) {
      observeBuild();
      state = await page.evaluate(() => window.__qaWindowsPackageBuild);
      if (state.status !== "RUNNING") break;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    buildPending = false; report.nativeResult = state; save();
    assert.equal(state.status, "TERMINAL", state.error);
    const result = state.result;
    report.featureStatus = result.status; save();
    assert.equal(result.status, "PASS", result.message); assert.equal(result.ok, true);
    const expected = ["windows_portable_exe", "windows_nsis_installer"];
    assert(expected.every(kind => result.artifacts.some(a => a.kind === kind)));
    report.artifacts = result.artifacts.map(a => {
      const absolute = path.resolve(a.path.replace(/^\\\\\?\\/, ""));
      assert(absolute.startsWith(path.resolve(destination) + path.sep));
      return { kind: a.kind, ...desc(absolute) };
    });
    assert(report.materializedWorkspace?.observedAt, "Live build workspace provenance was not sampled before cleanup");
    for (const [relative, item] of [["GameCli_framework/src-tauri/src/lib.rs", report.materializedWorkspace.runtime],
      ["scripts/build-runtime-standalone-windows.cjs", report.materializedWorkspace.builder]])
      assert.equal(item.sha256, sha(path.join(host.installation.installRoot, relative)));
    return { artifacts: report.artifacts, materializedVersion: "1.9.16", normalUIExportClaim: false };
  });
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); unchanged(); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) await host.shot("failure").catch(e => { report.captureError = String(e); });
}).finally(async () => {
  try {
    assert(!buildPending, "Native build still running: retain owner and journals for continuation; do not restart/kill it");
    await host?.stop("Windows packaging finally; no physical close claim");
    if (packageCachePrepared) {
      cache("scripts/windows-package-cache-session.ps1", "Restore");
      assert.equal(read(path.join(out, "package-cache-restoration.json")).status, "PASS"); report.packageCacheRestored = true;
    }
    if (windowsCachePrepared) {
      cache("scripts/installed-layout-cache-session.ps1", "Restore");
      assert.equal(read(path.join(out, "native-cache-restoration.json")).status, "PASS"); report.windowsCacheRestored = true;
    }
    unchanged(); report.protectedUnchanged = true;
    const live = rows(), known = [...(report.knownProcesses || []), ...report.buildKnownProcesses];
    assert(!known.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
    assert.equal(listeners(report.cleanups.flatMap(c => c.ports)).length, 0);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, featureStatus: report.featureStatus,
    steps: report.steps.map(s => ({ label: s.label, status: s.status })), artifacts: report.artifacts,
    error: report.error, cleanupError: report.cleanupError, out }, null, 2));
});
