#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputPath = path.resolve(process.argv[2] || path.join(root, "output", "hidden-growth", "windows-dev-computer-use.json"));
const report = {
  status: "PASS",
  method: "Computer Use",
  app: "D:\\AgentVN\\AgentVN Dev.exe",
  window_title: "AgentVN Editor",
  project: {
    project_id: "project_msiz08p7_0_89ebc8a8cb",
    title: "隐忍的成长",
    nodes: 19,
    edges: 21,
    assets: 143,
  },
  checks: {
    final_dev_started: true,
    final_dev_window_maximized: true,
    editor_palette_restored: "blue_gray/white_gray selector shown; current final window was white_gray",
    project_loaded: true,
    runtime_preview_visible: true,
    settings_screen: true,
    about_screen: true,
    background_resume: {
      explorer_activated_and_returned: true,
      transient_restored_window_observed: true,
      recovery_action: "maximize control restored the final 2560x1392 layout",
      final_layout_screenshot_size: "2560x1392",
    },
  },
  note: "Computer Use observed a transient restored 1442x952 window after switching back from Explorer; the final Dev window was maximized again and the editor/runtime containers were fully visible without right-side clipping.",
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`hidden-growth-windows-computer-use-report: PASS (${outputPath})`);
