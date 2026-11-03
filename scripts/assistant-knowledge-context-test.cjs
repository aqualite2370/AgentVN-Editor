"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), out = process.argv[2];
assert(out && !fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const mod = { exports: {} };
const code = buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
export * from "./editor/src/assistant/layoutHelpContext";
export * from "./editor/src/assistant/knowledgeNavigation";
export * from "./editor/src/assistant/agentvnDocIndex.generated";` },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
new Function("module", "exports", "require", code)(mod, mod.exports, require);
const api = mod.exports, cases = [];
function check(name, fn) {
  const item = { name, status: "RUNNING" }; cases.push(item);
  try { fn(); item.status = "PASS"; } catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); }
}
const read = (project, type) => JSON.parse(api.readLayoutHelpContext(project, type));
check("selection-is-read-only-and-discards-nonauthorized-fields", () => {
  api.recordLayoutHelpSelection("project-A", { layoutType: "renpy", screenId: "title",
    componentId: "title_start_button", advanced: true, story: "PRIVATE_STORY", apiKey: "SECRET" });
  const value = read("project-A", "renpy");
  assert.deepEqual(value, { mode: "inquiry", access: "read-only",
    knowledgeStatus: "source-capabilities-not-acceptance-proof",
    layoutType: "renpy", screenId: "title", componentId: "title_start_button", advanced: true });
});
check("another-project-cannot-read-prior-selection", () => {
  assert.deepEqual(read("project-B", "agentvn"), { mode: "inquiry", access: "read-only",
    knowledgeStatus: "source-capabilities-not-acceptance-proof",
    layoutType: "agentvn", screenId: "player", advanced: false });
});
check("layout-switch-does-not-expose-the-other-types-stale-selection", () => {
  const value = read("project-A", "agentvn");
  assert.equal(value.layoutType, "agentvn");
  assert.equal(value.screenId, "player");
  assert(!value.componentId);
});
check("only-known-operation-guides-resolve-to-local-navigation", () => {
  const guide = api.agentvnDocIndex.find(c => c.id.startsWith("guide-layout-background-"));
  assert.deepEqual(api.assistantKnowledgeDestination(guide.id), { tab: "layout", label: "游戏客户端" });
  const aspect = api.agentvnDocIndex.find(c => c.id.startsWith("guide-game-aspect-"));
  assert.deepEqual(api.assistantKnowledgeDestination(aspect.id), { tab: "layout", label: "游戏客户端" });
  for (const id of ["guide-layout-background-made-up", "__proto__", "https://example.test/",
    "javascript:alert(1)", api.agentvnDocIndex.find(c => c.tags.includes("reference")).id])
    assert.equal(api.assistantKnowledgeDestination(id), undefined);
});
const status = cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
  status, scope: "SOURCE_READ_ONLY_CONTEXT_AND_LOCAL_NAVIGATION_NO_MODEL", cases }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status, cases: cases.length, failures: cases.filter(c => c.status !== "PASS"), out }));
if (status !== "PASS") process.exitCode = 1;
