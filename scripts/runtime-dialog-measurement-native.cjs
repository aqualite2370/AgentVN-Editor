"use strict";
// New Dev only. Real node-preview iframe, isolated temporary project/DB/WebView.
// Not a Release installation, native picker, normal-close or export acceptance.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { nativeSession } = require("./lib/current-native-editor-session.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { runtimeRenderDiagnosticInit } = require("./lib/runtime-render-diagnostic.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Runtime-Dialog-Measurement-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `native-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const prep = read("F:/AgentVN/QA/Installed-Portrait-20261021-01/preparation.json");
const devFile = path.join(qa, "dev-01/report.json"), dev = read(devFile);
assert.equal(dev.status, "PASS"); assert.equal(sha(dev.products[0].path), dev.products[0].sha256);
const project = read(prep.input.path), scene = project.nodes.find(n => n.data.nodeKind === "scene"); assert(scene);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "CURRENT_DEV_REAL_NODE_PREVIEW_NOT_INSTALLED_RELEASE", precondition: { path: devFile, sha256: sha(devFile) },
  cases: [], launches: [], cleanups: [], known: [], screenshots: [], errors: [], modelRequests: 0,
  input: prep.input, originalInstalledFailureUnchanged: true };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = nativeSession({ out, input: prep.input.path, report, save });
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(path.join(root, "scripts/lib/runtime-render-diagnostic.cjs"),
    path.join(out, "runtime-render-diagnostic.cjs"), fs.constants.COPYFILE_EXCL);
  const page = await host.start();
  await page.context().addInitScript(runtimeRenderDiagnosticInit);
  await page.context().route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
    if (route.request().method() !== "POST") return route.continue();
    report.modelRequests++; save(); return route.abort();
  });
  const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(prep.input.path)) }, body: fs.readFileSync(prep.input.path),
    signal: AbortSignal.timeout(30000) });
  const payload = await response.json(); assert(response.ok && payload.ok);
  assert.equal(payload.data.project_id, prep.projectId);
  await page.reload(); await page.locator(".project-home").waitFor();
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: prep.title }).click();
  await settleEditor(page);
  const directNode = page.locator(`.react-flow__node[data-id="${scene.id}"]`);
  assert.equal(await directNode.count(), 1);
  await directNode.click(); await settleEditor(page);
  for (const reduced of [false, true]) for (const type of ["agentvn", "renpy"]) {
    const row = { type, reduced, status: "RUNNING" }; report.cases.push(row); save();
    await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced });
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    const button = page.locator(`[data-layout-type-option="${type}"]:visible`);
    if (await button.getAttribute("aria-pressed") !== "true") await button.click();
    await page.locator(`.runtime-layout-designer[data-layout-type="${type}"]`).waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    await settleEditor(page);
    await page.locator('[data-help-key="layout.save"]:visible').click();
    await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    const target = page.locator(".embedded-runtime-preview-frame iframe");
    await target.waitFor();
    row.owner = await target.evaluate(n => ({ title: n.title,
      ghost: !!n.closest(".toolbar-popover-morph-ghost"), rect: n.getBoundingClientRect().toJSON() }));
    assert.equal(row.owner.title, "GameCLI 内嵌预览"); assert.equal(row.owner.ghost, false);
    const frame = await (await target.elementHandle()).contentFrame(); assert(frame);
    await settleRuntime(frame); await frame.locator(".dialog-box").waitFor();
    await frame.getByTestId("game-state-playing").waitFor();
    await frame.locator('img[data-portrait-ready="true"]').waitFor();
    row.samples = await frame.evaluate(async () => {
      const samples = [];
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const box = document.querySelector(".dialog-box"), text = document.querySelector(".dialog-text");
        if (!box || !text) throw Error("Node preview lost active dialogue");
        samples.push({ pages: box.getAttribute("data-dialog-pages"), font: getComputedStyle(text).fontSize,
          width: text.clientWidth, height: text.clientHeight, scroll: [text.scrollWidth, text.scrollHeight],
          layout: box.closest("[data-layout-type]")?.getAttribute("data-layout-type"), text: text.textContent });
      }
      return samples;
    });
    assert.equal(new Set(row.samples.slice(-10).map(s => JSON.stringify(s))).size, 1);
    assert(row.samples.every(s => s.layout === type && s.scroll[0] <= s.width + 1 && s.scroll[1] <= s.height + 1));
    assert(row.samples.every(s => s.text === project.nodes.find(n => n.id === scene.id).data.scene.commands[0].text));
    assert.deepEqual(report.errors, []);
    // The temporary DevTools hook is not a required product interface. Presence of
    // actual playing state, decoded portrait and 30 measured text frames above
    // is the behavior oracle, not presence of this optional tracing global.
    row.trace = await frame.evaluate(() => window.__agentvnRenderTrace ?? null);
    row.optionalTraceStatus = row.trace ? "AVAILABLE" : "NOT_AVAILABLE_IN_THIS_FRAME";
    row.status = "PASS"; save();
    if (!reduced) await host.shot(`${type}-real-node-preview`);
  }
  assert.equal(report.cases.length, 4); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    try {
      await host.stop("Owned termination after isolated Dev node-preview regression; not normal close");
      assert.equal(sha(dev.products[0].path), dev.products[0].sha256);
      for (const f of prep.immutable.filter(f => path.resolve(f.path) !== path.resolve(dev.products[0].path)))
        assert.equal(sha(f.path), f.sha256);
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  });
