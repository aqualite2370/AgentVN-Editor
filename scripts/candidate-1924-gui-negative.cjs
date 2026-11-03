"use strict";
// Current sealed candidate. Clone the previously authored disposable database;
// never mutate its original evidence. Eight scanner cases and real apply failure.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const {validateCandidateConfig}=require("./candidate-layout-consumption.cjs");
const {deriveActual}=require("./installed-profile-data-replay.cjs");
const configArgs=process.argv.filter(a=>a.startsWith("--candidate-config="));assert(configArgs.length<=1);
const config=configArgs.length?validateCandidateConfig(JSON.parse(fs.readFileSync(configArgs[0].slice(19),"utf8"))):null;
const authorArgs=process.argv.filter(a=>a.startsWith("--author="));assert(authorArgs.length<=1);
const authorAttempt=authorArgs[0]?.slice(9);
if(config)assert.match(authorAttempt??"",/^\d{2}$/);
const current1930=process.argv.includes("--candidate=1.9.30");
assert(!config||!current1930);
const root = path.resolve(__dirname, ".."), sourceRoot = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-"+(config?authorAttempt:current1930?"66":"57");
const attempt=config?(process.argv.includes("--self-test")?"82":process.argv[2]):current1930?"64":"59";
assert.match(attempt??"",/^\d{2}$/);
const out = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-"+attempt;
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const original = read(path.join(sourceRoot, "report.json"));
assert.equal(original.status, "EDITOR_PASS_NATIVE_PLAYER_NOT_RUN");
if(config) {
  assert.equal(original.version,config.version);
  assert.equal(original.steps.length,8);assert(original.steps.every(s=>s.status==="PASS"));
  assert.equal(original.nativeCacheRestoration,"PASS");
  assert(!original.cleanupError&&original.finishedAt);
  const actual=deriveActual(config.actual,config.version);
  assert(original.launches.every(l=>l.executable.sha256===actual.executable.sha256));
} else if(!current1930)assert.equal(sha(path.join(sourceRoot, "report.json")), "52d8e4e4f623d459f4157a78fa91ca325d6d450a3369b839c8fff9ccab49004a");
else {
  assert.equal(original.steps.length,8);assert(original.steps.every(s=>s.status==="PASS"));
  assert.equal(original.nativeCacheRestoration,"PASS");
  assert(original.launches.every(l=>l.executable.sha256==="a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577"));
}
assert.equal(sha(original.officialArchive.path), original.officialArchive.sha256);
const prefix = "官方模板 中文/game/";
function inventory(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name); assert(!e.isSymbolicLink(), p);
    return e.isDirectory() ? inventory(p) : [desc(p)];
  }).sort((a, b) => a.path.localeCompare(b.path)) : [];
}
const attacks = [
  ["traversal", "unsafe_path", z => z.file("../escape.txt", "unsafe", { createFolders: false })],
  ["case-duplicate", "unsafe_path", z => z.file(prefix + "gui/Main_Menu.png", "duplicate", { createFolders: false })],
  ["symlink", "symbolic_link", z => z.file(prefix + "gui/link.png", "../outside",
    { unixPermissions: 0o120777, createFolders: false }), "UNIX"],
  ["compression-limit", "archive_limit", z => z.file(prefix + "bomb.bin", Buffer.alloc(1024 * 1024), { createFolders: false })],
  ["missing-gui", "missing_gui", z => z.remove(prefix + "gui.rpy")],
  ["ambiguous-gui", "ambiguous_gui", z => z.file("another/gui.rpy", "define gui.navigation_xpos = 0", { createFolders: false })],
  ["unsupported-expression", "unsupported_expression", async z => z.file(prefix + "gui.rpy",
    await z.file(prefix + "gui.rpy").async("string") + '\ndefine gui.navigation_xpos = __import__("builtins").len("x")\n')],
  ["damaged-image", "invalid_asset", z => z.file(prefix + "gui/main_menu.png", "not a valid PNG", { createFolders: false })],
];
if (process.argv.includes("--self-test")) {
  assert.equal(attacks.length, 8); assert.equal(new Set(attacks.map(a => a[0])).size, 8);
  assert.equal(original.savedProject.assetManifest.length, 26);
  assert.equal(original.steps.length, 8); assert(original.steps.every(s => s.status === "PASS"));
  assert(!fs.existsSync(out)); console.log(JSON.stringify({ status: "PASS", cases: 8, scope: "QA_PREFLIGHT_ONLY" }));
} else {
  assert.deepEqual(process.argv.slice(2),config?[attempt,configArgs[0],authorArgs[0]]:current1930?[attempt,"--candidate=1.9.30"]:[attempt]);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const protectedSource = inventory(path.join(sourceRoot, "data"));
  fs.cpSync(path.join(sourceRoot, "data"), path.join(out, "data"), { recursive: true, errorOnExist: true, force: false });
  const input = original.environment.AGENTVN_TEST_PROJECT;
  const installationFile = config?path.join(config.qa,`gui-author-preparation-${authorAttempt}`,"derived-installed.json"):current1930
    ?"F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json"
    :"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
  const report = { version:config?.version??(current1930?"1.9.30":"1.9.24"), status: "RUNNING", startedAt: new Date().toISOString(), cases: [], checks: [], errors: [],
    screenshots: [], launches: [], cleanups: [], knownProcesses: [], modelRequests: 0, productChanges: 0, builds: 0,
    source: desc(path.join(sourceRoot, "report.json")), protectedSource,
    installation: desc(installationFile), officialArchive: original.officialArchive,
    environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out },
    scope: "CURRENT_INSTALLED_GUI_EIGHT_NEGATIVE_ZIPS_AND_LIBRARY_APPLY_CONFLICT_ATOMICITY_NOT_ALL_NATIVE_LINK_ATTACKS" };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const host = installedReleaseSession({ installationFile, out, input, report, save });
  assert.equal(host.installation.executable.sha256,config?deriveActual(config.actual,config.version).executable.sha256:current1930
    ?"a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577"
    :"ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");
  let page, protectedCache = false;
  const dialog = () => page.getByTestId("renpy-gui-import-dialog");
  function cache(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/installed-layout-cache-session.ps1", "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
    { cwd: root, windowsHide: true, encoding: "utf8", timeout: 30000 });
    (report.cache ??= []).push({ action, code: r.status, stdout: r.stdout, stderr: r.stderr }); save();
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  const library = () => inventory(path.join(out, "data", "gui-pack-library"));
  async function snapshot() {
    const s = await host.api(`/api/project/projects/${original.savedProject.projectId}`);
    const { updated_at, ...content } = s; return content;
  }
  async function cancel() {
    await dialog().getByRole("button", { name: "取消，不修改工程", exact: true }).click();
    await dialog().waitFor({ state: "detached" });
  }
  (async () => {
    fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
    cache("SelfTest"); cache("Prepare"); protectedCache = true; page = await host.start();
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: original.savedProject.title }).click();
    await A.settleEditor(page); await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
    await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    const baseline = await snapshot(), libraryBefore = library();
    assert.equal(baseline.asset_manifest.length, 26); report.libraryBefore = libraryBefore;
    const bytes = fs.readFileSync(original.officialArchive.path);
    for (const [name, issue, mutate, platform] of attacks) {
      const z = await JSZip.loadAsync(bytes, { checkCRC32: true }); await mutate(z);
      const file = path.join(out, name + ".zip");
      fs.writeFileSync(file, await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: platform || "DOS" }), { flag: "wx" });
      const c = { name, expectedIssue: issue, artifact: desc(file), status: "RUNNING" }; report.cases.push(c); save();
      await page.getByTestId("renpy-gui-import-open").click(); await dialog().waitFor();
      await dialog().getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles(file);
      await dialog().locator(".renpy-gui-import-summary").waitFor();
      c.issues = await dialog().locator('[aria-label="扫描问题"]').innerText(); assert(c.issues.includes(issue), c.issues);
      const blocked = !["unsupported-expression", "damaged-image"].includes(name);
      if (blocked) {
        // A disabled licensing checkbox must not be the only reason commit is blocked.
        const license = dialog().getByRole("checkbox", { name: /我已重新核对/ });
        if (await license.count()) await license.check();
        assert(await dialog().getByRole("button", { name: "确认入库，不修改工程", exact: true }).isDisabled());
      }
      if (name === "unsupported-expression")
        assert((await dialog().locator(".renpy-gui-import-row").filter({ hasText: "shared.x" }).innerText()).includes("40"));
      if (name === "damaged-image") assert.equal(await dialog().locator(".renpy-gui-import-asset-row").count(), 24);
      assert.deepEqual(await snapshot(), baseline); assert.deepEqual(library(), libraryBefore);
      await cancel(); assert.deepEqual(await snapshot(), baseline); assert.deepEqual(library(), libraryBefore);
      c.wholeArchiveBlocked = blocked; c.status = "PASS"; c.finishedAt = new Date().toISOString(); save();
      console.log("PASS GUI negative " + name);
    }
    await page.getByTestId("renpy-gui-import-open").click(); await dialog().waitFor();
    const packId = read(original.libraryOriginal.path).id;
    await dialog().locator(`article[data-pack-id="${packId}"]`).getByRole("button", { name: "预览并选择应用", exact: true }).click();
    await page.getByTestId("renpy-gui-impact").waitFor();
    await A.select(page, prefix + "gui/main_menu.png 游戏界面用途", "标题页主视觉");
    await A.select(page, prefix + "gui/game_menu.png 游戏界面用途", "标题页主视觉");
    await dialog().getByRole("checkbox", { name: /我已重新核对/ }).check();
    const apply = dialog().getByRole("button", { name: "确认应用到当前工程", exact: true });
    assert(await apply.isEnabled()); await apply.click();
    const alert = dialog().getByRole("alert"); await alert.waitFor();
    report.conflictError = await alert.innerText(); assert(report.conflictError.includes("BINDING_CONFLICT:title_background"));
    assert.deepEqual(await snapshot(), baseline); assert.deepEqual(library(), libraryBefore);
    await host.shot("failed-apply-preserves-project-library"); await cancel();
    assert.deepEqual(await snapshot(), baseline); assert.deepEqual(library(), libraryBefore);
    report.assetProofs = [];
    for (const a of baseline.asset_manifest) {
      const expected = original.assetProofs.find(p => p.id === a.asset_id); assert(expected);
      const actual = A.sha256(await A.assetBytes(host.current.ports[0], a)); assert.equal(actual, expected.sha256);
      report.assetProofs.push({ id: a.asset_id, sha256: actual });
    }
    report.checks.push({ name: "Conflicting real application preserves both layouts, story, library and 26 actual resource bytes", status: "PASS" });
    assert.equal(report.cases.length, 8); assert(report.cases.every(c => c.status === "PASS"));
    assert.deepEqual(report.errors, []); report.libraryAfter = library(); report.status = "PASS";
  })().catch(async e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page) report.failureText = await page.locator("body").innerText().catch(String);
  }).finally(async () => {
    try {
      await host.stop("GUI negative finally; exact-owned cleanup");
      if (protectedCache) { cache("Restore"); report.nativeCacheRestoration = "PASS"; }
      assert.deepEqual(inventory(path.join(sourceRoot, "data")), protectedSource);
      report.sourceEvidenceUnchanged = true;
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  });
}
