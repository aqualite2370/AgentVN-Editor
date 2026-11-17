"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Sfx-Stop-Fade-") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", boundary: "ACTUAL_CONTROLLER_ENGINE_VALIDATORS_WITH_CONTROLLED_AUDIO_CLOCK", cases: [] };
const built = require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
export {SfxAudioController} from './GameCli_framework/src/components/player/sfxAudioController';
export {StoryEngine} from './GameCli_framework/src/engine/StoryEngine';
export {validateCommandFields,validateAssetReferences as runtimeAssetReferences} from './GameCli_framework/src/engine/validation';
export {validateRuntimeScript,validateAssetReferences,validateVersionCompatibility} from './shared/cartridge/validators';
export {collectAssetReferencesFromCommand} from './shared/cartridge/assetScanner';
export {minimumRuntimeVersionForScript} from './shared/cartridge/runtimeCapabilities';
export {commandPreview} from './editor/src/utils/commandPreview';` },
  bundle: true, platform: "node", format: "cjs", write: false,
  nodePaths: [path.join(root, "editor/node_modules")],
});
const m = { exports: {} }; new Function("module", "exports", "require", built.outputFiles[0].text)(m, m.exports, require);
const api = m.exports;
async function test(name, fn) {
  const row = { name, status: "RUNNING" }; report.cases.push(row);
  try { await fn(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; row.error = e.stack; }
}
function harness(resolve = async id => id) {
  let now = 0, id = 0;
  const frames = new Map(), audios = [], errors = [];
  const controller = new api.SfxAudioController({
    resolveUrl: resolve, now: () => now,
    requestFrame: callback => { frames.set(++id, callback); return id; }, cancelFrame: id => frames.delete(id),
    onError: (error, assetId) => errors.push({ error: String(error), assetId }),
    createAudio: url => {
      const a = { src: url, paused: true, volume: 1, onended: null, onerror: null,
        play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
      audios.push(a); return a;
    },
  });
  return { controller, audios, errors, frames, advance(time) {
    now = time; const tasks = [...frames.values()]; frames.clear(); tasks.forEach(fn => fn(now));
  } };
}
const script = commands => ({ schema_version: "1.0.0", game_id: "sfx-stop", entry_scene_id: "main",
  scenes: [{ scene_id: "main", title: "音效", commands }] });
(async () => {
  await test("legacy play and command/master volume", async () => {
    const h = harness(); h.controller.setMasterVolume(.5); await h.controller.play("a", .4);
    assert.equal(h.audios[0].paused, false); assert.equal(h.audios[0].volume, .2); h.controller.dispose();
  });
  await test("targeted stop releases every instance but keeps other assets", async () => {
    const h = harness(); await h.controller.play("a"); await h.controller.play("a"); await h.controller.play("b");
    h.controller.stop("a"); assert.deepEqual(h.audios.map(a => a.paused), [true, true, false]); h.controller.dispose();
  });
  await test("all stop includes every active sound", async () => {
    const h = harness(); await h.controller.play("a"); await h.controller.play("b"); h.controller.stop();
    assert(h.audios.every(a => a.paused && !a.src));
  });
  await test("500ms fade monotonic envelope and final release", async () => {
    const h = harness(); await h.controller.play("a", .8); h.controller.stop("", 500);
    const samples = [0, 100, 250, 400, 500].map(t => { h.advance(t); return h.audios[0].volume; });
    assert.deepEqual(samples, [.8, .6400000000000001, .4, .15999999999999998, 0]);
    assert(h.audios[0].paused); assert.equal(h.frames.size, 0);
  });
  await test("changing master volume during fade preserves envelope", async () => {
    const h = harness(); await h.controller.play("a"); h.controller.stop("", 500); h.advance(250);
    h.controller.setMasterVolume(.4); assert.equal(h.audios[0].volume, .2); h.advance(500); assert(h.audios[0].paused);
  });
  await test("repeated stop does not indefinitely postpone fade", async () => {
    const h = harness(); await h.controller.play("a"); h.controller.stop("a", 500); h.advance(250);
    h.controller.stop("a", 500); h.advance(500); assert(h.audios[0].paused);
  });
  await test("late fade cannot stop new instance of same asset", async () => {
    const h = harness(); await h.controller.play("a"); h.controller.stop("a", 500); await h.controller.play("a");
    h.advance(500); assert.deepEqual(h.audios.map(a => a.paused), [true, false]); h.controller.dispose();
  });
  await test("stop cancels pending URL preparation", async () => {
    let resolve; const h = harness(() => new Promise(r => resolve = r));
    const play = h.controller.play("a"); h.controller.stop("a", 500); resolve("a"); await play; assert.equal(h.audios.length, 0);
  });
  await test("targeted stop leaves another pending preparation", async () => {
    const resolves = {}; const h = harness(id => new Promise(r => resolves[id] = r));
    const a = h.controller.play("a"), b = h.controller.play("b"); h.controller.stop("a");
    resolves.a("a"); resolves.b("b"); await Promise.all([a, b]); assert.equal(h.audios.length, 1);
    assert.equal(h.audios[0].src, "b"); h.controller.dispose();
  });
  await test("dispose cancels old asynchronous work and controller can remount", async () => {
    let resolve; const h = harness(() => new Promise(r => resolve = r));
    const play = h.controller.play("old"); h.controller.dispose(); resolve("old"); await play; assert.equal(h.audios.length, 0);
    const fresh = h.controller.play("new"); resolve("new"); await fresh; assert.equal(h.audios.length, 1); h.controller.dispose();
  });
  await test("ended/error dispose resources and errors remain diagnostic", async () => {
    const h = harness(); await h.controller.play("a"); const ended = h.audios[0].onended; ended();
    assert(h.audios[0].paused); await h.controller.play("b"); h.audios[1].onerror();
    assert(h.audios[1].paused); assert.equal(h.errors.length, 1);
  });
  await test("preparation error logged without unhandled rejection", async () => {
    const h = harness(async () => { throw Error("source failed"); }); await h.controller.play("a");
    assert.equal(h.errors.length, 1); assert.equal(h.audios.length, 0);
  });
  for (const assetId of ["", "missing-target"]) await test(`stop ${assetId || "all"} requires no asset bytes`, () => {
    const c = { type: "sfx", action: "stop", sfx_id: assetId, fade_ms: 500 }, s = script([c]);
    assert.equal(api.validateCommandFields(s).length, 0); assert(api.validateRuntimeScript(s).ok);
    assert.equal(api.collectAssetReferencesFromCommand(c).length, 0);
    assert(api.validateAssetReferences(s, { assets: [] }).ok);
    assert.equal(api.runtimeAssetReferences(s, { assets: [] }).length, 0);
  });
  for (const fade of [-1, 60001, 1.5, NaN, Infinity]) await test(`invalid fade ${fade} rejected by both validators`, () => {
    const s = script([{ type: "sfx", action: "stop", sfx_id: "", fade_ms: fade }]);
    assert(api.validateCommandFields(s).some(i => i.code === "sfx_fade_duration"));
    assert(api.validateRuntimeScript(s).errors.some(i => i.code === "sfx_fade_duration"));
  });
  await test("play still requires asset and invalid action rejected", () => {
    assert(api.validateRuntimeScript(script([{ type: "sfx", sfx_id: "" }])).errors.some(i => i.code === "sfx_asset_missing"));
    assert(api.validateCommandFields(script([{ type: "sfx", sfx_id: "a", action: "bad" }])).some(i => i.code === "sfx_action"));
  });
  await test("new capability required only for stop and older runtime rejects manifest", () => {
    assert.equal(api.minimumRuntimeVersionForScript(script([{ type: "sfx", sfx_id: "a" }])), "0.2.0");
    assert.equal(api.minimumRuntimeVersionForScript(script([{ type: "sfx", action: "stop", sfx_id: "" }])), "0.33.0");
    assert(!api.validateVersionCompatibility({ runtime_version: "0.33.0", cartridge_version: "1.0.0" }, "0.32.0").ok);
  });
  await test("event preview describes stop without play label", () => {
    assert.match(api.commandPreview({ type: "sfx", sfx_id: "", action: "stop", fade_ms: 500 }), /停止全部音效.*500/);
  });
  await test("actual engine emits stop/fade then continues to narration", async () => {
    global.window = { setTimeout, clearTimeout, matchMedia: () => ({ matches: false }) };
    const engine = new api.StoryEngine(), events = [];
    engine.onChange = state => { if (state.sfxEvent && !events.some(e => e.id === state.sfxEvent.id)) events.push(state.sfxEvent); };
    engine.loadScript(script([{ type: "sfx", sfx_id: "a" }, { type: "sfx", sfx_id: "", action: "stop", fade_ms: 700 },
      { type: "narration", text: "继续剧情" }]), { game_id: "sfx-stop", assets: [] });
    engine.start();
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 1000;
      const poll = () => events.length === 2 ? resolve() : Date.now() > deadline ? reject(Error("missing engine events")) : setTimeout(poll, 5); poll();
    });
    assert.equal(events[0].action, "play"); assert.equal(events[1].action, "stop"); assert.equal(events[1].fade_ms, 700);
    engine.reset();
  });
  report.status = report.cases.length > 0 && report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = e.stack; }).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); if (report.status !== "PASS") process.exitCode = 1;
});
