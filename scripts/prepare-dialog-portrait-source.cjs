"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Dialog-Portrait-Source-20261019-01";
const checkpoint = "F:/AgentVN/Checkpoints/Dialog-Portrait-Source-20261019-01";
assert(!fs.existsSync(qa) && !fs.existsSync(checkpoint));
fs.mkdirSync(qa); fs.mkdirSync(checkpoint);
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files = ["GameCli_framework/src/components/player/DialogBox.tsx",
  "GameCli_framework/src/styles/player.css", "GameCli_framework/src/engine/StoryEngine.ts",
  "GameCli_framework/src/types/settings.ts", "shared/cartridge/uiSkin.ts",
  "editor/src/components/command-editors/DialogCommandEditor.tsx", "AGENTS.md", "plans/ACTIVE_TASKS.md"];
const records = files.map(file => {
  const from = path.join(root, file), to = path.join(checkpoint, file);
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  assert.equal(hash(from), hash(to)); return { file, sha256: hash(from) };
});
const authorPath = path.join(root, "output/installed-dialog-portrait-20261019-02/editor-01.json");
const author = JSON.parse(fs.readFileSync(authorPath, "utf8"));
assert.equal(author.status, "PASS"); assert.equal(author.cartridges.length, 2);
const packages = author.cartridges.map(item => {
  assert.equal(hash(item.path), item.sha256);
  const copy = path.join(qa, `original-${item.layout}.vncart`);
  fs.copyFileSync(item.path, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(hash(copy), item.sha256);
  return { layout: item.layout, original: item.path, path: copy, sha256: item.sha256 };
});
const dev = path.join(root, "AgentVN Dev.exe");
fs.copyFileSync(dev, path.join(checkpoint, "AgentVN Dev.before.exe"), fs.constants.COPYFILE_EXCL);
const manifest = { at: new Date().toISOString(), qa, checkpoint, files: records, packages,
  authorEvidence: { path: authorPath, sha256: hash(authorPath) },
  dev: { path: dev, sha256: hash(dev) }, productChanges: 0, modelRequests: 0,
  decision: "Both layouts: dedicated portrait inside left of dialogue, separate text space; no persisted rect changes",
  scope: "Source regression using exact historical UI exports, not a new installed acceptance" };
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
fs.writeFileSync(path.join(qa, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify({ qa, checkpoint, files: records.length, packages: packages.length }));
