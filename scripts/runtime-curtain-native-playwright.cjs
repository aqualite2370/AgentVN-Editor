"use strict";
// Real compressed frontend, OS WebView and attributed cleanup; explicit installed or Dev binding.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const { InstalledPreview1922Session } = require("./lib/installed-runtime-preview-1922-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { beginRuntimeMotion, finishRuntimeMotion } = require("./lib/installed-runtime-motion-sampler.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
const buildFile = path.resolve(process.argv[3]), build = read(buildFile);
const installationArg = process.argv.find(arg => arg.startsWith("--installation="));
const installationFile = installationArg && path.resolve(installationArg.slice("--installation=".length));
let installation, executable = build.player;
assert.equal(build.status, "PASS");
assert.equal(build.commands.length, installationFile ? 5 : 4); assert(build.commands.every(c => c.status === "PASS"));
for (const f of [...build.sources, build.player, build.dev]) assert.equal(sha(f.path), f.sha256);
if (installationFile) {
  assert.match(build.version, /^\d+\.\d+\.\d+$/);
  const receipt = read(installationFile);
  assert.equal(receipt.status, "PASS"); assert.equal(receipt.exitCode, 0); assert.equal(receipt.registryRestored, true);
  assert.equal(path.dirname(path.resolve(receipt.installRoot)), path.dirname(installationFile));
  assert.deepEqual(receipt.installer, read(path.join(path.dirname(installationFile), "installer-resource-report.json")).installers[0]);
  assert.equal(receipt.installer.sha256, build.installer.sha256);
  for (const f of [receipt.installer, receipt.executable]) assert.equal(sha(f.path), f.sha256);
  const resourcesFile = path.join(path.dirname(installationFile), "installer-resource-report.json"), resources = read(resourcesFile);
  assert.equal(resources.status, "PASS"); assert.equal(resources.version, build.version);
  const payload = resources.deployments.find(d => d.kind === "NSIS actual payload");
  assert(payload); assert.equal(payload.executable.sha256, receipt.executable.sha256);
  executable = desc(path.join(receipt.installRoot, "agentvn-player.exe"));
  assert.equal(executable.sha256, build.player.sha256);
  assert.equal(sha(path.join(receipt.installRoot, "creator-backend.exe")), build.backend.sha256);
  assert.equal(read(path.join(receipt.installRoot, "build-versions.json")).editorVersion, build.version);
  for (const relative of ["GameCli_framework/src/app/RuntimeScreenNavigator.tsx", "GameCli_framework/src/styles/shell.css"])
    assert.equal(sha(path.join(receipt.installRoot, relative)), sha(path.resolve(relative)));
  const version = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "(Get-Item -LiteralPath $env:AGENTVN_CURTAIN_INSTALLED_EXE).VersionInfo.ProductVersion"],
  { encoding: "utf8", windowsHide: true, env: { ...process.env, AGENTVN_CURTAIN_INSTALLED_EXE: receipt.executable.path } }).trim();
  assert.equal(version, build.version);
  installation = { receipt: desc(installationFile), resources: desc(resourcesFile),
    editor: receipt.executable, player: executable, version };
}
const exportArg = process.argv.find(arg => arg.startsWith("--export-report="));
const exportFile = exportArg ? path.resolve(exportArg.slice("--export-report=".length))
  : "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-87/report.json";
const exported = read(exportFile); assert.equal(exported.status, "PASS");
if (exportArg) {
  assert(installation, "Fresh current export requires an actual installation binding");
  assert.equal(exported.scope, `ACTUAL_${build.version.replaceAll(".", "")}_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE`);
  assert.equal(exported.steps.length, 3); assert(exported.steps.every(s => s.status === "PASS"));
  assert(exported.finishedAt && !exported.cleanupError);
  assert.equal(sha(exported.installation.path), exported.installation.sha256);
  const exportInstallation = read(exported.installation.path);
  assert.equal(exportInstallation.executable.sha256, installation.editor.sha256);
  assert.equal(exportInstallation.version, build.version);
}
assert.equal(sha(exported.fixture.input), exported.fixture.inputSha256);
for (const f of exported.cartridges) assert.equal(sha(f.path), f.sha256);
assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/curtain-${
  installation ? `installed-${build.version.replaceAll(".", "")}` : "dev"}-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: installation ? "ACTUAL_NEW_NSIS_INSTALLED_PLAYER_NOT_ANDROID_OR_COMPLETE_INSTALLER_ACCEPTANCE"
    : "NEW_DEV_PLAYER_COMPRESSED_FRONTEND_NOT_FROZEN_INSTALLER_OR_ANDROID",
  installation, build: desc(buildFile), exported: desc(exportFile), modelRequests: 0,
  tools: [__filename, "scripts/lib/installed-runtime-preview-1922-session.cjs",
    "scripts/lib/installed-runtime-motion-sampler.cjs", "scripts/native-dev-preview-profile.ps1"].map(desc),
  launches: [], screenshots: [], cases: [], pageErrors: [], normalCloseClaimed: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function profiles(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.resolve("scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out, "-Storage", "NativeRoaming"],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profiles-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
let session, protectedProfiles = false;
(async () => {
  save();
  fs.mkdirSync(path.join(out, "tools"));
  for (const tool of report.tools) {
    tool.copy = path.join(out, "tools", path.basename(tool.path));
    fs.copyFileSync(tool.path, tool.copy, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(tool.copy), tool.sha256);
  }
  save(); protectedProfiles = true; profiles("Prepare");
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
  const prep = { status: "PASS", executable, current1922Preview: true,
    defaultStorage: "CODEX_EXPLICIT_PROFILE_JUNCTION_PREVIEW", sessionRoot: out, temporary,
    profiles: read(path.join(out, "profile-protection.json")).records };
  session = new InstalledPreview1922Session({ prep, fixture: exported.fixture,
    cartridges: exported.cartridges, out, report, save, currentNative: true });
  for (const layout of ["agentvn", "renpy"]) {
    await session.start(layout);
    session.launch.provenance = report.scope; session.launch.scope = report.scope; save();
    await session.page.getByTestId("start-new-game").click(); await session.ready("playing");
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const metric = { width, height: width * 9 / 16, dpr, reduced };
      await session.viewport(metric);
      const item = { layout, ...metric, status: "RUNNING" }; report.cases.push(item); save();
      await session.page.evaluate(() => {
        const root = document.querySelector("[data-runtime-screen-transition]"), events = [];
        const listener = e => {
          if (e.target === root && e.pseudoElement === "::before" && e.propertyName === "opacity")
            events.push({ type: e.type, phase: root.dataset.runtimeTransitionPhase, elapsed: e.elapsedTime * 1000 });
        };
        for (const t of ["transitionend", "transitioncancel"]) root.addEventListener(t, listener);
        window.__curtainNative = { events, stop() {
          for (const t of ["transitionend", "transitioncancel"]) root.removeEventListener(t, listener);
        } };
      });
      await beginRuntimeMotion(session.page, "actual-blackout-completion");
      await session.page.keyboard.press("Escape"); await session.ready("main_menu");
      const trace = await finishRuntimeMotion(session.page);
      const observations = await session.page.evaluate(() => {
        const r = window.__curtainNative; r.stop(); delete window.__curtainNative;
        return { events: r.events, focus: document.activeElement !== document.body
          && !document.activeElement.closest("[inert], [aria-hidden='true']") };
      });
      const end = observations.events.filter(e => e.type === "transitionend");
      assert.equal(observations.events.filter(e => e.type === "transitioncancel").length, 0);
      assert.deepEqual(end.map(e => e.elapsed), reduced ? [408, 408] : [748, 884]);
      assert(observations.focus);
      assert(trace.frames.length > 2 && trace.frames.every(f => f.functionalLayerCount === 1 && f.playerCount <= 1
        && f.horizontalOverflow <= 1 && !f.unavailableFocus && !f.hidden));
      for (const phase of ["covering", "revealing"])
        assert(trace.frames.some(f => f.phase === phase && f.black > .01 && f.black < .99));
      const commit = trace.frames.find(f => f.screen === "main_menu" && f.committed === "main_menu");
      assert(commit && commit.black >= .999);
      const traceFile = path.join(out, `${layout}-${width}-${dpr}-${reduced}.json`);
      fs.writeFileSync(traceFile, JSON.stringify({ observations, trace }), { flag: "wx" });
      item.evidence = desc(traceFile);
      report.screenshots.push(await captureInstalledWebview(session.page, session.cdp,
        path.join(out, `${layout}-${width}-${dpr}-${reduced}.png`), metric));
      item.status = "PASS"; save();
      console.log(`PASS native curtain ${layout}/${width}/${dpr}/${reduced}`);
      await session.page.getByTestId("continue-game").click(); await session.ready("playing");
    }
    await session.stop();
  }
  assert.equal(report.cases.length, 24); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.pageErrors, []);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    try {
      await session?.stop();
      const identities = report.launches.flatMap(l => l.knownProcesses || []), ports = report.launches.map(l => l.port);
      assert(!rows().some(p => identities.some(i => i.ProcessId === p.ProcessId && i.Created === p.Created)));
      assert.equal(listeners(ports).length, 0);
      report.cleanup = { status: "PASS", identities: identities.length, ports,
        method: "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE" };
    } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    try {
      if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
        profiles("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(report.restoration.path).status, "PASS");
      }
      for (const f of [...build.sources, build.player, build.dev, report.build, report.exported, ...report.tools])
        assert.equal(sha(f.path), f.sha256);
      if (installation) for (const f of [installation.receipt, installation.resources, installation.editor, installation.player])
        assert.equal(sha(f.path), f.sha256);
    } catch (e) { report.restorationError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
  });
