#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/project-home-viewport-before-fix", runId);
const files = [
  "editor/src/app/App.css",
  "scripts/runtime-layout-profiles-playwright.cjs",
  "scripts/editor-ui-motion-stage-gates.cjs",
  "plans/ui-motion-implementation-progress.md",
];
fs.mkdirSync(output, { recursive: true });
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const entries = files.map(relative => {
  const source = path.join(root, relative);
  const target = path.join(output, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, sha256: hash(source) };
});
for (const [name, args] of [
  ["status.txt", ["status", "--short"]],
  ["tracked.patch", ["diff", "--binary", "HEAD"]],
]) {
  fs.writeFileSync(path.join(output, name), execFileSync("git", args, {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  }));
}
const manifest = {
  runId,
  scope: "short-viewport-project-home-clipping-regression",
  head: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  files: entries,
  dev: {
    path: "AgentVN Dev.exe",
    sha256: hash(path.join(root, "AgentVN Dev.exe")),
  },
  note: "Recoverable snapshot before the project-home viewport fix; preserves the full tracked diff without resetting or cleaning user data.",
};
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(path.join(output, "manifest.json"));
