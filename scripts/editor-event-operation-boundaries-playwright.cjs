"use strict";
// Full editor and real isolated backend. Timer delivery and competing store edits
// are controlled explicitly; this is not installed/default-profile acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && out.toLowerCase().startsWith("f:\\testavn\\") && !fs.existsSync(out),
  "Use a new evidence directory below F:\\testavn");
fs.mkdirSync(out, { recursive: true });
const project = fixture(`qa_event_boundary_${Date.now()}`);
project.nodes[1].data.scene.commands = [100, 200, 300].map(duration_ms => ({ type: "wait", duration_ms }));
const otherNode = structuredClone(project.nodes[1]);
otherNode.id = "other"; otherNode.position.x += 400;
otherNode.data.scene.scene_id = "other_scene";
otherNode.data.scene.commands = [1100, 1200].map(duration_ms => ({ type: "wait", duration_ms }));
project.nodes.push(otherNode);
const secondProject = structuredClone(project); secondProject.project_id += "_b"; secondProject.title = "任务隔离 B";
const input = path.join(out, "fixture.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const report = { status: "RUNNING", scope: "SOURCE_FULL_APP_REAL_BACKEND_CONTROLLED_TIMERS_COMPETING_EDITS_AND_TIMELINE_IPC",
  models: 0, computerUse: false, cases: [], errors: [], sources: [] };
for (const relative of ["editor/src/components/command-editors/CommandListEditor.tsx",
  "editor/src/components/editor/InspectorPanel.tsx", "editor/src/components/timeline/ProjectTimelinePanel.tsx",
  "editor/src/components/editor/EditorToolbar.tsx", "editor/src/utils/editorProjectPersistence.ts"]) {
  const source = path.resolve(__dirname, "..", relative), retained = path.join(out, "sources", relative);
  fs.mkdirSync(path.dirname(retained), { recursive: true });
  fs.copyFileSync(source, retained, fs.constants.COPYFILE_EXCL);
  report.sources.push({ source, retained, sha256: sha(source) });
}
let service, browser, page;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function state() {
  return page.evaluate(async () => {
    const s = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    const p = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
    return JSON.parse(JSON.stringify({ projectId: p.projectId, generation: s.projectLoadGeneration,
      commands: Object.fromEntries(s.nodes.filter(n => n.data.scene).map(n => [n.id, n.data.scene.commands])),
      past: s.graphHistory.past.length, future: s.graphHistory.future.length, notice: s.lastError }));
  });
}
const durations = s => s.commands.scene.map(c => c.duration_ms);
async function select(id) {
  await page.evaluate(async id => (await import("/src/store/editorStore.ts")).useEditorStore.getState().selectNode(id), id);
  await page.locator(".inspector-panel input[data-help-key='field.scene_id']").waitFor();
}
async function replaceCommands(nodeId, values) {
  await page.evaluate(async ({ nodeId, values }) =>
    (await import("/src/store/editorStore.ts")).useEditorStore.getState().updateSceneCommands(nodeId,
      values.map(duration_ms => ({ type: "wait", duration_ms }))), { nodeId, values });
}
async function flushDrops() {
  await page.evaluate(() => {
    for (const task of window.__qaDrops.splice(0)) if (!task.cancelled) task.callback();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
}
async function reset(reduced = false) {
  await page.mouse.up();
  await flushDrops();
  if (await page.locator("[data-workspace-surface='options'][aria-current='page']").count()) {
    await page.locator("[data-workspace-surface='edit']").click();
  }
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.evaluate(async value => {
    const s = (await import("/src/store/editorStore.ts")).useEditorStore;
    const p = (await import("/src/store/projectStore.ts")).useProjectStore;
    s.getState().importProject(value); p.getState().loadProjectMetadata(value);
    s.getState().selectNode("scene");
  }, project);
  await page.locator(".inspector-panel .command-card").first().waitFor();
  assert.deepEqual(durations(await state()), [100, 200, 300]);
}
async function drag(from = 0, to = 2, release = true) {
  const handle = page.locator(".inspector-panel .command-drag-handle").nth(from);
  await handle.scrollIntoViewIfNeeded();
  const target = page.locator(".inspector-panel .command-card-header").nth(to);
  await target.scrollIntoViewIfNeeded();
  // Scrolling the target also moves the source. Read both coordinates only
  // after that scroll and prove that the source is the actual hit owner.
  const a = await handle.boundingBox();
  const b = await target.boundingBox();
  assert(a && b);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)
    ?.closest(".command-card")?.getAttribute("data-command-index"),
  { x: a.x + a.width / 2, y: a.y + a.height / 2 }), String(from));
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + b.height - 2, { steps: 4 });
  if (release) await page.mouse.up();
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { await reset(name.startsWith("Reduced:")); await fn(row); row.status = "PASS"; }
  catch (error) {
    row.status = "FAILED"; row.error = error.stack;
    await page.screenshot({ path: path.join(out, `failure-${report.cases.length}.png`) }).catch(() => {});
  }
  save(); console.log(JSON.stringify(row));
}
(async () => {
  save();
  service = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.service = { url: service.url, backendUrl: service.backendUrl, backendPid: service.backendPid,
    vitePid: service.server.pid, runId: service.server.runId };
  const temporary = path.join(out, "temp"); fs.mkdirSync(temporary);
  browser = await chromium.launch({ headless: true, env: { ...process.env, TEMP: temporary, TMP: temporary } });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => report.errors.push(String(error)));
  await service.open(page);
  await page.evaluate(() => {
    window.__qaDrops = [];
    window.addEventListener("pointerdown", event => { window.__qaDragPointer = event.pointerId; });
    const timer = window.setTimeout.bind(window), cancel = window.clearTimeout.bind(window);
    window.setTimeout = (callback, ms, ...args) => {
      if (ms === 220 && new Error().stack.includes("finishDrag")) {
        const task = { id: -1000 - window.__qaDrops.length, callback: () => callback(...args), cancelled: false };
        window.__qaDrops.push(task); return task.id;
      }
      return timer(callback, ms, ...args);
    };
    window.clearTimeout = id => {
      const task = window.__qaDrops.find(t => t.id === id);
      if (task) task.cancelled = true; else cancel(id);
    };
  });
  await check("Drop commits the entire event order before decorative animation finishes", async row => {
    await drag();
    row.beforeAnimationCompletion = await state();
    assert.deepEqual(durations(row.beforeAnimationCompletion), [200, 300, 100]);
    assert.equal(row.beforeAnimationCompletion.past, 1);
    await page.evaluate(async () => (await import("/src/utils/editorProjectPersistence.ts")).persistEditorProject());
    const response = await fetch(`${service.backendUrl}/api/project/projects/${project.project_id}`);
    const stored = await response.json();
    assert.deepEqual(stored.data.nodes.find(n => n.id === "scene").data.scene.commands.map(c => c.duration_ms), [200, 300, 100]);
    await flushDrops();
  });
  await check("An event appended during drop animation survives animation completion", async () => {
    await drag();
    const before = durations(await state());
    await replaceCommands("scene", [...before, 400]);
    await flushDrops();
    assert.deepEqual(durations(await state()), [200, 300, 100, 400]);
  });
  await check("Actual field edit during drop animation is never replaced by an old list", async () => {
    await drag();
    await page.locator(".inspector-panel .command-card-summary").first().click();
    await page.locator(".inspector-panel [data-help-key='command.wait.durationMs']").first().fill("250");
    await page.locator(".inspector-panel [data-help-key='command.wait.durationMs']").first().press("Tab");
    await flushDrops();
    assert.deepEqual(durations(await state()), [250, 300, 100]);
  });
  await check("Confirmed Ctrl+Z during drop animation stays undone, Ctrl+Y restores one operation", async () => {
    await drag();
    await page.locator(".flow-surface").click({ position: { x: 15, y: 15 } });
    await page.keyboard.press("Control+z");
    const dialog = page.getByTestId("editor-undo-confirmation");
    await dialog.waitFor({ timeout: 4000 });
    await dialog.getByRole("button", { name: "确认撤销", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await flushDrops();
    assert.deepEqual(durations(await state()), [100, 200, 300]);
    await page.keyboard.press("Control+y");
    await until(async () => durations(await state())[0] === 200, "whole event reorder redone", 6000);
    assert.deepEqual(durations(await state()), [200, 300, 100]);
  });
  await check("Switching nodes after drop cannot replace a later edit in the original node", async () => {
    await drag(); await select("other");
    await replaceCommands("scene", [200, 300, 100, 400]);
    await flushDrops();
    const result = await state();
    assert.deepEqual(durations(result), [200, 300, 100, 400]);
    assert.deepEqual(result.commands.other.map(c => c.duration_ms), [1100, 1200]);
  });
  await check("Switching nodes while holding a drag cancels the old uncommitted operation", async () => {
    await drag(0, 2, false); await select("other"); await page.mouse.up(); await flushDrops();
    assert.deepEqual(durations(await state()), [100, 200, 300]);
    assert.deepEqual((await state()).commands.other.map(c => c.duration_ms), [1100, 1200]);
  });
  await check("Pointer cancellation does not submit a reorder or history step", async () => {
    await drag(0, 2, false);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: window.__qaDragPointer })));
    await page.mouse.up(); await flushDrops();
    assert.deepEqual(durations(await state()), [100, 200, 300]); assert.equal((await state()).past, 0);
  });
  await check("No-op drag creates no history and cannot overwrite a subsequent edit", async () => {
    await drag(0, 0); assert.equal((await state()).past, 0);
    await replaceCommands("scene", [101, 200, 300]); await flushDrops();
    assert.deepEqual(durations(await state()), [101, 200, 300]);
  });
  await check("A command-list update during a held drag cancels stale reorder input", async () => {
    await drag(0, 2, false); await replaceCommands("scene", [101, 200, 300, 400]);
    await page.mouse.up(); await flushDrops();
    assert.deepEqual(durations(await state()), [101, 200, 300, 400]);
  });
  await check("Deleting an event during drop animation cannot resurrect it", async () => {
    await drag();
    await page.locator(".inspector-panel [aria-label='事件操作']").first().click();
    await page.locator(".inspector-panel .command-card-menu-popover").getByRole("button", { name: "删除事件" }).click();
    await flushDrops();
    assert.deepEqual(durations(await state()), [300, 100]);
  });
  await check("A→B→A with identical scene IDs invalidates the original held drag", async () => {
    await drag(0, 2, false);
    const reloaded = structuredClone(project);
    reloaded.nodes[1].data.scene.commands[0].duration_ms = 777;
    await page.evaluate(async ({ b, a }) => {
      const s = (await import("/src/store/editorStore.ts")).useEditorStore;
      const p = (await import("/src/store/projectStore.ts")).useProjectStore;
      s.getState().importProject(b); p.getState().loadProjectMetadata(b);
      s.getState().importProject(a); p.getState().loadProjectMetadata(a); s.getState().selectNode("scene");
    }, { b: secondProject, a: reloaded });
    await page.mouse.up(); await flushDrops();
    assert.deepEqual(durations(await state()), [777, 200, 300]);
    assert.equal((await state()).past, 0);
  });
  await check("Reduced: drop commits immediately and retains one-step undo history", async () => {
    await drag(); assert.deepEqual(durations(await state()), [200, 300, 100]); assert.equal((await state()).past, 1);
    await flushDrops(); assert.deepEqual(durations(await state()), [200, 300, 100]);
  });
  // Recovery-file transport is controlled, but the real timeline UI, validator,
  // project store and backend write queue remain in use.
  await reset();
  const entries = new Map();
  for (const value of [project, secondProject]) {
    const snapshot = structuredClone(value); snapshot.nodes[1].data.scene.commands[0].duration_ms = 900;
    entries.set(value.project_id, { snapshot, entry: { file_name: `${value.project_id}.vnproj`, project_id: value.project_id,
      title: value.title, created_at: value.created_at, updated_at: value.updated_at,
      timestamp_ms: Date.now(), node_count: value.nodes.length, edge_count: value.edges.length, trigger: "auto_save" } });
  }
  const readGates = new Map(), reads = [], readReturns = [], backupWrites = [];
  for (const item of entries.values()) {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    readGates.set(item.entry.file_name, { promise, release });
  }
  await page.exposeFunction("qaEventTimelineInvoke", async (command, args) => {
    if (command === "list_project_backups") return entries.has(args.projectId) ? [entries.get(args.projectId).entry] : [];
    if (command === "read_project_backup") {
      reads.push(args.fileName);
      await readGates.get(args.fileName)?.promise;
      readReturns.push(args.fileName);
      return JSON.stringify([...entries.values()].find(e => e.entry.file_name === args.fileName).snapshot);
    }
    if (command === "write_project_backup") {
      const value = JSON.parse(args.projectJson); backupWrites.push({ projectId: value.project_id, trigger: args.trigger });
      return { ...entries.get(value.project_id).entry, file_name: `before-${Date.now()}.vnproj` };
    }
    if (command === "append_frontend_error") return "";
    throw Error(`Unexpected controlled IPC: ${command}`);
  });
  await page.evaluate(() => { window.__TAURI_INTERNALS__ = { invoke: (command, args) => window.qaEventTimelineInvoke(command, args) }; });
  const timelineRow = { name: "A delayed timeline read cannot lock B restoration or later clear B's in-flight guard", status: "RUNNING" };
  report.cases.push(timelineRow); save();
  try {
    await page.locator("[data-workspace-surface='options']").click();
    await page.locator("nav [data-help-key='advanced.tab.history']").click();
    const panel = page.locator(".advanced-tab-content:not([inert]) .project-timeline-panel");
    await panel.locator(".timeline-entry button").waitFor();
    await panel.locator(".timeline-entry button").click();
    await page.getByTestId("timeline-restore-confirmation").getByRole("button", { name: "恢复备份", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid='timeline-restore-confirmation'] [aria-busy='true']") ||
      document.querySelector("[data-testid='timeline-restore-confirmation'] button:disabled"));
    const deadline = Date.now() + 5000;
    while (reads.length !== 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reads.length, 1, "The controlled original-project read must actually be in flight");
    await page.evaluate(async value => {
      (await import("/src/store/editorStore.ts")).useEditorStore.getState().importProject(value);
      (await import("/src/store/projectStore.ts")).useProjectStore.getState().loadProjectMetadata(value);
    }, secondProject);
    timelineRow.afterSwitch = await state();
    await page.getByTestId("timeline-restore-confirmation").waitFor({ state: "hidden" });
    await panel.locator(".timeline-entry button").waitFor();
    await until(async () => (await panel.locator(".timeline-entry-main strong").textContent()) === secondProject.title,
      "B's own timeline entries presented", 6000);
    await panel.locator(".timeline-entry button").click();
    // Synchronous duplicate activation before React paints "busy" must still
    // enter exactly one read for the new owner.
    await page.getByTestId("timeline-restore-confirmation").getByRole("button", { name: "恢复备份", exact: true })
      .evaluate(button => { button.click(); button.click(); });
    await until(() => reads.includes(`${secondProject.project_id}.vnproj`), "B starts its own read while A remains pending", 6000);
    assert.equal(reads.length, 2);
    readGates.get(`${project.project_id}.vnproj`).release();
    await until(() => readReturns.includes(`${project.project_id}.vnproj`), "A read returned", 6000);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.getByTestId("timeline-restore-confirmation").getByRole("dialog").getAttribute("aria-busy"), "true");
    assert(await panel.getByRole("button", { name: "刷新", exact: true }).isDisabled());
    assert.equal(reads.length, 2);
    assert.equal((await state()).projectId, secondProject.project_id);
    assert.deepEqual(durations(await state()), [100, 200, 300]);
    readGates.get(`${secondProject.project_id}.vnproj`).release();
    await until(async () => durations(await state())[0] === 900 && (await state()).generation > timelineRow.afterSwitch.generation,
      "B restore actually committed and advanced generation", 6000);
    timelineRow.afterRestore = await state();
    assert.equal((await state()).projectId, secondProject.project_id);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal((await state()).projectId, secondProject.project_id);
    assert.deepEqual(durations(await state()), [900, 200, 300]);
    assert(backupWrites.some(v => v.projectId === secondProject.project_id && v.trigger === "before_restore"));
    timelineRow.status = "PASS"; timelineRow.reads = reads;
  } catch (error) {
    timelineRow.status = "FAILED"; timelineRow.error = error.stack;
    await page.screenshot({ path: path.join(out, "timeline-failure.png") }).catch(() => {});
  } finally {
    timelineRow.reads = reads; timelineRow.readReturns = readReturns; timelineRow.backupWrites = backupWrites;
    timelineRow.final = await state();
    for (const gate of readGates.values()) gate.release();
    await page.evaluate(() => { delete window.__TAURI_INTERNALS__; }).catch(() => {});
    save();
  }
  await check("Reordered and edited events survive normal home navigation and browser restart", async row => {
    await drag();
    await page.locator(".inspector-panel .command-card-summary").first().click();
    const input = page.locator(".inspector-panel input[data-help-key='command.wait.durationMs']").first();
    await input.fill("250"); await input.press("Tab");
    await flushDrops();
    const expected = (await state()).commands;
    assert.deepEqual(durations(await state()), [250, 300, 100]);
    await until(() => page.evaluate(async () => !(await import("/src/store/editorStore.ts")).useEditorStore.getState().dirty),
      "real autosave acknowledged", 30000);
    await page.locator("[data-help-key='toolbar.home']").click();
    await page.locator(".editor-toolbar").waitFor({ state: "detached" });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor();
    await until(async () => (await state()).projectId === project.project_id, "original project actually reopened", 15000);
    assert.deepEqual((await state()).commands, expected);
    const response = await fetch(`${service.backendUrl}/api/project/projects/${project.project_id}`);
    const stored = (await response.json()).data;
    assert.deepEqual(Object.fromEntries(stored.nodes.filter(n => n.data.scene).map(n => [n.id, n.data.scene.commands])), expected);
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    const capture = path.join(out, "event-order-reopened.png");
    await page.screenshot({ path: capture });
    const png = fs.readFileSync(capture);
    assert.equal(png.readUInt32BE(16), viewport.width * viewport.dpr);
    assert.equal(png.readUInt32BE(20), viewport.height * viewport.dpr);
    assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })), viewport);
    row.capture = { path: capture, sha256: sha(capture), viewport };
    row.boundary = "BROWSER_DOCUMENT_RESTART_WITH_SAME_REAL_BACKEND_NOT_NATIVE_PROCESS_RESTART";
  });
  assert.equal(report.cases.length, 14);
  assert.equal(report.errors.length, 0);
  for (const source of report.sources) assert.equal(sha(source.source), source.sha256, "Sources changed during a run");
  report.status = report.cases.every(row => row.status === "PASS") ? "PASS" : "FAILED";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; }).finally(async () => {
  try {
    await browser?.close(); await service?.stop(); report.cleanup = "OWNED_BROWSER_AND_SERVICES_STOPPED";
  } catch (error) { report.cleanup = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, errors: report.errors }));
  if (report.status !== "PASS") process.exitCode = 1;
});
