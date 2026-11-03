"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { InstalledRuntimeSession, sha, pause } = require("./lib/installed-runtime-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const run = "D:/AgentVN/output/installed-runtime-persistence-20261018-01";
const work = "F:/AgentVN-QA-InstalledRuntimePersistence-20261018-01";
const out = process.argv[2]; assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
const renpyOnly = process.argv.includes("--renpy-only"), nvlFollowup = process.argv.includes("--nvl-followup");
const branchMatrix = process.argv.includes("--branch-matrix");
assert(!(renpyOnly && nvlFollowup));
const prep = read(path.join(run, "preparation.json")), fixture = read(path.join(run, "fixtures.json"));
const exportedFile = path.join(run, "export-02/report.json"), exported = read(exportedFile);
assert.equal(exported.status, "PASS"); assert.equal(exported.cartridges.length, 2);
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], matrix: [], screenshots: [], launches: [], pageErrors: [],
  scope: "INSTALLED_NATIVE_LIBRARY_PREFERENCES_AUTOSAVE_NVL_CAPACITY_NOT_STANDALONE_SETUP_ANDROID",
  source: { path: exportedFile, sha256: sha(exportedFile) }, fixture: { path: fixture.input, sha256: sha(fixture.input) },
  controlledBoundary: "Backend project import and public native cartridge library preparation; all settings/progression/save/load/exit use trusted actual UI",
  productChanges: 0, realModelRequests: 0, error: null };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
report.tools = ["scripts/installed-runtime-persistence-playwright.cjs", "scripts/lib/installed-runtime-session.cjs"]
  .map(p => ({ path: path.resolve(p), sha256: sha(p) }));
report.subset = { renpyOnly, nvlFollowup, branchMatrix };
if (renpyOnly || nvlFollowup) {
  const firstFile = path.join(run, "runtime-01/report.json"), first = read(firstFile);
  assert.equal(first.status, "FAILED"); assert.equal(first.source.sha256, report.source.sha256);
  report.continuation = { path: firstFile, sha256: sha(firstFile), originalStatus: "FAILED",
    reason: renpyOnly ? "Continue unexecuted Renpy cases after fixing duplicate-title selection in test helper"
      : "Native restore succeeded; only test the newly created post-load rollback history, not an unserialized old rollback stack" };
}
let s, current;
async function check(name, fn) {
  const row = { name, layout: current, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await fn(row); row.status = "PASS"; }
  catch (e) {
    row.status = "FAILED"; row.error = String(e.stack || e);
    if (s?.page) {
      row.body = (await s.page.locator("body").innerText().catch(() => "")).slice(-6000);
      await s.shot(`failure-${report.checks.length}`).catch(() => {});
    }
  } finally { save(); console.log(`${row.status} ${current} ${name}`); }
  return row.status === "PASS";
}
async function snapshot() {
  await s.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return s.page.locator(".nvl-page").evaluate(e => {
    const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const panel = e.closest(".dialog-box");
    return { page: Number(e.dataset.nvlPageIndex), pageCount: Number(e.dataset.nvlPageCount), total: Number(e.dataset.nvlTotalLines),
      rect: rect(e), panel: rect(panel), viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth - innerWidth,
      scroll: { height: e.scrollHeight, clientHeight: e.clientHeight, width: e.scrollWidth, clientWidth: e.clientWidth },
      lines: Array.from(e.querySelectorAll("[data-nvl-line]")).map(line => {
        const text = line.querySelector(".nvl-page-text"), range = document.createRange(); range.selectNodeContents(text);
        const ranges = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
        return { text: text.textContent, font: parseFloat(getComputedStyle(text).fontSize), rect: rect(line),
          glyphBounds: ranges.length ? { left: Math.min(...ranges.map(r => r.x)), right: Math.max(...ranges.map(r => r.right)),
            top: Math.min(...ranges.map(r => r.y)), bottom: Math.max(...ranges.map(r => r.bottom)) } : null };
      }) };
  });
}
function assertNVL(n, width, height) {
  assert(n.lines.length > 0 && n.lines.length <= n.total);
  assert(n.overflow <= 1); assert(n.panel.x >= -1 && n.panel.y >= -1 && n.panel.right <= width + 1 && n.panel.bottom <= height + 1);
  assert(n.scroll.width <= n.scroll.clientWidth + 1 && n.scroll.height <= n.scroll.clientHeight + 2, "NVL page must fit without scroll clipping");
  for (const l of n.lines) {
    assert(l.font >= 12);
    assert(l.rect.x >= n.panel.x - 1 && l.rect.right <= n.panel.right + 1 && l.rect.y >= n.panel.y - 1 && l.rect.bottom <= n.panel.bottom + 2);
    if (l.glyphBounds) assert(l.glyphBounds.left >= n.panel.x - 1 && l.glyphBounds.right <= n.panel.right + 1
      && l.glyphBounds.top >= n.panel.y - 1 && l.glyphBounds.bottom <= n.panel.bottom + 2, "NVL glyphs must not clip outside panel");
  }
}
async function openSave() {
  if (current === "renpy") await s.page.getByTestId("renpy-quick-save-load").click();
  else {
    await s.page.getByTestId("quick-menu-toggle").click();
    await s.page.getByRole("button", { name: "打开存档读档", exact: true }).click();
  }
  await s.ready("save_load"); await s.page.getByRole("tab", { name: "手动", exact: true }).click();
}
async function saveManual() {
  await openSave();
  const card = s.page.getByTestId("save-slot-manual-1").locator(".save-card-main");
  assert((await card.getAttribute("aria-label")).startsWith("保存到") || (await card.getAttribute("aria-label")).startsWith("覆盖"));
  await card.click(); await s.page.waitForFunction(() => document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
  const native = (await s.saves()).find(x => (!x.save_kind || x.save_kind === "manual") && x.slot === 1); assert(native);
  await s.page.keyboard.press("Escape"); await s.ready("playing"); return native;
}
async function loadManual() {
  await openSave(); await s.page.getByRole("button", { name: "读取", exact: true }).click();
  const card = s.page.getByTestId("save-slot-manual-1").locator(".save-card-main");
  assert.equal(await card.getAttribute("aria-label"), "读取手动存档 1");
  await card.click(); await s.ready("playing"); await s.command("nvl_capacity", 23);
}
function overlaps(a, b) { return Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1; }
async function branchGeometry() {
  const nvl = await snapshot();
  const choices = await s.page.locator(".choice-option").evaluateAll(nodes => nodes.map(e => {
    const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { text: e.textContent, rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom },
      hit: Boolean(hit && e.contains(hit)), disabled: e.disabled };
  }));
  return { nvl, choices };
}
async function autosave() {
  const off = await check("Real settings disable autosave and persist instant-text preference; actual confirmed exit creates no automatic save", async row => {
    row.observed = { initial: await s.prefs(), before: s.files() }; save();
    row.observed.change = await s.setAuto(false, true);
    await s.openSettings(); await s.system();
    assert.equal(await s.page.getByRole("checkbox", { name: "自动存档", exact: true }).isChecked(), false);
    await s.page.getByTestId("open-exit-confirmation").click();
    const dialog = s.page.getByRole("dialog", { name: "退出游戏？", exact: true });
    await dialog.waitFor(); assert((await dialog.innerText()).includes("本次不会新建自动存档"));
    await s.shot("autosave-disabled-exit-warning");
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await s.ready("settings");
    assert.equal(s.child.exitCode, null);
    await s.page.getByTestId("open-exit-confirmation").click(); await s.page.getByTestId("confirm-exit-game").click();
    await s.stop(true);
    const after = s.files(); assert.deepEqual(after, row.observed.before);
    return { ...row.observed, after, nativeExit: true, independentStandaloneExitClaim: false };
  });
  if (!off) throw new Error("Disabled preference baseline/actual restart prerequisite failed");
  await s.start(current);
  const disabled = await check("Actual new native process preserves autosave=false; 15 ordinary checkpoints produce no auto-save", async row => {
    row.observed = { prefs: await s.prefs(), before: s.files(), checkpoints: [] }; save();
    assert.equal(row.observed.prefs.autoSaveEnabled, false); assert.equal(row.observed.prefs.textSpeedCps, 0);
    await s.openSettings(); await s.system();
    assert.equal(await s.page.getByRole("checkbox", { name: "自动存档", exact: true }).isChecked(), false);
    await s.finishSettings(); await s.branch("进入自动存档", "saves");
    for (let i = 0; i <= 14; i++) {
      await s.command("saves", i); row.observed.checkpoints.push({ index: i, autos: (await s.saves()).filter(x => x.save_kind === "auto").length });
      if (i < 14) await s.page.locator(".dialog-box").click();
    }
    assert(row.observed.checkpoints.every(c => c.autos === 0)); assert.deepEqual(s.files(), row.observed.before);
    await s.shot("autosave-disabled-after15"); return { ...row.observed, after: s.files(), allNativeSaveBytesUnchanged: true };
  });
  if (!disabled) throw new Error("Disabled checkpoint baseline failed");
  const enabled = await check("Real settings reenable autosave; new run reaches threshold and writes actual automatic save; exit flushes current checkpoint", async row => {
    // Enter the ordinary scene while still disabled. Otherwise the entry
    // choice legitimately auto-saves and starts the normal30s rate limit.
    await s.newGame(); await s.branch("进入自动存档", "saves");
    row.observed = { change: await s.setAuto(true), prior: await s.saves() }; save();
    for (let i = 0; i <= 14; i++) { await s.command("saves", i); if (i < 14) await s.page.locator(".dialog-box").click(); }
    const deadline = Date.now() + 10000; let autos = [];
    while (Date.now() < deadline) {
      autos = (await s.saves()).filter(x => x.save_kind === "auto");
      if (autos.some(x => x.scene_id === "saves")) break; await pause(100);
    }
    row.observed.thresholdAutos = autos; save();
    assert(autos.some(x => x.scene_id === "saves" && x.command_index >= 9 && x.command_index <= 14));
    await s.openSettings(); await s.system();
    assert(await s.page.getByRole("checkbox", { name: "自动存档", exact: true }).isChecked());
    await s.page.getByTestId("open-exit-confirmation").click();
    await s.page.getByTestId("confirm-exit-game").click(); await s.stop(true);
    row.observed.afterFiles = s.files();
    const snapshots = row.observed.afterFiles.filter(f => /^auto-/.test(f.name)).map(f => read(f.path));
    assert(snapshots.some(a => a.scene_id === "saves" && a.command_index === 14));
    return { ...row.observed, exitSavedCommand: 14, realNativeLibraryClose: true, standaloneSetupACLClaim: false };
  });
  if (!enabled) throw new Error("Enabled automatic save prerequisite failed");
  await s.start(current, false);
  await check("Actual restart retains autosave=true and real title Continue restores exit-saved command14", async () => {
    const prefs = await s.prefs(); assert.equal(prefs.autoSaveEnabled, true);
    await s.page.getByTestId("continue-game").click(); await s.ready("playing"); await s.command("saves", 14);
    const autos = (await s.saves()).filter(x => x.save_kind === "auto"); assert(autos.some(a => a.command_index === 14));
    await s.shot("autosave-enabled-native-restart-continue"); return { prefs, autos, restoredScene: "saves", restoredCommand: 14 };
  });
}
async function nvl() {
  let accumulated = true;
  if (!nvlFollowup) {
  await s.setAuto(false); await s.newGame(); await s.branch("进入NVL容量", "nvl_capacity");
  accumulated = await check("24 real NVL advances turn capacity pages without shrinking prior lines or clipping text", async row => {
    row.observed = { pages: [], seenFonts: {}, mismatches: [], pageFailures: [] }; save();
    for (let i = 0; i < 24; i++) {
      await s.command("nvl_capacity", i);
      const n = await snapshot(); row.observed.pages.push(n); save();
      try {
        assert.equal(n.total, i + 1); assertNVL(n, 1920, 1080);
        assert.equal(n.lines.at(-1).text, fixture.capacity.text[i]);
      } catch (e) { row.observed.pageFailures.push({ index: i, error: String(e.stack || e) }); }
      for (const line of n.lines) {
        if (row.observed.seenFonts[line.text] !== undefined && Math.abs(row.observed.seenFonts[line.text] - line.font) > .1)
          row.observed.mismatches.push({ text: line.text.slice(0, 20), initial: row.observed.seenFonts[line.text], current: line.font });
        else row.observed.seenFonts[line.text] = line.font;
      }
      if (i < 23) await s.page.locator(".dialog-box").click();
    }
    assert.equal(row.observed.mismatches.length, 0, "Accumulated existing NVL rows must not shrink as the page fills");
    assert.equal(row.observed.pageFailures.length, 0, "Each actual NVL page must preserve text and fit bounds");
    assert(row.observed.pages.at(-1).pageCount > 1 && row.observed.pages.at(-1).lines.length < 24, "Capacity must turn pages rather than scroll/shrink indefinitely");
    await s.shot("nvl-full-capacity"); return row.observed;
  });
  } else await loadManual();
  // Continue independent checks only if the scene actually reached full capacity.
  const at = await s.page.getByTestId("game-state-playing").getAttribute("data-current-command-index");
  if (at !== "23") {
    report.nvlFollowing = "BLOCKED_CAPACITY_DID_NOT_REACH_FULL_SCENE"; save(); return;
  }
  await check("NVL native manual save, menu roundtrip, actual Player restart and load restore all24 lines and same visible page", async row => {
    const before = await snapshot(); const stored = await saveManual();
    row.observed = { before, stored }; save(); assert.equal(stored.nvl_page.length, 24);
    assert.deepEqual(stored.nvl_page.map(l => l.text), fixture.capacity.text);
    await s.openSettings(); await s.finishSettings();
    const returned = await snapshot(); assert.deepEqual(returned.lines.map(l => l.text), before.lines.map(l => l.text));
    await s.stop(); await s.start(current); await loadManual(); const loaded = await snapshot();
    row.observed.loaded = loaded; save(); assert.equal(loaded.total, 24);
    assert.equal(loaded.pageCount, before.pageCount); assert.deepEqual(loaded.lines.map(l => l.text), before.lines.map(l => l.text));
    // A load restores the saved page, not the previous process's rollback
    // stack. Create a real new checkpoint first, then roll it back/forward.
    await s.page.locator(".dialog-box").click(); await s.command("nvl_capacity", 24, false);
    await s.page.keyboard.press("PageUp"); await s.command("nvl_capacity", 23);
    await s.page.keyboard.press("PageDown"); await s.command("nvl_capacity", 24, false);
    await s.page.keyboard.press("PageUp"); await s.command("nvl_capacity", 23);
    assert.equal((await snapshot()).total, 24); await s.shot("nvl-restarted-restored");
    return { ...row.observed, accumulatedCasePassed: accumulated, restartIsActualNativeProcess: true };
  });
  if (!nvlFollowup) await check("Full NVL page geometry after responsive remeasure, two layouts times12 actual WebView combinations", async row => {
    row.observed = [];
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const item = { layout: current, width, height, dpr, reduced, status: "RUNNING" }; report.matrix.push(item); save();
      try {
        await s.viewport({ width, height, dpr, reduced }); await s.command("nvl_capacity", 23);
        item.nvl = await snapshot(); assertNVL(item.nvl, width, height); assert.equal(item.nvl.total, 24);
        assert.equal(item.nvl.lines.at(-1).text, fixture.capacity.text[23]);
        await s.shot(`nvl-${width}-${dpr}-${reduced}`); item.status = "PASS";
      } catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); }
      row.observed.push(item); save();
    }
    await s.viewport({ width: 1920, height: 1080, dpr: 1, reduced: false });
    assert(row.observed.every(r => r.status === "PASS")); return { combinations: 12, geometryOnlyNotRepeatedFullBusiness: true };
  });
  await s.page.locator(".dialog-box").click();
  await s.page.getByRole("button", { name: "选择：容量分支1", exact: true }).waitFor();
  await s.page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll(".choice-option"));
    return buttons.length === 3 && buttons.every(b => !b.disabled) && !document.querySelector(".choice-panel.is-entering");
  });
  await check("NVL branches remain inside NVL region, reserve text space, are fully visible and actually hit their own buttons", async row => {
    row.observed = await branchGeometry(); save();
    assert.equal(row.observed.choices.length, 3); const b = row.observed.nvl.panel;
    for (const c of row.observed.choices) {
      assert(c.hit && !c.disabled, "Choice must be actual input target");
      assert(c.rect.x >= b.x - 1 && c.rect.y >= b.y - 1 && c.rect.right <= b.right + 1 && c.rect.bottom <= b.bottom + 1,
        "NVL choices must be laid out within the NVL content region");
      assert(row.observed.nvl.lines.every(l => !overlaps(c.rect, l.rect)), "Choice must not overlap accumulated NVL text");
    }
    await s.shot("nvl-branch-reserved"); return row.observed;
  });
  await check("Real branch choice enters new scene, clears prior NVL page, and history retains each capacity line exactly once", async row => {
    await s.page.getByRole("button", { name: "选择：容量分支1", exact: true }).click();
    await s.command("nvl_after", 0); row.observed = await snapshot(); save();
    assert.equal(row.observed.total, 1); assert(row.observed.lines[0].text.includes("NVL_AFTER："));
    if (current === "renpy") await s.page.getByTestId("renpy-quick-history").click();
    else {
      await s.page.getByTestId("quick-menu-toggle").click();
      await s.page.getByRole("button", { name: "打开历史记录", exact: true }).click();
    }
    await s.ready("history"); const lines = await s.page.locator(".history-list article p").allTextContents();
    for (const text of fixture.capacity.text) assert.equal(lines.filter(t => t === text).length, 1);
    await s.shot("nvl-capacity-history"); return { newScene: row.observed, historyEntries: lines, all24LinesExactlyOnce: true };
  });
  if (branchMatrix) {
    if (await s.screen() === "history") {
      await s.page.getByTestId(current === "renpy" ? "renpy-menu-return" : "back-to-player").click(); await s.ready("playing");
    }
    await check("NVL branch final geometry and real choices across12 WebView combinations preserve text space and clear new scene", async row => {
      row.observed = [];
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const item = { layout: current, width, height, dpr, reduced, status: "RUNNING" }; row.observed.push(item); save();
        try {
          await s.viewport({ width, height, dpr, reduced }); await loadManual();
          await s.page.locator(".dialog-box").click(); await s.command("nvl_capacity", 24, false);
          await s.page.waitForFunction(() => {
            const all = Array.from(document.querySelectorAll(".choice-option")); return all.length === 3 && all.every(b => !b.disabled);
          });
          await s.page.evaluate(async () => {
            await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
          });
          item.geometry = await branchGeometry(); const b = item.geometry.nvl.panel;
          item.outside = item.geometry.choices.filter(c => c.rect.x < b.x - 1 || c.rect.y < b.y - 1 || c.rect.right > b.right + 1 || c.rect.bottom > b.bottom + 1);
          item.overlaps = item.geometry.choices.flatMap(c => item.geometry.nvl.lines.filter(l => overlaps(c.rect, l.rect)).map(l => ({
            choice: c.text, line: l.text.slice(0, 14), choiceRect: c.rect, lineRect: l.rect })));
          item.hit = item.geometry.choices.every(c => c.hit && !c.disabled);
          await s.shot(`nvl-branch-${width}-${dpr}-${reduced}`);
          const choice = 1 + row.observed.length % 3;
          await s.page.getByRole("button", { name: `选择：容量分支${choice}`, exact: true }).click();
          await s.command("nvl_after", 0); item.after = await snapshot();
          assert.equal(item.after.total, 1); item.actualChoiceAndClear = "PASS";
          assert.equal(item.geometry.choices.length, 3); assert(item.hit);
          assert.equal(item.outside.length, 0, "Branches must stay within the NVL content region");
          assert.equal(item.overlaps.length, 0, "Branches must reserve space, not cover NVL text");
          item.status = "PASS";
        } catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); }
        save();
      }
      assert.equal(row.observed.length, 12); assert(row.observed.every(r => r.status === "PASS"));
      return row.observed;
    });
  }
}
(async () => {
  for (const layout of renpyOnly ? ["renpy"] : nvlFollowup ? ["agentvn"] : ["agentvn", "renpy"]) {
    current = layout;
    s = new InstalledRuntimeSession({ prep, fixture, cartridges: exported.cartridges, out, report, save,
      installId: `qa_runtime_persistence_${layout}_20261018` });
    try { await s.start(layout); if (!nvlFollowup) await autosave(); await nvl(); }
    catch (e) {
      report.layoutErrors ??= []; report.layoutErrors.push({ layout, error: String(e.stack || e) }); save();
      if (s.page) await s.shot("layout-failure").catch(() => {});
    } finally {
      const target = path.join(work, `${path.basename(out)}-${layout}-native-saves`);
      if (!fs.existsSync(target)) fs.mkdirSync(target);
      report.retained ??= [];
      for (const f of s.storage ? s.files() : []) {
        const retained = path.join(target, f.name); fs.copyFileSync(f.path, retained, fs.constants.COPYFILE_EXCL);
        assert.equal(sha(retained), f.sha256); report.retained.push({ ...f, retained, layout, data: read(retained) });
      }
      await s.stop(); save();
    }
  }
  const expectedChecks = (renpyOnly ? 9 : nvlFollowup ? 3 : 18) + (branchMatrix ? renpyOnly || nvlFollowup ? 1 : 2 : 0);
  const expectedMatrix = renpyOnly ? 12 : nvlFollowup ? 0 : 24;
  report.status = report.checks.length === expectedChecks && report.checks.every(c => c.status === "PASS")
    && report.matrix.length === expectedMatrix && report.matrix.every(r => r.status === "PASS") && !report.pageErrors.length ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  try { await s?.stop(); } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; }
  report.finishedAt = new Date().toISOString(); save(); if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, checks: report.checks.map(c => ({ layout: c.layout, name: c.name, status: c.status, error: c.error })),
    matrix: report.matrix.length, error: report.error, layoutErrors: report.layoutErrors, cleanupError: report.cleanupError, out }, null, 2));
});
