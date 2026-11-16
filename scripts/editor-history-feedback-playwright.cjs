"use strict";
// Source full App/real isolated backend; controlled fixture loading only.
// Actual key and field input is exercised; no models or desktop takeover.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const out = path.resolve(process.argv[2] || "");
const baseline = process.argv[3] === "--baseline";
const behaviorOnly = process.argv[3] === "--behavior-only";
const dpr2Followup = process.argv[3] === "--dpr2-followup";
assert.equal(process.argv.length, baseline || behaviorOnly || dpr2Followup ? 4 : 3);
assert(process.argv[2] && out.startsWith("F:\\testavn\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const project = fixture("qa_history_feedback_20261116");
project.nodes[1].data.label = project.nodes[1].data.scene.title = "雨夜车站";
project.nodes[1].data.scene.commands = [100, 200, 300].map(duration_ms => ({ type: "wait", duration_ms }));
const input = path.join(out, "fixture.vnproj"); fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const report = { status: "RUNNING", scope: "SOURCE_FULL_APP_REAL_BACKEND_CONTROLLED_FIXTURE_NOT_INSTALLED",
  cases: [], errors: [], sources: [], models: 0, computerUse: false };
for (const relative of ["editor/src/components/editor/GraphHistoryShortcuts.tsx", "editor/src/utils/graphHistoryDescription.ts"]) {
  const source = path.resolve(__dirname, "..", relative);
  if (!fs.existsSync(source)) { report.sources.push({ source, existed: false }); continue; }
  const retained = path.join(out, "sources", relative); fs.mkdirSync(path.dirname(retained), { recursive: true });
  fs.copyFileSync(source, retained, fs.constants.COPYFILE_EXCL);
  report.sources.push({ source, retained, sha256: sha(source) });
}
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let service, browser, page;
async function state() {
  return page.evaluate(async () => {
    const s = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    return JSON.parse(JSON.stringify({ nodes: s.nodes.map(n => ({ id: n.id, data: n.data, position: n.position })),
      edges: s.edges.map(({ selected, ...edge }) => edge), past: s.graphHistory.past.length,
      future: s.graphHistory.future.length, notice: s.lastError }));
  });
}
async function load(value = project) {
  if (await page.getByTestId("editor-undo-confirmation").isVisible()) {
    await page.getByTestId("editor-undo-confirmation").getByRole("button", { name: "取消", exact: true }).click();
    await page.getByTestId("editor-undo-confirmation").waitFor({ state: "hidden" });
  }
  await page.evaluate(async value => {
    const s = (await import("/src/store/editorStore.ts")).useEditorStore;
    const p = (await import("/src/store/projectStore.ts")).useProjectStore;
    s.getState().importProject(value); p.getState().loadProjectMetadata(value);
    s.getState().selectNode("scene");
  }, value);
  await page.locator(".inspector-panel .command-card").first().waitFor();
}
async function canvasKey(key) {
  await page.locator(".flow-surface").click({ position: { x: 15, y: 15 } });
  await page.keyboard.press(key);
}
async function changeWait(value = 400) {
  await page.locator(".inspector-panel .command-card-summary").first().click();
  const input = page.locator(".inspector-panel input[data-help-key='command.wait.durationMs']").first();
  await input.fill(String(value)); await input.press("Tab");
}
async function test(name, action) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { await load(); await action(row); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack;
    await page.screenshot({ path: path.join(out, `failed-${report.cases.length}.png`) }).catch(() => {}); }
  save(); console.log(JSON.stringify(row));
}
(async () => {
  save(); service = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.service = { url: service.url, backendUrl: service.backendUrl, backendPid: service.backendPid,
    vitePid: service.server.pid, runId: service.server.runId };
  const temporary = path.join(out, "temp"); fs.mkdirSync(temporary);
  browser = await chromium.launch({ headless: true, env: { ...process.env, TEMP: temporary, TMP: temporary } });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(12000); page.on("pageerror", error => report.errors.push(String(error)));
  await service.open(page);
  if (!dpr2Followup) {
  await test("Empty Ctrl+Z gives a visible notice and never opens confirmation or changes the graph", async row => {
    const before = await state(); await canvasKey("Control+z");
    await until(async () => /没有可撤销/.test((await state()).notice?.message || ""), "empty undo notice", 1500);
    const after = await state(); assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.edges, before.edges);
    assert.equal(await page.getByTestId("editor-undo-confirmation").count(), 0); row.notice = after.notice.message;
  });
  await test("Empty Ctrl+Y gives a visible notice without modifying content", async row => {
    const before = await state(); await canvasKey("Control+y");
    await until(async () => /没有可重做/.test((await state()).notice?.message || ""), "empty redo notice", 1500);
    const after = await state(); assert.deepEqual(after.nodes, before.nodes); row.notice = after.notice.message;
  });
  await test("Event undo describes the named scene and exact event index; cancel, confirm and redo preserve content", async row => {
    await changeWait(); const edited = await state(); await canvasKey("Control+z");
    const dialog = page.getByTestId("editor-undo-confirmation"); await dialog.waitFor();
    row.text = await dialog.innerText(); assert.match(row.text, /雨夜车站/); assert.match(row.text, /第\s*1\s*项/); assert.match(row.text, /等待/);
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.deepEqual((await state()).nodes, edited.nodes);
    await canvasKey("Control+z"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "确认撤销", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    await until(async () => (await state()).nodes[1].data.scene.commands[0].duration_ms === 100, "confirmed event undo", 3000);
    await page.keyboard.press("Control+y");
    await until(async () => (await state()).nodes[1].data.scene.commands[0].duration_ms === 400, "event redo", 3000);
    assert.deepEqual((await state()).nodes, edited.nodes);
  });
  await test("Native text undo stays in its input and never opens graph confirmation", async () => {
    const title = page.locator(".inspector-panel input[data-help-key='field.title']");
    await title.focus(); await title.press("End"); await page.keyboard.type("ABC"); await page.keyboard.press("Control+z");
    assert.equal(await page.getByTestId("editor-undo-confirmation").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-help-key")), "field.title");
    assert(!/ABC$/.test(await title.inputValue()));
  });
  await test("A pending confirmation cannot undo a newer edit or an A→B→A loaded graph", async () => {
    for (const variant of ["new-edit", "reload"]) {
      await load(); await changeWait(); await canvasKey("Control+z");
      const dialog = page.getByTestId("editor-undo-confirmation"); await dialog.waitFor();
      await page.evaluate(async ({ variant, value }) => {
        const s = (await import("/src/store/editorStore.ts")).useEditorStore;
        const p = (await import("/src/store/projectStore.ts")).useProjectStore;
        if (variant === "reload") {
          const b = structuredClone(value); b.project_id += "_b"; s.getState().importProject(b); p.getState().loadProjectMetadata(b);
          s.getState().importProject(value); p.getState().loadProjectMetadata(value);
        }
        s.getState().updateSceneCommands("scene", [{ type: "wait", duration_ms: 999 }]);
      }, { variant, value: project });
      const latest = await state();
      await dialog.getByRole("button", { name: "确认撤销", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      assert.deepEqual((await state()).nodes, latest.nodes); assert.match((await state()).notice.message, /内容已变化/);
    }
  });
  }
  for (const [width, height] of baseline || behaviorOnly ? [] : [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of dpr2Followup ? [2] : [1, 2]) for (const reduced of [false, true]) {
      await test(`Confirmation geometry ${width}x${height} DPR${dpr} reduced=${reduced}`, async row => {
        const client = await page.context().newCDPSession(page);
        try {
        await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
        await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        await changeWait(); await canvasKey("Control+z");
        const dialog = page.getByTestId("editor-undo-confirmation"); await dialog.waitFor();
        const result = await dialog.locator('[role="dialog"]').evaluate(element => {
          const r = element.getBoundingClientRect();
          return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
            rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
            overflow: element.scrollWidth > element.clientWidth + 1, text: element.innerText,
            focusedInside: element.contains(document.activeElement) };
        });
        assert.equal(result.width, width); assert.equal(result.height, height); assert.equal(result.dpr, dpr);
        assert.equal(result.reduced, reduced); assert.equal(result.overflow, false);
        assert.equal(result.focusedInside, true);
        assert(result.rect.left >= 0 && result.rect.top >= 0 && result.rect.right <= width && result.rect.bottom <= height);
        assert.match(result.text, /雨夜车站/);
        assert.equal(await dialog.getByRole("button", { name: "确认撤销", exact: true }).isEnabled(), true);
        await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
        assert.equal((await state()).nodes[1].data.scene.commands[0].duration_ms, 400);
        row.actual = result;
        } finally { await client.detach(); }
      });
    }
  assert.equal(report.cases.length, baseline || behaviorOnly ? 5 : dpr2Followup ? 6 : 17); assert(report.cases.every(row => row.status === "PASS"));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; })
.finally(async () => {
  try { await browser?.close(); await service?.stop(); report.cleanup = "OWNED_BROWSER_AND_SERVICES_STOPPED"; }
  catch (error) { report.cleanup = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
});
