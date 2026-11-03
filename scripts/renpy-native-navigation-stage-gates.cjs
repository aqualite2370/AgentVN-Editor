"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/renpy-native-navigation-gates", runId);
fs.mkdirSync(output, { recursive: true });
const input = path.join(output, "isolated-small-project.vnproj");
const project = fixture(`native-navigation-${crypto.randomUUID()}`);
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const report = { runId, status: "RUNNING", scope: "E4 native title/navigation slice, not Release/Android acceptance",
  startedAt: new Date().toISOString(), input, projectId: project.project_id, steps: [] };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const protectedSources = [
  "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
  "GameCli_framework/src/app/runtimePageCrossfade.ts",
  "GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/components/shell/renpy-title.css",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "GameCli_framework/src/styles/renpy-button-roles.css",
  "shared/ui/slowFocusGlow.css",
  "scripts/renpy-native-navigation-playwright.cjs",
  "scripts/renpy-button-frame-playwright.cjs",
  "scripts/runtime-layout-profiles-playwright.cjs",
  "scripts/renpy-page-crossfade-playwright.cjs",
  "scripts/renpy-crossfade-snapshot-playwright.cjs",
  "scripts/runtime-menu-motion-playwright.cjs",
  "scripts/runtime-agentvn-blackout-playwright.cjs",
  "scripts/runtime-screen-transition-contract.cjs",
  "scripts/renpy-menu-playwright.cjs",
];
report.sourceBefore = protectedSources.map(file => ({ file, sha256: sha(path.join(root, file)) }));
async function execute(name, executable, args, extraEnv = {}) {
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
      stdio: ["ignore", "pipe", "pipe"], env: {
        ...process.env,
        AGENTVN_TEST_PROJECT: step.input, AGENTVN_WORKSPACE_OUTPUT: step.output,
        PROFILE_HEADFUL: "1", ADVANCED_TOOLS_HEADFUL: "1",
        RENPY_NATIVE_HEADFUL: "1", RENPY_MOTION_HEADFUL: "1",
        RENPY_NATIVE_FAST: "", RENPY_NATIVE_VIEWPORTS: "", PROFILE_FAST: "", PROFILE_CPU: "",
        RENPY_FADE_FAST: "", RUNTIME_MOTION_VIEWPORTS: "",
        PROFILE_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]",
        PROFILE_MENU_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]",
        ...extraEnv,
      } });
    step.scriptSha256 = args[0]?.startsWith("scripts/") ? sha(path.join(root, args[0])) : undefined;
    step.pid = child.pid; save();
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
      text += data.toString(); log.write(data);
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", resolve);
    });
    step.exitCode = code;
    step.evidencePaths = [...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(match => match[1].trim());
    if (code !== 0) throw Error(`${name} failed (${code}); see ${name}.log\n${text.slice(-2500)}`);
    if (name === "native-browser-matrix") {
      const evidence = step.evidencePaths.at(-1);
      const native = JSON.parse(fs.readFileSync(path.join(evidence, "report.json"), "utf8"));
      if (native.status !== "PASS" || native.cases.length !== 36
        || native.cases.some(row => row.status !== "PASS"))
        throw Error("Native browser matrix empty, incomplete or failed");
      step.browserCaseCount = native.cases.length;
    }
    const expectedRuntimeCases = name === "renpy-crossfade-matrix" ? 96
      : name === "renpy-snapshot-media" ? 6
      : name === "agentvn-blackout-matrix" ? 24
      : name.startsWith("runtime-motion-") ? 27 : undefined;
    if (expectedRuntimeCases !== undefined) {
      const evidence = step.evidencePaths.at(-1);
      const runtime = JSON.parse(fs.readFileSync(
        evidence.endsWith(".json") ? evidence : path.join(evidence, "report.json"), "utf8"));
      if (runtime.status !== "PASS" || runtime.cases.length !== expectedRuntimeCases
        || runtime.cases.some(row => row.status !== "PASS"))
        throw Error(`${name}: Runtime browser matrix empty, incomplete or failed`);
      step.browserCaseCount = runtime.cases.length;
    }
    step.status = "PASS";
    console.log(`PASS ${name}`);
  } catch (error) {
    step.status = "FAILED"; step.error = String(error.stack || error); throw error;
  } finally {
    log.end();
    step.finishedAt = new Date().toISOString(); save();
  }
}
const node = (name, script, env, args = []) => execute(name, process.execPath, [`scripts/${script}.cjs`, ...args], env);
(async () => {
  try {
    await node("native-browser-matrix", "renpy-native-navigation-playwright");
    await node("button-role-model", "renpy-button-role-model-test");
    await node("layout-runtime-export", "renpy-layout-runtime-test");
    await node("layout-profiles", "runtime-layout-profiles-test");
    await node("default-frame-contract", "renpy-button-frame-playwright", {}, ["--case=default-theme"]);
    await node("explicit-artwork-dpr1", "renpy-button-frame-playwright", { PROFILE_DPR: "1" });
    await node("explicit-artwork-dpr2", "renpy-button-frame-playwright", { PROFILE_DPR: "2" });
    await node("runtime-transition-contract", "runtime-screen-transition-contract");
    await node("renpy-snapshot-media", "renpy-crossfade-snapshot-playwright");
    await node("renpy-crossfade-matrix", "renpy-page-crossfade-playwright");
    for (const dpr of ["1", "2"]) for (const reduced of ["0", "1"])
      await node(`runtime-motion-dpr${dpr}-reduced${reduced}`, "runtime-menu-motion-playwright",
        { RUNTIME_MOTION_DPR: dpr, RUNTIME_MOTION_REDUCED: reduced });
    await node("agentvn-blackout-matrix", "runtime-agentvn-blackout-playwright");
    await node("runtime-menu-dpr1", "renpy-menu-playwright", { PROFILE_DPR: "1" });
    await node("runtime-menu-dpr2", "renpy-menu-playwright", { PROFILE_DPR: "2" });
    await node("title-logical-normal", "renpy-title-logical-scale-playwright",
      { RENPY_MOTION_DPR: "1", RENPY_MOTION_REDUCED: "0" });
    await node("title-logical-reduced-dpr2", "renpy-title-logical-scale-playwright",
      { RENPY_MOTION_DPR: "2", RENPY_MOTION_REDUCED: "1" });
    await node("editor-preview-normal", "runtime-layout-profiles-playwright",
      { PROFILE_DPR: "1", PROFILE_REDUCED: "0", RENPY_TITLE_ACCEPTANCE: "1" });
    await node("editor-preview-reduced-dpr2", "runtime-layout-profiles-playwright",
      { PROFILE_DPR: "2", PROFILE_REDUCED: "1", RENPY_TITLE_ACCEPTANCE: "1" });
    await node("editor-workspace", "editor-workspace-playwright");
    await node("editor-tools-transitions", "advanced-tools-transition-regression-playwright");
    await node("runtime-exit", "runtime-exit-behavior-playwright",
      { EXIT_VIEWPORTS: "1920x1080,2560x1440,3840x2160", EXIT_FAST: "" });
    for (const task of ["typecheck", "build"]) await execute(`editor-${task}`, process.execPath,
      [npmCli, "--prefix", path.join(root, "editor"), "run", task]);
    await execute("gamecli-build", process.execPath,
      [npmCli, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
    await node("editor-workspace-contract", "editor-workspace-contract");
    const dev = path.join(root, "AgentVN Dev.exe");
    const before = fs.statSync(dev).mtimeMs;
    await execute("dev-build", "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.dev = { path: dev, modifiedAt: fs.statSync(dev).mtime.toISOString(),
      sha256: sha(dev), compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
      overwritten: fs.statSync(dev).mtimeMs > before, pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
    if (!report.dev.overwritten || report.dev.sha256 !== report.dev.compiledSha256 || report.dev.pending)
      throw Error("Dev was not actually overwritten or hash/pending verification failed");
    report.resources = collectStageResourceEvidence(root, [
      "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
      "GameCli_framework/src/app/runtimePageCrossfade.ts",
      "GameCli_framework/src/styles/shell.css",
      "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
      "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
      "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
      "GameCli_framework/src/components/shell/renpy-title.css",
      "GameCli_framework/src/components/shell/renpy-menu.css",
      "GameCli_framework/src/styles/renpy-button-roles.css",
      "shared/ui/slowFocusGlow.css",
    ]);
    report.sourceAfter = report.sourceBefore.map(row => ({ ...row,
      unchanged: sha(path.join(root, row.file)) === row.sha256 }));
    if (report.sourceAfter.some(row => !row.unchanged))
      throw Error("Source changed during the gate; acceptance cannot represent a single implementation");
    if (report.steps.length !== 29 || report.steps.some(step => step.status !== "PASS"))
      throw Error("Slice gate is incomplete");
    report.status = "E4_NATIVE_NAVIGATION_SLICE_PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    console.error(report.error); process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString(); save();
    console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
