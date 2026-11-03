"use strict";
// Fresh default-profile installed Release authoring. No native picker/store
// substitutes and no legacy PowerShell UIA. Public backend import is fixture
// preparation only, not a claim of native project-file selection acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-layout-author-review-20261019-01";
const work = "F:/AgentVN/QA/Layout-Author-20261019-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => A.sha256(fs.readFileSync(p));
const [phase, attempt = "01"] = process.argv.slice(2);
assert(["fixture", "edit", "inherited-opacity", "explicit-opacity", "roles", "matrix",
  "role-consumption", "dialogue-confirmation", "save", "reopen", "export", "portable-reimport"].includes(phase));
assert(/^\d{2}$/.test(attempt));
const prep = read(path.join(run, "preparation.json"));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
const fixtureFile = path.join(run, "fixtures.json");
const pages = [
  { id: "title", label: "标题主页", component: "title_hero", content: ".main-menu-title-hero-background" },
  { id: "preferences", label: "选项", component: "settings_group", content: ".settings-renpy" },
  { id: "save_load", label: "存档/读档", component: "save_grid", content: ".save-grid" },
  { id: "history", label: "历史", component: "history_list", content: ".history-list" },
  { id: "about", label: "关于", component: "about_panel", content: ".about-card" },
  { id: "help", label: "帮助", component: "help_panel", content: ".help-card" },
  { id: "gallery", label: "画廊", component: "gallery_grid", content: ".gallery-grid" },
].map((p, i) => ({ ...p, font: 23 + i, spacing: 7 + i,
  color: `#${(0x24384c + i * 0x040302).toString(16)}` }));
const roles = [
  ["title_action", "标题操作"], ["page_navigation", "页面导航"],
  ["category_pagination", "分类 / 分页"], ["story_choice", "剧情选项"],
  ["quick_bar", "快捷栏"], ["modal_action", "弹窗操作"],
];
const states = [["normal", "普通"], ["hover", "悬停"], ["selected", "选中"], ["disabled", "禁用"]];
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const out = path.join(run, `${phase}-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), phase, checks: [], matrix: [],
  screenshots: [], pageErrors: [], realModelRequests: 0, productChanges: 0,
  scope: "ACTUAL_FROZEN_NSIS_DEFAULT_PROFILES_HELD_REAL_UI_AUTHORING_NOT_NATIVE_FILE_PICKERS",
  nativePickerClaim: false, error: null };
let browser, page, cdp, current = { width: 1920, height: 1080, dpr: 1, reduced: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function step(name, body) {
  const c = { name, status: "RUNNING" }; report.checks.push(c); save();
  try { c.detail = await body(); c.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { save(); }
}
const snapshot = () => A.projectSnapshot(8278);
const profiles = p => p.settings.runtimeUILayoutProfiles;
const layout = () => page.locator(".advanced-tab-content.is-active .runtime-layout-designer");
async function options() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
}
async function saveLayout() {
  await layout().locator('[data-help-key="layout.save"]').click();
  await layout().locator('[data-save-state="saved"]').waitFor();
}
async function shot(label) {
  const file = path.join(work, path.basename(out), `${label}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  report.screenshots.push(await captureInstalledWebview(page, cdp, file, current)); save();
}
async function goPage(p) {
  if (!await page.locator(".renpy-title-editor").count()) {
    await layout().getByRole("button", { name: /^(返回)?页面导航$/ }).click();
    await page.locator(".renpy-title-editor").waitFor();
  }
  await page.locator(".renpy-title-editor .runtime-layout-sidebar")
    .getByRole("button", { name: p.label, exact: true }).click();
  await page.locator(`.renpy-title-editor[data-editor-page="${p.id}"]`).waitFor();
}
async function preview() {
  await layout().locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor({ timeout: 45000 });
  const frame = page.frames().find(f => f.parentFrame() && f.url().includes("gamecli-preview"));
  assert(frame); await A.settleRuntime(frame); return frame;
}
async function hit(control) {
  await control.scrollIntoViewIfNeeded(); await control.click({ trial: true });
  const geometry = await control.evaluate(async n => {
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
    const r = n.getBoundingClientRect();
    return { rect: r.toJSON(), hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      overflow: document.documentElement.scrollWidth - innerWidth, vw: innerWidth, vh: innerHeight,
      clipped: n.scrollWidth > n.clientWidth + 1, opacity: Number(getComputedStyle(n).opacity) };
  });
  const r = geometry.rect;
  assert(geometry.hit && geometry.opacity > 0 && !geometry.clipped && geometry.overflow <= 1
    && r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= geometry.vw + 1
    && r.top >= -1 && r.bottom <= geometry.vh + 1, JSON.stringify(geometry));
  return geometry;
}
async function menuValue(frame, entry, font = entry.font, gap = entry.spacing) {
  await A.settleRuntime(frame);
  await frame.waitForFunction(({ title, content }) => {
    const host = document.querySelector(title ? ".renpy-title-view" : "[data-renpy-menu-frame]");
    return host && document.querySelector(content) && host.getAnimations({ subtree: true }).every(a =>
      a.effect?.getComputedTiming().iterations === Infinity || !["running", "pending"].includes(a.playState));
  }, { title: entry.id === "title", content: entry.content });
  const actual = await frame.evaluate(({ title, content }) => {
    const host = document.querySelector(title ? ".renpy-title-view" : "[data-renpy-menu-frame]");
    const nav = host?.querySelector(title ? ".renpy-title-navigation" : ".renpy-menu-navigation");
    const panel = document.querySelector(content), first = nav?.querySelector("button");
    if (!first || !panel) throw Error(`Missing page content: ${content}`);
    return { scale: Number(title ? host.dataset.renpyScale : host.dataset.renpyMenuScale),
      background: getComputedStyle(panel).backgroundColor, font: parseFloat(getComputedStyle(first).fontSize),
      gap: parseFloat(getComputedStyle(nav).gap), horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      contentOverflow: panel.scrollWidth - panel.clientWidth,
      host: host.getBoundingClientRect().toJSON(), panel: panel.getBoundingClientRect().toJSON(),
      buttons: [...nav.querySelectorAll("button")].map(n => {
        const r = n.getBoundingClientRect(); return { label: n.textContent, rect: r.toJSON(),
          hit: n.disabled || n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
          clipped: n.scrollWidth > n.clientWidth + 1 };
      }) };
  }, { title: entry.id === "title", content: entry.content });
  assert.equal(actual.background, rgb(entry.color), `${entry.id} Runtime background`);
  assert(Math.abs(actual.font / actual.scale - font) < .15, `${entry.id} Runtime font: ${JSON.stringify(actual)}`);
  assert(Math.abs(actual.gap / actual.scale - gap) < .15, `${entry.id} Runtime gap: ${JSON.stringify(actual)}`);
  assert(actual.horizontalOverflow <= 1 && actual.contentOverflow <= 1);
  for (const b of actual.buttons) {
    assert(b.hit && !b.clipped, `Unreachable Runtime button: ${JSON.stringify(b)}`);
    const r = b.rect, h = actual.host;
    assert(r.left >= h.left - 1 && r.top >= h.top - 1 && r.right <= h.right + 1 && r.bottom <= h.bottom + 1);
  }
  for (let i = 1; i < actual.buttons.length; i++)
    assert(actual.buttons[i - 1].rect.bottom <= actual.buttons[i].rect.top + 1);
  return actual;
}
async function main() {
  if (phase === "fixture") {
    await step("Prepare unique small controlled fixture; no original user project or credentials", () => {
      const { fixture } = require("./lib/editor-ui-acceptance.cjs");
      const p = fixture("installed-layout-author-review-20261019-01");
      p.title = "安装版全页面作者隔离验收";
      p.nodes[0].data.loadingAnimation = { kind: "default" }; p.nodes[0].data.openingAudio = [];
      const input = path.join(work, "作者隔离工程.vnproj");
      fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
      const f = { status: "PASS", input, inputSha256: sha(input), projectId: p.project_id, title: p.title };
      fs.writeFileSync(fixtureFile, JSON.stringify(f, null, 2), { flag: "wx" }); return f;
    });
    report.status = "PASS"; return;
  }
  const fixture = read(fixtureFile), launch = read(path.join(run, `launch${["reopen", "export", "portable-reimport"].includes(phase) ? "-02" : ""}.json`));
  assert.equal(sha(fixture.input), fixture.inputSha256);
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
  assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
  report.launch = launch; report.fixture = fixture;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(45000); page.on("pageerror", e => { report.pageErrors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: current.width, height: current.height,
    deviceScaleFactor: current.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await readInstalledViewport(page, current);
  if (phase === "edit") {
    await step("Import isolated fixture via public backend and enter from actual recent-project button", async () => {
      const response = await fetch("http://127.0.0.1:8278/api/project/projects/import", { method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
        body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
      const payload = await response.json(); assert(response.ok && payload.ok && payload.data.project_id === fixture.projectId);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
      await options();
      const initial = await snapshot();
      assert((initial.settings.runtimeUILayoutProfiles?.activeType || "agentvn") === "agentvn");
      await layout().locator('[data-layout-type-option="renpy"]').click();
      await page.locator(".renpy-title-editor").waitFor(); await saveLayout();
      report.agentBaseline = profiles(await snapshot()).profiles.agentvn; save();
      return { source: "Public backend fixture preparation + real homepage/options/layout/type UI", nativePickerClaim: false };
    });
    await step("Seven real page editors: shared navigation, independent local overrides and restore inheritance", async () => {
      await page.getByRole("spinbutton", { name: "共享导航字号", exact: true }).fill("22");
      await page.getByRole("spinbutton", { name: "共享导航间距", exact: true }).fill("6");
      const values = [];
      for (const entry of pages) {
        await goPage(entry);
        const label = entry.id === "title" ? "标题页" : entry.label;
        const font = page.getByRole("spinbutton", { name: `${label}导航字号`, exact: true });
        await page.getByRole("button", { name: `覆盖${label}字号`, exact: true }).click();
        await font.fill(String(entry.font));
        await page.getByRole("button", { name: "恢复继承", exact: true }).click();
        assert.equal(await font.count(), 0);
        await page.getByRole("button", { name: `覆盖${label}字号`, exact: true }).click();
        assert.equal(await font.inputValue(), "22");
        await font.fill(String(entry.font));
        await page.getByRole("button", { name: `覆盖${label}间距`, exact: true }).click();
        await page.getByRole("spinbutton", { name: `${label}导航间距`, exact: true }).fill(String(entry.spacing));
        await page.getByTestId("renpy-page-region-editor").locator(`[data-component-id="${entry.component}"]`).click();
        const style = page.getByTestId("renpy-page-style-editor");
        await style.getByLabel("页面背景色", { exact: true }).fill(entry.color);
        await style.getByLabel("页面不透明度", { exact: true }).fill("1");
        values.push({ id: entry.id, font: await font.inputValue(), gap: entry.spacing, background: entry.color });
      }
      await saveLayout();
      const saved = await snapshot(); report.authored = saved; save();
      assert.deepEqual(profiles(saved).profiles.agentvn, report.agentBaseline);
      for (const entry of pages) {
        assert.equal(profiles(saved).profiles.renpy.renpy[entry.id].fontSize, entry.font);
        const component = profiles(saved).profiles.renpy.screens.find(s => s.screen_id === entry.id)
          .components.find(c => c.component_id === entry.component);
        assert.equal(component.style.backgroundColor, entry.color);
      }
      await shot("seven-pages-authored"); return values;
    });
  } else if (phase === "inherited-opacity") {
    await options(); await goPage(pages[0]);
    await page.getByTestId("renpy-page-region-editor").locator('[data-component-id="title_hero"]').click();
    await page.getByTestId("renpy-title-runtime-preview-toggle").click();
    await step("Inherited opacity shown by author matches actual Runtime alpha before any explicit opacity edit", async () => {
      const property = page.getByTestId("renpy-page-style-property-opacity");
      const displayed = await property.getByLabel("页面不透明度", { exact: true }).inputValue();
      const source = await page.getByTestId("renpy-page-style-opacity-source").innerText();
      const frame = await preview();
      const background = await frame.locator(".main-menu-title-hero-background").evaluate(n => getComputedStyle(n).backgroundColor);
      const saved = await snapshot();
      const component = profiles(saved).profiles.renpy.screens.find(s => s.screen_id === "title")
        .components.find(c => c.component_id === "title_hero");
      report.opacityEvidence = { displayed, source, background, savedStyle: component.style };
      save(); await shot("inherited-opacity-actual");
      const alpha = background.startsWith("rgba(") ? Number(background.match(/,\s*([\d.]+)\)$/)[1]) : 1;
      assert.equal(Number(displayed), alpha, "Editor inherited opacity differs from actual Runtime color alpha");
      return report.opacityEvidence;
    });
  } else if (phase === "explicit-opacity") {
    await options();
    await step("Separate explicit-opacity user path: change away from displayed fallback then choose opaque, save and verify bytes", async () => {
      for (const entry of pages) {
        await goPage(entry);
        await page.getByTestId("renpy-page-region-editor").locator(`[data-component-id="${entry.component}"]`).click();
        const opacity = page.getByTestId("renpy-page-style-editor").getByLabel("页面不透明度", { exact: true });
        await opacity.fill("0.9"); await opacity.fill("1");
        assert.equal(await page.getByTestId("renpy-page-style-opacity-source").innerText(), "覆盖");
      }
      await saveLayout(); const saved = await snapshot(); report.authored = saved;
      for (const entry of pages)
        assert.equal(profiles(saved).profiles.renpy.screens.find(s => s.screen_id === entry.id)
          .components.find(c => c.component_id === entry.component).style.opacity, 1);
      await shot("explicit-opacity-saved"); return { pages: 7, inheritedOpacityFailureNotRepaired: true };
    });
  } else if (phase === "roles") {
    await options(); await goPage(pages[0]);
    await step("Six button roles and four states can be authored, overridden and restored without cross-layout writes", async () => {
      const editor = page.getByTestId("renpy-button-role-editor"), changes = [];
      for (const [index, [role, label]] of roles.entries()) {
        await A.select(page, "按钮角色", label);
        await A.select(page, "按钮样式范围", "共享样式");
        await editor.getByRole("spinbutton", { name: "按钮字号", exact: true }).fill(String(24 + index));
        for (const [j, [state, stateLabel]] of states.entries()) {
          await A.select(page, "按钮状态", stateLabel);
          const color = `#${(0x94acc0 + index * 0x10200 + j * 0x301).toString(16)}`;
          await editor.getByLabel("按钮文字色", { exact: true }).fill(color);
          changes.push({ role, state, textColor: color });
        }
        await A.select(page, "按钮样式范围", role === "story_choice" || role === "quick_bar" ? "剧情页面覆盖" : "当前页面覆盖");
        await editor.getByRole("spinbutton", { name: "按钮字号", exact: true }).fill("39");
        await editor.getByRole("button", { name: "恢复此角色共享继承", exact: true }).click();
        assert.equal(await editor.getByRole("spinbutton", { name: "按钮字号", exact: true }).inputValue(), String(24 + index));
      }
      await saveLayout();
      const saved = await snapshot(), prior = read(path.join(run, "edit-01/report.json"));
      assert.deepEqual(profiles(saved).profiles.agentvn, prior.agentBaseline);
      for (const c of changes)
        assert.equal(profiles(saved).profiles.renpy.renpy.shared.buttonRoles[c.role].states[c.state].textColor, c.textColor);
      report.authored = saved; await shot("six-roles-four-states"); return changes;
    });
  } else if (phase === "role-consumption") {
    await options(); await goPage(pages[0]);
    await page.getByTestId("renpy-title-runtime-preview-toggle").click();
    await step("Real Runtime consumes authored title normal/hover and menu selected states with stable geometry", async () => {
      const saved = await snapshot(), config = profiles(saved).profiles.renpy.renpy.shared.buttonRoles;
      let frame = await preview();
      const start = frame.getByTestId("start-new-game");
      await start.waitFor(); await page.mouse.move(0, 0);
      const measure = n => ({ color: getComputedStyle(n).color, rect: n.getBoundingClientRect().toJSON(),
        state: n.dataset.renpyRoleState, custom: n.dataset.renpyRoleCustom });
      const normal = await start.evaluate(measure);
      assert.equal(normal.color, rgb(config.title_action.states.normal.textColor)); assert.equal(normal.custom, "true");
      await start.hover();
      await frame.waitForFunction(expected => getComputedStyle(document.querySelector('[data-testid="start-new-game"]')).color === expected,
        rgb(config.title_action.states.hover.textColor));
      const hover = await start.evaluate(measure);
      for (const key of ["x", "y", "width", "height"]) assert(Math.abs(normal.rect[key] - hover.rect[key]) <= .1);
      await goPage(pages[1]); frame = await preview();
      const selected = await frame.getByTestId("renpy-menu-settings").evaluate(measure);
      assert.equal(selected.state, "selected"); assert.equal(selected.color, rgb(config.page_navigation.states.selected.textColor));
      await shot("actual-role-state-consumption");
      return { normal, hover, selected, disabledStateRuntimeTest: "NOT_RUN", otherRoleRuntimeStates: "NOT_RUN" };
    });
  } else if (phase === "dialogue-confirmation") {
    await options(); await goPage(pages[0]);
    await step("NVL and bubble author overrides, inheritance reset and actual Runtime preview", async () => {
      await page.getByTestId("renpy-player-layout-entry").click();
      const results = [];
      for (const [mode, label, color, text, width] of [
        ["nvl", "NVL", "#224466", "#eeddaa", 84], ["bubble", "气泡", "#553366", "#aaddbb", 43],
      ]) {
        await A.select(page, "对白布局模式", mode === "nvl" ? "NVL 累积阅读" : "气泡对白");
        await page.getByRole("spinbutton", { name: `${label}区域width`, exact: true }).fill(String(width));
        await page.getByLabel(`${label}背景色`, { exact: true }).fill(color);
        await page.getByRole("spinbutton", { name: `${label}不透明度`, exact: true }).fill("0.9");
        await page.getByRole("spinbutton", { name: `${label}不透明度`, exact: true }).fill("1");
        await page.getByRole("button", { name: "正文", exact: true }).click();
        await page.getByLabel(`${label}文字色`, { exact: true }).fill(text);
        await page.getByRole("button", { name: `恢复继承${label}文字色`, exact: true }).click();
        assert.equal(await page.getByRole("button", { name: `恢复继承${label}文字色`, exact: true }).count(), 0);
        await page.getByLabel(`${label}文字色`, { exact: true }).fill(text);
        await page.getByRole("spinbutton", { name: `${label}字号`, exact: true }).fill("27");
        await saveLayout(); const frame = await preview();
        const panel = frame.locator(`.dialog-box[data-dialogue-layout-mode="${mode}"]`);
        await panel.waitFor();
        const actual = await panel.evaluate(n => {
          const area = n.closest(".story-player").getBoundingClientRect(), r = n.getBoundingClientRect();
          const text = n.querySelector(".nvl-page-text,.dialog-text");
          return { rect: r.toJSON(), area: area.toJSON(), source: n.dataset.dialogueLayoutSource,
            background: getComputedStyle(n).backgroundColor, color: getComputedStyle(text).color };
        });
        assert.equal(actual.source, "override"); assert.equal(actual.background, rgb(color)); assert.equal(actual.color, rgb(text));
        const r = actual.rect, a = actual.area;
        assert(r.width > 0 && r.height > 0 && r.left >= a.left - 1 && r.right <= a.right + 1
          && r.top >= a.top - 1 && r.bottom <= a.bottom + 1);
        results.push({ mode, actual }); await shot(`${mode}-authored-runtime`);
      }
      report.authored = await snapshot(); return results;
    });
    await step("Confirmation author geometry, style inheritance and isolated Runtime modal preview", async () => {
      await goPage(pages[0]); await page.getByTestId("renpy-confirmation-layout-entry").click();
      for (const [key, value] of [["x", 22], ["y", 26], ["width", 56], ["height", 48]])
        await page.getByRole("spinbutton", { name: `确认区域${key}`, exact: true }).fill(String(value));
      await page.getByLabel("确认背景色", { exact: true }).fill("#30485d");
      await page.getByRole("button", { name: "恢复确认背景色继承", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "恢复确认背景色继承", exact: true }).count(), 0);
      await page.getByLabel("确认背景色", { exact: true }).fill("#30485d");
      await A.select(page, "确认提示区域", "标题");
      await page.getByLabel("确认文字色", { exact: true }).fill("#ffe3a1");
      await page.getByRole("spinbutton", { name: "确认字号", exact: true }).fill("28");
      await saveLayout(); const frame = await preview();
      const modal = frame.getByRole("dialog", { name: "退出游戏？", exact: true }); await modal.waitFor();
      assert.equal(await modal.getAttribute("data-confirmation-layout-source"), "override");
      const actual = await modal.evaluate(n => ({ rect: n.getBoundingClientRect().toJSON(),
        background: getComputedStyle(n).backgroundColor, width: innerWidth, height: innerHeight }));
      assert.equal(actual.background, "rgba(48, 72, 93, 0.78)");
      assert(actual.rect.left >= -1 && actual.rect.top >= -1 && actual.rect.right <= actual.width + 1
        && actual.rect.bottom <= actual.height + 1);
      await shot("confirmation-authored-runtime");
      await modal.getByRole("button", { name: "关闭退出游戏？", exact: true }).click();
      await page.locator(".editor-toolbar").waitFor();
      const authored = await snapshot(), prior = read(path.join(run, "edit-01/report.json"));
      assert.deepEqual(profiles(authored).profiles.agentvn, prior.agentBaseline); report.authored = authored;
      return { actual, previewDidNotCloseEditor: true };
    });
  } else if (phase === "matrix") {
    await options();
    await step("Seven authored pages reach their actual Runtime previews across the 12 requested desktop combinations", async () => {
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
        for (const dpr of [1, 2]) for (const reduced of [false, true]) {
          current = { width, height, dpr, reduced };
          await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
          await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
          await readInstalledViewport(page, current);
          const row = { viewport: current, pages: [], status: "RUNNING" }; report.matrix.push(row); save();
          for (const entry of pages) {
            await goPage(entry);
            if (entry.id === "title") {
              const runtime = page.getByTestId("renpy-title-runtime-preview-toggle");
              if (await runtime.getAttribute("aria-pressed") !== "true") await runtime.click();
            }
            const button = page.locator(".renpy-title-editor .runtime-layout-sidebar")
              .getByRole("button", { name: entry.label, exact: true });
            const frame = await preview();
            row.pages.push({ id: entry.id, author: await hit(button), runtime: await menuValue(frame, entry) }); save();
          }
          await shot(`${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}`);
          row.status = "PASS"; save();
        }
      assert.equal(report.matrix.length, 12); return { combinations: 12, pagesPerCombination: 7 };
    });
  } else if (phase === "save") {
    await step("Native default-directory save contains both authored profiles and no local export path", async () => {
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
      const before = new Set(fs.readdirSync("C:/Users/1/Downloads"));
      await page.getByRole("button", { name: "保存工程", exact: true }).click();
      const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
      await dialog.getByRole("button", { name: "OK", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="project-save-confirmation"]'));
      const newFiles = fs.readdirSync("C:/Users/1/Downloads").filter(f => !before.has(f) && f.endsWith(".vnproj"));
      assert.equal(newFiles.length, 1);
      const original = path.join("C:/Users/1/Downloads", newFiles[0]), retained = path.join(work, newFiles[0]);
      fs.copyFileSync(original, retained, fs.constants.COPYFILE_EXCL); assert.equal(sha(original), sha(retained));
      const zip = await JSZip.loadAsync(fs.readFileSync(retained)), portable = JSON.parse(await zip.file("project.json").async("string"));
      const saved = await snapshot(); assert.deepEqual(portable.editor_settings.runtimeUILayoutProfiles, profiles(saved));
      assert(!JSON.stringify(portable).includes(work)); report.authored = saved;
      report.savedPackage = { original, retained, sha256: sha(retained), generatedAt: fs.statSync(original).mtime.toISOString() };
      return report.savedPackage;
    });
  } else if (phase === "reopen") {
    await step("New actual installed process reopens authored data without a picker or frontend state injection", async () => {
      const previous = read(path.join(run, "save-01/report.json")); assert.equal(previous.status, "PASS");
      await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
      assert.deepEqual(profiles(await snapshot()), profiles(previous.authored));
      await options(); await goPage(pages[6]);
      report.authored = await snapshot(); await shot("new-process-restored-authoring");
      return { previousEditorPid: read(path.join(run, "launch.json")).editorPid, editorPid: launch.editorPid,
        persistedProfilesMatch: true, nativeProjectPickerClaim: false };
    });
  } else if (phase === "portable-reimport") {
    await step("Actual native-saved vnproj bytes reimported through public packaged backend retain both authored layouts", async () => {
      const prior = read(path.join(run, "save-01/report.json")); assert.equal(prior.status, "PASS");
      assert.equal(sha(prior.savedPackage.retained), prior.savedPackage.sha256);
      const response = await fetch("http://127.0.0.1:8278/api/project/projects/import", { method: "POST",
        headers: { "Content-Type": "application/octet-stream",
          "X-AgentVN-Filename": encodeURIComponent(path.basename(prior.savedPackage.retained)) },
        body: fs.readFileSync(prior.savedPackage.retained), signal: AbortSignal.timeout(30000) });
      const result = await response.json(); assert(response.ok && result.ok && result.data.project_id === fixture.projectId);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
      assert.deepEqual(profiles(await snapshot()), profiles(prior.authored));
      await options(); await goPage(pages[5]); await shot("actual-portable-reimport-help");
      return { source: prior.savedPackage, nativeProjectPickerClaim: false, bothLayoutsMatch: true };
    });
  } else if (phase === "export") {
    await step("Actual publish cartridge contains active authored menus, role states, dialogue and confirmation values", async () => {
      const saved = await snapshot(), active = profiles(saved).profiles.renpy;
      await page.locator('[data-workspace-surface="publish"]:visible').click(); await A.settleEditor(page);
      await page.locator(".cartridge-export-panel").waitFor();
      const environment = page.locator(".windows-env-panel");
      if (await environment.count()) await page.waitForFunction(() =>
        ["passed", "failed"].includes(document.querySelector(".windows-env-panel")?.getAttribute("data-environment-verification")),
      null, { timeout: 180000 });
      await A.dismissEnvironmentCompletion(page);
      await page.locator('[data-package-stage="settings"]').click();
      await page.locator('[data-help-key="package.mode"]').click();
      await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
      const warn = page.getByRole("button", { name: "查看并确认警告", exact: true });
      if (await warn.isVisible()) await warn.click();
      const confirm = page.locator('[data-help-key="package.confirmWarnings"]');
      report.exportWarnings = await page.locator(".preflight-check.is-warning").allTextContents();
      if (await confirm.isVisible()) await confirm.check();
      const directory = path.join(work, "authored-cartridge"); fs.mkdirSync(directory);
      const artifact = await A.realDownload(page, cdp, directory, page.locator('[data-help-key="package.export"]'));
      const zip = await JSZip.loadAsync(fs.readFileSync(artifact.path), { checkCRC32: true });
      const skinBytes = await zip.file("ui/layout.json").async("nodebuffer"), skin = JSON.parse(skinBytes);
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      assert.equal(manifest.game_id, fixture.projectId); assert.equal(skin.layout_type, "renpy");
      assert.deepEqual(skin.renpy, active.renpy);
      assert.deepEqual(skin.dialogueLayouts, active.dialogueLayouts);
      assert.deepEqual(skin.confirmationLayout, active.confirmationLayout);
      for (const entry of pages)
        assert.deepEqual(skin.screens.find(s => s.screen_id === entry.id).components
          .find(c => c.component_id === entry.component).style,
        active.screens.find(s => s.screen_id === entry.id).components.find(c => c.component_id === entry.component).style);
      report.cartridge = { ...artifact, layoutSha256: A.sha256(skinBytes), gameId: manifest.game_id };
      await shot("actual-authored-cartridge-export"); return report.cartridge;
    });
  }
  assert.deepEqual(report.pageErrors, []); report.status = "PASS";
}
main().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && cdp) await shot("failure-state").catch(error => { report.screenshotError = String(error); });
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, phase, checks: report.checks.length, out, error: report.error }));
});
