"use strict";
// Publish this reviewed source-only graph integrity batch without changing the checkout index.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { scan } = require("./git-content-inventory.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Editor-Delete-Integrity-20261116-01";
const parent = "49e39a247d387d1f03ada7321569e1c15e3d62b5";
const branch = "codex/editor-autosave-recovery-20261116";
const output = path.join(base, "source-delivery-01.json");
assert(!fs.existsSync(output));
const product = ["editor/src/store/editorStore.ts", "editor/src/utils/nodeFactory.ts",
  "editor/src/components/editor/VisualNovelEditor.tsx", "editor/src/components/editor/InspectorPanel.tsx",
  "editor/src/components/editor/EditorToolbar.tsx"];
const files = [...product, "scripts/editor-node-delete-integrity-test.cjs",
  "scripts/editor-node-delete-integrity-playwright.cjs", "scripts/editor-route-import-atomicity-test.cjs",
  "scripts/editor-route-import-atomicity-playwright.cjs", "scripts/editor-graph-integrity-source-delivery.cjs"];
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, options = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024, ...options });
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  indexSha256: sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
const normalized = text => text.replaceAll("\r\n", "\n");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), parent, branch,
  scope: "SOURCE_ONLY_GRAPH_DELETE_AND_ATOMIC_ROUTE_IMPORT_NOT_NEW_DEV_OR_INSTALLER",
  builds: 0, installations: 0, models: 0, files: [], checks: [], before: state() };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
(async () => {
  assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"),
    "Do not overwrite a concurrent remote update");
  for (const [directory, count] of [["after-complete-01", 8], ["route-after-01", 10],
    ["persistence-complete-01", 15], ["browser-complete-01", 4], ["route-browser-after-02", 6]]) {
    const file = path.join(base, directory, "report.json"), receipt = read(file);
    assert.equal(receipt.status, "PASS"); assert.equal(receipt.cases.length, count);
    assert(receipt.cases.every(c => c.status === "PASS"));
    if (directory.includes("browser")) {
      assert.equal(receipt.cleanup, "OWNED_BROWSER_AND_SERVICES_STOPPED");
      for (const source of receipt.sources) assert.equal(sha(source.source), source.sha256);
    }
    report.checks.push({ path: file, sha256: sha(file), cases: count });
  }
  for (const relative of product) {
    assert.equal(normalized(fs.readFileSync(path.join(base, "before-source", relative), "utf8")),
      normalized(git(["show", `${parent}:${relative}`])), "Unexpected preexisting delta: " + relative);
  }
  const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "graph-integrity-delivery.index") };
  assert(!fs.existsSync(alternate.GIT_INDEX_FILE));
  git(["read-tree", parent], { env: alternate });
  for (const relative of files) {
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.equal(scan(bytes.toString("utf8")).length, 0, "Review potential credential: " + relative);
    if (relative.endsWith(".cjs"))
      cp.execFileSync(process.execPath, ["--check", path.join(root, relative)], { windowsHide: true });
    const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
    report.files.push({ relative, sha256: hash(bytes) });
  }
  const tree = git(["write-tree"], { env: alternate }).trim();
  assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree])
    .trim().split("\n").sort(), [...files].sort());
  report.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], {
    input: "Keep node deletion and large route imports atomic and recoverable\n\nProtect the entry node, clean removed choice links, and group canvas deletion into one undo step. Commit complete route imports before reporting success so saves, undo and project reloads cannot retain late batches. Fence file parsing and delayed viewport work by project load ownership. Source store/browser and real isolated backend checks passed; this source-only delta is not a new installed release or proof of the original natural loss incident. Preserve the real checkout and index.\n",
  }).trim();
  save(); report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]); save();
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t"));
  for (let i = 0; i < report.files.length; i += 4) {
    await Promise.all(report.files.slice(i, i + 4).map(async file => {
      const response = await fetch(`https://raw.githubusercontent.com/aqualite2370/AgentVN-Editor/${report.commit}/${file.relative}`,
        { signal: AbortSignal.timeout(20000) });
      assert(response.ok, "Remote source HTTP " + response.status);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256);
      file.remotelyVerified = true;
    })); save();
  }
  report.after = state(); assert.deepEqual(report.after, report.before); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; report.after = state(); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, commit: report.commit, files: report.files.length, output, error: report.error }));
});
