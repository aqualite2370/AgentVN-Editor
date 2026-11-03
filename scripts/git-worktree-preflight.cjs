"use strict";
// Real worktree read-only preflight. Never stage, fetch, commit, push or rewrite
// the index; snapshot Git state before and after the project's CheckOnly command.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Git-Preflight-Branch-20261103-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, "worktree-" + attempt); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true,
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const source = f => ({ path: f, sha256: hash(fs.readFileSync(f)), bytes: fs.statSync(f).size });
function gitFile(name) {
  const file = path.resolve(root, git(["rev-parse", "--git-path", name]).trim());
  return fs.existsSync(file) ? source(file) : { path: file, exists: false };
}
function snapshot() {
  return { head: git(["rev-parse", "HEAD"]).trim(), branch: git(["branch", "--show-current"]).trim(),
    index: gitFile("index"), fetchHead: gitFile("FETCH_HEAD"), config: gitFile("config"),
    remoteRefs: git(["for-each-ref", "--format=%(refname):%(objectname)", "refs/remotes"]).trim() };
}
const report = { status: "RUNNING", scope: "REAL_WORKTREE_READ_ONLY_PREFLIGHT_NOT_COMPLETE_PRODUCT_DELIVERY",
  startedAt: new Date().toISOString(), sources: [__filename, path.join(root, ".gitignore"),
    path.join(root, "scripts/push-agentvn-editor.ps1")].map(source),
  commits: 0, pushes: 0, stagedChanges: 0, fetches: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
try {
  report.before = snapshot(); save();
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/push-agentvn-editor.ps1"), "-CheckOnly"];
  const result = spawnSync("powershell.exe", args, { cwd: root, encoding: "utf8",
    windowsHide: true, timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const log = path.join(out, "check-only.log");
  fs.writeFileSync(log, (result.stdout || "") + "\n" + (result.stderr || ""), { flag: "wx" });
  report.command = { executable: "powershell.exe", args, exitCode: result.status, log: source(log) };
  report.after = snapshot(); assert.deepEqual(report.after, report.before, "Read-only check changed Git state");
  report.gitStatePreserved = true;
  assert.ifError(result.error); assert.equal(result.status, 0, "Project preflight rejected actual worktree; inspect log");
  assert.match(result.stdout, /CHECK_ONLY_PASS/);
  const paths = git(["ls-files", "-z", "--cached"]).split("\0").filter(Boolean);
  const untracked = git(["ls-files", "-z", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
  report.inventory = { tracked: paths.length, untracked: untracked.length,
    boundary: "Not a secret/content review or completed source delivery" };
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, inventory: report.inventory, error: report.error }, null, 2)); }
