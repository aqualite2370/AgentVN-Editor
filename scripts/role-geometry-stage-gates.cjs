"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Role-Geometry-Source-20261020-02";
const mode = process.argv[2]; assert(["related", "build", "dev"].includes(mode));
const out = path.join(qa, `${mode}-${process.argv[3] || "01"}`); assert(!fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const sourceFiles = ["shared/cartridge/renpyGui.ts", "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/styles/renpy-button-roles.css", "editor/src/components/advanced/RenpyButtonRoleEditor.tsx"];
const report = { status: "RUNNING", mode, at: new Date().toISOString(), steps: [], modelRequests: 0,
  scope: "SOURCE_ROLE_GEOMETRY_GATES_NOT_INSTALLED_ACCEPTANCE",
  sources: sourceFiles.map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const input = path.join(out, "role-geometry-isolated.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture("role-geometry-isolated-20261020")), { flag: "wx" });
const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
async function execute(name, executable, args, env = {}) {
  const item = { name, command: [executable, ...args], at: new Date().toISOString(), status: "RUNNING" };
  report.steps.push(item); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(path.join(out, `${name}.log`), { flags: "wx" });
  const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: path.join(out, name),
      PROFILE_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]",
      PROFILE_MENU_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]",
      PROFILE_DPR: "1", PROFILE_REDUCED: "", PROFILE_FAST: "", PROFILE_HEADFUL: "",
      ...env } });
  item.pid = child.pid; save(); let text = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { log.write(b); text += b; });
  try {
    item.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    assert.equal(item.exitCode, 0, `${name}: ${text.slice(-3000)}`);
    item.evidencePaths = [...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(m => m[1].trim());
    item.status = "PASS"; console.log(`PASS ${name}`);
  } finally {
    if (item.status !== "PASS") item.status = "FAILED";
    log.end(); item.finishedAt = new Date().toISOString(); save();
  }
}
function prior(mode) {
  const file = path.join(qa, `${mode}-${mode === "related" ? "05" : "01"}/report.json`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(data.status, "PASS");
  for (const s of data.sources) assert.equal(sha(path.join(root, s.file)), s.sha256, `Stale ${mode} evidence`);
  return { file, sha256: sha(file), steps: data.steps.length };
}
(async () => {
  if (mode === "related") {
    for (const script of ["role-geometry-sizing-test", "renpy-button-role-model-test", "renpy-layout-runtime-test",
      "runtime-layout-profiles-test", "renpy-help-layout-test", "runtime-screen-transition-contract",
      "ui-skin-missing-exit-layout-test", "runtime-exit-flow-test", "runtime-save-queue-test", "editor-workspace-contract"])
      await execute(script, process.execPath, [`scripts/${script}.cjs`]);
    await execute("opacity-behavior", process.execPath, ["scripts/renpy-role-opacity-playwright.cjs", "--fast"]);
    await execute("snapshot-handoff", process.execPath, ["scripts/renpy-role-snapshot-playwright.cjs", "--fast"]);
  } else if (mode === "build") {
    report.related = prior("related");
    for (const task of ["typecheck", "build"])
      await execute(`editor-${task}`, process.execPath, [npm, "--prefix", path.join(root, "editor"), "run", task]);
    await execute("gamecli-build", process.execPath, [npm, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
    await execute("editor-role-preview", process.execPath,
      ["scripts/runtime-layout-profiles-playwright.cjs", "--case=button-role-editor"]);
  } else {
    report.related = prior("related"); report.build = prior("build");
    const matrix = path.join(qa, "green-full-01/report.json"), data = JSON.parse(fs.readFileSync(matrix, "utf8"));
    assert.equal(data.status, "PASS"); assert.equal(data.cases.length, 12);
    assert(data.cases.every(c => c.status === "PASS" && c.samples.length === 17));
    for (const s of data.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
    const explicit = JSON.parse(fs.readFileSync(path.join(qa, "explicit-smoke-02/report.json"), "utf8"));
    assert.equal(explicit.status, "PASS"); assert.equal(explicit.cases.length, 2);
    const dev = path.join(root, "AgentVN Dev.exe");
    report.before = { sha256: sha(dev), modifiedAt: fs.statSync(dev).mtime.toISOString() };
    await execute("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.dev = { path: dev, sha256: sha(dev), compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
      modifiedAt: fs.statSync(dev).mtime.toISOString(), pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
    assert.equal(report.dev.sha256, report.dev.compiledSha256); assert(!report.dev.pending);
    assert.notEqual(report.before.modifiedAt, report.dev.modifiedAt, "Dev not actually overwritten");
  }
  for (const s of report.sources) assert.equal(sha(path.join(root, s.file)), s.sha256, "Source changed while testing");
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
