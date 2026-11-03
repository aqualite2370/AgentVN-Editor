const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "editor/src/components/editor/VisualNovelEditor.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "editor/src/styles/layout.css"), "utf8");
for (const token of ["setPointerCapture", "lostpointercapture", '"pointercancel"', 'window.addEventListener("blur"', 'data-testid="preview-splitter"']) {
  if (!source.includes(token)) throw new Error(`分隔条缺少可靠拖动处理：${token}`);
}
if (!css.includes(".is-resizing-preview .embedded-runtime-preview-frame iframe")) throw new Error("拖动期间未屏蔽 iframe 交互");
console.log("preview splitter drag contract: PASS");
