"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `export {
      buildAssistantCreationAuthorization,
      parseAssistantCreationDraftValue,
      parseAssistantCreationDraftBatchValue,
    } from "./editor/src/assistant/creationAgent";`,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(
  loaded, loaded.exports, requireEditor,
);
const {
  buildAssistantCreationAuthorization,
  parseAssistantCreationDraftValue,
  parseAssistantCreationDraftBatchValue,
} = loaded.exports;

const approvedAsset = {
  id: "library-image-1",
  filename: "角色徽章.png",
  mimeType: "image/png",
  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
};
const component = {
  name: "带图标的标题卡",
  description: "只引用用户选入本会话的组件素材。",
  html: '<div class="root"><img class="icon" data-asset="library-image-1" aria-label="徽章" /></div>',
  css: ".root { display: flex; } .icon { width: 24px; height: 24px; }",
};

const approved = parseAssistantCreationDraftValue(component, "2026-10-03T00:00:00.000Z", {
  authorizedAssets: [approvedAsset],
});
assert.equal(approved.ok, true, `明确授权的素材应可进入隔离草稿：${approved.issues.join(" ")}`);
assert.equal(approved.draft.definition.root.children[0].assetId, approvedAsset.id);
assert.equal(approved.draft.assets.length, 1, "草稿应只带入被授权素材的本地副本");
assert.deepEqual([...approved.draft.assets[0].bytes], [...approvedAsset.bytes]);
assert.notEqual(approved.draft.assets[0].bytes, approvedAsset.bytes, "草稿不得持有个人库素材的可变字节引用");

const denied = parseAssistantCreationDraftValue(component, "2026-10-03T00:00:00.000Z", {
  authorizedAssets: [],
});
assert.equal(denied.ok, false, "未选入当前会话的组件素材必须被拒绝");
assert.match(denied.issues.join(" "), /未授权|未选入/);

const forged = parseAssistantCreationDraftValue({
  ...component,
  html: component.html.replace(approvedAsset.id, "another-library-image"),
}, "2026-10-03T00:00:00.000Z", {
  authorizedAssets: [approvedAsset],
});
assert.equal(forged.ok, false, "一个获准素材不能授权模型引用其他素材编号");
assert.match(forged.issues.join(" "), /未授权|未选入/);

const batch = parseAssistantCreationDraftBatchValue({
  components: [
    component,
    {
      name: "纯文字标记",
      description: "不引用额外素材",
      html: '<div class="root"><span>新内容</span></div>',
      css: "",
    },
  ],
}, "2026-10-03T00:00:00.000Z", { authorizedAssets: [approvedAsset] });
assert.equal(batch.ok, true, `每个候选都应独立经过安全结构和授权素材校验：${batch.issues.join(" ")}`);
assert.equal(batch.drafts.length, 2);
assert.deepEqual(batch.drafts[0].assets.map(asset => asset.id), [approvedAsset.id]);
assert.equal(batch.drafts[1].assets?.length ?? 0, 0,
  "某个候选获准的素材不能无条件复制到其它候选草稿");
const invalidBatch = parseAssistantCreationDraftBatchValue({
  components: [component, { ...component, html: '<div class="root"><script>unsafe</script></div>' }],
}, "2026-10-03T00:00:00.000Z", { authorizedAssets: [approvedAsset] });
assert.equal(invalidBatch.ok, false, "集合中有一个非法候选时必须拒绝整批，不能静默丢弃问题项");
assert.equal(invalidBatch.drafts, undefined);

const authorization = buildAssistantCreationAuthorization([
  {
    id: "private-personal-id",
    name: "徽章组件",
    description: "用户选中的图片组件",
    html: '<div class="root"><img data-asset="preview" /></div>',
    css: ".root { display: flex; }",
    assets: [{ ...approvedAsset, id: "preview" }],
  },
  {
    id: "another-private-id",
    name: "空组件",
    description: "",
    html: '<div class="root"><span>安全</span></div>',
    css: "",
    assets: [],
  },
]);
assert.equal(authorization.components.length, 2);
assert.equal(authorization.components[0].html.includes('data-asset="preview"'), false,
  "发给 Agent 的引用应使用本次授权命名空间，避免跨组件素材编号碰撞");
assert.match(authorization.components[0].html, /data-asset="selected-1-preview"/);
assert.deepEqual(authorization.components[0].assets, [{
  id: "selected-1-preview",
  filename: approvedAsset.filename,
  mime_type: approvedAsset.mimeType,
}]);
assert.equal(Object.hasOwn(authorization.components[0].assets[0], "bytes"), false,
  "图片字节不得发送给后端或模型");
assert.equal(authorization.authorizedAssets[0].id, "selected-1-preview");
assert.deepEqual([...authorization.authorizedAssets[0].bytes], [...approvedAsset.bytes]);
assert.equal(authorization.components[0].id, "selected-1",
  "Agent 不需要获知个人库内部组件 ID");

console.log("assistant-creation-resource-authorization-test: PASS");
