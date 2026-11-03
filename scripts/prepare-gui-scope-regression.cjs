"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/GUI-Scope-20261019-01";
const qa = "F:/AgentVN/QA/GUI-Scope-20261019-01";
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa), "Preserve existing checkpoints");
fs.mkdirSync(checkpoint); fs.mkdirSync(qa);
const files = ["shared/cartridge/renpyGui.ts", "editor/src/renpy/renpyGuiImport.ts",
  "editor/src/renpy/renpyGuiImportPlan.ts", "editor/src/components/advanced/RenpyGuiImportWorkbench.tsx",
  "AGENTS.md", "plans/ACTIVE_TASKS.md"].map(relative => {
  const source = path.join(root, relative), target = path.join(checkpoint, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(target));
  return { relative, sha256: sha(source) };
});
const official = JSON.parse(fs.readFileSync(path.join(root,
  "output/installed-gui-20261018-01/official-generate-02.json"), "utf8"));
assert.equal(official.status, "PASS");
assert.equal(sha(official.generated.archive.path), official.generated.archive.sha256);
const input = path.join(qa, "GUI作用域 隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture("gui-scope-20261019-01"), null, 2), { flag: "wx" });
fs.copyFileSync(path.join(root, "AgentVN Dev.exe"), path.join(checkpoint, "AgentVN-Dev-before.exe"),
  fs.constants.COPYFILE_EXCL);
const manifest = { createdAt: new Date().toISOString(), files, input,
  devSha256: sha(path.join(checkpoint, "AgentVN-Dev-before.exe")),
  officialArchive: official.generated.archive, officialFiles: official.files,
  scope: "G14 static GUI assignment ownership; no Python execution or real model calls" };
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify({ checkpoint, input, officialArchive: manifest.officialArchive }));
