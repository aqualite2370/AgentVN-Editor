"use strict";
// Reuse complete portrait business assertions against the frozen installation.
// Only provenance, current protocol, UI readiness and isolated paths change.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Portrait-Frozen-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Portrait-Frozen-20261102-01";
const oldQa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const attempt = process.argv[3] || "01";
assert.match(attempt, /^\d{2}$/);
const playerOut = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/portrait-frozen-" + attempt;
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const installed = descriptor(), mode = process.argv[2];
assert(["self-test", "prepare", "editor", "player", "audit"].includes(mode));
function build(kind) {
  const filename = require.resolve(kind === "editor" ? "./installed-portrait-current.cjs" : "./installed-portrait-current-player.cjs");
  let source = fs.readFileSync(filename, "utf8"); const edits = [];
  function change(before, after) {
    assert.equal(source.split(before).length - 1, 1, "Exact QA adaptation: " + before);
    source = source.replace(before, () => after); edits.push({ before, after });
  }
  source = source.replaceAll(oldQa, qa);
  if (kind === "editor") {
    change('const { installedFeatureSession } = require("./lib/installed-candidate-feature-session.cjs");',
      "const installedFeatureSession = module.currentSession;");
    change('const host = installedFeatureSession(', 'let host = installedFeatureSession(');
    change('const controls = page.getByTestId("dialog-portrait-layout-editor"); await controls.waitFor();',
      `const controls = page.getByTestId("dialog-portrait-layout-editor");
    const group = page.locator(".runtime-layout-inspector > details").filter({
      has: page.locator('[data-testid="dialog-portrait-layout-editor"]') });
    await group.waitFor(); if (!await group.evaluate(n => n.open)) await click(group.locator(":scope > summary"));
    await controls.waitFor();`);
    change('assert.equal(manifest.runtime_version, "0.22.0");', 'assert.equal(manifest.runtime_version, "0.25.0");');
    change('    await step("two-actual-publishing-ui-cartridges-active-layout-and-portrait", async () => {',
      `    await step("fresh-database-public-portable-reimport-before-publishing", async () => {
        await host.stop("Fresh database reimport of actual native save");
        const fresh = path.join(out,"fresh"); fs.mkdirSync(fresh);
        host = installedFeatureSession({out:fresh,report,save,testProject:report.portable.path});
        page = await startHost();
        const response = await fetch("http://127.0.0.1:"+host.current.ports[0]+"/api/project/projects/import",{
          method:"POST",headers:{"content-type":"application/octet-stream",
            "X-AgentVN-Filename":encodeURIComponent(path.basename(report.portable.path))},
          body:fs.readFileSync(report.portable.path),signal:AbortSignal.timeout(30000)});
        const body = await response.json(); assert(response.ok && body.ok);
        assert.equal(body.data.project_id,prep.projectId); await page.reload();
        await page.locator('[data-help-key="home.recentProject"]:visible').filter({hasText:prep.title}).click();
        await settleEditor(page);
        assert.deepEqual((await stored()).editor_settings.runtimeUILayoutProfiles,persisted.editor_settings.runtimeUILayoutProfiles);
        assert.deepEqual(graph(await stored()),graph(initial)); return {freshDatabase:true};
      });
    await step("two-actual-publishing-ui-cartridges-active-layout-and-portrait", async () => {`);
    change('assert.equal(report.steps.length, 6); assert(report.steps.every(s => s.status === "PASS"));',
      'assert.equal(report.steps.length, 7); assert(report.steps.every(s => s.status === "PASS"));');
    source = source.replaceAll('"-RunDirectory", out],', '"-RunDirectory", out, "-AllowedRunRoot", qa, "-CodexCacheView"],');
    source = source.replaceAll('{ encoding: "utf8", windowsHide: true, timeout: 30000 });',
      '{ encoding: "utf8", windowsHide: true, timeout: 60000, env:{...process.env,AGENTVN_INSTALLED_GUI_QA_ROOT:qa} });');
    change('scope: "NSIS_INSTALLED_PORTRAIT_AUTHOR_SAVE_RESTART_EXPORT_NOT_FULL_REGRESSION"',
      'scope: "FROZEN_1935_INSTALLED_PORTRAIT_AUTHOR_NATIVE_SAVE_FRESH_IMPORT_TWO_UI_EXPORTS"');
  } else {
    change('assert.equal(source.steps.length, 6);', 'assert.equal(source.steps.length, 7);');
    change('"F:/AgentVN/QA/Installed-Candidate-20261021-01/installation.json"', JSON.stringify(receipt));
    change('const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/${dialogRelease\n  ? "installed-dialog-release" : "installed-portrait-current"}-${attempt}`;',
      `const out = ${JSON.stringify(playerOut)};`);
    change('path.join(root, "scripts/native-dev-preview-profile.ps1")', JSON.stringify(helper));
    change('"-Action", action, "-RunDirectory", out],', '"-Action", action, "-RunDirectory", out, "-CodexCacheView"],');
    change('page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())), "Player page");',
      'page = await require("./lib/wait-native-runtime-page.cjs").waitNativeRuntimePage(browser);');
    change('report.version = source.version ?? "1.9.13";', 'report.editorVersion = "1.9.35"; report.playerPEVersion = "1.9.1";');
    change('    AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out });',
      '    AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out, TEMP:path.join(out,"temporary"),TMP:path.join(out,"temporary") });\n  fs.mkdirSync(env.TEMP,{recursive:true});');
  }
  new vm.Script(Module.wrap(source)); return { filename, source, edits };
}
function prepare() {
  fs.mkdirSync(qa, { recursive: true }); fs.mkdirSync(checkpoint, { recursive: true });
  const prior = read(oldQa + "/preparation.json");
  assert.equal(sha(prior.input.path), prior.input.sha256);
  const prep = { ...prior, at: new Date().toISOString(), historicalFixtureOnly: desc(oldQa + "/preparation.json"),
    immutable: [installed.executable, ...installed.resources], installation: desc(receipt),
    source: desc(__filename), oldResultsNotReused: true, modelRequests: 0 };
  fs.copyFileSync(__filename, path.join(checkpoint, "adapter-" + attempt + ".cjs"), fs.constants.COPYFILE_EXCL);
  if (!fs.existsSync(path.join(qa, "preparation.json")))
    fs.writeFileSync(path.join(qa, "preparation.json"), JSON.stringify(prep, null, 2), { flag: "wx" });
  else for (const f of read(qa + "/preparation.json").immutable) assert.equal(sha(f.path), f.sha256);
  for (const kind of ["editor", "player"]) {
    const b = build(kind), file = path.join(qa, kind + "-executed-" + attempt + ".cjs");
    fs.writeFileSync(file, b.source, { flag: "wx" });
    fs.writeFileSync(path.join(qa, kind + "-binding-" + attempt + ".json"), JSON.stringify({
      original: desc(b.filename), executed: desc(file), edits: b.edits, adapter: desc(__filename),
      installation: desc(receipt), helper: desc(helper),
      observations: desc(require.resolve("./lib/portrait-installed-observation.cjs")),
    }, null, 2), { flag: "wx" });
  }
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "installed-layout-cache-session.ps1"), "-Action", "SelfTest",
    "-RunDirectory", path.join(qa, "editor-" + attempt), "-AllowedRunRoot", qa, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 60000, env: { ...process.env, AGENTVN_INSTALLED_GUI_QA_ROOT: qa } });
  fs.writeFileSync(path.join(qa, "cache-self-test-" + attempt + ".txt"), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  console.log("PASS current portrait preparation and protected-path self-test");
}
function audit() {
  const ef = qa + "/editor-" + attempt + "/report.json", pf = playerOut + "/report.json", e = read(ef), p = read(pf);
  assert.equal(e.status, "EDITOR_PASS_PLAYER_NOT_RUN"); assert.equal(p.status, "PASS");
  assert.equal(e.steps.length, 7); assert(e.steps.every(s => s.status === "PASS"));
  assert.equal(e.matrix.length, 12); assert(e.matrix.every(c => c.status === "PASS" && c.checks.length === 2));
  assert.equal(p.cases.length, 24); assert(p.cases.every(c => c.status === "PASS" && c.checks.length === 2));
  assert.equal(p.source.sha256, sha(ef)); assert.deepEqual(e.errors, []); assert.deepEqual(p.errors, []);
  assert.equal(e.modelRequests + p.modelRequests, 0);
  const { verifyPortrait, verifyCustom } = require("./lib/portrait-installed-observation.cjs");
  const prep = read(qa + "/preparation.json");
  for (const c of p.cases) { verifyPortrait(c.bound, prep.portraitSha256); verifyCustom(c.bound, prep.values[c.type]); }
  for (const r of [e, p]) for (const s of r.screenshots) {
    assert.equal(sha(s.path), s.sha256); const bytes = fs.readFileSync(s.path);
    assert.equal(bytes.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
    assert.equal(bytes.readUInt32BE(20), Math.round(s.before.height * s.before.dpr)); assert.deepEqual(s.before, s.after);
  }
  for (const kind of ["editor", "player"]) {
    const b = read(qa + "/" + kind + "-binding-" + attempt + ".json");
    for (const f of [b.original, b.executed, b.adapter, b.installation, b.helper, b.observations]) assert.equal(sha(f.path), f.sha256);
    assert.equal(fs.readFileSync(b.executed.path, "utf8"), build(kind).source);
  }
  for (const f of [e.portable, ...e.cartridges, ...prep.immutable, e.nativeCacheRestoration, p.profileRestoration]) assert.equal(sha(f.path), f.sha256);
  assert.equal(read(e.nativeCacheRestoration.path).status, "PASS");
  assert.equal(read(p.profileRestoration.path).status, "PASS");
  const owned = [...e.knownProcesses, ...p.knownProcesses], ports = [...e.launches.flatMap(l => l.ports), ...p.launches.map(l => l.port)];
  assert(!rows().some(n => owned.some(o => o.ProcessId === n.ProcessId && o.Created === n.Created)));
  assert.equal(listeners(ports).length, 0);
  assert(e.cleanups.every(c => c.status === "PASS") && p.cleanups.every(c => c.status === "PASS"));
  assert.equal(e.downloadCleanup.status, "PASS"); assert(!fs.existsSync(e.nativeSaveSource.path));
  const result = { status: "PASS", at: new Date().toISOString(), author: desc(ef), player: desc(pf),
    editorStages: 7, authorDisplays: 12, playerDisplays: 24, ownedIdentities: owned.length, ports: ports.length,
    screenshots: e.screenshots.length + p.screenshots.length, productChanges: 0, builds: 0, modelRequests: 0,
    scope: "FROZEN_INSTALLED_PORTRAIT_CONTROLS_DEFAULTS_RESET_UNDO_REDO_RESTART_FRESH_IMPORT_EXPORT_PLAYER" };
  fs.writeFileSync(qa + "/audit-" + attempt + ".json", JSON.stringify(result, null, 2), { flag: "wx" }); console.log(JSON.stringify(result));
}
if (mode === "self-test") {
  for (const kind of ["editor", "player"]) build(kind);
  console.log("PASS portrait exact adaptations compile; product launches=0");
} else if (mode === "prepare") prepare();
else if (mode === "audit") audit();
else {
  const b = build(mode), binding = read(qa + "/" + mode + "-binding-" + attempt + ".json");
  assert.equal(fs.readFileSync(binding.executed.path, "utf8"), b.source);
  assert.equal(sha(__filename), binding.adapter.sha256);
  process.argv = [process.execPath, b.filename, ...(mode === "editor" ? ["editor", attempt] : [attempt, attempt])];
  const worker = new Module(b.filename, module); worker.filename = b.filename; worker.paths = module.paths;
  worker.currentSession = ({ out, report, save, testProject }) => installedReleaseSession({
    installationFile: receipt, out, report, save, input: testProject });
  worker._compile(b.source, b.filename);
}
