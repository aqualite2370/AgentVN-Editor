"use strict";
const assert = require("node:assert/strict");
const { acceptanceStatus } = require("../android-acceptance-evidence.cjs");
const { walkDialoguePages } = require("./installed-dialog-pagination.cjs");

function assertStoryRestored(before, after, label) {
  for (const key of ["scene", "command", "page", "pages", "mode", "text", "nvl"])
    assert.deepEqual(after[key], before[key], `${label}: changed ${key}`);
  assert(after.done, `${label}: changed revealed state`);
}
function assertPagedText(chunks, expected) {
  assert(chunks.length > 0 && chunks.every(chunk => typeof chunk === "string" && chunk.length),
    "Pagination requires nonempty rendered chunks");
  assert.equal(chunks.join(""), expected, "Every authored character must survive actual APK pagination");
}
function validateFullStoryInput(fixture, manifest, script) {
  assert.equal(fixture.status, "FIXTURE_VALIDATED");
  assert(fixture.projectId.startsWith("installed_resource_flow_story_"));
  assert.equal(manifest.game_id, fixture.projectId, "Fixture/APK identity mismatch");
  assert.deepEqual(script.scenes.map(scene => scene.scene_id).sort(), ["bubble", "finish", "main", "nvl"],
    "Full-story acceptance requires all four authored scenes");
}
function readState() {
  const player = document.querySelector(".story-player"), dialog = document.querySelector(".dialog-box");
  return { scene: player?.dataset.currentSceneId, command: Number(player?.dataset.currentCommandIndex),
    page: Number(dialog?.dataset.dialogPage), pages: Number(dialog?.dataset.dialogPages),
    done: dialog?.dataset.dialogPageDone === "true", mode: dialog?.dataset.dialogueLayoutMode,
    typing: player?.dataset.isTyping === "true",
    anchor: dialog?.dataset.dialogBubbleAnchor, reveal: player?.dataset.typingRevealRequested === "true",
    choice: player?.dataset.waitingChoice === "true",
    text: dialog?.querySelector(".dialog-text")?.textContent || "",
    nvl: [...document.querySelectorAll("[data-nvl-line] .nvl-page-text")].map(node => node.textContent) };
}
function observeSkip() {
  const samples = [];
  const sample = () => {
    const player = document.querySelector(".story-player");
    const button = document.querySelector('[data-testid="renpy-quick-skip"]');
    const state = { scene: player?.dataset.currentSceneId, command: player?.dataset.currentCommandIndex,
      active: button?.getAttribute("aria-pressed") === "true" };
    if (JSON.stringify(samples.at(-1)?.state) !== JSON.stringify(state))
      samples.push({ at: performance.now(), state });
  };
  const observer = new MutationObserver(sample);
  observer.observe(document.querySelector(".story-player"), { subtree: true, attributes: true,
    attributeFilter: ["aria-pressed", "data-current-scene-id", "data-current-command-index"] });
  sample();
  window.__agentvnFullStorySkip = { samples, sample, observer };
}
async function exerciseFullStory({ cdp, tap, wait, capture, geometry, script, report, save }) {
  const selector = id => `[data-testid="${id}"]`;
  const state = () => cdp.evaluate(`(async () => {
    let last = "", stable = 0;
    for (let frame = 0; frame < 180; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const current = (${readState.toString()})();
      const key = JSON.stringify({ ...current, text: undefined, nvl: undefined });
      stable = key === last ? stable + 1 : 0; last = key;
      if (stable >= 3 && current.mode && current.pages >= 1
        && !(current.reveal && !current.done && !current.choice)
        && !(!current.typing && !current.done && !current.choice)) return current;
    }
    throw Error("Full-story dialogue failed to settle");
  })()`);
  const idle = () => wait(`document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition === 'idle'
    && !document.querySelector('.game-launch-blackout')`, "full-story screen idle");
  const act = (id, label) => tap(selector(id), label);
  const reveal = async () => {
    const before = await state();
    if (!before.done) {
      const authored = script.scenes.find(scene => scene.scene_id === before.scene)?.commands[before.command]?.text;
      // A short line may naturally finish while the real touch travels through
      // ADB/actionability. Wait for that completion rather than accidentally
      // turn an intended reveal into a valid next-line tap.
      if (!authored || authored.length > 160)
        await tap(".dialog-box", "full-story reveal current line");
      await wait(`document.querySelector('.dialog-box')?.dataset.dialogPageDone === 'true'`, "full-story revealed");
    }
    const after = await state();
    assert.equal(after.scene, before.scene); assert.equal(after.command, before.command);
    assert.equal(after.page, before.page, "Reveal must not advance a page");
    return after;
  };
  const next = async () => {
    const before = await reveal();
    await tap(".dialog-box", "full-story advance one page or command");
    await wait(`(() => { const s=(${readState.toString()})(); return s.scene !== ${JSON.stringify(before.scene)}
      || s.command !== ${before.command} || s.page !== ${before.page} || s.choice; })()`, "full-story advance");
    return state();
  };
  const cases = [];
  report.fullStory = { status: "RUNNING", cases };
  const test = async (name, action) => {
    const row = { name, status: "RUNNING" }; cases.push(row); save();
    try { row.evidence = await action(); row.status = "PASS"; }
    catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
    finally { save(); }
  };
  const menu = async () => {
    const before = await reveal();
    await act("renpy-quick-settings", "full-story settings");
    await wait(`Boolean(document.querySelector('[data-testid="settings-screen"]'))`, "full-story settings visible");
    await idle(); await act("settings-finish", "full-story settings return"); await idle();
    const after = await state(); assertStoryRestored(before, after, "Settings return");
    return { before, after };
  };
  const quick = async () => {
    const before = await reveal();
    await act("renpy-quick-save", "full-story quick save");
    await wait(`document.body.innerText.includes('快存已保存') &&
      !document.querySelector('[data-testid="renpy-quick-save"]')?.disabled`, "full-story quick saved");
    await act("renpy-quick-load", "full-story quick load");
    await wait(`Boolean(document.querySelector('[data-runtime-modal="true"]'))`, "full-story quick-load confirmation");
    assert(await cdp.evaluate(`document.querySelector('[data-runtime-modal="true"]').contains(document.activeElement)`));
    await act("confirm-quick-load", "full-story confirm quick load"); await idle();
    const after = await reveal(); assertStoryRestored(before, after, "Quick-load");
    return { before, after };
  };
  const paged = async label => {
    const first = await state(), chunks = [], frames = [];
    const result = await walkDialoguePages({ initial: first, reveal, next, visit: async (current, index) => {
      if (index === 1) assert(current.pages > 1, `${label}: expected real pagination on this device`);
      chunks.push(current.mode === "nvl" ? current.nvl.at(-1) : current.text);
      frames.push(await geometry());
      if (index === 1 || index === current.pages) {
        await menu(); await quick(); await capture(`${label}-page-${index}`);
      }
    } });
    const authored = script.scenes.find(scene => scene.scene_id === first.scene).commands[first.command].text;
    assertPagedText(chunks, authored);
    return { pages: result.pages, initialPages: first.pages, characters: authored.length, frames };
  };

  assert.equal((await reveal()).scene, "main");
  const sprites = await cdp.evaluate(`[...document.querySelectorAll('.sprite-slot img')].map(image =>
    ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight,
      visible: image.getBoundingClientRect().width > 0 }))`);
  assert(sprites.some(image => image.visible && image.complete && image.width > 0 && image.height > 0),
    "Full-story APK must render a decoded character sprite");
  report.fullStory.initialSprites = sprites;
  await next();
  await test("ordinary long text, every page, menu and quick-load", () => paged("full-dialog"));
  await next();
  await test("valid rollback, history, auto, skip and manual save/load", async () => {
    const at = await reveal(); assert.equal(at.command, 5);
    await act("renpy-quick-history", "full-story history");
    await wait(`Boolean(document.querySelector('.history-list article'))`, "full-story history entries");
    await capture("full-history");
    await act("renpy-menu-return", "full-story history return"); await idle();
    assertStoryRestored(at, await state(), "History return");
    await act("renpy-quick-auto", "full-story enable auto");
    await wait(`document.querySelector('[data-testid="renpy-quick-auto"]')?.getAttribute('aria-pressed') === 'true'`, "auto enabled");
    await act("renpy-quick-auto", "full-story disable auto");
    await wait(`document.querySelector('[data-testid="renpy-quick-auto"]')?.getAttribute('aria-pressed') === 'false'`, "auto disabled");
    let beforeRollback = await state();
    assert.equal(beforeRollback.scene, "main", "Auto must not choose a story branch");
    assert([5, 6].includes(beforeRollback.command), "Auto may stop on the current line or waiting choice");
    while (beforeRollback.command > 4) {
      await act("renpy-quick-rollback", "full-story rollback to visited long line");
      const previous = beforeRollback.command;
      await wait(`Number(document.querySelector('.story-player')?.dataset.currentCommandIndex) < ${previous}`,
        "effective rollback changes command");
      beforeRollback = await state();
    }
    await wait(`document.querySelector('.story-player')?.dataset.currentCommandIndex === '4'`, "effective rollback");
    await reveal();
    // Observe the actual action before the ADB helper's post-input settling;
    // a valid skip may finish and disable itself in that interval.
    const { assessSkipAction } = require("../android-menu-action-observer.cjs");
    await cdp.evaluate(`(${observeSkip.toString()})()`);
    let skip;
    try {
      await act("renpy-quick-skip", "full-story skip previously read dialogue");
      await wait(`window.__agentvnFullStorySkip.samples.some(x => x.state.active) &&
        window.__agentvnFullStorySkip.samples.some(x => x.state.command !== '4')`, "skip progresses read text");
    } finally {
      skip = assessSkipAction(await cdp.evaluate(`(() => {
        const entry = window.__agentvnFullStorySkip; entry.sample(); entry.observer.disconnect();
        delete window.__agentvnFullStorySkip; return entry.samples;
      })()`));
    }
    assert.equal(skip.status, "PASS");
    if (skip.activeAtEnd) await act("renpy-quick-skip", "full-story disable skip");
    const stopped = await state();
    assert.equal(stopped.scene, "main", "Read-text skip must stop before selecting a branch");
    assert([5, 6].includes(stopped.command), "Read-text skip must reach the visited line or waiting choice");
    if (stopped.command === 6) {
      await act("renpy-quick-rollback", "full-story restore line before waiting choice");
      await wait(`document.querySelector('.story-player')?.dataset.currentCommandIndex === '5'`, "line restored before manual save");
    }
    await reveal();
    await act("renpy-quick-save-load", "full-story manual save");
    await idle(); await tap('[data-testid="save-slot-manual-1"] .save-card-main', "full-story save manual slot 1");
    await wait(`document.body.innerText.includes('存档已保存')`, "full-story manual save persisted");
    await tap(".save-mode-switch button:nth-child(2)", "full-story select load");
    await tap('[data-testid="save-slot-manual-1"] .save-card-main', "full-story load manual slot 1"); await idle();
    const restored = await reveal(); assert.equal(restored.command, 5);
    return { at, restored, skip };
  });
  await next();
  await test("real branch selection and NVL accumulation", async () => {
    assert.equal(await cdp.evaluate("document.querySelectorAll('.choice-option').length"), 2);
    await tap(".choice-option:first-child", "full-story choose NVL branch");
    await wait(`document.querySelector('.story-player')?.dataset.currentSceneId === 'nvl'`, "NVL scene");
    await reveal(); await next(); const current = await reveal();
    assert.equal(current.nvl.length, 2); assert(current.nvl[0].includes("第一行"));
    assert(current.nvl[1].includes("第二行"));
    await menu(); await quick(); await capture("full-nvl-accumulation");
    return current;
  });
  await next();
  await test("explicit NVL clear, long-line pages and state restoration", async () => {
    assert.equal((await state()).nvl.length, 1); return paged("full-nvl");
  });
  await next(); await tap(".choice-option:first-child", "full-story continue bubble");
  await wait(`document.querySelector('.story-player')?.dataset.currentSceneId === 'bubble'`, "bubble scene");
  await test("bubble character, movement, camera and fallback", async () => {
    await reveal();
    await wait(`document.querySelector('.dialog-box')?.dataset.dialogBubbleAnchor === 'character'`, "character bubble");
    const initial = await geometry();
    await next(); await reveal();
    await wait(`Boolean(document.querySelector('.sprite-slot.is-right, .sprite-slot.right')) &&
      document.querySelector('.dialog-box')?.dataset.dialogBubbleAnchor === 'character'`, "moved character bubble");
    await menu(); await quick(); const moved = await geometry(); await capture("full-bubble-moved");
    await next(); await reveal();
    await wait(`document.querySelector('.dialog-box')?.dataset.dialogBubbleAnchor === 'fallback'`, "absent character fallback");
    return { initial, moved, absent: await geometry() };
  });
  await next(); await test("fixed long bubble, all text and restoration", () => paged("full-bubble-long"));
  await next();
  await test("ending restores ordinary dialogue and usable menus", async () => {
    const current = await reveal(); assert.equal(current.scene, "finish"); assert.equal(current.mode, "dialog");
    await menu(); await quick(); await capture("full-story-finish"); return current;
  });
  assert.equal(cases.length, 7); assert(cases.every(row => row.status === "PASS"));
  report.fullStory.status = "PASS";
  return report.fullStory;
}
module.exports = { assertStoryRestored, assertPagedText, validateFullStoryInput,
  fullStoryStatus: acceptanceStatus, exerciseFullStory };
