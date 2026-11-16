"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const show = (id = "alice", sprite = "portrait") => ({
  type: "sprite", character_id: id, sprite_id: sprite, visible: true, position: "left", scale: .85,
});
const hide = (id = "alice", blocking = false, duration = 160) => ({
  type: "sprite", character_id: id, sprite_id: "", visible: false,
  animation_config: { kind: "fade", phase: "exit", duration_ms: duration, blocking },
});
const line = text => ({ type: "narration", text });
const exitAnimation = (target = "sprite:alice", blocking = false) => ({
  type: "animation", animation_id: "sprite_fade_out", target, blocking,
  params: { duration_ms: 160, keyframes: [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 0 }] },
});
function script(commands) {
  return { schema_version: "1.1.0", game_id: "hide-rollback", title: "Hide rollback", entry_scene_id: "scene",
    scenes: [{ scene_id: "scene", title: "Hide", commands }] };
}
async function until(predicate, description) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error("Timeout: " + description);
    await delay(5);
  }
}
function next(engine) { engine.state.isTyping = false; engine.next(); }
async function run(out) {
  assert(out.startsWith("F:\\testavn\\Sprite-Hide-Rollback-"));
  assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
  const report = { status: "RUNNING", scope: "REAL_STORY_ENGINE_CONTROLLED_TIMING_NOT_INSTALLED",
    cases: [], startedAt: new Date().toISOString() };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  global.window = { setTimeout, clearTimeout, dispatchEvent: () => true, matchMedia: () => ({ matches: false }) };
  global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  const { createServer } = await import(pathToFileURL(path.join(root, "GameCli_framework/node_modules/vite/dist/node/index.js")));
  const server = await createServer({ root: path.join(root, "GameCli_framework"), logLevel: "silent",
    server: { middlewareMode: true }, appType: "custom" });
  try {
    const { StoryEngine } = await server.ssrLoadModule("/src/engine/StoryEngine.ts");
    const engines = [];
    const engineFor = async commands => {
      const e = new StoryEngine(); engines.push(e);
      e.loadScript(script(commands), { game_id: "hide-rollback", assets: [] }); e.start();
      await until(() => e.state.dialog?.text === "BEFORE", "first dialogue");
      return e;
    };
    const test = async (name, callback) => {
      const row = { name, status: "RUNNING" }; report.cases.push(row); save();
      try { await callback(row); row.status = "PASS"; }
      catch (error) { row.status = "FAILED"; row.error = error.stack; }
      finally {
        // Invalidates only this case's pending callbacks; no live task crosses a case.
        for (const e of engines.splice(0)) e.loadScript(script([]), { game_id: "hide-rollback", assets: [] });
        save();
      }
    };
    const defaultCommands = [show(), line("BEFORE"), hide(), line("HIDDEN_1"), line("HIDDEN_2"), line("HIDDEN_3")];
    await test("nonanimated-hide-checkpoint", async () => {
      const e = await engineFor([show(), line("BEFORE"), { ...hide(), animation_config: undefined }, line("HIDDEN_1"), line("HIDDEN_2")]);
      next(e); await until(() => e.state.dialog?.text === "HIDDEN_1", "hidden");
      next(e); assert(e.rollback()); assert(!e.state.sprites.alice);
    });
    await test("nonblocking-exit-snapshot-is-logically-hidden-during-animation", async row => {
      const e = await engineFor(defaultCommands); next(e);
      await until(() => e.state.dialog?.text === "HIDDEN_1", "first hidden dialogue");
      row.renderingDuringExit = Boolean(e.state.sprites.alice);
      assert(row.renderingDuringExit, "Exit must still be visually renderable");
      row.savedSprites = e.createSaveSnapshot().sprites;
      assert(!row.savedSprites.alice, "Post-hide save must not capture a still-fading presentation");
    });
    await test("later-rollback-and-forward-stay-hidden", async row => {
      const e = await engineFor(defaultCommands); next(e);
      await until(() => e.state.dialog?.text === "HIDDEN_1", "first hidden dialogue");
      next(e); next(e); await delay(220);
      assert(!e.state.sprites.alice);
      row.steps = [];
      for (const text of ["HIDDEN_2", "HIDDEN_1"]) {
        assert(e.rollback()); row.steps.push({ text: e.state.dialog?.text, sprites: Object.keys(e.state.sprites) });
        assert.equal(e.state.dialog?.text, text); assert(!e.state.sprites.alice, "Hidden checkpoint resurrected sprite");
      }
      assert(e.rollback()); assert.equal(e.state.dialog?.text, "BEFORE"); assert(e.state.sprites.alice);
      for (const text of ["HIDDEN_1", "HIDDEN_2", "HIDDEN_3"]) {
        assert(e.rollForward()); assert.equal(e.state.dialog?.text, text); assert(!e.state.sprites.alice);
      }
    });
    await test("disk-save-and-session-restore-during-exit-remain-hidden", async () => {
      const e = await engineFor(defaultCommands); next(e);
      await until(() => e.state.dialog?.text === "HIDDEN_1", "exit");
      const saved = structuredClone(e.createSaveSnapshot()), session = e.capturePlaybackSession();
      await delay(220); assert(session.restore()); assert(!e.state.sprites.alice);
      e.restoreSaveSnapshot(saved); assert(!e.state.sprites.alice); await delay(220);
      assert.equal(e.state.dialog?.text, "HIDDEN_1"); assert(!e.state.sprites.alice);
    });
    await test("old-exit-completion-cannot-delete-new-entry", async () => {
      const e = await engineFor([show(), line("BEFORE"), hide(), line("HIDDEN_1"), show("alice", "new-portrait"), line("RETURNED")]);
      next(e); await until(() => e.state.dialog?.text === "HIDDEN_1", "exit"); next(e);
      await until(() => e.state.dialog?.text === "RETURNED", "new entry");
      assert(!e.state.animationEffects.some(effect => effect.target === "sprite:alice"), "Old exit cannot keep fading the new entry");
      await delay(220); assert.equal(e.state.sprites.alice?.sprite_id, "new-portrait");
      assert.equal(e.createSaveSnapshot().sprites.alice?.sprite_id, "new-portrait");
    });
    await test("rollback-before-hide-invalidates-old-exit-callback", async () => {
      const e = await engineFor(defaultCommands); next(e);
      await until(() => e.state.dialog?.text === "HIDDEN_1", "exit"); assert(e.rollback());
      await delay(220); assert.equal(e.state.dialog?.text, "BEFORE"); assert(e.state.sprites.alice);
      next(e); await until(() => e.state.dialog?.text === "HIDDEN_1", "replayed hide");
      await delay(220); assert(!e.state.sprites.alice); assert(!e.createSaveSnapshot().sprites.alice);
    });
    await test("parallel-character-exits-do-not-hide-unrelated-sprite", async () => {
      const e = await engineFor([show(), show("bob"), show("carol"), line("BEFORE"), hide(), hide("bob"), line("HIDDEN_1"), line("HIDDEN_2")]);
      next(e); await until(() => e.state.dialog?.text === "HIDDEN_1", "parallel exits");
      assert.deepEqual(Object.keys(e.createSaveSnapshot().sprites), ["carol"]);
      next(e); await delay(220); assert(e.rollback());
      assert.deepEqual(Object.keys(e.state.sprites), ["carol"]); assert.deepEqual(e.state.spriteOrder, ["carol"]);
    });
    await test("blocking-exit-finishes-before-next-checkpoint", async () => {
      const e = await engineFor([show(), line("BEFORE"), hide("alice", true), line("HIDDEN_1"), line("HIDDEN_2")]);
      next(e); assert(!e.createSaveSnapshot().sprites.alice);
      await until(() => e.state.dialog?.text === "HIDDEN_1", "blocking completion");
      assert(!e.state.sprites.alice); next(e); assert(e.rollback()); assert(!e.state.sprites.alice);
    });
    await test("choice-after-exit-keeps-hidden-on-rollback", async () => {
      const e = await engineFor([show(), line("BEFORE"), hide(), {
        type: "choice", choices: [{ choice_id: "go", text: "Go", target_scene_id: "end", conditions: [] }],
      }]);
      e.script.scenes.push({ scene_id: "end", title: "End", commands: [line("AFTER_CHOICE")] });
      next(e); await until(() => e.state.isWaitingChoice, "choice"); await delay(220);
      e.choose("go"); await until(() => e.state.dialog?.text === "AFTER_CHOICE", "choice result");
      assert(e.rollback()); assert(e.state.isWaitingChoice); assert(!e.state.sprites.alice);
    });
    await test("superseded-blocking-exit-cannot-advance-new-dialogue", async () => {
      const e = await engineFor([show(), line("BEFORE"), hide("alice", true), line("HIDDEN_1"), show(), line("RETURNED"), line("NEXT")]);
      next(e); e.executeCommand(show());
      e.state.currentCommandIndex = 5; e.executeCurrentCommand();
      await delay(220); assert.equal(e.state.dialog?.text, "RETURNED"); assert(e.state.sprites.alice);
    });
    for (const target of ["sprite:alice", "sprite:all", "sprite:selected"]) {
      await test("animation-event-hide-rollback-" + target, async () => {
        const e = await engineFor([show(), line("BEFORE"), exitAnimation(target), line("HIDDEN_1"), line("HIDDEN_2")]);
        next(e); await until(() => e.state.dialog?.text === "HIDDEN_1", "animation exit");
        assert(!e.createSaveSnapshot().sprites.alice, "Animation-event fade must be logically hidden");
        next(e); await delay(220); assert(e.rollback()); assert(!e.state.sprites.alice);
        assert(e.rollback()); assert(e.state.sprites.alice);
      });
      await test("animation-event-reentry-" + target, async () => {
        const e = await engineFor([show(), line("BEFORE"), exitAnimation(target), line("HIDDEN_1"), show("alice", "new"), line("RETURNED")]);
        next(e); await until(() => e.state.dialog?.text === "HIDDEN_1", "exit"); next(e);
        await until(() => e.state.dialog?.text === "RETURNED", "return");
        assert(!e.state.animationEffects.some(effect => effect.target === target), "Old animation must not affect new entry");
        await delay(220); assert.equal(e.state.sprites.alice?.sprite_id, "new");
      });
    }
    await test("all-exit-interruption-settles-other-hidden-characters", async () => {
      const e = await engineFor([show(), show("bob"), line("BEFORE"), exitAnimation("sprite:all"), line("HIDDEN_1"), show("alice", "new"), line("RETURNED")]);
      next(e); await until(() => e.state.dialog?.text === "HIDDEN_1", "all exit"); next(e);
      await until(() => e.state.dialog?.text === "RETURNED", "return"); await delay(220);
      assert.deepEqual(Object.keys(e.state.sprites), ["alice"]);
    });
    await test("superseded-exit-still-cleans-its-hidden-instance-without-advancing", async () => {
      const e = await engineFor([show(), line("BEFORE"), hide(), line("HIDDEN_1"),
        { type: "animation", animation_id: "sprite_shake", target: "sprite:alice", blocking: false, params: { duration_ms: 30 } },
        line("HIDDEN_2"), line("NEXT")]);
      next(e); await until(() => e.state.dialog?.text === "HIDDEN_1", "exit"); next(e);
      await until(() => e.state.dialog?.text === "HIDDEN_2", "emphasis"); await delay(220);
      assert(!e.state.sprites.alice, "Cancelled presentation cannot leave logically-hidden sprite rendered forever");
      assert.equal(e.state.dialog?.text, "HIDDEN_2");
    });
    report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  } finally {
    await server.close(); report.finishedAt = new Date().toISOString(); save();
  }
  console.log(JSON.stringify(report)); if (report.status !== "PASS") process.exitCode = 1;
}
module.exports = { show, hide, line, script, exitAnimation };
if (require.main === module) run(path.resolve(process.argv[2] || "")).catch(error => { console.error(error); process.exitCode = 1; });
