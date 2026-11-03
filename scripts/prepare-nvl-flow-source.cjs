"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/NVL-Flow-Source-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/NVL-Flow-Source-20261020-01";
assert(!fs.existsSync(qa) && !fs.existsSync(checkpoint), "Never overwrite prior evidence");
fs.mkdirSync(qa); fs.mkdirSync(checkpoint);
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files = ["GameCli_framework/src/components/player/ChoicePanel.tsx",
  "GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/components/player/PlaybackControls.tsx",
  "GameCli_framework/src/components/player/StoryPlayer.tsx", "GameCli_framework/src/styles/player.css",
  "shared/cartridge/quickMenuMetrics.ts", "GameCli_framework/src/components/player/useDialogPortrait.ts",
  "AGENTS.md", "plans/ACTIVE_TASKS.md"];
const records = files.map(file => {
  const source = path.join(root, file), copy = path.join(checkpoint, file);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(hash(source), hash(copy)); return { file, sha256: hash(source) };
});
const exportFile = path.join(root, "output/installed-runtime-persistence-20261018-01/export-02/report.json");
const exported = JSON.parse(fs.readFileSync(exportFile, "utf8"));
assert.equal(exported.status, "PASS"); assert.equal(exported.cartridges.length, 2);
const packages = exported.cartridges.map(p => {
  assert.equal(hash(p.path), p.sha256);
  const copy = path.join(qa, `capacity-${p.layout}.vncart`);
  fs.copyFileSync(p.path, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(hash(copy), p.sha256);
  return { ...p, original: p.path, path: copy };
});
const dev = path.join(root, "AgentVN Dev.exe");
fs.copyFileSync(dev, path.join(checkpoint, "AgentVN Dev.before.exe"), fs.constants.COPYFILE_EXCL);
const receipt = { at: new Date().toISOString(), qa, checkpoint, files: records, packages,
  exportEvidence: { path: exportFile, sha256: hash(exportFile) }, dev: { path: dev, sha256: hash(dev) },
  sourceScope: "Exact historical capacity UI exports through public preview protocol; controlled long-line geometry input separately",
  productChanges: 0, modelRequests: 0 };
for (const directory of [qa, checkpoint]) fs.writeFileSync(path.join(directory, "manifest.json"),
  JSON.stringify(receipt, null, 2), { flag: "wx" });
console.log(JSON.stringify({ qa, checkpoint, files: records.length, packages: packages.length }));
