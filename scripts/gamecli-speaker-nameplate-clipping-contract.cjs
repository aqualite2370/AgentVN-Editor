const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const dialogPath = path.join(repoRoot, "GameCli_framework", "src", "components", "player", "DialogBox.tsx");
const dialogSource = fs.readFileSync(dialogPath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const cssPath of [
  path.join(repoRoot, "GameCli_framework", "src", "styles", "player.css"),
  path.join(repoRoot, "editor", "src-tauri", "bundle-workspace", "GameCli_framework", "src", "styles", "player.css"),
]) {
  const css = fs.readFileSync(cssPath, "utf8");
  const childLayoutRule = css.match(/\.dialog-box\.has-child-layout\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert(childLayoutRule, `Missing .dialog-box.has-child-layout rule in ${cssPath}.`);
  assert(
    /overflow:\s*visible/.test(childLayoutRule),
    `Custom-layout speaker labels must not be clipped in ${cssPath}.`,
  );
}
assert(
  /localizeChildLayoutStyle\(speakerLayout\.style,\s*speakerLayout\.rect,\s*layout\.rect\)/.test(dialogSource),
  "Speaker layout must remain localized against the dialog panel.",
);
assert(
  /function dialogPanelLayoutStyle\(style\?: CSSProperties, hasChildLayout = false\)/.test(dialogSource),
  "Dialog panel style must know when child layout is enabled.",
);
assert(
  /\.\.\.\(hasChildLayout \? \{ padding: 0 \} : \{\}\)/.test(dialogSource),
  "Child-layout dialog panels must neutralize panel padding so stage-authored child bounds remain aligned.",
);
assert(
  /dialogPanelLayoutStyle\(layout\.style,\s*childGeometryEnabled\)/.test(dialogSource),
  "Dialog panel style must pass child-layout state into its geometry normalization.",
);

console.log("gamecli speaker nameplate clipping contract passed");
