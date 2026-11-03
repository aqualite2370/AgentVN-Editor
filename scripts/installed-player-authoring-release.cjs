"use strict";
// Build only after the current source/Dev gates. Preserve previous artifacts;
// install to an independent directory and run authoring through actual UI.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");
const { validateTitleColorEvidence } = require("./lib/runtime-title-color-evidence.cjs");
const root = path.resolve(__dirname, "..");
assert(process.argv[2] && process.argv[3], "Pass completed gate report and fresh release output");
const gateFile = path.resolve(process.argv[2]), out = path.resolve(process.argv[3]);
const resumeArgument = process.argv.find(arg => arg.startsWith("--resume-release="));
const resumeFile = resumeArgument ? path.resolve(resumeArgument.slice("--resume-release=".length)) : null;
const fontNodeAuthoring = process.argv.includes("--font-node-authoring");
const portableSaves = process.argv.includes("--portable-saves");
const androidCleanupEvidence = process.argv.includes("--android-cleanup-evidence");
const androidVersionProvenance = process.argv.includes("--android-version-provenance");
const runtimeWebview = process.argv.includes("--runtime-webview");
const validateOnly = process.argv.includes("--validate-only");
const cardArguments = process.argv.filter(arg => arg.startsWith("--card-position-gate="));
assert(cardArguments.length <= 1, "Only one card-position gate may be supplied");
assert(!cardArguments.length || runtimeWebview, "Card gate extends the explicitly linked Runtime gate only");
assert([fontNodeAuthoring, portableSaves, androidCleanupEvidence, androidVersionProvenance, runtimeWebview].filter(Boolean).length <= 1);
assert(!validateOnly || runtimeWebview, "Validation-only is explicitly scoped to Runtime WebView gates");
assert(A.inside(path.join(root, "output"), out));
assert(!fs.existsSync(out), "Never overwrite previous release evidence");
const gateBytes = fs.readFileSync(gateFile), gate = JSON.parse(gateBytes);
assert.equal(gate.status, runtimeWebview ? "RUNTIME_WEBVIEW_SOURCE_PRODUCTION_AND_DEV_PASS"
  : androidVersionProvenance ? "ANDROID_VERSION_PROVENANCE_SOURCE_DEV_PASS"
  : androidCleanupEvidence ? "ANDROID_HOST_CLEANUP_SOURCE_DEV_PASS"
  : portableSaves ? "PORTABLE_SAVE_SOURCE_DEV_PASS"
  : fontNodeAuthoring ? "BUBBLE_NODE_FRAME_STAGE_PASS" : "E4_RENPY_QUICKBAR_TEXT_STYLE_PASS");
assert(gate.steps.length > 0 && gate.steps.every(s => s.status === "PASS"));
if (!runtimeWebview) assert(gate.sourceAfter.length > 0 && gate.sourceAfter.every(s => s.unchanged));
const cardPosition = cardArguments.length
  ? require("./lib/novel-card-position-release-evidence.cjs").validateCardPositionRelease(
    path.resolve(cardArguments[0].slice("--card-position-gate=".length)),
    { root, runtimeFile: gateFile, runtime: gate, runtimeBytes: gateBytes })
  : null;
const deliveryDev = cardPosition ? cardPosition.card.dev : gate.dev;
assert.equal(A.sha256(fs.readFileSync(deliveryDev.path)), deliveryDev.sha256);
const gatedSources = runtimeWebview ? gate.sources : gate.sourceBefore;
assert(gatedSources.length > 0);
for (const source of gatedSources) {
  assert(A.inside(root, path.resolve(root, source.file)));
  assert.equal(A.sha256(fs.readFileSync(path.join(root, source.file))), source.sha256,
    `Source changed after gate: ${source.file}`);
}
if (runtimeWebview) {
  assert(gate.steps.length >= 32 && new Set(gate.steps.map(s => s.name)).size === gate.steps.length);
  for (const name of ["startup-source", "editor-typecheck", "editor-build",
    "GameCli_framework-build", "runtime-webview-license-test", "startup-production-full",
    "actual-legacy-engine-production", "title-color-modern", "title-color-legacy",
    "runtime-motion-normal", "runtime-motion-reduced-dpr2",
    "bundled-runtime-build", "bundled-license-test", "full-dev-build"])
    assert(gate.steps.some(s => s.name === name && s.status === "PASS"), `Missing gate: ${name}`);
  assert.equal(deliveryDev.pending, false);
  assert.equal(deliveryDev.compiledSha256, deliveryDev.sha256);
  assert.equal(A.sha256(fs.readFileSync(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"))), deliveryDev.sha256);
  assert(!fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")));
  assert(gate.resourcesAfterDev.bundled.length > 0);
  for (const row of gate.resourcesAfterDev.bundled) {
    assert(A.inside(root, path.resolve(root, row.file)));
    assert.equal(A.sha256(fs.readFileSync(path.join(root, row.file))), row.sha256);
    assert.equal(A.sha256(fs.readFileSync(path.join(root, "editor/src-tauri/bundle-workspace", row.file))), row.sha256);
  }
  for (const [name, count, expectedFlows, scope] of [
    ["startup-production-full", 57, 48, "PRODUCTION_STATIC_BROWSER_CAPABILITY_REMOVAL_NOT_ANDROID_OR_APK_ACCEPTANCE"],
    ["actual-legacy-engine-production", 24, 24, "ACTUAL_OLD_DESKTOP_ENGINE_PRODUCTION_NOT_ANDROID_DEVICE_OR_APK"],
  ]) {
    const evidenceFile = gate.steps.find(s => s.name === name).evidence;
    assert(A.inside(path.join(root, "output"), evidenceFile));
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
    assert.equal(evidence.status, "PASS"); assert.equal(evidence.scope, scope);
    assert.equal(evidence.cases.length, count); assert.equal(evidence.expectedCaseCount, count);
    assert(evidence.cases.every(row => row.status === "PASS" && row.pageErrors.length === 0));
    assert(evidence.cleanup.browserClosed && evidence.cleanup.ownedServerStopped);
    const legacy = name === "actual-legacy-engine-production";
    if (legacy) {
      assert.equal(evidence.diagnosticOnlyFrameOverride, false);
      assert(evidence.browserVersion.startsWith("90."));
      assert(evidence.cases.every(row => row.containedPreview && row.capabilities.before.clone === "undefined"));
      for (const row of evidence.cases) {
        assert.equal(row.actualParameters.length, 3, "Missing actual legacy-engine matrix evidence");
        for (const sample of row.actualParameters)
          assert.deepEqual(sample.actual, { ...row.viewport, dpr: row.dpr, reduced: row.reduced });
      }
    }
    const flows = evidence.cases.filter(row => legacy || row.exercise);
    assert.equal(flows.length, expectedFlows);
    assert(flows.every(row => row.flow === "TITLE_SETTINGS_RETURN_START_AND_ADVANCE_PASS"));
    const matrix = flows.map(row => [row.viewport.width, row.viewport.height, row.dpr,
      row.reduced, row.advanced, legacy ? "" : Boolean(row.absent)].join("/"));
    assert.equal(new Set(matrix).size, expectedFlows, "Duplicate matrix rows are not coverage");
    for (const source of evidence.sources) {
      const file = legacy ? path.resolve(root, source.file) : source.path;
      assert(A.inside(root, file));
      assert.equal(A.sha256(fs.readFileSync(file)), source.sha256, "Browser evidence source changed");
    }
    assert(evidence.productionFilesServed.length > 0);
    for (const row of evidence.productionFilesServed) {
      const directory = path.join(root, "GameCli_framework/dist");
      const file = path.resolve(directory, row.relative);
      assert(A.inside(directory, file));
      assert.equal(A.sha256(fs.readFileSync(file)), row.sha256, "Browser-tested production bytes changed");
    }
  }
  for (const [name, legacy] of [["title-color-modern", false], ["title-color-legacy", true]]) {
    const evidenceFile = gate.steps.find(s => s.name === name).evidence;
    assert(A.inside(path.join(root, "output"), evidenceFile));
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
    validateTitleColorEvidence(evidence, legacy);
    for (const source of evidence.sources) {
      const file = path.resolve(root, source.relative);
      assert(A.inside(root, file));
      assert.equal(A.sha256(fs.readFileSync(file)), source.sha256, "Title-tested source changed");
    }
    for (const served of evidence.served) {
      const directory = path.join(root, "GameCli_framework/dist");
      const file = path.resolve(directory, served.relative);
      assert(A.inside(directory, file));
      assert.equal(A.sha256(fs.readFileSync(file)), served.sha256, "Title-tested production bytes changed");
    }
    for (const row of evidence.cases) {
      assert(A.inside(path.dirname(evidenceFile), row.screenshot));
      const bytes = fs.readFileSync(row.screenshot);
      assert.equal(bytes.readUInt32BE(16), row.viewport.width * row.dpr, "Title PNG actual pixel width");
      assert.equal(bytes.readUInt32BE(20), row.viewport.height * row.dpr, "Title PNG actual pixel height");
    }
  }
}
if (validateOnly) {
  console.log(JSON.stringify({ status: cardPosition ? "RUNTIME_WEBVIEW_CARD_POSITION_RELEASE_GATE_VALIDATED_ONLY"
    : "RUNTIME_WEBVIEW_RELEASE_GATE_VALIDATED_ONLY",
    gate: gateFile, buildsStarted: false, installationsStarted: false }));
  process.exit(0);
}
const config = JSON.parse(fs.readFileSync(path.join(root, "editor/src-tauri/tauri.conf.json")));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: cardPosition ? "New actual Release installation for validated Runtime title/compatibility and Editor native card-position commit; installed crash/export/device acceptance follows separately"
    : runtimeWebview ? "New actual Release installation for missing-API, old-engine frame and default title contrast fixes; not old Android acceptance; installed export/device follows separately"
    : androidVersionProvenance ? "New actual Release installation for game/engine/protocol APK version evidence; installed UI export/device acceptance follows separately"
    : androidCleanupEvidence ? "New actual Release installation for native Android final cleanup evidence; export/device acceptance follows separately"
    : portableSaves ? "New actual Release installation -> UI Windows export -> native portable save/migration; isolated small project"
    : fontNodeAuthoring ? "New actual Release installation fonts/node-preview authoring; no APK or final user project"
    : "New actual Release installation ordinary/choice/quick-bar authoring; no APK or final user project",
  gate: { path: gateFile, sha256: A.sha256(gateBytes) },
  ...(cardPosition ? { cardPositionGate: cardPosition.evidence } : {}),
  steps: [], preservedArtifacts: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function step(name, command, args, extraEnv = {}) {
  const row = { name, command: [command, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
    log: path.join(out, `${name}.log`) };
  report.steps.push(row); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(row.log, { flags: "wx" });
  try {
    const nativePowerShell = command.toLowerCase().endsWith("powershell.exe");
    const modulePath = [
      path.join(process.env.USERPROFILE, "Documents/WindowsPowerShell/Modules"),
      path.join(process.env.ProgramFiles, "WindowsPowerShell/Modules"),
      path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules"),
    ].join(path.delimiter);
    const child = spawn(command, args, { cwd: root, windowsHide: true,
      env: { ...process.env, ...(nativePowerShell ? { PSModulePath: modulePath } : {}), ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"] });
    row.pid = child.pid; save();
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    assert.equal(row.exitCode, 0, `Inspect ${row.log}`);
    row.status = "PASS"; console.log(`PASS ${name}`);
  } catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { log.end(); row.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  save();
  let resources;
  if (resumeFile) {
    const bytes = fs.readFileSync(resumeFile), previous = JSON.parse(bytes);
    assert.equal(previous.status, "FAILED", "Preserve previous failed wrapper result");
    assert.equal(previous.gate.sha256, report.gate.sha256);
    assert.equal(previous.steps.length, 3);
    assert.deepEqual(previous.steps.map(s => [s.name, s.status]), [
      ["full-editor-release-build", "PASS"], ["three-installer-resource-audit", "PASS"],
      ["independent-actual-NSIS-installation", "FAILED"],
    ]);
    resources = path.resolve(previous.steps[1].command.at(-1));
    assert(A.inside(path.dirname(resumeFile), resources));
    const resourceFile = path.join(resources, "installer-resource-report.json");
    const resourceBytes = fs.readFileSync(resourceFile), resource = JSON.parse(resourceBytes);
    assert.equal(resource.status, "PASS");
    for (const installer of resource.installers)
      assert.equal(A.sha256(fs.readFileSync(installer.path)), installer.sha256, "Do not reuse changed installer bytes");
    for (const runtime of resource.runtimeCandidate)
      assert.equal(A.sha256(fs.readFileSync(runtime.source)), runtime.sha256, "Runtime changed after installer resource audit");
    for (const deployment of resource.deployments) {
      assert.equal(A.sha256(fs.readFileSync(deployment.executable.path)), deployment.executable.sha256);
      const css = "GameCli_framework/src/components/player/renpy-quick-bar.css";
      assert.equal(A.sha256(fs.readFileSync(path.join(deployment.installedRoot, css))),
        A.sha256(fs.readFileSync(path.join(root, css))));
    }
    report.referencedBuild = { path: resumeFile, sha256: A.sha256(bytes), originalStatus: previous.status,
      resourceReport: resourceFile, resourceSha256: A.sha256(resourceBytes),
      scope: "Completed build/resource stages only; failed installation is rerun, old report remains FAILED" };
    report.steps = previous.steps.slice(0, 2).map(s => ({ ...s, execution: "REFERENCED_UNCHANGED" }));
  } else {
  const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
  const originals = [
    path.join(bundle, "nsis", `${config.productName}_${config.version}_x64-setup.exe`),
    ...["en-US", "zh-CN"].map(lang => path.join(bundle, "msi", `${config.productName}_${config.version}_x64_${lang}.msi`)),
    path.join(root, "editor/src-tauri/target/release/agentvn-editor.exe"),
  ];
  const preserved = path.join(out, "previous-artifacts"); fs.mkdirSync(preserved);
  for (const original of originals) if (fs.existsSync(original)) {
    const target = path.join(preserved, path.basename(original));
    fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
    const sha256 = A.sha256(fs.readFileSync(original));
    assert.equal(A.sha256(fs.readFileSync(target)), sha256);
    report.preservedArtifacts.push({ original, path: target, sha256,
      originalGeneratedAt: fs.statSync(original).mtime.toISOString() });
  }
  save();
  await step("full-editor-release-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/build-editor-windows.ps1")]);
  resources = path.join(out, "resources");
  await step("three-installer-resource-audit", process.execPath,
    [path.join(root, "scripts/editor-installer-resources-acceptance.cjs"), resources]);
  }
  const session = path.join(out, "actual-installation");
  await step("independent-actual-NSIS-installation", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/install-isolated-nsis-acceptance.ps1"), "-ResourceReport",
    path.join(resources, "installer-resource-report.json"), "-RunRoot", session]);
  const actual = JSON.parse(fs.readFileSync(path.join(session, "actual-installation.json")));
  assert.equal(actual.status, "PASS"); assert.equal(actual.registryRestored, true);
  const runtimeCss = "GameCli_framework/src/components/player/renpy-quick-bar.css";
  report.css = { source: path.join(root, runtimeCss), installed: path.join(actual.installRoot, runtimeCss) };
  report.css.sha256 = A.sha256(fs.readFileSync(report.css.source));
  assert.equal(A.sha256(fs.readFileSync(report.css.installed)), report.css.sha256);
  if (fontNodeAuthoring) {
    report.runtimeSources = [];
    for (const relative of ["GameCli_framework/src/components/player/DialogBox.tsx",
      "GameCli_framework/src/styles/player.css", "GameCli_framework/src/styles/shell.css"]) {
      const source = path.join(root, relative), installed = path.join(actual.installRoot, relative);
      const bundled = path.join(root, "editor/src-tauri/bundle-workspace", relative);
      const sha256 = A.sha256(fs.readFileSync(source));
      assert.equal(A.sha256(fs.readFileSync(installed)), sha256, `Installed runtime source mismatch: ${relative}`);
      assert.equal(A.sha256(fs.readFileSync(bundled)), sha256, `Bundled runtime source mismatch: ${relative}`);
      report.runtimeSources.push({ relative, source, installed, bundled, sha256 });
    }
  }
  report.installation = { directory: actual.installRoot, executable: actual.executable };
  save();
  if (androidCleanupEvidence || androidVersionProvenance || runtimeWebview) {
    if (runtimeWebview) {
      report.webviewSources = [];
      for (const relative of [
        "GameCli_framework/src/main.tsx", "GameCli_framework/src/utils/runtimeCompatibility.ts",
        "GameCli_framework/src/types/runtimeCompatibility.d.ts",
        "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx", "GameCli_framework/src/styles/player.css",
        "GameCli_framework/src/styles/shell.css",
        "GameCli_framework/package.json", "GameCli_framework/package-lock.json",
        "scripts/prepare-runtime-compat-licenses.cjs",
      ]) {
        const source = path.join(root, relative), installed = path.join(actual.installRoot, relative);
        const bundled = path.join(root, "editor/src-tauri/bundle-workspace", relative);
        const sha256 = A.sha256(fs.readFileSync(source));
        assert.equal(A.sha256(fs.readFileSync(installed)), sha256, `Installed compatibility source differs: ${relative}`);
        assert.equal(A.sha256(fs.readFileSync(bundled)), sha256, `Bundled compatibility source differs: ${relative}`);
        report.webviewSources.push({ relative, source, installed, bundled, sha256 });
      }
      // The manifest drives resource preparation; only its listed helpers are
      // shipped. Do not require the build-only manifest in an installation.
      const manifestFile = path.join(root, "scripts/standalone-build-scripts.json");
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      assert.equal(manifest.schemaVersion, 1);
      assert(manifest.scripts.length > 0 && new Set(manifest.scripts).size === manifest.scripts.length);
      report.buildHelperManifest = { path: manifestFile, sha256: A.sha256(fs.readFileSync(manifestFile)),
        scope: "Build-time copy list, not a runtime resource", helpers: [] };
      for (const name of manifest.scripts) {
        assert.equal(path.basename(name), name);
        const source = path.join(root, "scripts", name);
        const sha256 = A.sha256(fs.readFileSync(source));
        for (const base of [actual.installRoot, path.join(root, "editor/src-tauri/bundle-workspace")])
          assert.equal(A.sha256(fs.readFileSync(path.join(base, "scripts", name))), sha256);
        report.buildHelperManifest.helpers.push({ name, sha256 });
      }
    }
    if (androidVersionProvenance) {
      report.versionSources = [];
      for (const relative of ["scripts/build-runtime-standalone-android.ps1", "scripts/android-acceptance-evidence.cjs",
        "GameCli_framework/src-tauri/Cargo.toml", "shared/cartridge/constants.ts"]) {
        const source = path.join(root, relative), installed = path.join(actual.installRoot, relative);
        const bundled = path.join(root, "editor/src-tauri/bundle-workspace", relative);
        const sha256 = A.sha256(fs.readFileSync(source));
        assert.equal(A.sha256(fs.readFileSync(installed)), sha256, `Installed version source differs: ${relative}`);
        assert.equal(A.sha256(fs.readFileSync(bundled)), sha256, `Bundled version source differs: ${relative}`);
        report.versionSources.push({ relative, source, installed, bundled, sha256 });
      }
    }
    if (cardPosition) {
      assert.equal(A.sha256(fs.readFileSync(gateFile)), report.gate.sha256);
      const verified = require("./lib/novel-card-position-release-evidence.cjs").validateCardPositionRelease(
        cardPosition.evidence.path, { root, runtimeFile: gateFile, runtime: gate, runtimeBytes: gateBytes });
      assert.equal(verified.evidence.sha256, cardPosition.evidence.sha256, "Card evidence changed during release build");
    }
    report.status = runtimeWebview ? "INSTALLED_RUNTIME_WEBVIEW_RELEASE_READY"
      : androidVersionProvenance ? "INSTALLED_ANDROID_VERSION_RELEASE_READY" : "INSTALLED_ANDROID_CLEANUP_RELEASE_READY";
    return;
  }
  if (portableSaves) {
    report.runtimeSources = [];
    for (const source of gate.sourceBefore.filter(row => row.file.startsWith("GameCli_framework/"))) {
      for (const base of [actual.installRoot, path.join(root, "editor/src-tauri/bundle-workspace")]) {
        const file = path.join(base, source.file);
        assert.equal(A.sha256(fs.readFileSync(file)), source.sha256, `Installed source mismatch: ${file}`);
      }
      report.runtimeSources.push(source);
    }
    const flowOut = path.join(out, "portable-saves-01");
    await step("installed-editor-real-windows-export-native-save-migration", process.execPath,
      [path.join(root, "scripts/portable-save-installed-flow.cjs"),
        path.join(session, "installer-resource-report.json"), flowOut],
      { AGENTVN_TEST_PROJECT: path.join(flowOut, "存档验收隔离工程.vnproj"),
        AGENTVN_WORKSPACE_OUTPUT: flowOut, E5_LIFECYCLE_SOURCE: "" });
    const flowFile = path.join(flowOut, "report.json");
    const flow = JSON.parse(fs.readFileSync(flowFile));
    assert.equal(flow.status, "INSTALLED_PORTABLE_SAVE_FLOW_PASS");
    assert(flow.cases.length > 0 && flow.cases.every(row => row.status === "PASS"));
    report.portableSaves = { path: flowFile, sha256: A.sha256(fs.readFileSync(flowFile)), cases: flow.cases.length };
    report.status = "INSTALLED_PORTABLE_SAVE_RELEASE_PASS";
    return;
  }
  const authorOut = path.join(out, "authoring-01");
  await step(fontNodeAuthoring ? "actual-installed-font-node-native-export-player" : "actual-installed-author-native-export-player", process.execPath,
    [path.join(root, "scripts/installed-layout-authoring-playwright.cjs"),
      path.join(session, "installer-resource-report.json"), authorOut, fontNodeAuthoring ? "--font-node-authoring" : "--player-authoring"],
    { AGENTVN_TEST_PROJECT: path.join(authorOut, "普通对白作者隔离工程.vnproj"), AGENTVN_WORKSPACE_OUTPUT: authorOut,
      E5_LIFECYCLE_SOURCE: "", AGENTVN_FONT_NODE_DIAGNOSTIC: "" });
  const author = JSON.parse(fs.readFileSync(path.join(authorOut, "report.json")));
  assert.equal(author.status, "PASS");
  assert.equal(author.cases.length, fontNodeAuthoring ? 5 : 6);
  if (fontNodeAuthoring) {
    assert.equal(author.fontMatrix.length, 12); assert.equal(author.nodeMatrix.length, 12);
  } else assert.equal(author.matrix.length, 12);
  assert.equal(author.playerMatrix.length, 12); assert.deepEqual(author.errors, []);
  report.authoring = { path: path.join(authorOut, "report.json"), sha256: A.sha256(fs.readFileSync(path.join(authorOut, "report.json"))),
    cases: author.cases.length, authorMatrix: fontNodeAuthoring ? author.fontMatrix.length : author.matrix.length,
    ...(fontNodeAuthoring ? { nodeMatrix: author.nodeMatrix.length } : {}), playerMatrix: 12 };
  report.status = fontNodeAuthoring ? "INSTALLED_FONT_NODE_AUTHORING_RELEASE_PASS" : "INSTALLED_PLAYER_AUTHORING_RELEASE_PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, report: path.join(out, "report.json"), error: report.error }));
});
