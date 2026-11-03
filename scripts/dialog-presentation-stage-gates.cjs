"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/dialog-presentation-gates", runId);
fs.mkdirSync(output, { recursive: true });
const input = path.join(output, "isolated-small-project.vnproj");
const project = JSON.parse(fs.readFileSync(
  path.join(root, "scripts/fixtures/dialog-presentation-isolated.vnproj"), "utf8"));
project.project_id = `dialogue-stage-${crypto.randomUUID()}`;
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const resources = [
  "editor/src/components/command-editors/DialogPresentationControls.tsx",
  "editor/src/components/editor/PreviewPanel.tsx",
  "editor/src/components/advanced/ProjectSettingsPanel.tsx",
  "editor/src/components/advanced/RenpyRuntimePreview.tsx",
  "editor/src/store/projectStore.ts",
  "editor/src/types/project.ts",
  "editor/src/types/nodes.ts",
  "editor/src/utils/exportScript.ts",
  "GameCli_framework/src/app/App.tsx",
  "GameCli_framework/src/components/player/DialogBox.tsx",
  "GameCli_framework/src/components/player/RuntimeAudio.tsx",
  "GameCli_framework/src/engine/StoryEngine.ts",
  "GameCli_framework/src/engine/validation.ts",
  "GameCli_framework/src/store/runtimeStore.ts",
  "GameCli_framework/src/types/script.ts",
  "GameCli_framework/src/types/settings.ts",
  "GameCli_framework/src/types/save.ts",
  "shared/cartridge/dialogPresentation.ts",
  "shared/cartridge/bubblePlacement.ts",
  "shared/cartridge/runtimeCapabilities.ts",
  "shared/cartridge/constants.ts",
  "shared/cartridge/types.ts",
  "shared/cartridge/validators.ts",
  "backend/app/models/commands.py",
];
const scripts = [
  "dialog-presentation-authoring-playwright", "dialog-presentation-node-preview-playwright",
  "bubble-dialog-playwright", "nvl-page-playwright", "renpy-quick-save-playwright",
  "dialog-presentation-inheritance-test", "dialog-presentation-stage-gates",
];
const report = { runId, status: "RUNNING",
  scope: "E4 C dialogue authoring/export, preview, NVL/bubble and save behavior; not Release/Android acceptance",
  startedAt: new Date().toISOString(), input, projectId: project.project_id, steps: [],
  sourceBefore: [...resources, ...scripts.map(name => `scripts/${name}.cjs`)]
    .map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const resumeArgument = process.argv.find(argument => argument.startsWith("--resume="))?.slice(9);
let previousReport;
if (resumeArgument) {
  const previousPath = path.resolve(resumeArgument);
  previousReport = JSON.parse(fs.readFileSync(previousPath, "utf8"));
  // This narrowly permits a test-only correction. Any product change requires
  // a new candidate matrix; the original failed report is never rewritten.
  const changedTests = new Set(["scripts/dialog-presentation-node-preview-playwright.cjs",
    "scripts/dialog-presentation-stage-gates.cjs"]);
  if (previousReport.scope !== report.scope || !previousReport.sourceBefore?.length)
    throw Error("Cannot reference evidence from a different or untracked stage");
  const oldSources = new Map(previousReport.sourceBefore.map(row => [row.file, row.sha256]));
  for (const row of report.sourceBefore)
    if (!changedTests.has(row.file) && oldSources.get(row.file) !== row.sha256)
      throw Error(`Resume refused: product or unrelated test changed (${row.file})`);
  const oldInput = JSON.parse(fs.readFileSync(previousReport.input, "utf8"));
  const comparable = value => JSON.stringify({ ...value, project_id: "isolated-project" });
  if (comparable(oldInput) !== comparable(project)) throw Error("Resume fixture differs");
  report.referencedRun = { path: previousPath, originalStatus: previousReport.status,
    policy: "unchanged candidate and tests; node-preview and builds execute again" };
}
async function execute(name, executable, args, extraEnv = {}, expectedCases, cwd = root) {
  const previous = previousReport?.steps.find(step => step.name === name && step.status === "PASS");
  const mayReference = previous && !name.startsWith("node-preview-")
    && !name.includes("build") && !name.includes("typecheck");
  if (mayReference) {
    if (previous.exitCode !== 0) throw Error(`Referenced step has no successful exit: ${name}`);
    if (expectedCases !== undefined) {
      const evidence = previous.evidencePaths?.at(-1);
      const result = JSON.parse(fs.readFileSync(
        evidence?.endsWith(".json") ? evidence : path.join(evidence, "report.json"), "utf8"));
      if (result.status !== "PASS" || result.cases?.length !== expectedCases
        || result.cases.some(row => row.status !== "PASS"))
        throw Error(`Referenced ${name} matrix incomplete`);
    }
    report.steps.push({ ...previous, execution: "REFERENCED_UNCHANGED",
      referencedFrom: report.referencedRun.path });
    save(); console.log(`REFERENCE ${name} (unchanged evidence)`); return;
  }
  const step = { name, command: [executable, ...args], cwd, status: "RUNNING",
    execution: "EXECUTED",
    startedAt: new Date().toISOString(), output: path.join(output, name) };
  report.steps.push(step); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(path.join(output, `${name}.log`), { flags: "wx" });
  let text = "";
  try {
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: step.output,
        PROFILE_DPR: "1", PROFILE_REDUCED: "", PRESENTATION_DPR: "1", PRESENTATION_REDUCED: "",
        PRESENTATION_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]",
        BUBBLE_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]",
        BUBBLE_DIALOG_TEST_PORT: "0", NVL_PAGE_TEST_PORT: "0", QUICK_SAVE_TEST_PORT: "0",
        AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd",
        ...extraEnv } });
    step.pid = child.pid; save();
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
      text += data.toString(); log.write(data);
    });
    step.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", resolve);
    });
    step.evidencePaths = [...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(match => match[1].trim());
    if (step.exitCode !== 0) throw Error(`${name} failed (${step.exitCode})\n${text.slice(-2200)}`);
    if (expectedCases !== undefined) {
      const evidence = step.evidencePaths.at(-1);
      if (!evidence) throw Error(`${name}: missing behavior report`);
      const result = JSON.parse(fs.readFileSync(
        evidence.endsWith(".json") ? evidence : path.join(evidence, "report.json"), "utf8"));
      if (result.status !== "PASS" || result.cases.length !== expectedCases
        || result.cases.some(row => row.status !== "PASS"))
        throw Error(`${name}: expected ${expectedCases} actual passing cases`);
      step.caseCount = result.cases.length;
    }
    step.status = "PASS"; console.log(`PASS ${name}`);
  } catch (error) {
    step.status = "FAILED"; step.error = String(error.stack || error); throw error;
  } finally {
    log.end(); step.finishedAt = new Date().toISOString(); save();
  }
}
const node = (name, script, env, count) =>
  execute(name, process.execPath, [`scripts/${script}.cjs`], env, count);
(async () => {
  try {
    await execute("gamecli-preview-build", process.execPath,
      [npmCli, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
    await node("inheritance-export-validation", "dialog-presentation-inheritance-test", {}, 7);
    for (const name of ["nvl-runtime-acceptance", "bubble-placement-contract", "quick-save-policy-test",
      "quick-save-storage-test", "quick-save-runtime-test", "runtime-audio-animation-dedupe-contract",
      "runtime-exit-flow-test"])
      await node(name, name);
    await execute("backend-presentation-validation", "python",
      ["-m", "pytest", "tests/test_dialog_presentation.py", "-q"], {}, undefined, path.join(root, "backend"));
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const label = `dpr${dpr}-${reduced ? "reduced" : "normal"}`;
      const env = { PROFILE_DPR: String(dpr), PROFILE_REDUCED: reduced ? "1" : "",
        PRESENTATION_DPR: String(dpr), PRESENTATION_REDUCED: reduced ? "1" : "" };
      await node(`bubble-${label}`, "bubble-dialog-playwright", env, 3);
      await node(`nvl-${label}`, "nvl-page-playwright", env, 12);
      await node(`quick-save-${label}`, "renpy-quick-save-playwright", env, 7);
      await node(`node-preview-${label}`, "dialog-presentation-node-preview-playwright", env, 3);
      await node(`authoring-${label}`, "dialog-presentation-authoring-playwright", env, 18);
    }
    for (const task of ["typecheck", "build"])
      await execute(`editor-${task}`, process.execPath,
        [npmCli, "--prefix", path.join(root, "editor"), "run", task]);
    await node("editor-workspace-contract", "editor-workspace-contract");
    await node("editor-workspace-browser", "editor-workspace-playwright");
    const dev = path.join(root, "AgentVN Dev.exe"), previousMtime = fs.statSync(dev).mtimeMs;
    await execute("dev-build", "powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/build-dev-launcher.ps1"),
    ]);
    report.dev = { path: dev, modifiedAt: fs.statSync(dev).mtime.toISOString(),
      sha256: sha(dev), compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
      overwritten: fs.statSync(dev).mtimeMs > previousMtime,
      pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
    if (!report.dev.overwritten || report.dev.sha256 !== report.dev.compiledSha256 || report.dev.pending)
      throw Error("Root Dev actual overwrite/hash/pending verification failed");
    report.resources = collectStageResourceEvidence(root, resources);
    report.sourceAfter = report.sourceBefore.map(row => ({ ...row,
      unchanged: row.sha256 === sha(path.join(root, row.file)) }));
    if (report.sourceAfter.some(row => !row.unchanged)) throw Error("Candidate changed during acceptance");
    if (report.steps.length !== 35 || report.steps.some(row => row.status !== "PASS"))
      throw Error("Required dialogue stage gates incomplete");
    report.status = "E4_DIALOGUE_BROWSER_DEV_PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    console.error(report.error); process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
