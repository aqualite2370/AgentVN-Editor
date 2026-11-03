"use strict";
// Real NSIS-installed Editor, packaged backend, UI layout edits and UI exports.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { downloadUIArtifact } = require("./lib/installed-ui-completed-download.cjs");
const { ps, until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), [installationFile, output] = process.argv.slice(2);
const out = path.resolve(output || ""), qa = "F:\\AgentVN\\QA\\Player-Aspect-20261102-01";
assert(installationFile && path.dirname(out) === qa && /^session-\d{2}$/.test(path.basename(out)) && !fs.existsSync(out));
fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts", contents:
  'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
const project = fixture(`qa-installed-player-aspect-20261102-${path.basename(out)}`);
project.title = `安装版比例隔离工程_20261102_${path.basename(out)}`;
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { renpy: mod.exports.createRenpyUILayout(), agentvn: mod.exports.getDefaultUISkinLayout() } };
project.editor_settings.runtimeUILayout = structuredClone(project.editor_settings.runtimeUILayoutProfiles.profiles.renpy);
const input = path.join(out, "隔离工程.vnproj"); fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.36",
  scope: "ACTUAL_NSIS_EDITOR_AUTHOR_SAVE_RESTART_AND_UI_EXPORT_NOT_ANDROID_OR_SETUP",
  installation: desc(installationFile), input: desc(input), steps: [], cases: [], screenshots: [],
  launches: [], cleanups: [], errors: [], cartridges: [], inputs: [], modelRequests: 0,
  limitations: ["Raw public project-import API for fixture/reimport; not OS picker",
    "Explicit isolated DB/WebView; not default-account migration", "WebView viewport emulation, not physical4K",
    "Attributed process termination, not normal Editor close", "No Android, upgrade, model request or full motion verdict"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
report.testIdentity = desc(path.join(out, "executed-test.cjs"));
let host, page, protectedCache = false, mainKnown = [], nativeSaved;
async function step(name, run) {
  const item = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(item); save();
  try { item.detail = await run(); item.status = "PASS"; console.log(`PASS ${name}`); }
  catch (error) { item.status = "FAILED"; throw error; }
  finally { item.finishedAt = new Date().toISOString(); save(); }
}
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action,
    "-RunDirectory", out, "-AllowedRunRoot", qa, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.equal(result.status, 0, `Cache ${action}: ${result.stdout}\n${result.stderr}`);
}
async function open() {
  await page.locator(".project-home").waitFor(); await settleEditor(page);
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function importFile(file) {
  const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(file)) },
    body: fs.readFileSync(file), signal: AbortSignal.timeout(30000) });
  const value = await response.json(); assert(response.ok && value.ok);
  assert.equal(value.data.project_id, project.project_id);
  await page.reload(); await open();
}
async function snapshot() { return (await host.api("/api/project/state")).project_metadata; }
async function layout() {
  const close = page.getByRole("button", { name: "关闭发布与打包", exact: true });
  if (await close.isVisible()) { await close.click(); await settleEditor(page); }
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  await page.getByRole("combobox", { name: "画面比例", exact: true }).waitFor();
}
async function type(value) {
  await page.locator(`[data-layout-type-option="${value}"]`).click(); await settleEditor(page);
  await page.getByRole("combobox", { name: "画面比例", exact: true }).waitFor();
}
async function ratio(value) {
  await page.getByRole("combobox", { name: "画面比例", exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
  await page.waitForFunction(value => document.querySelector(".runtime-layout-designer")?.dataset.gameAspectRatio === value, value);
}
async function saveLayout() {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent.includes("已保存"));
}
async function preview(type, ratio) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
  });
  const value = await page.locator(type === "renpy" ? ".renpy-editor-title-game-frame" : ".runtime-layout-stage").evaluate(n => ({
    rect: n.getBoundingClientRect().toJSON(), parent: n.closest(".runtime-layout-center").getBoundingClientRect().toJSON(),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  const r = value.rect, p = value.parent, [a, b] = ratio.split(":").map(Number);
  assert(r.width > 0 && r.height > 0 && Math.abs(r.width / r.height - a / b) < .003);
  assert(r.left >= p.left - 1 && r.right <= p.right + 1 && r.top >= p.top - 1 && r.bottom <= p.bottom + 1);
  assert(value.overflow <= 1); return value;
}
async function exportGame(type) {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  const dialog = page.getByTestId("package-environment-operation-dialog");
  await until(async () => {
    if (await dialog.isVisible()) return ["completed", "failed"].includes(await dialog.getAttribute("data-environment-phase"));
    const settings = page.locator('[data-package-stage="settings"]');
    if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await settings.click(); return false; }
    return await page.locator('[data-help-key="package.mode"]').isVisible();
  }, "actual publishing UI ready", 90000);
  if (await dialog.isVisible()) {
    const phase = await dialog.getAttribute("data-environment-phase");
    (report.incidentalEnvironment ??= []).push({ type, phase, text: await dialog.innerText(),
      scope: "QA cache isolation, not full native environment acceptance" }); save();
    await dialog.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  }
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  for (const [key, value] of [["gameId", `${project.project_id}-${type}`], ["title", `${project.title}-${type}`],
    ["author", "QA"], ["description", "本轮比例隔离验收"]])
    await page.locator(`[data-help-key="package.${key}"]`).fill(value);
  const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warnings.isVisible()) await warnings.click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
  const directory = path.join(out, `cartridge-${type}`); fs.mkdirSync(directory);
  const result = await downloadUIArtifact({ cdp: host.cdp, trigger: page.locator('[data-help-key="package.export"]'),
    directory, report, save, until });
  const zip = await JSZip.loadAsync(fs.readFileSync(result.path), { checkCRC32: true });
  const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.equal(skin.gameViewport.aspectRatio, "4:3"); assert.equal(skin.layout_type ?? "agentvn", type);
  assert.equal(manifest.runtime_version, "0.27.0"); assert.equal(manifest.game_id, `${project.project_id}-${type}`);
  report.cartridges.push({ ...result, type, ratio: "4:3" }); save();
  // Distinct B identity is explicitly a controlled isolation fixture; all UI bytes stay unchanged.
  const layoutBytes = await zip.file("ui/layout.json").async("string");
  manifest.game_id += "-B"; manifest.title += "-B"; zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  script.game_id = manifest.game_id; script.title = manifest.title; zip.file("script.json", JSON.stringify(script, null, 2));
  const checksums = JSON.parse(await zip.file("checksum.json").async("string"));
  for (const item of checksums.files) {
    const bytes = await zip.file(item.path).async("nodebuffer");
    item.size_bytes = bytes.length; item.hash_sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  }
  zip.file("checksum.json", JSON.stringify(checksums, null, 2));
  assert.equal(await zip.file("ui/layout.json").async("string"), layoutBytes);
  const second = path.join(out, `${type}-B.vncart`);
  fs.writeFileSync(second, await zip.generateAsync({ type: "nodebuffer" }), { flag: "wx" });
  report.inputs.push({ type, file: result.path, sha256: result.sha256, second, secondSha256: sha(second),
    secondIsControlledIdentityFixture: true }); save(); return result;
}
(async () => {
  save(); cache("SelfTest"); protectedCache = true; cache("Prepare");
  host = installedReleaseSession({ installationFile, out, report, save, input });
  await step("actual-installed-author-all-three-ratios-both-layouts", async () => {
    page = await host.start(); await importFile(input); await layout();
    for (const t of ["renpy", "agentvn"]) {
      await type(t);
      for (const r of ["16:9", "16:10", "4:3"]) {
        await ratio(r); await saveLayout(); const data = await snapshot();
        assert.equal(data.settings.runtimeUILayoutProfiles.profiles[t].gameViewport.aspectRatio, r);
        assert.equal(data.settings.runtimeUILayout.gameViewport.aspectRatio, r);
        if (t === "renpy") assert.deepEqual(data.settings.runtimeUILayoutProfiles.profiles.agentvn,
          project.editor_settings.runtimeUILayoutProfiles.profiles.agentvn);
        else assert.equal(data.settings.runtimeUILayoutProfiles.profiles.renpy.gameViewport.aspectRatio, "4:3");
        report.cases.push({ name: "real-layout-save", type: t, ratio: r, preview: await preview(t, r), status: "PASS" }); save();
      }
      await exportGame(t); await layout();
    }
  });
  await step("installed-designer-ratio-controls-and-preview-12-combinations", async () => {
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const m = { width, height: width * 9 / 16, dpr, reduced }; await host.metrics(m);
      for (const t of ["renpy", "agentvn"]) {
        await type(t); const previews = [];
        for (const r of ["16:9", "16:10", "4:3"]) { await ratio(r); previews.push({ ratio: r, ...await preview(t, r) }); }
        await saveLayout(); report.cases.push({ name: "installed-designer-matrix", type: t, ...m, previews, status: "PASS" }); save();
      }
      if (dpr === 2 && !reduced) await host.shot(`designer-${width}-d2`);
    }
    await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    report.expectedProfiles = (await snapshot()).settings.runtimeUILayoutProfiles;
  });
  await step("native-project-save-and-actual-host-backend-restart", async () => {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    const before = new Set(fs.readdirSync(downloads));
    await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
    const files = fs.readdirSync(downloads).filter(n => !before.has(n) && n.startsWith(project.title) && n.endsWith(".vnproj"));
    assert.equal(files.length, 1); nativeSaved = desc(path.join(downloads, files[0])); report.nativeSaved = nativeSaved; save();
    assert((await dialog.innerText()).includes(nativeSaved.path));
    const retained = path.join(out, "保存后双布局.vnproj"); fs.copyFileSync(nativeSaved.path, retained, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(retained), nativeSaved.sha256); report.portable = desc(retained); save();
    const packed = await JSZip.loadAsync(fs.readFileSync(retained), { checkCRC32: true });
    const payload = JSON.parse(await packed.file("project.json").async("string"));
    assert.deepEqual(payload.editor_settings.runtimeUILayoutProfiles, report.expectedProfiles);
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    await host.stop("Persistence restart, not normal close"); page = await host.start(); await open();
    assert.deepEqual((await snapshot()).settings.runtimeUILayoutProfiles, report.expectedProfiles);
    await host.stop("Independent database reimport follows"); mainKnown = report.knownProcesses;
  });
  await step("independent-installed-database-reimport-and-preview", async () => {
    const fresh = path.join(out, "independent"); fs.mkdirSync(fresh);
    host = installedReleaseSession({ installationFile, out: fresh, report, save, input: report.portable.path });
    page = await host.start(); await importFile(report.portable.path); await layout();
    assert.deepEqual((await snapshot()).settings.runtimeUILayoutProfiles, report.expectedProfiles);
    for (const t of ["renpy", "agentvn"]) { await type(t); await preview(t, "4:3"); }
    await host.shot("independent-reopen");
  });
  assert.equal(report.steps.length, 4); assert.equal(report.cases.length, 30);
  assert.equal(report.cartridges.length, 2); assert.equal(report.inputs.length, 2);
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0);
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) report.failureDOM = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try {
    await host?.stop("Final attributed cleanup");
    if (mainKnown.length) report.knownProcesses = [...mainKnown, ...report.knownProcesses];
    if (protectedCache && fs.existsSync(path.join(out, "native-cache-protection.json"))) {
      cache("Restore"); report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
      assert.equal(read(report.cacheRestoration.path).status, "PASS");
    }
    if (nativeSaved && report.portable) {
      assert.equal(sha(nativeSaved.path), nativeSaved.sha256); assert.equal(sha(report.portable.path), nativeSaved.sha256);
      fs.unlinkSync(nativeSaved.path); report.downloadCleanup = { status: "PASS", removed: nativeSaved,
        retained: report.portable, deletedUserFiles: 0 };
    }
    report.cleanup = "PASS";
  } catch (error) {
    report.cleanup = "FAILED"; report.cleanupError = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, cleanup: report.cleanup,
    error: report.error, cleanupError: report.cleanupError }));
});
