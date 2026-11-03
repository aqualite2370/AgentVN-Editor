const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");
const ts = require("../editor/node_modules/typescript");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function compileTs(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const testModule = new Module(filename, module);
  testModule.filename = filename;
  testModule.paths = Module._nodeModulePaths(path.dirname(filename));
  testModule._compile(compiled, filename);
  return testModule.exports;
}

const choiceEditor = read("editor/src/components/command-editors/ChoiceCommandEditor.tsx");
assert.match(choiceEditor, /choice_display_name:\s*null/, "new choice must not store a display-name placeholder");
assert.match(choiceEditor, /text:\s*""/, "new choice must not store a text placeholder");
assert.doesNotMatch(choiceEditor, /choice_display_name:\s*"新分支"/, "new branch placeholder must not be stored");
assert.doesNotMatch(choiceEditor, /text:\s*"新选项"/, "new choice placeholder must not be stored");

const choiceNode = read("editor/src/components/nodes/ChoiceNode.tsx");
assert.match(choiceNode, /isChoiceTextPlaceholder/, "choice node must render placeholder state");
assert.match(choiceNode, /choiceEditorDisplayText/, "choice node must use editor display helper");

const { choiceEditorDisplayText, isChoiceTextPlaceholder, choiceRuntimeText, EMPTY_CHOICE_TEXT_HINT } = compileTs("editor/src/utils/choiceText.ts");
assert.equal(choiceEditorDisplayText({ choice_id: "c1", choice_display_name: null, text: "" }), EMPTY_CHOICE_TEXT_HINT);
assert.equal(isChoiceTextPlaceholder({ choice_display_name: null, text: "" }), true);
assert.equal(choiceRuntimeText({ choice_display_name: "调查窗边", text: "" }, 0), "调查窗边");
assert.equal(choiceRuntimeText({ choice_display_name: null, text: "" }, 1), "选项 2");
assert.equal(choiceRuntimeText({ choice_display_name: "备用", text: "继续前进" }, 0), "继续前进");

const exportScript = read("editor/src/utils/exportScript.ts");
assert.match(exportScript, /choiceRuntimeText\(choice, index\)/, "exportScript must clean empty choice text at runtime boundary");

const preflightSource = read("editor/src/cartridge/preflight.ts");
const preflightPanelSource = read("editor/src/cartridge/ExportCartridgePanel.tsx");
const assetAuditSource = read("editor/src/utils/assetAudit.ts");
assert.match(preflightSource, /solution: string/, "preflight issues must carry a structured solution");
assert.match(preflightSource, /预检问题缺少中文解决方案/, "missing preflight issue solutions must fail loudly");
assert.match(preflightPanelSource, /解决方案：/, "preflight UI must render the solution below every issue");
const issueCodes = [...preflightSource.matchAll(/issue\(\s*(?:"[^"]+",\s*){2}"([a-z0-9_]+)"/g)].map((match) => match[1]);
const solutionBlock = preflightSource.slice(preflightSource.indexOf("const issueSolutions"), preflightSource.indexOf("export function normalizeGameId"));
const solutionCodes = new Set([...solutionBlock.matchAll(/\n\s*([a-z0-9_]+):\s*"/g)].map((match) => match[1]));
const missingSolutions = [...new Set(issueCodes)].filter((code) => !solutionCodes.has(code));
assert.deepEqual(missingSolutions, [], "every preflight issue code must have a Chinese solution");
assert.match(assetAuditSource, /nodeLabel\?: string/, "visual asset audit accepts node/card labels");
assert.match(assetAuditSource, /command_index/, "visual asset audit records command indexes for missing materials");
assert.match(assetAuditSource, /field: "sprite_id"/, "sprite readiness issues point to sprite_id fields");
assert.match(assetAuditSource, /field: "portrait"/, "portrait readiness issues point to dialog portrait fields");
assert.match(preflightSource, /pendingVisualAssetLocation/, "preflight uses detailed visual asset locations");
assert.match(preflightSource, /missing_background_scenes\.flatMap/, "preflight reports each missing background item with its own locator");

const { collectEditorAssetReferences } = compileTs("editor/src/utils/editorAssetReferences.ts");
const node = {
  id: "node_opening",
  data: {
    nodeKind: "scene",
    label: "开场卡片",
    scene: {
      scene_id: "scene_opening",
      scene_display_name: "夜王森林",
      title: "旧林入口",
      commands: [
        { type: "background", background_id: "missing_bg" },
        { type: "dialog", character_id: "hero", text: "谁在那里？", portrait: "missing_portrait", voice: "missing_voice", font_asset_id: "missing_font" },
        { type: "sprite", character_id: "hero", sprite_id: "missing_sprite", visible: true },
        { type: "show_image", image_id: "missing_clue" },
        { type: "bgm", bgm_id: "missing_bgm", action: "play" },
        { type: "sfx", sfx_id: "missing_sfx" },
      ],
    },
  },
};
const refs = collectEditorAssetReferences([node]);
for (const assetId of ["missing_bg", "missing_portrait", "missing_voice", "missing_font", "missing_sprite", "missing_clue", "missing_bgm", "missing_sfx"]) {
  const ref = refs.find((item) => item.asset_id === assetId);
  assert.ok(ref, `missing reference collected for ${assetId}`);
  assert.match(ref.source, /场景「夜王森林」/, `${assetId} source includes scene title`);
  assert.match(ref.source, /节点「开场卡片」/, `${assetId} source includes node label`);
  assert.match(ref.source, /第 \d+ 条/, `${assetId} source includes command index`);
}
assert.match(refs.find((item) => item.asset_id === "missing_bg").source, /background\.background_id/);
assert.match(refs.find((item) => item.asset_id === "missing_voice").source, /dialog\.voice/);

const storeSource = read("editor/src/store/novelImportStore.ts");
assert.match(storeSource, /createFullDocumentProcessingChapter/, "store must create a synthetic full-document chapter");
assert.match(storeSource, /synthetic_full_document/, "synthetic full-document chapter must be marked in metadata");
assert.match(storeSource, /existingChapters\.length === 0 && chapters\.length === 1/, "empty chapter selection should auto-select synthetic full-document chapter only");

const workbenchAdapter = read("editor/src/novel-import/novelProcessJobAdapter.ts");
assert.match(workbenchAdapter, /\?\? processing\.jobs\[processing\.jobs\.length - 1\]/, "stale activeJobId must fall back to latest local job");

const sharedTypes = read("shared/cartridge/types.ts");
const gameTypes = read("GameCli_framework/src/types/commands.ts");
const choicePanel = read("GameCli_framework/src/components/player/ChoicePanel.tsx");
assert.match(sharedTypes, /choice_display_name\?: string \| null/, "shared runtime choice type accepts display-name fallback");
assert.match(gameTypes, /choice_display_name\?: string \| null/, "GameCLI choice type accepts display-name fallback");
assert.match(choicePanel, /choice_display_name\?\.trim\(\)/, "GameCLI choice panel uses display-name fallback");

console.log("小说导入、发布预检和选项文本契约测试：通过");
