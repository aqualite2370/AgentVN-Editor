"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { NarrativePlayer } = require("./lib/installed-narrative-player.cjs");
const { validateNarrativePreparation } = require("./lib/installed-narrative-1922-policy.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const prep = read(process.argv[2]); validateNarrativePreparation(prep);
const smoke = process.argv.includes("--smoke"), out = prep.sessionRoot, fixture = prep.fixture;
assert.equal(fixture.capacityVariant, "mixed-history-v2", "New run requires non-vacuous history density");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(out));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out, smoke, cells: [],
  launches: [], screenshots: [], nativeSaves: [], negativeWindows: [], knownProcesses: [], pageErrors: [],
  scope: "ACTUAL_1922_INSTALLED_LIBRARY_NVL_CAPACITY_AND_VOICE_RESTORATION",
  productChanges: 0, modelRequests: 0, newBuilds: 0, normalCloseClaimed: false };
const save = () => fs.writeFileSync(path.join(out, "player.json"), JSON.stringify(report, null, 2));
const player = new NarrativePlayer(prep, report, save);
let cell;
const page = () => player.page;
async function snapshot() {
  return page().locator(".dialog-box").evaluate(el => {
    const text = el.querySelector('[data-nvl-current="true"] .nvl-page-text') || el.querySelector(".dialog-text");
    const region = el.querySelector(".nvl-page") || text;
    const rect = node => { if (!node) return null; const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const range = document.createRange(); if (text) range.selectNodeContents(text);
    const state = document.querySelector('[data-testid="game-state-playing"]');
    return { scene: state?.getAttribute("data-current-scene-id"),
      command: Number(state?.getAttribute("data-current-command-index")),
      mode: el.dataset.dialogueLayoutMode, page: Number(el.dataset.dialogPage), pages: Number(el.dataset.dialogPages),
      done: el.dataset.dialogPageDone, text: text?.textContent, font: text && parseFloat(getComputedStyle(text).fontSize),
      rect: rect(el), region: rect(region), choice: rect(el.querySelector(".choice-panel")),
      nvlPage: Number(el.querySelector(".nvl-page")?.getAttribute("data-nvl-page-index")),
      nvlTotal: Number(el.querySelector(".nvl-page")?.getAttribute("data-nvl-total-lines")),
      nvl: [...el.querySelectorAll("[data-nvl-line]")].map(n => ({
        text: n.textContent, font: parseFloat(getComputedStyle(n.querySelector(".nvl-page-text")).fontSize), rect: rect(n),
      })),
      glyphs: text ? [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
        .map(r => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom })) : [],
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
async function settled() {
  await page().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page().waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
}
async function command(scene, index) {
  await page().waitForFunction(({ scene, index }) => {
    const el = document.querySelector('[data-testid="game-state-playing"]');
    return el?.getAttribute("data-current-scene-id") === scene && Number(el.getAttribute("data-current-command-index")) === index;
  }, { scene, index }); await settled(); return snapshot();
}
function geometry(s, withChoice = false) {
  const v = cell.viewport;
  assert(s.rect.x >= -1 && s.rect.y >= -1 && s.rect.right <= v.width + 1 && s.rect.bottom <= v.height + 1);
  assert(s.overflow <= 1); assert(s.region && s.region.height > 0 && s.glyphs.length);
  assert(s.glyphs.every(r => r.x >= s.region.x - 2 && r.right <= s.region.right + 2 &&
    r.y >= s.region.y - 2 && r.bottom <= s.region.bottom + 2), "Actual glyphs must fit visible text region");
  if (withChoice) {
    assert(s.choice && s.choice.width > 0 && s.choice.height > 0);
    assert(s.choice.x >= s.rect.x - 1 && s.choice.right <= s.rect.right + 1 &&
      s.choice.y >= s.rect.y - 1 && s.choice.bottom <= s.rect.bottom + 1, "Choices must stay within NVL panel");
    assert(s.glyphs.every(r => r.bottom <= s.choice.y + 1), "NVL choice area must not cover text");
  }
}
async function turn() {
  const before = await snapshot(); await page().locator(".dialog-box").click();
  await page().waitForFunction(b => {
    const state = document.querySelector('[data-testid="game-state-playing"]'), dialog = document.querySelector(".dialog-box");
    return state?.getAttribute("data-current-scene-id") !== b.scene ||
      Number(state?.getAttribute("data-current-command-index")) !== b.command ||
      Number(dialog?.getAttribute("data-dialog-page")) !== b.page;
  }, before); await settled(); return snapshot();
}
async function newBranch(name, initialize = false) {
  const current = await player.page.locator("[data-runtime-screen-transition]").getAttribute("data-runtime-presented-screen");
  if (current === "playing") { await page().keyboard.press("Escape"); await player.ready("main_menu"); }
  await page().getByTestId("start-new-game").click(); await player.ready("playing"); await command("narrative_entry", 0);
  if (initialize) {
    await page().keyboard.press("Escape"); await player.ready("main_menu");
    await page().getByTestId("open-settings").click(); await player.ready("settings");
    await page().locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    await page().locator('[data-settings-tab-current="system"]').waitFor();
    await page().getByRole("checkbox", { name: "自动存档", exact: true }).uncheck();
    await page().locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }).click();
    await page().locator('[data-settings-tab-current="text"]').waitFor();
    await page().getByRole("slider", { name: "Text speed", exact: true }).focus(); await page().keyboard.press("Home");
    assert.equal(await page().getByRole("slider", { name: "Text speed", exact: true }).inputValue(), "0");
    await page().getByTestId("settings-finish").click(); await player.ready("main_menu");
    await page().getByTestId("continue-game").click(); await player.ready("playing"); await command("narrative_entry", 0);
  }
  await page().locator(".dialog-box").click();
  await page().getByRole("button", { name: `选择：${name}`, exact: true }).click(); return command(name, 0);
}
async function openSaves(load = false, fromTitle = false) {
  if (load) {
    if (!fromTitle) { await page().keyboard.press("Escape"); await player.ready("main_menu"); }
    await page().getByTestId("open-save-load").click();
  } else if (cell.layout === "renpy") await page().getByTestId("renpy-quick-save-load").click();
  else {
    await page().getByTestId("quick-menu-toggle").click();
    await page().getByRole("button", { name: "打开存档读档", exact: true }).click();
  }
  await player.ready("save_load"); await page().getByRole("tab", { name: "手动", exact: true }).click();
  if (load) await page().getByRole("button", { name: "读取", exact: true }).click();
}
async function saveSlot(slot, label) {
  await openSaves(); await page().getByTestId(`save-slot-manual-${slot}`).locator(".save-card-main").click();
  await page().waitForFunction(() => document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
  const stored = (await player.saves()).find(s => (s.save_kind || "manual") === "manual" && s.slot === slot); assert(stored);
  const source = fs.readdirSync(player.storage.targetDirectory).filter(n => n.endsWith(".json"))
    .map(n => path.join(player.storage.targetDirectory, n)).find(f => read(f).save_id === stored.save_id); assert(source);
  const retained = path.join(out, `${cell.name}-${label}.json`);
  fs.copyFileSync(source, retained, fs.constants.COPYFILE_EXCL);
  report.nativeSaves.push({ source, retained, sha256: sha(source), cell: cell.name, data: read(retained) }); save();
  await page().keyboard.press("Escape"); await player.ready("playing"); await settled(); return stored;
}
async function loadSlot(slot, fromTitle = false) {
  await openSaves(true, fromTitle);
  await page().getByTestId(`save-slot-manual-${slot}`).locator(".save-card-main").click();
  await player.ready("playing"); await settled(); return snapshot();
}
const voice = () => page().evaluate(() => window.__QA_VOICE__);
async function plays(n) {
  await page().waitForFunction(expected => {
    const q = window.__QA_VOICE__;
    return q.calls.length >= expected && q.calls.slice(0, expected).every(c => c.settlement === "resolved" &&
      q.events.some(e => e.id === c.id && e.event === "playing") &&
      q.events.some(e => e.id === c.id && e.event === "timeupdate" && e.time > 0));
  }, n);
  const q = await voice(); assert.equal(q.calls.length, n); assert(!q.events.some(e => e.event === "error")); return q;
}
async function silent(n, label) {
  const start = Date.now(); await new Promise(resolve => setTimeout(resolve, 2200));
  const q = await voice(); assert.equal(q.calls.length, n, label); assert(!q.events.some(e => e.event === "error"));
  const evidence = { cell: cell.name, label, expected: n, actual: q.calls.length, windowMs: Date.now() - start };
  report.negativeWindows.push(evidence); save(); return evidence;
}
async function check(name, fn) {
  const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; cell.checks.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { c.finishedAt = new Date().toISOString(); save(); console.log(`${cell.name} ${c.status}: ${name}`); }
}
async function capacity() {
  await newBranch("capacity", true);
  const pages = [], fonts = new Map(), historyFontSamples = []; let previousFonts = new Map();
  for (let i = 0; i < 24; i++) {
    await command("capacity", i); const text = [];
    while (true) {
      const s = await snapshot(); geometry(s); text.push(s.text);
      assert(s.font >= 12 - 0.01); assert(s.nvlTotal === i + 1);
      for (const line of s.nvl.filter(n => n.text !== s.text)) {
        if (previousFonts.has(line.text)) {
          assert.equal(line.font, previousFonts.get(line.text), "Visible history must not progressively shrink");
          historyFontSamples.push({ text: line.text, before: previousFonts.get(line.text), after: line.font, command: i, page: s.page });
        }
        fonts.set(line.text, line.font);
      }
      previousFonts = new Map(s.nvl.filter(n => n.text !== s.text).map(n => [n.text, n.font]));
      pages.push({ command: i, page: s.page, pages: s.pages, nvlPage: s.nvlPage, font: s.font, region: s.region });
      if (s.page === s.pages) break; await turn();
    }
    assert.equal(text.join(""), fixture.capacityTexts[i]);
    await page().locator(".dialog-box").click();
    if (i < 23) await command("capacity", i + 1);
  }
  await page().getByRole("button", { name: "选择：离开NVL容量页", exact: true }).waitFor();
  const choice = await snapshot(); geometry(choice, true); assert.equal(choice.nvlTotal, 24);
  assert(choice.nvlPage > 1 || pages.some(p => p.nvlPage > 1), "Fixture must overflow an accumulated NVL page");
  assert(fonts.size > 0 && historyFontSamples.length > 0, "Historical font test must compare actual repeated visible history");
  const stored = await saveSlot(4, "capacity-choice");
  assert.equal(stored.nvl_page.length, 24);
  assert.deepEqual(stored.nvl_page.map(n => n.text), fixture.capacityTexts);
  await player.shot("capacity-choice");
  await page().getByRole("button", { name: "选择：离开NVL容量页", exact: true }).click(); await command("capacity_end", 0);
  assert.equal((await snapshot()).nvl.length, 0);
  const restored = await loadSlot(4); geometry(restored, true);
  assert.equal(restored.command, 24); assert.deepEqual(restored.nvl, choice.nvl);
  const button = page().getByRole("button", { name: "选择：离开NVL容量页", exact: true });
  const hit = await button.evaluate(n => { const r = n.getBoundingClientRect(); return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
  assert(hit); await button.click(); await command("capacity_end", 0);
  return { pages, choice, storedId: stored.save_id, restored, historyFonts: fonts.size, historyFontSamples,
    cleared: (await snapshot()).nvl.length };
}
async function voicedScene(name, slot, count) {
  await newBranch(name); await plays(++count);
  const first = await snapshot(); assert(first.pages > 1 && first.pages < 1000, "Voice fixture must really paginate");
  geometry(first); await turn(); const interior = await snapshot(); assert.equal(interior.page, 2); geometry(interior);
  const stored = await saveSlot(slot, `voice-${name}`);
  assert.equal(stored.dialog_page_index, 1); assert.equal(stored.dialog_page_count, interior.pages);
  await silent(count, `${name}: page/save/menu never replays`);
  if (interior.pages > 2) await turn();
  const restored = await loadSlot(slot);
  assert.equal(restored.scene, name); assert.equal(restored.page, 2); assert.equal(restored.text, interior.text);
  await silent(count, `${name}: load interior page is silent`);
  const pieces = [first.text], pageStates = [];
  while (true) {
    const s = await snapshot(); geometry(s); pieces.push(s.text);
    pageStates.push({ page: s.page, font: s.font, region: s.region, text: s.text });
    if (s.page === s.pages) break; await turn();
  }
  assert.equal(pieces.join(""), fixture.longTexts[name], "Every character appears once across actual pages");
  await silent(count, `${name}: all page turns do not replay`);
  await turn(); const next = await command(name, 1); await plays(++count);
  await page().keyboard.press("PageUp"); const back = await command(name, 0);
  await silent(count, `${name}: rollback is silent`);
  await page().keyboard.press("PageDown"); const forward = await command(name, 1);
  assert.deepEqual(forward.nvl, next.nvl); await silent(count, `${name}: rollforward is silent`);
  await player.shot(`voice-${slot}`);
  cell.saved.push({ name, slot, interior, saveId: stored.save_id }); save();
  return { firstPages: first.pages, firstText: first.text, interior, restored, pageStates,
    characters: pieces.join("").length, back, forward, count };
}
async function runCell(layout, viewport) {
  const key = `${viewport.width}x${viewport.height}-dpr${viewport.dpr}-${viewport.reduced ? "reduced" : "normal"}`;
  cell = { name: `${key}-${layout}`, layout, viewport, checks: [], saved: [], status: "RUNNING" };
  report.cells.push(cell); save();
  const installId = `qa_narrative_1922_${path.basename(out).slice(-2)}_${cell.name.replace(/\W/g, "_")}`;
  const args = { layout, installId, cell: cell.name, viewport };
  try {
    await player.start(args); await check("NVL accumulated capacity, stable history fonts, reserved choice and durable restoration", capacity);
    let count = 0;
    const names = ["voice_dialog", viewport.width === 3840 ? "voice_nvl_4k" : "voice_nvl", "voice_bubble"];
    for (let i = 0; i < names.length; i++) await check(`${names[i]}: actual paged voice, native save/load, rollback and rollforward`, async () => {
      const result = await voicedScene(names[i], i + 1, count); count = result.count; return result;
    });
    const before = await player.saves(), oldPid = player.launch.pid; await player.stop();
    await check("Real process restart keeps native slots and each interior page restores silently", async () => {
      await player.start({ ...args, restart: true }); assert.notEqual(player.launch.pid, oldPid);
      assert.deepEqual(await player.saves(), before);
      const restored = [];
      for (let i = 0; i < cell.saved.length; i++) {
        const saved = cell.saved[i], s = await loadSlot(saved.slot, i === 0);
        assert.equal(s.scene, saved.name); assert.equal(s.page, 2); assert.equal(s.text, saved.interior.text);
        assert.deepEqual(s.nvl, saved.interior.nvl); geometry(s); await silent(0, `${saved.name}: real process restart load is silent`);
        restored.push(s);
      }
      await player.shot("restarted"); return { oldPid, newPid: player.launch.pid, savedIds: before.map(s => s.save_id), restored, reseeded: false };
    });
    assert.equal(cell.checks.length, 5); cell.status = "PASS";
  } catch (e) {
    cell.status = "FAILED"; cell.error = String(e.stack || e);
    if (player.page) { cell.body = (await page().locator("body").innerText().catch(() => "")).slice(-5000);
      await player.shot("failure").catch(() => {}); }
  } finally { await player.stop(); save(); console.log(`CELL ${cell.name}: ${cell.status}`); }
}
(async () => {
  for (const [width, height] of smoke ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of smoke ? [1] : [1, 2]) for (const reduced of smoke ? [false] : [false, true])
      for (const layout of ["agentvn", "renpy"]) await runCell(layout, { width, height, dpr, reduced });
  assert.equal(report.cells.length, smoke ? 2 : 24); assert.deepEqual(report.pageErrors, []);
  assert(!report.observerError, report.observerError);
  report.status = report.cells.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try { await player.stop(); }
  catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cells: report.cells.length, out, error: report.error, cleanupError: report.cleanupError }));
});
