"use strict";
// Real installed Editor publishing UI. Only output picker response is controlled.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { oneShotDirectoryResponse } = require("./lib/controlled-package-output.cjs");
const { normalEditorClose } = require("./lib/windows-repository-native.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const [installationFile, authorFile, output] = process.argv.slice(2), out = path.resolve(output || "");
const root = path.resolve(__dirname, ".."), qa = "F:\\AgentVN\\QA\\Windows-Package-20261021-01";
assert(installationFile && authorFile && path.dirname(out) === qa && /^editor-\d{2}$/.test(path.basename(out)));
assert(!fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const author = read(authorFile); assert.equal(author.status, "PASS"); assert.equal(author.cleanup, "PASS");
assert.equal(sha(author.portable.path), author.portable.sha256); assert.equal(sha(installationFile), author.installation.sha256);
fs.mkdirSync(out);
const destination = path.join(out, "中文 Windows 输出"); fs.mkdirSync(destination);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_INSTALLED_1_9_36_PUBLISH_UI_WINDOWS_ASPECT_BUILD_CONTROLLED_DIRECTORY_NOT_PICKER",
  installation: desc(installationFile), author: desc(authorFile), input: author.portable,
  modelRequests: 0, productChanges: 0, builds: 0, steps: [], screenshots: [], launches: [], cleanups: [],
  errors: [], knownBuildProcesses: [], observedFiles: [], observations: [], nativeChooserClaim: false,
  outputDirectoryMode: "user-authorized one-shot response; native picker NOT_RUN", cleanup: "PENDING" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
report.testIdentity = desc(path.join(out, "executed-test.cjs"));
let owner, page, prepared = false, pending = false, terminal = false;
async function step(name, fn) {
  const s = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(s); save(); console.log("START", name);
  try { s.detail = await fn(); s.status = "PASS"; console.log("PASS", name); }
  catch (error) { s.status = "FAILED"; throw error; }
  finally { s.finishedAt = new Date().toISOString(); save(); }
}
async function cache(action) {
  const operation = { action, startedAt: new Date().toISOString(), status: "RUNNING" };
  (report.cacheOperations ??= []).push(operation);
  const fd = fs.openSync(path.join(out, `cache-${action}.log`), "wx");
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/windows-package-cache-session.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { windowsHide: true, stdio: ["ignore", fd, fd] });
  operation.pid = child.pid; save();
  try {
    operation.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    assert.equal(operation.exitCode, 0, `Cache ${action}: see cache-${action}.log`);
    operation.status = "PASS";
  } finally {
    fs.closeSync(fd); operation.finishedAt = new Date().toISOString(); save();
  }
}
async function dismissEnvironment() {
  const dialog = page.getByTestId("package-environment-operation-dialog");
  if (!await dialog.isVisible()) return false;
  const phase = await dialog.getAttribute("data-environment-phase");
  if (!["completed", "failed"].includes(phase)) return true;
  (report.environmentChecks ??= []).push({ phase, text: await dialog.innerText() }); save();
  await dialog.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
  await dialog.waitFor({ state: "detached" }); return true;
}
function retain(file, name) {
  const hash = sha(file);
  if (report.observedFiles.some(f => f.name === name && f.sha256 === hash)) return;
  const copy = path.join(out, "observed-build", `${name}-${hash.slice(0, 12)}${path.extname(file)}`);
  fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
  report.observedFiles.push({ name, source: file, ...desc(copy) });
}
async function observe() {
  for (const p of ownedProcessTree(rows(), owner.current.pid, owner.current.created))
    if (!report.knownBuildProcesses.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created))
      report.knownBuildProcesses.push(p);
  const base = path.join(out, "package-cache");
  for (const e of fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d+$/.test(e.name))) {
    const run = path.join(base, e.name);
    for (const [relative, name] of [
      ["build-workspace/build-versions.json", "versions"],
      ["build-workspace/shared/cartridge/gameViewport.ts", "viewport"],
      ["build-workspace/GameCli_framework/src/components/shell/SettingsScreen.tsx", "settings"],
      ["build-workspace/scripts/build-runtime-standalone-windows.cjs", "builder"],
      ["game.vncart", "cartridge"], ["diagnostics/package-build-manifest.json", "manifest"],
      ["diagnostics/standalone-windows-build.log", "log"], ["diagnostics/standalone-windows-verify.json", "verify"],
    ]) {
      const f = path.join(run, relative); if (fs.existsSync(f)) retain(f, name);
    }
  }
  const text = await page.locator(".package-log-console").innerText().catch(() => "");
  if (report.lastConsole !== text) { report.lastConsole = text; console.log(text.slice(-450)); }
  report.observations.push({ at: new Date().toISOString(), processCount: report.knownBuildProcesses.length,
    resultVisible: await page.getByTestId("package-build-result-dialog").isVisible() }); save();
}
(async () => {
  save(); await cache("SelfTest"); prepared = true; await cache("Prepare");
  owner = installedReleaseSession({ installationFile, out, report, save, input: author.portable.path });
  await step("installed-editor-import-and-authored-renpy-4-3", async () => {
    page = await owner.start();
    const r = await fetch(`http://127.0.0.1:${owner.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": "aspect-project.vnproj" },
      body: fs.readFileSync(author.portable.path), signal: AbortSignal.timeout(30000) });
    const payload = await r.json(); assert(r.ok && payload.ok);
    await page.reload();
    await page.locator(".recent-project-open:visible").filter({ hasText: "安装版比例隔离工程" }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    await page.locator('[data-layout-type-option="renpy"]').click(); await settleEditor(page);
    const selected = page.getByRole("combobox", { name: "画面比例", exact: true });
    assert((await selected.innerText()).includes("4:3"));
    const state = (await owner.api("/api/project/state")).project_metadata;
    assert.equal(state.settings.runtimeUILayoutProfiles.activeType, "renpy");
    assert.equal(state.settings.runtimeUILayout.gameViewport.aspectRatio, "4:3");
    return { projectId: state.project_id, layout: "renpy", ratio: "4:3" };
  });
  await step("actual-publish-settings-and-authorized-one-shot-directory", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
    await until(async () => {
      if (await dismissEnvironment()) return false;
      const s = page.locator('[data-package-stage="settings"]');
      if (!await s.isVisible()) return false;
      if (await s.getAttribute("aria-current") !== "page") { await s.click(); return false; }
      return await page.locator('[data-help-key="package.mode"]').isVisible();
    }, "installed publishing ready", 180000);
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /打包 Windows 单软件/ }).click();
    await until(async () => {
      if (await dismissEnvironment()) return false;
      return await page.locator('[data-help-key="package.export"]').getAttribute("data-environment-status") === "passed";
    }, "installed Windows environment checks", 180000);
    for (const [key, value] of [["gameId", "qa_player_aspect_windows_1936"], ["title", "AgentVN Aspect QA1936"],
      ["author", "QA"], ["version", "1.0.0"], ["description", "Player-adjustable aspect acceptance, isolated project."]])
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    for (const f of [qa, out, destination]) assert.equal(fs.realpathSync.native(f).toLowerCase(), path.resolve(f).toLowerCase());
    const token = crypto.randomUUID(), args = { token, destination };
    await page.evaluate(oneShotDirectoryResponse, { ...args, action: "install" });
    try {
      await page.locator('[data-help-key="package.chooseOutputDir"]').click();
      await page.waitForFunction(value =>
        document.querySelector('[data-help-key="package.outputDir"]')?.value === value, destination);
      report.directoryResponse = await page.evaluate(oneShotDirectoryResponse, { ...args, action: "inspect" });
      assert.equal(report.directoryResponse.calls, 1); assert.equal(report.directoryResponse.restored, true);
    } finally {
      report.directoryCleanup = await page.evaluate(oneShotDirectoryResponse, { ...args, action: "cleanup" });
      assert.equal(report.directoryCleanup.restored, true);
    }
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warnings.isVisible()) await warnings.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
    assert(await page.locator('[data-help-key="package.export"]').isEnabled());
    await owner.shot("windows-export-configured"); return { controlledDirectory: destination, nativePicker: "NOT_RUN" };
  });
  await step("one-actual-ui-windows-build-and-embedded-capability", async () => {
    assert.equal(report.builds, 0); report.builds = 1; pending = true; save();
    await page.locator('[data-help-key="package.export"]').click();
    while (true) {
      await observe();
      if (await page.getByTestId("package-build-result-dialog").isVisible()) { terminal = true; pending = false; break; }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    report.resultText = await page.getByTestId("package-build-result-dialog").innerText(); save();
    await owner.shot("windows-build-result");
    assert(report.resultText.includes("Windows 软件构建成功"), report.resultText);
    const files = [];
    function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else files.push(f);
    } }
    walk(destination); report.artifacts = files.map(desc);
    report.installer = report.artifacts.find(f => /setup\.exe$/i.test(f.path));
    report.portable = report.artifacts.find(f => /portable[\\/][^\\/]+\.exe$/i.test(f.path));
    assert(report.installer && report.portable); assert(!files.some(f => /\.msi$/i.test(f)));
    const embedded = path.join(path.dirname(report.portable.path), "embedded-cartridge");
    const manifest = read(path.join(embedded, "manifest.json")), layout = read(path.join(embedded, "ui/layout.json"));
    assert.equal(manifest.runtime_version, "0.27.0"); assert.equal(manifest.game_id, "qa_player_aspect_windows_1936");
    assert.equal(layout.layout_type, "renpy"); assert.equal(layout.gameViewport.aspectRatio, "4:3");
    report.embedded = { directory: embedded, manifest: desc(path.join(embedded, "manifest.json")),
      layout: desc(path.join(embedded, "ui/layout.json")) };
    for (const [name, relative] of [["viewport", "shared/cartridge/gameViewport.ts"],
      ["settings", "GameCli_framework/src/components/shell/SettingsScreen.tsx"],
      ["builder", "scripts/build-runtime-standalone-windows.cjs"]])
      assert(report.observedFiles.some(f => f.name === name && f.sha256 === sha(path.join(owner.installation.installRoot, relative))));
    assert(report.observedFiles.some(f => f.name === "versions" && read(f.path).editorVersion === "1.9.36"));
    return { installer: report.installer, portable: report.portable, layout: "renpy", ratio: "4:3" };
  });
  await step("natural-installed-editor-and-backend-close", async () => {
    return normalEditorClose({ owner, out, report });
  });
  assert.equal(report.steps.length, 4); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async error => {
  report.status = pending && !terminal ? "OBSERVATION_FAILED_BUILD_PRESERVED" : "FAILED";
  report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) await owner.shot("failure").catch(() => {});
}).finally(async () => {
  if (pending && !terminal) {
    report.cleanup = "LIVE_BUILD_PRESERVED_DO_NOT_RESTART"; save();
    console.log(JSON.stringify({ status: report.status, live: owner?.current, out, error: report.error })); return;
  }
  try {
    await owner?.stop("Windows aspect build final cleanup");
    if (prepared && fs.existsSync(path.join(out, "package-cache-protection.json"))) {
      await cache("Restore"); report.packageRestoration = desc(path.join(out, "package-cache-restoration.json"));
      assert.equal(read(report.packageRestoration.path).status, "PASS");
    }
    const identities = new Set([...(report.knownProcesses || []), ...report.knownBuildProcesses]
      .map(p => `${p.ProcessId}:${p.Created}`));
    assert(!rows().some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
    assert.deepEqual(listeners(report.launches.flatMap(l => l.ports)), []);
    report.cleanup = "PASS";
  } catch (error) {
    report.cleanup = "FAILED"; report.cleanupError = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, builds: report.builds, cleanup: report.cleanup,
    error: report.error, cleanupError: report.cleanupError }));
});
