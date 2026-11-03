"use strict";
// Audit a frozen source snapshot, not the changing worktree or a release binary.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const base = "F:/AgentVN/QA/Source-Delivery-20261103-01";
const number = process.argv[2] || "02"; assert.match(number, /^\d{2}$/);
const out = path.join(base, "snapshot-" + number), target = path.join(out, "audit-01.json");
assert(!fs.existsSync(target));
const source = path.join(out, "source"), hash = b => crypto.createHash("sha256").update(b).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const describe = file => ({ path: file, bytes: fs.statSync(file).size, sha256: hash(fs.readFileSync(file)) });
const preparation = read(path.join(out, "report.json")), gates = read(path.join(out, "gates-report.json"));
const result = { status: "RUNNING", scope: "FROZEN_SOURCE_AND_FRONTEND_BUILDS_NOT_RELEASE_OR_FUNCTIONAL_ACCEPTANCE",
  startedAt: new Date().toISOString(), preparation: describe(path.join(out, "report.json")),
  gates: describe(path.join(out, "gates-report.json")), checks: [] };
function check(name, fn) { fn(); result.checks.push({ name, status: "PASS" }); }
try {
  check("archive-tree-source-inventory-and-real-index-receipts-agree", () => {
    assert.equal(preparation.status, "PREPARED_NOT_BUILT");
    assert.equal(preparation.gitStatePreserved, true);
    assert.deepEqual(preparation.before, preparation.after);
    assert.equal(hash(fs.readFileSync(preparation.archive.path)), preparation.archive.sha256);
    const treePaths = execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", preparation.tree],
      { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 }).split("\0").filter(Boolean).sort();
    assert(preparation.files.length > 1000);
    assert.deepEqual(treePaths, preparation.files.map(f => f.relative).sort());
    result.files = treePaths.length; result.tree = preparation.tree; result.archive = preparation.archive;
  });
  check("every-original-source-byte-is-preserved-after-build", () => {
    for (const file of preparation.files)
      assert.equal(hash(fs.readFileSync(path.join(source, file.relative))), file.archiveSha256, file.relative);
    assert.deepEqual(gates.lineEndingOnlyChanges, []);
  });
  check("all-seven-ordered-processes-completed-with-hashed-logs-and-archive-cwd", () => {
    assert.equal(gates.status, "PASS");
    assert.deepEqual(gates.commands.map(c => c.name), ["npm-ci-GameCli_framework", "npm-ci-editor",
      "editor-typecheck", "editor-build", "gamecli-build", "knowledge-source-tests", "knowledge-index-tests"]);
    let previous = 0;
    for (const command of gates.commands) {
      assert.equal(command.status, "PASS"); assert.equal(command.exitCode, 0);
      assert.equal(command.cwd, source); assert(Number.isInteger(command.pid) && command.pid > 0);
      assert(Date.parse(command.startedAt) >= previous);
      previous = Date.parse(command.finishedAt); assert(previous >= Date.parse(command.startedAt));
      assert.equal(hash(fs.readFileSync(command.log.path)), command.log.sha256);
      assert(command.log.bytes > 0);
    }
    assert.equal(result.preparation.sha256, gates.sourcePreparation.sha256);
  });
  check("fresh-dependencies-and-real-frontend-output-exist-inside-snapshot", () => {
    for (const area of ["editor", "GameCli_framework"]) {
      const dependency = fs.realpathSync(path.join(source, area, "node_modules/esbuild/package.json"));
      assert(dependency.startsWith(path.join(source, area, "node_modules") + path.sep));
      assert(fs.statSync(path.join(source, area, "dist/index.html")).size > 0);
      assert(fs.readdirSync(path.join(source, area, "dist/assets")).some(f => f.endsWith(".js")));
    }
  });
  check("knowledge-has-nonempty-passing-cases-and-no-model-evidence-claim", () => {
    result.knowledge = {};
    for (const name of ["knowledge-tests", "knowledge-index-tests"]) {
      const report = read(path.join(out, name, "report.json"));
      assert.equal(report.status, "PASS"); assert(report.cases.length > 0);
      assert(report.cases.every(c => c.status === "PASS"));
      result.knowledge[name] = { cases: report.cases.length, receipt: describe(path.join(out, name, "report.json")) };
    }
    assert.equal(gates.paidRequests, 0); assert.equal(gates.editorReleases, 0);
  });
  check("private-records-and-generated-payloads-absent-license-notices-retained", () => {
    for (const name of ["plans", "AGENTS.md", ".git", ".env", "data", "output", "releases",
      "editor/src-tauri/bundle-workspace", "editor/src-tauri/binaries", "backend/data"])
      assert(!fs.existsSync(path.join(source, name)), name);
    for (const name of ["LICENSE", "LICENSE.en.md", "THIRD_PARTY_NOTICES.md",
      "windows-offline-tools/NSIS/COPYING", "GameCli_framework/vendor/tauri-plugin-fs/LICENSE_MIT",
      "GameCli_framework/vendor/tauri-plugin-fs/LICENSE_APACHE-2.0"])
      assert(fs.statSync(path.join(source, name)).size > 0, name);
    assert.equal(read(path.join(base, "snapshot-01/report.json")).status, "FAILED");
  });
  result.status = "PASS";
} catch (error) { result.status = "FAILED"; result.error = String(error.stack || error); process.exitCode = 1; }
result.finishedAt = new Date().toISOString();
fs.writeFileSync(target, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: result.status, checks: result.checks.length, target, error: result.error }));
