"use strict";
// Actual installed author -> native save/restart -> both UI cartridge exports.
// Only the isolated project's Ren'Py save grid is edited. AgentVN is invariant.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { normalizeInstalledControls } = require("./lib/installed-control-normalization.cjs");
const A = require("./lib/installed-acceptance.cjs");
const { until, ps } = require("./lib/current-native-editor-session.cjs");
const [mode, attempt, configArg, ...profileArgs] = process.argv.slice(2);
assert(["self-test", "run"].includes(mode)); assert.match(attempt || "", /^\d{2}$/);
assert(configArg?.startsWith("--candidate-config="));
assert(profileArgs.length === 0 || profileArgs.length === 1
  && /^--profile-author=\d{2}$/.test(profileArgs[0]), "Only an explicit two-digit profile author is supported");
const profileAuthor = profileArgs.length ? profileArgs[0].slice(17) : "28";
const root = path.resolve(__dirname, ".."), read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const configFile = configArg.slice(19), config = validateCandidateConfig(read(configFile));
const installed = deriveActual(config.actual, config.version);
const priorFile = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${profileAuthor}/report.json`, prior = read(priorFile);
assert.equal(prior.status, "PASS"); assert.equal(prior.version, config.version);
assert(prior.finishedAt && !prior.cleanupError);
assert.equal(prior.scope, "ACTUAL_INSTALLED_SIX_ROLE_FOUR_STATE_AUTHOR_INHERITANCE_RESTART_EXPORT_NOT_ALL_NATURAL_PLAYER_STATES");
assert.deepEqual(read(prior.installation.path).executable, installed.executable);
const out = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}`;
assert(!fs.existsSync(out));
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const originalProfiles = prior.authored.settings.runtimeUILayoutProfiles;
assert.equal(originalProfiles.profiles.renpy.renpy.save_load.saveColumns, undefined);
if (mode === "self-test") {
  assert.equal(matrix.length, 12);
  console.log(JSON.stringify({ status: "PASS", version: config.version, author: desc(priorFile), displays: 12,
    inactiveDefaultLayoutInvariant: true, productStarts: 0 }));
  return;
}
fs.mkdirSync(out);
const installationFile = path.join(out, "derived-installed.json");
fs.writeFileSync(installationFile, JSON.stringify(installed, null, 2), { flag: "wx" });
const project = read(prior.fixture.path);
project.project_id = `qa-save-grid-${config.version.replaceAll(".", "")}-${attempt}`;
project.title = "作者两列存档隔离工程";
project.editor_settings.runtimeUILayoutProfiles = structuredClone(originalProfiles);
project.editor_settings.runtimeUILayout = structuredClone(originalProfiles.profiles.renpy);
const input = path.join(out, "两列存档 隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const report = { status: "RUNNING", version: config.version, startedAt: new Date().toISOString(),
  scope: "CURRENT_INSTALLED_TWO_COLUMN_RENPY_AUTHOR_UI_EXPORT_NOT_PLAYER_SETUP_UPGRADE_OR_ANDROID",
  candidateConfig: desc(configFile), installation: desc(installationFile), source: desc(priorFile), fixture: desc(input),
  steps: [], matrix: [], screenshots: [], launches: [], cleanups: [], errors: [], cartridges: [],
  productChanges: 0, builds: 0, modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const owner = installedReleaseSession({ installationFile, out, input, report, save });
const click = async n => { await n.scrollIntoViewIfNeeded(); await n.click(); };
let page, prepared = false, download;
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { windowsHide: true, encoding: "utf8", timeout: 45000 });
  (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function stage(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; console.log("PASS " + name); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
async function enter() {
  await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }));
  await A.settleEditor(page);
  await click(page.locator('[data-workspace-surface="options"]:visible'));
  await click(page.locator('[data-help-key="advanced.tab.layout"]:visible')); await A.settleEditor(page);
  await page.getByTestId("renpy-title-editor").waitFor();
  await click(page.getByRole("button", { name: "存档/读档", exact: true }));
}
const gridSection = () => page.getByRole("region", { name: "存档网格结构", exact: true });
async function persist() {
  await click(page.locator('[data-help-key="layout.save"]:visible'));
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  const state = await A.projectSnapshot(owner.current.ports[0]);
  assert.deepEqual(state.settings.runtimeUILayoutProfiles.profiles.agentvn, originalProfiles.profiles.agentvn);
  return state;
}
async function verifyPreview() {
  const frame = page.frameLocator("iframe[title=\"Ren'Py（进阶）实际页面预览\"]");
  await frame.getByTestId("save-slot-grid").waitFor();
  await frame.locator('[data-testid="save-slot-grid"][data-renpy-save-columns="2"]').waitFor();
  return frame.getByTestId("save-slot-grid").evaluate(grid => {
    const r = grid.getBoundingClientRect();
    const columns = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
    return { columns, attribute: grid.getAttribute("data-renpy-save-columns"), cards: grid.querySelectorAll(".save-slot").length,
      width: r.width, height: r.height, overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
async function publish(type) {
  await click(page.locator('[data-workspace-surface="publish"]:visible')); await A.settleEditor(page);
  const panel = page.locator(".cartridge-export-panel"); await panel.waitFor();
  await until(async () => {
    const modal = page.getByTestId("package-environment-operation-dialog");
    if (await modal.isVisible()) {
      const phase = await modal.getAttribute("data-environment-phase");
      if (!["completed", "failed"].includes(phase)) return false;
      (report.incidentalEnvironment ??= []).push({ phase, text: await modal.innerText(),
        scope: "QA cache isolation, not default physical packaging environment" }); save();
      await modal.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
      await modal.waitFor({ state: "detached" });
    }
    try { await panel.locator('[data-package-stage="settings"]').click({ timeout: 750 }); } catch { return false; }
    return panel.locator('[data-help-key="package.mode"]').isVisible();
  }, "actual installed grid-author export settings", 180000);
  await click(panel.locator('[data-help-key="package.mode"]'));
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warning.isVisible()) await warning.click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
  const directory = path.join(out, `cartridge-${type}`); fs.mkdirSync(directory);
  const file = await A.realDownload(page, owner.cdp, directory, panel.locator('[data-help-key="package.export"]'));
  const zip = await JSZip.loadAsync(fs.readFileSync(file.path), { checkCRC32: true });
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const expected = normalizeInstalledControls(owner.installation, report.authored.settings.runtimeUILayoutProfiles.profiles[type]);
  assert.deepEqual(layout, expected.layout);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  if (type === "renpy") assert.equal(layout.renpy.save_load.saveColumns, 2);
  assert.equal(manifest.assets.length, 0);
  for (const item of JSON.parse(await zip.file("checksum.json").async("string")).files)
    assert.equal(A.sha256(await zip.file(item.path).async("nodebuffer")), item.hash_sha256);
  const value = { ...file, layout: type, gameId: manifest.game_id };
  report.cartridges.push(value); save(); return value;
}
(async () => {
  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  cache("SelfTest"); cache("Prepare"); prepared = true; page = await owner.start();
  const response = await fetch(`http://127.0.0.1:${owner.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
    body: fs.readFileSync(input), signal: AbortSignal.timeout(30000) });
  const payload = await response.json(); assert(response.ok && payload.ok && payload.data.project_id === project.project_id);
  await page.reload(); await enter();
  await stage("Author shared inheritance, explicit two columns, restore, reapply and save", async () => {
    const section = gridSection();
    assert.equal(await section.getByTestId("renpy-save-grid-columns-source").innerText(), "继承");
    await click(section.getByRole("button", { name: "覆盖存档列数", exact: true }));
    await section.getByRole("spinbutton", { name: "存档网格列数", exact: true }).fill("2");
    await click(section.getByRole("button", { name: "恢复存档列数继承", exact: true }));
    assert.equal(await section.getByTestId("renpy-save-grid-columns-source").innerText(), "继承");
    await click(section.getByRole("button", { name: "覆盖存档列数", exact: true }));
    await section.getByRole("spinbutton", { name: "存档网格列数", exact: true }).fill("2");
    report.authored = await persist(); save();
    assert.equal(report.authored.settings.runtimeUILayoutProfiles.profiles.renpy.renpy.save_load.saveColumns, 2);
    const unchanged = structuredClone(report.authored.settings.runtimeUILayoutProfiles);
    delete unchanged.profiles.renpy.renpy.save_load.saveColumns;
    assert.deepEqual(unchanged, originalProfiles);
    for (const display of matrix) {
      await owner.metrics(display); await A.settleEditor(page);
      await section.getByRole("spinbutton", { name: "存档网格列数", exact: true }).scrollIntoViewIfNeeded();
      const field = await section.getByRole("spinbutton", { name: "存档网格列数", exact: true }).evaluate(n => {
        const rect = n.getBoundingClientRect().toJSON();
        return { rect, hit: n.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
          overflow: document.documentElement.scrollWidth - innerWidth, value: n.value };
      });
      assert(field.hit && field.overflow <= 1 && field.value === "2");
      const preview = await verifyPreview(); assert.equal(preview.columns, 2); assert.equal(preview.cards, 6);
      assert.equal(preview.attribute, "2"); assert(preview.width > 0 && preview.height > 0 && preview.overflow <= 1);
      report.matrix.push({ display, status: "PASS", field, preview }); save();
    }
    await owner.shot("authored-two-columns");
    return { actualUiEdited: true, displays: 12, otherLayoutUnchanged: true };
  });
  await stage("Native portable bytes and full host restart preserve the two-column override", async () => {
    await click(page.locator('[data-workspace-surface="edit"]:visible')); await A.settleEditor(page);
    await click(page.getByRole("button", { name: "保存工程", exact: true }));
    const modal = page.getByTestId("project-save-confirmation"); await modal.waitFor();
    const native = /工程已保存到：([^\r\n]+\.vnproj)/.exec(await modal.innerText())?.[1]; assert(native);
    const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    assert.equal(path.resolve(path.dirname(native)).toLowerCase(), path.resolve(downloads).toLowerCase());
    const archived = path.join(out, "两列存档原生工程包.vnproj");
    fs.copyFileSync(native, archived, fs.constants.COPYFILE_EXCL); assert.equal(sha(native), sha(archived));
    download = desc(native); report.portable = desc(archived); save();
    const portable = await JSZip.loadAsync(fs.readFileSync(archived), { checkCRC32: true });
    assert.deepEqual(JSON.parse(await portable.file("project.json").async("string")).editor_settings.runtimeUILayoutProfiles,
      report.authored.settings.runtimeUILayoutProfiles);
    await click(modal.getByRole("button", { name: "OK", exact: true }));
    await owner.stop("Owned host restart; not normal-close evidence"); page = await owner.start(); await enter();
    const state = await A.projectSnapshot(owner.current.ports[0]);
    assert.deepEqual(state.settings.runtimeUILayoutProfiles, report.authored.settings.runtimeUILayoutProfiles);
    assert.equal(await gridSection().getByRole("spinbutton", { name: "存档网格列数", exact: true }).inputValue(), "2");
    return { nativePortableBytes: true, realHostRestart: true };
  });
  await stage("Both actual UI exports retain author state and default AgentVN remains unchanged", async () => {
    await publish("renpy");
    await click(page.getByRole("button", { name: "关闭发布与打包", exact: true }));
    await click(page.locator('[data-workspace-surface="options"]:visible'));
    await click(page.locator('[data-help-key="advanced.tab.layout"]:visible')); await A.settleEditor(page);
    await click(page.locator('[data-layout-type-option="agentvn"]:visible'));
    await page.waitForFunction(() => document.querySelector(".runtime-layout-designer")?.dataset.layoutType === "agentvn"
      && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    await A.settleEditor(page);
    const state = await A.projectSnapshot(owner.current.ports[0]);
    assert.deepEqual(state.settings.runtimeUILayoutProfiles.profiles, report.authored.settings.runtimeUILayoutProfiles.profiles);
    await publish("agentvn"); return { actualCartridgeExports: 2, activeTypeOnlyChanged: true };
  });
  assert.equal(report.steps.length, 3); assert(report.steps.every(s => s.status === "PASS"));
  assert.equal(report.matrix.length, 12); assert.equal(report.cartridges.length, 2); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) {
    report.failureText = (await page.locator("body").innerText().catch(String)).slice(-8000);
    await owner.shot("failure").catch(error => { report.captureError = String(error); });
  }
}).finally(async () => {
  const errors = [];
  for (const action of [
    () => owner.stop("Author finally; exact owned process cleanup"),
    () => { if (prepared) { cache("Restore"); report.nativeCacheRestoration = "PASS"; } },
    () => { if (download) {
      assert.equal(sha(download.path), download.sha256); assert.equal(sha(report.portable.path), download.sha256);
      fs.unlinkSync(download.path); report.downloadCleanup = { status: "PASS", removed: download, retained: report.portable };
    } },
  ]) try { await action(); } catch (e) { errors.push(String(e.stack || e)); }
  if (errors.length) { report.status = "FAILED"; report.cleanupError = errors; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
