"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Official-GUI-Consumption-20261020-01";
const mode = process.argv[2], iteration = process.argv[3] || "01";
assert(["related", "build", "dev"].includes(mode));
const output = path.join(qa, `${mode}-${iteration}`); assert(!fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const prep = read(path.join(root, "output/official-gui-consumption-20261020-01/preparation.json"));
const files = ["GameCli_framework/src/components/player/ChoicePanel.tsx", "GameCli_framework/src/styles/player.css"];
const report = { status: "RUNNING", at: new Date().toISOString(), mode, steps: [], modelRequests: 0,
  sources: files.map(file => ({ file, sha256: sha(path.join(root, file)) })),
  scope: "SOURCE_GUI_CHOICE_IMAGE_GATES_AND_DEV_BUILD_NOT_INSTALLED_ACCEPTANCE" };
fs.copyFileSync(__filename, path.join(output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
async function run(name, command, args, env = {}) {
  const step = { name, command: [command, ...args], at: new Date().toISOString(), status: "RUNNING" };
  report.steps.push(step); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(path.join(output, `${name}.log`), { flags: "wx" });
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AGENTVN_TEST_PROJECT: prep.input, AGENTVN_WORKSPACE_OUTPUT: path.join(output, name),
      PROFILE_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]", PROFILE_DPR: "1",
      PROFILE_REDUCED: "", PROFILE_FAST: "", PROFILE_HEADFUL: "", ...env } });
  step.pid = child.pid; save(); let text = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { log.write(bytes); text += bytes; });
  try {
    step.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    assert.equal(step.exitCode, 0, `${name}: ${text.slice(-4000)}`);
    step.evidencePaths = [...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(m => m[1].trim());
    step.status = "PASS"; console.log(`PASS ${name}`);
  } finally {
    if (step.status !== "PASS") step.status = "FAILED";
    log.end(); step.finishedAt = new Date().toISOString(); save();
  }
}
function prior(name, expectedSteps) {
  const file = name === "related" && process.env.AGENTVN_GUI_RELATED_GATES
    ? process.env.AGENTVN_GUI_RELATED_GATES
    : path.join(qa, `${name}-${name === "related" ? "02" : "01"}/report.json`);
  const data = read(file);
  assert.equal(data.status, "PASS"); assert.equal(data.steps.length, expectedSteps);
  assert(data.steps.every(s => s.status === "PASS" && s.exitCode === 0));
  for (const entry of data.sources) assert.equal(sha(path.join(root, entry.file)), entry.sha256);
  return { path: file, sha256: sha(file), steps: data.steps.length };
}
function browserEvidence(file, expectedCases, allowedRuntimeChanges = []) {
  const data = read(file); assert.equal(data.status, "PASS"); assert.equal(data.cases.length, expectedCases);
  assert(data.cases.every(c => c.status === "PASS")); assert.equal(data.cleanup.status, "PASS");
  const changes = [];
  for (const entry of data.sources || []) {
    const current = sha(path.join(root, entry.file));
    if (current === entry.sha256) continue;
    assert(allowedRuntimeChanges.includes(entry.file), `Stale evidence: ${entry.file}`);
    const baseline = path.join("F:/AgentVN/Checkpoints/Official-GUI-Consumption-20261020-01/files", entry.file);
    assert.equal(sha(baseline), entry.sha256, "Pre-fix UI source must match saved checkpoint");
    changes.push({ file: entry.file, before: entry.sha256, current });
  }
  return { path: file, sha256: sha(file), cases: data.cases.length, changes };
}
(async () => {
  if (mode === "related") {
    for (const name of ["choice-option-contract", "choice-button-style-contract", "renpy-gui-import-contract-test",
      "renpy-gui-import-apply-test", "renpy-gui-archive-scan-test", "renpy-layout-runtime-test", "renpy-button-role-model-test",
      "runtime-layout-profiles-test", "runtime-screen-transition-contract", "runtime-exit-flow-test",
      "runtime-save-queue-test", "editor-workspace-contract"])
      await run(name, process.execPath, [`scripts/${name}.cjs`]);
    await run("shared-image-frames", process.execPath, ["scripts/renpy-button-frame-playwright.cjs"]);
  } else if (mode === "build") {
    report.related = prior("related", 13);
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    for (const task of ["typecheck", "build"])
      await run(`editor-${task}`, process.execPath, [npm, "--prefix", path.join(root, "editor"), "run", task]);
    await run("gamecli-build", process.execPath, [npm, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
    await run("editor-player-preview-export", process.execPath, ["scripts/runtime-layout-profiles-playwright.cjs", "--case=player-layout-export"]);
  } else {
    report.related = prior("related", 13); report.build = prior("build", 4);
    report.ui = browserEvidence(path.join(qa, "editor-smoke-02/report.json"), 1, files);
    // Editor evidence precedes the isolated Runtime-only fix: compare all
    // unaffected sources and explicitly identify the two changed Runtime files.
    const ui = read(report.ui.path);
    report.ui.sourceBoundary = "Real GUI authoring/export before Runtime-only image-priority fix; same unmodified exported bytes consumed after fix.";
    report.player = browserEvidence(path.join(qa, "player-full-01/report.json"), 12);
    report.protection = browserEvidence(path.join(qa, "choice-protection-01/report.json"), 12);
    assert(ui.cases[0].portable.realReimport && ui.cases[0].cartridge.assets.length === 6);
    const dev = path.join(root, "AgentVN Dev.exe");
    report.before = { sha256: sha(dev), modifiedAt: fs.statSync(dev).mtime.toISOString() };
    await run("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.dev = { path: dev, sha256: sha(dev),
      compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
      modifiedAt: fs.statSync(dev).mtime.toISOString(), pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
    assert.equal(report.dev.sha256, report.dev.compiledSha256); assert(!report.dev.pending);
    assert.notEqual(report.before.modifiedAt, report.dev.modifiedAt);
  }
  for (const entry of report.sources) assert.equal(sha(path.join(root, entry.file)), entry.sha256);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, output, error: report.error })); });
