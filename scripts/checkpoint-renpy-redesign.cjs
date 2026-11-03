"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = `F:/AgentVN/Checkpoints/Renpy-Redesign-${stamp}`;
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const candidates = [...new Set(git("ls-files", "-z", "--modified", "--others", "--exclude-standard")
  .toString("utf8").split("\0").filter(Boolean))];
const files = candidates.filter((relative) => fs.existsSync(path.join(root, relative))
  && fs.lstatSync(path.join(root, relative)).isFile());
const totalBytes = files.reduce((sum, relative) => sum + fs.statSync(path.join(root, relative)).size, 0);
if (totalBytes > 2 * 1024 ** 3) throw Error(`Checkpoint exceeds 2 GiB: ${totalBytes}`);
fs.mkdirSync(destination, { recursive: true });
const entries = files.map((relative) => {
  const source = path.join(root, relative);
  const target = path.join(destination, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  const sha256 = hash(source);
  if (sha256 !== hash(target)) throw Error(`Checkpoint mismatch: ${relative}`);
  return { path: relative, bytes: fs.statSync(source).size, sha256 };
});
fs.writeFileSync(path.join(destination, "tracked.patch"), git("diff", "--binary", "HEAD"), { flag: "wx" });
const artifacts = [
  "AgentVN Dev.exe",
  "releases/editor/AgentVN_Editor_v1.9.20_20261021_191504.exe",
  "releases/editor/AgentVN_Editor_v1.9.2_20261021_190012.exe",
].filter((relative) => fs.existsSync(path.join(root, relative))).map((relative) => ({
  path: relative, sha256: hash(path.join(root, relative)),
  bytes: fs.statSync(path.join(root, relative)).size,
}));
const manifest = {
  createdAt: new Date().toISOString(), root, destination, totalBytes, entries, artifacts,
  deleted: candidates.filter((relative) => !fs.existsSync(path.join(root, relative))),
  head: git("rev-parse", "HEAD").toString().trim(),
};
fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", destination, files: entries.length, totalBytes, artifacts }));
