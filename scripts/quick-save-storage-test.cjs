"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/quick-save-storage", runId);
const api = { exports: {} };
const bundle = require("../GameCli_framework/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export * from "./GameCli_framework/src/engine/desktopSaveManager";
    export { validateSaveData } from "./GameCli_framework/src/engine/validation";
  ` },
  bundle: true, platform: "node", format: "cjs", write: false,
  define: { "import.meta.env": "{}" }, logLevel: "silent",
});
new Function("module", "exports", "require", bundle.outputFiles[0].text)(api, api.exports, require);
const values = new Map();
let failWrites = false;
global.window = {
  location: { search: "" },
  localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error("controlled quota failure");
      values.set(key, value);
    },
  },
};
window.parent = window;
const save = (kind, id) => ({
  save_kind: kind, save_id: id, game_id: "quick-test", slot: 1,
  scene_id: "scene", command_index: 0, created_at: "2026-10-02T00:00:00.000Z",
  variables: {}, history: [], sprites: {}, unlocked_gallery: [], playtime_seconds: 0,
});
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const report = { runId, status: "RUNNING" };
  try {
    const { writeDesktopSave, readDesktopSave, listDesktopSaves, deleteDesktopSave, validateSaveData } = api.exports;
    await writeDesktopSave("quick-test", { kind: "manual", slot: 1 }, save("manual", "manual-1"));
    await writeDesktopSave("quick-test", { kind: "auto", slot: 1 }, save("auto", "auto-1"));
    await writeDesktopSave("quick-test", { kind: "quick", slot: 1 }, save("quick", "quick-1"));
    const quick = await readDesktopSave("quick-test", { kind: "quick", slot: 1 });
    assert.equal(quick?.save_kind, "quick", "快存必须独立读取，不能被归一化为手动档");
    assert.equal(quick.save_id, "quick-1");
    assert.equal((await readDesktopSave("quick-test", { kind: "manual", slot: 1 })).save_id, "manual-1");
    assert.equal((await readDesktopSave("quick-test", { kind: "auto", slot: 1 })).save_id, "auto-1");
    assert.equal((await listDesktopSaves("quick-test")).length, 3, "相同槽号的三个分类必须共存");
    assert.deepEqual(validateSaveData(quick), [], "快存必须通过正式存档校验");
    failWrites = true;
    await assert.rejects(
      writeDesktopSave("quick-test", { kind: "quick", slot: 1 }, save("quick", "replacement")),
      /controlled quota failure/,
    );
    failWrites = false;
    assert.equal((await readDesktopSave("quick-test", { kind: "quick", slot: 1 })).save_id,
      "quick-1", "写入失败必须保留原快存");
    const legacy = save(undefined, "legacy-manual");
    values.set("agentvn.gamecli.saves.legacy", JSON.stringify([legacy]));
    assert.equal((await readDesktopSave("legacy", { kind: "manual", slot: 1 })).save_id,
      "legacy-manual", "旧版无分类存档仍可按手动档读取");
    await deleteDesktopSave("quick-test", { kind: "quick", slot: 1 });
    assert.equal((await listDesktopSaves("quick-test")).length, 2, "删除快存不得删除其他分类");
    report.status = "PASS";
    report.cases = ["category-isolation", "validation", "failed-write-preservation", "legacy-manual", "independent-deletion"];
    console.log("PASS independent categories, failed-write preservation, legacy reading and deletion");
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
})();
