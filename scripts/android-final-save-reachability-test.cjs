"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
assert.equal(process.argv.length, 4, "node test <raw-runtime-report> <fresh-report>");
const [rawFile, file] = process.argv.slice(2).map(f => path.resolve(f));
assert(!fs.existsSync(file));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [] };
async function test(name, action) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { await action(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; throw e; }
}
(async () => {
  const { verifyScrollableSaveCards } = require("./lib/android-save-reachability.cjs");
  const original = JSON.parse(fs.readFileSync(rawFile, "utf8"));
  const raw = original.screens.find(s => s.label === "final-manual-save").state;
  const rawBytes = fs.readFileSync(rawFile);
  await test("Recorded failing save cards require actual reachability evidence", async () => {
    const state = structuredClone(raw), calls = [];
    await verifyScrollableSaveCards(state, async (selector, label, options) => {
      assert.equal(options.scrollOnly, true); calls.push(selector);
      assert(selector.includes("save-card-main"));
      return { x: 110, y: 170, width: 202, height: 156, right: 312, bottom: 326 };
    });
    assert.equal(calls.length, 3);
    assert(state.buttons.filter(b => b.reachableRect).length === 3);
  });
  await test("Real swipe failure must still fail, not mask clipped controls", async () => {
    await assert.rejects(verifyScrollableSaveCards(structuredClone(raw), async () => { throw Error("SWIPE_FAILED"); }), /SWIPE_FAILED/);
  });
  await test("Claimed reachability outside the root must be rejected", async () => {
    await assert.rejects(verifyScrollableSaveCards(structuredClone(raw), async () => ({
      x: 110, y: 371, width: 202, height: 156, right: 312, bottom: 527,
    })), /SAVE_CARD_STILL_OUTSIDE/);
  });
  await test("Non-save controls never receive an overflow exemption", async () => {
    const state = structuredClone(raw);
    state.buttons = state.buttons.filter(b => !String(b.className).split(/\s+/).includes("save-card-main"));
    await verifyScrollableSaveCards(state, async () => { throw Error("Must not be called"); });
    assert(state.buttons.every(b => !b.reachableRect));
  });
  await test("Raw failure receipt remains unchanged", async () => assert(fs.readFileSync(rawFile).equals(rawBytes)));
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); });
