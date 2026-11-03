"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/renpy-role-opacity-gates", runId);
fs.mkdirSync(output, { recursive: true });
const input = path.join(output, "isolated-small-project.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture(`role-opacity-${crypto.randomUUID()}`)), { flag: "wx" });
const product = [
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/styles/renpy-button-roles.css",
  "GameCli_framework/src/styles/player.css",
  "GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/SettingsScreen.tsx",
  "GameCli_framework/src/components/shell/SaveLoadScreen.tsx",
  "GameCli_framework/src/components/player/RenpyQuickBar.tsx",
  "GameCli_framework/src/components/player/ChoicePanel.tsx",
  "GameCli_framework/src/components/common/Modal.tsx",
];
const frozen = [...product, "scripts/renpy-role-opacity-playwright.cjs",
  "scripts/renpy-role-snapshot-playwright.cjs",
  "scripts/renpy-role-opacity-stage-gates.cjs", "scripts/runtime-layout-profiles-playwright.cjs",
  "scripts/renpy-category-page-stage-gates.cjs"];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { runId, status: "RUNNING", scope: "E4 role opacity Runtime + author preview; not installed acceptance",
  startedAt: new Date().toISOString(), input, steps: [],
  sourceBefore: frozen.map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
async function execute(name, args) {
  const step = { name, command: [process.execPath, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
    output: path.join(output, name) };
  report.steps.push(step); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(path.join(output, `${name}.log`), { flags: "wx" });
  let text = "";
  try {
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], env: {
        ...process.env, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: step.output,
        PROFILE_HEADFUL: "", PROFILE_FAST: "", PROFILE_CPU: "",
        ROLE_OPACITY_HEADFUL: "1",
      } });
    step.pid = child.pid; save();
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { log.write(data); text += data; });
    step.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", resolve);
    });
    step.evidencePaths = [...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(match => match[1].trim());
    if (step.exitCode !== 0) throw Error(`${name} failed (${step.exitCode})\n${text.slice(-2500)}`);
    if (step.evidencePaths.length) {
      const evidence = step.evidencePaths.at(-1);
      const result = JSON.parse(fs.readFileSync(evidence.endsWith(".json")
        ? evidence : path.join(evidence, "report.json"), "utf8"));
      if (name === "opacity-matrix") {
        if (result.status !== "PASS" || result.cases.length !== 36 || result.cases.some(row => row.status !== "PASS"))
          throw Error("Opacity matrix incomplete or failed");
        step.browserCaseCount = result.cases.length;
      } else if (name === "snapshot-state-matrix") {
        if (result.status !== "PASS" || result.cases.length !== 12 || result.cases.some(row => row.status !== "PASS"))
          throw Error("Snapshot state matrix incomplete or failed");
        step.browserCaseCount = result.cases.length;
      } else {
        if (result.status !== "E4_CATEGORY_PAGE_SLICE_PASS" || result.steps.length !== 18
          || result.steps.some(row => row.status !== "PASS")) throw Error("Required related gate incomplete or failed");
        report.relatedGate = { path: evidence, status: result.status, steps: result.steps, dev: result.dev };
      }
    }
    step.status = "PASS"; console.log(`PASS ${name}`);
  } catch (error) {
    step.status = "FAILED"; step.error = String(error.stack || error); throw error;
  } finally {
    log.end(); step.finishedAt = new Date().toISOString(); save();
  }
}
(async () => {
  try {
    await execute("opacity-matrix", ["scripts/renpy-role-opacity-playwright.cjs"]);
    await execute("snapshot-state-matrix", ["scripts/renpy-role-snapshot-playwright.cjs"]);
    // Refresh the bundled preview after actual behavior passes, before the
    // author UI test. Its iframe must use this candidate, not prior assets.
    await execute("editor-typecheck-preview", [npmCli, "--prefix", path.join(root, "editor"), "run", "typecheck"]);
    await execute("editor-build-preview", [npmCli, "--prefix", path.join(root, "editor"), "run", "build"]);
    await execute("related-full-gates", ["scripts/renpy-category-page-stage-gates.cjs"]);
    report.resources = collectStageResourceEvidence(root, product);
    report.sourceAfter = report.sourceBefore.map(row => ({ ...row, unchanged: sha(path.join(root, row.file)) === row.sha256 }));
    if (report.sourceAfter.some(row => !row.unchanged)) throw Error("Frozen candidate changed during acceptance");
    const dev = report.relatedGate.dev;
    if (!dev.overwritten || dev.pending || dev.sha256 !== sha(path.join(root, "AgentVN Dev.exe"))
      || dev.sha256 !== sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")))
      throw Error("Actual Dev delivery missing");
    report.dev = dev;
    report.status = "E4_ROLE_OPACITY_SLICE_PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    console.error(report.error);
  } finally {
    report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
