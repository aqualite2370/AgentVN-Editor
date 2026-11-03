"use strict";
// Source browser acceptance. No installed/physical-device evidence is claimed.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime, projectSnapshot, dismissEnvironmentCompletion } = require("./lib/installed-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.toLowerCase().startsWith("f:\\agentvn\\qa\\") && !fs.existsSync(out), "Use a fresh F:\\AgentVN\\QA directory");
fs.mkdirSync(out, { recursive: true });
const smoke = process.argv.includes("--smoke"), ratios = ["16:9", "16:10", "4:3"];
const previewOnly = process.argv.includes("--preview-only");
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts", contents:
  'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
const project = fixture(`viewport-ratios-${path.basename(out)}`);
project.title = "画面比例隔离工程";
project.nodes[1].data.scene.commands = [{ type: "narration", text: "比例与底栏定位验收，点击设置后返回剧情。".repeat(15) }];
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { agentvn: mod.exports.getDefaultUISkinLayout(), renpy: mod.exports.createRenpyUILayout() } };
project.editor_settings.runtimeUILayout = structuredClone(project.editor_settings.runtimeUILayoutProfiles.profiles.renpy);
const input = path.join(out, "隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const report = { status: "RUNNING", scope: "SOURCE_REAL_BROWSER_NOT_INSTALLED_OR_DEVICE", startedAt: new Date().toISOString(),
  smoke, previewOnly, cases: [], artifacts: [], modelRequests: 0, cleanup: "PENDING" };
const sourceFiles = [
  "shared/cartridge/gameViewport.ts", "shared/cartridge/uiSkin.ts", "shared/cartridge/runtimeCapabilities.ts",
  "shared/cartridge/constants.ts", "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/styles/player.css", "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "editor/src/components/advanced/RenpyTitleEditor.tsx", "editor/src/components/advanced/RenpyRuntimePreview.tsx",
];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(file => [file, sha(path.join(root, file))]));
report.sourceHashes = sourceHashes();
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function pass(name, data = {}) { report.cases.push({ name, status: "PASS", ...data }); save(); }
let env, server, browser, activePage;
async function openDesigner(page) {
  const publishing = page.getByRole("button", { name: "关闭发布与打包", exact: true });
  if (await publishing.isVisible()) { await publishing.click(); await settleEditor(page); }
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await page.getByRole("combobox", { name: "画面比例", exact: true }).waitFor();
  await settleEditor(page);
}
async function selectRatio(page, ratio) {
  await page.getByRole("combobox", { name: "画面比例", exact: true }).click();
  await page.getByRole("option", { name: ratio, exact: true }).click();
  await page.waitForFunction(value => document.querySelector(".runtime-layout-designer")?.dataset.gameAspectRatio === value, ratio);
}
async function saveLayout(page) {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent.includes("已保存"));
}
async function inspectFrame(page, ratio) {
  await settleRuntime(page);
  const value = await page.locator(".runtime-layout-frame").evaluate(e => {
    const r = e.getBoundingClientRect(), scope = e.closest(".ui-skin-scope");
    const s = scope.getBoundingClientRect();
    return { frame: r.toJSON(), scope: s.toJSON(), ratio: scope.dataset.gameAspectRatio,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const expected = Number(ratio.split(":")[0]) / Number(ratio.split(":")[1]), r = value.frame, s = value.scope;
  assert.equal(value.ratio, ratio);
  assert(Math.abs(r.width / r.height - expected) < .003, `Actual canvas ratio: ${JSON.stringify(value)}`);
  assert(r.width > 0 && r.height > 0 && r.left >= s.left - 1 && r.top >= s.top - 1 && r.right <= s.right + 1 && r.bottom <= s.bottom + 1);
  assert(Math.abs((r.left + r.right) / 2 - (s.left + s.right) / 2) <= 1);
  assert(Math.abs((r.top + r.bottom) / 2 - (s.top + s.bottom) / 2) <= 1);
  assert(value.overflow <= 1);
  return value;
}
async function screenshot(page, file) {
  const before = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  await page.screenshot({ path: file, animations: "allow" });
  const after = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  assert.deepEqual(after, before);
  const png = fs.readFileSync(file);
  assert.equal(png.readUInt32BE(16), before.w * before.dpr);
  assert.equal(png.readUInt32BE(20), before.h * before.dpr);
  report.artifacts.push({ file, sha256: sha(file), ...before }); save();
}
async function exportCartridge(page, type, ratio) {
  await page.locator('[data-workspace-surface="publish"]:visible').click();
  const panel = page.locator(".cartridge-export-panel"); await panel.waitFor();
  await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
  await dismissEnvironmentCompletion(page);
  await panel.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
  await panel.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
  const warning = panel.getByRole("checkbox", { name: /我已检查全部警告/ });
  if (await warning.count()) await warning.check();
  const pending = page.waitForEvent("download", { timeout: 60000 });
  pending.catch(() => {});
  await panel.locator(".package-primary-action").click();
  const file = path.join(out, `${type}-${ratio.replace(":", "-")}.vncart`);
  try { await (await pending).saveAs(file); }
  catch (error) {
    report.exportFailureText = await page.locator("body").innerText();
    await page.screenshot({ path: path.join(out, "export-failure.png") }); save();
    throw error;
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.equal(layout.gameViewport.aspectRatio, ratio);
  assert.equal(layout.layout_type ?? "agentvn", type);
  assert.equal(manifest.runtime_version, "0.27.0");
  pass("real-ui-cartridge-export", { type, ratio, file, sha256: sha(file), requiredRuntime: manifest.runtime_version });
  return { type, ratio, file };
}
async function author(context) {
  const page = activePage = await context.newPage(); page.setDefaultTimeout(20000);
  await env.open(page); await settleEditor(page); await openDesigner(page);
  const games = [];
  for (const type of ["renpy", "agentvn"]) {
    if (type === "agentvn") {
      await page.locator('[data-layout-type-option="agentvn"]').click(); await settleEditor(page);
      await page.getByRole("combobox", { name: "画面比例", exact: true }).waitFor();
    }
    for (const ratio of ratios) {
      await selectRatio(page, ratio); await saveLayout(page);
      const data = await projectSnapshot(new URL(env.backendUrl).port);
      assert.equal(data.settings.runtimeUILayoutProfiles.activeType, type);
      assert.equal(data.settings.runtimeUILayoutProfiles.profiles[type].gameViewport.aspectRatio, ratio);
      assert.equal(data.settings.runtimeUILayout.gameViewport.aspectRatio, ratio);
      if (type === "renpy") assert.deepEqual(data.settings.runtimeUILayoutProfiles.profiles.agentvn,
        project.editor_settings.runtimeUILayoutProfiles.profiles.agentvn, "Inactive legacy profile unchanged");
      else assert.equal(data.settings.runtimeUILayoutProfiles.profiles.renpy.gameViewport.aspectRatio, "4:3");
      await page.reload();
      await page.getByRole("button", { name: "继续上次编辑", exact: true }).click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await openDesigner(page);
      assert((await page.getByRole("combobox", { name: "画面比例", exact: true }).innerText()).includes(ratio));
      pass("select-save-reload-reopen", { type, ratio });
      games.push(await exportCartridge(page, type, ratio)); await openDesigner(page);
    }
  }
  const expected = (await projectSnapshot(new URL(env.backendUrl).port)).settings.runtimeUILayoutProfiles;
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存工程", exact: true }).click();
  const portable = path.join(out, "比例保存重开.vnproj"); await (await pending).saveAs(portable);
  await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
  const zip = await JSZip.loadAsync(fs.readFileSync(portable));
  assert.deepEqual(JSON.parse(await zip.file("project.json").async("string")).editor_settings.runtimeUILayoutProfiles, expected);
  const fresh = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  try {
    const reopened = activePage = await fresh.newPage();
    await reopened.goto(env.url);
    await reopened.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some(e => !e.disabled));
    await reopened.locator(".project-import-button input").first().setInputFiles(portable);
    await reopened.locator(".editor-toolbar").waitFor(); await settleEditor(reopened);
    assert.deepEqual((await projectSnapshot(new URL(env.backendUrl).port)).settings.runtimeUILayoutProfiles, expected);
    await openDesigner(reopened);
    assert((await reopened.getByRole("combobox", { name: "画面比例", exact: true }).innerText()).includes("4:3"));
    pass("portable-both-profiles-roundtrip-real-import", { portable, sha256: sha(portable) });
  } finally { await fresh.close(); activePage = page; }
  await page.close(); return games;
}
const matrix = smoke ? [{ width: 1920, height: 1080, dpr: 1, reduced: false }]
  : [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
async function editorMatrix() {
  for (const m of matrix) {
    const context = await browser.newContext({ viewport: { width: m.width, height: m.height },
      deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference" });
    try {
      const page = activePage = await context.newPage(); page.setDefaultTimeout(20000);
      await env.open(page); await settleEditor(page); await openDesigner(page);
      for (const type of ["renpy", "agentvn"]) {
        if (type === "agentvn") {
          await selectRatio(page, "16:9"); await saveLayout(page);
          await page.locator('[data-layout-type-option="agentvn"]').click(); await settleEditor(page);
        }
        for (const ratio of ratios) {
          await selectRatio(page, ratio);
          await page.evaluate(async () => {
            await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
              .map(a => a.finished.catch(() => {})));
          });
          const control = await page.getByRole("combobox", { name: "画面比例", exact: true }).evaluate(e => {
            const r = e.getBoundingClientRect();
            return { rect: r.toJSON(), hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
              overflow: document.documentElement.scrollWidth - innerWidth };
          });
          assert(control.hit && control.overflow <= 1 && control.rect.right <= m.width && control.rect.bottom <= m.height);
          const frame = page.locator(type === "renpy" ? ".renpy-editor-title-game-frame" : ".runtime-layout-stage");
          const dimensions = await frame.evaluate(e => {
            const r = e.getBoundingClientRect(), p = e.closest(".runtime-layout-center").getBoundingClientRect();
            return { rect: r.toJSON(), parent: p.toJSON() };
          });
          const r = dimensions.rect, p = dimensions.parent;
          assert(Math.abs(r.width / r.height - Number(ratio.split(":")[0]) / Number(ratio.split(":")[1])) < .003);
          assert(r.width > 0 && r.height > 0 && r.left >= p.left - 1 && r.right <= p.right + 1 && r.top >= p.top - 1 && r.bottom <= p.bottom + 1,
            `Preview clipped: ${JSON.stringify({ type, ratio, m, dimensions })}`);
          pass("editor-real-ratio-selection-and-preview-frame", { type, ratio, ...m, control, dimensions });
        }
      }
      if (m.dpr === 2 && !m.reduced)
        await screenshot(page, path.join(out, `editor-${m.width}-d${m.dpr}.png`));
    } finally { await context.close(); }
  }
}
async function embeddedPreview() {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  try {
    const page = activePage = await context.newPage(); page.setDefaultTimeout(20000);
    await env.open(page); await settleEditor(page); await openDesigner(page);
    const designer = page.getByTestId("renpy-title-editor");
    await page.getByTestId("renpy-title-runtime-preview-toggle").click();
    for (const ratio of ratios) {
      await selectRatio(page, ratio);
      for (const mobile of [false, true]) {
        await designer.getByRole("button", { name: mobile ? "移动预览" : "桌面预览", exact: true }).click();
        await page.locator('[data-preview-phase="ready"]').waitFor();
        const element = await page.locator('iframe[title="Ren\'Py（进阶）实际页面预览"]').elementHandle();
        const frame = await element.contentFrame(); assert(frame);
        await frame.getByTestId("renpy-title-view").waitFor();
        await frame.waitForFunction(value => document.querySelector(".ui-skin-scope")?.dataset.gameAspectRatio === value, ratio);
        const value = await inspectFrame(frame, ratio);
        const [width, height] = mobile ? [915, 412] : [1280, ratio === "4:3" ? 960 : ratio === "16:10" ? 800 : 720];
        assert.equal(value.viewport.width, width); assert.equal(value.viewport.height, height);
        pass("editor-embedded-actual-runtime-preview", { ratio, mobile, value });
      }
    }
    await screenshot(page, path.join(out, "embedded-mobile-4-3.png"));
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      report.previewFailureText = await activePage.locator("body").innerText();
      await activePage.screenshot({ path: path.join(out, "preview-failure.png") }); save();
    }
    throw error;
  } finally { await context.close(); }
}
async function runtime(games) {
  for (const game of games) {
    const samples = [...matrix, { width: 2400, height: 1080, dpr: 1, reduced: false, mobile: true }];
    for (const m of samples) {
      const context = await browser.newContext({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: m.dpr,
        reducedMotion: m.reduced ? "reduce" : "no-preference",
        ...(m.mobile ? { isMobile: true, hasTouch: true,
          userAgent: "Mozilla/5.0 (Linux; Android 15; QA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" } : {}) });
      try {
        const page = activePage = await context.newPage(); page.setDefaultTimeout(20000);
        await server.run(async () => {
          await page.goto(`${server.url}/?mode=library`);
          await page.getByTestId("web-cartridge-file").setInputFiles(game.file);
          await page.locator(".launch-panel").getByRole("button", { name: "启动卡带", exact: true }).click();
          await page.getByTestId("start-new-game").waitFor();
          const title = await inspectFrame(page, game.ratio);
          assert.equal(title.viewport.width, m.width); assert.equal(title.viewport.height, m.height);
          assert.equal(title.viewport.dpr, m.dpr); assert.equal(title.viewport.reduced, m.reduced);
          await page.getByTestId("open-settings").click();
          await page.getByTestId("settings-finish").waitFor();
          const settings = await inspectFrame(page, game.ratio);
          await page.getByTestId("settings-finish").click(); await settleRuntime(page);
          await page.getByTestId("start-new-game").click();
          await page.getByTestId("game-state-playing").waitFor();
          if (m.mobile) {
            await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:android-insets", {
              detail: { left: 60, top: 0, right: 24, bottom: 28, coordinateSpace: "css", revision: 1 },
            })));
            await page.waitForFunction(() => document.querySelector(".ui-skin-scope")?.dataset.runtimeSafeRevision === "112");
          }
          const playing = await inspectFrame(page, game.ratio);
          let quick;
          if (game.type === "renpy") {
            quick = await page.getByTestId("renpy-quick-bar").evaluate(e => {
              const rect = e.getBoundingClientRect(), frame = e.closest(".runtime-layout-frame").getBoundingClientRect();
              return { rect: rect.toJSON(), frame: frame.toJSON(), buttons: [...e.querySelectorAll("button")].map(b => {
                const r = b.getBoundingClientRect();
                return { rect: r.toJSON(), disabled: b.disabled,
                  hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
              }) };
            });
            assert.equal(quick.buttons.length, 9);
            assert(quick.rect.top > quick.frame.top && quick.rect.bottom <= quick.frame.bottom + 1);
            const gap = quick.frame.bottom - quick.rect.bottom;
            assert(gap >= -1 && gap <= quick.frame.height * .025 + (m.mobile ? 30 : 2), `Bottom dock drifted: ${gap}`);
            if (m.mobile) assert(quick.rect.bottom <= quick.frame.bottom - 28, "Native bottom safe inset must remain clear");
            for (const button of quick.buttons) {
              assert(Math.abs(button.rect.y - quick.buttons[0].rect.y) < 1);
              assert(button.rect.left >= quick.frame.left - 1 && button.rect.right <= quick.frame.right + 1);
              if (!button.disabled) assert(button.hit, "Every available quick action must be hittable");
            }
            await page.getByTestId("renpy-quick-settings").click();
            await page.getByTestId("settings-finish").waitFor(); await inspectFrame(page, game.ratio);
            await page.getByTestId("settings-finish").click(); await settleRuntime(page);
            const command = await page.getByTestId("game-state-playing").getAttribute("data-current-command-index");
            await page.getByTestId("renpy-quick-hide").click();
            await page.waitForFunction(() => {
              const ui = document.querySelector('[data-testid="story-interface"]');
              return ui?.getAttribute("data-hidden") === "true" && ui.inert && getComputedStyle(ui).opacity === "0";
            });
            await page.keyboard.press("h");
            await page.waitForFunction(() => document.querySelector('[data-testid="story-interface"]')?.getAttribute("data-hidden") === "false");
            await settleRuntime(page);
            assert.equal(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index"), command);
          }
          if (m.dpr === 2 && !m.reduced || m.mobile)
            await screenshot(page, path.join(out, `${game.type}-${game.ratio.replace(":", "-")}-${m.width}-d${m.dpr}${m.mobile ? "-mobile" : ""}.png`));
          pass("exported-cartridge-title-settings-playing", { type: game.type, ratio: game.ratio, ...m,
            title, settings, playing, quick, mobileEmulationOnly: Boolean(m.mobile) });
        });
      } finally { await context.close(); }
    }
  }
}
function reuseExports(folder) {
  const location = path.resolve(folder);
  assert(location.toLowerCase().startsWith("f:\\agentvn\\qa\\"));
  const previousPath = path.join(location, "report.json"), previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));
  const exports = previous.cases.filter(c => c.name === "real-ui-cartridge-export" && c.status === "PASS");
  assert.equal(exports.length, 6, "Reuse only the six already exported real UI artifacts");
  assert.equal(previous.cases.filter(c => c.name === "portable-both-profiles-roundtrip-real-import" && c.status === "PASS").length, 1);
  assert.equal(new Set(exports.map(c => `${c.type}:${c.ratio}`)).size, 6);
  for (const item of exports) assert.equal(sha(item.file), item.sha256);
  if (previous.sourceHashes) assert.deepEqual(previous.sourceHashes, report.sourceHashes);
  report.priorAuthorEvidence = { file: previousPath, sha256: sha(previousPath), status: previous.status,
    authorGroupsPassed: 13, sourceHashesAvailable: Boolean(previous.sourceHashes) };
  report.cases.push(...previous.cases.filter(c => ["real-ui-cartridge-export", "select-save-reload-reopen",
    "portable-both-profiles-roundtrip-real-import"].includes(c.name)).map(c => ({ ...c, evidenceReused: true })));
  save();
  return exports.map(({ type, ratio, file }) => ({ type, ratio, file }));
}
(async () => {
  save();
  try {
    env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 0, logFile: path.join(out, "runtime.log") });
    report.owners = { editor: { pid: env.server.pid, runId: env.server.runId, url: env.url },
      backend: { pid: env.backendPid, url: env.backendUrl }, runtime: { pid: server.pid, runId: server.runId, url: server.url } }; save();
    browser = await chromium.launch({ headless: true });
    let games;
    const previous = process.argv.find(arg => arg.startsWith("--exports-from="));
    if (previous) games = reuseExports(previous.slice("--exports-from=".length));
    else {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      try { games = await env.server.run(() => author(context)); }
      finally { await context.close(); }
    }
    if (previewOnly) await env.server.run(() => embeddedPreview());
    else {
      await env.server.run(() => editorMatrix());
      await runtime(games);
    }
    assert.equal(report.cases.filter(c => c.name === "real-ui-cartridge-export").length, 6);
    if (previewOnly) assert.equal(report.cases.filter(c => c.name === "editor-embedded-actual-runtime-preview").length, 6);
    else assert.equal(report.cases.filter(c => c.name === "exported-cartridge-title-settings-playing").length, 6 * (matrix.length + 1));
    assert.deepEqual(sourceHashes(), report.sourceHashes, "Product source changed while acceptance was running");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = error.stack;
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
      report.visibleText = (await activePage.locator("body").innerText().catch(() => "")).slice(-12000);
    }
  } finally {
    await browser?.close();
    await env?.stop(); await server?.stop();
    const alive = await Promise.all([env?.url, env?.backendUrl, server?.url].filter(Boolean).map(async url => {
      try { await fetch(url, { signal: AbortSignal.timeout(900) }); return url; } catch { return null; }
    }));
    report.cleanup = alive.some(Boolean) ? "FAILED_LIVE_SERVICE" : "PASS";
    if (alive.some(Boolean)) { report.status = "FAILED"; report.aliveServices = alive.filter(Boolean); }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
    if (report.status !== "PASS") process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
