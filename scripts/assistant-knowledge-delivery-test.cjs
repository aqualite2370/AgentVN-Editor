"use strict";
// Rebuild the knowledge artifact from actual committed Git bytes, without
// copying untracked sources, .git, user data or development-only documents.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), out = process.argv[2];
assert(out && !fs.existsSync(out), "Use a new evidence directory");
fs.mkdirSync(out, { recursive: true });
const generated = "editor/src/assistant/agentvnDocIndex.generated.ts";
const manifest = "docs/assistant-knowledge-sources.json";
const generator = "scripts/build-agent-doc-index.cjs";
const normalize = value => value.toString("utf8").replace(/\r\n/g, "\n");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const report = { status: "RUNNING", scope: "COMMITTED_KNOWLEDGE_ARCHIVE_REBUILD_NOT_FULL_EDITOR_OR_INSTALLATION",
  at: new Date().toISOString(), cases: [], commands: [], paidRequests: 0, productStarts: 0,
  dependencyBoundary: "Uses the existing editor/node_modules/esbuild via NODE_PATH; does not claim a clean dependency installation." };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function command(exe, args, options = {}) {
  const result = spawnSync(exe, args, { cwd: root, windowsHide: true,
    maxBuffer: 16 * 1024 * 1024, ...options });
  report.commands.push({ executable: exe, arguments: args, exitCode: result.status,
    error: result.error?.message, stdout: result.stdout?.toString("utf8").slice(0, 10000),
    stderr: result.stderr?.toString("utf8").slice(0, 10000) });
  save();
  return result;
}
function git(args) {
  const result = command("git", args); assert.equal(result.status, 0, result.stderr?.toString()); return result.stdout;
}
function check(name, fn) {
  const item = { name, status: "RUNNING" }; report.cases.push(item); save();
  try { item.detail = fn(); item.status = "PASS"; save(); }
  catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); save(); throw error; }
}
try {
  report.revision = git(["rev-parse", "HEAD"]).toString().trim();
  const sources = JSON.parse(fs.readFileSync(path.join(root, manifest))).markdown;
  const files = [...sources, manifest, generator, generated, "editor/src/components/common/hoverHelpCatalog.ts",
    "editor/src/assistant/retrieval.ts", "editor/src/assistant/types.ts",
    "scripts/assistant-knowledge-index-test.cjs", "scripts/assistant-knowledge-test.cjs",
    "scripts/assistant-knowledge-delivery-test.cjs"];
  check("all-necessary-inputs-exist-in-current-commit-with-current-content", () => {
    const tracked = new Set(git(["ls-tree", "-r", "--name-only", "HEAD"]).toString().split(/\r?\n/));
    const missing = files.filter(file => !tracked.has(file));
    assert.deepEqual(missing, [], "Knowledge inputs must exist in the commit, not only in the working tree");
    report.inputs = files.map(file => {
      const committed = git(["show", `HEAD:${file}`]);
      assert.equal(normalize(committed), normalize(fs.readFileSync(path.join(root, file))), `Uncommitted knowledge source: ${file}`);
      return { file, committedSHA256: hash(committed), canonicalSHA256: hash(normalize(committed)) };
    });
    return { files: files.length, revision: report.revision };
  });
  const source = path.join(out, "Git源码 中文 空格");
  check("actual-git-archive-has-no-worktree-or-ignored-source-fallback", () => {
    const archive = path.join(out, "knowledge-source.tar");
    assert.equal(command("git", ["-c", "core.autocrlf=false", "archive", "--format=tar",
      `--output=${archive}`, "HEAD", "--", ...files]).status, 0);
    fs.mkdirSync(source);
    assert.equal(command("tar.exe", ["-xf", archive, "-C", source]).status, 0);
    assert(!fs.existsSync(path.join(source, ".git")));
    for (const file of files)
      assert.equal(hash(fs.readFileSync(path.join(source, file))),
        report.inputs.find(row => row.file === file).committedSHA256, file);
    for (const file of ["GameCli_framework/docs/BUILD_ANDROID.md", "GameCli_framework/docs/BUILD_WINDOWS.md"])
      assert(!fs.existsSync(path.join(source, file)), "Private build documents are not implicit inputs");
    return { archive, sha256: hash(fs.readFileSync(archive)), source };
  });
  const run = args => command(process.execPath, [path.join(source, generator), ...args],
    { cwd: source, env: { ...process.env, NODE_PATH: path.join(root, "editor/node_modules") } });
  check("committed-generator-check-and-rebuild-match-committed-artifact", () => {
    assert.equal(run(["--check"]).status, 0);
    const before = fs.readFileSync(path.join(source, generated));
    assert.equal(run([]).status, 0);
    assert.equal(normalize(fs.readFileSync(path.join(source, generated))), normalize(before));
    return { outputSHA256: hash(normalize(before)), outputBytes: before.length };
  });
  check("crlf-checkout-and-extra-local-documents-cannot-change-shipped-knowledge", () => {
    const before = normalize(fs.readFileSync(path.join(source, generated)));
    for (const file of files)
      fs.writeFileSync(path.join(source, file), normalize(fs.readFileSync(path.join(source, file))).replace(/\n/g, "\r\n"));
    fs.writeFileSync(path.join(source, "docs/local-private.md"), "PRIVATE_LOCAL_SOURCE_MUST_NOT_ENTER_INDEX");
    assert.equal(run(["--check"]).status, 0);
    assert.equal(run([]).status, 0);
    const after = fs.readFileSync(path.join(source, generated), "utf8");
    assert.equal(after, before); assert(!after.includes("PRIVATE_LOCAL_SOURCE_MUST_NOT_ENTER_INDEX"));
    return { canonicalOutputSHA256: hash(after), lineEndings: "CRLF", localFilesIgnored: true };
  });
  check("missing-required-guide-fails-without-overwriting-last-valid-index", () => {
    const file = path.join(source, "docs/ASSISTANT_USER_GUIDE.md");
    const saved = file + ".preserved";
    const before = fs.readFileSync(path.join(source, generated));
    fs.renameSync(file, saved);
    try {
      assert.notEqual(run([]).status, 0);
      assert.deepEqual(fs.readFileSync(path.join(source, generated)), before);
    } finally { fs.renameSync(saved, file); }
    assert.equal(run(["--check"]).status, 0);
    return { failureWasExpected: true, lastValidIndexPreserved: true };
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  save(); console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
}
