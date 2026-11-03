const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const panelPath = path.join(
  ROOT,
  "editor",
  "src",
  "components",
  "advanced",
  "AnimationEditorPanel.tsx",
);
const panel = fs.readFileSync(panelPath, "utf8");

const checks = [
  {
    label: "animation editor uses the shared asset picker",
    pass: /import\s+\{\s*AssetPicker\s*\}\s+from\s+"\.\.\/common\/AssetPicker"/.test(panel),
  },
  {
    label: "sprite previews expose a controlled material picker",
    pass:
      /label="预览立绘素材"/.test(panel) &&
      /allowedTypes=\{\["sprite"\]\}/.test(panel) &&
      /onChange=\{\(assetId\)\s*=>\s*selectPreviewAsset\("sprite",\s*assetId\)\}/.test(panel),
  },
  {
    label: "background previews expose a controlled material picker",
    pass:
      /label="预览背景素材"/.test(panel) &&
      /allowedTypes=\{\["background"\]\}/.test(panel) &&
      /onChange=\{\(assetId\)\s*=>\s*selectPreviewAsset\("background",\s*assetId\)\}/.test(panel),
  },
  {
    label: "background preview renders the selected real image",
    pass:
      /draft\.target_type\s*===\s*"background"\s*&&\s*previewAssetSource/.test(panel) &&
      /alt=\{previewAsset\?\.metadata\.filename\s*\?\?\s*"背景图预览"\}/.test(panel),
  },
  {
    label: "preview material overrides are reset when the selected node changes",
    pass:
      /setPreviewAssetOverrides\(\{\}\)/.test(panel) &&
      /\[selectedNodeId\]/.test(panel),
  },
];

const failed = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"} ${check.label}`);
}

if (failed.length > 0) {
  console.error(`Animation editor preview asset contract failed: ${failed.length} check(s).`);
  process.exitCode = 1;
} else {
  console.log("PASS animation editor preview asset selection contract");
}
