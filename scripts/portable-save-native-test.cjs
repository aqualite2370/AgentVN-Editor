"use strict";
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/portable-save-native", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "Native real-filesystem save root/migration; no user data touched", steps: [] };
const cargo = process.argv.includes("--cargo");
const commands = cargo ? [
  ["cargo", ["test", "--manifest-path", "GameCli_framework/src-tauri/Cargo.toml",
    ...(process.argv.includes("--all") ? ["--lib"] : ["portable_save_migration"]), "--", "--nocapture"]],
] : [
  ["--test", "--edition=2021", "GameCli_framework/src-tauri/src/save_location.rs", "-o", path.join(out, "native-tests.exe")],
  [],
].map(args => [args.length ? "rustc" : path.join(out, "native-tests.exe"), args.length ? args : ["--nocapture"]]);
for (const [command, actual] of commands) {
  const result = spawnSync(command, actual, { cwd: root, encoding: "utf8", windowsHide: true });
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  report.steps.push({ command: [command, ...actual], exitCode: result.status, output: text, error: result.error?.message });
  console.log(text);
  if (result.status !== 0) { report.status = "FAILED"; process.exitCode = 1; break; }
}
if (report.status === "RUNNING") report.status = "PASS";
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`Evidence: ${out}`);
