"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-runtime-quick-latest-20261019-01", work = "F:/AgentVN/QA/Runtime-Quick-Latest-20261019-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const prep = read(`${base}/preparation.json`), fixtureFile = "D:/AgentVN/output/installed-runtime-abilities-20261018-01/fixtures-02.json";
const sourceFile = "D:/AgentVN/output/installed-runtime-abilities-20261018-01/export-03/report.json";
const fixture = read(fixtureFile), source = read(sourceFile); assert.equal(source.status, "PASS");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(base)); assert(!fs.existsSync(`${base}/player-01.json`));
const report = { status: "RUNNING", at: new Date().toISOString(), cells: [], launches: [], screenshots: [], pageErrors: [], faults: [],
  nativeSaves: [], sources: [fixtureFile, fixture.input, sourceFile, ...source.cartridges.map(c => c.path)].map(p => ({ path: p, sha256: sha(p) })),
  productChanges: 0, newBuilds: 0, modelRequests: 0, scope: "INSTALLED_LIBRARY_DISTINGUISHABLE_LATEST_VALID_QUICK_NOT_STANDALONE_ANDROID",
  controlledBoundaries: ["Public native cartridge import (including restart); real UI save/load",
    "Newest QA save scene_id corrupted offline only; original bytes restored"],
  environment: { project: process.env.AGENTVN_TEST_PROJECT, output: process.env.AGENTVN_WORKSPACE_OUTPUT } };
const save = () => fs.writeFileSync(`${base}/player-01.json`, JSON.stringify(report, null, 2));
let session, cell, fault;
const quick = async () => (await session.saves()).filter(s => s.save_kind === "quick");
async function current() {
  return session.page.getByTestId("game-state-playing").evaluate(e => ({
    scene: e.getAttribute("data-current-scene-id"), command: Number(e.getAttribute("data-current-command-index")),
    text: document.querySelector(".dialog-text")?.textContent, page: document.querySelector(".dialog-box")?.getAttribute("data-dialog-page"),
  }));
}
async function done(index) {
  await session.command("ordinary_nvl", index, false);
  if (await session.page.locator(".dialog-box").getAttribute("data-dialog-page-done") !== "true") await session.page.locator(".dialog-box").click();
  await session.command("ordinary_nvl", index);
}
async function advance(index) {
  for (let i = 0; i < 30; i++) {
    const before = await current(); if (before.command === index) { await done(index); return; }
    assert.equal(before.command, index - 1);
    await session.page.locator(".dialog-box").click();
    await session.page.waitForFunction(({ command, page }) => {
      const e = document.querySelector('[data-testid="game-state-playing"]'), d = document.querySelector(".dialog-box");
      return Number(e?.getAttribute("data-current-command-index")) !== command || d?.getAttribute("data-dialog-page") !== page;
    }, { command: before.command, page: before.page });
    await session.page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  }
  throw new Error("Distinct command not reached by real dialog page advancement");
}
async function start(restart) {
  await session.start("renpy", false); await session.viewport(cell.viewport);
  session.launch.cell = cell.name; session.launch.restart = restart; save();
  await session.page.getByTestId("start-new-game").click(); await session.ready("playing");
  if (!restart) await session.setAuto(false, true);
  await done(0);
}
async function write() {
  const before = await quick();
  await session.page.getByTestId("renpy-quick-save").click();
  await session.page.waitForFunction(() => document.querySelector('[data-testid="renpy-quick-save"]')?.getAttribute("aria-busy") !== "true");
  const fresh = (await quick()).filter(s => !before.some(b => b.save_id === s.save_id)); assert.equal(fresh.length, 1);
  return fresh[0];
}
async function restore() {
  if (!fault) return;
  await session.stop(); assert.equal(sha(fault.file), fault.injectedSha256);
  fs.copyFileSync(fault.retained, fault.file); assert.equal(sha(fault.file), fault.originalSha256); fault.restoration = "PASS"; fault = null; save();
}
(async () => {
  save(); let index = 0;
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    index++; cell = { name: `${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}`, viewport: { width, height, dpr, reduced },
      installId: `qa_quick_latest_20261019_${String(index).padStart(2, "0")}`, status: "RUNNING" };
    report.cells.push(cell); save();
    session = new InstalledRuntimeSession({ prep, fixture, cartridges: source.cartridges, out: work, report, save, installId: cell.installId });
    try {
      await start(false); assert.equal((await quick()).length, 0);
      const oldest = await write(); assert.equal(oldest.command_index, 0);
      await advance(1); const latestValid = await write(); assert.equal(latestValid.command_index, 1);
      await advance(2); const latest = await write(); assert.equal(latest.command_index, 2);
      assert(Date.parse(oldest.created_at) < Date.parse(latestValid.created_at) && Date.parse(latestValid.created_at) < Date.parse(latest.created_at));
      cell.distinct = { oldest, latestValid, latest }; save(); await session.stop();
      const file = path.join(session.storage.targetDirectory, `quick-${String(latest.slot).padStart(2, "0")}.json`);
      const retained = path.join(work, `${cell.name}-original-latest.json`); fs.copyFileSync(file, retained, fs.constants.COPYFILE_EXCL);
      const invalid = { ...read(retained), scene_id: "__qa_missing_scene_20261019__" };
      fault = { cell: cell.name, file, retained, originalSha256: sha(file), original: read(retained) };
      report.faults.push(fault); save(); fs.writeFileSync(file, JSON.stringify(invalid)); fault.injectedSha256 = sha(file); fault.injected = invalid; save();
      await start(true); const listed = await quick(); assert.equal(listed.length, 3);
      assert.equal(listed.find(s => s.save_id === latest.save_id)?.scene_id, invalid.scene_id); cell.listed = listed; save();
      const before = await current(); assert.equal(before.command, 0);
      await session.page.getByTestId("renpy-quick-load").click(); await session.page.getByTestId("confirm-quick-load").waitFor();
      cell.confirmation = await session.page.getByRole("dialog").innerText();
      await session.page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
      assert.deepEqual(await current(), before);
      await session.page.getByTestId("renpy-quick-load").click(); await session.page.getByTestId("confirm-quick-load").click();
      await session.ready("playing"); await done(1);
      cell.restored = await current(); assert.equal(cell.restored.command, latestValid.command_index);
      assert.notEqual(cell.restored.command, oldest.command_index); assert.notEqual(cell.restored.command, latest.command_index);
      assert(cell.restored.text.includes("MID_ADAPT"));
      await session.shot(`${cell.name}-unique-latest-valid`);
      await restore();
      cell.files = session.files().map(f => {
        const retainedSave = path.join(work, `${cell.name}-${f.name}`);
        fs.copyFileSync(f.path, retainedSave, fs.constants.COPYFILE_EXCL); assert.equal(sha(retainedSave), f.sha256);
        const row = { ...f, retained: retainedSave }; report.nativeSaves.push(row); return row;
      }); cell.status = "PASS";
    } catch (e) { cell.status = "FAILED"; cell.error = String(e.stack || e); await session.shot(`${cell.name}-failure`).catch(() => {}); }
    finally { await restore(); await session.stop(); cell.finishedAt = new Date().toISOString(); save(); console.log(`${cell.name}: ${cell.status}`); }
  }
  assert.equal(report.cells.length, 12); assert.deepEqual(report.pageErrors, []);
  report.status = report.cells.every(c => c.status === "PASS") ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  try { await restore(); await session?.stop(); } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); }
  report.finishedAt = new Date().toISOString(); save(); if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, cells: report.cells.length, path: `${base}/player-01.json`, error: report.error }));
});
