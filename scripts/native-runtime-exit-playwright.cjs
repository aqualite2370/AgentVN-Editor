"use strict";
// Current native library Player. UI exit is real native destruction, not Alt+F4.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const index = process.argv.indexOf("--current-native-preparation"); assert(index >= 0);
const prepPath = path.resolve(process.argv[index + 1]), prep = read(prepPath), out = prep.sessionRoot;
const smoke = process.argv.includes("--smoke"), fixture = prep.fixture;
assert.equal(prep.status, "PASS"); assert.equal(prep.defaultStorage, "PHYSICAL_DEFAULT_PATH");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(out));
const reportFile = path.join(out, "exit.json"); assert(!fs.existsSync(reportFile));
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "CURRENT_NATIVE_LIBRARY_UI_EXIT_NOT_INSTALL_ALT_F4_ANDROID",
  cases: [], checks: [], matrix: [], launches: [], screenshots: [], pageErrors: [], acls: [], retained: [],
  sources: [prepPath, fixture.input, ...prep.cartridges.map(c => c.path)].map(p => ({ path: p, sha256: sha(p) })),
  productChanges: 0, modelRequests: 0, builds: 0, error: null, cleanupError: null,
  expectedCases: smoke ? 4 : 8, expectedMatrix: smoke ? 2 : 24,
  controlledBoundaries: ["Public native library insertion of historical UI exports, actual subsequent UI input",
    "Non-elevated real ACL write denial on exact fresh QA save leaf only",
    "Menu Exit triggers native window destruction; not physical native close/Alt+F4 or Android back",
    "WebView viewport/DPR emulation, not physical 4K display"],
  notRun: ["Physical Alt+F4/window-close", "Android system back", "Artificially delayed save",
    "Exit while autosave-disabled existing write demonstrably remains in flight", "New installation/export"] };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
let s, entry, pendingACL, watcher, events = [];
async function check(name, fn) {
  const row = { layout: entry.layout, case: entry.kind, name, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; return row.detail; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { save(); console.log(`${row.status} ${row.layout}/${row.case}: ${name}`); }
}
function acl(action) {
  const file = path.join(out, `acl-${entry.installId}.json`);
  if (action === "Block") pendingACL = { installId: entry.installId, receipt: file };
  const result = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.resolve("scripts/native-runtime-exit-acl.ps1"), "-Action", action,
    "-RunDirectory", out, "-InstallId", entry.installId], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  const dataPath = file + (action === "Block" ? ".block.json" : ".restore.json"), data = read(dataPath);
  assert.equal(data.status, action === "Block" ? "WRITE_DENIED" : "RESTORED");
  assert.equal(data.probe.allowed, action !== "Block");
  if (action === "Block") { assert.equal(data.isElevated, false); assert.equal(data.probe.accessDenied, true); }
  else { assert(data.comparison.permissionsMatch); pendingACL = null; }
  report.acls.push({ action, path: dataPath, sha256: sha(dataPath), data, stdout: result }); save();
  return data;
}
async function current() {
  return s.page.getByTestId("game-state-playing").evaluate(e => ({
    scene: e.getAttribute("data-current-scene-id"), command: Number(e.getAttribute("data-current-command-index")),
    text: document.querySelector(".dialog-text")?.textContent,
  }));
}
async function modal() {
  await settleRuntime(s.page);
  return s.page.evaluate(() => {
    const all = [...document.querySelectorAll("[data-runtime-modal='true']")], panel = all.at(-1);
    if (!panel) return null;
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right,
      bottom: r.bottom, width: r.width, height: r.height }; };
    return { count: all.length, title: panel.getAttribute("aria-label"), rect: rect(panel),
      focusInside: panel.contains(document.activeElement),
      lowerInert: all.slice(0, -1).every(e => e.closest("[inert]")),
      overflow: document.documentElement.scrollWidth - innerWidth,
      clipped: panel.scrollWidth > panel.clientWidth + 1 || panel.scrollHeight > panel.clientHeight + 1,
      controls: [...panel.querySelectorAll("button,input")].map(e => {
        const r = rect(e); return { label: e.getAttribute("data-testid") || e.textContent.trim(), rect: r,
          disabled: e.disabled, inert: Boolean(e.closest("[inert]")),
          hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      }) };
  });
}
function assertModal(g, viewport, title, count) {
  assert(g); assert.equal(g.title, title); assert.equal(g.count, count);
  assert(g.focusInside && g.lowerInert && !g.clipped && g.overflow <= 1);
  assert(g.rect.x >= -1 && g.rect.y >= -1 && g.rect.right <= viewport.width + 1 && g.rect.bottom <= viewport.height + 1);
  assert(g.controls.length >= 2);
  for (const b of g.controls) {
    assert(b.hit && !b.disabled && !b.inert, b.label);
    assert(b.rect.x >= g.rect.x - 1 && b.rect.y >= g.rect.y - 1
      && b.rect.right <= g.rect.right + 1 && b.rect.bottom <= g.rect.bottom + 1);
  }
  for (let a = 0; a < g.controls.length; a++) for (let b = a + 1; b < g.controls.length; b++) {
    const x = g.controls[a].rect, y = g.controls[b].rect;
    assert(!(Math.min(x.right, y.right) - Math.max(x.x, y.x) > 1
      && Math.min(x.bottom, y.bottom) - Math.max(x.y, y.y) > 1), "Overlapping modal controls");
  }
}
async function openExit() {
  await s.openSettings(); await s.page.getByTestId("open-exit-confirmation").click();
  const g = await modal(); assertModal(g, s.expected, "退出游戏？", 1); return g;
}
async function baseline() {
  await s.start(entry.layout, false);
  if (entry.layout === "agentvn") assert.equal(await s.page.getByTestId("open-exit-confirmation").count(), 0);
  else assert.equal(await s.page.getByTestId("open-exit-confirmation").count(), 1);
  await s.page.getByTestId("start-new-game").click(); await s.ready("playing");
  await s.setAuto(false, true); await s.command("ordinary_nvl", 0);
  if (entry.layout === "renpy") await s.page.getByTestId("renpy-quick-save-load").click();
  else {
    await s.page.getByTestId("quick-menu-toggle").click();
    await s.page.getByRole("button", { name: "打开存档读档", exact: true }).click();
  }
  await s.ready("save_load"); await s.page.getByRole("tab", { name: "手动", exact: true }).click();
  await s.page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
  await s.page.waitForFunction(() => document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
  const manual = (await s.saves()).find(v => v.save_kind === "manual" && v.slot === 1); assert(manual);
  await s.page.keyboard.press("Escape"); await s.ready("playing");
  const before = await current();
  await s.page.keyboard.press("Escape"); await s.ready("main_menu");
  await s.page.keyboard.press("Escape"); await s.ready("playing"); assert.deepEqual(await current(), before);
  await s.openSettings(); await s.page.keyboard.press("Escape");
  const settingsEscapePath = entry.layout === "agentvn" ? ["main_menu", "playing"] : ["playing"];
  for (let i = 0; i < settingsEscapePath.length; i++) {
    if (i > 0) await s.page.keyboard.press("Escape");
    await s.ready(settingsEscapePath[i]); assert.equal(await s.screen(), settingsEscapePath[i]);
  }
  assert.deepEqual(await current(), before);
  if (entry.kind !== "auto_off") await s.setAuto(true);
  await s.page.locator(".dialog-box").click(); await s.command("ordinary_nvl", 1);
  const story = await current(), files = s.files(), saves = await s.saves();
  assert(!saves.some(v => v.command_index === 1));
  return { manual, files, saves, story, autoSaveEnabled: (await s.prefs()).autoSaveEnabled,
    titleExitContract: true, escapeMenuAndSettingsRestore: true, settingsEscapePath };
}
async function failedExit() {
  const denied = acl("Block"); await openExit(); await s.page.getByTestId("confirm-exit-game").click();
  await s.page.getByTestId("retry-exit-save").waitFor();
  const message = await s.page.locator(".runtime-exit-status").innerText();
  assert(message.includes("保存失败") && message.includes("游戏仍保持打开") && message.includes("不会回退"));
  assert(message.includes(s.storage.targetDirectory));
  assert.equal(s.child.exitCode, null); assert.deepEqual(s.files(), entry.before.files);
  assert(!fs.readdirSync(s.storage.targetDirectory).some(n => n.endsWith(".tmp")));
  const geometry = await modal(); assertModal(geometry, s.expected, "退出游戏？", 1);
  await s.shot(`${entry.kind}-acl-denied`);
  return { denied, message, geometry, after: s.files() };
}
async function errorMatrix() {
  for (const [width, height] of (smoke ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]]))
    for (const dpr of (smoke ? [1] : [1, 2])) for (const reduced of (smoke ? [false] : [false, true])) {
      const v = { width, height, dpr, reduced }, row = { layout: entry.layout, ...v, status: "RUNNING" };
      report.matrix.push(row); save();
      try {
        await s.viewport(v); await s.page.keyboard.press("Tab"); row.failure = await modal();
        assertModal(row.failure, v, "退出游戏？", 1);
        await s.page.getByTestId("discard-exit-save").click(); row.second = await modal();
        assertModal(row.second, v, "确认放弃保存？", 2);
        for (const key of ["Tab", "Tab", "Shift+Tab"]) {
          await s.page.keyboard.press(key); assert((await modal()).focusInside);
        }
        await s.shot(`${entry.kind}-discard-${width}-${dpr}-${reduced}`);
        await s.page.keyboard.press("Escape");
        row.afterEscape = await modal(); assertModal(row.afterEscape, v, "退出游戏？", 1);
        assert.equal(s.child.exitCode, null); assert.deepEqual(s.files(), entry.before.files);
        row.status = "PASS";
      } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
      finally { save(); }
    }
  return { combinations: report.matrix.filter(m => m.layout === entry.layout).length };
}
async function actualExit(button, double = false) {
  const child = s.child; events.length = 0;
  if (double) {
    const b = await s.page.getByTestId(button).boundingBox(); assert(b);
    await s.page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2, { delay: 0 });
  } else await s.page.getByTestId(button).click();
  await s.stop(true); watcher.close(); watcher = null;
  assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null);
  const after = s.files(), changed = after.filter(f => !entry.before.files.some(a => a.name === f.name && a.sha256 === f.sha256));
  const temporary = [...new Set(events.filter(e => /^auto-\d+\.json\.\d+\.\d+\.tmp$/.test(e.file)).map(e => e.file))];
  const shouldSave = ["retry", "auto_on"].includes(entry.kind);
  if (shouldSave) {
    assert.equal(changed.length, 1); assert.equal(temporary.length, 1);
    const written = read(changed[0].path);
    assert.equal(written.scene_id, "ordinary_nvl"); assert.equal(written.command_index, 1);
    assert.equal(written.save_kind, "auto");
    for (const f of entry.before.files) assert(after.some(a => a.name === f.name && a.sha256 === f.sha256));
  } else {
    assert.deepEqual(after, entry.before.files); assert.equal(temporary.length, 0);
  }
  return { exitCode: child.exitCode, signalCode: child.signalCode, after, changed, temporary,
    events: events.map(event => ({ ...event })), shouldSave };
}
async function restart() {
  await s.start(entry.layout, false);
  const all = await s.saves(); assert(all.some(v => v.save_id === entry.before.manual.save_id));
  await s.page.getByTestId("continue-game").click(); await s.ready("playing");
  const expectedCommand = ["retry", "auto_on"].includes(entry.kind) ? 1 : 0;
  await s.command("ordinary_nvl", expectedCommand);
  const restored = await current(); assert.equal(restored.command, expectedCommand);
  const prefs = await s.prefs(); assert.equal(prefs.autoSaveEnabled, entry.kind !== "auto_off");
  await s.shot(`${entry.kind}-restart`);
  return { restored, prefs, expectedCommand, actualNewProcess: true, publicLibraryReseed: true };
}
async function runCase(layout, kind) {
  entry = { layout, kind, installId: `${prep.installId}_${kind}_${layout}`, status: "RUNNING" };
  report.cases.push(entry); save();
  s = new InstalledRuntimeSession({ prep, fixture, cartridges: prep.cartridges, out, report, save,
    installId: entry.installId, currentNative: true });
  try {
    entry.before = await check("Real UI baseline, title exit visibility and menu/settings Escape restore story", baseline);
    watcher = fs.watch(s.storage.targetDirectory, (event, file) => events.push({ at: new Date().toISOString(), event, file: String(file) }));
    if (["retry", "discard"].includes(kind)) {
      await check("Non-admin real ACL failure blocks exit without changing old native save bytes", failedExit);
      if (kind === "retry") {
        await check("Error and nested discard confirmation preserve geometry, focus and topmost Escape in display matrix", errorMatrix);
        await check("Restore exact ACL then double-click retry writes one snapshot before actual native exit", async () => {
          const restored = acl("Restore"); return { restored, ...await actualExit("retry-exit-save", true) };
        });
      } else await check("Discard first requires a second confirmation; cancel stays and explicit second action exits without save", async () => {
        await s.page.getByTestId("discard-exit-save").click();
        assertModal(await modal(), s.expected, "确认放弃保存？", 2);
        assert.equal(s.child.exitCode, null); assert.deepEqual(s.files(), entry.before.files);
        await s.page.getByRole("dialog", { name: "确认放弃保存？", exact: true })
          .getByRole("button", { name: "继续游戏", exact: true }).click();
        assertModal(await modal(), s.expected, "退出游戏？", 1);
        await s.page.getByTestId("discard-exit-save").click();
        const closed = await actualExit("confirm-discard-exit"); return { ...closed, restored: acl("Restore") };
      });
    } else await check("Explicit normal UI exit respects auto-save setting and actual disk snapshot", async () => {
      const geometry = await openExit(), text = await s.page.getByRole("dialog", { name: "退出游戏？", exact: true }).innerText();
      assert(text.includes(kind === "auto_off" ? "自动保存已关闭" : "退出前会等待自动保存完成"));
      if (kind === "auto_off") assert(text.includes("未保存的进度可能丢失"));
      return { geometry, text, ...await actualExit("confirm-exit-game", true) };
    });
    await check("Actual new Player process continues from durable snapshot, preserving preference and manual save", restart);
    entry.status = "PASS";
  } catch (e) {
    entry.status = "FAILED"; entry.error = String(e.stack || e);
    if (s.page) {
      entry.failureText = (await s.page.locator("body").innerText().catch(() => "")).slice(-5000);
      await s.shot(`${kind}-failure`).catch(() => {});
    }
  } finally {
    if (watcher) { watcher.close(); watcher = null; }
    try {
      if (pendingACL && fs.existsSync(pendingACL.receipt)) acl("Restore");
      if (s.storage) {
        const dir = path.join(out, `${kind}-${layout}-native-saves`); fs.mkdirSync(dir);
        for (const f of s.files()) {
          const retained = path.join(dir, f.name); fs.copyFileSync(f.path, retained, fs.constants.COPYFILE_EXCL);
          assert.equal(sha(retained), f.sha256);
          report.retained.push({ ...f, retained, layout, kind, installId: entry.installId });
        }
      }
      await s.stop();
    } catch (e) { report.cleanupError = String(e.stack || e); entry.status = "FAILED"; }
    entry.finishedAt = new Date().toISOString(); save();
  }
}
(async () => {
  save();
  for (const layout of ["agentvn", "renpy"])
    for (const kind of (smoke ? ["retry", "auto_off"] : ["retry", "discard", "auto_on", "auto_off"]))
      await runCase(layout, kind);
  assert.equal(report.cases.length, report.expectedCases);
  report.status = report.cases.every(c => c.status === "PASS") && report.matrix.length === report.expectedMatrix
    && report.matrix.every(m => m.status === "PASS") && !report.pageErrors.length && !report.cleanupError ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  try { if (pendingACL && fs.existsSync(pendingACL.receipt)) acl("Restore"); await s?.stop(); }
  catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => ({ layout: c.layout,
    kind: c.kind, status: c.status, error: c.error })), checks: report.checks.length, matrix: report.matrix.length,
    error: report.error, cleanupError: report.cleanupError, out }, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
});
