"use strict";
// Current installed author -> real exported bytes -> native Player. Reuse the
// complete historical hide matrix; bind current identity/isolation explicitly.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { spawnSync } = require("node:child_process"), { gunzipSync } = require("node:zlib");
const JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, until, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
// Share the explicit candidate identity with the immediately preceding exit
// matrix. Without this opt-in, existing historical callers remain unchanged.
const bindingFile = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG;
const binding = bindingFile ? read(bindingFile) : null;
const config = binding
  ? require("./candidate-layout-consumption.cjs").validateCandidateConfig(read(binding.candidateConfig.path)) : null;
const version = config?.version || "1.9.30", stamp = version.replaceAll(".", "");
const base = config?.qa || path.resolve("F:/AgentVN/QA/Editor-1.9.30-20261026-01");
const nativeRoot = path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01");
const receipt = binding?.installation.path || path.join(base, "derived-components-installation-01.json");
function resolveDeployment(candidateRoot, candidateVersion) {
  const file = [
    path.join(candidateRoot, "payload-01/deployments/installer-resource-report.json"),
    path.join(candidateRoot, "install-01/installer-resource-report.json"),
  ].find(fs.existsSync);
  assert(file, "Current candidate installer resource report is required");
  const report = read(file);
  assert.equal(report.status, "PASS");
  assert.equal(report.version, candidateVersion);
  return file;
}
const deployment = resolveDeployment(base, version);
const fixture = "F:/AgentVN/QA/Renpy-Redesign-20261021-01/installed-persistence-02/新_UI_独立验收_20261022_011603.vnproj";
const originalFile = path.join(__dirname, "installed-hide-ui-matrix.cjs");
const originalSha = "c797e227cf6c893570e697c20f1eb3f256c6e147c57ae46354bd8528ca356388";
const profileFile = path.join(__dirname, "native-dev-preview-profile.ps1");
const runDir = attempt => path.join(nativeRoot, `hide-installed-${stamp}-${attempt}`);
function build(original) {
  let source = original; const changes = [];
  const replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after); changes.push({ before, after });
  };
  replace('require("./lib/owned-installed-editor.cjs")', 'require("./candidate-1930-hide.cjs")');
  replace('require("./lib/installed-webview-capture.cjs")', 'require("./lib/current-native-capture.cjs")');
  replace('scope: "INSTALLED_EDITOR_REAL_UI_EXPORT_INSTALLED_PLAYER_MIXED_PRESENTATION_HIDE_MATRIX"',
    `scope: "INSTALLED_${version.replaceAll(".", "_")}_REAL_UI_EXPORT_PLAYER_MIXED_HIDE_MATRIX"`);
  replace('function killPlayer() {\n  if (!player) return;\n  const owned = player; player = undefined;\n' +
    '  const result = owned.exitCode !== null || owned.signalCode !== null ? 0\n' +
    '    : spawnSync("taskkill.exe", ["/PID", String(owned.pid), "/T", "/F"], { windowsHide: true }).status;\n' +
    '  report.cleanup.push({ kind: "player", pid: owned.pid, exitCode: result }); assert.equal(result, 0);\n}',
  'async function killPlayer() {\n  if (!player) return;\n  const child = player; player = undefined;\n' +
    '  await require("./candidate-1930-hide.cjs").stopPlayer(child, report, save);\n}');
  replace('    await playerBrowser.close(); playerBrowser = undefined; target = undefined; runtimeCdp = undefined; killPlayer();',
    '    await playerBrowser.close(); playerBrowser = undefined; target = undefined; runtimeCdp = undefined; await killPlayer();');
  replace('  try { killPlayer(); } catch (error)', '  try { await killPlayer(); } catch (error)');
  replace('  owner = await startInstalledEditor(out); const state = owner.state;',
    '  owner = await startInstalledEditor(out, { report, save, input }); const state = owner.state;');
  replace('(async () => {\n  const packed =',
    '(async () => {\n  require("./candidate-1930-hide.cjs").prepare(out);\n  const packed =');
  replace('  report.installedEditor = A.readInstalledSession(out).executable;',
    '  report.installedEditor = state.executable.path;');
  replace('    ...Array.from({ length: 20 }, (_, i) => ({ type: "narration", text: `后续第${i + 1}句。` })),',
    '    { type: "choice", choices: [{ choice_id: "hide_return", text: "保留当前分支", conditions: [],\n' +
    '      target_scene_id: fixture.nodes.find(n => n.type === "sceneNode").data.scene.scene_id }] },\n' +
    '    ...Array.from({ length: 20 }, (_, i) => ({ type: "narration", text: `后续第${i + 1}句。` })),');
  replace('    const identity = { layout, pid: player.pid, port }; (report.players ||= []).push(identity); save();',
    '    const identity = { layout, pid: player.pid, port };\n' +
    '    (report.players ||= []).push(identity); require("./candidate-1930-hide.cjs").rememberPlayer(identity); save();');
  replace('    assert(ready); playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);',
    '    assert(ready); require("./candidate-1930-hide.cjs").rememberPlayer(identity); save();\n' +
    '    playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);');
  replace('    target = playerBrowser.contexts()[0].pages()[0]; target.setDefaultTimeout(20000);',
    '    target = await untilNativePage(playerBrowser); target.setDefaultTimeout(20000);');
  replace('const [auditFile, portableFile, output] = process.argv.slice(2), out = path.resolve(output || "");',
    'const { untilNativePage } = require("./candidate-1930-hide.cjs");\n' +
    'const [auditFile, portableFile, output] = process.argv.slice(2), out = path.resolve(output || "");');
  replace('  return frames;\n}', '  (report.transitions ||= []).push({ stage: report.stage, hidden, frames: frames.length,\n' +
    '    intermediate: frames.filter(f => f.opacity > .001 && f.opacity < .999).length }); save();\n  return frames;\n}');
  replace('      fs.writeFileSync(path.join(out, `${report.stage}-frames.json.gz`), gzipSync(JSON.stringify(trace)), { flag: "wx" });',
    '      await require("./candidate-1930-hide.cjs").extraChecks({ target, layout, expected, report, save,\n' +
    '        position, transition, hiddenUi, startGame, readyText, expand, trace });\n' +
    '      fs.writeFileSync(path.join(out, `${report.stage}-frames.json.gz`), gzipSync(JSON.stringify(trace)), { flag: "wx" });');
  replace('  report.finishedAt = new Date().toISOString(); save();',
    '  try { require("./candidate-1930-hide.cjs").restore(out, report); }\n' +
    '  catch (error) { report.status = "FAILED"; report.restorationError = String(error.stack || error); process.exitCode = 1; }\n' +
    '  report.finishedAt = new Date().toISOString(); save();');
  new vm.Script(Module.wrap(source)); return { source, changes };
}
async function startInstalledEditor(out, { report, save, input }) {
  Object.assign(report, { launches: [], cleanups: [], errors: [], modelRequests: 0 });
  if (binding) report.rootDevProtection = rootDevProtection();
  report.tools = [__filename, originalFile, profileFile, path.join(__dirname, "lib/installed-release-session.cjs"),
    path.join(__dirname, "lib/current-native-capture.cjs")].map(desc);
  report.installation = desc(receipt);
  const host = installedReleaseSession({ installationFile: receipt, out, report, save, input });
  // The runner imports only its own controlled project via the public backend.
  try { await host.start(); }
  catch (error) { await host.stop("hide startup failure"); throw error; }
  const state = { installRoot: host.installation.installRoot, executable: host.installation.executable,
    backendPort: host.current.ports[0], cdpPort: host.current.ports[1] };
  return { state, async stop() {
    await host.stop("hide matrix finally");
    return { editor: { exitCode: 0 }, backend: { exitCode: 0 }, manualBackendSpawn: false };
  } };
}
async function untilNativePage(browser) {
  return require("./lib/wait-native-runtime-page.cjs").waitNativeRuntimePage(browser);
}
function rememberPlayer(launch) {
  const tree = ownedProcessTree(rows(), launch.pid, launch.identity?.Created);
  if (tree.length) launch.identity ??= tree[0];
  assert(launch.identity, "Exact native Player identity required");
  const known = new Map((launch.knownProcesses || []).map(p => [`${p.ProcessId}:${p.Created}`, p]));
  for (const p of tree) known.set(`${p.ProcessId}:${p.Created}`, p);
  launch.knownProcesses = [...known.values()];
}
async function stopPlayer(child, report, save) {
  const launch = report.players.find(p => p.pid === child.pid); assert(launch);
  rememberPlayer(launch);
  for (const p of [...launch.knownProcesses].reverse()) stopOwnedProcess(p, ps);
  const ids = new Set(launch.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`));
  await until(() => !rows().some(p => ids.has(`${p.ProcessId}:${p.Created}`))
    && !listeners([launch.port]).length, "exact hide Player cleanup", 15000);
  launch.cleanup = { status: "PASS", normalCloseClaimed: false };
  report.cleanup.push({ kind: "player", pid: child.pid, exitCode: 0 }); save();
}
function profile(action, out) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", profileFile,
    "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
function prepare(out) {
  assert.equal(path.dirname(path.resolve(out)), nativeRoot);
  assert.match(path.basename(out), new RegExp(`^hide-installed-${stamp}-\\d{2}$`));
  profile("Prepare", out);
}
function restore(out, report) {
  if (fs.existsSync(path.join(out, "profile-protection.json"))) {
    profile("Restore", out);
    report.restoration = desc(path.join(out, "profile-restoration.json"));
    assert.equal(read(report.restoration.path).status, "PASS");
  }
  const installed = require("./candidate-1930-exit.cjs").validateInstallation(receipt);
  if (binding) assert.deepEqual(report.rootDevProtection, rootDevProtection());
  report.frozen = [...installed.protectedFiles, ...installed.resources, installed.executable,
    binding ? report.rootDevProtection : { path: "D:/AgentVN/AgentVN Dev.exe",
      sha256: "cb5afc7568ac59aed40c7766faeffacfc7371b073645b4d6abc7fd0e30cfa1c2" }];
  for (const f of report.frozen) assert.equal(sha(f.path), f.sha256);
}
function rootDevProtection() {
  let file = path.join(base, "build-01/report.json"), packaging;
  if (!fs.existsSync(file)) {
    const packageFile = path.join(base, "package-01/report.json"), packaged = read(packageFile);
    assert.equal(packaged.status, "PASS"); assert.equal(packaged.candidateVersion, version);
    assert.equal(sha(packaged.priorGridBuild.path), packaged.priorGridBuild.sha256);
    file = packaged.priorGridBuild.path; packaging = desc(packageFile);
  }
  const built = read(file);
  assert.equal(built.status, "PASS");
  assert(built.finishedAt && built.commands.length >= 5
    && built.commands.every(c => c.status === "PASS" && c.exitCode === 0 && c.finishedAt));
  if (packaging) {
    for (const label of ["editor-typecheck", "editor-build", "GameCli_framework-build", "full-dev"])
      assert.equal(built.commands.filter(c => c.label === label).length, 1);
    const installed = require("./candidate-1930-exit.cjs").validateInstallation(receipt);
    assert.equal(built.nativePlayer.sha256,
      installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256);
  } else {
    assert.equal(built.version, version);
    assert.equal(built.commands.length, 5);
  }
  assert.equal(path.resolve(built.dev.path), path.resolve("D:/AgentVN/AgentVN Dev.exe"));
  assert.equal(sha(built.dev.path), built.dev.sha256);
  return { ...desc(built.dev.path), build: desc(file), ...(packaging ? { packaging } : {}) };
}
function exitPredecessor() {
  const original = path.join(base, binding ? `exit-audit-${version.split(".").at(-1)}/report.json`
    : "opening-audit-01/report.json");
  const explicit = process.env.AGENTVN_HIDE_EXIT_AUDIT;
  if (!explicit) return original;
  assert(binding, "An explicit current candidate is required");
  const expected = path.join(base, `exit-audit-${version.split(".").at(-1)}-journal-01/report.json`);
  assert.equal(path.resolve(explicit), expected);
  validateJournalAudit(read(explicit), original);
  return explicit;
}
function validateJournalAudit(prior, original) {
  assert.equal(prior.status, "PASS"); assert(prior.finishedAt && !prior.error);
  assert.equal(prior.checks.length, 3); assert(prior.checks.every(c => c.status === "PASS"));
  assert.equal(prior.scope, `INSTALLED_${stamp}_LIBRARY_REAL_ACL_UI_EXIT_NOT_ALT_F4_ANDROID_OR_COMPLETE_INFLIGHT_COVERAGE`);
  const p = prior.progressJournalChange; assert(p);
  assert.equal(path.resolve(p.originalAudit.path), path.resolve(original));
  assert.equal(sha(original), p.originalAudit.sha256);
  const failed = read(original);
  assert.equal(failed.status, "FAILED"); assert.equal(failed.checks.length, 0);
  assert.match(failed.error, /candidate-1930-exit\.cjs:279:21/);
  assert.equal(p.productReruns, 0); assert.equal(p.rawFilesRewritten, false);
  assert.equal(path.resolve(p.before.path), path.resolve("D:/AgentVN/plans/ACTIVE_TASKS.md"));
  assert.equal(p.before.sha256, p.preservedBefore.sha256);
  assert.equal(sha(p.preservedBefore.path), p.before.sha256);
  assert.equal(sha(p.originalSession.path), p.originalSession.sha256);
  assert.deepEqual(prior.source, failed.source); assert.deepEqual(prior.raw, failed.raw);
}
async function extraChecks(c) {
  const { target: page, layout, expected: e, report, save, position, transition, hiddenUi, startGame, readyText, trace } = c;
  // Extend the same real story flow to an active choice, without store injection.
  const prior = await position(); await readyText(); await page.locator(".dialog-box").click();
  const choice = page.getByRole("button", { name: "选择：保留当前分支", exact: true }); await choice.waitFor();
  const atChoice = await position();
  assert.equal(Number(atChoice.index), Number(prior.index) + 1);
  trace.push(...await transition(() => page.keyboard.press("h"), true)); await hiddenUi();
  trace.push(...await transition(() => page.keyboard.press("Escape"), false));
  assert.deepEqual(await position(), atChoice, "Choice survives hide without advance");
  await choice.click(); await readyText();
  await page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-current-command-index") === "1");
  const detail = { stage: report.stage, activeChoice: true, actualBranchClick: true };
  if (binding && e.width === 1920 && e.dpr === 1 && !e.reduced) {
    // The branch revisits text already read through the actual story. The real
    // quick action can therefore enable skip without editing player settings.
    await c.expand(layout);
    const skip = layout === "renpy" ? page.getByTestId("renpy-quick-skip")
      : page.locator('.quick-menu-action-layer button[aria-label="开启快进"],.quick-menu-action-layer button[aria-label="关闭快进"]');
    async function skipActive() {
      if (layout === "renpy") {
        const pressed = await skip.getAttribute("aria-pressed");
        assert(["true", "false"].includes(pressed));
        return pressed === "true";
      }
      const state = await skip.evaluate(button => ({ label: button.getAttribute("aria-label"),
        active: button.classList.contains("active") }));
      assert(["开启快进", "关闭快进"].includes(state.label));
      assert.equal(state.active, state.label === "关闭快进");
      return state.active;
    }
    trace.push(...await transition(async () => {
      await skip.click();
      await page.keyboard.press("h");
    }, true));
    await hiddenUi();
    assert.equal(await skipActive(), false);
    const suspended = await position();
    // Negative observation is longer than the real 60ms skip timer.
    await page.waitForTimeout(500);
    assert.deepEqual(await position(), suspended, "Fast forward is suspended while hidden");
    let resumed = false;
    trace.push(...await transition(async () => {
      await page.keyboard.press("h");
      resumed = await skipActive();
      assert(resumed, "Restoring UI must restore the previous skip toggle");
      await skip.click();
    }, false));
    assert.equal(await skipActive(), false);
    detail.skip = { suspended: true, resumed, stoppedByRealButton: true };
  }
  if (e.width === 1920 && e.dpr === 1) {
    trace.push(...await transition(() => page.keyboard.press("h"), true)); const before = await position();
    for (const dismiss of ["Escape", "controlled-system-back"]) {
      // Public native close command, not a forged modal or runtime-store write.
      await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
      await page.locator("[data-runtime-modal='true']").waitFor();
      if (dismiss === "Escape") await page.keyboard.press("Escape");
      else await page.evaluate(() => window.dispatchEvent(new Event("agentvn:system-back", { cancelable: true })));
      await page.locator("[data-runtime-modal='true']").waitFor({ state: "detached" });
      await hiddenUi(); assert.deepEqual(await position(), before, "Top native-close modal consumes restore input");
    }
    trace.push(...await transition(() => page.keyboard.press("h"), false));
    detail.nativeCloseModal = ["Escape", "controlled-system-back"];
  }
  trace.push(...await transition(() => page.keyboard.press("h"), true));
  await page.reload(); await startGame();
  assert.equal(await page.getByTestId("story-interface").getAttribute("aria-hidden"), "false");
  assert.equal((await position()).index, "1", "Restart resets temporary hidden state");
  detail.reloadVisible = true;
  (report.extraChecks ||= []).push(detail); save();
}
function validateMatrix(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.cleanupError && !r.restorationError && !r.error);
  assert.equal(r.scope, `INSTALLED_${version.replaceAll(".", "_")}_REAL_UI_EXPORT_PLAYER_MIXED_HIDE_MATRIX`);
  assert.equal(r.cases.length, 24); assert.equal(r.screenshots.length, 24); assert.equal(r.extraChecks.length, 24);
  assert.equal(r.modelRequests, 0); assert.deepEqual(r.errors, []);
  const keys = new Set();
  for (const c of r.cases) {
    assert.equal(c.status, "PASS");
    assert([[1920,1080],[2560,1440],[3840,2160]].some(([w,h]) => c.width === w && c.height === h));
    assert([1,2].includes(c.dpr) && typeof c.reduced === "boolean" && ["agentvn","renpy"].includes(c.layout));
    const key = `${c.layout}-${c.width}-${c.dpr}-${c.reduced}`; assert(!keys.has(key)); keys.add(key);
    const extra = r.extraChecks.filter(x => x.stage === key); assert.equal(extra.length, 1);
    assert(extra[0].activeChoice && extra[0].actualBranchClick && extra[0].reloadVisible);
    if (c.width === 1920 && c.dpr === 1)
      assert.deepEqual(extra[0].nativeCloseModal, ["Escape", "controlled-system-back"]);
    if (binding && c.width === 1920 && c.dpr === 1 && !c.reduced)
      assert.deepEqual(extra[0].skip, { suspended: true, resumed: true, stoppedByRealButton: true });
    const transitions = r.transitions.filter(t => t.stage === key);
    assert.equal(transitions.length, 20 + (c.width === 1920 && c.dpr === 1 && !c.reduced ? 2 : 0)
      + (c.width === 1920 && c.dpr === 1 ? 2 : 0) - 2
      + (binding && c.width === 1920 && c.dpr === 1 && !c.reduced ? 2 : 0));
    assert(transitions.every(t => t.intermediate >= 2 && t.frames > 0));
  }
}
function selfTest() {
  assert.equal(sha(originalFile), originalSha);
  const original = fs.readFileSync(originalFile, "utf8"), built = build(original);
  for (const change of built.changes) assert.throws(() => build(original.replace(change.before, "")));
  for (const s of ['assert.equal(report.cases.length, 24)', 'Actual continuous opacity frames',
    'for (const mode of ["nvl", "nvl", "bubble"])', 'Automatic playback is suspended while hidden',
    'Restoring pointer input must not advance', 'Switch/save/export must preserve both authored profiles'])
    assert(built.source.includes(s), s);
  let journalRejections = 0;
  if (process.env.AGENTVN_HIDE_EXIT_AUDIT) {
    const file = exitPredecessor(), prior = read(file);
    const original = prior.progressJournalChange.originalAudit.path;
    for (const mutate of [
      r => { r.status = "FAILED"; }, r => { r.checks = []; },
      r => { r.checks[0].status = "FAILED"; }, r => { r.progressJournalChange.originalAudit.sha256 = "wrong"; },
      r => { r.progressJournalChange.before.path = "D:/AgentVN/editor/src/app/App.tsx"; },
      r => { r.progressJournalChange.productReruns = 1; }, r => { r.progressJournalChange.rawFilesRewritten = true; },
      r => { r.source.sha256 = "wrong"; },
    ]) {
      const bad = structuredClone(prior); mutate(bad);
      assert.throws(() => validateJournalAudit(bad, original)); journalRejections++;
    }
    const protectedDev = rootDevProtection(); assert.equal(sha(protectedDev.path), protectedDev.sha256);
  }
  console.log(JSON.stringify({ status: "PASS", sourceDriftRejected: built.changes.length, journalRejections,
    matrixCells: 24, modelRequests: 0, nativeApps: 0 }));
}
async function audit(attempt) {
  const out = runDir(attempt), result = read(path.join(out, "report.json"));
  const auditDir = path.join(base, `hide-audit-${attempt}`); assert(!fs.existsSync(auditDir)); fs.mkdirSync(auditDir);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [], modelRequests: 0,
    scope: "CURRENT_INSTALLED_HIDE_AUTHOR_EXPORT_PREVIEW_NOT_STANDALONE_ANDROID_OR_UPGRADE", input: desc(path.join(out, "report.json")) };
  const check = async (name, fn) => { const detail = await fn(); report.groups.push({ name, status: "PASS", detail }); };
  try {
    await check("exact 24 complete flows and rejection of missing/duplicate/unfinished receipts", () => {
      validateMatrix(result);
      for (const bad of [{ ...result, cases: [] }, { ...result, cases: result.cases.slice(1) },
        { ...result, cases: [result.cases[0], ...result.cases.slice(0,23)] }, { ...result, extraChecks: [] },
        { ...result, finishedAt: null }, { ...result, transitions: [] }]) assert.throws(() => validateMatrix(bad));
      return { cells: 24, transitions: result.transitions.length, extraFlows: 24, negativeReceipts: 6 };
    });
    await check("current installation and two actual UI-exported layout packages", async () => {
      const installed = require("./candidate-1930-exit.cjs").validateInstallation(receipt);
      assert.equal(path.resolve(result.installedEditor), path.resolve(installed.executable.path));
      assert.equal(sha(result.playerExecutable.path), result.playerExecutable.sha256);
      assert.equal(result.artifacts.length, 2);
      for (const a of result.artifacts) {
        assert.equal(sha(a.path), a.sha256);
        const zip = await JSZip.loadAsync(fs.readFileSync(a.path));
        assert.equal(JSON.parse(await zip.file("ui/layout.json").async("string")).layout_type || "agentvn", a.layout);
        assert.equal(JSON.parse(await zip.file("manifest.json").async("string")).runtime_version, "0.25.0");
        const script = JSON.parse(await zip.file("script.json").async("string"));
        assert(script.scenes.some(s => s.commands.some(c => c.type === "choice" && c.choices.some(x => x.choice_id === "hide_return"))));
      }
      for (const f of result.tools) assert.equal(sha(f.path), f.sha256);
      return { editor: installed.executable, artifacts: result.artifacts };
    });
    await check("raw opacity frames, focus ownership and physical screenshot pixels", () => {
      let frames = 0;
      for (let i = 0; i < result.cases.length; i++) {
        const c = result.cases[i], key = `${c.layout}-${c.width}-${c.dpr}-${c.reduced}`, shot = result.screenshots[i];
        const trace = JSON.parse(gunzipSync(fs.readFileSync(path.join(out, `${key}-frames.json.gz`))));
        assert.equal(trace.length, c.frameCount);
        assert(trace.every(f => f.scenes === 1 && !f.invalidFocus && f.overflow <= 1));
        assert(trace.filter(f => f.opacity > .001 && f.opacity < .999).length >= 2); frames += trace.length;
        assert.deepEqual(shot.before, shot.after); assert.equal(shot.before.width, c.width); assert.equal(shot.before.height, c.height);
        assert(Math.abs(shot.before.dpr - c.dpr) <= 1e-6); assert.equal(shot.before.reduced, c.reduced);
        assert.equal(sha(shot.path), shot.sha256);
        const png = fs.readFileSync(shot.path);
        assert.equal(png.readUInt32BE(16), c.width * c.dpr); assert.equal(png.readUInt32BE(20), c.height * c.dpr);
      }
      return { frames, screenshots: 24 };
    });
    await check("host-owned backend, exact process/port cleanup and original profiles/frozen bytes", () => {
      assert.equal(result.launches.length, 1); assert.equal(result.launches[0].manualBackendSpawn, false);
      assert.equal(result.cleanups.length, 1); assert.equal(result.cleanups[0].status, "PASS");
      assert.equal(result.players.length, 2); const ids = new Set();
      for (const l of result.players) {
        assert.equal(l.cleanup.status, "PASS");
        for (const p of l.knownProcesses) ids.add(`${p.ProcessId}:${p.Created}`);
      }
      for (const p of result.knownProcesses) ids.add(`${p.ProcessId}:${p.Created}`);
      assert(!rows().some(p => ids.has(`${p.ProcessId}:${p.Created}`)));
      assert.equal(listeners([...result.players.map(p => p.port), ...result.launches[0].ports]).length, 0);
      assert.equal(sha(result.restoration.path), result.restoration.sha256);
      const restored = read(result.restoration.path); assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      const protection = read(path.join(out, "profile-protection.json")); assert.equal(protection.records.length, 2);
      for (const p of protection.records) {
        assert(!fs.existsSync(p.held)); assert.equal(fs.existsSync(p.original), p.existed);
        for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      }
      for (const f of result.frozen) assert.equal(sha(f.path), f.sha256);
      const recorded = read(path.join(base, `hide-preparation-${attempt}/binding.json`));
      for (const f of [recorded.original, recorded.adapter, recorded.executed, recorded.installation,
        recorded.fixture, ...(recorded.candidateBinding ? [recorded.candidateBinding, recorded.predecessor] : [])])
        assert.equal(sha(f.path), f.sha256);
      if (binding) assert.deepEqual(recorded.candidateBinding, { ...desc(bindingFile), value: binding });
      return { exactProcesses: ids.size, originalDirectories: 2, deletedUserFiles: 0 };
    });
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(auditDir, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
async function main() {
  if (process.argv[2] === "--self-test") return selfTest();
  const [action, attempt] = process.argv.slice(2);
  assert(["run", "audit"].includes(action)); assert.match(attempt || "", /^\d{2}$/); assert.equal(process.argv.length, 4);
  if (action === "audit") return audit(attempt);
  require("./candidate-1930-exit.cjs").validateInstallation(receipt);
  const predecessor = exitPredecessor();
  const prior = read(predecessor);
  assert.equal(prior.status, "PASS"); assert(prior.finishedAt && !prior.error && !prior.cleanupError);
  assert.equal(prior.checks.length, binding ? 3 : 4);
  assert(prior.checks.every(c => c.status === "PASS"));
  if (binding) assert.equal(prior.scope,
    `INSTALLED_${stamp}_LIBRARY_REAL_ACL_UI_EXIT_NOT_ALT_F4_ANDROID_OR_COMPLETE_INFLIGHT_COVERAGE`);
  if (binding) rootDevProtection();
  assert(!rows().some(p => /^(AgentVN Dev|agentvn-editor|agentvn-player|creator-backend)\.exe$/i.test(p.Name)));
  assert.equal(sha(originalFile), originalSha);
  const out = runDir(attempt), prep = path.join(base, `hide-preparation-${attempt}`);
  assert(!fs.existsSync(out)); assert(!fs.existsSync(prep)); fs.mkdirSync(prep);
  const built = build(fs.readFileSync(originalFile, "utf8")), executed = path.join(prep, "executed-business.cjs");
  fs.writeFileSync(executed, built.source, { flag: "wx" });
  fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
    original: desc(originalFile), adapter: desc(__filename), executed: desc(executed), installation: desc(receipt),
    changes: built.changes, fixture: desc(fixture), predecessor: desc(predecessor),
    ...(binding ? { candidateBinding: { ...desc(bindingFile), value: binding } } : {}),
  }, null, 2), { flag: "wx" });
  process.argv.splice(2, process.argv.length - 2, deployment, fixture, out);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(built.source, __filename);
}
module.exports = { build, startInstalledEditor, untilNativePage, rememberPlayer, stopPlayer, prepare, restore, extraChecks, validateMatrix, resolveDeployment, rootDevProtection };
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
