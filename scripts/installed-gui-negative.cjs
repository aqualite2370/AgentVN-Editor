"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { assetBytes, settleEditor, select } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-gui-session-20261018-01", out = process.argv[2];
assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const fixture = read(path.join(run, "fixtures.json")), launch = read(path.join(run, "launch.json"));
const prefix = "官方模板 中文/game/";
const report = { status: "RUNNING", at: new Date().toISOString(), cases: [], checks: [], screenshots: [], errors: [],
  error: null, realModelRequests: 0, productChanges: 0,
  scope: "INDEPENDENT_INSTALLED_GUI_REJECTION_ATOMICITY_AFTER_RECORDED_DEFAULT_IMPORT_FAILURE_NOT_G14_PASS" };
let browser, page, dialog, cdp;
async function snapshot() {
  const s = await page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), g = window.__AGENTVN_EDITOR_STORE__.getState();
    return { projectId: p.projectId, settings: p.settings, assets: p.assetManifest, nodes: g.nodes, edges: g.edges };
  });
  const proofs = [];
  for (const a of s.assets) proofs.push({ id: a.asset_id, sha256: sha(await assetBytes(8278, a)) });
  return { projectId: s.projectId, settings: s.settings, nodes: s.nodes, edges: s.edges, assets: proofs };
}
async function scan(file) {
  await page.getByTestId("renpy-gui-import-open").click(); await dialog.waitFor();
  await dialog.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles(file);
  await dialog.locator(".renpy-gui-import-summary").waitFor();
}
async function cancel() {
  await dialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
}
(async () => {
  assert.equal(process.env.AGENTVN_TEST_PROJECT, fixture.input);
  assert.equal(process.env.AGENTVN_WORKSPACE_OUTPUT, run);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(30000); page.on("pageerror", e => report.errors.push(String(e)));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" }); await settleEditor(page);
  dialog = page.getByTestId("renpy-gui-import-dialog");
  const before = await snapshot(); assert.equal(before.projectId, fixture.projectId);
  const original = fs.readFileSync(fixture.officialArchive.path);
  const inputs = path.join(path.dirname(fixture.input), "GUI 安全异常"); fs.mkdirSync(inputs);
  const attacks = [
    ["traversal", "unsafe_path", z => z.file("../escape.txt", "unsafe", { createFolders: false })],
    ["case-duplicate", "unsafe_path", z => z.file(prefix + "gui/Main_Menu.png", "duplicate", { createFolders: false })],
    ["symlink", "symbolic_link", z => z.file(prefix + "gui/link.png", "../outside", { unixPermissions: 0o120777, createFolders: false }), "UNIX"],
    ["compression-limit", "archive_limit", z => z.file(prefix + "bomb.bin", Buffer.alloc(1024 * 1024), { createFolders: false })],
    ["missing-gui", "missing_gui", z => z.remove(prefix + "gui.rpy")],
    ["ambiguous-gui", "ambiguous_gui", z => z.file("another/gui.rpy", "define gui.navigation_xpos = 0", { createFolders: false })],
    ["unsupported-expression", "unsupported_expression", async z => z.file(prefix + "gui.rpy",
      await z.file(prefix + "gui.rpy").async("string") + '\ndefine gui.navigation_xpos = __import__("os").system("not-executed")\n')],
    ["damaged-image", "invalid_asset", z => z.file(prefix + "gui/main_menu.png", "not a valid PNG", { createFolders: false })],
  ];
  for (const [name, issue, mutate, platform] of attacks) {
    const z = await JSZip.loadAsync(original); await mutate(z);
    const bytes = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: platform || "DOS" });
    const file = path.join(inputs, `${name}.zip`); fs.writeFileSync(file, bytes, { flag: "wx" });
    await scan(file);
    const issues = await dialog.locator('[aria-label="扫描问题"]').innerText();
    assert(issues.includes(issue), `${name}: expected ${issue}`);
    const blocked = !["unsupported-expression", "damaged-image"].includes(name);
    if (blocked) assert(await dialog.getByRole("button", { name: "确认应用已选项目", exact: true }).isDisabled());
    if (name === "unsupported-expression") {
      const row = dialog.locator(".renpy-gui-import-row").filter({ hasText: "shared.x" });
      assert((await row.innerText()).includes("40"), "Unsupported expression must not execute or overwrite accepted static value");
    }
    if (name === "damaged-image") assert.equal(await dialog.locator(".renpy-gui-import-asset-row").count(), 24);
    assert.deepEqual(await snapshot(), before);
    await cancel(); assert.deepEqual(await snapshot(), before);
    report.cases.push({ name, status: "PASS", path: file, sha256: sha(bytes), expectedIssue: issue, wholeArchiveBlocked: blocked });
  }
  report.checks.push({ name: "Eight real installed scan rejection/reporting cases preserve all 25 original asset bytes, story and profiles", status: "PASS" });
  await scan(fixture.officialArchive.path);
  const binding = relative => `${prefix}${relative} 游戏界面用途`;
  await select(page, binding("gui/main_menu.png"), "标题页主视觉");
  await select(page, binding("gui/game_menu.png"), "标题页主视觉");
  const apply = dialog.getByRole("button", { name: "确认应用已选项目", exact: true });
  assert(await apply.isEnabled()); await apply.click();
  const alert = dialog.getByRole("alert"); await alert.waitFor();
  report.conflictError = await alert.innerText();
  assert(report.conflictError.includes("BINDING_CONFLICT:title_background"));
  assert.deepEqual(await snapshot(), before);
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, "atomic-binding-conflict.png"),
    { width: 1920, height: 1080, dpr: 1, reduced: false }));
  await cancel(); assert.deepEqual(await snapshot(), before);
  report.checks.push({ name: "Actual apply conflict fails transactionally without changing layout, resources or other type", status: "PASS" });
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.failureText = await page.locator("body").innerText().catch(() => ""); }
}).finally(async () => {
  await browser?.close().catch(() => {}); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, checks: report.checks.length, error: report.error, out }, null, 2));
});
