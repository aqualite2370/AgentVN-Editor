"use strict";
// Controlled protocol replay in actual installed WebView, NOT user-flow acceptance.
// No authoring mutation, paid calls, publishing/environment checks or product edits.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { installedFeatureSession } = require("./lib/installed-candidate-feature-session.cjs");
const { settleEditor, settleRuntime, assertProjectContentUnchanged } = require("./lib/installed-acceptance.cjs");
const { runtimeRenderDiagnosticInit } = require("./lib/runtime-render-diagnostic.cjs");
const qa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `init-replay-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const prep = read(path.join(qa, "preparation.json")), source = read(path.join(qa, "editor-03/report.json"));
assert.equal(source.status, "FAILED");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "CONTROLLED_PROTOCOL_REPLAY_NOT_USER_FLOW_ACCEPTANCE", originalFailureRemainsOpen: true,
  productStatus: "FAILED", launches: [], cleanups: [], errors: [], screenshots: [], modelRequests: 0, replays: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedFeatureSession({ out, report, save,
  profileRoot: path.dirname(source.launches[0].data), testProject: prep.input.path });
let page, frame;
async function replay(type, iteration, burst = false) {
  const skin = source.cartridges.find(c => c.type === type);
  assert(skin && sha(skin.path) === skin.sha256);
  const entry = { type, iteration, burst, source: { path: skin.path, sha256: skin.sha256 },
    startedAt: new Date().toISOString() };
  report.replays.push(entry); save();
  entry.result = await page.evaluate(async ({ type, skin, iteration, burst }) => {
    const target = document.querySelector(".renpy-editor-runtime-viewport iframe");
    if (!target || target.closest(".toolbar-popover-morph-ghost")) throw Error("No owned active Runtime");
    const child = target.contentWindow, initial = child.__agentvnReplayInit;
    if (!initial) throw Error("Actual initialization packet not captured");
    const revision = initial.revision + 1, requestId = `qa-replay-${iteration}-${type}-${revision}`;
    const message = { ...initial, revision, requestId, runId: requestId, uiSkin: skin,
      screen: "playing", start: { ...initial.start, requestId } };
    const expected = new Map([[requestId, revision]]);
    if (burst) expected.set(requestId + "-newer", revision + 1);
    const response = new Promise((resolve, reject) => {
      const received = [];
      const timer = setTimeout(() => { removeEventListener("message", receive); reject(Error("Replay response timeout")); }, 15000);
      function receive(event) {
        const m = event.data;
        if (event.source !== child || event.origin !== location.origin || !expected.has(m?.requestId)
          || m.sessionId !== initial.sessionId || m.revision !== expected.get(m.requestId)) return;
        if (!["agentvn.live-preview.ready", "agentvn.live-preview.error"].includes(m.type)) return;
        expected.delete(m.requestId);
        received.push({ type: m.type, revision: m.revision, requestId: m.requestId, message: m.message, at: performance.now() });
        if (!expected.size) {
          clearTimeout(timer); removeEventListener("message", receive);
          resolve(received);
        }
      }
      addEventListener("message", receive);
    });
    const started = performance.now();
    child.postMessage(message, location.origin);
    if (burst) {
      // Send an immediately newer init to the real queue without store access.
      const newer = { ...message, revision: revision + 1, requestId: requestId + "-newer", runId: requestId + "-newer",
        start: { ...message.start, requestId: requestId + "-newer" } };
      child.postMessage(newer, location.origin);
    }
    const result = await response;
    return { responses: result, elapsed: performance.now() - started, source: "PARENT_POSTMESSAGE_ACTUAL_CAPTURE",
      gameId: initial.manifest.game_id, layout: type };
  }, { type, skin: skin.layout, iteration, burst });
  assert.equal(entry.result.responses.length, burst ? 2 : 1);
  assert(entry.result.responses.every(r => r.type === "agentvn.live-preview.ready"));
  await settleRuntime(frame);
  await frame.locator('img[data-portrait-ready="true"]').waitFor();
  entry.trace = await frame.evaluate(() => window.__agentvnRenderTrace);
  assert(entry.trace.rendererCount > 0 && entry.trace.snapshots.some(s => s.dialogs.length));
  assert.deepEqual(entry.trace.errors, []);
  entry.finishedAt = new Date().toISOString(); save();
  if (report.errors.length) throw Error("Actual installed Runtime exception during controlled replay");
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(path.resolve(__dirname, "lib/runtime-render-diagnostic.cjs"), path.join(out, "runtime-render-diagnostic.cjs"), fs.constants.COPYFILE_EXCL);
  page = await host.start();
  await page.context().addInitScript(runtimeRenderDiagnosticInit,
    { captureGameId: `${prep.projectId}-renpy-layout-preview` });
  await settleEditor(page);
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: prep.title }).click();
  await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await settleEditor(page);
  const entry = page.getByTestId("renpy-player-layout-entry");
  if (await entry.isVisible()) await entry.click();
  await page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }).click();
  await settleEditor(page);
  const toggle = page.getByRole("button", { name: "实际 Runtime 预览", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  const target = page.locator(".renpy-editor-runtime-viewport iframe");
  await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
  frame = await (await target.elementHandle()).contentFrame(); assert(frame);
  await settleRuntime(frame); await frame.locator('img[data-portrait-ready="true"]').waitFor();
  assert(await frame.evaluate(() => !!window.__agentvnReplayInit));
  const before = await host.api("/api/project/state");
  report.initialState = before; save();
  for (let i = 0; i < 4; i++) await replay(i % 2 ? "renpy" : "agentvn", i);
  for (let i = 4; i < 6; i++) await replay(i % 2 ? "renpy" : "agentvn", i, true);
  const after = await host.api("/api/project/state"); report.finalState = after;
  assertProjectContentUnchanged(after.project_metadata, before.project_metadata);
  const { project_metadata: _a, ...restAfter } = after;
  const { project_metadata: _b, ...restBefore } = before;
  assert.deepEqual(restAfter, restBefore);
  assert.equal(report.replays.length, 6); assert.equal(report.modelRequests, 0);
  assert.deepEqual(report.errors, []);
  report.status = "CONTROLLED_REPLAY_NOT_REPRODUCED_ORIGINAL_FAILURE_REMAINS_OPEN";
})().catch(async e => {
  report.error = String(e.stack || e);
  report.status = report.errors.some(e => e.includes("#185")) ? "REPRODUCED_CONTROLLED_PROTOCOL_SEAM" : "DIAGNOSTIC_FAILED";
  process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureDOM = await page.locator("body").innerText().catch(String);
    report.traceAtFailure = frame ? await frame.evaluate(() => window.__agentvnRenderTrace).catch(String) : null;
  }
}).finally(async () => {
  try {
    await host.stop("End terminal controlled initialization replay");
    for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256);
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "DIAGNOSTIC_FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, replays: report.replays.length, error: report.error, cleanupError: report.cleanupError }));
});
