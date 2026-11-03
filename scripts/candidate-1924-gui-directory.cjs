"use strict";
// Real native folder picker, cancellation and directory scanning. No picker
// injection; Computer Use must submit a matching receipt after actual input.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), crypto = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const {validateCandidateConfig}=require("./candidate-layout-consumption.cjs");
const {deriveActual}=require("./installed-profile-data-replay.cjs");
const configArgs=process.argv.filter(a=>a.startsWith("--candidate-config="));assert(configArgs.length<=1);
const config=configArgs.length?validateCandidateConfig(JSON.parse(fs.readFileSync(configArgs[0].slice(19),"utf8"))):null;
const current1930=process.argv.includes("--candidate=1.9.30");
assert(!config||!current1930);
const version=config?.version??(current1930?"1.9.30":"1.9.24");
const attempt=config?process.argv[2]:current1930?"65":"58";assert.match(attempt??"",/^\d{2}$/);
const root = path.resolve(__dirname, ".."), out = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-"+attempt;
assert.deepEqual(process.argv.slice(2),config?[attempt,configArgs[0]]:current1930?[attempt,"--candidate=1.9.30"]:[attempt]);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const prep = read("F:/AgentVN/QA/Installed-GUI-20261021-01/preparation.json");
assert.equal(sha(prep.officialArchive.path), prep.officialArchive.sha256);
assert.equal(prep.officialArchive.sha256, "d8d227d86b8e4509bddd85fe8cb22fa4e5c8b31b5370dda68faa8b7c4bc3c582");
const project = read(prep.input.path); project.project_id = config?`installed-native-gui-${version}-${attempt}`:current1930?"installed-native-gui-1930-65":"installed-native-gui-1924-58";
project.title = "原生中文GUI目录独立验收"; project.nodes[0].data.openingAudio = [];
const input = path.join(out, "原生目录隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const directory = path.join(out, "完整官方 GUI 中文目录");
const installationFile = config?path.join(out,"derived-installed.json"):current1930
  ?"F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json"
  :"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
if(config)fs.writeFileSync(installationFile,JSON.stringify(deriveActual(config.actual,version),null,2),{flag:"wx"});
const report = { version, status: "RUNNING", startedAt: new Date().toISOString(), cases: [], launches: [], cleanups: [],
  knownProcesses: [], screenshots: [], errors: [], modelRequests: 0, productChanges: 0, builds: 0,
  scope: `INSTALLED_${version}_REAL_NATIVE_GUI_DIRECTORY_CANCEL_SCAN_PREVIEW_CANCEL_NOT_APPLICATION_OR_ALL_LINK_ATTACKS`,
  input: desc(input), officialArchive: prep.officialArchive, installation: desc(installationFile),
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile, out, input, report, save });
assert.equal(host.installation.executable.sha256,config?deriveActual(config.actual,version).executable.sha256:current1930
  ?"a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577"
  :"ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");
let page, protectedCache = false;
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/installed-layout-cache-session.ps1", "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { cwd: root, windowsHide: true, encoding: "utf8", timeout: 30000 });
  (report.cache ??= []).push({ action, code: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
const stagingRoots = [
  "C:/Users/1/AppData/Local/com.agentvn.editor/renpy-gui-import",
  "C:/Users/1/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/com.agentvn.editor/renpy-gui-import",
];
function staging() {
  return stagingRoots.flatMap(dir => fs.existsSync(dir) ? fs.readdirSync(dir).map(name => desc(path.join(dir, name))) : []);
}
async function step(name, fn) {
  const c = { name, status: "RUNNING" }; report.cases.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; console.log("PASS " + name); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { c.finishedAt = new Date().toISOString(); save(); }
}
const dialog = () => page.getByTestId("renpy-gui-import-dialog");
async function picker(kind) {
  const request = { id: crypto.randomUUID(), ownerPid: host.current.pid, kind,
    createdAt:new Date().toISOString(),
    selectedPath: kind === "SELECT" ? directory : null,
    completion: path.join(out, `native-picker-${kind.toLowerCase()}-completed.json`) };
  fs.writeFileSync(path.join(out, `native-picker-${kind.toLowerCase()}-request.json`),
    JSON.stringify(request, null, 2), { flag: "wx" });
  report.requests ??= []; report.requests.push(request); save();
  await dialog().getByRole("button", { name: "选择资源目录", exact: true }).click();
  console.log(JSON.stringify({ stage: "GUI_NATIVE_PICKER", request }));
  await until(() => fs.existsSync(request.completion), `Computer Use GUI directory ${kind}`, 600000);
  const completed = read(request.completion);
  assert.equal(completed.requestId, request.id); assert.equal(completed.ownerPid, request.ownerPid);
  assert.equal(completed.kind, kind); assert.equal(completed.selectedPath, request.selectedPath);
  assert.equal(completed.interaction, "COMPUTER_USE_SKY_NATIVE_DIALOG");
  return completed;
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const zip = await JSZip.loadAsync(fs.readFileSync(prep.officialArchive.path), { checkCRC32: true });
  fs.mkdirSync(directory); report.directoryFiles = [];
  for (const f of prep.officialFiles) {
    assert(!f.relative.split(/[\\/]/).some(p => p === ".." || p === ".")); assert(!path.isAbsolute(f.relative));
    const output = path.resolve(directory, f.relative); assert(output.startsWith(directory + path.sep));
    const bytes = await zip.file("官方模板 中文/game/" + f.relative).async("nodebuffer"); assert.equal(hash(bytes), f.sha256);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, bytes, { flag: "wx" });
    report.directoryFiles.push(desc(output));
  }
  assert.equal(report.directoryFiles.length, 30); report.stagingBefore = staging(); save();
  cache("SelfTest"); cache("Prepare"); protectedCache = true; page = await host.start();
  const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input) });
  assert(response.ok && (await response.json()).ok); await page.reload();
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }).click();
  await A.settleEditor(page); await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
  await page.locator('[data-layout-type-option="renpy"]:visible').click(); await A.settleEditor(page);
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  const initial = await A.projectSnapshot(host.current.ports[0]);
  const authored = s => ({ settings: s.settings, assets: s.assetManifest });
  await page.getByTestId("renpy-gui-import-open").click(); await dialog().waitFor();
  await step("Cancel actual native folder picker preserves project and empty library", async () => {
    const receipt = await picker("CANCEL");
    await until(() => dialog().getByRole("button", { name: "选择资源目录", exact: true }).isEnabled(), "native cancellation returned");
    assert.equal(await dialog().locator(".renpy-gui-import-summary").count(), 0);
    assert.equal(await dialog().locator("article[data-pack-id]").count(), 0);
    assert.deepEqual(authored(await A.projectSnapshot(host.current.ports[0])), authored(initial));
    assert.deepEqual(staging(), report.stagingBefore);
    return receipt;
  });
  await step("Native Chinese directory scans full template and actual thumbnail bytes then cancels cleanly", async () => {
    const receipt = await picker("SELECT");
    await dialog().locator(".renpy-gui-import-summary").waitFor({ timeout: 60000 });
    await until(async () => await dialog().locator(".renpy-gui-import-asset-row").count() === 25, "all native directory resources");
    const images = [];
    for (const row of await dialog().locator(".renpy-gui-import-asset-row").all()) {
      const name = await row.locator("strong").innerText();
      const image = row.locator("img");
      if (!(await image.count())) { assert(name.endsWith(".ttf")); continue; }
      const actual = await image.evaluate(async n => {
        await n.decode(); const b = await (await fetch(n.currentSrc)).arrayBuffer();
        return { width: n.naturalWidth, height: n.naturalHeight,
          sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b))).map(v => v.toString(16).padStart(2, "0")).join("") };
      });
      const expected = prep.officialFiles.find(f => f.relative === name); assert(expected, name);
      assert.equal(actual.sha256, expected.sha256); assert(actual.width > 0 && actual.height > 0);
      images.push({ name, ...actual });
    }
    assert.equal(images.length, 24);
    assert.equal(await dialog().locator("article[data-pack-id]").count(), 0);
    assert.deepEqual(authored(await A.projectSnapshot(host.current.ports[0])), authored(initial));
    await until(async () => await dialog().getByRole("button", { name: "确认入库，不修改工程", exact: true }).isVisible(), "directory scan UI ready");
    await host.shot("native-chinese-directory-scanned");
    await dialog().getByRole("button", { name: "取消，不修改工程", exact: true }).click();
    await dialog().waitFor({ state: "detached" });
    assert.deepEqual(authored(await A.projectSnapshot(host.current.ports[0])), authored(initial));
    report.stagingAfter = staging(); assert.deepEqual(report.stagingAfter, report.stagingBefore);
    for (const f of report.directoryFiles) assert.equal(sha(f.path), f.sha256);
    return { receipt, decodedThumbnailImages: images, resources: 25, stagedZipRemovedByProduct: true,
      projectAndLibraryUnchanged: true };
  });
  assert.equal(report.cases.length, 2); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.failureText = await page.locator("body").innerText().catch(String);
    await host.shot("failure").catch(error => { report.captureError = String(error); }); }
}).finally(async () => {
  try { await host.stop("native directory finally; exact-owned termination");
    if (protectedCache) { cache("Restore"); report.nativeCacheRestoration = "PASS"; } }
  catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
