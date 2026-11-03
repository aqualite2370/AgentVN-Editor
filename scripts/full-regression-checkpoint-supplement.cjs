"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), runRoot = path.resolve(process.argv[2] || "");
assert(process.argv[2] && runRoot.startsWith(path.join(root, "output", "full-regression-")));
const initialPath = path.join(runRoot, "checkpoint/manifest.json");
const initial = JSON.parse(fs.readFileSync(initialPath, "utf8"));
assert.equal(initial.status, "PASS");
const selected = initial.skippedUntracked.filter(file => /^(editor|GameCli_framework)\//.test(file));
assert(selected.includes("GameCli_framework/src-tauri/src/save_location.rs"));
assert(selected.includes("GameCli_framework/src-tauri/src/portable_save_migration.rs"));
assert(selected.includes("editor/src-tauri/installer-hooks.nsh"));
const out = path.join(runRoot, "checkpoint/supplement-01");
assert(!fs.existsSync(out));
fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), initial: initialPath,
  scope: "Supplement initial selector omissions; not a claim these copies existed before version edits",
  productFilesEditedByThisScript: false, files: [] };
async function hash(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
(async () => {
  for (const relative of selected) {
    const source = path.resolve(root, relative), target = path.resolve(out, "files", relative);
    assert(source.startsWith(root + path.sep) && target.startsWith(out + path.sep));
    assert(fs.lstatSync(source).isFile() && !fs.lstatSync(source).isSymbolicLink());
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    const digest = await hash(source);
    assert.equal(await hash(target), digest);
    report.files.push({ relative, path: source, copy: target, sha256: digest,
      bytes: fs.statSync(source).size, modifiedAt: fs.statSync(source).mtime.toISOString() });
  }
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, files: report.files.length, out, error: report.error }));
});
