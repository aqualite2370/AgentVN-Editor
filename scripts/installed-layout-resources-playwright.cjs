"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright"), JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-layout-resources-20261018-01");
const work = "F:/AgentVN-QA-InstalledLayoutResources-20261018-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const out = process.argv[2], attempt = Number(process.argv[3] || 1), previousFile = process.argv[4];
assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
assert(attempt === 1 || attempt === 2); assert.equal(Boolean(previousFile), attempt === 2);
const prep = read(path.join(run, "preparation.json")), fixture = read(path.join(run, "fixtures.json"));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), path.resolve(run));
const launch = read(path.join(run, attempt === 1 ? "launch.json" : "launch-02.json"));
fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), attempt, checks: [], matrix: [], screenshots: [],
  cartridges: [], projectArtifacts: [], productFailures: [], pageErrors: [], productChanges: 0, realModelRequests: 0,
  source: { fixtureFile: path.join(run, "fixtures.json"), fixtureSha256: A.sha256(fs.readFileSync(path.join(run, "fixtures.json"))) },
  scope: "ACTUAL_NSIS_EDITOR_REAL_UI_LAYOUT_SWITCH_NATIVE_DEFAULT_SAVE_CARTRIDGE_EXPORT; controlled backend seed/reimport",
  boundaries: { nativeProjectPickerClaim: false, nativeDirectoryPickerClaim: false, standalonePackageClaim: false,
    completeMotionClaim: false, physical4KMonitorClaim: false, userProjectUsed: false }, error: null };
report.tools = ["scripts/installed-layout-resources-playwright.cjs", "scripts/installed-layout-resources-fixtures.cjs",
  "scripts/lib/installed-acceptance.cjs", "scripts/lib/installed-webview-capture.cjs"]
  .map(f => ({ path: path.join(root, f), sha256: A.sha256(fs.readFileSync(path.join(root, f))) }));
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser, page, cdp, expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
async function step(name, fn, productOracle = false) {
  const row = { name, status: "RUNNING", productOracle }; report.checks.push(row); save();
  try { row.detail = await fn(row); row.status = "PASS"; }
  catch (e) {
    row.status = "FAILED"; row.error = String(e.stack || e);
    if (productOracle) report.productFailures.push({ code: "LAYOUT-RES-01", name, error: row.error });
    else throw e;
  } finally { save(); console.log(`${row.status} ${name}`); }
}
async function metrics(v) {
  expected = v;
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: false,
  });
  await page.emulateMedia({ reducedMotion: v.reduced ? "reduce" : "no-preference" });
  await readInstalledViewport(page, v);
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); save();
}
const profiles = () => page.evaluate(() =>
  JSON.parse(JSON.stringify(window.__AGENTVN_PROJECT_STORE__.getState().settings.runtimeUILayoutProfiles)));
async function options() {
  const close = page.getByRole("button", { name: "关闭发布与打包", exact: true });
  if (await close.isVisible()) { await close.click(); await A.settleEditor(page); }
  if (!await page.locator(".workspace-task-panel.is-open .runtime-layout-designer").count()) {
    await page.locator('[data-workspace-surface="options"]:visible').click(); await A.settleEditor(page);
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
  }
}
async function type(type) {
  await options();
  const before = await profiles();
  if (before.activeType !== type) await page.locator(`.runtime-layout-type-switch [data-layout-type-option="${type}"]:visible`).click();
  await page.locator(`.runtime-layout-designer[data-layout-type="${type}"]:visible`).waitFor();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  await A.settleEditor(page);
  const after = await profiles(); assert.equal(after.activeType, type);
  assert.deepEqual(after.profiles, before.profiles, "Switch must preserve both profile payloads");
  return after;
}
async function saveProject(type) {
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
  const before = await profiles();
  await page.getByRole("button", { name: "保存工程", exact: true }).click();
  const confirm = page.getByTestId("project-save-confirmation"); await confirm.waitFor();
  const text = await confirm.innerText();
  const matched = text.match(/工程已保存到：([^\r\n]+\.vnproj)/); assert(matched, text);
  const file = matched[1].trim(); assert(path.isAbsolute(file) && fs.existsSync(file));
  assert.equal(path.dirname(file).toLowerCase(), "c:\\users\\1\\downloads", "This slice uses only actual default save directory");
  const bytes = fs.readFileSync(file), zip = await JSZip.loadAsync(bytes);
  const project = JSON.parse(await zip.file("project.json").async("string"));
  assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, before);
  assert.deepEqual(project.editor_settings.runtimeUILayout, before.profiles[type]);
  assert.equal(project.asset_manifest.length, fixture.resources.length);
  const resourceChecks = [];
  for (const r of fixture.resources) {
    const a = project.asset_manifest.find(a => a.asset_id === r.id); assert(a);
    const item = zip.file(a.metadata.project_path); assert(item, r.id);
    const actual = A.sha256(await item.async("nodebuffer")); assert.equal(actual, r.sha256);
    resourceChecks.push({ id: r.id, path: a.metadata.project_path, sha256: actual });
  }
  const retained = path.join(work, `${path.basename(out)}-${type}-portable.vnproj`);
  fs.copyFileSync(file, retained, fs.constants.COPYFILE_EXCL); assert.equal(A.sha256(fs.readFileSync(retained)), A.sha256(bytes));
  const artifact = { path: file, retained, sha256: A.sha256(bytes), bytes: bytes.length,
    generatedAt: fs.statSync(file).mtime.toISOString(), activeType: type, resources: resourceChecks, profiles: before,
    source: "real native write_project_bundle triggered by Save Project UI" };
  report.projectArtifacts.push(artifact); save();
  await shot(`${type}-native-project-saved`);
  await confirm.getByRole("button", { name: "OK", exact: true }).click();
  return artifact;
}
async function publish(type) {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await A.settleEditor(page);
  await page.locator(".cartridge-export-panel").waitFor();
  if (await page.locator(".windows-env-panel").count()) await page.waitForFunction(() =>
    ["passed", "failed"].includes(document.querySelector(".windows-env-panel")?.getAttribute("data-environment-verification")),
  null, { timeout: 120000 });
  const complete = page.locator(".android-env-import-backdrop:visible").filter({ hasText: "环境检测已完成" });
  if (await complete.count()) {
    await complete.getByRole("button", { name: "完成", exact: true }).click(); await complete.waitFor({ state: "hidden" });
  }
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warn = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warn.isVisible()) await warn.click();
  const warnings = await page.locator(".preflight-check.is-warning").allTextContents();
  const confirm = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await confirm.isVisible()) await confirm.check();
  const directory = path.join(work, `${path.basename(out)}-cartridge-${type}`); assert(!fs.existsSync(directory)); fs.mkdirSync(directory);
  const artifact = await A.realDownload(page, cdp, directory, page.locator('[data-help-key="package.export"]'));
  const zip = await JSZip.loadAsync(fs.readFileSync(artifact.path));
  const manifestBytes = await zip.file("manifest.json").async("nodebuffer"), manifest = JSON.parse(manifestBytes);
  const skinBytes = await zip.file("ui/layout.json").async("nodebuffer"), skin = JSON.parse(skinBytes);
  const scriptBytes = await zip.file("script.json").async("nodebuffer");
  const collection = await profiles();
  assert.equal(manifest.game_id, fixture.projectId); assert.equal(skin.layout_type || "agentvn", type);
  assert(!skin.runtimeUILayoutProfiles && !skin.profiles, "Cartridge must not carry the editor profile collection");
  assert.equal(skin.name, collection.profiles[type].name);
  assert.equal(manifest.shell.background, "qa-res-shell-protected");
  assert(!zip.file("project.json"), "No editor portable project inside game cartridge");
  const mustKeep = [`${type === "agentvn" ? "agent" : "renpy"}-only`, "shared", "story-protected", "shell-protected", "gallery-protected"].map(id => `qa-res-${id}`);
  const forbidden = `qa-res-${type === "agentvn" ? "renpy" : "agent"}-only`;
  const resourceChecks = [];
  for (const r of fixture.resources) {
    const entry = manifest.assets.find(a => a.asset_id === r.id);
    if (mustKeep.includes(r.id)) assert(entry, `Missing required ${r.id}`);
    if (r.id === forbidden) assert(!entry, `Inactive-exclusive resource leaked: ${r.id}`);
    if (entry) {
      assert(zip.file(entry.path), entry.path);
      assert.equal(A.sha256(await zip.file(entry.path).async("nodebuffer")), r.sha256);
      resourceChecks.push({ id: r.id, path: entry.path, sha256: r.sha256, present: true });
    } else resourceChecks.push({ id: r.id, present: false });
  }
  const forbiddenResource = fixture.resources.find(r => r.id === forbidden);
  assert(!Object.values(zip.files).some(f => !f.dir && f.name === forbiddenResource.projectPath));
  const item = { ...artifact, type, manifestSha256: A.sha256(manifestBytes), layoutSha256: A.sha256(skinBytes),
    scriptSha256: A.sha256(scriptBytes), resources: resourceChecks, expectedIds: mustKeep,
    actualIds: manifest.assets.map(a => a.asset_id), warnings,
    inactiveExclusiveRemoved: true, protectedDependenciesPreserved: true };
  if (report.cartridges.length) assert.equal(item.scriptSha256, report.cartridges[0].scriptSha256);
  report.cartridges.push(item); save(); await shot(`${type}-ui-cartridge-export`);
  return item;
}
(async () => {
  assert.equal(A.sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  assert.equal(A.sha256(fs.readFileSync(fixture.input)), fixture.inputSha256);
  report.launch = launch;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(45000); page.on("pageerror", e => report.pageErrors.push(String(e)));
  cdp = await page.context().newCDPSession(page); await metrics(expected);
  await step("Controlled real backend import then real homepage click loads isolated resource project", async () => {
    let input = fixture.input;
    if (previousFile) {
      const previous = read(previousFile);
      assert(previous.projectArtifacts.length >= 1 && previous.checks.some(c => c.name.includes("native portable") && c.status === "PASS"));
      input = previous.projectArtifacts[0].retained;
      assert.equal(A.sha256(fs.readFileSync(input)), previous.projectArtifacts[0].sha256);
      report.reimport = { previousFile, previousSha256: A.sha256(fs.readFileSync(previousFile)),
        input, sha256: A.sha256(fs.readFileSync(input)), method: "ACTUAL_BACKEND_PORTABLE_IMPORT_NOT_NATIVE_PICKER" };
      assert.notEqual(launch.editorPid, previous.launch.editorPid, "A new actual Editor process is required");
    }
    const r = await fetch(`http://127.0.0.1:${launch.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
      body: fs.readFileSync(input), signal: AbortSignal.timeout(30000),
    });
    const payload = await r.json(); assert(r.ok && payload.ok && payload.data.project_id === fixture.projectId, JSON.stringify(payload));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    const current = await profiles();
    assert.equal(current.activeType, "agentvn"); assert.equal(Object.keys(current.profiles).length, 2);
    // Normalisation is allowed once on actual load; capture actual authoritative
    // profiles and thereafter demand exact equality across every real switch/save.
    report.baselineProfiles = current;
    for (const type of ["agentvn", "renpy"]) {
      assert.equal(current.profiles[type].name, fixture.profiles.profiles[type].name);
      assert.deepEqual(current.profiles[type].assets, fixture.profiles.profiles[type].assets);
    }
    return { projectId: fixture.projectId, actualProcessId: launch.editorPid, input, controlledImport: true };
  });
  if (attempt === 1) await step("Twelve real WebView combinations switch both types without altering either saved profile or button geometry", async () => {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2])
      for (const reduced of [false, true]) {
        await metrics({ width, height, dpr, reduced });
        const row = { ...expected, status: "RUNNING", types: [] };
        for (const target of ["renpy", "agentvn"]) {
          const current = await type(target); assert.deepEqual(current.profiles, report.baselineProfiles.profiles);
          const geometry = await page.locator(".runtime-layout-type-switch:visible").evaluate(group => ({
            rect: group.getBoundingClientRect().toJSON(), overflow: document.documentElement.scrollWidth - innerWidth,
            buttons: [...group.querySelectorAll("button")].map(b => {
              const r = b.getBoundingClientRect(), c = getComputedStyle(b);
              return { type: b.dataset.layoutTypeOption, rect: r.toJSON(), hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
                clipped: b.scrollWidth > b.clientWidth + 1, opacity: Number(c.opacity), disabled: b.disabled, inert: Boolean(b.closest("[inert]")) };
            }),
          }));
          assert.equal(geometry.buttons.length, 2); assert(geometry.overflow <= 1);
          for (const b of geometry.buttons) assert(b.hit && !b.clipped && !b.disabled && !b.inert && b.opacity > 0
            && b.rect.x >= -1 && b.rect.y >= -1 && b.rect.right <= width + 1 && b.rect.bottom <= height + 1);
          assert(geometry.buttons[0].rect.right <= geometry.buttons[1].rect.x + 1);
          if (row.types.length) for (let i = 0; i < 2; i++) for (const k of ["x", "y", "width", "height"])
            assert(Math.abs(row.types[0].geometry.buttons[i].rect[k] - geometry.buttons[i].rect[k]) <= 1, `Type switch moved ${k}`);
          row.types.push({ target, geometry });
          if (target === "renpy") await shot(`switch-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}`);
        }
        row.status = "PASS"; report.matrix.push(row); save();
      }
    assert.equal(report.matrix.length, 12); return { combinations: 12, actualTypeNavigations: 24, fullMotionClaim: false };
  });
  await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
  for (const target of ["agentvn", "renpy"]) {
    await step(`${target}: native portable save retains both layouts and all seven original resource byte payloads`, async () => {
      await type(target); return saveProject(target);
    });
    await step(`${target}: real UI game export removes inactive-exclusive image and protects shared/story/shell/gallery bytes`, async () => {
      await type(target); return publish(target);
    });
    await step(`${target}: game export contains only active layout and its actual dependencies, not unused library files`, row => {
      const cartridge = report.cartridges.find(c => c.type === target);
      row.actualIds = cartridge.actualIds; row.expectedIds = cartridge.expectedIds;
      assert.deepEqual([...cartridge.actualIds].sort(), [...cartridge.expectedIds].sort(),
        "Unused library asset must not leak into minimal runtime dependency export");
      return { minimalDependencySet: true };
    }, true);
  }
  assert.equal(report.pageErrors.length, 0);
  report.status = report.productFailures.length ? "FAILED" : "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) {
    report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-8000);
    await shot("tool-or-flow-failure").catch(() => {});
  }
}).finally(async () => {
  report.finishedAt = new Date().toISOString(); save(); await browser?.close();
  if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, cartridges: report.cartridges.length,
    matrix: report.matrix.length, productFailures: report.productFailures.length, error: report.error, out }));
});
