#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");

// Keep the plan-facing command on the real path. The visual regression drives
// import -> advanced tools -> preview, and the parity pass drives that editor
// path alongside a real GameCLI preview so metadata-only checks cannot pass
// while the rendered scale differs.
for (const script of [
  "quick-menu-preview-visual-regression-playwright.cjs",
  "quick-menu-runtime-editor-parity-playwright.cjs",
]) {
  execFileSync(process.execPath, [require("node:path").join(__dirname, script)], {
    cwd: require("node:path").resolve(__dirname, ".."),
    stdio: "inherit",
  });
}
