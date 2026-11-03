"use strict";
// Source knowledge/retrieval only: never reads user settings or calls a model.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), out = process.argv[2];
assert(out && !fs.existsSync(out), "Use independent evidence");
fs.mkdirSync(out, { recursive: true });
const mod = { exports: {} };
const bundle = buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
export * from "./editor/src/assistant/retrieval";
export * from "./editor/src/assistant/agentvnDocIndex.generated";` },
  bundle: true, platform: "node", format: "cjs", write: false });
new Function("module", "exports", "require", bundle.outputFiles[0].text)(mod, mod.exports, require);
const api = mod.exports, report = { status: "RUNNING", scope: "SOURCE_KNOWLEDGE_NO_MODEL", cases: [] };
function check(name, fn) {
  const item = { name, status: "RUNNING" }; report.cases.push(item);
  try { fn(item); item.status = "PASS"; } catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); }
}
for (const [topic, questions] of Object.entries({
  "layout-background": ["我想给Ren'Py样式里的按钮容器换一张背景图片应该在哪里操作？",
    "如何修改进阶布局的控件底图并让图片完整显示", "renpy button background image"],
  "layout-code": ["普通模式和进阶模式有什么区别，取消勾选会删除HTML和CSS吗？",
    "高级代码覆盖与图形属性冲突时该怎么修改", "Ren’Py HTML CSS code override"],
  "gui-pack": ["我下载的renpy资源包应该怎么导入和应用到当前控件？",
    "导入GUI模板为什么还没有改变我的工程界面", "GUI package library revision"],
  "components": ["组件如何导出为zip给别人，又如何导入个人库？"],
  "project-save": ["如何让每个工程保存vnproj到不同目录？"],
  "game-export": ["我要导出Windows安装游戏和安卓APK，先去哪里检查环境？"],
  "ai-modes": ["创造模式是否能够直接改写工程文件，问询有没有写入工具？"],
  "novel": ["小说解析任务最小化后还会运行吗，如何查看导入结果？"],
  "dialogue": ["NVL和气泡对白如何选择继承模式并保存回滚？"],
  "hide-ui": ["游玩中如何隐藏全部界面看画面，点击恢复会推进剧情吗？"],
})) for (const question of questions) check(`${topic}: ${question}`, item => {
  const hits = api.retrieveAssistantDocs(question, 4);
  item.ids = hits.map(chunk => chunk.id);
  assert(hits.some(chunk => chunk.id.startsWith(`guide-${topic}-`)), JSON.stringify(item.ids));
});
check("no-evidence-query-does-not-default-to-random-documents", () => {
  assert.deepEqual(api.retrieveAssistantDocs("zxqv983742"), []);
  assert.deepEqual(api.retrieveAssistantDocs(""), []);
  assert.deepEqual(api.retrieveAssistantDocs("背景图", 0), []);
});
for (const [name, question, primary, forbidden] of [
  ["control-background", "我想给Ren'Py样式里的按钮容器换一张背景图片应该在哪里操作？",
    "guide-layout-background-", ["help-settings.editorAppearance.", "help-animation.", "guide-novel-"]],
  ["advanced-code", "进阶HTML和CSS如何编辑，关闭勾选后代码是否保留？",
    "guide-layout-code-", ["guide-novel-", "guide-project-save-", "help-animation."]],
  ["gui-scope", "GUI资源包如何入库，再仅应用到一个控件？",
    "guide-gui-pack-", ["guide-novel-", "guide-project-save-", "help-animation."]],
  ["player-aspect", "玩家如何在游戏里调整16比10画面比例，重启后还会保留吗？",
    "guide-game-aspect-", ["guide-novel-", "help-animation.", "help-settings.editorAppearance."]],
]) check(`relevance-${name}-does-not-fill-twelve-slots-with-unrelated-sources`, item => {
  const hits = api.retrieveAssistantDocs(question, 12);
  item.ids = hits.map(chunk => chunk.id);
  assert(hits[0]?.id.startsWith(primary), JSON.stringify(item.ids));
  assert(hits.length > 0 && hits.length < 12, "The limit is a ceiling, not a quota");
  for (const prefix of forbidden)
    assert(!hits.some(chunk => chunk.id.startsWith(prefix)), `${prefix}: ${JSON.stringify(item.ids)}`);
});
check("editor-canvas-question-still-finds-editor-canvas-not-game-control-guide", item => {
  const hits = api.retrieveAssistantDocs("如何更换编辑器画布的背景图片？", 6);
  item.ids = hits.map(chunk => chunk.id);
  assert(hits[0]?.id.startsWith("help-settings.editorAppearance."), JSON.stringify(item.ids));
});
check("gui-application-retrieves-the-dialog-selection-workflow-not-canvas-selection", item => {
  const question = "GUI资源包入库后只给一个按钮的悬停状态设置背景图，应该在哪里选择目标？";
  const hits = api.retrieveAssistantDocs(question, 12);
  item.ids = hits.map(chunk => chunk.id);
  const guide = hits.filter(chunk => chunk.id.startsWith("guide-gui-pack-")).map(chunk => chunk.text).join("");
  assert(guide, "The actual retrieved payload must include the application guide");
  const workbench = fs.readFileSync(path.join(root,
    "editor/src/components/advanced/RenpyGuiImportWorkbench.tsx"), "utf8");
  for (const name of ["资源包应用范围", "目标页面", "目标控件", "目标控件状态"]) {
    assert(workbench.includes(`ariaLabel="${name}"`), `Real UI no longer exposes ${name}; review its instructions`);
    assert(guide.includes(`“${name}”`), `Retrieved application guide omits the actual selector: ${name}`);
  }
  assert(guide.includes("应用对话框"), "Do not substitute canvas picking for the dialog's own selectors");
  assert(guide.includes("“当前控件背景”") && guide.includes("“确认应用到当前工程”"));
  item.actualDialogSelectors = ["资源包应用范围", "目标页面", "目标控件", "目标控件状态"];
  item.scope = "RETRIEVED_SOURCE_INSTRUCTIONS_NOT_REAL_MODEL_QUALITY";
});
check("index-covers-real-controls-and-has-source-freshness-manifest", () => {
  assert(api.agentvnDocIndex.length > 100, "Four stale summaries are not a project knowledge base");
  assert(api.agentvnDocIndexMetadata?.sources.length > 20);
  const { hoverHelpCatalog } = (() => {
    const loaded = { exports: {} }, code = buildSync({
      entryPoints: [path.join(root, "editor/src/components/common/hoverHelpCatalog.ts")],
      bundle: true, platform: "node", format: "cjs", write: false,
    }).outputFiles[0].text;
    new Function("module", "exports", "require", code)(loaded, loaded.exports, require);
    return loaded.exports;
  })();
  for (const key of Object.keys(hoverHelpCatalog))
    assert(api.agentvnDocIndex.some(chunk => chunk.tags.includes(key)), `Missing real help entry: ${key}`);
});
report.status = report.cases.every(item => item.status === "PASS") ? "PASS" : "FAILED";
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
  failures: report.cases.filter(item => item.status === "FAILED").map(item => ({ name: item.name, error: item.error })), out }));
if (report.status !== "PASS") process.exitCode = 1;
