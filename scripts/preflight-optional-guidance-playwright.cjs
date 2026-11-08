"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const attempt = process.argv[2] || "browser-01";
assert.match(attempt, /^browser-\d{2}$/);
const finalConditionOnly = process.argv[3] === "final-condition";
assert(!process.argv[3] || finalConditionOnly);
const out = path.join("F:/AgentVN/QA/Preflight-Optional-Guidance-20261108-01", attempt);
assert(!fs.existsSync(out), "Keep previous browser evidence");
fs.mkdirSync(out, { recursive: true });
const project = fixture("optional-guidance-browser");
project.nodes[1].data.scene.commands = [{ type: "dialog", character_id: "alice", text: "可选素材预检测试。" }];
const input = path.join(out, "可选素材测试.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_CONTROLLED_PROJECT_NOT_INSTALLED",
  startedAt: new Date().toISOString(), modelRequests: 0, builds: 0, cases: [], errors: [],
  source: { path: path.resolve(__dirname, "../editor/src/cartridge/preflight.ts"),
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname, "../editor/src/cartridge/preflight.ts"))).digest("hex") } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let env, browser;
(async () => {
  save();
  env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.owner = { pid: env.server.pid, backendPid: env.backendPid, url: env.url, backendUrl: env.backendUrl }; save();
  browser = await chromium.launch();
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      if (finalConditionOnly && !(width === 3840 && dpr === 2 && reduced)) continue;
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on("pageerror", e => report.errors.push(String(e)));
      try {
        await env.server.run(async () => {
          await env.open(page);
          await page.locator('[data-workspace-surface="publish"]:visible').click();
          await page.locator('[data-package-stage="checks"]').click();
          await page.locator('[data-preflight-check-id="audio_performance_options"]').click();
          const dialog = page.getByTestId("package-preflight-detail-dialog");
          await dialog.waitFor({ state: "visible" });
          await page.waitForFunction(() => {
            const e = document.querySelector('[data-testid="package-preflight-detail-dialog"]');
            return e && e.contains(document.activeElement);
          });
          const text = await dialog.innerText();
          for (const fragment of [
            "在该场景的背景事件中选择背景图", "在该角色的立绘事件中选择角色图像",
            "在对应对白中选择头像", "在该场景的背景音乐事件中选择音乐素材",
            "在对应对白中选择语音文件", "在该场景的音效事件中选择音效素材",
            "在该场景的事件工作台添加镜头",
          ]) assert(text.includes(fragment), "Missing rendered advice: " + fragment);
          assert(!text.includes("按演出需要补充对应音频"));
          const geometry = await dialog.evaluate(e => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
              width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
              reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
              overflow: document.documentElement.scrollWidth - innerWidth,
              focusInside: e.contains(document.activeElement) };
          });
          report.currentProbe = { width, height, dpr, reduced, geometry }; save();
          assert.equal(geometry.width, width); assert.equal(geometry.height, height);
          assert.equal(geometry.dpr, dpr); assert.equal(geometry.reduced, reduced);
          assert(geometry.left >= -1 && geometry.top >= -1 && geometry.right <= width + 1
            && geometry.bottom <= height + 1 && geometry.overflow <= 1 && geometry.focusInside);
          const screenshot = path.join(out, `${width}-dpr${dpr}-${reduced ? "reduce" : "normal"}.png`);
          await page.screenshot({ path: screenshot });
          const png = fs.readFileSync(screenshot);
          assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), height * dpr);
          await dialog.locator('button[aria-label="关闭发布前诊断"]').click();
          await dialog.waitFor({ state: "hidden" });
          report.cases.push({ status: "PASS", width, height, dpr, reduced, geometry, screenshot, adviceKinds: 7 }); save();
        });
      } finally { await context.close(); }
    }
  }
  assert.equal(report.cases.length, finalConditionOnly ? 1 : 12);
  assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack); process.exitCode = 1; })
  .finally(async () => {
    try { await browser?.close(); await env?.stop(); report.cleanupStatus = env ? "PASS" : "NOT_STARTED"; }
    catch (e) { report.status = "FAILED"; report.cleanupStatus = "FAILED"; report.cleanupError = String(e.stack); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
  });
