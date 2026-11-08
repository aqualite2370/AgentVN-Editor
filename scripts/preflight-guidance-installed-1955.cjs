"use strict";
// Actual installed UI; fixture preparation uses the supported project import API.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const base = path.resolve(process.argv[2]);
assert(["10", "11"].some(n => base === `F:\\AgentVN\\QA\\Windows-Isolated-1944-20261108-${n}`));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const out = path.join(base, "guidance-01"); fs.mkdirSync(out);
const report = { status: "RUNNING", version: "1.9.55",
  scope: "ACTUAL_NSIS_DEFAULT_QA_PROFILE_SUPPORTED_API_FIXTURE_UI_AND_RESTART_1080P_DPR1",
  stages: [], launches: [], cleanups: [], screenshots: [], errors: [], modelRequests: 0,
  fixture: { path: path.join(base, "fixture.vnproj"), sha256: sha(path.join(base, "fixture.vnproj")) } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let session, page;
async function stage(name, fn) {
  const row = { name, status: "RUNNING" }; report.stages.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { save(); }
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = require("node:net").createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(e => e ? reject(e) : resolve(port)); });
  });
}
async function inspect(label) {
  await page.locator('[data-workspace-surface="publish"]:visible').click();
  // Installed publish auto-detects the actual environment; do not force-click
  // through the modal or claim that a missing QA toolchain passed inspection.
  await page.locator(".package-stage-navigation-item").first().waitFor({ state: "visible" });
  const environment = page.getByTestId("package-environment-operation-dialog");
  await page.waitForFunction(() => {
    const e = document.querySelector('[data-testid="package-environment-operation-dialog"]');
    return e && ["completed", "failed"].includes(e.getAttribute("data-environment-phase"));
  }, undefined, { timeout: 120000 });
  const environmentResult = { phase: await environment.getAttribute("data-environment-phase"),
    text: await environment.innerText() };
  await environment.getByRole("button", { name: /^(完成|关闭)$/, exact: true }).click();
  await environment.waitFor({ state: "hidden" });
  await page.locator('[data-package-stage="checks"]').click();
  await page.locator('[data-preflight-check-id="audio_performance_options"]').click();
  const dialog = page.getByTestId("package-preflight-detail-dialog");
  await dialog.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const e = document.querySelector('[data-testid="package-preflight-detail-dialog"]');
    return e && e.contains(document.activeElement);
  });
  const text = await dialog.innerText();
  const fragments = ["在该场景的背景事件中选择背景图", "在该角色的立绘事件中选择角色图像",
    "在对应对白中选择头像", "在该场景的背景音乐事件中选择音乐素材",
    "在对应对白中选择语音文件", "在该场景的音效事件中选择音效素材",
    "在该场景的事件工作台添加镜头"];
  const advice = fragments.map(fragment => ({ fragment, present: text.includes(fragment) }));
  report.currentProbe = { label, advice };
  const geometry = await dialog.evaluate(e => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth,
      height: innerHeight, dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      overflow: document.documentElement.scrollWidth - innerWidth, focusInside: e.contains(document.activeElement) };
  });
  report.currentProbe.geometry = geometry; save();
  assert(advice.every(a => a.present), "All seven resource-specific solutions must be rendered");
  assert(!text.includes("按演出需要补充对应音频"));
  assert.equal(geometry.width, 1920); assert.equal(geometry.height, 1080);
  assert.equal(geometry.dpr, 1); assert.equal(geometry.reduced, false);
  assert(geometry.left >= -1 && geometry.top >= -1 && geometry.right <= 1921
    && geometry.bottom <= 1081 && geometry.overflow <= 1 && geometry.focusInside);
  await session.shot(label);
  await dialog.getByRole("button", { name: "关闭发布前诊断", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  return { advice, geometry, environmentResult, realClicks: 5, modelRequests: 0 };
}
(async () => {
  try {
    await stage("actual-NSIS-and-payload", async () => {
      const op = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(__dirname, "animation-install-1945.ps1"), "-SessionRoot", base],
      { encoding: "utf8", windowsHide: true, timeout: 240000 });
      report.install = { exitCode: op.status, stdout: op.stdout, stderr: op.stderr };
      assert.ifError(op.error); assert.equal(op.status, 0, op.stderr);
      const i = read(path.join(base, "installation.json"));
      assert.equal(i.status, "PASS"); assert.equal(i.metadataRestoration, "PASS");
      return i.executable;
    });
    report.backendPort = await freePort();
    const installation = read(path.join(base, "installation.json"));
    const project = read(report.fixture.path);
    const newSession = label => defaultEditorSession({ installation, out, report, save, label,
      expectedQaUser: owner.account.name, isolatedBackendPort: report.backendPort });
    session = newSession("initial"); page = await session.start();
    await stage("supported-import-and-installed-publish-advice", async () => {
      const response = await fetch(`http://127.0.0.1:${report.backendPort}/api/project/projects/import`, {
        method: "POST", headers: { "content-type": "application/octet-stream" },
        body: fs.readFileSync(report.fixture.path), signal: AbortSignal.timeout(30000),
      });
      assert(response.ok); assert.equal((await response.json()).ok, true);
      await page.reload();
      await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      await until(async () => (await session.api(`/api/project/projects/${project.project_id}`))?.project_id
        === project.project_id, "packaged backend durable fixture");
      return inspect("installed-seven-advice");
    });
    await stage("natural-close-including-managed-backend", () => session.naturalClose());
    session = newSession("restart"); page = await session.start();
    await stage("default-database-restart-and-advice", async () => {
      await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      const disk = await session.api(`/api/project/projects/${project.project_id}`);
      assert.equal(disk.nodes.length, project.nodes.length);
      assert.deepEqual(disk.nodes.map(n => n.id), project.nodes.map(n => n.id));
      return inspect("restarted-seven-advice");
    });
    await stage("final-natural-close", () => session.naturalClose());
    assert.equal(report.stages.length, 5); assert(report.stages.every(s => s.status === "PASS"));
    assert.deepEqual(report.errors, []); assert.equal(report.blockedModelRequests || 0, 0);
    report.status = "PASS_INSTALLED_PREFLIGHT_GUIDANCE";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      try {
        report.failureProbe = await page.evaluate(() => ({ title: document.title, text: document.body.innerText,
          width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          dialogs: [...document.querySelectorAll('[role="dialog"]')].map(e => ({
            text: e.textContent, phase: e.getAttribute("data-environment-phase") })) }));
        await session.shot("failure");
      } catch (probeError) { report.failureProbeError = String(probeError); }
    }
  }
  finally {
    try { await session?.stop(); report.cleanupStatus = "PASS"; }
    catch (e) { report.cleanupStatus = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    fs.writeFileSync(path.join(base, "stop.json"), JSON.stringify({ at: report.finishedAt }), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, cleanup: report.cleanupStatus, out, error: report.error }));
  }
})();
