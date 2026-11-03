"use strict";
// Continue a retained installed author run at export; never regenerate its novel.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, dismissEnvironmentCompletion, realDownload } = require("./lib/installed-acceptance.cjs");
const { listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Novel-Branch-Completion-20261103-01";
const [run, previous] = process.argv.slice(2);
for (const value of [run, previous]) assert.match(value || "", /^\d{2}$/);
assert.notEqual(run, previous);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size,
  sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
const priorFile = path.join(qa, `installed-${previous}/report.json`), prior = read(priorFile);
assert.equal(prior.scope, "ACTUAL_INSTALLED_EDITOR_AND_BUNDLED_BACKEND_CONTROLLED_MODEL");
assert.equal(prior.cleanup, "PASS");
assert.equal(prior.cases.length, 3);
assert(prior.cases.slice(0, 2).every(item => item.status === "PASS"));
assert.equal(prior.cases[2].status, "FAILED");
assert.equal(prior.model.length, 20);
assert.deepEqual(desc(prior.saved.path), prior.saved);
const out = path.resolve(qa, `installed-${run}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: prior.scope, continuation: { source: desc(priorFile), reason: "Resume export after CDP download cancellation",
    inheritedCases: 2, inheritedLocalModelRequests: 20 },
  cases: prior.cases.slice(0, 2).map(item => ({ ...item, inheritedFrom: desc(priorFile) })),
  model: prior.model, newModelRequests: 0, paidRequests: 0, screenshots: [], errors: [],
  launches: [], cleanups: [], saved: prior.saved, connected: prior.connected,
  tools: [__filename, path.join(__dirname, "lib/installed-acceptance.cjs")].map(desc),
  boundaries: ["First two author stages are referenced from a retained actual installation run",
    "Portable import uses packaged public API, not a native file picker",
    "Isolated user data; not default database migration, upgrade, normal close or Android"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const input = path.join(out, "续接已保存工程.vnproj");
fs.copyFileSync(prior.saved.path, input, fs.constants.COPYFILE_EXCL);
const host = installedReleaseSession({ installationFile: path.join(qa, "installation-01/installation.json"),
  out, input, report, save });
assert.equal(host.installation.executable.sha256, prior.owner.installation.executable.sha256);
report.owner = { installation: host.installation, native: true };
let page;
async function step(name, action) {
  const item = { name, status: "RUNNING" }; report.cases.push(item); save(); console.log("START " + name);
  try { item.detail = await action(); item.status = "PASS"; console.log("PASS " + name); }
  catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); throw error; }
  finally { save(); }
}
async function openRecent() {
  await page.locator('[data-help-key="home.recentProject"]:visible').first().click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function snapshot() {
  return host.api("/api/project/projects/" + prior.connected.project_id);
}
function sameGraph(actual) {
  // ReactFlow measurements are UI-only; every authored field and edge remains.
  const stable = p => ({
    nodes: p.nodes.map(({ measured, ...node }) => node), edges: p.edges,
  });
  assert.deepEqual(stable(actual), stable(prior.connected));
}
(async () => {
  save();
  try {
    page = await host.start();
    const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`,
      { method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await openRecent(); sameGraph(await snapshot());
    await step("public-cartridge-export-preserves-both-mainlines", async () => {
      await page.locator('[data-workspace-surface="publish"]:visible').click();
      const panel = page.locator(".cartridge-export-panel:visible");
      await panel.waitFor(); await settleEditor(page);
      await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")
        ?.innerText.includes("正在检测当前构建环境"));
      await dismissEnvironmentCompletion(page);
      await panel.locator('[data-package-stage="settings"]').click();
      await panel.locator('[data-help-key="package.mode"]').click();
      await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
      await panel.locator('[data-package-stage="checks"]').click();
      const consent = panel.getByRole("checkbox", { name: /我已检查全部警告/ });
      if (await consent.count()) await consent.check();
      const file = await realDownload(page, host.cdp, out, panel.locator(".package-primary-action"));
      const zip = await JSZip.loadAsync(fs.readFileSync(file.path), { checkCRC32: true });
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
      const choices = script.scenes.filter(scene => scene.commands.some(command => command.type === "choice"));
      assert.equal(choices.length, 2);
      for (const scene of choices) for (const choice of scene.commands[0].choices)
        assert(script.scenes.some(target => target.scene_id === choice.target_scene_id));
      const last = script.scenes.find(scene => scene.scene_id === "qa_multi_scene_2");
      assert(!last.is_ending && last.next_scene_id);
      const target = script.scenes.find(scene => scene.scene_id === last.next_scene_id)
        .commands[0].choices.find(choice => choice.choice_id === "mainline").target_scene_id;
      assert(script.scenes.find(scene => scene.scene_id === target)?.is_ending);
      report.exported = { file, script };
      return { cartridge: file, choices: choices.length, terminalTarget: target };
    });
    await host.stop("attributed installed host/backend restart; not normal native close");
    page = await host.start();
    await step("actual-installed-host-backend-restart-preserves-graph-and-task", async () => {
      await openRecent(); sameGraph(await snapshot());
      await page.locator('[data-help-key="toolbar.novelImport"]:visible').click();
      await page.getByTestId("novel-import-workbench").locator(".novel-import-report-panel").waitFor();
      assert.equal(report.blockedModelRequests || 0, 0);
      await host.shot("installed-novel-restored");
      return { actualProcessRestart: true, unchangedGraph: true, newModelCalls: 0 };
    });
    assert.deepEqual(report.errors, []); report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    if (page && !page.isClosed()) report.failureText = (await page.locator("body").innerText().catch(String)).slice(-12000);
  } finally {
    try {
      await host.rawApi("/api/project/state", { provider_secrets: {} });
      assert.deepEqual(await host.api("/api/providers/secrets"), {});
      report.testCredentialCleanup = "PASS_EMPTY_SYNTHETIC_SECRET_CHANNEL";
    } catch (error) { report.cleanupError = String(error); }
    await host.stop("final exact installed-session cleanup");
    report.remainingPorts = listeners(report.launches.flatMap(launch => launch.ports));
    report.cleanup = report.remainingPorts.length === 0 && !report.cleanupError ? "PASS" : "FAILED";
    if (report.cleanup !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanup: report.cleanup }));
  }
})();
