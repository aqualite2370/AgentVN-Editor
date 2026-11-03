#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const scriptRoot = path.join(root, "scripts");
const failures = [];
const allowed = new Set([
  "project-container.cjs",
  "project-container-save-worker.cjs",
  "vnproj-container-audit.cjs",
]);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else files.push(absolute);
  }
  return files;
}

for (const filePath of walk(scriptRoot)) {
  if (!/\.(?:cjs|mjs|js|ts|py)$/.test(filePath) || allowed.has(path.basename(filePath))) continue;
  const source = fs.readFileSync(filePath, "utf8");
  if (!source.includes(".vnproj")) continue;
  const checks = [
    [/JSON\.parse\(fs\.readFileSync\((?:projectPath|PROJECT_PATH|sourcePath|savedPath|fixturePath)/g, "direct JSON.parse(readFileSync)"],
    [/JSON\.parse\(fs\.readFileSync\([^\n]*\.vnproj/g, "direct literal .vnproj JSON read"],
    [/json\.loads\([^\n]*(?:project_path|\.vnproj)[^\n]*(?:read_text|open)\(/g, "direct json.loads project read"],
    [/fs\.writeFileSync\((?:projectPath|PROJECT_PATH|snapshotPath|fixturePath)[^\n]*JSON\.stringify\(/g, "direct JSON writeFileSync"],
    [/fs\.writeFileSync\([^\n]*\.vnproj[^\n]*JSON\.stringify\(/g, "direct literal .vnproj JSON write"],
    [/writeJson\([^\n]*(?:projectPath|PROJECT_PATH|snapshotPath)/g, "generic JSON writer used for .vnproj"],
  ];
  for (const [pattern, label] of checks) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      failures.push(`${path.relative(root, filePath)}:${line}: ${label}`);
    }
  }
}

const requiredTokens = [
  ["editor/src/utils/projectBundle.ts", ["project.json", "format.json", "hash_sha256", "begin_project_bundle_asset_upload"]],
  ["editor/src/utils/projectImport.ts", ["isProjectZipBytes", "readProjectJsonFromBundle"]],
  ["backend/app/services/project_container.py", ["detect_project_container", "PROJECT_CONTAINER_INVALID", "PROJECT_ZIP_PATH_UNSAFE"]],
  ["backend/app/services/project_state_service.py", ["load_project_container", "PROJECT_ASSET_HASH_MISMATCH"]],
  ["editor/src-tauri/src/main.rs", ["backupFormat", "json-timeline", "TIMELINE_BACKUP_JSON_ONLY"]],
];

for (const [relativePath, tokens] of requiredTokens) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${relativePath}: missing ${token}`);
  }
}

if (failures.length) {
  throw new Error(`.vnproj container audit failed:\n${failures.join("\n")}`);
}

console.log("vnproj container audit passed");
