"use strict";
// Build an explicit product-source tree with an alternate Git index. The real
// worktree/index/branch are never staged, reset or checked out by this tool.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, spawnSync, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Source-Delivery-20261103-01";
const out = path.join(base, process.argv[3] || "snapshot-01");
assert.equal(path.dirname(out), path.resolve(base)); assert.match(path.basename(out), /^snapshot-\d{2}$/);
const source = path.join(out, "source");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
// Byte-preserving CRLF normalization also supports non-UTF8 source files.
const canonical = value => Buffer.from(value.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
const git = (args, env = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024, windowsHide: true,
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } });
const describe = file => ({ path: file, bytes: fs.statSync(file).size, sha256: sha(fs.readFileSync(file)) });
function gitState() {
  const file = path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim());
  return { head: git(["rev-parse", "HEAD"]).trim(), branch: git(["branch", "--show-current"]).trim(),
    index: describe(file), config: describe(path.resolve(root, git(["rev-parse", "--git-path", "config"]).trim())),
    status: sha(git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) };
}
const save = report => fs.writeFileSync(path.join(out, report.receiptName || "report.json"), JSON.stringify(report, null, 2));
function safeEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(AGENTVN_|VITE_|WEBVIEW2_|DATABASE_PATH$|OPENAI_|DEEPSEEK_|ANTHROPIC_)/.test(key)) delete env[key];
  return { ...env, npm_config_cache: path.join(out, "npm-cache"),
    npm_config_audit: "false", npm_config_fund: "false", PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") };
}
async function run(report, name, exe, args, cwd) {
  const row = { name, executable: exe, arguments: args, cwd, startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save(report); console.log("START", name);
  const log = path.join(out, name + ".log"), stream = fs.createWriteStream(log, { flags: "wx" });
  await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, env: safeEnvironment(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    row.pid = child.pid; save(report);
    child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
    child.on("error", reject);
    child.on("close", code => {
      stream.end(() => {
        row.exitCode = code; row.finishedAt = new Date().toISOString();
        row.log = describe(log); row.status = code === 0 ? "PASS" : "FAILED"; save(report);
        console.log(row.status, name);
        code === 0 ? resolve() : reject(new Error(`${name} exited ${code}; inspect ${log}`));
      });
    });
  });
}
async function main() {
  const action = process.argv[2]; assert(["prepare", "gates"].includes(action));
  if (action === "prepare") {
    assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
    const report = { status: "RUNNING", scope: "EXACT_PRODUCT_SOURCE_TREE_NOT_INSTALLED_OR_FULL_FUNCTIONAL_ACCEPTANCE",
      startedAt: new Date().toISOString(), commands: [], files: [], excluded: [],
      stagedWorkspacePaths: 0, commits: 0, pushes: 0, paidRequests: 0, productsStarted: 0 };
    try {
      report.before = gitState(); save(report);
      const inventoryNumber = process.argv[4] || "03"; assert.match(inventoryNumber, /^\d{2}$/);
      const inventoryFile = `F:/AgentVN/QA/Git-Content-Review-20261103-01/inventory-${inventoryNumber}/report.json`;
      const inventory = JSON.parse(fs.readFileSync(inventoryFile, "utf8"));
      const reviewed = require("./git-content-findings-review.cjs").validate(inventory);
      assert.equal(reviewed.length, 11);
      report.inventory = describe(inventoryFile);
      const allowedTop = new Set(["GameCli_framework", "editor", "backend", "shared", "scripts", "docs", "windows-offline-tools"]);
      const allowedRoot = new Set([".gitignore", "package.json", "package-lock.json", "LICENSE", "LICENSE.en.md",
        "COMMERCIAL-LICENSING.md", "THIRD_PARTY_NOTICES.md", "CONTRIBUTING.md", "README.md"]);
      for (const item of inventory.files) {
        if (!(allowedTop.has(item.relative.split("/")[0]) || allowedRoot.has(item.relative))) {
          report.excluded.push({ relative: item.relative, reason: "Local instruction/task record outside product-source manifest" }); continue;
        }
        assert(!item.deleted && /^[a-f0-9]{64}$/.test(item.sha256));
        const file = path.join(root, item.relative);
        assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
        assert.equal(sha(fs.readFileSync(file)), item.sha256, "Source changed after reviewed inventory");
        report.files.push(item);
      }
      assert(report.files.length > 1000);
      fs.writeFileSync(path.join(out, "paths.nul"), report.files.map(f => f.relative).join("\0") + "\0", { flag: "wx" });
      const env = { GIT_INDEX_FILE: path.join(out, "alternate.index") };
      git(["read-tree", "--empty"], env);
      git(["-c", "core.autocrlf=false", "add", "--pathspec-from-file=" + path.join(out, "paths.nul"), "--pathspec-file-nul"], env);
      report.tree = git(["write-tree"], env).trim();
      const archive = path.join(out, "product-source.tar");
      // Global core.autocrlf=true otherwise changes delivered tree bytes.
      git(["-c", "core.autocrlf=false", "archive", "--format=tar", "--output=" + archive, report.tree]);
      report.archive = describe(archive); fs.mkdirSync(source);
      const extracted = spawnSync("tar.exe", ["-xf", archive, "-C", source], { windowsHide: true, encoding: "utf8" });
      assert.ifError(extracted.error); assert.equal(extracted.status, 0, extracted.stderr);
      for (const item of report.files) {
        const archived = fs.readFileSync(path.join(source, item.relative));
        assert.equal(sha(archived), item.sha256, item.relative);
        item.archiveSha256 = sha(archived);
        if (!item.binary) item.canonicalSha256 = sha(canonical(archived));
      }
      for (const relative of ["plans", "AGENTS.md", ".git", ".env", "output", "releases", "node_modules",
        "editor/node_modules", "GameCli_framework/node_modules", "backend/data"])
        assert(!fs.existsSync(path.join(source, relative)), "Unexpected local payload: " + relative);
      assert(fs.existsSync(path.join(source, "windows-offline-tools/NSIS/COPYING")));
      report.status = "PREPARED_NOT_BUILT";
    } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
    try {
      report.after = gitState(); assert.deepEqual(report.after, report.before);
      report.gitStatePreserved = true;
    } catch (e) {
      report.status = "FAILED"; report.gitStateError = String(e.stack || e); process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString(); save(report);
    console.log(JSON.stringify({ status: report.status, tree: report.tree, files: report.files.length, excluded: report.excluded, error: report.error }));
    return;
  }
  const prepared = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
  assert.equal(prepared.status, "PREPARED_NOT_BUILT");
  assert.equal(prepared.archive.sha256, sha(fs.readFileSync(prepared.archive.path)));
  const report = { status: "RUNNING", receiptName: "gates-report.json",
    scope: "ARCHIVED_PRODUCT_CLEAN_NPM_INSTALL_AND_FRONTEND_BUILDS_ONLY",
    startedAt: new Date().toISOString(), sourcePreparation: describe(path.join(out, "report.json")),
    tree: prepared.tree, commands: [], productChanges: 0, editorReleases: 0, paidRequests: 0,
    boundaries: ["No native Rust release/installer built here.", "Backend/Runtime behavior acceptance remains separate.",
      "Installs fresh dependencies using archived lockfiles; does not use workspace node_modules."] };
  const gatesFile = path.join(out, "gates-report.json");
  assert(!fs.existsSync(gatesFile));
  const npm = "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js"; assert(fs.existsSync(npm));
  fs.mkdirSync(path.join(out, "temporary"));
  try {
    for (const area of ["GameCli_framework", "editor"])
      await run(report, "npm-ci-" + area, process.execPath,
        [npm, "--prefix", path.join(source, area), "ci", "--no-audit", "--fund=false"], source);
    await run(report, "editor-typecheck", process.execPath,
      [npm, "--prefix", path.join(source, "editor"), "run", "typecheck"], source);
    await run(report, "editor-build", process.execPath,
      [npm, "--prefix", path.join(source, "editor"), "run", "build"], source);
    await run(report, "gamecli-build", process.execPath,
      [npm, "--prefix", path.join(source, "GameCli_framework"), "run", "build"], source);
    await run(report, "knowledge-source-tests", process.execPath,
      [path.join(source, "scripts/assistant-knowledge-test.cjs"), path.join(out, "knowledge-tests")], source);
    await run(report, "knowledge-index-tests", process.execPath,
      [path.join(source, "scripts/assistant-knowledge-index-test.cjs"), path.join(out, "knowledge-index-tests")], source);
    report.lineEndingOnlyChanges = [];
    for (const item of prepared.files) {
      const bytes = fs.readFileSync(path.join(source, item.relative)), actual = sha(bytes);
      if (actual === item.archiveSha256) continue;
      assert(!item.binary, "Binary source changed during build: " + item.relative);
      assert.equal(sha(canonical(bytes)), item.canonicalSha256, "Source content changed during build: " + item.relative);
      report.lineEndingOnlyChanges.push({ relative: item.relative, beforeSha256: item.archiveSha256, afterSha256: actual });
    }
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(report);
  console.log(JSON.stringify({ status: report.status, out, commands: report.commands.map(c => ({ name: c.name, status: c.status })), error: report.error }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
