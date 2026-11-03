"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const previewPageSync = process.argv.includes("--preview-page-sync");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, previewPageSync ? "output/renpy-preview-navigation-gates"
  : "output/renpy-menu-frame-gates", runId);
fs.mkdirSync(output, { recursive: true });
const input = path.join(output, "isolated-small-project.vnproj");
const project = fixture(`menu-frame-${crypto.randomUUID()}`);
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const report = { runId, status: "RUNNING",
  scope: previewPageSync
    ? "E4 author/Runtime preview navigation continuity; not Release, Windows or Android acceptance"
    : "E4 shared Ren'Py menu frame only; not Release, Windows or Android acceptance",
  startedAt: new Date().toISOString(), input, projectId: project.project_id, steps: [] };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const resources = [
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/RenpyRuntimePreview.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "shared/cartridge/renpyGui.ts",
  "shared/cartridge/runtimeCapabilities.ts",
  "shared/cartridge/constants.ts",
  "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
  "GameCli_framework/src/app/runtimePageCrossfade.ts",
];
const sources = [...resources, "scripts/renpy-menu-frame-playwright.cjs",
  "scripts/runtime-layout-profiles-playwright.cjs", "scripts/renpy-layout-runtime-test.cjs",
  "scripts/renpy-page-crossfade-playwright.cjs",
  "scripts/renpy-menu-frame-stage-gates.cjs"];
report.sourceBefore = sources.map(file => ({ file, sha256: sha(path.join(root, file)) }));
async function execute(name, executable, args, extraEnv = {}, expectedCases) {
  const step = { name, command: [executable, ...args], status: "RUNNING",
    startedAt: new Date().toISOString(), output: path.join(output, name),
    input: path.join(output, `${name}-isolated.vnproj`) };
  fs.copyFileSync(input, step.input, fs.constants.COPYFILE_EXCL);
  report.steps.push(step); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(path.join(output, `${name}.log`), { flags: "wx" });
  let text = "";
  try {
    const child = spawn(executable, args, { cwd: root, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], env: {
        ...process.env, AGENTVN_TEST_PROJECT: step.input, AGENTVN_WORKSPACE_OUTPUT: step.output,
        PROFILE_HEADFUL: "", PROFILE_DPR: "1", PROFILE_REDUCED: "",
        PROFILE_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]",
        PROFILE_MENU_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]",
        PROFILE_FAST: "", PROFILE_CPU: "", RENPY_FRAME_FAST: "", RENPY_FRAME_REDUCED_ONLY: "",
        RENPY_FADE_FAST: "", RENPY_FADE_HEADFUL: "",
        ...extraEnv,
      } });
    step.pid = child.pid; save();
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
      text += data.toString(); log.write(data);
    });
    step.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", resolve);
    });
    step.evidencePaths = [...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(match => match[1].trim());
    if (step.exitCode !== 0) throw Error(`${name} failed (${step.exitCode})\n${text.slice(-3500)}`);
    if (expectedCases !== undefined) {
      const evidence = step.evidencePaths.at(-1);
      if (!evidence) throw Error(`${name}: missing behavior report`);
      const result = JSON.parse(fs.readFileSync(
        evidence.endsWith(".json") ? evidence : path.join(evidence, "report.json"), "utf8"));
      if (result.status !== "PASS" || result.cases.length !== expectedCases
        || result.cases.some(row => row.status !== "PASS"))
        throw Error(`${name}: expected ${expectedCases} actual passing cases; matrix incomplete or failed`);
      step.browserCaseCount = result.cases.length;
    }
    step.status = "PASS"; console.log(`PASS ${name}`);
  } catch (error) {
    step.status = "FAILED"; step.error = String(error.stack || error); throw error;
  } finally {
    log.end(); step.finishedAt = new Date().toISOString(); save();
  }
}
const node = (name, script, env, args = [], count) =>
  execute(name, process.execPath, [`scripts/${script}.cjs`, ...args], env, count);
(async () => {
  try {
    await node("layout-runtime-and-export", "renpy-layout-runtime-test");
    await node("button-role-model", "renpy-button-role-model-test");
    await node("layout-profiles-model", "runtime-layout-profiles-test");
    await node("renpy-crossfade-matrix", "renpy-page-crossfade-playwright", {}, [], 96);
    await node("menu-frame-runtime-matrix", "renpy-menu-frame-playwright", {}, [], 432);
    // The real editor iframe consumes dist; refresh this candidate before
    // authoring tests, while keeping the preceding dist in the checkpoint.
    await execute("gamecli-preview-build", process.execPath,
      [npmCli, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
    for (const dpr of [1, 2]) for (const reduced of [false, true])
      await node(`menu-frame-editor-dpr${dpr}-${reduced ? "reduced" : "normal"}`,
        "runtime-layout-profiles-playwright",
        { PROFILE_DPR: String(dpr), PROFILE_REDUCED: reduced ? "1" : "" },
        ["--case=menu-frame-editor"], 5);
    if (previewPageSync) for (const dpr of [1, 2]) for (const reduced of [false, true])
      await node(`preview-page-sync-dpr${dpr}-${reduced ? "reduced" : "normal"}`,
        "runtime-layout-profiles-playwright",
        { PROFILE_DPR: String(dpr), PROFILE_REDUCED: reduced ? "1" : "", PROFILE_HEADFUL: "1" },
        ["--case=preview-page-sync"], 12);
    await node("existing-menu", "renpy-menu-playwright", { PROFILE_DPR: "2" });
    await node("existing-help", "renpy-help-playwright", { PROFILE_DPR: "2" });
    await node("gui-button-frame", "renpy-button-frame-playwright");
    await node("role-opacity", "renpy-role-opacity-playwright", {}, [], 36);
    await node("runtime-transition-contract", "runtime-screen-transition-contract");
    await node("agentvn-blackout-matrix", "runtime-agentvn-blackout-playwright", {}, [], 24);
    await node("editor-workspace", "editor-workspace-playwright");
    await node("editor-tools-transitions", "advanced-tools-transition-regression-playwright",
      { ADVANCED_TOOLS_HEADFUL: "1" });
    await node("runtime-exit", "runtime-exit-behavior-playwright",
      { EXIT_VIEWPORTS: "1920x1080,2560x1440,3840x2160", EXIT_FAST: "" });
    for (const task of ["typecheck", "build"])
      await execute(`editor-${task}`, process.execPath,
        [npmCli, "--prefix", path.join(root, "editor"), "run", task]);
    await execute("gamecli-build", process.execPath,
      [npmCli, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
    await node("editor-workspace-contract", "editor-workspace-contract");
    const dev = path.join(root, "AgentVN Dev.exe"), before = fs.statSync(dev).mtimeMs;
    await execute("dev-build", "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.dev = { path: dev, modifiedAt: fs.statSync(dev).mtime.toISOString(),
      sha256: sha(dev), compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
      overwritten: fs.statSync(dev).mtimeMs > before,
      pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
    if (!report.dev.overwritten || report.dev.sha256 !== report.dev.compiledSha256 || report.dev.pending)
      throw Error("Dev was not actually overwritten or hash/pending verification failed");
    report.resources = collectStageResourceEvidence(root, resources);
    report.sourceAfter = report.sourceBefore.map(row => ({ ...row,
      unchanged: sha(path.join(root, row.file)) === row.sha256 }));
    if (report.sourceAfter.some(row => !row.unchanged)) throw Error("Candidate changed during acceptance");
    if (report.steps.length !== (previewPageSync ? 28 : 24)
      || report.steps.some(row => row.status !== "PASS"))
      throw Error("Slice gate incomplete");
    report.status = previewPageSync ? "E4_PREVIEW_NAVIGATION_SLICE_PASS" : "E4_MENU_FRAME_SLICE_PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    console.error(report.error); process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
