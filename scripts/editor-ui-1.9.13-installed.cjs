"use strict";
// Actual NSIS directory and native WebView; controlled local task, zero models.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, projectSnapshot } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2] || "31";
assert.match(attempt, /^\d{2}$/);
const out = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const input = path.join(out, "1.9.13 界面独立工程.vnproj"), p = fixture(`editor-1913-ui-${attempt}`);
p.title = `1.9.13 布局与卡片验收 ${attempt}`;
fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
const report = { status: "RUNNING", at: new Date().toISOString(), matrix: [], errors: [], launches: [], cleanups: [],
  screenshots: [], modelRequests: 0, nativeFilePickerClaimed: false, normalCloseClaimed: false,
  scope: "ACTUAL_INSTALLED_EDITOR_UI_THREE_FIXES_NOT_ALL_PAGES_OR_GAME_EXPORT", commands: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const session = installedReleaseSession({
  installationFile: "F:/AgentVN/QA/Editor-1.9.13-20261021-01/installation.json", out, input, report, save,
});
let page, cachePrepared = false;
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 30000 });
  report.commands.push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function openProject() {
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: p.title }).click();
  await settleEditor(page);
}
async function openLayout() {
  if (await page.locator('[data-workspace-surface="options"]:visible').getAttribute("aria-current") !== "page")
    await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
}
async function type(t) {
  const b = page.locator(`[data-layout-type-option="${t}"]:visible`);
  if (await b.getAttribute("aria-pressed") !== "true") await b.click();
  await page.waitForFunction(t => document.querySelector(".runtime-layout-designer")?.dataset.layoutType === t
    && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false", t);
  const player = page.getByTestId("renpy-player-layout-entry");
  if (await player.isVisible()) await player.click();
  await page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }).click();
  await settleEditor(page);
}
async function saveLayout() {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
}
(async () => {
  save(); cache("SelfTest"); cache("Prepare"); cachePrepared = true;
  page = await session.start();
  assert.equal(session.installation.executable.version, "1.9.13");
  const r = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
    body: fs.readFileSync(input),
  });
  const imported = await r.json(); assert(r.ok && imported.ok && imported.data.project_id === p.project_id);
  const now = new Date().toISOString();
  await page.evaluate(({ id, now }) => localStorage.setItem(`agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(id)}`,
    JSON.stringify({ projectId: id, events: [], job: {
      jobId: "installed-compact-task", novelTitle: "本机受控解析任务", status: "running", source: "mock",
      selectedChapterCount: 1, totalChunks: 4, completedChunks: 2, failedChunks: 0, cancelledChunks: 0,
      runningAgentCount: 1, estimatedRemainingChunks: 2, progressPercent: 50, agents: [], chapters: [],
      tokenStats: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, estimatedTokens: 0,
        actualTokens: 0, averageChunkTokens: 0, retryExtraTokens: 0, byAgent: [], byChapter: [] },
      createdAt: now, updatedAt: now,
    } })), { id: p.project_id, now });
  await page.reload(); await page.locator(".project-home").waitFor(); await openProject();
  const expectedRadius = { agentvn: 6, renpy: 0 };
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2])
    for (const reduced of [false, true]) {
      const m = { width, height, dpr, reduced }, cell = { ...m, status: "RUNNING", types: [] }; report.matrix.push(cell); save();
      await session.metrics(m);
      const background = await page.locator(".node-palette").boundingBox();
      await openLayout();
      for (const t of ["agentvn", "renpy"]) {
        await type(t);
        const observed = await page.evaluate(() => {
          const bounds = s => document.querySelector(s).getBoundingClientRect().toJSON();
          const panel = bounds(".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)");
          const controls = [".runtime-layout-header", ".runtime-layout-grid > .runtime-layout-sidebar",
            ".runtime-layout-center", ".runtime-layout-inspector", '[data-help-key="layout.save"]'].map(s => {
            const n = document.querySelector(`.advanced-tab-content.is-active ${s}`), r = n.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(20, r.height / 2));
            return { selector: s, rect: r.toJSON(), overflow: n.scrollWidth - n.clientWidth, hit: n === hit || n.contains(hit) };
          });
          return { panel, controls, overflow: document.documentElement.scrollWidth - innerWidth,
            palette: bounds(".node-palette") };
        });
        assert(observed.overflow <= 1 && observed.palette.right <= observed.panel.left + 1);
        for (const c of observed.controls) assert(c.rect.left >= observed.panel.left - 1 && c.rect.right <= observed.panel.right + 1
          && c.rect.top >= observed.panel.top - 1 && c.rect.bottom <= observed.panel.bottom + 1 && c.overflow <= 1,
        JSON.stringify(c));
        assert(observed.controls.at(-1).hit, "Installed save control must be clickable");
        const speaker = page.locator('.runtime-layout-sidebar button[data-component-id="speaker_label"]');
        assert.match(await speaker.innerText(), /姓名容器/); await speaker.click();
        const appearance = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^外观$/ }) });
        if (await appearance.getAttribute("open") === null) await appearance.locator("summary").click();
        const radius = appearance.locator("label").filter({ hasText: /^borderRadius/ }).locator('input[type="number"]');
        assert.equal(await radius.inputValue(), String(expectedRadius[t]));
        if (report.matrix.length === 1) {
          expectedRadius[t]++; await radius.fill(String(expectedRadius[t])); await radius.press("Tab");
        }
        await saveLayout();
        cell.types.push({ type: t, observed, savedRadius: expectedRadius[t] }); save();
        if (width === 1920 && dpr === 1 && !reduced) await session.shot(`${t}-full-layout-and-name`);
      }
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
      assert.deepEqual(await page.locator(".node-palette").boundingBox(), background, "Installed layout close restores rail geometry");
      const card = page.getByTestId("novel-task-mini-entry"); await card.waitFor({ state: "visible" });
      const cardBounds = await card.boundingBox(); assert(Math.abs(cardBounds.width - 140) <= 1);
      await card.getByRole("button", { name: "隐藏任务卡片", exact: true }).click(); await card.waitFor({ state: "hidden" });
      await page.locator('[data-help-key="toolbar.novelImport"]:visible').click();
      await page.getByRole("button", { name: "关闭小说导入工作台", exact: true }).click();
      await settleEditor(page); await card.waitFor({ state: "visible" });
      assert.equal(await card.getAttribute("data-job-status"), "running");
      cell.card = { width: cardBounds.width, hideRestore: "PASS", controlledTask: true };
      if (width === 1920 && dpr === 1 && !reduced) await session.shot("compact-card-restored");
      cell.status = "PASS"; save(); console.log(`PASS installed ${width} DPR${dpr} reduce=${reduced}`);
    }
  const before = await projectSnapshot(session.current.ports[0]);
  report.persistedProfiles = before.settings.runtimeUILayoutProfiles; save();
  await session.stop("restart-persistence"); page = await session.start(); await openProject();
  const after = await projectSnapshot(session.current.ports[0]);
  assert.deepEqual(after.settings.runtimeUILayoutProfiles, report.persistedProfiles);
  report.restart = { status: "PASS", terminationMethod: "OWNED_PROCESS_STOP_NOT_NORMAL_NATIVE_CLOSE" };
  assert.equal(report.matrix.length, 12); assert(report.matrix.every(c => c.status === "PASS" && c.types.length === 2));
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    try {
      await session.stop("finally");
      if (cachePrepared) { cache("Restore"); report.nativeCacheRestoration = "PASS"; }
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  });
