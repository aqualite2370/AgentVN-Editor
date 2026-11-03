"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/renpy-quickbar-style-gates", runId);
fs.mkdirSync(output, { recursive: true });
const report = { runId, status: "RUNNING", scope: "Renpy text-style quick bar; no Release/Android acceptance",
  startedAt: new Date().toISOString(), steps: [] };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const sources = [
  "GameCli_framework/src/components/player/renpy-quick-bar.css",
  "scripts/renpy-quick-save-playwright.cjs",
  "scripts/renpy-quickbar-style-stage-gates.cjs",
  "scripts/renpy-page-crossfade-playwright.cjs",
  "scripts/runtime-agentvn-blackout-playwright.cjs",
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
const sourceBefore = sources.map(file => ({ file, sha256: sha(file) }));
report.sourceBefore = sourceBefore;
const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
async function execute(name, args, extraEnv = {}, caseCount, executable = process.execPath) {
  const step = { name, command: [executable, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
    log: path.join(output, `${name}.log`) };
  report.steps.push(step); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(step.log, { flags: "wx" });
  let text = "";
  try {
    const child = spawn(executable, args, { cwd: root, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
    step.pid = child.pid; save();
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
      text += data.toString(); log.write(data);
    });
    step.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", resolve);
    });
    step.evidencePaths = [...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(match => match[1].trim());
    if (step.exitCode !== 0) throw Error(`${name} failed (${step.exitCode})\n${text.slice(-3000)}`);
    if (caseCount !== undefined) {
      const file = step.evidencePaths.at(-1);
      const evidence = JSON.parse(fs.readFileSync(file.endsWith(".json") ? file : path.join(file, "report.json"), "utf8"));
      if (evidence.status !== "PASS" || evidence.cases.length !== caseCount
        || evidence.cases.some(row => row.status !== "PASS"))
        throw Error(`${name}: expected ${caseCount} passing browser cases`);
      step.browserCaseCount = evidence.cases.length;
    }
    step.status = "PASS"; console.log(`PASS ${name}`);
  } catch (error) { step.status = "FAILED"; step.error = String(error.stack || error); throw error; }
  finally { log.end(); step.finishedAt = new Date().toISOString(); save(); }
}
const quickbar = (name, reduced, dpr, roles = false) => execute(name,
  ["scripts/renpy-quick-save-playwright.cjs", ...(roles ? ["--button-roles"] : [])], {
    PROFILE_DPR: String(dpr), PROFILE_REDUCED: reduced ? "1" : "",
    QUICK_SAVE_TEST_PORT: "0",
  }, 7);
(async () => {
  try {
    for (const reduced of [false, true]) for (const dpr of [1, 2])
      await quickbar(`quickbar-${reduced ? "reduced" : "normal"}-dpr${dpr}`, reduced, dpr);
    await quickbar("quickbar-authored-role-dpr1", false, 1, true);
    await quickbar("quickbar-authored-role-dpr2", false, 2, true);
    await quickbar("quickbar-authored-role-reduced-dpr1", true, 1, true);
    await quickbar("quickbar-authored-role-reduced-dpr2", true, 2, true);
    await execute("renpy-crossfade-matrix", ["scripts/renpy-page-crossfade-playwright.cjs"], {}, 96);
    await execute("agentvn-blackout-matrix", ["scripts/runtime-agentvn-blackout-playwright.cjs"], {
      EXIT_VIEWPORTS: "1920x1080,2560x1440,3840x2160",
    }, 24);
    await execute("editor-typecheck", [npmCli, "--prefix", path.join(root, "editor"), "run", "typecheck"]);
    await execute("editor-build", [npmCli, "--prefix", path.join(root, "editor"), "run", "build"]);
    await execute("gamecli-build", [npmCli, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
    await execute("editor-workspace-contract", ["scripts/editor-workspace-contract.cjs"]);
    const dev = path.join(root, "AgentVN Dev.exe");
    const before = fs.statSync(dev).mtimeMs;
    await execute("dev-build", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/build-dev-launcher.ps1")], {}, undefined, "powershell.exe");
    report.dev = {
      path: dev,
      modifiedAt: fs.statSync(dev).mtime.toISOString(),
      sha256: sha("AgentVN Dev.exe"),
      compiledSha256: sha("editor/src-tauri/target/debug/agentvn-editor.exe"),
      overwritten: fs.statSync(dev).mtimeMs > before,
      pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")),
    };
    if (!report.dev.overwritten || report.dev.sha256 !== report.dev.compiledSha256 || report.dev.pending)
      throw Error("Dev actual overwrite/hash/pending verification failed");
    report.sourceAfter = sourceBefore.map(row => ({ ...row,
      unchanged: sha(row.file) === row.sha256 }));
    if (report.sourceAfter.some(row => !row.unchanged)) throw Error("Frozen stage source changed");
    report.status = "E4_RENPY_QUICKBAR_TEXT_STYLE_PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
