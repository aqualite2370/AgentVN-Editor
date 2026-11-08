"use strict";
// Deliver the already-built candidate, preserving both Git index and private author data.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const cp = require("node:child_process"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), target = "D:/AgentVN";
const guidance = process.argv[3] === "preflight-guidance";
assert(process.argv[3] === undefined || guidance);
const base = guidance ? "F:/AgentVN/QA/Dev-Delivery-1955-20261108-01" : "F:/AgentVN/QA/Dev-Delivery-1954-20261108-01";
const backup = guidance ? "F:/AgentVN/Checkpoints/Dev-Delivery-1955-20261108-01"
  : "F:/AgentVN/Checkpoints/Dev-Delivery-1954-20261108-01";
const sourceReceipt = guidance ? "F:/AgentVN/QA/Source-Delivery-1955-20261108-01"
  : "F:/AgentVN/QA/Source-Delivery-1954-20261108-01";
const action = process.argv[2]; assert(["prepare", "source", "gates", "publish", "verify"].includes(action));
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), bytes: fs.statSync(p).size, sha256: sha(p) });
const git = args => cp.execFileSync("git", args, { cwd: target, windowsHide: true,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8" }).trim();
const state = () => ({ head: git(["rev-parse", "HEAD"]),
  index: desc(path.resolve(target, git(["rev-parse", "--git-path", "index"]))) });
function safe(dir, relative) {
  assert(relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes(".."));
  let current = path.resolve(dir);
  for (const bit of relative.split(/[\\/]/)) {
    current = path.join(current, bit);
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), current);
  }
  assert(current.startsWith(path.resolve(dir) + path.sep)); return current;
}
function walk(dir, relative = "") {
  return fs.readdirSync(path.join(dir, relative), { withFileTypes: true }).flatMap(e => {
    assert(!e.isSymbolicLink()); const name = path.join(relative, e.name);
    return e.isDirectory() ? walk(dir, name) : [name];
  });
}
if (action === "prepare") {
  assert(!fs.existsSync(base) && !fs.existsSync(backup)); fs.mkdirSync(base); fs.mkdirSync(backup);
}
const output = path.join(base, action + ".json"); assert(!fs.existsSync(output));
const report = { status: "RUNNING", action, before: state(), startedAt: new Date().toISOString(), commands: [], models: 0 };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
async function gate(name, prefix, script) {
  const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const log = path.join(base, name + ".log"), fd = fs.openSync(log, "wx");
  const row = { name, command: [process.execPath, npm, "--prefix", prefix, "run", script], log, status: "RUNNING" };
  report.commands.push(row); save();
  try {
    const child = cp.spawn(row.command[0], row.command.slice(1), { cwd: target, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, 0, log); row.status = "PASS";
  } finally { fs.closeSync(fd); save(); }
}
(async () => {
  if (action !== "prepare") assert(!require("./lib/current-native-editor-session.cjs").rows()
    .some(p => /^(AgentVN Dev|agentvn-editor)\.exe$/i.test(p.Name)), "Finish natural close before writes");
  if (action === "prepare") {
    if (!guidance)
      assert.equal(read("F:/AgentVN/QA/Novel-Range-Restore-Default-20261108-05/report.json").status, "PASS_SUPPORTED_HOME_RESTORE");
    assert.equal(read(path.join(sourceReceipt, "verify.json")).status, "PASS");
    assert.equal(read(guidance
      ? "F:/AgentVN/QA/Preflight-Guidance-Release-1955-20261108-01/installed-terminal-audit.json"
      : "F:/AgentVN/QA/Novel-Range-Release-1954-20261108-02/installed-terminal-audit.json").status,
    guidance ? "PASS_INSTALLED_PREFLIGHT_GUIDANCE_TERMINAL" : "PASS_LIMITED_INSTALLED_RANGE_RECOVERY_TERMINAL");
    const old = read(guidance ? "F:/AgentVN/QA/Dev-Delivery-1954-20261108-01/prepare.json"
      : "F:/AgentVN/QA/Dev-Delivery-1953-20261107-01/prepare.json");
    const reviewedHotfix = guidance ? {} : {
      "backend/app/services/novel_import_service.py": "bcb9deca2a6983371b6391f5f9fbfd676d870639e8e292829c8e66181c34a54f",
      "backend/app/services/novel_outline_pipeline.py": "066689d4cc2c708ac92128c5baec4072c1e59e8d4eb38352a03e973111d965eb",
      "editor/src/store/novelImportStore.ts": "dd98b61b72fee3527086de5189562c4562202bb7716d474cad857f02744f589c"
    };
    for (const f of old.all)
      assert.equal(sha(safe(target, f.relative)), reviewedHotfix[f.relative.replace(/\\/g, "/")] || f.source.sha256,
        "Unreviewed D change: " + f.relative);
    report.baselineFiles = old.all.length; report.all = []; report.items = [];
    const included = new Set();
    function include(relative, input, kind) {
      relative = relative.replace(/\\/g, "/"); if (included.has(relative)) return; included.add(relative);
      const destination = safe(target, relative), source = desc(input);
      report.all.push({ relative, source, kind });
      const original = fs.existsSync(destination) ? desc(destination) : null;
      if (original?.sha256 === source.sha256) return;
      const item = { relative, source, original, kind };
      if (original) {
        const saved = safe(backup, relative); fs.mkdirSync(path.dirname(saved), { recursive: true });
        fs.copyFileSync(destination, saved, fs.constants.COPYFILE_EXCL);
        assert.equal(sha(saved), original.sha256); item.backup = desc(saved);
      }
      report.items.push(item);
    }
    for (const f of read(path.join(sourceReceipt, "prepare.json")).files) {
      assert.equal(sha(f.frozen.path), f.frozen.sha256); include(f.relative, f.frozen.path, "source");
    }
    for (const f of guidance ? [] : ["editor/src/novel-import/persistence.ts", "editor/src/store/novelImportStore.ts"])
      include(f, path.join(root, f), "source");
    const bundle = path.join(root, "editor/src-tauri/bundle-workspace");
    for (const f of walk(bundle)) include(path.join("editor/src-tauri/bundle-workspace", f), path.join(bundle, f), "resource");
    for (const f of ["editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe", "AgentVN Dev.exe"])
      include(f, path.join(root, f), f === "AgentVN Dev.exe" ? "launcher" : "resource");
  } else {
    const prepared = read(path.join(base, "prepare.json")); assert.equal(prepared.status, "PASS");
    if (action === "gates") {
      assert.equal(read(path.join(base, "source.json")).status, "PASS");
      await gate("typecheck", "editor", "typecheck"); await gate("editor-build", "editor", "build");
      await gate("gamecli-build", "GameCli_framework", "build");
    } else if (action === "verify") {
      assert.equal(read(path.join(base, "publish.json")).status, "PASS");
      for (const f of prepared.all) assert.equal(sha(safe(target, f.relative)), f.source.sha256, f.relative);
      for (const f of prepared.items) if (f.backup) assert.equal(sha(f.backup.path), f.original.sha256);
      report.verifiedFiles = prepared.all.length; report.changed = prepared.items.length;
      report.dev = desc(path.join(target, "AgentVN Dev.exe"));
      assert.equal(report.dev.sha256, guidance
        ? read("F:/AgentVN/QA/Preflight-Guidance-Release-1955-20261108-01/report.json").workspaceDev.sha256
        : "cd131cae0fee1a6480baa0867264d72e54925ab4be5563b2261cb121cc9618fc");
    } else {
      if (action === "publish") assert.equal(read(path.join(base, "gates.json")).status, "PASS");
      const items = prepared.items.filter(f => action === "source" ? f.kind === "source" : f.kind !== "source");
      for (const f of items) {
        const destination = safe(target, f.relative);
        assert.equal(fs.existsSync(destination) ? sha(destination) : null, f.original?.sha256 ?? null);
        assert.equal(sha(f.source.path), f.source.sha256);
      }
      for (const f of items) {
        const destination = safe(target, f.relative); fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(f.source.path, destination); assert.equal(sha(destination), f.source.sha256);
      }
      report.copied = items.length;
    }
  }
  report.after = state(); assert.deepEqual(report.after, report.before); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, action, changed: report.items?.length, error: report.error })); });
