"use strict";
// Frozen installed Release. Only fixture preparation uses the real backend import.
// No store writes, mocked API responses, paid model calls or source UI harness.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor, sha256 } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { installedFeatureSession } = require("./lib/installed-candidate-feature-session.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const standalone = Boolean(process.env.AGENTVN_INSTALLED_INSTALLATION_FILE);
const run = "D:/AgentVN/output/installed-assistant-session-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const out = process.argv[2], phase = process.argv[3] || "window", attempt = Number(process.argv[4] || 1);
assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const launch = standalone ? undefined
  : read(path.join(run, `launch${attempt === 1 ? "" : `-${String(attempt).padStart(2, "0")}`}.json`));
const fixtures = standalone ? {
  projects: ["a", "b"].map(letter => {
    const value = fixture(`qa-installed-window-${letter}-20261101`);
    value.title = `安装工作台窗口隔离 ${letter.toUpperCase()}`;
    const input = path.join(out, `window-${letter}.vnproj`);
    fs.writeFileSync(input, JSON.stringify(value, null, 2), { flag: "wx" });
    return { projectId: value.project_id, title: value.title, input, sha256: sha256(fs.readFileSync(input)) };
  }),
} : read(path.join(run, "fixtures.json")), project = fixtures.projects[0];
const report = { status: "RUNNING", phase, at: new Date().toISOString(), checks: [], matrix: [], screenshots: [],
  errors: [], realModelRequests: 0, apiSubmissions: 0, environment: {
    AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: process.env.AGENTVN_WORKSPACE_OUTPUT },
  scope: "ACTUAL_NSIS_1.9.9_DEFAULT_PATHS_PROTECTED; viewport emulated in native WebView, not physical4K",
  installed: launch ? { executableSha256: launch.executableSha256, installRoot: launch.installRoot } : undefined,
  launches: [], cleanups: [], modelRequests: 0, fixtureSeed: "CONTROLLED_PACKAGED_BACKEND_IMPORT_NOT_NATIVE_PICKER",
  normalClose: "NOT_RUN", error: null };
let browser, page, cdp, win, host;
let expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function stage(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row); save(); console.log(`START ${name}`);
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); console.log(`FAILED ${name}: ${e.message}`); }
  save();
}
async function metrics(value) {
  expected = value;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: value.width, height: value.height,
    deviceScaleFactor: value.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: value.reduced ? "reduce" : "no-preference" });
  await readInstalledViewport(page, expected);
}
async function settleWindow() {
  await win.evaluate(async n => {
    await Promise.all(n.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected));
}
async function rect() { return win.evaluate(n => n.getBoundingClientRect().toJSON()); }
async function geometry() {
  return win.evaluate(n => {
    const box = el => el?.getBoundingClientRect().toJSON() || null;
    const controls = [...n.querySelectorAll(".assistant-creation-workbench-titlebar button")].map(b => {
      const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { name: b.getAttribute("aria-label"), rect: r.toJSON(), hit: hit === b || b.contains(hit) };
    });
    return { window: box(n), conversation: box(n.querySelector('[data-testid="assistant-creation-workbench-conversation"]')),
      studio: box(n.querySelector('[data-testid="assistant-creation-workbench-studio"]')),
      preview: box(n.querySelector('[data-testid="assistant-creation-example-preview"]')),
      controls, overflow: document.documentElement.scrollWidth - innerWidth,
      minimized: n.dataset.minimized, actual: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
  });
}
function assertGeometry(g) {
  assert.equal(g.actual.width, expected.width); assert.equal(g.actual.height, expected.height);
  assert.equal(g.actual.reduced, expected.reduced); assert(Math.abs(g.actual.dpr - expected.dpr) < 1e-6);
  assert(g.overflow <= 1, "Page must not overflow horizontally");
  const r = g.window;
  assert(r.left >= 11 && r.top >= 11 && r.right <= expected.width - 11 && r.bottom <= expected.height - 11,
    `Window exceeds safe margins ${JSON.stringify(r)}`);
  assert.equal(g.controls.length, 5); assert(g.controls.every(b => b.hit && b.rect.width > 0 && b.rect.height > 0));
  for (let i = 1; i < g.controls.length; i++) assert(g.controls[i].rect.left >= g.controls[i - 1].rect.right - 0.5);
  if (g.minimized !== "true") {
    assert(g.conversation.width > 0 && g.studio.width > 0 && g.preview.width > 0 && g.preview.height > 0);
    assert(g.conversation.right <= g.studio.left + 1, "Conversation and studio overlap");
    assert(g.studio.right <= r.right + 1 && g.conversation.left >= r.left - 1);
  }
}
async function assistant() {
  await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
  const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel"); await panel.waitFor();
  await panel.getByRole("button", { name: "创造模式", exact: true }).click();
  await panel.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
  win = page.getByTestId("assistant-creation-workbench-window"); await win.waitFor(); await settleWindow();
  await win.getByTestId("assistant-creation-workbench-studio").waitFor();
  return panel;
}
async function openProject(p) {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: p.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  assert.equal(await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().projectId), p.projectId);
}
async function readProject() {
  return page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState();
    return { projectId: p.projectId, settings: p.settings, assets: p.assetManifest };
  });
}
async function close() {
  await win.getByRole("button", { name: "关闭工作台", exact: true }).click();
  await win.waitFor({ state: "detached" });
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  if (standalone) {
    assert.equal(phase, "window");
    host = installedFeatureSession({ out, report, save, testProject: project.input });
    report.installed = host.installation;
    report.scope = "ACTUAL_INSTALLED_CURRENT_WORKBENCH_WINDOW_LIFECYCLE_ISOLATED_PROFILE_NO_MODEL_CALLS";
    page = await host.start(); cdp = host.cdp;
    // No model call is part of this group; fail any unexpected inquiry too.
    await page.route(/\/api\/assistant\/(?:query|chat|creation\/processes)$/, route => {
      if (route.request().method() !== "POST") return route.continue();
      report.apiSubmissions++; save(); return route.abort();
    });
  } else {
  assert.equal(process.env.AGENTVN_TEST_PROJECT, fixtures.input);
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
  assert.equal(sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  }
  if (phase === "window") for (const p of fixtures.projects) {
    assert.equal(sha256(fs.readFileSync(p.input)), p.sha256);
    const r = await fetch(`http://127.0.0.1:${standalone ? host.current.ports[0] : 8278}/api/project/projects/import`, { method: "POST",
      headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(p.input)) },
      body: fs.readFileSync(p.input), signal: AbortSignal.timeout(30000) });
    const result = await r.json(); assert(r.ok && result.ok && result.data.project_id === p.projectId);
  }
  if (!standalone) {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(15000); page.on("pageerror", e => report.errors.push(String(e)));
  page.on("request", r => {
    if (r.method() === "POST" && /\/api\/assistant\/(query|creation\/processes)$/.test(new URL(r.url()).pathname))
      report.apiSubmissions++;
  });
  cdp = await page.context().newCDPSession(page);
  }
  await metrics(expected);
  await page.reload(); await openProject(project); await assistant();
  if (phase === "reopen") {
    await stage("Actual installed process restart and UI reopen retain only local window geometry", async () => {
      const previous = read(path.join(run, "window-02/report.json"));
      assert(previous.persistedForRestart);
      const current = await rect(), target = previous.persistedForRestart;
      for (const key of ["left", "top", "width", "height"]) assert(Math.abs(current[key] - target[key]) <= 1, key);
      assertGeometry(await geometry()); await shot("restarted-workbench");
      return { actual: current, expected: target, noModelCalls: report.apiSubmissions === 0 };
    });
  } else {
    const baseline = await readProject();
    await stage("Real desktop workbench preview/examples populate input without submitting a model task", async () => {
      await win.getByRole("button", { name: "用“标题页操作”填入构建需求", exact: true }).click();
      assert((await win.getByLabel("向大模型助手提问", { exact: true }).inputValue()).includes("标题页"));
      const preview = win.getByTestId("assistant-creation-example-preview");
      assert(await preview.getByRole("button", { name: "开始游戏", exact: true }).isVisible());
      await win.getByLabel("向大模型助手提问", { exact: true }).fill("");
      assert.equal(report.apiSubmissions, 0); assert.deepEqual(await readProject(), baseline);
      await shot("actual-workbench-preview"); return await geometry();
    });
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const row = { width, height, dpr, reduced, status: "RUNNING" }; report.matrix.push(row);
        await stage(`window-hits-dock-minimize-restore-${width}-${dpr}-${reduced}`, async () => {
          await metrics({ width, height, dpr, reduced });
          await win.getByRole("button", { name: "恢复默认位置和尺寸", exact: true }).click();
          await settleWindow(); row.before = await geometry(); assertGeometry(row.before);
          await win.getByRole("button", { name: "停靠左侧", exact: true }).click();
          assert(Math.abs((await rect()).left - 12) <= 1);
          await win.getByRole("button", { name: "停靠右侧", exact: true }).click();
          assert(Math.abs((await rect()).right - (width - 12)) <= 1);
          const expanded = await rect();
          await win.getByRole("button", { name: "最小化工作台", exact: true }).click();
          await page.waitForFunction(() => document.querySelector('[data-testid="assistant-creation-workbench-window"]')?.dataset.minimized === "true");
          const small = await geometry(); assertGeometry(small); assert(small.window.height <= 55);
          assert.equal(await win.getByLabel("向大模型助手提问", { exact: true }).isVisible(), false);
          // Hidden minimized body cannot own keyboard input.
          assert.equal(await win.locator(".assistant-creation-workbench-content").evaluate(n =>
            [...n.querySelectorAll("button,textarea,input,select,[tabindex]")].filter(e =>
              e.getClientRects().length && !e.disabled && e.tabIndex >= 0).length), 0);
          await win.getByRole("button", { name: "恢复工作台", exact: true }).click();
          const restored = await rect(); for (const k of ["left", "top", "width", "height"]) assert(Math.abs(restored[k] - expanded[k]) <= 1);
          assertGeometry(await geometry()); await shot(`matrix-${width}-${dpr}-${reduced}`);
          row.status = "PASS"; return { minimized: small.window, restored };
        });
        if (row.status !== "PASS") row.status = "FAILED";
      }
    await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await win.getByRole("button", { name: "恢复默认位置和尺寸", exact: true }).click();
    await stage("Pointer movement threshold, drag, cancellation and viewport clamp use real input", async () => {
      const header = win.locator(".assistant-creation-workbench-titlebar"), b = await header.boundingBox();
      const before = await rect(), x = b.x + 100, y = b.y + 20;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 3, y + 2); await page.mouse.up();
      const threshold = await rect();
      for (const k of ["left", "top", "width", "height"]) assert(Math.abs(threshold[k] - before[k]) <= 0.5);
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 90, y + 75, { steps: 10 }); await page.mouse.up();
      const dragged = await rect(); assert(Math.abs(dragged.left - before.left - 90) <= 1);
      assert(Math.abs(dragged.top - before.top - 75) <= 1);
      const next = await header.boundingBox();
      await page.mouse.move(next.x + 100, next.y + 20); await page.mouse.down();
      await page.mouse.move(1, 1, { steps: 10 }); await page.mouse.up();
      const clamped = await rect(); assert(Math.abs(clamped.left - 12) <= 1 && Math.abs(clamped.top - 12) <= 1);
      assertGeometry(await geometry()); await shot("drag-clamped"); return { before, threshold, dragged, clamped };
    });
    await stage("Real resize pointer and keyboard preserve window bounds and usable titlebar", async () => {
      await win.getByRole("button", { name: "恢复默认位置和尺寸", exact: true }).click();
      const before = await rect(), handle = win.getByRole("separator", { name: "调整创造工作台大小", exact: true });
      const b = await handle.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 100, b.y + b.height / 2 + 60, { steps: 10 }); await page.mouse.up();
      const pointer = await rect(); assert(Math.abs(pointer.width - before.width - 100) <= 1);
      assert(Math.abs(pointer.height - before.height - 60) <= 1);
      await handle.focus(); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowUp");
      const keyboard = await rect(); assert(Math.abs(keyboard.width - pointer.width + 24) <= 1);
      assert(Math.abs(keyboard.height - pointer.height + 24) <= 1);
      assertGeometry(await geometry()); return { before, pointer, keyboard };
    });
    await stage("Actual close/reopen and viewport change restore bounded persisted geometry without editing project", async () => {
      const before = await rect(); await close(); await assistant();
      const reopened = await rect(); for (const k of ["left", "top", "width", "height"]) assert(Math.abs(reopened[k] - before[k]) <= 1);
      assert.deepEqual(await readProject(), baseline);
      await metrics({ width: 3840, height: 2160, dpr: 2, reduced: false });
      await win.getByRole("button", { name: "停靠右侧", exact: true }).click();
      await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      await page.waitForFunction(() => {
        const r = document.querySelector('[data-testid="assistant-creation-workbench-window"]').getBoundingClientRect();
        return r.right <= innerWidth - 11 && r.bottom <= innerHeight - 11;
      });
      assertGeometry(await geometry()); assert.equal(report.apiSubmissions, 0);
      report.persistedForRestart = await rect(); await shot("persisted-before-restart");
      return { before, reopened, final: report.persistedForRestart };
    });
    report.finalProject = await readProject();
    if (standalone) {
      await stage("Project switch closes old workbench and cannot change target project", async () => {
        await close();
        await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
        await page.getByRole("button", { name: "返回首页", exact: true }).click();
        await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
        await openProject(fixtures.projects[1]);
        assert.equal(await page.getByTestId("assistant-creation-workbench-window").count(), 0);
        const peer = await readProject(); await assistant(); await close();
        assert.deepEqual(await readProject(), peer);
        await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
        await page.getByRole("button", { name: "返回首页", exact: true }).click();
        await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
        await openProject(project); await assistant();
        assert.deepEqual(await readProject(), baseline);
        report.persistedForRestart = await rect();
        return { targetUnchanged: true, originalUnchanged: true };
      });
      await stage("Actual Editor/backend restart preserves local workbench geometry without model submission", async () => {
        const target = report.persistedForRestart;
        await host.stop("Real window persistence restart; forced stop is not normal-close proof");
        page = await host.start(); cdp = host.cdp; await settleEditor(page);
        await openProject(project); await assistant(); const current = await rect();
        for (const k of ["left", "top", "width", "height"]) assert(Math.abs(current[k] - target[k]) <= 1, k);
        assertGeometry(await geometry()); assert.deepEqual(await readProject(), baseline);
        assert.equal(report.apiSubmissions, 0); assert.equal(report.modelRequests, 0);
        await shot("real-process-restart-window");
        return { expected: target, actual: current, noModelCalls: true };
      });
    }
  }
  assert(report.checks.length > 0 && report.matrix.length === (phase === "reopen" ? 0 : 12));
  report.status = report.checks.every(c => c.status === "PASS") && report.errors.length === 0 ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  if (report.status !== "PASS") process.exitCode = 1;
  try { await browser?.close(); await host?.stop("Final exact-owned window test cleanup"); }
  catch (error) { report.cleanupError = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failed: report.checks.filter(c => c.status !== "PASS").map(c => c.name),
    matrix: report.matrix.length, error: report.error, out }, null, 2));
});
