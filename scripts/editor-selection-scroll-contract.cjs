const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const failures = [];

const assetPicker = read("editor", "src", "components", "common", "AssetPicker.tsx");
const animationEditor = read("editor", "src", "components", "advanced", "AnimationEditorPanel.tsx");
const previewPanel = read("editor", "src", "components", "editor", "PreviewPanel.tsx");
const rollbackEditor = read("editor", "src", "components", "command-editors", "RollbackCommandEditor.tsx");
const projectSettings = read("editor", "src", "components", "advanced", "ProjectSettingsPanel.tsx");
const layout = read("editor", "src", "styles", "layout.css");

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}

requireMatch(
  assetPicker,
  /className="asset-picker-list selection-scroll-region"/,
  "Asset picker cards must use the shared selection scrollbar.",
);
requireMatch(
  assetPicker,
  /onFocus=\{\(event\) => event\.currentTarget\.scrollIntoView\(\{ block: "nearest" \}\)\}/,
  "Focused asset cards must remain visible.",
);
requireMatch(
  layout,
  /\.asset-picker-popover-body\s*\{[\s\S]*grid-template-rows: auto auto minmax\(0, 1fr\);[\s\S]*overflow: hidden;/,
  "Asset picker controls must stay fixed while only its card list scrolls.",
);
requireMatch(
  layout,
  /\.asset-picker-popover \.asset-picker-list\s*\{[\s\S]*overflow-y: auto;/,
  "Asset picker popover list must remain scrollable.",
);
if (/\.asset-picker-popover \.asset-picker-list\s*\{[^}]*overflow: visible;[^}]*\}/.test(layout)) {
  failures.push("Asset picker popover must not force the card list overflow visible.");
}

requireMatch(
  animationEditor,
  /animation-template-list selection-scroll-region/,
  "Animation template list must use the shared selection scrollbar.",
);
requireMatch(
  animationEditor,
  /data-preset-id=\{template\.preset_id\}[\s\S]*onFocus=\{\(event\) => event\.currentTarget\.scrollIntoView\(\{ block: "nearest" \}\)\}/,
  "Focused animation templates must remain visible.",
);
requireMatch(
  previewPanel,
  /className="preview-route-picker-list selection-scroll-region"/,
  "Preview route list must use the shared selection scrollbar.",
);
requireMatch(
  previewPanel,
  /role="menuitem"[\s\S]*onFocus=\{\(event\) => event\.currentTarget\.scrollIntoView\(\{ block: "nearest" \}\)\}/,
  "Focused preview routes must remain visible.",
);

requireMatch(
  rollbackEditor,
  /import \{ RichSelect \} from "\.\.\/common\/RichSelect";/,
  "Rollback command editor must use RichSelect.",
);
if (/<select\b/.test(rollbackEditor)) failures.push("Rollback command editor must not retain a native select.");
if (/<select\b/.test(projectSettings)) failures.push("Project settings must not retain a native select.");
requireMatch(
  projectSettings,
  /ariaLabel="固定选项显示"[\s\S]*options=\{\[/,
  "Project rollback fixed-choice setting must use RichSelect options.",
);

requireMatch(
  layout,
  /\.selection-scroll-region,[\s\S]*scrollbar-gutter: stable;[\s\S]*scrollbar-width: thin;/,
  "Selection lists must share a stable thin scrollbar contract.",
);
requireMatch(
  layout,
  /\.selection-scroll-region:hover,[\s\S]*\.selection-scroll-region:focus-within/,
  "Selection scrollbar contrast must strengthen on hover and keyboard focus.",
);
requireMatch(
  layout,
  /\.selection-scroll-region::-webkit-scrollbar,[\s\S]*width: 8px;/,
  "Selection scrollbar must include a WebKit thin-width rule.",
);

if (failures.length > 0) {
  console.error("Editor selection scroll contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Editor selection scroll contract passed.");
