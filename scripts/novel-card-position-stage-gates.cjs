"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const hash = file => require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert(process.argv[2], "Pass the real completed title/compatibility gate; never repeat unchanged Runtime matrices");
const runtimeFile = path.resolve(process.argv[2]), runtime = JSON.parse(fs.readFileSync(runtimeFile));
assert.equal(runtime.status, "RUNTIME_WEBVIEW_SOURCE_PRODUCTION_AND_DEV_PASS");
assert.equal(runtime.steps.length, 32); assert(runtime.steps.every(row => row.status === "PASS"));
const out = path.join(root, "output/novel-card-position-gates", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const sources = [
  "editor/src/components/novel-import/NovelTaskCard.tsx",
  "editor/src/components/novel-import/novel-task-floating.css",
  "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx",
  "editor/src/novel-import/novelCardPosition.ts",
  "editor/src/store/novelImportStore.ts",
  "editor/src-tauri/src/novel_card_position.rs", "editor/src-tauri/src/main.rs",
  "scripts/novel-card-position-store-test.cjs", "scripts/novel-card-position-playwright.cjs",
  "scripts/novel-card-position-stage-gates.cjs",
];
const report = { status: "RUNNING", scope: "EDITOR_CARD_POSITION_SOURCE_BEHAVIOR_AND_DEV_NOT_INSTALLED_OR_POWER_LOSS",
  startedAt: new Date().toISOString(), steps: [],
  sources: sources.map(file => ({ file, sha256: hash(path.join(root, file)) })),
  inheritedRuntime: { path: runtimeFile, sha256: hash(runtimeFile), status: runtime.status,
    originalDev: runtime.dev, scope: "Unchanged Runtime source and served bytes only; old Dev field is not new delivery" } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function verifyInheritedRuntime() {
  assert.equal(hash(runtimeFile), report.inheritedRuntime.sha256);
  for (const row of runtime.sources) {
    const file = path.resolve(root, row.file);
    assert(file.startsWith(root + path.sep)); assert.equal(hash(file), row.sha256, `Inherited source changed: ${row.file}`);
  }
  for (const name of ["startup-production-full", "actual-legacy-engine-production", "title-color-modern", "title-color-legacy"]) {
    const step = runtime.steps.find(row => row.name === name); assert(step?.evidence);
    const evidence = JSON.parse(fs.readFileSync(step.evidence));
    assert.equal(evidence.status, "PASS");
    for (const row of evidence.productionFilesServed ?? evidence.served) {
      const directory = path.join(root, "GameCli_framework/dist"), file = path.resolve(directory, row.relative);
      assert(file.startsWith(directory + path.sep)); assert.equal(hash(file), row.sha256);
    }
  }
}
const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
async function run(name, command, args, extra = {}) {
  const directory = path.join(out, name); fs.mkdirSync(directory);
  const input = path.join(directory, "isolated-small.vnproj");
  fs.copyFileSync(path.join(root, "scripts/fixtures/editor-isolated-small.vnproj"), input, fs.constants.COPYFILE_EXCL);
  const env = { ...process.env, FLOATING_VIEWPORTS: "1080p,1440p,4k", FLOATING_DPR: "1",
    // Match the visible desktop rendering path. At 4K the headless
    // renderer skipped an entire 160ms transition; retain that FAILED report,
    // never lengthen production motion or weaken intermediate-frame assertions.
    FLOATING_REDUCED: "", FLOATING_HEADFUL: "1", EXIT_VIEWPORTS: "1920x1080,2560x1440,3840x2160",
    AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd", ...extra,
    AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: path.join(directory, "workspace") };
  const row = { name, command: [command, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
    input, output: env.AGENTVN_WORKSPACE_OUTPUT,
    env: { ...extra, FLOATING_HEADFUL: env.FLOATING_HEADFUL },
    log: path.join(directory, "command.log") };
  report.steps.push(row); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(row.log, { flags: "wx" }); let text = "";
  try {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    row.pid = child.pid; save();
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { text += bytes; log.write(bytes); });
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, 0, `${name} failed; Dev prohibited\n${text.slice(-5000)}`);
    if (args.includes("scripts/novel-task-floating-playwright.cjs")
      || args.includes("scripts/novel-card-position-playwright.cjs")) {
      const evidenceFile = path.join(row.output, "report.json"), evidence = JSON.parse(fs.readFileSync(evidenceFile));
      assert.equal(evidence.status, "PASS");
      assert(evidence.cases.length > 0 && evidence.cases.every(item => item.status === "PASS"));
      if (name === "card-position-browser-matrix") assert.equal(evidence.cases.length, 12);
      row.evidence = { path: evidenceFile, sha256: hash(evidenceFile), cases: evidence.cases.length };
    }
    if (name === "native-position-files") assert(/test result: ok\. 8 passed; 0 failed/.test(text));
    row.status = "PASS"; console.log(`PASS ${name}`);
  } catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { await new Promise(resolve => log.end(resolve)); row.finishedAt = new Date().toISOString(); save(); }
}
const node = (name, file = name, args = [], env) => run(name, process.execPath, [`scripts/${file}.cjs`, ...args], env);
(async () => {
  verifyInheritedRuntime();
  await node("position-controller", "novel-card-position-store-test");
  await run("native-position-files", "cargo", ["test", "--manifest-path", "editor/src-tauri/Cargo.toml",
    "novel_card_position_tests", "--", "--nocapture"]);
  await node("card-position-browser-matrix", "novel-card-position-playwright");
  for (const name of ["ownership", "initial-refresh", "controller", "local-actions"])
    await node(`floating-${name}`, "novel-task-floating-playwright", [`--case=${name}`]);
  for (const [label, env] of [
    ["normal", {}], ["dpr2", { FLOATING_DPR: "2" }],
    ["reduced", { FLOATING_REDUCED: "1" }], ["reduced-dpr2", { FLOATING_REDUCED: "1", FLOATING_DPR: "2" }],
  ]) {
    await node(`floating-ui-${label}`, "novel-task-floating-playwright", [], env);
    await node(`floating-handoff-${label}`, "novel-task-floating-playwright", ["--case=handoff"], env);
  }
  for (const name of ["novel-processing-core-test", "novel-import-append-graph-contract-test",
    "novel-import-chapter-idempotence-playwright", "runtime-save-queue-test", "runtime-exit-flow-test",
    "runtime-system-back-test", "runtime-window-close-test"])
    await node(name);
  for (const [prefix, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
    await run(`${prefix}-${task}`, process.execPath, [npm, "--prefix", path.join(root, prefix), "run", task]);
  await node("editor-workspace-contract"); await node("editor-workspace-playwright");
  verifyInheritedRuntime();
  assert(report.steps.length === 27 && report.steps.every(row => row.status === "PASS"));
  report.devBefore = { sha256: hash(path.join(root, "AgentVN Dev.exe")),
    modifiedAt: fs.statSync(path.join(root, "AgentVN Dev.exe")).mtime.toISOString() };
  await run("full-dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/build-dev-launcher.ps1")]);
  const dev = path.join(root, "AgentVN Dev.exe");
  report.dev = { path: dev, sha256: hash(dev), modifiedAt: fs.statSync(dev).mtime.toISOString(),
    compiledSha256: hash(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
    pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
  assert.equal(report.dev.sha256, report.dev.compiledSha256);
  assert.notEqual(report.dev.modifiedAt, report.devBefore.modifiedAt); assert(!report.dev.pending);
  for (const row of report.sources) assert.equal(hash(path.join(root, row.file)), row.sha256, "Card source drift");
  verifyInheritedRuntime();
  report.status = "NOVEL_CARD_POSITION_SOURCE_AND_DEV_PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
}).finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${out}`); });
