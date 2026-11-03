"use strict";
// Actual installed Editor, auto-started backend and actual Runtime iframe.
// No store access, source server, UI state mock, model call or user project.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime, projectSnapshot } = require("./lib/installed-acceptance.cjs");
const [mode = "survey", attempt = "32"] = process.argv.slice(2);
assert(["survey", "author"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const root = path.resolve(__dirname, ".."), out = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const input = path.join(out, "双布局全页面独立工程.vnproj"), p = fixture(`layout-pages-${attempt}`);
p.title = `安装版双布局全页面 ${attempt}`;
p.nodes[0].data.openingAudio = [];
fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
// Explicitly opt in to a newer, already installed candidate. The old default
// remains attached to its original receipt; never silently relabel old results.
const auditArgument = process.argv.slice(4).find(arg => arg.startsWith("--audit="));
const codexCacheView = process.argv.slice(4).includes("--codex-cache-view");
const typeArgument = process.argv.slice(4).find(arg => arg.startsWith("--type="));
const types = typeArgument ? [typeArgument.slice("--type=".length)] : ["agentvn", "renpy"];
assert(types.every(type => ["agentvn", "renpy"].includes(type)));
const displayMatrix = process.argv.includes("--matrix")
  ? [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))))
  : [{ width: 1920, height: 1080, dpr: 1, reduced: false }];
let installationFile = "F:/AgentVN/QA/Editor-1.9.13-20261021-01/installation.json";
if (auditArgument) {
  const auditFile = path.resolve(auditArgument.slice("--audit=".length));
  assert(auditFile.startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
  const audit = JSON.parse(fs.readFileSync(auditFile, "utf8").replace(/^\uFEFF/, ""));
  assert.equal(audit.status, "PASS");
  const deployed = audit.deployments.filter(d => d.kind === "NSIS actual isolated installation");
  assert.equal(deployed.length, 1);
  const actualFile = deployed[0].installationReport;
  const actual = JSON.parse(fs.readFileSync(actualFile, "utf8").replace(/^\uFEFF/, ""));
  assert.equal(actual.status, "PASS"); assert.equal(actual.registryRestored, true);
  assert.equal(path.resolve(actual.installRoot), path.resolve(deployed[0].installedRoot));
  assert.equal(sha(actual.executable.path), actual.executable.sha256);
  assert.equal(actual.executable.sha256, deployed[0].executable.sha256);
  const resources = audit.runtimeCandidate.map(item => {
    const file = path.join(actual.installRoot, item.name);
    assert.equal(sha(file), item.sha256);
    return { path: file, sha256: item.sha256 };
  });
  installationFile = path.join(out, "derived-installation-receipt.json");
  fs.writeFileSync(installationFile, JSON.stringify({
    status: "PASS", metadataRestoration: "PASS", installRoot: actual.installRoot,
    executable: actual.executable, resources, version: audit.version,
    scope: "READ_ONLY_ADAPTER_OF_EXISTING_ACTUAL_NSIS_INSTALLATION_NOT_A_NEW_INSTALL",
    originalAudit: { path: auditFile, sha256: sha(auditFile) },
    originalInstallation: { path: actualFile, sha256: sha(actualFile) },
  }, null, 2), { flag: "wx" });
}
const report = { status: "RUNNING", mode, startedAt: new Date().toISOString(), pages: [], matrix: [],
  steps: [], errors: [], screenshots: [], launches: [], cleanups: [], modelRequests: 0,
  scope: "INSTALLED_PAGE_SURVEY_AND_AUTHOR_NOT_STANDALONE_GAME_EXPORT_OR_NATIVE_FILE_PICKER",
  installation: installationFile };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile: report.installation, out, input, report, save });
let page, prepared = false;
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
    ...(codexCacheView ? ["-CodexCacheView"] : [])],
  { windowsHide: true, encoding: "utf8", timeout: 30000 });
  (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function step(label, fn) {
  const row = { label, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; console.log("PASS " + label); }
  catch (e) { row.status = "FAILED"; throw e; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
async function click(n) { await n.scrollIntoViewIfNeeded(); await n.click(); }
async function open(t) {
  if (await page.locator('[data-workspace-surface="options"]:visible').getAttribute("aria-current") !== "page")
    await click(page.locator('[data-workspace-surface="options"]:visible'));
  await click(page.locator('[data-help-key="advanced.tab.layout"]:visible')); await settleEditor(page);
  const b = page.locator(`[data-layout-type-option="${t}"]:visible`);
  if (await b.getAttribute("aria-pressed") !== "true") await click(b);
  await page.waitForFunction(t => document.querySelector(".runtime-layout-designer")?.dataset.layoutType === t
    && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false", t);
  await settleEditor(page);
}
async function saveLayout() {
  await click(page.locator('[data-help-key="layout.save"]:visible'));
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
}
const standard = [
  ["title", "标题主页", "title_hero"], ["player", "播放页", "dialog_panel"],
  ["game_menu", "游戏菜单", "game_menu_nav"], ["save_load", "存档/读档", "save_grid"],
  ["preferences", "选项", "settings_group"], ["history", "历史", "history_list"],
  ["gallery", "画廊", "gallery_grid"], ["about", "关于", "about_panel"],
];
const menus = standard.filter(e => !["player", "game_menu"].includes(e[0]));
menus.push(["help", "帮助", "help_panel"]);
async function ordinary() {
  const nav = page.getByRole("button", { name: "页面导航", exact: true });
  if (await nav.isVisible()) await click(nav);
  const player = page.getByTestId("renpy-player-layout-entry");
  if (await player.isVisible()) await click(player);
  await click(page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }));
}
async function go(t, entry) {
  if (t === "renpy" && entry[0] !== "player" && entry[0] !== "game_menu") {
    if (!await page.locator(".renpy-title-editor").count()) {
      const nav = page.getByRole("button", { name: /^(返回)?页面导航$/ });
      if (await nav.isVisible()) await click(nav);
      else await click(page.locator('[data-help-key="layout.screen"]:visible').getByText("标题主页", { exact: true }));
    }
    await click(page.locator(".renpy-title-editor .runtime-layout-sidebar").getByRole("button", { name: entry[1], exact: true }));
    await page.locator(`.renpy-title-editor[data-editor-page="${entry[0]}"]`).waitFor();
  } else {
    await ordinary();
    await click(page.locator('[data-help-key="layout.screen"]:visible').getByText(entry[1], { exact: true }));
  }
  await settleEditor(page);
}
async function health() {
  const button = page.getByTestId("runtime-layout-health-status");
  await page.waitForFunction(() => document.querySelector('[data-testid="runtime-layout-health-status"]')?.dataset.healthState !== "pending");
  if (!await page.locator(".runtime-layout-status ul").count()) {
    (report.healthProbes ??= []).push(await button.evaluate(node => {
      const r = node.getBoundingClientRect(), owner = node.closest(".runtime-layout-designer");
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { rect: r.toJSON(), hit: node === hit || node.contains(hit),
        hitClass: hit?.className, rows: getComputedStyle(owner).gridTemplateRows,
        children: [...owner.children].map(child => ({ className: child.className,
          rect: child.getBoundingClientRect().toJSON() })),
        ancestors: Array.from((function* () { for (let p = node.parentElement; p; p = p.parentElement) yield p; })())
          .map(p => ({ className: p.className, rect: p.getBoundingClientRect().toJSON(),
            overflow: getComputedStyle(p).overflow, scrollTop: p.scrollTop })),
        transientLayers: document.querySelectorAll(".workspace-task-panel.is-morphing,.advanced-tab-leaving").length };
    })); save();
    await button.scrollIntoViewIfNeeded();
    await button.click({ timeout: 5000 });
  }
  return { state: await button.getAttribute("data-health-state"), text: await button.innerText(),
    issues: await page.locator(".runtime-layout-status li").evaluateAll(ns => ns.map(n => ({
      code: n.dataset.issueCode, path: n.dataset.issuePath, text: n.textContent,
    }))) };
}
async function geometry() {
  const result = await page.evaluate(() => {
    const root = document.querySelector(".advanced-tab-content.is-active .runtime-layout-designer");
    const panel = root.closest(".workspace-task-panel"), pr = panel.getBoundingClientRect();
    const regions = [...root.querySelectorAll(".runtime-layout-sidebar,.runtime-layout-center,.runtime-layout-inspector")].map(n => {
      const r = n.getBoundingClientRect();
      return { rect: r.toJSON(), overflow: n.scrollWidth - n.clientWidth, display: getComputedStyle(n).display };
    });
    const save = document.querySelector('[data-help-key="layout.save"]'), r = save.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { panel: pr.toJSON(), regions, saveHit: save === hit || save.contains(hit),
      overflow: document.documentElement.scrollWidth - innerWidth,
      rail: document.querySelector(".node-palette").getBoundingClientRect().toJSON() };
  });
  assert(result.regions.length >= 3); assert(result.saveHit && result.overflow <= 1);
  assert(result.rail.right <= result.panel.left + 1);
  for (const { rect: r, overflow, display } of result.regions)
    assert(display !== "none" && overflow <= 1 && r.width > 0 && r.height > 0
      && r.left >= result.panel.left - 1 && r.right <= result.panel.right + 1
      && r.top >= result.panel.top - 1 && r.bottom <= result.panel.bottom + 1, JSON.stringify(result));
  return result;
}
async function preview(t, entry) {
  if (t === "agentvn" && entry[0] !== "player") return { kind: "AUTHOR_DIAGRAM_NOT_RUNTIME", geometry: await geometry() };
  if (entry[0] === "game_menu") return { kind: "AUTHOR_DIAGRAM_NOT_RUNTIME", geometry: await geometry() };
  if (entry[0] === "player") {
    const b = page.getByTestId("renpy-player-runtime-preview-toggle");
    if (await b.getAttribute("aria-pressed") !== "true") await click(b);
  } else if (entry[0] === "title") {
    const b = page.getByTestId("renpy-title-runtime-preview-toggle");
    if (await b.getAttribute("aria-pressed") !== "true") await click(b);
  }
  const n = page.locator('.advanced-tab-content.is-active .renpy-editor-runtime-viewport[data-preview-phase="ready"]');
  await n.waitFor({ timeout: 45000 });
  const frame = await (await n.locator("iframe").elementHandle()).contentFrame();
  await settleRuntime(frame);
  return { kind: "ACTUAL_INSTALLED_RUNTIME_IFRAME", geometry: await geometry(), runtime: await frame.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    screen: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-presented-screen"),
    overflow: document.documentElement.scrollWidth - innerWidth,
    roles: [...document.querySelectorAll("[data-renpy-button-role]")].length,
  })) };
}
function component(profiles, t, e) {
  return profiles.profiles[t].screens.find(s => s.screen_id === e[0]).components.find(c => c.component_id === e[2]);
}
async function author(t, entry, i) {
  const before = await projectSnapshot(host.current.ports[0]), other = t === "agentvn" ? "renpy" : "agentvn";
  const isolated = structuredClone(before.settings.runtimeUILayoutProfiles.profiles[other]);
  const color = "#" + (0x263746 + i * 0x020103).toString(16);
  if (t === "renpy" && !["player", "game_menu"].includes(entry[0])) {
    const label = entry[0] === "title" ? "标题页" : entry[1];
    await click(page.getByTestId("renpy-page-region-editor").locator(`[data-component-id="${entry[2]}"]`));
    // P1 replaced the old page-color field with the selected control editor.
    await page.getByLabel("当前控件背景颜色", { exact: true }).fill(color);
    const navigation = page.locator(".renpy-page-navigation-fields");
    if (await navigation.getAttribute("open") === null) await click(navigation.locator("summary"));
    const override = navigation.getByRole("button", { name: `覆盖${label}字号`, exact: true });
    if (await override.isVisible()) await click(override);
    const number = page.getByRole("spinbutton", { name: `${label}导航字号`, exact: true });
    await number.fill(String(23 + i));
    await click(navigation.getByRole("button", { name: "恢复继承", exact: true }));
    assert.equal(await page.getByTestId("renpy-font-source").innerText(), "继承");
    await click(override); await number.fill(String(23 + i));
  } else {
    await click(page.locator(`.runtime-layout-sidebar button[data-component-id="${entry[2]}"]`));
    if (t === "renpy") {
      // P1 uses the same selected-control editor on the playing/menu pages.
      // Its real installed UI no longer has the AgentVN "外观" disclosure.
      await page.getByTestId("renpy-control-appearance")
        .getByLabel("当前控件背景颜色", { exact: true }).fill(color);
    } else {
      const details = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^外观$/ }) });
      if (await details.getAttribute("open") === null) await click(details.locator("summary"));
      await details.locator("label").filter({ hasText: /^backgroundColor$/ }).locator('input:not([type="color"])').fill(color);
    }
  }
  await saveLayout();
  const after = await projectSnapshot(host.current.ports[0]), profiles = after.settings.runtimeUILayoutProfiles;
  assert.equal(component(profiles, t, entry).style.backgroundColor, color);
  assert.deepEqual(profiles.profiles[other], isolated);
  return { color, component: entry[2], otherTypeUnchanged: true, persisted: component(profiles, t, entry) };
}
(async () => {
  save(); cache("SelfTest"); cache("Prepare"); prepared = true;
  page = await host.start();
  await step("Public backend isolated fixture and actual homepage navigation", async () => {
    const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
      body: fs.readFileSync(input),
    });
    const body = await r.json(); assert(r.ok && body.ok && body.data.project_id === p.project_id);
    await page.reload(); await page.locator(".project-home").waitFor();
    await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: p.title })); await settleEditor(page);
  });
  for (const display of displayMatrix) {
    await host.metrics(display);
    for (const t of types) {
    await open(t);
    for (const [i, entry] of (t === "agentvn" ? standard : [...menus, standard[1], standard[2]]).entries()) {
      await step(`${t}/${entry[0]}/${mode}`, async () => {
        await go(t, entry);
        const row = { type: t, id: entry[0], display, health: await health(), geometry: await geometry() };
        report.pages.push(row); save();
        if (mode === "author") row.author = await author(t, entry, i);
        row.preview = await preview(t, entry);
        if (row.preview.runtime) assert(row.preview.runtime.overflow <= 1);
        row.controls = await page.locator(".advanced-tab-content.is-active input[aria-label]").evaluateAll(ns =>
          ns.map(n => ({ label: n.getAttribute("aria-label"), value: n.value })));
        row.status = "PASS"; save();
        if (process.argv.includes("--collapse-health")) {
          const status = page.getByTestId("runtime-layout-health-status");
          if (await page.locator(".runtime-layout-status ul").isVisible()) {
            await click(status);
            await page.locator(".runtime-layout-status ul").waitFor({ state: "hidden" });
          }
        }
        if (entry[0] === "player") await host.shot(
          `${t}-${mode}-player-${display.width}-dpr${display.dpr}-${display.reduced ? "reduced" : "ordinary"}`);
        return row;
      });
    }
    await saveLayout();
    }
    report.matrix.push({ ...display, status: "PASS", pageCount: report.pages.filter(p =>
      p.display.width === display.width && p.display.dpr === display.dpr && p.display.reduced === display.reduced).length });
    save();
  }
  const before = await projectSnapshot(host.current.ports[0]);
  report.profiles = before.settings.runtimeUILayoutProfiles;
  await step("Process restart preserves two layout profiles", async () => {
    await host.stop("Owned-process restart, not normal window close"); page = await host.start();
    await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: p.title })); await settleEditor(page);
    const after = await projectSnapshot(host.current.ports[0]);
    assert.deepEqual(after.settings.runtimeUILayoutProfiles, report.profiles);
  });
  const expectedPages = types.reduce((total, type) => total + (type === "agentvn" ? 8 : 9), 0);
  report.expectedPages = expectedPages; report.testedTypes = types;
  assert.equal(report.pages.length, expectedPages * displayMatrix.length); assert(report.pages.every(r => r.status === "PASS"));
  assert.equal(report.matrix.length, displayMatrix.length);
  assert(report.matrix.every(m => m.status === "PASS" && m.pageCount === expectedPages));
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) try { await host.shot("failure"); } catch (captureError) { report.captureError = String(captureError); }
}).finally(async () => {
  try { await host.stop("finally"); if (prepared) { cache("Restore"); report.nativeCacheRestoration = "PASS"; } }
  catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  report.tool = { path: __filename, sha256: sha(__filename) }; save();
  console.log(JSON.stringify({ status: report.status, mode, out, error: report.error, cleanupError: report.cleanupError }));
});
