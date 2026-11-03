"use strict";
// Source/Dev gates only. Does not replace the unchanged installed Release evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Home-Resume-Repair-20261021-01";
const mode = process.argv[2]; assert(["check", "dev"].includes(mode));
const out = path.join(qa, mode + "-01"); assert(!fs.existsSync(out), "Fresh gate evidence required");
fs.mkdirSync(out);
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: p, sha256: sha(p), bytes: fs.statSync(p).size, modifiedAt: fs.statSync(p).mtime.toISOString() });
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", scope: "HOME_LABEL_SOURCE_DEV_NOT_INSTALLED_RELEASE",
  startedAt: new Date().toISOString(), mode, commands: [], realModelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const sourceNames = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString("utf8").split("\0"))].filter(f =>
  /^(editor|GameCli_framework|backend|shared|scripts)\//.test(f) && fs.existsSync(path.join(root, f))
  && fs.statSync(path.join(root, f)).isFile());
report.sources = sourceNames.map(f => desc(path.join(root, f)));
const frozenExe = "F:/AgentVN/QA/Component-Preview-Release-20261021-02/installed-editor/agentvn-editor.exe";
report.frozen = [frozenExe, path.join(root, ".git/index"),
  path.join(root, "editor/src/app/App.tsx"), path.join(root, "editor/src/app/App.css"),
  path.join(root, "editor/src/styles/editor-tokens.css"), path.join(root, "GameCli_framework/src/styles/shell.css")]
  .map(desc);
report.beforeDev = desc(path.join(root, "AgentVN Dev.exe"));
async function command(label, executable, args) {
  const log = path.join(out, `${report.commands.length + 1}.log`), fd = fs.openSync(log, "wx");
  const row = { label, command: [executable, ...args], startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save(); console.log(`START ${label}`);
  try {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd],
      env: { ...process.env, TEMP: out, TMP: out, AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED: "",
        AGENTVN_TEST_PROJECT: path.join(qa, "首页标签 隔离小工程.vnproj"),
        AGENTVN_WORKSPACE_OUTPUT: path.join(out, `test-${report.commands.length}`) } });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    row.status = row.exitCode === 0 ? "PASS" : "FAILED";
  } finally { fs.closeSync(fd); row.log = desc(log); row.finishedAt = new Date().toISOString(); save(); }
  assert.equal(row.status, "PASS", log); console.log(`PASS ${label}`);
}
(async () => {
  const behaviorFile = path.join(qa, "source-green-04/report.json"), behavior = read(behaviorFile);
  assert.equal(behavior.status, "PASS"); assert.equal(behavior.matrix.length, 12);
  assert.equal(behavior.fallbackCases.length, 2); assert.equal(behavior.checks.length, 38);
  assert.equal(behavior.cleanup.status, "PASS");
  assert.equal(sha(behavior.productSource.path), behavior.productSource.sha256);
  report.behavior = desc(behaviorFile);
  if (mode === "check") {
    for (const name of ["editor-ui-acceptance-isolation-contract-test", "editor-workspace-contract"])
      await command(name, process.execPath, [`scripts/${name}.cjs`]);
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
      await command(`${folder} ${task}`, process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
    assert.equal(sha(report.beforeDev.path), report.beforeDev.sha256, "No premature Dev build");
  } else {
    const checkFile = path.join(qa, "check-01/report.json"), check = read(checkFile);
    assert.equal(check.status, "PASS"); assert.equal(check.commands.length, 5);
    assert(check.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    for (const f of check.sources) assert.equal(sha(f.path), f.sha256, f.path);
    report.precondition = desc(checkFile);
    await command("Full Dev build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.dev = desc(path.join(root, "AgentVN Dev.exe"));
    report.debug = desc(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
    assert.equal(report.dev.sha256, report.debug.sha256);
    assert(fs.statSync(report.dev.path).mtimeMs >= Date.parse(report.startedAt), "Root Dev must actually be overwritten");
    await command("Installed resource fault regression", process.execPath, ["scripts/editor-installed-version-resources-test.cjs"]);
  }
  for (const f of [...report.sources, ...report.frozen]) assert.equal(sha(f.path), f.sha256, f.path);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, mode, out, dev: report.dev, error: report.error }, null, 2)); });
