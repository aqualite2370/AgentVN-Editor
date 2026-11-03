"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { InstalledRuntimeSession, sha, pause } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sessionNumber = process.argv.includes("--session2") ? 2 : 1;
const run = `D:/AgentVN/output/installed-runtime-exit-20261018-0${sessionNumber}`;
const work = `F:/AgentVN-QA-InstalledRuntimeExit-20261018-0${sessionNumber}`;
const previous = "D:/AgentVN/output/installed-runtime-persistence-20261018-01";
const out = process.argv[2]; assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
const prep = read(path.join(run, "preparation.json")), fixture = read(path.join(previous, "fixtures.json"));
const sourceFile = path.join(previous, "export-02/report.json"), exported = read(sourceFile);
assert.equal(prep.status, "PASS"); assert.equal(exported.status, "PASS");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], cases: [], matrix: [], launches: [],
  screenshots: [], pageErrors: [], faultRestoration: [], retained: [], productChanges: 0, realModelRequests: 0,
  scope: "INSTALLED_PLAYER_LIBRARY_REAL_QA_ACL_NOT_STANDALONE_SETUP_ANDROID",
  source: { path: sourceFile, sha256: sha(sourceFile) }, fixture: { path: fixture.input, sha256: sha(fixture.input) },
  controlledBoundaries: ["Public native library preparation; real UI-generated baseline saves",
    "Exact QA save subdirectory Write-deny ACL, not the user profile/install directory",
    "Physical Alt+F4 only from Computer Use with separate receipt; no close IPC mock"], error: null };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
report.tools = ["scripts/installed-runtime-exit-playwright.cjs", "scripts/installed-runtime-exit-acl.ps1",
  "scripts/lib/runtime-qa-acl.ps1",
  "scripts/lib/installed-runtime-session.cjs", "scripts/lib/installed-webview-capture.cjs"]
  .map(p => ({ path: path.resolve(p), sha256: sha(p) }));
let s, current, caseName, pendingACL, watcher, events;
async function check(name, fn) {
  const row = { name, layout: current, case: caseName, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await fn(row); row.status = "PASS"; }
  catch (e) {
    row.status = e.toolBlocked ? "BLOCKED" : "FAILED"; row.error = String(e.stack || e);
    if (s?.page) {
      row.body = (await s.page.locator("body").innerText().catch(() => "")).slice(-5000);
      await s.shot(`${caseName}-failure-${report.checks.length}`).catch(() => {});
    }
  } finally { save(); console.log(`${row.status} ${current}/${caseName} ${name}`); }
  return row.status === "PASS";
}
function receipt() { return path.join(work, `acl-${caseName}-${current}-01.json`); }
function acl(action) {
  if (action === "Block") pendingACL = { case: caseName, layout: current, receipt: receipt() };
  const text = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.resolve("scripts/installed-runtime-exit-acl.ps1"), "-Action", action, "-Case", caseName, "-Layout", current,
    "-SessionNumber", String(sessionNumber)],
  { encoding: "utf8", windowsHide: true, timeout: 20000 });
  const result = read(receipt() + (action === "Block" ? ".block.json" : ".restore.json"));
  assert.equal(result.status, action === "Block" ? "WRITE_DENIED" : "RESTORED");
  assert.equal(result.probe.allowed, action !== "Block");
  if (action === "Block") assert.equal(result.isElevated, false);
  else {
    assert(result.comparison.permissionsMatch && result.comparison.daclBytesMatch
      && result.comparison.ownerGroupMatch && result.comparison.allOtherFlagsMatch);
    report.faultRestoration.push({ ...pendingACL, status: "PASS", restored: receipt() + ".restore.json" });
    pendingACL = null;
  }
  save(); return { ...result, commandOutput: text };
}
async function openSave() {
  if (current === "renpy") await s.page.getByTestId("renpy-quick-save-load").click();
  else {
    await s.page.getByTestId("quick-menu-toggle").click();
    await s.page.getByRole("button", { name: "打开存档读档", exact: true }).click();
  }
  await s.ready("save_load"); await s.page.getByRole("tab", { name: "手动", exact: true }).click();
}
async function baseline() {
  await s.setAuto(false, true); await s.branch("进入自动存档", "saves"); await s.command("saves", 0);
  await openSave();
  await s.page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
  await s.page.waitForFunction(() => document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
  const manual = (await s.saves()).find(v => (!v.save_kind || v.save_kind === "manual") && v.slot === 1);
  assert(manual && manual.scene_id === "saves" && manual.command_index === 0);
  await s.page.keyboard.press("Escape"); await s.ready("playing");
  await s.setAuto(true);
  for (let i = 1; i <= 4; i++) { await s.page.locator(".dialog-box").click(); await s.command("saves", i); }
  const files = s.files(), saves = await s.saves();
  assert(files.some(f => f.name === "slot-01.json"));
  assert(!saves.some(v => v.scene_id === "saves" && v.command_index === 4));
  return { manual, files, saves, expectedLatest: [...saves].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] };
}
function allFiles() {
  return fs.readdirSync(s.storage.targetDirectory).sort().map(name => ({ name, bytes: fs.statSync(path.join(s.storage.targetDirectory, name)).size }));
}
async function geometry() {
  return s.page.evaluate(() => {
    const all = [...document.querySelectorAll("[data-runtime-modal='true']")], panel = all.at(-1);
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right,
      bottom: r.bottom, width: r.width, height: r.height }; };
    return { count: all.length, title: panel.getAttribute("aria-label"), rect: rect(panel),
      scroll: { width: panel.scrollWidth, clientWidth: panel.clientWidth, height: panel.scrollHeight, clientHeight: panel.clientHeight },
      overflow: document.documentElement.scrollWidth - innerWidth, focusInside: panel.contains(document.activeElement),
      lowerInert: all.slice(0, -1).every(n => n.closest("[inert]")),
      controls: [...panel.querySelectorAll("button,input")].map(e => {
        const r = rect(e); return { label: e.getAttribute("data-testid") || e.textContent.trim(), rect: r,
          hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
          disabled: e.disabled, inert: Boolean(e.closest("[inert]")) };
      }) };
  });
}
function assertGeometry(g, v, title, count) {
  assert.equal(g.title, title); assert.equal(g.count, count);
  assert(g.focusInside && g.lowerInert); assert(g.overflow <= 1);
  assert(g.rect.x >= -1 && g.rect.y >= -1 && g.rect.right <= v.width + 1 && g.rect.bottom <= v.height + 1);
  assert(g.scroll.width <= g.scroll.clientWidth + 1 && g.scroll.height <= g.scroll.clientHeight + 1);
  for (const b of g.controls) {
    assert(b.hit && !b.disabled && !b.inert, b.label);
    assert(b.rect.x >= g.rect.x - 1 && b.rect.y >= g.rect.y - 1
      && b.rect.right <= g.rect.right + 1 && b.rect.bottom <= g.rect.bottom + 1);
  }
  for (let a = 0; a < g.controls.length; a++) for (let b = a + 1; b < g.controls.length; b++) {
    const x = g.controls[a].rect, y = g.controls[b].rect;
    assert(!(Math.min(x.right, y.right) - Math.max(x.x, y.x) > 1
      && Math.min(x.bottom, y.bottom) - Math.max(x.y, y.y) > 1), "Modal controls must not overlap");
  }
}
async function failedExit(row, physical = false) {
  row.observed ??= {};
  row.observed.denied = acl("Block");
  if (physical) {
    const request = { requestedAt: new Date().toISOString(), ownerPid: s.child.pid, identity: s.identity,
      method: "Computer Use Alt+F4", receipt: path.join(out, `${current}-native-close-receipt.json`) };
    const file = path.join(out, `${current}-native-close-request.json`);
    fs.writeFileSync(file, JSON.stringify(request, null, 2), { flag: "wx" });
    row.observed.nativeRequest = { path: file, ...request }; save();
    console.log(JSON.stringify({ stage: "COMPUTER_USE_ALT_F4_REQUIRED", ...request, request: file }));
    const deadline = Date.now() + 180000;
    while (!fs.existsSync(request.receipt) && Date.now() < deadline && s.child.exitCode === null) await pause(100);
    if (!fs.existsSync(request.receipt)) {
      const e = new Error("Physical Alt+F4 input receipt missing; no close IPC substitution permitted");
      e.toolBlocked = true; throw e;
    }
    const actual = read(request.receipt);
    assert.equal(actual.ownerPid, request.ownerPid); assert.equal(actual.method, request.method);
    row.observed.nativeReceipt = actual;
    await s.page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
    await s.shot("native-close-confirmation-before-save");
  } else {
    await s.openSettings(); await s.page.getByTestId("open-exit-confirmation").click();
  }
  await s.page.getByTestId("confirm-exit-game").click();
  await s.page.getByTestId("retry-exit-save").waitFor();
  const error = await s.page.locator(".runtime-exit-status").innerText();
  assert(error.includes("保存失败") && error.includes("游戏仍保持打开") && error.includes("不会回退"));
  assert(error.includes(s.storage.targetDirectory.replaceAll("/", "\\")), "Failure must contain actual native save directory");
  assert.equal(s.child.exitCode, null); assert.deepEqual(s.files(), row.observed.before.files);
  assert(!allFiles().some(f => f.name.endsWith(".tmp")));
  const g = await geometry(); assertGeometry(g, s.expected, "退出游戏？", 1);
  row.observed.error = error; row.observed.geometry = g; row.observed.afterFailure = s.files();
  await s.shot(`${caseName}-real-acl-save-failure`);
  return row.observed;
}
async function errorMatrix(before) {
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const r = { layout: current, width, height, dpr, reduced, status: "RUNNING" }; report.matrix.push(r); save();
      try {
        const v = { width, height, dpr, reduced }; await s.viewport(v); await settleRuntime(s.page);
        // Move focus with a real key before recording the modal ownership.
        await s.page.keyboard.press("Tab"); r.failure = await geometry();
        assertGeometry(r.failure, v, "退出游戏？", 1);
        await s.page.getByTestId("discard-exit-save").click(); r.second = await geometry();
        assertGeometry(r.second, v, "确认放弃保存？", 2);
        for (const key of ["Tab", "Shift+Tab", "Tab"]) {
          await s.page.keyboard.press(key);
          assert((await geometry()).focusInside);
        }
        await s.shot(`discard-prompt-${width}-${dpr}-${reduced}`);
        await s.page.keyboard.press("Escape");
        await s.page.getByRole("dialog", { name: "确认放弃保存？", exact: true }).waitFor({ state: "hidden" });
        r.afterEscape = await geometry(); assertGeometry(r.afterEscape, v, "退出游戏？", 1);
        assert.equal(s.child.exitCode, null); assert.deepEqual(s.files(), before.files); r.status = "PASS";
      } catch (e) {
        r.status = "FAILED"; r.error = String(e.stack || e);
        await s.shot(`matrix-failure-${width}-${dpr}-${reduced}`).catch(() => {});
      }
      save();
    }
  const rows = report.matrix.filter(r => r.layout === current);
  assert.equal(rows.length, 12); assert(rows.every(r => r.status === "PASS"));
  return { combinations: rows.length, actualSecondConfirmCancels: rows.filter(r => r.afterEscape).length };
}
async function restartAndVerify(id, expected) {
  await s.start(current, false); await s.page.getByTestId("continue-game").click(); await s.ready("playing");
  await s.command(expected.scene_id, expected.command_index);
  const prefs = await s.prefs(); assert.equal(prefs.autoSaveEnabled, true);
  await s.shot(`${caseName}-restart-continue`);
  return { realNativeRestart: true, scene: expected.scene_id, command: expected.command_index, prefs };
}
async function runCase(layout, name) {
  current = layout; caseName = name;
  const installId = `qa_exit_${name}_${layout}_20261018`;
  const entry = { layout, case: name, installId, status: "RUNNING" }; report.cases.push(entry); save();
  s = new InstalledRuntimeSession({ prep, fixture, cartridges: exported.cartridges, out, report, save, installId });
  try {
    await s.start(layout); entry.before = await baseline(); save();
    events = []; watcher = fs.watch(s.storage.targetDirectory, (event, file) => {
      events.push({ at: new Date().toISOString(), event, file: String(file) });
    });
    const failed = await check("Real QA ACL denies save; exit remains open, reports exact path and preserves all prior native bytes", async row => {
      row.observed = { before: entry.before }; return failedExit(row, name === "native");
    });
    if (!failed) {
      entry.status = report.checks.at(-1).status;
      if (!fs.existsSync(receipt())) report.infrastructureFailure = "ACL tool failed before mutation; stop dependent cases";
      return;
    }
    if (name === "retry") {
      await check("Failure and explicit second-confirmation UI remain usable in12 combinations; Escape closes only top prompt", () => errorMatrix(entry.before));
      const succeeded = await check("Restore exact ACL then double-click retry: one atomic snapshot at current command and actual native exit", async row => {
        row.observed = { restored: acl("Restore") };
        // File watching observes real atomic staging names, not mocked IPC counts.
        events.length = 0;
        const b = await s.page.getByTestId("retry-exit-save").boundingBox(); assert(b);
        await s.page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2, { delay: 0 });
        await s.stop(true); watcher.close(); watcher = null;
        const after = s.files(), changed = after.filter(f => !entry.before.files.some(old => old.name === f.name && old.sha256 === f.sha256));
        const tmp = [...new Set(events.filter(e => /^auto-\d+\.json\.\d+\.\d+\.tmp$/.test(e.file)).map(e => e.file))];
        row.observed.after = after; row.observed.events = events; row.observed.atomicStagingFiles = tmp;
        assert.equal(tmp.length, 1, "Repeated submit must create only one real auto-save atomic transaction");
        assert.equal(changed.length, 1); const written = read(changed[0].path);
        assert.equal(written.scene_id, "saves"); assert.equal(written.command_index, 4); assert.equal(written.save_kind, "auto");
        for (const old of entry.before.files) assert(after.some(f => f.name === old.name && f.sha256 === old.sha256));
        row.observed.written = written; return row.observed;
      });
      if (succeeded) await check("Restart after retry continues from the snapshot actually written before closing", () =>
        restartAndVerify(installId, { scene_id: "saves", command_index: 4 }));
    } else if (name === "discard") {
      await check("First discard action never exits; cancel preserves failed modal, explicit second confirmation exits without a write", async row => {
        await s.page.getByTestId("discard-exit-save").click();
        let g = await geometry(); assertGeometry(g, s.expected, "确认放弃保存？", 2);
        assert.equal(s.child.exitCode, null); assert.deepEqual(s.files(), entry.before.files);
        await s.shot("discard-second-confirm-before-cancel");
        await s.page.getByRole("dialog", { name: "确认放弃保存？", exact: true }).getByRole("button", { name: "继续游戏", exact: true }).click();
        g = await geometry(); assertGeometry(g, s.expected, "退出游戏？", 1);
        await s.page.getByTestId("discard-exit-save").click();
        await s.page.getByTestId("confirm-discard-exit").click(); await s.stop(true);
        watcher.close(); watcher = null;
        const after = s.files(); assert.deepEqual(after, entry.before.files);
        assert(!allFiles().some(f => f.name.endsWith(".tmp")));
        const restored = acl("Restore"); return { after, restored, explicitSecondConfirm: true };
      });
      if (!s.child) await check("Restart after explicit discard resumes only the previous real save, not discarded command4", () =>
        restartAndVerify(installId, entry.before.expectedLatest));
    } else {
      await check("Physical native close uses same failure gate; restoring ACL and retry saves before actual destroy", async row => {
        row.observed = { restored: acl("Restore") };
        await s.page.getByTestId("retry-exit-save").click(); await s.stop(true);
        watcher.close(); watcher = null;
        const after = s.files(), written = after.map(f => read(f.path)).filter(v => v.scene_id === "saves" && v.command_index === 4);
        assert.equal(written.length, 1); row.observed.after = after; row.observed.written = written[0]; return row.observed;
      });
    }
    entry.status = report.checks.filter(c => c.case === name && c.layout === layout).every(c => c.status === "PASS") ? "PASS" : "FAILED";
  } catch (e) {
    entry.status = "FAILED"; entry.error = String(e.stack || e); save();
    if (s.page) await s.shot(`${name}-case-failure`).catch(() => {});
  } finally {
    if (watcher) { watcher.close(); watcher = null; }
    if (pendingACL && fs.existsSync(pendingACL.receipt)) {
      try { acl("Restore"); } catch (e) { report.cleanupError = String(e.stack || e); entry.status = "FAILED"; }
    }
    if (s.storage) {
      const target = path.join(work, `${name}-${layout}-native-saves`); fs.mkdirSync(target);
      for (const f of s.files()) {
        const retained = path.join(target, f.name); fs.copyFileSync(f.path, retained, fs.constants.COPYFILE_EXCL);
        assert.equal(sha(retained), f.sha256);
        report.retained.push({ ...f, retained, layout, case: name, data: read(retained) });
      }
    }
    await s.stop(); save();
  }
}
(async () => {
  for (const l of ["agentvn", "renpy"]) for (const c of ["retry", "discard", "native"]) {
    await runCase(l, c);
    if (report.infrastructureFailure) throw new Error(report.infrastructureFailure);
  }
  assert.equal(report.cases.length, 6);
  report.status = report.cases.every(c => c.status === "PASS") && report.matrix.length === 24 && !report.pageErrors.length
    && !report.cleanupError ? "PASS" : report.cases.some(c => c.status === "FAILED") ? "FAILED" : "BLOCKED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  try {
    if (pendingACL && fs.existsSync(pendingACL.receipt)) acl("Restore");
    await s?.stop();
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => ({ layout: c.layout, case: c.case, status: c.status, error: c.error })),
    checks: report.checks.length, matrix: report.matrix.length, launches: report.launches.length,
    error: report.error, cleanupError: report.cleanupError, out }, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
});
