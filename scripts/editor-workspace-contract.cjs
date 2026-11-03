const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const visualEditor = read("editor/src/components/editor/VisualNovelEditor.tsx");
const toolbar = read("editor/src/components/editor/EditorToolbar.tsx");
const main = read("editor/src/main.tsx");
const shellCss = read("editor/src/styles/editor-shell.css");
const responsiveCss = read("editor/src/styles/editor-responsive.css");
const topbarCss = read("editor/src/styles/editor-topbar.css");
const contracts = read("editor/src/components/workspace/workspaceContracts.ts");

for (const name of [
  "EditorWorkspace",
  "WorkspaceStatusBar",
  "WorkspacePanel",
  "PanelHeader",
  "PanelSection",
  "PanelFooter",
  "StatusBadge",
  "OperationState",
  "EmptyState",
  "ErrorState",
  "ConfirmBar",
]) {
  assert.match(
    name === "EditorWorkspace"
      ? visualEditor
      : name === "WorkspaceStatusBar"
          ? read("editor/src/components/workspace/WorkspaceStatusBar.tsx")
          : read("editor/src/components/workspace/WorkspacePrimitives.tsx"),
    new RegExp(`\\b${name}\\b`),
    `${name} must be part of the editor workspace composition`,
  );
}
assert.match(toolbar, /workspaceBackEventName/);
assert.match(toolbar, /requestBack\("escape"\)/);
assert.match(toolbar, /testId="workspace-surface-nav"/);
assert.match(toolbar, /data-testid="workspace-project-actions"/);
assert.match(toolbar, /data-workspace-surface="edit"/);
assert.match(toolbar, /data-workspace-surface="options"/);
assert.doesNotMatch(toolbar, /data-workspace-surface="assets"/);
assert.match(toolbar, /data-workspace-surface="assistant"/);
assert.match(toolbar, /data-workspace-surface="preview"/);
assert.match(toolbar, /data-workspace-surface="publish"/);
assert.match(contracts, /requestSave/);
assert.match(contracts, /requestGeneration/);
assert.match(main, /editor-shell\.css/);
assert.match(shellCss, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
assert.match(topbarCss, /\.toolbar-project-group \[data-help-key="toolbar\.importProject"\]/);
assert.match(topbarCss, /\.toolbar-right \.toolbar-tool-container \{\s*display:\s*none/);
assert.match(visualEditor, /<PreviewPanel/);
assert.match(visualEditor, /onPointerDown=\{resizePreview\}/);
assert.match(shellCss, /var\(--inspector-width/);
assert.doesNotMatch(shellCss, /\.is-preview-surface/);
assert.match(responsiveCss, /grid-template-rows:\s*auto minmax\(300px, 1fr\)/);
assert.match(shellCss, /prefers-reduced-motion/);
console.log("PASS editor workspace composition and interaction contract");
