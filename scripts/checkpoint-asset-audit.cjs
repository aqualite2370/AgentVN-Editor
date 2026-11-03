"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const attempt = process.argv[2] || "20261021-01";
if (!/^\d{8}-\d{2}$/.test(attempt)) throw Error("Expected a dated checkpoint suffix");
const root = path.resolve(__dirname, ".."), out = `F:/AgentVN/Checkpoints/Asset-Audit-${attempt}`;
if (fs.existsSync(out)) throw Error("Checkpoint already exists");
fs.mkdirSync(out, { recursive: true });
const paths = ["AGENTS.md", "plans/ACTIVE_TASKS.md", "editor/src/utils/assetAudit.ts",
  "editor/src/utils/editorAssetReferences.ts", "editor/src/types/assets.ts",
  "editor/src/components/editor/InspectorPanel.tsx",
  "editor/src/components/command-editors/CommandListEditor.tsx", "editor/src/styles/layout.css",
  "shared/cartridge/assetScanner.ts", "editor/src/components/editor/SceneAssetAuditPanel.tsx",
  "editor/src/components/command-editors/FloatingCommandWorkbench.tsx",
  "scripts/asset-audit-protocol-test.cjs", "scripts/asset-audit-navigation-playwright.cjs"];
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const entries = paths.map(p => {
  const src = path.join(root, p), dst = path.join(out, "files", p);
  fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  if (hash(src) !== hash(dst)) throw Error("Copy mismatch");
  return { path: p, sha256: hash(src) };
});
fs.writeFileSync(path.join(out, "tracked.patch"), execFileSync("git", ["diff", "--binary", "HEAD"],
  { cwd: root, maxBuffer: 192 * 1024 * 1024 }), { flag: "wx" });
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ at: new Date().toISOString(), entries,
  dev: { path: "D:/AgentVN/AgentVN Dev.exe", sha256: hash(path.join(root, "AgentVN Dev.exe")) },
  installer: { path: "releases/editor/AgentVN_Editor_v1.9.21_20261022_005853.exe",
    sha256: hash(path.join(root, "releases/editor/AgentVN_Editor_v1.9.21_20261022_005853.exe")) },
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, files: entries.length }));
