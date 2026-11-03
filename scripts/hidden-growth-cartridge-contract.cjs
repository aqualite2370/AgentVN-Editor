#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const input = path.join(root, "data", "backup-timeline", "project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj");
const output = path.join(root, "output", "hidden-growth", "hidden-growth.vncart");
const reportPath = path.join(root, "output", "hidden-growth", "cartridge-contract.json");

if (!fs.existsSync(output)) {
  execFileSync(process.execPath, [path.join(root, "scripts", "build-vnproj-cartridge.cjs"), "--input", input, "--output", output], { cwd: root, stdio: "inherit" });
}
const verify = execFileSync(process.execPath, [path.join(root, "scripts", "verify-vncart.cjs"), output, "--allow-placeholder-assets"], { cwd: root, encoding: "utf8" });
const result = JSON.parse(verify);
if (!result.ok || result.game_id !== "project_msiz08p7_0_89ebc8a8cb" || result.title !== "隐忍的成长" || result.assets !== 143 || result.client_readable !== true) {
  throw new Error(`hidden-growth cartridge contract failed: ${verify}`);
}
fs.writeFileSync(reportPath, `${JSON.stringify({ ok: true, result, cartridge: output }, null, 2)}\n`, "utf8");
console.log(`hidden-growth-cartridge-contract: PASS (${reportPath})`);
