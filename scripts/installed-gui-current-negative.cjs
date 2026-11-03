"use strict";
// Actual installed GUI scanner/error transaction checks on the authoring
// session's isolated profile. Does not claim native directory-picker coverage.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedFeatureSession } = require("./lib/installed-candidate-feature-session.cjs");
const { settleEditor, select } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), qa = path.resolve(process.env.AGENTVN_INSTALLED_GUI_QA_ROOT
  || "F:/AgentVN/QA/Installed-GUI-20261021-01");
const sourceAttempt = process.argv[2] || "03", attempt = process.argv[3] || "04";
assert.match(sourceAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const prep = read(path.join(qa, "preparation.json")), sourceFile = path.join(qa, `editor-${sourceAttempt}/report.json`);
const source = read(sourceFile); assert.equal(source.status, "EDITOR_PASS_PLAYER_NOT_RUN");
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(sourceFile),
  cases: [], checks: [], launches: [], cleanups: [], errors: [], screenshots: [], modelRequests: 0,
  scope: "ACTUAL_INSTALLED_GUI_EIGHT_NEGATIVE_ZIPS_AND_FAILED_APPLY_PROJECT_LIBRARY_ATOMICITY",
  nativePicker: "NOT_RUN", normalClose: "NOT_RUN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedFeatureSession({ out, report, save, profileRoot: path.dirname(sourceFile), testProject: prep.input.path });
report.installation = host.installation;
assert.equal(host.installation.executable.sha256, source.installation.executable.sha256);
const libraryDirectory = path.join(path.dirname(sourceFile), "data/gui-pack-library");
function librarySnapshot() {
  const files = [];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      assert(!entry.isSymbolicLink(), "QA library must not traverse a link");
      if (entry.isDirectory()) visit(file);
      else { assert(entry.isFile()); files.push({ relative: path.relative(libraryDirectory, file), sha256: sha(file) }); }
    }
  }
  visit(libraryDirectory);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}
const content = ({ updated_at, ...p }) => p;
const prefix = "官方模板 中文/game/";
let page, cacheProtected = false;
async function scan(file) {
  await page.getByTestId("renpy-gui-import-open").click();
  const d = page.getByTestId("renpy-gui-import-dialog"); await d.waitFor();
  await d.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles(file);
  await d.locator(".renpy-gui-import-summary").waitFor(); return d;
}
async function cancel(d) {
  await d.getByRole("button", { name: "取消，不修改工程", exact: true }).click(); await d.waitFor({ state: "detached" });
}
async function immutable() { for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256, f.path); }
(async () => {
  await immutable(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
  const cache = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "Prepare", "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(cache.status, 0, cache.stdout + cache.stderr); cacheProtected = true;
  page = await host.start(); await settleEditor(page);
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: "安装版完整官方GUI临时工程" }).click();
  await settleEditor(page); await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  const stored = () => host.api(`/api/project/projects/${prep.projectId}`);
  const baseline = await stored(); assert.equal(baseline.asset_manifest.length, source.assetProofs.length);
  assert.deepEqual(baseline.editor_settings.runtimeUILayoutProfiles, source.finalProject.editor_settings.runtimeUILayoutProfiles);
  const libraryBaseline = librarySnapshot(); assert(libraryBaseline.length >= 2);
  report.libraryBaseline = libraryBaseline;
  const unchanged = async () => {
    assert.deepEqual(content(await stored()), content(baseline));
    assert.deepEqual(librarySnapshot(), libraryBaseline);
  };
  const original = fs.readFileSync(prep.officialArchive.path); assert.equal(hash(original), prep.officialArchive.sha256);
  const attacks = [
    ["traversal", "unsafe_path", z => z.file("../escape.txt", "unsafe", { createFolders: false })],
    ["case-duplicate", "unsafe_path", z => z.file(prefix + "gui/Main_Menu.png", "duplicate", { createFolders: false })],
    ["symlink", "symbolic_link", z => z.file(prefix + "gui/link.png", "../outside", { unixPermissions: 0o120777, createFolders: false }), "UNIX"],
    ["compression-limit", "archive_limit", z => z.file(prefix + "bomb.bin", Buffer.alloc(1024 * 1024), { createFolders: false })],
    ["missing-gui", "missing_gui", z => z.remove(prefix + "gui.rpy")],
    ["ambiguous-gui", "ambiguous_gui", z => z.file("another/gui.rpy", "define gui.navigation_xpos = 0", { createFolders: false })],
    ["unsupported-expression", "unsupported_expression", async z => z.file(prefix + "gui.rpy",
      await z.file(prefix + "gui.rpy").async("string") + '\ndefine gui.navigation_xpos = __import__("builtins").len("x")\n')],
    ["damaged-image", "invalid_asset", z => z.file(prefix + "gui/main_menu.png", "not a valid PNG", { createFolders: false })],
  ];
  for (const [name, issue, mutate, platform] of attacks) {
    const z = await JSZip.loadAsync(original, { checkCRC32: true }); await mutate(z);
    const bytes = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: platform || "DOS" });
    const file = path.join(out, `${name}.zip`); fs.writeFileSync(file, bytes, { flag: "wx" });
    const row = { name, expectedIssue: issue, artifact: desc(file), status: "RUNNING" }; report.cases.push(row); save();
    const d = await scan(file); row.issues = await d.locator('[aria-label="扫描问题"]').innerText();
    assert(row.issues.includes(issue), `${name}: expected ${issue}, got ${row.issues}`);
    const blocked = !["unsupported-expression", "damaged-image"].includes(name);
    const license = d.locator(".renpy-gui-import-license input");
    if (await license.count()) await license.check();
    const commit = d.getByRole("button", { name: "确认入库，不修改工程", exact: true });
    assert.equal(await commit.isDisabled(), blocked, "Blocking must reflect scan validation, not missing license");
    if (name === "unsupported-expression")
      assert((await d.locator(".renpy-gui-import-row").filter({ hasText: "shared.x" }).innerText()).includes("40"));
    if (name === "damaged-image") assert.equal(await d.locator(".renpy-gui-import-asset-row").count(), 24);
    await unchanged();
    await host.shot(`negative-${name}`); await cancel(d); await unchanged();
    row.wholeArchiveBlocked = blocked; row.projectUnchanged = true; row.libraryUnchanged = true;
    row.status = "PASS"; save(); console.log(`PASS GUI installed negative ${name}`);
  }
  // Use a previously committed pack: a failed application must preserve both
  // project state and the independent library, without adding a test pack.
  await page.getByTestId("renpy-gui-import-open").click();
  const d = page.getByTestId("renpy-gui-import-dialog"); await d.waitFor();
  const originalPack = d.locator("article[data-pack-id]").filter({ hasText: /25 个素材/ });
  assert.equal(await originalPack.count(), 1);
  await originalPack.getByRole("button", { name: "预览并选择应用", exact: true }).click();
  await d.locator(".renpy-gui-import-summary").waitFor();
  await select(page, prefix + "gui/main_menu.png 游戏界面用途", "标题页主视觉");
  await select(page, prefix + "gui/game_menu.png 游戏界面用途", "标题页主视觉");
  await d.locator(".renpy-gui-import-license input").check();
  const apply = d.getByRole("button", { name: "确认应用到当前工程", exact: true }); assert(await apply.isEnabled());
  await apply.click(); const alert = d.getByRole("alert"); await alert.waitFor();
  report.conflictError = await alert.innerText(); assert(report.conflictError.includes("BINDING_CONFLICT:title_background"));
  await unchanged();
  await host.shot("failed-apply-conflict"); await cancel(d);
  await unchanged();
  // Re-read real packaged-backend asset bytes, not just metadata after rollback.
  const proofs = [];
  for (const a of baseline.asset_manifest) {
    const p = a.metadata.backend_asset_path; assert(p && !p.split(/[\\/]/).includes(".."));
    const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/assets/${p.split("/").map(encodeURIComponent).join("/")}`);
    assert(response.ok); const bytes = Buffer.from(await response.arrayBuffer());
    const expected = source.assetProofs.find(p => p.id === a.asset_id); assert(expected);
    assert.equal(hash(bytes), expected.sha256); proofs.push({ id: a.asset_id, sha256: expected.sha256 });
  }
  report.assetProofs = proofs;
  report.checks.push({ name: "Eight scanner errors and failed apply preserve authoring state, library files and real asset bytes",
    status: "PASS", assetCount: proofs.length, libraryFiles: libraryBaseline.length });
  assert.equal(report.cases.length, 8); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) report.failureDOM = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try {
    await host.stop("End GUI negative checks; exact-owned termination"); await immutable();
    if (cacheProtected) {
      const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "Restore", "-RunDirectory", out],
      { encoding: "utf8", windowsHide: true, timeout: 30000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      report.nativeCacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
    }
    report.immutableStatus = "PASS";
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
