const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const controls = fs.readFileSync(path.join(root, "editor/src/components/advanced/PreviewWindowControls.tsx"), "utf8");
const previewWindow = fs.readFileSync(path.join(root, "editor/src/preview/previewWindow.ts"), "utf8");
const layoutCss = fs.readFileSync(path.join(root, "editor/src/styles/layout.css"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const token of [
  "gamecli-preview-progress",
  "role=\"progressbar\"",
  "aria-valuenow={progress.percent}",
  "gamecli-preview-log",
  "preview.clear-log",
  "预览日志",
  'logs.length === 0',
  '<li className="is-empty">',
  "确认启动后，这里会显示校验、素材同步与启动日志。",
]) {
  assert(controls.includes(token), `PreviewWindowControls is missing ${token}.`);
}

assert(
  /onProgress\?: \(event: GameCliPreviewProgressEvent\) => void/.test(previewWindow),
  "openGameCliPreview request must expose a progress callback.",
);

assert(
  previewWindow.includes('phase: "upload"') &&
    previewWindow.includes('phase: "launch"') &&
    previewWindow.includes("request.onProgress?."),
  "previewWindow must report upload and launch progress.",
);

const normalizeCss = (value) => value.replace(/\s+/g, "").replace(/::(before|after)\b/g, ":$1");
for (const selector of [
  ".gamecli-preview-progress",
  ".gamecli-preview-progress-track",
  ".gamecli-preview-progress-track span::after",
  "@keyframes gamecli-preview-progress-shimmer",
  ".gamecli-preview-log",
  ".gamecli-preview-log li",
]) {
  assert(normalizeCss(layoutCss).includes(normalizeCss(selector)), `layout.css is missing ${selector}.`);
}

assert(
  /\.gamecli-preview-progress\.is-running \.gamecli-preview-progress-track span::?after\s*{[^}]*animation:\s*gamecli-preview-progress-shimmer/s.test(layoutCss),
  "GameCLI preview progress bar must animate a shimmer while running.",
);

assert(
  /prefers-reduced-motion:\s*reduce[\s\S]*\.gamecli-preview-progress-track span::?after[\s\S]*opacity:\s*0/s.test(layoutCss),
  "GameCLI preview progress shimmer must be disabled for reduced motion.",
);

console.log("GameCLI preview progress UI contract passed.");
