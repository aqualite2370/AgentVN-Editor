"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `export { parseCustomComponentMarkup } from "./editor/src/renpy/customComponentMarkup";`,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(
  loaded,
  loaded.exports,
  requireEditor,
);

const safe = loaded.exports.parseCustomComponentMarkup(
    `<div class="root"><span class="title" data-bind="project.title">Game</span>
    <button type="button" class="button" aria-label="打开存档" data-action="open_save_load">Save</button></div>`,
  `.root { display: flex; gap: 12px; padding: 16px; }
   .title { color: #f6f8ff; font-size: 20px; }
   .button:hover { background-color: #304050; }`,
);
assert.equal(safe.ok, true, "安全子集的 HTML/CSS 应转换为结构化组件");
assert.deepEqual(safe.component.root.children.map((node) => node.tag), ["span", "button"]);
assert.equal(safe.component.root.children[0].binding, "project.title");
assert.equal(safe.component.root.children[1].action, "open_save_load");
assert.equal(safe.component.root.children[1].ariaLabel, "打开存档");
assert.equal(safe.component.styles[".root"].display, "flex");
assert.equal(safe.component.styles[".button:hover"]["background-color"], "#304050");

const safeAsset = loaded.exports.parseCustomComponentMarkup(
  `<div class="root"><img class="icon" data-asset="logo" aria-label="品牌图标" /></div>`,
  `.icon { width: 32px; height: 32px; object-fit: contain; }`,
);
assert.equal(safeAsset.ok, true, "声明式素材节点应可解析为安全结构");
assert.equal(safeAsset.component.root.children[0].tag, "img");
assert.equal(safeAsset.component.root.children[0].assetId, "logo");

for (const [html, css, label] of [
  [`<div class="root"><script>alert(1)</script></div>`, "", "script 标签"],
  [`<button class="button" onclick="alert(1)">点我</button>`, "", "事件属性"],
  [`<img src="file:///secret">`, "", "任意资源地址"],
  [`<div class="root"><img data-asset="../secret" /></div>`, "", "越界素材编号"],
  [`<button data-action="open_secret">x</button>`, "", "非白名单动作"],
  [`<button class="button">无操作按钮</button>`, "", "缺少安全动作的按钮"],
  [`<span data-action="open_save_load">越权动作</span>`, "", "非按钮动作绑定"],
  [`<span data-bind="api_key">x</span>`, "", "敏感或未知绑定"],
  [`<div class="root"></div>`, `.root { background-image: url(https://x); }`, "CSS URL"],
  [`<div class="root"></div>`, `@import "https://x";`, "CSS at-rule"],
  [`<div class="root"></div>`, `.root { position: fixed; }`, "未支持属性"],
  [`<div class="root"></div>`, `.root { color: expression(alert(1)); }`, "可执行 CSS 表达式"],
  [`<div class="root"><span></div>`, "", "不匹配标签"],
]) {
  const result = loaded.exports.parseCustomComponentMarkup(html, css);
  assert.equal(result.ok, false, `${label}必须拒绝`);
  assert(result.issues.length > 0, `${label}必须返回可展示的问题说明`);
}

const duplicateBinding = loaded.exports.parseCustomComponentMarkup(
  `<div class="root"><span data-bind="project.title"></span><span data-bind="project.title"></span></div>`,
  "",
);
assert.equal(duplicateBinding.ok, true, "重复安全字段绑定允许存在于不同结构节点");
console.log("custom-component-markup-test: PASS");
