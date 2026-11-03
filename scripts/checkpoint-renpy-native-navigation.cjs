"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/renpy-native-navigation", runId);
const files = [
  "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/renpy-title.css",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "GameCli_framework/src/styles/renpy-button-roles.css",
  "scripts/renpy-button-frame-playwright.cjs",
  "shared/cartridge/renpyGui.ts",
  "plans/ACTIVE_TASKS.md",
];
const sha = content => crypto.createHash("sha256").update(content).digest("hex");
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const entries = files.map(relative => {
    const data = fs.readFileSync(path.join(root, relative));
    const target = path.join(output, "files", relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data, { flag: "wx" });
    return { path: relative, sha256: sha(data) };
  });
  fs.writeFileSync(path.join(output, "status.txt"),
    execFileSync("git", ["status", "--short"], { cwd: root }), { flag: "wx" });
  fs.writeFileSync(path.join(output, "tracked.patch"),
    execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }),
    { flag: "wx" });
  const references = [];
  for (const name of ["screens.rpy", "gui.rpy"]) {
    const url = `https://raw.githubusercontent.com/renpy/renpy/8.5.3.26051504/gui/game/${name}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`Official template fetch ${response.status}: ${url}`);
    const data = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(path.join(output, `official-${name}`), data, { flag: "wx" });
    references.push({ url, bytes: data.length, sha256: sha(data), fetchedAt: new Date().toISOString() });
  }
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
    runId, scope: "E4 native title/navigation before fix", files: entries, references,
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    dev: { path: "AgentVN Dev.exe", sha256: sha(fs.readFileSync(path.join(root, "AgentVN Dev.exe"))) },
    note: "Independent copies including untracked implementation files; no reset, index mutation or historical evidence overwrite.",
  }, null, 2), { flag: "wx" });
  console.log(path.join(output, "manifest.json"));
})().catch(error => { console.error(error); process.exitCode = 1; });
