"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/renpy-modal-focus-gates", runId);
fs.mkdirSync(output, { recursive: true });
const project = fixture(`modal-focus-${crypto.randomUUID()}`);
const input = path.join(output, "isolated-small-project.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sources = [
  "shared/ui/slowFocusGlow.css",
  "GameCli_framework/src/components/common/Modal.tsx",
  "GameCli_framework/src/components/shell/QuickLoadDialog.tsx",
  "GameCli_framework/src/styles/renpy-button-roles.css",
  "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
  "GameCli_framework/src/app/runtimePageCrossfade.ts",
  "scripts/renpy-quick-save-playwright.cjs",
  "scripts/runtime-modal-visual-playwright.cjs",
  "scripts/renpy-modal-focus-stage-gates.cjs",
];
const report = { runId, status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "E4 default Runtime dialog focus; not full Ren'Py/Release/Android acceptance",
  productChange: "Default non-save Ren'Py modal actions excluded from shared focus glow; Editor unaffected",
  input, projectId: project.project_id, steps: [],
  sourceBefore: sources.map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
// Recoverable candidate snapshot; all prior work and evidence stays in place.
for (const file of sources) {
  const destination = path.join(output, "candidate-snapshot", file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file), destination, fs.constants.COPYFILE_EXCL);
}
const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
async function execute(name, executable, args, extraEnv = {}, expectedCases) {
  const step = { name, command: [executable, ...args], status: "RUNNING",
    startedAt: new Date().toISOString(), output: path.join(output, name),
    input: path.join(output, `${name}-isolated.vnproj`) };
  fs.copyFileSync(input, step.input, fs.constants.COPYFILE_EXCL);
  report.steps.push(step); save();
  console.log(`START ${name}`);
  const log = fs.createWriteStream(path.join(output, `${name}.log`), { flags: "wx" });
  let text = "";
  try {
    const child = spawn(executable, args, { cwd: root, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
        AGENTVN_TEST_PROJECT: step.input, AGENTVN_WORKSPACE_OUTPUT: step.output,
        PROFILE_DPR: "", PROFILE_REDUCED: "", QUICK_SAVE_TEST_PORT: "0",
        RENPY_FADE_FAST: "", RENPY_FADE_HEADFUL: "",
        AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd",
        EXIT_VIEWPORTS: "1920x1080,2560x1440,3840x2160", EXIT_FAST: "",
        ...extraEnv } });
    step.pid = child.pid; save();
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
      text += data.toString(); log.write(data);
    });
    step.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", resolve);
    });
    step.evidencePaths = [...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(match => match[1].trim());
    if (step.exitCode !== 0) throw Error(`${name} failed (${step.exitCode})\n${text.slice(-4000)}`);
    if (expectedCases !== undefined) {
      const evidence = step.evidencePaths.at(-1);
      const result = JSON.parse(fs.readFileSync(
        evidence.endsWith(".json") ? evidence : path.join(evidence, "report.json"), "utf8"));
      if (result.status !== "PASS" || result.cases.length !== expectedCases
        || result.cases.some(row => row.status !== "PASS"))
        throw Error(`${name}: expected ${expectedCases} passing browser cases`);
      step.browserCaseCount = result.cases.length;
    }
    step.status = "PASS"; console.log(`PASS ${name}`);
  } catch (error) {
    step.status = "FAILED"; step.error = String(error.stack || error); throw error;
  } finally {
    log.end(); step.finishedAt = new Date().toISOString(); save();
  }
}
const node = (name, script, env = {}, args = [], count) =>
  execute(name, process.execPath, [`scripts/${script}.cjs`, ...args], env, count);
(async () => {
  try {
    for (const reduced of [false, true]) for (const dpr of [1, 2]) {
      const mode = `${reduced ? "reduced" : "normal"}-dpr${dpr}`;
      const env = { PROFILE_DPR: String(dpr), PROFILE_REDUCED: reduced ? "1" : "" };
      await node(`quick-load-${mode}`, "renpy-quick-save-playwright", env, [], 7);
      await node(`exit-delete-modal-${mode}`, "runtime-modal-visual-playwright", env, [], 12);
    }
    for (const dpr of [1, 2]) await node(`authored-modal-role-dpr${dpr}`,
      "renpy-quick-save-playwright", { PROFILE_DPR: String(dpr) }, ["--button-roles"], 7);
    await node("runtime-transition-contract", "runtime-screen-transition-contract");
    await node("renpy-crossfade-matrix", "renpy-page-crossfade-playwright", {}, [], 96);
    await node("agentvn-blackout-matrix", "runtime-agentvn-blackout-playwright", {}, [], 24);
    await node("runtime-exit-save", "runtime-exit-behavior-playwright");
    for (const task of ["typecheck", "build"]) await execute(`editor-${task}`, process.execPath,
      [npmCli, "--prefix", path.join(root, "editor"), "run", task]);
    await execute("gamecli-build", process.execPath,
      [npmCli, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
    await node("editor-workspace-contract", "editor-workspace-contract");
    await node("editor-workspace", "editor-workspace-playwright");
    await node("editor-tools-transitions", "advanced-tools-transition-regression-playwright",
      { ADVANCED_TOOLS_HEADFUL: "1" });
    const dev = path.join(root, "AgentVN Dev.exe"), before = fs.statSync(dev).mtimeMs;
    await execute("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.dev = { path: dev, modifiedAt: fs.statSync(dev).mtime.toISOString(),
      sha256: sha(dev), compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
      overwritten: fs.statSync(dev).mtimeMs > before,
      pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
    if (!report.dev.overwritten || report.dev.sha256 !== report.dev.compiledSha256 || report.dev.pending)
      throw Error("Dev actual overwrite/hash/pending verification failed");
    report.resources = collectStageResourceEvidence(root, sources.filter(file => !file.startsWith("scripts/")));
    report.sourceAfter = report.sourceBefore.map(row => ({ ...row,
      unchanged: sha(path.join(root, row.file)) === row.sha256 }));
    if (report.sourceAfter.some(row => !row.unchanged)) throw Error("Frozen candidate changed during acceptance");
    if (report.steps.length !== 21 || report.steps.some(row => row.status !== "PASS"))
      throw Error("Slice gate incomplete");
    report.status = "E4_MODAL_FOCUS_SLICE_PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    console.error(report.error); process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
