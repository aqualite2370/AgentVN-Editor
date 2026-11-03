"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawn } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/bubble-node-frame-gates", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const sourceFiles = [
  "GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/styles/player.css",
  "GameCli_framework/src/components/player/renpy-quick-bar.css", "shared/cartridge/bubblePlacement.ts",
  "scripts/bubble-node-frame-playwright.cjs", "scripts/bubble-node-frame-stage-gates.cjs",
  "scripts/bubble-dialog-playwright.cjs", "scripts/dialog-presentation-node-preview-playwright.cjs",
];
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "Default bubble node-frame readable text; authored geometry unchanged; no Editor/Runtime motion changes",
  steps: [], sourceBefore: sourceFiles.map(file => ({ file, sha256: A.sha256(fs.readFileSync(path.join(root, file))) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
async function execute(name, command, args, env = {}, count) {
  const step = { name, command: [command, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
    log: path.join(out, `${name}.log`) };
  report.steps.push(step); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(step.log, { flags: "wx" }); let text = "";
  try {
    const nativeEnv = command.toLowerCase().endsWith("powershell.exe") ? {
      PSModulePath: [path.join(process.env.USERPROFILE, "Documents/WindowsPowerShell/Modules"),
        path.join(process.env.ProgramFiles, "WindowsPowerShell/Modules"),
        path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter),
    } : {};
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AGENTVN_TEST_PROJECT: path.join(root, "scripts/fixtures/dialog-presentation-isolated.vnproj"),
        AGENTVN_WORKSPACE_OUTPUT: path.join(out, name), AGENTVN_FONT_NODE_DIAGNOSTIC: "",
        AGENTVN_GAMECLI_PREVIEW_DIST: path.join(root, "GameCli_framework/dist"),
        BUBBLE_DIALOG_TEST_PORT: "0", PROFILE_DPR: "1", PROFILE_REDUCED: "",
        PRESENTATION_DPR: "1", PRESENTATION_REDUCED: "", ...nativeEnv, ...env } });
    step.pid = child.pid; save();
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { text += data; log.write(data); });
    step.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(step.exitCode, 0, `${name} failed:\n${text.slice(-3500)}`);
    if (count !== undefined) {
      const files = [...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(match => match[1].trim());
      assert(files.length, `No behavior evidence: ${name}`);
      const file = files.at(-1).endsWith(".json") ? files.at(-1) : path.join(files.at(-1), "report.json");
      const evidence = JSON.parse(fs.readFileSync(file));
      assert.equal(evidence.status, "PASS"); assert.equal(evidence.cases.length, count);
      assert(evidence.cases.every(row => row.status === "PASS"), `${name}: failed/empty matrix`);
      step.evidence = { path: file, sha256: A.sha256(fs.readFileSync(file)), cases: count };
    }
    step.status = "PASS"; console.log(`PASS ${name}`);
  } catch (error) { step.status = "FAILED"; step.error = String(error.stack || error); throw error; }
  finally { log.end(); step.finishedAt = new Date().toISOString(); save(); }
}
const node = (name, file, args = [], env = {}, count) =>
  execute(name, process.execPath, [`scripts/${file}.cjs`, ...args], env, count);
(async () => {
  await node("node-frame-text-matrix", "bubble-node-frame-playwright", [], {}, 12);
  for (const [dpr, reduced] of [[1, false], [2, true]]) {
    const suffix = `dpr${dpr}-${reduced ? "reduced" : "normal"}`;
    const env = { PROFILE_DPR: String(dpr), PROFILE_REDUCED: reduced ? "1" : "" };
    await node(`bubble-default-${suffix}`, "bubble-dialog-playwright", [], env, 3);
    await node(`bubble-authored-${suffix}`, "bubble-dialog-playwright", ["--authored-layout"], env, 3);
    await node(`bubble-restored-long-speaker-${suffix}`, "bubble-dialog-playwright",
      ["--long-speaker", "--restored-pagination"], env, 3);
  }
  await node("bubble-placement-contract", "bubble-placement-contract");
  await node("dialogue-inheritance-contract", "dialog-presentation-inheritance-test");
  await node("runtime-save-exit-contract", "runtime-exit-flow-test");
  await execute("editor-typecheck", process.execPath, [npm, "--prefix", path.join(root, "editor"), "run", "typecheck"]);
  await execute("editor-build", process.execPath, [npm, "--prefix", path.join(root, "editor"), "run", "build"]);
  await execute("gamecli-build", process.execPath, [npm, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
  for (const dpr of [1, 2]) for (const reduced of [false, true])
    await node(`editor-node-preview-dpr${dpr}-${reduced ? "reduced" : "normal"}`,
      "dialog-presentation-node-preview-playwright", [], {
        PRESENTATION_DPR: String(dpr), PRESENTATION_REDUCED: reduced ? "1" : "",
      }, 3);
  await node("editor-workspace-contract", "editor-workspace-contract");
  const dev = path.join(root, "AgentVN Dev.exe"), before = fs.statSync(dev).mtimeMs;
  await execute("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/build-dev-launcher.ps1")]);
  report.dev = { path: dev, sha256: A.sha256(fs.readFileSync(dev)),
    compiledSha256: A.sha256(fs.readFileSync(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"))),
    overwritten: fs.statSync(dev).mtimeMs > before, modifiedAt: fs.statSync(dev).mtime.toISOString(),
    pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
  assert(report.dev.overwritten && !report.dev.pending);
  assert.equal(report.dev.sha256, report.dev.compiledSha256);
  report.sourceAfter = report.sourceBefore.map(source => ({ ...source,
    unchanged: A.sha256(fs.readFileSync(path.join(root, source.file))) === source.sha256 }));
  assert(report.sourceAfter.every(source => source.unchanged));
  report.status = "BUBBLE_NODE_FRAME_STAGE_PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${out}`);
});
