"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, "..");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT;
if (!output) throw Error("Explicit isolated AGENTVN_WORKSPACE_OUTPUT required");
if (fs.existsSync(output) && fs.readdirSync(output).length) throw Error("Do not overwrite prior evidence");
fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", scope: "Project export → StoryEngine presentation inheritance",
  startedAt: new Date().toISOString(), cases: [] };
const bundle = { exports: {} };
new Function("module", "exports", "require", esbuild.buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export { StoryEngine } from "./GameCli_framework/src/engine/StoryEngine";
    export { applyProjectRuntimeSettingsToScript } from "./editor/src/utils/exportScript";
    export { useProjectStore } from "./editor/src/store/projectStore";
    export { minimumRuntimeVersionForScript, runtimeScriptSchemaVersion } from "./shared/cartridge/runtimeCapabilities";
    export { validateVersionCompatibility, validateRuntimeScript } from "./shared/cartridge/validators";
    export { validateRuntimeScript as validatePlayerScript, validateSaveData } from "./GameCli_framework/src/engine/validation";
  ` }, bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(bundle, bundle.exports, require);
const { StoryEngine, applyProjectRuntimeSettingsToScript, useProjectStore,
  minimumRuntimeVersionForScript, runtimeScriptSchemaVersion, validateVersionCompatibility,
  validateRuntimeScript, validatePlayerScript, validateSaveData } = bundle.exports;
global.window = { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} };
try {
  for (const row of [
    { name: "project-default-used-by-unconfigured-speaker", projectMode: "nvl", expected: "nvl" },
    { name: "character-default-wins-over-project", projectMode: "dialog", characterMode: "bubble", expected: "bubble" },
    { name: "explicit-node-wins-over-character", projectMode: "nvl", characterMode: "bubble",
      nodeMode: "dialog", expected: "dialog" },
    { name: "narration-ignores-character-default", projectMode: "nvl", characterMode: "bubble",
      narration: true, expected: "nvl" },
    { name: "legacy-project-stays-dialog", expected: "dialog" },
  ]) {
    const test = { name: row.name, status: "RUNNING" };
    report.cases.push(test);
    try {
      const settings = { ...useProjectStore.getState().settings,
        defaultDialogPresentation: row.projectMode,
        characterDialogPresentations: row.characterMode ? { alice: row.characterMode } : {} };
      const source = {
        schema_version: "1.1.0", game_id: "presentation-inheritance", title: "隔离对白验收",
        entry_scene_id: "main", characters: [{ character_id: "alice", name: "小岚" }],
        scenes: [{ scene_id: "main", title: "场景", summary: "", chapter: 1, tags: [],
          commands: [{ type: row.narration ? "narration" : "dialog", character_id: "alice",
            text: "验证真实继承", ...(row.nodeMode ? { presentation_mode: row.nodeMode } : {}) }] }],
      };
      const script = applyProjectRuntimeSettingsToScript(source, settings);
      // JSON roundtrip exercises the exact representation the player receives.
      const engine = new StoryEngine();
      engine.loadScript(JSON.parse(JSON.stringify(script)), { game_id: script.game_id });
      engine.start();
      assert.equal(engine.createSaveSnapshot().dialog.presentation_mode, row.expected, row.name);
      if (row.projectMode || row.characterMode) {
        assert.equal(minimumRuntimeVersionForScript(script), "0.18.0", "Older engines must not silently ignore inheritance");
        assert.equal(runtimeScriptSchemaVersion(script), "1.10.0", "Declare presentation defaults in script schema");
        assert.equal(validateVersionCompatibility({ runtime_version: minimumRuntimeVersionForScript(script),
          cartridge_version: "1.0.0" }, "0.17.0").ok, false, "Old Runtime rejects new story capabilities");
      }
      test.status = "PASS";
    } catch (error) { test.status = "FAILED"; test.error = String(error.stack || error); }
  }
  {
    const test = { name: "inherited-nvl-accumulation-clear-save-rollback", status: "RUNNING" };
    report.cases.push(test);
    try {
      const script = { schema_version: "1.10.0", game_id: "inherited-nvl", title: "继承NVL",
        entry_scene_id: "main", default_dialog_presentation: "nvl", characters: [
          { character_id: "alice", name: "小岚", dialog_presentation: "nvl" },
        ], scenes: [{ scene_id: "main", title: "场景", commands: [
          { type: "dialog", character_id: "alice", text: "角色继承第一句" },
          { type: "narration", text: "工程继承第二句" },
          { type: "dialog", character_id: "alice", text: "新页", clear_nvl_page_before: true },
          { type: "narration", text: "普通对白", presentation_mode: "dialog" },
        ] }] };
      const engine = new StoryEngine();
      engine.loadScript(script, { game_id: script.game_id });
      engine.start();
      engine.completeTyping(engine.state.dialog.text_key);
      engine.next();
      assert.deepEqual(engine.state.nvlPage.map(line => line.text), ["角色继承第一句", "工程继承第二句"]);
      const saved = structuredClone(engine.createSaveSnapshot());
      engine.completeTyping(engine.state.dialog.text_key);
      engine.next();
      assert.deepEqual(engine.state.nvlPage.map(line => line.text), ["新页"]);
      assert(engine.rollback());
      assert.deepEqual(engine.state.nvlPage.map(line => line.text), ["角色继承第一句", "工程继承第二句"]);
      engine.restoreSaveSnapshot(saved, { autoAdvance: false });
      assert.deepEqual(engine.state.nvlPage.map(line => line.text), ["角色继承第一句", "工程继承第二句"]);
      assert.equal(engine.state.history.length, saved.history.length, "restore must not duplicate inherited NVL history");
      engine.completeTyping(engine.state.dialog.text_key);
      engine.next();
      engine.completeTyping(engine.state.dialog.text_key);
      engine.next();
      assert.equal(engine.state.nvlPage.length, 0, "explicit ordinary dialogue leaves inherited NVL");
      test.status = "PASS";
    } catch (error) { test.status = "FAILED"; test.error = String(error.stack || error); }
  }
  {
    const script = {
      schema_version: "1.10.0", game_id: "bubble-position", title: "气泡坐标", entry_scene_id: "main",
      scenes: [{ scene_id: "main", title: "场景", summary: "", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "固定气泡", presentation_mode: "bubble",
          bubble_position: { mode: "fixed", x: 65, y: 25 } }] }],
    };
    const test = { name: "bubble-position-survives-save-restore-and-validates", status: "RUNNING" };
    report.cases.push(test);
    try {
      const engine = new StoryEngine();
      engine.loadScript(script, { game_id: script.game_id });
      engine.start();
      const saved = JSON.parse(JSON.stringify(engine.createSaveSnapshot()));
      assert.deepEqual(saved.dialog.bubble_position, { mode: "fixed", x: 65, y: 25 });
      engine.restoreSaveSnapshot(saved, { autoAdvance: false });
      assert.deepEqual(engine.createSaveSnapshot().dialog.bubble_position, saved.dialog.bubble_position);
      const legacySave = structuredClone(saved);
      delete legacySave.nvl_presentation_mode;
      engine.restoreSaveSnapshot(legacySave, { autoAdvance: false });
      assert.equal(engine.createSaveSnapshot().nvl_presentation_mode, "bubble",
        "An older save without the redundant mode field must restore the bubble from its dialog");
      const invalid = structuredClone(script);
      invalid.scenes[0].commands[0].bubble_position.x = 101;
      assert(validateRuntimeScript(invalid).errors.some(issue => issue.code === "dialog_bubble_position"));
      assert(validatePlayerScript(invalid).some(issue => issue.code === "dialog_bubble_position"),
        "Player validation must reject the same invalid authored position as cartridge validation");
      assert.equal(validateSaveData(saved).length, 0, "Valid presentation save must remain readable");
      const damagedSave = structuredClone(saved);
      damagedSave.dialog.bubble_position.x = 101;
      assert(validateSaveData(damagedSave).some(issue => issue.code === "dialog_bubble_position"),
        "A damaged saved anchor must not become a readable quick-load candidate");
      test.status = "PASS";
    } catch (error) { test.status = "FAILED"; test.error = String(error.stack || error); }
  }
  assert(report.cases.every(row => row.status === "PASS"), "Presentation inheritance export/runtime contract incomplete");
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED";
  report.error = String(error.stack || error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Evidence: ${output}`);
}
