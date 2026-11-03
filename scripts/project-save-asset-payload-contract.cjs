const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const toolbar = fs.readFileSync(path.join(root, "editor/src/components/editor/EditorToolbar.tsx"), "utf8");
const resultDialog = fs.readFileSync(path.join(root, "editor/src/components/common/OperationResultDialog.tsx"), "utf8");
const projectBundle = fs.readFileSync(path.join(root, "editor/src/utils/projectBundle.ts"), "utf8");
const tauri = fs.readFileSync(path.join(root, "editor/src-tauri/src/main.rs"), "utf8");

if (/function downloadJson\(filename: string, value: unknown\)/.test(toolbar)) {
  throw new Error("保存工程不得保留把 .vnproj 当普通 JSON 下载的旧实现。");
}

if (!toolbar.includes("工程已保存到：") || !toolbar.includes("下载目录由浏览器控制")) {
  throw new Error("保存成功提示必须反映原生实际路径或浏览器下载行为。");
}
for (const token of [
  "<OperationResultDialog",
  "projectSaveConfirmationOpen",
  'surfaceTone="accent"',
  'testId="project-save-confirmation"',
  "project-save-confirm-close",
  "project-save-confirm-ok",
]) {
  if (!`${toolbar}\n${resultDialog}`.includes(token)) throw new Error(`保存成功对话框缺少交互契约：${token}`);
}
if (/project-save-confirm-backdrop[\s\S]{0,800}onMouseDown=\{closeDialog\}/.test(resultDialog)) {
  throw new Error("保存成功对话框不应通过点击遮罩关闭。");
}
for (const token of [
  'data-toolbar-popover-keepopen="true"',
  'event.key === "Escape"',
  "focusableElements",
  "returnFocusRef",
]) {
  if (!resultDialog.includes(token)) throw new Error(`通用结果弹窗缺少可访问性交互：${token}`);
}

const layout = fs.readFileSync(path.join(root, "editor/src/styles/layout.css"), "utf8");
for (const token of [
  "@keyframes project-save-confirm-backdrop-in",
  "@keyframes project-save-confirm-backdrop-out",
  "@keyframes project-save-confirm-dialog-in",
  "@keyframes project-save-confirm-dialog-out",
  ".project-save-confirm-backdrop.is-closing",
  ".project-save-confirm-dialog.is-closing",
]) {
  if (!layout.includes(token)) throw new Error(`保存成功对话框缺少动效契约：${token}`);
}

if (!toolbar.includes("buildProjectBundle")) {
  throw new Error("Manual .vnproj export must use the portable ZIP bundle writer.");
}
for (const token of [
  "JSZip",
  "project.json",
  "format.json",
  "hash_sha256",
  "begin_project_bundle_asset_upload",
  "append_project_bundle_asset_chunk",
  "compression: \"STORE\"",
]) {
  if (!projectBundle.includes(token)) throw new Error(`Portable project ZIP bundle is missing: ${token}`);
}
for (const token of [
  "write_project_bundle",
  "ZipWriter",
  "large_file(true)",
  "download_dir",
  "MOVEFILE_REPLACE_EXISTING",
]) {
  if (!tauri.includes(token)) throw new Error(`Native project bundle writer is missing: ${token}`);
}
if (!/filePath:\s*undefined/.test(projectBundle) || !/backend_asset_path:\s*undefined/.test(projectBundle)) {
  throw new Error("Portable project export must remove machine-specific asset paths.");
}

console.log("project-save-asset-payload-contract: PASS");
