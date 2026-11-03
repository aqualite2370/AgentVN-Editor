"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Dialog-Portrait-Authoring-20261020-01";
const [mode, iteration = "01"] = process.argv.slice(2);
assert(["related", "build", "dev"].includes(mode));
const out = path.join(qa, `${mode}-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const prep = read(path.join(root, "output/dialog-portrait-authoring-20261020-01/preparation.json"));
const files = [...prep.saved.filter(f => !f.absent && !/plans\/|AGENTS.md/.test(f.file)).map(f => f.file),
  "shared/cartridge/dialogPortraitLayout.ts", "editor/src/components/advanced/DialogPortraitLayoutEditor.tsx"];
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "SOURCE_PORTRAIT_AUTHORING_GATES_NOT_INSTALLED",
  modelRequests: 0, mode, steps: [], sources: [...new Set(files)].map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
async function run(name, command, args, env = {}) {
  const step = { name, command: [command, ...args], status: "RUNNING", at: new Date().toISOString() };
  report.steps.push(step); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(path.join(out, `${name}.log`), { flags: "wx" });
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, AGENTVN_TEST_PROJECT: prep.input, AGENTVN_WORKSPACE_OUTPUT: path.join(out, name),
    PROFILE_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]", PROFILE_DPR: "1",
    PROFILE_REDUCED: "", PROFILE_FAST: "", PROFILE_HEADFUL: "", ...env } });
  step.pid = child.pid; save(); let text = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { log.write(bytes); text += bytes; });
  try {
    step.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    assert.equal(step.exitCode, 0, text.slice(-5000)); step.status = "PASS"; console.log(`PASS ${name}`);
  } finally { if (step.status !== "PASS") step.status = "FAILED"; log.end(); step.finishedAt = new Date().toISOString(); save(); }
}
function prior(mode, count, env) {
  const file = process.env[env]; assert(file, `Explicit ${env} required`);
  const r = read(file); assert.equal(r.status, "PASS"); assert.equal(r.steps.length, count);
  assert(r.steps.every(s => s.status === "PASS" && s.exitCode === 0));
  for (const s of r.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
  return { path: file, sha256: sha(file), mode };
}
function behavior(env, checks) {
  const file = process.env[env]; assert(file, env); const r = read(file);
  assert.equal(r.status, "PASS"); assert.equal(r.cases.length, 12);
  assert(r.cases.every(c => c.status === "PASS" && c.checks.length >= checks));
  assert.equal(new Set(r.cases.map(c => c.key)).size, 12);
  assert.equal(r.cleanup.status, "PASS"); assert.equal(r.modelRequests, 0);
  for (const s of r.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
  for (const c of r.cases) {
    assert.equal(c.screenshot.png.width, c.width * c.dpr); assert.equal(c.screenshot.png.height, c.height * c.dpr);
    assert.equal(sha(c.screenshot.path), c.screenshot.sha256);
  }
  return { path: file, sha256: sha(file), cases: r.cases.length };
}
(async () => {
  if (mode === "related") {
    for (const name of ["dialog-portrait-layout-model-test", "installed-dialog-portrait-oracle-test",
      "installed-dialog-pagination-test", "dialogue-mode-layout-model-test", "dialogue-mode-layout-export-test",
      "runtime-layout-profiles-test", "ui-skin-legacy-compat-contract", "ui-skin-style-component-health-contract",
      "runtime-screen-transition-contract", "quick-menu-metrics-contract", "quick-menu-container-contract", "editor-workspace-contract"])
      await run(name, process.execPath, [`scripts/${name}.cjs`]);
    await run("default-portrait-smoke", process.execPath, ["scripts/dialog-portrait-source-playwright.cjs"], {
      AGENTVN_DIALOG_PORTRAIT_OUTPUT: path.join(out, "default-portrait-evidence"), AGENTVN_DIALOG_PORTRAIT_SMOKE: "1",
      AGENTVN_DIALOG_PORTRAIT_PLACEMENT: "name-left",
    });
  } else if (mode === "build") {
    report.related = prior("related", 13, "AGENTVN_PORTRAIT_RELATED_REPORT");
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    for (const task of ["typecheck", "build"])
      await run(`editor-${task}`, process.execPath, [npm, "--prefix", path.join(root, "editor"), "run", task]);
    await run("gamecli-build", process.execPath, [npm, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
  } else {
    report.related = prior("related", 13, "AGENTVN_PORTRAIT_RELATED_REPORT");
    report.build = prior("build", 3, "AGENTVN_PORTRAIT_BUILD_REPORT");
    report.editor = behavior("AGENTVN_PORTRAIT_EDITOR_REPORT", 5);
    report.player = behavior("AGENTVN_PORTRAIT_PLAYER_REPORT", 2);
    const target = path.join(root, "AgentVN Dev.exe");
    report.devBefore = { sha256: sha(target), modifiedAt: fs.statSync(target).mtime.toISOString() };
    report.overwriteEvents = [];
    const watcher = fs.watch(root, (event, file) => {
      if (String(file).toLowerCase() === "agentvn dev.exe") report.overwriteEvents.push({ event, at: new Date().toISOString() });
    });
    try {
      await run("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts/build-dev-launcher.ps1")]);
    } finally { watcher.close(); }
    report.dev = { path: target, sha256: sha(target), debugSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
      modifiedAt: fs.statSync(target).mtime.toISOString(), pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
    assert.equal(report.dev.sha256, report.dev.debugSha256); assert(!report.dev.pending);
    assert.notEqual(report.dev.modifiedAt, report.devBefore.modifiedAt); assert(report.overwriteEvents.length > 0);
  }
  for (const s of report.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
