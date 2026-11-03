"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("../GameCli_framework/node_modules/esbuild");
const root = path.resolve(__dirname, "..");
const built = buildSync({
  entryPoints: [path.join(root, "GameCli_framework/src/utils/quickSavePolicy.ts")],
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent",
});
const loaded = { exports: {} };
new Function("module", "exports", built.outputFiles[0].text)(loaded, loaded.exports);
const { chooseQuickSaveSlot, latestQuickSave, expiredQuickSaves } = loaded.exports;
const saves = Array.from({ length: 8 }, (_, index) => ({
  save_kind: "quick", slot: index + 1, created_at: new Date(index * 1000).toISOString(),
  save_id: `q${index + 1}`,
}));
assert.deepEqual(chooseQuickSaveSlot(saves.slice(0, 5)), { kind: "quick", slot: 6 });
assert.deepEqual(chooseQuickSaveSlot(saves.slice(0, 6)), { kind: "quick", slot: 1 });
assert.equal(latestQuickSave(saves, save => save.slot !== 8).save_id, "q7");
assert.deepEqual(expiredQuickSaves(saves).map(save => save.slot), [2, 1]);
console.log("quick-save-policy-test: PASS (six retained, oldest reused, newest compatible selected)");
