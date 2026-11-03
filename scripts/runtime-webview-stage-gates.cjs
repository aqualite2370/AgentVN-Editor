"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { spawn } = require("node:child_process");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/runtime-webview-gates", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const hash = file => require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const input = path.join(out, "isolated-small.vnproj");
fs.copyFileSync(path.join(root, "scripts/fixtures/editor-isolated-small.vnproj"), input, fs.constants.COPYFILE_EXCL);
const resources = [
  "GameCli_framework/src/main.tsx", "GameCli_framework/src/utils/runtimeCompatibility.ts",
  "GameCli_framework/src/types/runtimeCompatibility.d.ts",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/styles/player.css",
  "GameCli_framework/src/styles/shell.css",
  "GameCli_framework/package.json", "GameCli_framework/package-lock.json",
  "GameCli_framework/node_modules/core-js-pure/package.json",
  "GameCli_framework/node_modules/@juggle/resize-observer/package.json",
  "scripts/prepare-runtime-compat-licenses.cjs",
];
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "Missing API startup fix, source/production browser and Dev gates; not old Android device or installed acceptance",
  isolatedInput: input, steps: [],
  sources: [...resources, "GameCli_framework/vite.config.cjs", "scripts/standalone-build-scripts.json",
    "scripts/android-webview-startup-playwright.cjs", "scripts/renpy-menu-playwright.cjs",
    "scripts/runtime-webview-fallback-preload.cjs",
    "scripts/runtime-webview-network-policy-test.cjs", "scripts/runtime-webview-stage-gates.cjs"]
    .concat(["scripts/runtime-legacy-webview-playwright.cjs", "scripts/runtime-title-contrast-playwright.cjs"])
    .map(file => ({ file, sha256: hash(path.join(root, file)) })),
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const productionArgument = process.argv.find(arg => arg.startsWith("--production-evidence="));
async function run(name, command, args, extra = {}) {
  const item = { name, command: [command, ...args], status: "RUNNING",
    startedAt: new Date().toISOString(), logfile: path.join(out, `${name}.log`) };
  report.steps.push(item); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(item.logfile, { flags: "wx" }); let text = "";
  try {
    if (name === "startup-production-full" && productionArgument) {
      const evidencePath = path.resolve(productionArgument.slice("--production-evidence=".length));
      const prior = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
      assert.equal(prior.status, "PASS");
      assert.equal(prior.scope, "PRODUCTION_STATIC_BROWSER_CAPABILITY_REMOVAL_NOT_ANDROID_OR_APK_ACCEPTANCE");
      assert.equal(prior.expectedCaseCount, 57);
      assert.equal(prior.cases.length, 57);
      assert(prior.cases.every(row => row.status === "PASS" && row.startButtonActionable
        && row.pageErrors.length === 0));
      assert.equal(prior.cases.filter(row => row.exercise && row.flow).length, 48);
      assert(prior.sources.length > 0 && prior.productionFilesServed.length > 0);
      for (const source of prior.sources)
        assert.equal(hash(source.path), source.sha256, `Previously tested source changed: ${source.path}`);
      for (const served of prior.productionFilesServed)
        assert.equal(hash(path.join(root, "GameCli_framework/dist", served.relative)), served.sha256,
          `Production build bytes changed: ${served.relative}`);
      item.execution = "REFERENCED_UNCHANGED";
      item.evidence = evidencePath;
      item.evidenceSha256 = hash(evidencePath);
      item.originalStartedAt = prior.startedAt;
      item.originalFinishedAt = prior.finishedAt;
      item.status = "PASS";
      log.write("Referenced explicit completed production run; all 57 cases, source and actually served bundle bytes revalidated.\n");
      console.log(`PASS ${name} (unchanged verified evidence)`);
      return;
    }
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: path.join(out, `${name}-workspace`),
        AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd",
        PROFILE_VIEWPORTS: "[[1920,1080],[2560,1440],[3840,2160]]",
        RUNTIME_MOTION_VIEWPORTS: "1080p,1440p,4k", ...extra,
      } });
    item.pid = child.pid; save();
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", data => { text += data; log.write(data); });
    item.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    assert.equal(item.exitCode, 0, `${name} failed; Dev build prohibited\n${text.slice(-6000)}`);
    if (name.startsWith("startup-")) {
      const evidence = JSON.parse(text);
      item.evidence = path.join(evidence.output, "report.json");
      const behavior = JSON.parse(fs.readFileSync(item.evidence, "utf8"));
      assert.equal(behavior.status, "PASS");
      assert.equal(behavior.cases.length, args.includes("--full") ? 57 : 9);
      assert(behavior.cases.every(row => row.status === "PASS" && row.startButtonActionable));
      if (args.includes("--full")) {
        assert.equal(behavior.cases.filter(row => row.exercise && row.flow).length, 48);
        assert(behavior.productionFilesServed.some(row => row.relative.endsWith(".js")));
      }
    }
    if (name === "actual-legacy-engine-production") {
      const match = text.match(/Evidence: (.+)/);
      assert(match, "Missing actual old-engine evidence");
      item.evidence = path.join(match[1].trim(), "report.json");
      const behavior = JSON.parse(fs.readFileSync(item.evidence, "utf8"));
      assert.equal(behavior.status, "PASS");
      assert.equal(behavior.scope, "ACTUAL_OLD_DESKTOP_ENGINE_PRODUCTION_NOT_ANDROID_DEVICE_OR_APK");
      assert.equal(behavior.diagnosticOnlyFrameOverride, false);
      assert.equal(behavior.expectedCaseCount, 24);
      assert.equal(behavior.cases.length, 24);
      assert(behavior.cases.every(row => row.status === "PASS"
        && row.flow === "TITLE_SETTINGS_RETURN_START_AND_ADVANCE_PASS" && row.containedPreview
        && row.capabilities.before.clone === "undefined" && row.pageErrors.length === 0));
      for (const row of behavior.cases) {
        assert.equal(row.actualParameters.length, 3, "Missing real old-engine matrix parameters");
        for (const sample of row.actualParameters)
          assert.deepEqual(sample.actual, { ...row.viewport, dpr: row.dpr, reduced: row.reduced });
      }
      assert(behavior.cleanup.browserClosed && behavior.cleanup.ownedServerStopped);
    }
    if (name.startsWith("title-color-")) {
      const result = JSON.parse(text);
      item.evidence = path.join(result.out, "report.json");
      const behavior = JSON.parse(fs.readFileSync(item.evidence, "utf8"));
      assert.equal(behavior.status, "PASS"); assert.equal(behavior.smoke, false);
      assert.equal(behavior.legacy, name.endsWith("legacy"));
      assert.equal(behavior.expectedCaseCount, 60); assert.equal(behavior.cases.length, 60);
      assert.equal(new Set(behavior.cases.map(c => c.id)).size, 60);
      assert(behavior.cases.every(c => c.status === "PASS" && c.flow === "TITLE_COLOR_SETTINGS_RETURN_AND_START_PASS"));
      assert(behavior.cleanup.browserClosed && behavior.cleanup.serverStopped);
      assert(behavior.sources.length > 0 && behavior.served.length > 0);
      for (const source of behavior.sources)
        assert.equal(hash(path.join(root, source.relative)), source.sha256);
      for (const served of behavior.served)
        assert.equal(hash(path.join(root, "GameCli_framework/dist", served.relative)), served.sha256);
    }
    item.status = "PASS"; console.log(`PASS ${name}`);
  } catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); throw error; }
  finally {
    await new Promise(resolve => log.end(resolve));
    item.finishedAt = new Date().toISOString(); save();
  }
}
const node = (name, file = name, args = [], env) => run(name, process.execPath, [`scripts/${file}.cjs`, ...args], env);
const build = (prefix, task) => run(`${prefix}-${task}`, process.execPath,
  [npm, "--prefix", path.join(root, prefix), "run", task]);
(async () => {
  await node("runtime-webview-network-policy-test");
  await node("startup-source", "android-webview-startup-playwright");
  await build("editor", "typecheck");
  await build("editor", "build");
  await build("GameCli_framework", "build");
  await node("runtime-webview-license-test");
  await node("startup-production-full", "android-webview-startup-playwright", ["--production", "--full"]);
  await node("actual-legacy-engine-production", "runtime-legacy-webview-playwright", ["--full"]);
  await node("title-color-modern", "runtime-title-contrast-playwright");
  await node("title-color-legacy", "runtime-title-contrast-playwright", ["--legacy"]);
  for (const name of [
    "owned-vite-server-test", "runtime-save-queue-test", "runtime-exit-flow-test",
    "runtime-system-back-test", "runtime-window-close-test", "runtime-terminal-save-test",
    "quick-save-runtime-test", "live-scene-preview-engine-test", "gamecli-rollback-contract",
    "editor-workspace-contract", "editor-workspace-playwright", "game-entry-transition-playwright",
    "renpy-menu-playwright",
  ]) await node(name);
  for (const name of ["quick-save-runtime-test", "live-scene-preview-engine-test", "gamecli-rollback-contract"])
    await run(`fallback-${name}`, process.execPath, [
      "--require", "./scripts/runtime-webview-fallback-preload.cjs", `scripts/${name}.cjs`,
    ]);
  for (const [label, extra] of [
    ["normal", { RUNTIME_MOTION_DPR: "1", RUNTIME_MOTION_REDUCED: "" }],
    ["reduced-dpr2", { RUNTIME_MOTION_DPR: "2", RUNTIME_MOTION_REDUCED: "1" }],
  ]) await node(`runtime-motion-${label}`, "runtime-menu-motion-playwright", [], extra);
  await node("android-diagnostics-bundled-workspace-test");
  await run("bundled-runtime-build", process.execPath, [npm, "--prefix",
    path.join(root, "editor/src-tauri/bundle-workspace/GameCli_framework"), "run", "build"]);
  await node("bundled-license-test", "runtime-webview-license-test",
    [path.join(root, "editor/src-tauri/bundle-workspace/GameCli_framework")]);
  report.resources = collectStageResourceEvidence(root, resources);
  assert(report.steps.length >= 20 && report.steps.every(row => row.status === "PASS"));
  const dev = path.join(root, "AgentVN Dev.exe");
  report.devBefore = { sha256: hash(dev), modifiedAt: fs.statSync(dev).mtime.toISOString() };
  await run("full-dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/build-dev-launcher.ps1")]);
  report.dev = {
    path: dev, sha256: hash(dev),
    compiledSha256: hash(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
    modifiedAt: fs.statSync(dev).mtime.toISOString(),
    pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")),
  };
  assert.equal(report.dev.sha256, report.dev.compiledSha256);
  assert.notEqual(report.dev.modifiedAt, report.devBefore.modifiedAt);
  assert(!report.dev.pending);
  report.resourcesAfterDev = collectStageResourceEvidence(root, resources);
  assert(report.sources.every(row => hash(path.join(root, row.file)) === row.sha256),
    "门槛执行期间源码发生变化，结果不能归属");
  report.status = "RUNTIME_WEBVIEW_SOURCE_PRODUCTION_AND_DEV_PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${out}`);
});
