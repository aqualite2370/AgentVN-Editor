"use strict";
// Existing draft + real author edit. No new generation or frontend store writes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until, rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Assistant-Queue-1.9.35-20261102-01";
const sourceDir = path.join(qa, "session-06"), out = path.join(qa, "session-07");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const sourceFile = path.join(sourceDir, "report.json"), prior = read(sourceFile);
assert.equal(prior.status, "FAILED"); assert(prior.cleanups.every(c => c.status === "PASS"));
assert(prior.authored && prior.cases.slice(0, 2).every(c => c.status === "PASS"));
assert(prior.failureText.includes("QUEUE_D 验证运行任务取消"));
assert.equal(read(prior.cacheRestoration.path).status, "PASS");
const prep = read(path.join(qa, "preparation.json")), [project, other] = prep.projects;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), source: desc(sourceFile),
  scope: "ACTUAL_INSTALLED_EXISTING_DRAFT_REAL_AUTHOR_EDIT_AND_RESTART_CONFLICT_NO_MODEL",
  products: prep.products, tools: [__filename, "scripts/lib/installed-release-session.cjs",
    "editor/src/assistant/assistantCreationProjectMerge.ts"].map(desc),
  cases: [], matrix: [], screenshots: [], launches: [], cleanups: [], errors: [],
  modelRequests: 0, blockedModelRequests: 0, productChanges: 0, builds: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, prepared = false, baseline, otherBefore, authored;
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.resolve("scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", path.resolve(out),
    "-AllowedRunRoot", path.resolve(qa), "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr });
  save(); assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function stage(name, fn) {
  const c = { name, status: "RUNNING" }; report.cases.push(c); save(); console.log("START " + name);
  try { c.detail = await fn(); c.status = "PASS"; console.log("PASS " + name); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { save(); }
}
const stored = p => host.api("/api/project/projects/" + p.project_id);
async function openProject() {
  await page.locator('[data-help-key="home.recentProject"]:not(:disabled):visible').filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function assistant() {
  await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
  const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel"); await panel.waitFor();
  await panel.getByRole("button", { name: "创造模式", exact: true }).click();
  await panel.locator('textarea[aria-label="向大模型助手提问"]:not(:disabled)').waitFor();
  const history = panel.locator(".assistant-history-popover");
  if (!await history.evaluate(n => n.open)) await history.locator("summary").click();
  await history.locator(".assistant-history-select").filter({ hasText: /^QUEUE_A/ }).click();
  return panel;
}
function noGraphMutation(actual, expected) {
  const authoredNodes = nodes => nodes.map(({ measured, ...n }) => n);
  assert.deepEqual(authoredNodes(actual.nodes), authoredNodes(expected.nodes));
  assert.deepEqual(actual.edges, expected.edges); assert.deepEqual(actual.asset_manifest, expected.asset_manifest);
}
(async () => {
  assert(!rows().some(p => /^(agentvn-editor|creator-backend|agentvn-player)\.exe$/i.test(p.Name)));
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL); save();
  for (const leaf of ["data", "webview"]) {
    assert(fs.statSync(path.join(sourceDir, leaf)).isDirectory());
    fs.cpSync(path.join(sourceDir, leaf), path.join(out, leaf), { recursive: true, errorOnExist: true, force: false });
  }
  cache("SelfTest"); prepared = true; cache("Prepare");
  host = installedReleaseSession({ installationFile: receipt, out, input: prep.inputs[0].path, report, save });
  page = await host.start(); await openProject();
  baseline = prior.baseline; otherBefore = prior.otherBefore; authored = prior.authored;
  assert.deepEqual((await stored(project)).editor_settings.runtimeUILayoutProfiles, authored.editor_settings.runtimeUILayoutProfiles);
  report.baseline = baseline; report.otherBefore = otherBefore; save();
  report.authored = authored;
  report.completedCoverage = { source: report.source, cases: prior.cases.slice(0, 2),
    reason: "Completed review and actual author edit are retained; reselect the older conversation on remount" };
  if (!prior.authored) {
  await stage("existing-completed-draft-remains-reviewable-before-real-author-edit", async () => {
    const panel = await assistant();
    await panel.locator(".assistant-history-popover summary").click();
    await panel.locator(".assistant-history-select").filter({ hasText: /^QUEUE_A/ }).click();
    const draft = panel.getByTestId("assistant-creation-draft");
    await draft.getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor();
    await draft.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
    assert(await draft.getByTestId("assistant-creation-merge-button").isEnabled());
    assert(!JSON.stringify(baseline.editor_settings).includes("QUEUE_A组件"));
    await host.shot("existing-draft-before-author-edit");
    return { draft: "QUEUE_A组件", target: "game_menu", mergeEnabledBeforeEdit: true, noMergeSubmitted: true };
  });
  await stage("real-layout-author-edit-and-native-persistence-change-draft-baseline", async () => {
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    await page.getByTestId("renpy-player-layout-entry").click();
    await page.locator(".runtime-layout-screen-list").getByRole("button", { name: "游戏菜单", exact: true }).click();
    const count = baseline.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length;
    await page.getByRole("button", { name: "添加遮罩", exact: true }).click();
    await page.locator('[data-help-key="layout.save"]:visible').click();
    authored = await until(async () => {
      const current = await stored(project);
      return current.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length === count + 1 && current;
    }, "actual author mask save");
    noGraphMutation(authored, baseline);
    assert.deepEqual(authored.editor_settings.runtimeUILayoutProfiles.profiles.agentvn,
      baseline.editor_settings.runtimeUILayoutProfiles.profiles.agentvn);
    report.authored = authored;
    await host.shot("actual-author-mask-saved");
    return { beforeComponents: count, afterComponents: count + 1, authorAction: "Add mask + Save layout", publicApiMutation: false };
  });
  }
  await stage("changed-author-baseline-disables-old-draft-in-all-twelve-display-combinations", async () => {
    const panel = await assistant(), draft = panel.getByTestId("assistant-creation-draft");
    await draft.getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor();
    await draft.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
    const readiness = draft.getByTestId("assistant-creation-merge-readiness");
    await readiness.filter({ hasText: /发生了变化/ }).waitFor();
    const merge = draft.getByTestId("assistant-creation-merge-button");
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const m = { width, height: width * 9 / 16, dpr, reduced };
      const viewport = await host.metrics(m);
      await readiness.scrollIntoViewIfNeeded(); assert(await readiness.isVisible()); assert(!await merge.isEnabled());
      const geometry = await readiness.evaluate(n => {
        const r = n.getBoundingClientRect();
        return { rect: r.toJSON(), width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(geometry.rect.left >= 0 && geometry.rect.top >= 0 && geometry.rect.right <= width + 1
        && geometry.rect.bottom <= m.height + 1 && geometry.overflow <= 1);
      report.matrix.push({ ...m, viewport, geometry, mergeDisabled: true, message: await readiness.innerText(), status: "PASS" });
      save();
    }
    assert.deepEqual((await stored(project)).editor_settings.runtimeUILayoutProfiles, authored.editor_settings.runtimeUILayoutProfiles);
    const currentOther = await stored(other); noGraphMutation(currentOther, otherBefore);
    assert.deepEqual(currentOther.editor_settings, otherBefore.editor_settings);
    await host.shot("old-draft-merge-rejected-after-author-edit");
    return { combinations: report.matrix.length, authorEditIntact: true, otherProjectUnchanged: true };
  });
  await stage("actual-restart-preserves-conflict-and-author-edit-without-generation", async () => {
    const previousPid = host.current.pid; await host.stop("Owned QA restart, not normal window-close evidence");
    page = await host.start(); await openProject();
    assert.notEqual(host.current.pid, previousPid);
    const panel = await assistant(), draft = panel.getByTestId("assistant-creation-draft");
    await draft.getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor();
    await draft.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
    await draft.getByTestId("assistant-creation-merge-readiness").filter({ hasText: /发生了变化/ }).waitFor();
    assert(!await draft.getByTestId("assistant-creation-merge-button").isEnabled());
    const after = await stored(project); noGraphMutation(after, baseline);
    assert.deepEqual(after.editor_settings.runtimeUILayoutProfiles, authored.editor_settings.runtimeUILayoutProfiles);
    assert(!JSON.stringify(after.editor_settings).includes("QUEUE_A组件"));
    await host.shot("merge-conflict-after-real-restart");
    return { previousPid, currentPid: host.current.pid, noOverwrite: true, noRegeneration: true };
  });
  assert.equal(report.cases.length, 2); assert.equal(report.matrix.length, 12);
  assert.equal(report.blockedModelRequests, 0); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureText = await page.locator("body").innerText().catch(String);
    await host.shot("failure").catch(() => {});
  }
}).finally(async () => {
  try {
    await host?.stop("End owned native merge-conflict acceptance");
    if (prepared && fs.existsSync(path.join(out, "native-cache-protection.json"))) {
      cache("Restore"); report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
      assert.equal(read(report.cacheRestoration.path).status, "PASS");
    }
    for (const f of [...report.products, ...report.tools, report.source]) assert.equal(sha(f.path), f.sha256);
    const ports = report.launches.flatMap(l => l.ports); if (ports.length) assert.equal(listeners(ports).length, 0);
    report.ownedCleanup = { status: "PASS", ports, userFilesDeleted: 0 };
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error, cleanupError: report.cleanupError }));
});
