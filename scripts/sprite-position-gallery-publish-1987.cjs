"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const source = path.join(__dirname, "sprite-hide-rollback-publish-1986.cjs");
let text = fs.readFileSync(source, "utf8");
text = text.replaceAll("Sprite-Hide-Rollback-Release-1986-20261117-01", "Sprite-Position-Gallery-Release-1987-20261117-01")
  .replaceAll("Windows-Isolated-1986-20261117-03", "Windows-Isolated-1987-20261117-01")
  .replaceAll("artifact-cleanup-02.json", "artifact-cleanup.json")
  .replaceAll("fac4c6602251e106fdbdd4fccd9ee943e6454500", "001cb2fc290df28aa6d3eb2e6467058c1f934e9a");
const begin = text.indexOf("const files=["), end = text.indexOf("const describe=", begin);
assert(begin > 0 && end > begin);
const files = [
  "GameCli_framework/src/engine/spriteStageLayout.ts", "GameCli_framework/src/components/player/SpriteLayer.tsx",
  "GameCli_framework/src/engine/savePreview.ts", "GameCli_framework/src/engine/galleryAnchorManager.ts",
  "GameCli_framework/src/store/runtimeStore.ts",
  "scripts/sprite-position-stability-test.cjs", "scripts/sprite-stage-layout-test.mjs",
  "scripts/sprite-position-stability-playwright.cjs", "scripts/gallery-preview-restart-playwright.cjs",
  "scripts/gallery-restart-persistence-test.cjs",
  "scripts/gallery-preview-export-identity-test.cjs",
  "scripts/sprite-position-gallery-release-1987.cjs", "scripts/sprite-position-gallery-install-stage-1987.cjs",
  "scripts/sprite-position-gallery-installed-1987.cjs", "scripts/sprite-position-gallery-audit-1987.cjs",
  "scripts/sprite-position-gallery-cleanup-1987.ps1", "scripts/sprite-position-gallery-publish-1987.cjs",
  "scripts/sprite-position-gallery-retire-followup-1987.ps1",
  "scripts/knowledge-commit-delivery-check.cjs",
  "docs/ASSISTANT_USER_GUIDE.md", "editor/src/assistant/agentvnDocIndex.generated.ts",
  "editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json",
];
text = text.slice(0, begin) + `const files=${JSON.stringify(files)};\n` + text.slice(end);
const message = "Preserve hidden sprites across rollback and deliver editor 1.9.86\\n\\nSeparate logical sprite exits from transient fades and guard superseded callbacks. Add independent global entry/exit defaults with explicit authoring scope. Verify engine, real-art browser matrix, installed editor/native player and retired QA artifacts. Keep Runtime protocol 0.32.\\n";
assert(text.includes(message));
text = text.replace(message, "Keep explicit sprite anchors stable and persist project preview gallery unlocks\\n\\nShare stage placement with save previews, retain author offsets and duplicate-position distribution. Store external preview gallery unlocks under stable project identities and honor the write/exit barrier. Verify real-art browser matrix, process restarts and native installed Player. Deliver editor 1.9.87 with fresh Runtime 0.32 Player.\\n");
const runner = new Module(source, module);
runner.filename = source; runner.paths = Module._nodeModulePaths(path.dirname(source)); runner._compile(text, source);
