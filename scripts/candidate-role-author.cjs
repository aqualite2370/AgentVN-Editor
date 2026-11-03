"use strict";
// Complete six-role authoring in the actual installed editor. Controlled project
// preparation only; all role edits, inheritance reset, save/restart/export use UI.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { normalizeInstalledControls } = require("./lib/installed-control-normalization.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const A = require("./lib/installed-acceptance.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { until, ps } = require("./lib/current-native-editor-session.cjs");
const [mode, attempt, configArg] = process.argv.slice(2);
assert(["self-test", "run"].includes(mode)); assert.match(attempt, /^\d{2}$/);
assert(configArg.startsWith("--candidate-config="));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const configFile = configArg.slice(19), config = validateCandidateConfig(read(configFile));
const actual = deriveActual(config.actual, config.version);
const root = path.resolve(__dirname, ".."), out = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}`;
const preparation = path.join(config.qa, `role-author-preparation-${attempt}`);
const installationFile = path.join(preparation, "derived-installed.json");
const priorFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-92/report.json", prior = read(priorFile);
assert.equal(prior.status, "PASS");
assert.equal(read(prior.installation).executable.sha256, actual.executable.sha256);
const roles = [
  ["title_action", "标题操作", { width: 240, height: 48, fontSize: 22, paddingX: 18, paddingY: 10 }],
  ["page_navigation", "页面导航", { width: 176, height: 42, fontSize: 20, paddingX: 14, paddingY: 8 }],
  ["category_pagination", "分类 / 分页", { width: 136, height: 40, fontSize: 18, paddingX: 12, paddingY: 8 }],
  ["story_choice", "剧情选项", { width: 320, height: 58, fontSize: 22, paddingX: 20, paddingY: 12 }],
  ["quick_bar", "快捷栏", { width: 104, height: 42, fontSize: 16, paddingX: 12, paddingY: 8 }],
  ["modal_action", "弹窗操作", { width: 144, height: 44, fontSize: 18, paddingX: 16, paddingY: 8 }],
];
const states = [["normal", "普通"], ["hover", "悬停"], ["selected", "选中"], ["disabled", "禁用"]];
const geometryLabels = { width: "按钮宽度", height: "按钮高度", fontSize: "按钮字号", paddingX: "水平内边距", paddingY: "垂直内边距" };
const expected = Object.fromEntries(roles.map(([id, , geometry], i) => [id, { geometry,
  states: Object.fromEntries(states.map(([state], j) => [state, {
    textColor: "#" + (0x94acc0 + i * 0x10200 + j * 0x301).toString(16),
    backgroundColor: ["#203447", "#324961", "#425570", "#192b3b"][j],
    borderColor: ["#52677a", "#8aa4bb", "#adc3d6", "#3e5163"][j],
    borderWidth: [1, 2, 1.5, .5][j], opacity: [1, 1, .95, .65][j],
  }])) }]));
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
if (mode === "self-test") {
  assert.equal(roles.length, 6); assert.equal(states.length, 4); assert.equal(matrix.length, 12);
  assert.equal(Object.values(expected).flatMap(r => Object.keys(r.states)).length, 24);
  assert(!fs.existsSync(out)); assert(!fs.existsSync(preparation));
  console.log(JSON.stringify({ status: "PASS", version: config.version, roles: 6, authoredStates: 24, displays: 12, productStarts: 0 }));
  return;
}
assert(!fs.existsSync(out)); assert(!fs.existsSync(preparation));
fs.mkdirSync(out); fs.mkdirSync(preparation);
const protection = read(path.join(config.qa, "control-preparation-98/derived-installed.json"));
assert.deepEqual(protection.actualInstallation, config.actual);
for (const f of protection.protectedFiles) assert.equal(sha(f.path), f.sha256);
fs.writeFileSync(installationFile, JSON.stringify({ ...actual, protectedFiles: protection.protectedFiles,
  protectedAbsent: protection.protectedAbsent }, null, 2), { flag: "wx" });
const p = fixture(`installed-roles-${config.version.replaceAll(".", "")}-${attempt}`);
p.title = "安装版六类按钮作者验收"; p.nodes[0].data.openingAudio = [];
p.nodes[1].data.scene.commands = [
  { type: "narration", text: "安装版六类按钮实际消费。" },
  { type: "choice", choices: [
    { choice_id: "continue", choice_display_name: "继续", text: "继续", target_scene_id: "ui_acceptance", conditions: [] },
    { choice_id: "again", choice_display_name: "重看", text: "重看", target_scene_id: "ui_acceptance", conditions: [] },
  ] },
];
p.editor_settings.runtimeUILayoutProfiles = structuredClone(prior.profiles);
p.editor_settings.runtimeUILayoutProfiles.activeType = "renpy";
p.editor_settings.runtimeUILayout = structuredClone(prior.profiles.profiles.renpy);
const input = path.join(out, "六类按钮隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: config.version,
  scope: "ACTUAL_INSTALLED_SIX_ROLE_FOUR_STATE_AUTHOR_INHERITANCE_RESTART_EXPORT_NOT_ALL_NATURAL_PLAYER_STATES",
  installation: desc(installationFile), fixture: desc(input), prior: desc(priorFile), expected, cases: [], matrix: [],
  screenshots: [], errors: [], launches: [], cleanups: [], modelRequests: 0, productChanges: 0, builds: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile, out, input, report, save });
let page, prepared = false, download;
const click = async n => { await n.scrollIntoViewIfNeeded(); await n.click(); };
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { windowsHide: true, encoding: "utf8", timeout: 45000 });
  (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function stage(name, fn) {
  const c = { name, status: "RUNNING" }; report.cases.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; console.log("PASS " + name); }
  catch (error) { c.status = "FAILED"; c.error = String(error.stack || error); throw error; }
  finally { c.finishedAt = new Date().toISOString(); save(); }
}
const editor = () => page.getByTestId("renpy-button-role-editor");
async function openRoles() {
  const disclosure = page.locator(".runtime-layout-inspector details").filter({ has: editor() });
  if (!await disclosure.evaluate(n => n.open)) await click(disclosure.locator("summary"));
  await editor().waitFor({ state: "visible" });
}
async function enter() {
  await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: p.title }));
  await A.settleEditor(page);
  await click(page.locator('[data-workspace-surface="options"]:visible'));
  await click(page.locator('[data-help-key="advanced.tab.layout"]:visible'));
  await page.getByTestId("renpy-title-editor").waitFor(); await A.settleEditor(page); await openRoles();
}
async function persist() {
  await click(page.locator('[data-help-key="layout.save"]:visible'));
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  const state = await A.projectSnapshot(host.current.ports[0]);
  assert.deepEqual(state.settings.runtimeUILayoutProfiles.profiles.agentvn, prior.profiles.profiles.agentvn);
  return state;
}
function verify(state) {
  const layout = state.settings.runtimeUILayoutProfiles.profiles.renpy;
  for (const [id] of roles) assert.deepEqual(layout.renpy.shared.buttonRoles[id], expected[id]);
  for (const [id] of roles) assert.equal(layout.renpy[id === "quick_bar" || id === "story_choice" ? "player" : "title"]?.buttonRoles?.[id], undefined);
}
async function fieldGeometry(target) {
  await target.scrollIntoViewIfNeeded();
  const result = await target.evaluate(n => {
    const r = n.getBoundingClientRect(), s = getComputedStyle(n);
    return { rect: r.toJSON(), visible: s.visibility === "visible" && s.display !== "none",
      hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const r = result.rect;
  assert(result.visible && result.hit && r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 &&
    r.right <= result.width + 1 && r.bottom <= result.height + 1 && result.overflow <= 1, JSON.stringify(result));
  return result;
}
(async () => {
  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  cache("SelfTest"); cache("Prepare"); prepared = true; page = await host.start();
  const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
    body: fs.readFileSync(input), signal: AbortSignal.timeout(30000) });
  const imported = await response.json(); assert(response.ok && imported.ok && imported.data.project_id === p.project_id);
  await page.reload(); await enter();
  await stage("Six complete button roles: geometry, four visual states, page override and restore inheritance", async () => {
    for (const [id, label, geometry] of roles) {
      await A.select(page, "按钮角色", label); await A.select(page, "按钮样式范围", "共享样式");
      for (const [key, value] of Object.entries(geometry)) await editor().getByLabel(geometryLabels[key], { exact: true }).fill(String(value));
      for (const [state, label] of states) {
        await A.select(page, "按钮状态", label);
        for (const [key, name] of [["textColor", "按钮文字色"], ["backgroundColor", "按钮背景色"], ["borderColor", "按钮边框色"],
          ["borderWidth", "按钮边框宽度"], ["opacity", "按钮不透明度"]])
          await editor().getByLabel(name, { exact: true }).fill(String(expected[id].states[state][key]));
      }
      await A.select(page, "按钮样式范围", ["story_choice", "quick_bar"].includes(id) ? "剧情页面覆盖" : "当前页面覆盖");
      await editor().getByLabel("按钮字号", { exact: true }).fill("39");
      assert.equal(await editor().getByTestId("renpy-title-button-role-source").innerText(), "覆盖");
      await click(editor().getByRole("button", { name: "恢复此角色共享继承", exact: true }));
      assert.equal(await editor().getByLabel("按钮字号", { exact: true }).inputValue(), String(geometry.fontSize));
      assert.equal(await editor().getByTestId("renpy-title-button-role-source").innerText(), "继承共享");
    }
    const state = await persist(); verify(state); report.authored = state; save();
    return { roles: 6, states: 24, geometryFields: 30, stateFields: 120, pageOverridesRestored: 6, otherLayoutUnchanged: true };
  });
  await stage("All twenty-four state editors remain exact and reachable across twelve actual displays", async () => {
    for (const display of matrix) {
      await host.metrics(display); await A.settleEditor(page); const row = { display, status: "RUNNING", controls: [] };
      report.matrix.push(row); save();
      for (const [id, label] of roles) {
        await A.select(page, "按钮角色", label); await A.select(page, "按钮样式范围", "共享样式");
        for (const [state, name] of states) {
          await A.select(page, "按钮状态", name);
          const values = {};
          for (const [key, label] of [["textColor", "按钮文字色"], ["backgroundColor", "按钮背景色"], ["borderColor", "按钮边框色"],
            ["borderWidth", "按钮边框宽度"], ["opacity", "按钮不透明度"]]) {
            const field = editor().getByLabel(label, { exact: true });
            values[key] = await field.inputValue();
            assert.equal(values[key], String(expected[id].states[state][key]));
          }
          row.controls.push({ role: id, state, values, geometry: await fieldGeometry(editor().getByLabel("按钮不透明度", { exact: true })) });
        }
      }
      assert.equal(row.controls.length, 24); row.status = "PASS"; save();
      await host.shot(`six-roles-${display.width}-dpr${display.dpr}-${display.reduced}`);
      console.log(`PASS six-role author ${display.width}/${display.dpr}/${display.reduced}`);
    }
    return { displays: 12, exactStateEditors: 288, fields: 1440 };
  });
  await stage("Full installed-host restart preserves shared roles, inheritance and inactive layout", async () => {
    await host.stop("Owned role author restart; normal close not claimed"); page = await host.start(); await enter();
    const state = await A.projectSnapshot(host.current.ports[0]); verify(state);
    assert.deepEqual(state.settings.runtimeUILayoutProfiles, report.authored.settings.runtimeUILayoutProfiles);
    return { actualRestart: true, bothProfilesIdentical: true };
  });
  await stage("Native portable save and actual UI cartridge export preserve all authored states", async () => {
    await click(page.locator('[data-workspace-surface="edit"]:visible')); await A.settleEditor(page);
    await click(page.getByRole("button", { name: "保存工程", exact: true }));
    const modal = page.getByTestId("project-save-confirmation"); await modal.waitFor();
    const native = /工程已保存到：([^\r\n]+\.vnproj)/.exec(await modal.innerText())?.[1]; assert(native);
    const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    assert.equal(path.resolve(path.dirname(native)).toLowerCase(), path.resolve(downloads).toLowerCase());
    assert(path.basename(native).startsWith(p.title));
    const archive = path.join(out, "完整六角色原生工程包.vnproj");
    fs.copyFileSync(native, archive, fs.constants.COPYFILE_EXCL); assert.equal(sha(native), sha(archive));
    download = desc(native); report.portable = { ...desc(archive), original: download }; save();
    const portable = await JSZip.loadAsync(fs.readFileSync(archive), { checkCRC32: true });
    const project = JSON.parse(await portable.file("project.json").async("string"));
    assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, report.authored.settings.runtimeUILayoutProfiles);
    await click(modal.getByRole("button", { name: "OK", exact: true }));
    await click(page.locator('[data-workspace-surface="publish"]:visible')); await A.settleEditor(page);
    const panel = page.locator(".cartridge-export-panel"); await panel.waitFor();
    await until(async () => {
      const dialog = page.getByTestId("package-environment-operation-dialog");
      if (await dialog.isVisible()) {
        const phase = await dialog.getAttribute("data-environment-phase");
        if (!["completed", "failed"].includes(phase)) return false;
        report.incidentalEnvironment = { phase, text: await dialog.innerText(), scope: "QA Junction, not default physical environment acceptance" }; save();
        await dialog.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
      }
      try { await panel.locator('[data-package-stage="settings"]').click({ timeout: 750 }); } catch { return false; }
      return panel.locator('[data-help-key="package.mode"]').isVisible();
    }, "actual role-author publish settings", 180000);
    await click(panel.locator('[data-help-key="package.mode"]'));
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    const warning = page.getByRole("button", { name: "查看并确认警告", exact: true }); if (await warning.isVisible()) await warning.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
    const directory = path.join(out, "cartridge"); fs.mkdirSync(directory);
    report.cartridge = await A.realDownload(page, host.cdp, directory, panel.locator('[data-help-key="package.export"]')); save();
    const zip = await JSZip.loadAsync(fs.readFileSync(report.cartridge.path), { checkCRC32: true });
    const exported = JSON.parse(await zip.file("ui/layout.json").async("string"));
    const normalized = normalizeInstalledControls(host.installation, report.authored.settings.runtimeUILayoutProfiles.profiles.renpy);
    assert.deepEqual(exported, normalized.layout); assert.deepEqual(exported.renpy.shared.buttonRoles, expected);
    report.normalization = normalized.evidence; save();
    return { actualNativePortable: true, actualCartridgeDownload: true, roles: 6, states: 24 };
  });
  assert.equal(report.cases.length, 4); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) { report.failureText = (await page.locator("body").innerText().catch(String)).slice(-10000);
    try { await host.shot("failure"); } catch (error) { report.captureError = String(error); } }
}).finally(async () => {
  try {
    await host.stop("Role author finally; exact owned cleanup");
    if (prepared) { cache("Restore"); report.nativeCacheRestoration = "PASS"; }
    if (download) {
      assert.equal(sha(download.path), download.sha256); assert.equal(sha(report.portable.path), download.sha256);
      fs.unlinkSync(download.path); report.downloadCleanup = { status: "PASS", removed: download, retained: desc(report.portable.path) };
    }
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
