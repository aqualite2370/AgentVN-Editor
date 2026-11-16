"use strict";
// Only the remaining native consumption: no reinstall, Editor authoring or export replay.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { IsolatedPlayer } = require("./lib/isolated-native-player-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const base = path.resolve(process.argv[2] || "");
assert.equal(process.argv.length, 3);
assert.equal(base, path.resolve("F:/testavn/Windows-Isolated-1985-20261116-03"));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const first = "F:/testavn/Windows-Isolated-1985-20261116-01";
const second = "F:/testavn/Windows-Isolated-1985-20261116-02";
const original = read(path.join(first, "resource-01/report.json")), prior = read(path.join(second, "resource-01/report.json"));
assert.equal(original.status, "FAILED"); assert(original.stages.slice(0, 5).every(s => s.status === "PASS"));
assert.equal(prior.status, "FAILED"); assert(prior.stages.slice(0, 4).every(s => s.status === "PASS"));
assert.match(prior.error, /Configured exit must render/);
const install = read(path.join(first, "install-new.json")), candidate = read(path.join(base, "candidate.json"));
const executable = path.join(install.installRoot, "agentvn-player.exe");
assert.equal(sha(executable), candidate.player.sha256);
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], launches: [], cleanups: [],
  screenshots: [], errors: [], modelRequests: 0, installations: 0, authoringReplays: 0,
  scope: "ACTUAL1985_INSTALLED_PLAYER_UNMODIFIED_TWO_REAL_UI_CARTRIDGES_1080P_DPR1_NORMAL",
  inheritance: [first, second].map(root => ({ path: path.join(root, "resource-01/report.json"), sha256: sha(path.join(root, "resource-01/report.json")) })),
  exitAssertion: "Actual configured exit opacity frames then removal; .is-exiting belongs to fallback transitions and is not required",
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const player = new IsolatedPlayer({ out, report, save, nativeProfile: true });
async function geometry(marker, count) {
  const page = player.page;
  await page.locator(".dialog-text").filter({ hasText: marker }).waitFor();
  await page.waitForFunction(count => document.querySelectorAll(".sprite-slot:not(.is-exiting)").length === count, count);
  await page.waitForFunction(() => [...document.querySelectorAll(".sprite-slot img")].every(i => i.complete && i.naturalWidth > 0));
  await settleRuntime(page);
  return page.locator('.sprite-slot[data-character-id="c0"] img').evaluate(i => ({
    rect: i.getBoundingClientRect().toJSON(), width: i.naturalWidth,
    authorScale: i.closest("[data-sprite-scale]").dataset.spriteScale,
  }));
}
(async () => {
  for (const exported of prior.exports) {
    assert.equal(sha(exported.path), exported.sha256);
    const row = { type: exported.type, status: "RUNNING", cartridge: exported, samples: [] }; report.cases.push(row); save();
    await player.start(executable, ["--mode", "fixed", "--cartridge", exported.path]);
    await player.page.evaluate(() => {
      window.__qaCapture = true; window.__qaFrames = []; window.__qaPhase = "initial";
      const tick = time => {
        if (!window.__qaCapture || window.__qaFrames.length > 2500) return;
        const frames = [...document.querySelectorAll(".sprite-slot")].map(slot => {
          const frame = slot.querySelector(".sprite-animation-frame");
          return { id: slot.dataset.characterId, phase: slot.dataset.spritePhase, animation: frame.dataset.runtimeAnimationId,
            opacity: Number(getComputedStyle(slot).opacity) * Number(getComputedStyle(frame).opacity) };
        });
        window.__qaFrames.push({ time, action: window.__qaPhase, frames }); requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await player.page.getByTestId("start-new-game").click({ timeout: 60000 });
    let baseline;
    for (const [marker, count, next] of [
      ["SIZE_STAGE_1", 1, "entry"], ["SIZE_STAGE_2", 2, "entry-many"],
      ["SIZE_STAGE_5", 5, "exit"], ["SIZE_STAGE_RETURN_1", 1, "author-scale"],
    ]) {
      const g = await geometry(marker, count); baseline ??= g;
      row.samples.push({ marker, count, ...g }); save();
      assert.equal(g.width, 900); assert.equal(g.authorScale, "0.85");
      assert(Math.abs(g.rect.width - baseline.rect.width) < .5 && Math.abs(g.rect.height - baseline.rect.height) < .5);
      await player.page.evaluate(phase => window.__qaPhase = phase, next);
      await player.page.locator(".dialog-box").click();
    }
    row.authorScale = await geometry("SIZE_STAGE_AUTHOR_SCALE", 1); save();
    const frames = await player.page.evaluate(() => { window.__qaCapture = false; return window.__qaFrames; });
    const frameFile = path.join(out, exported.type + "-frames.json");
    fs.writeFileSync(frameFile, JSON.stringify(frames), { flag: "wx" });
    row.frames = { path: frameFile, sha256: sha(frameFile) }; save();
    assert(Math.abs(row.authorScale.rect.width / baseline.rect.width - 1.1 / .85) < .01);
    const intermediate = animation => frames.flatMap(f => f.frames).filter(f =>
      f.id === "c1" && f.animation === animation && f.opacity > .01 && f.opacity < .99);
    row.entryIntermediate = intermediate("sprite_fade_in").length;
    row.exitIntermediate = intermediate("sprite_fade_out").length; save();
    assert(row.entryIntermediate > 0, "Saved global entry must render intermediate opacity");
    assert(row.exitIntermediate > 0, "Saved global exit must render intermediate opacity before removal");
    assert.equal(await player.page.locator('.sprite-slot[data-character-id="c1"]').count(), 0);
    await player.shot(exported.type + "-native-size-and-global-animation");
    await player.stop(); assert.equal(sha(exported.path), exported.sha256);
    row.status = "PASS"; save();
  }
  assert.equal(report.cases.length, 2); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; })
.finally(async () => {
  try {
    if (player.page && report.status !== "PASS") {
      await player.page.evaluate(() => window.__qaCapture = false);
      const frames = await player.page.evaluate(() => window.__qaFrames || []);
      fs.writeFileSync(path.join(out, "failure-frames.json"), JSON.stringify(frames), { flag: "wx" });
      await player.shot("failure-terminal").catch(() => {});
    }
    await player.stop(); report.cleanupStatus = "PASS";
  } catch (error) { report.status = "FAILED"; report.cleanupStatus = "FAILED"; report.cleanupError = error.stack; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => ({ type: c.type, status: c.status })), error: report.error }));
});
