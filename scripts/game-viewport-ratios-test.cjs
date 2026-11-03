"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), loaded = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export * from "./shared/cartridge/gameViewport";
    export { getDefaultUISkinLayout, validateUISkinLayout } from "./shared/cartridge/uiSkin";
    export { createRenpyUILayout, updateActiveRuntimeUILayout, switchRuntimeUILayoutType } from "./shared/cartridge/uiLayoutProfiles";
    export { minimumRuntimeVersionForLayout } from "./shared/cartridge/runtimeCapabilities";
    export { resolveRenpyQuickBar } from "./shared/cartridge/renpyQuickBar";
    export { validateNoEditorFields, validateVersionCompatibility } from "./shared/cartridge/validators";` },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(loaded, loaded.exports);
const q = loaded.exports, checks = [];
function test(name, run) { run(); checks.push({ name, status: "PASS" }); }
test("legacy aspect and explicit canvas dimensions", () => {
  assert.deepEqual(q.resolveGameViewport(), { aspectRatio: "16:9", width: 1280, height: 720, ratio: 16 / 9 });
  for (const [aspectRatio, height] of [["16:9", 720], ["16:10", 800], ["4:3", 960]])
    assert.equal(q.resolveGameViewport({ aspectRatio }).height, height);
});
test("contain frame, safe-area mapping and docked nine actions at every ratio", () => {
  for (const aspectRatio of ["16:9", "16:10", "4:3"]) {
    const design = q.resolveGameViewport({ aspectRatio });
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160], [2400, 1080]]) {
      const frame = q.fitGameViewport({ width, height }, design);
      assert(Math.abs(frame.width / frame.height - design.ratio) < 1e-8);
      assert(frame.width <= width && frame.height <= height);
      assert.equal(frame.x, (width - frame.width) / 2); assert.equal(frame.y, (height - frame.height) / 2);
      const safe = q.gameFrameSafeInsets(frame, { top: 0, left: 60, right: 24, bottom: 28 });
      assert(safe.left >= 0 && safe.bottom >= 0);
      const bounds = { x: safe.left / frame.width * 100, y: safe.top / frame.height * 100,
        width: 100 - (safe.left + safe.right) / frame.width * 100,
        height: 100 - (safe.top + safe.bottom) / frame.height * 100 };
      const bar = q.resolveRenpyQuickBar(frame, bounds);
      assert(bar.y + bar.height <= frame.height - safe.bottom + 1e-6);
      assert(frame.height - safe.bottom - bar.y - bar.height <= 8 * Math.min(frame.width / 1280, frame.height / 720) + 1);
      assert(bar.x >= safe.left && bar.x + bar.width <= frame.width - safe.right + 1);
    }
  }
});
test("invalid ratios reject saving and exporting rather than silently defaulting", () => {
  for (const viewport of [null, [], {}, { aspectRatio: "1:1" }, { aspectRatio: 16 }, { aspectRatio: "4:3", script: true }]) {
    const layout = { ...q.createRenpyUILayout(), gameViewport: viewport };
    assert(q.validateUISkinLayout(layout).errors.some(issue => issue.code === "ui_viewport"));
  }
  for (const aspectRatio of ["16:9", "16:10", "4:3"]) {
    assert.equal(q.validateUISkinLayout({ ...q.createRenpyUILayout(), gameViewport: { aspectRatio } }).errors.length, 0);
  }
});
test("two profiles persist independent ratios through reopen and active export selection", () => {
  let settings = { runtimeUILayout: q.getDefaultUISkinLayout() };
  settings = q.switchRuntimeUILayoutType(settings, "renpy");
  settings = q.updateActiveRuntimeUILayout(settings, { ...settings.runtimeUILayout, gameViewport: { aspectRatio: "4:3" } });
  const saved = JSON.parse(JSON.stringify(settings));
  const normal = q.switchRuntimeUILayoutType(saved, "agentvn");
  assert.equal(normal.runtimeUILayout.gameViewport, undefined);
  const restored = q.switchRuntimeUILayoutType(normal, "renpy");
  assert.deepEqual(restored.runtimeUILayout.gameViewport, { aspectRatio: "4:3" });
  assert.equal(restored.runtimeUILayout.target_runtime, "0.27.0");
  assert.equal(q.minimumRuntimeVersionForLayout("0.26.0", { ...q.createRenpyUILayout(), gameViewport: { aspectRatio: "16:10" } }), "0.27.0");
  assert.equal(q.minimumRuntimeVersionForLayout("1.0.0", restored.runtimeUILayout), "1.0.0");
});
test("runtime viewport exports without weakening the editor-coordinate privacy boundary", () => {
  assert(q.validateNoEditorFields({ ...q.createRenpyUILayout(), gameViewport: { aspectRatio: "4:3" } }).ok);
  assert(!q.validateNoEditorFields({ viewport: { x: 0, y: 0, zoom: 1 } }).ok);
});
test("existing compatibility gate rejects the new capability on an older Runtime", () => {
  const manifest = { cartridge_version: "1.0.0", runtime_version: "0.27.0" };
  const older = q.validateVersionCompatibility(manifest, "0.26.0");
  assert(!older.ok && older.errors.some(e => e.code === "runtime_version" && e.message.includes("0.27.0")));
  assert(q.validateVersionCompatibility(manifest, "0.27.0").ok);
});
const out = process.argv[2];
if (out) {
  assert(path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\"));
  assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ status: "PASS", checks }, null, 2), { flag: "wx" });
}
console.log(JSON.stringify({ status: "PASS", checks }));
