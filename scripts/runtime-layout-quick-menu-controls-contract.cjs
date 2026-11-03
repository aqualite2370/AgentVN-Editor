#!/usr/bin/env node
"use strict";
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const src=fs.readFileSync(path.join(root,"editor/src/components/advanced/RuntimeLayoutDesigner.tsx"),"utf8");
const css=fs.readFileSync(path.join(root,"editor/src/styles/layout.css"),"utf8");

assert.match(src,/const quickMenuPreviewVariant = "C" as const/,"quick-menu preview must be fixed to C");
assert.match(src,/data-preview-quick-menu-variant=\{screenId === "player" \? "C" : undefined\}/,"preview root must expose fixed C variant");
assert.match(src,/className="preview-quick-menu-preview preview-quick-menu-preview-c"/,"preview must render the C drawer");
assert.match(src,/data-preview-quick-menu-state=\{screenId === "player" \? \(quickMenuExpanded \? "expanded" : "collapsed"\)/,"preview must expose collapsed/expanded state");
assert.match(src,/data-testid="quick-menu-fixed-note"/,"fixed quick-menu note must remain visible in the inspector");
assert.match(src,/位置、尺寸、锚点和展开方向由游戏客户端统一管理/,"fixed quick-menu note must explain the editing boundary");
assert.doesNotMatch(src,/quickMenuVariant\??:\s*"A"\s*\|\s*"C"/,"quick-menu adapters must not accept the removed A variant");
assert.doesNotMatch(src,/setQuickMenuPreviewVariant|列表样式|抽屉样式/,"removed variant controls must not return");
assert.match(src,/setQuickMenuPreviewExpanded\(false\)/);
assert.match(src,/setQuickMenuPreviewExpanded\(true\)/);
assert.match(css,/runtime-quick-menu-preview-controls[\s\S]{0,600}min-height:\s*(?:3|4|5)\dpx/,"preview controls must be compact");
assert.match(
  fs.readFileSync(path.join(root,"editor/src/styles/quick-menu-preview.css"),"utf8"),
  /\.runtime-layout-expected-preview\[data-preview-quick-menu-state="expanded"\][\s\S]{0,180}pointer-events:\s*auto\s*!important/,
  "expanded preview action layer must accept pointer input",
);
console.log("runtime-layout-quick-menu-controls-contract: PASS");
