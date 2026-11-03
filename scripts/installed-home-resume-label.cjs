"use strict";
// Diagnostic only: clone the completed QA upgrade profiles, never user profiles.
// Explicit old diagnostic or repaired candidate; no installer, source server or model.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, "..");
const repaired = process.argv[3] === "--repaired";
assert(process.argv[3] === undefined || repaired, "Only explicit --repaired target is supported");
const qa = repaired ? "F:/AgentVN/QA/Home-Resume-Release-20261021-01"
  : "F:/AgentVN/QA/Home-Resume-Label-20261021-01";
const source = "F:/AgentVN/QA/Current-NSIS-Upgrade-20261021-01";
const installationFile = repaired ? path.join(qa, "installation.json")
  : "F:/AgentVN/QA/Component-Preview-Release-20261021-02/installation.json";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function inventory(directory) {
  const files = [];
  function visit(current) {
    assert(!fs.lstatSync(current).isSymbolicLink(), "Do not follow profile links");
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      assert(!fs.lstatSync(file).isSymbolicLink(), "Do not follow profile links");
      if (entry.isDirectory()) visit(file);
      else {
        assert(entry.isFile());
        files.push({ relative: path.relative(directory, file), bytes: fs.statSync(file).size, sha256: sha(file) });
      }
    }
  }
  visit(directory); return files.sort((a, b) => a.relative.localeCompare(b.relative, "en"));
}
function cardMatches(observation, expected) {
  assert.equal(observation.hydrating, false, "Hydration must finish before assertion");
  assert.equal(observation.presentationReady, true, "Startup mask and container must finish before assertion");
  assert.equal(observation.heading, "继续上次编辑");
  assert.equal(observation.cardTitle, expected.title, "Resume card must name the actual current project");
  assert(observation.recent.some(r => r.text.includes(expected.title)), "Recent project must also show the title");
  assert(observation.hit && !observation.disabled, "Real resume action must be clickable");
}
if (process.argv[2] === "--self-test") {
  const observation = { hydrating: false, heading: "继续上次编辑", cardTitle: "测试名称",
    recent: [{ text: "测试名称" }], hit: true, disabled: false, presentationReady: true };
  cardMatches(observation, { title: "测试名称" });
  for (const patch of [{ cardTitle: "未命名视觉小说" }, { hydrating: true }, { recent: [] },
    { hit: false }, { disabled: true }, { heading: "正在恢复项目" }, { presentationReady: false }])
    assert.throws(() => cardMatches({ ...observation, ...patch }, { title: "测试名称" }));
  console.log("PASS: exact-card oracle and seven incomplete/wrong-label evidence rejections; no launch");
  process.exit(0);
}
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out), "Fresh evidence required");
fs.mkdirSync(out, { recursive: true });
const baseline = read(path.join(source, "old-ui-data-created.json")).project;
const report = { status: "RUNNING", scope: "REAL_INSTALLED_HOME_RESUME_LABEL_DIAGNOSTIC",
  startedAt: new Date().toISOString(), version: repaired ? "1.9.17" : "1.9.16", launches: [], cleanups: [],
  screenshots: [], errors: [], modelRequests: 0, observations: [], checks: [],
  expected: { id: baseline.metadata.projectId, title: baseline.metadata.title, author: baseline.metadata.author },
  productChanges: 0, builds: 0, installations: 0,
  limits: ["Copied QA upgrade profiles, not a new upgrade test", "1080p DPR1 ordinary viewport simulation",
    "No native chooser or normal-window-close proof", "Normal QA persistence may update the copied profiles"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, cachePrepared = false, page;
const sources = [path.join(source, "profile-roaming"), path.join(source, "profile-local")];
const protectedPaths = ["AgentVN Dev.exe", ".git/index"].map(p => path.join(root, p));
const originalDatabase = "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db";
if (fs.existsSync(originalDatabase)) protectedPaths.push(originalDatabase);
report.protectedFiles = protectedPaths.map(p => ({ path: p, sha256: sha(p) }));
report.installation = { path: installationFile, sha256: sha(installationFile) };
report.executedTools = [__filename, path.join(root, "scripts/installed-layout-cache-session.ps1"),
  path.join(root, "scripts/lib/installed-release-session.cjs")].map(p => {
  const copy = path.join(out, path.basename(p));
  fs.copyFileSync(p, copy, fs.constants.COPYFILE_EXCL);
  return { path: p, copy, sha256: sha(p) };
});
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out],
  { windowsHide: true, encoding: "utf8", timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), String(r.stdout) + String(r.stderr), { flag: "wx" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
}
function check(name, run) {
  try { run(); report.checks.push({ name, status: "PASS" }); }
  catch (e) { report.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
  save();
}
async function observe(name) {
  // Buttons are deliberately disabled while React's actual hydration is pending.
  await page.getByRole("button", { name: "继续上次编辑", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const home = document.querySelector(".project-home");
    const panel = home?.querySelector(".project-command-panel");
    const button = [...panel?.querySelectorAll("button") ?? []]
      .find(b => b.textContent.trim() === "继续上次编辑");
    return button && !button.disabled && panel.querySelector("h2")?.textContent === "继续上次编辑"
      && !home.innerText.includes("正在恢复项目");
  });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "detached" });
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching, .app-transition-stage.is-home-hydrating"));
  await settleEditor(page);
  await page.evaluate(async () => {
    const home = document.querySelector(".project-home");
    const related = document.getAnimations().filter(a => a.effect?.target instanceof Element
      && (home.contains(a.effect.target) || a.effect.target.contains(home))
      && a.effect.getComputedTiming().iterations !== Infinity);
    await Promise.all(related.map(a => a.finished.catch(() => {})));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const observation = await page.evaluate(() => {
    const home = document.querySelector(".project-home"), panel = home.querySelector(".project-command-panel");
    const button = [...panel.querySelectorAll("button")].find(b => b.textContent.trim() === "继续上次编辑");
    const rect = button.getBoundingClientRect();
    const local = JSON.parse(localStorage.getItem("agentvn.currentProjectDraft") || "null");
    return { heading: panel.querySelector("h2")?.textContent.trim(),
      cardTitle: panel.querySelector(".command-panel-copy p")?.textContent.trim(),
      hydrating: home.innerText.includes("正在恢复项目"),
      presentationReady: !document.querySelector(".project-entry-loading-overlay, .app-transition-stage.is-home-hydrating, .app-transition-stage.is-switching"),
      disabled: button.disabled, hit: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
      recent: [...home.querySelectorAll(".recent-project-open")].map(n => ({ text: n.textContent.trim() })),
      localDraft: local ? { id: local.project_id, title: local.title, author: local.author } : null,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth };
  });
  observation.name = name; observation.at = new Date().toISOString();
  // GET-only observation; secrets/provider configuration never enter the report.
  const persisted = await host.api("/api/project/state");
  observation.persisted = { id: persisted.project_metadata.projectId, title: persisted.project_metadata.title,
    author: persisted.project_metadata.author };
  const lightweight = await host.api("/api/project/state?include_project=false&include_recent_projects=false");
  observation.lightweightState = { id: lightweight.project_metadata?.projectId ?? null,
    title: lightweight.project_metadata?.title ?? null, graphNodes: lightweight.project_graph?.nodes?.length ?? 0 };
  report.observations.push(observation); save();
  await host.shot(name);
  check(`${name}: hydrated exact card and recent-project label`, () => cardMatches(observation, report.expected));
  check(`${name}: viewport and horizontal bounds`, () => {
    assert.deepEqual(observation.viewport, { width: 1920, height: 1080, dpr: 1 });
    assert(observation.horizontalOverflow <= 1);
  });
}
(async () => {
  report.sources = sources.map(p => ({ path: p, files: inventory(p) }));
  assert(report.sources.every(s => s.files.length > 0));
  const destinations = [path.join(out, "data"), path.join(out, "webview")];
  for (let i = 0; i < sources.length; i++) {
    fs.cpSync(sources[i], destinations[i], { recursive: true, errorOnExist: true, force: false });
    assert.deepEqual(inventory(destinations[i]), report.sources[i].files, "QA clone must be byte identical");
  }
  const input = path.join(root, "scripts/fixtures/editor-isolated-small.vnproj");
  assert(fs.existsSync(input));
  report.testProject = input; report.workspaceOutput = out; save();
  cache("SelfTest"); cachePrepared = true; cache("Prepare");
  host = installedReleaseSession({ installationFile, out, report, save, input });
  for (let launch = 1; launch <= 2; launch++) {
    page = await host.start();
    await observe(`launch-${launch}-hydrated-home`);
    await page.getByRole("button", { name: "继续上次编辑", exact: true }).click();
    await page.locator(".editor-toolbar").waitFor();
    await page.locator(".project-entry-loading-overlay").waitFor({ state: "detached" });
    await settleEditor(page);
    const persisted = await host.api("/api/project/state");
    check(`launch-${launch}: actual resume restores original ID/title/graph`, () => {
      assert.equal(persisted.project_metadata.projectId, report.expected.id);
      assert.equal(persisted.project_metadata.title, report.expected.title);
      assert.deepEqual(persisted.project_graph.nodes.map(n => n.id).sort(), baseline.graph.nodes.map(n => n.id).sort());
      assert.deepEqual(persisted.project_graph.edges, baseline.graph.edges);
    });
    await page.getByRole("button", { name: "返回首页", exact: true }).click();
    await observe(`launch-${launch}-returned-home`);
    await host.stop(`Diagnostic launch ${launch} complete; attributed termination, not native close`);
  }
  assert.equal(report.observations.length, 4, "No empty/partial matrix PASS");
  assert.equal(report.cleanups.length, 2);
  report.status = report.checks.some(c => c.status !== "PASS") ? "FAILED" : "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
  .finally(async () => {
    try {
      await host?.stop("Diagnostic finally");
      if (cachePrepared) { cache("Restore"); report.cacheRestored = true; }
      for (const p of report.protectedFiles) assert.equal(sha(p.path), p.sha256, p.path);
      for (const s of report.sources || []) assert.deepEqual(inventory(s.path), s.files, s.path);
      assert.equal(sha(installationFile), report.installation.sha256);
      const live = rows();
      assert(!(report.knownProcesses || []).some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
      assert.equal(listeners(report.launches.flatMap(l => l.ports)).length, 0);
      assert.equal(report.modelRequests, 0); report.protectedUnchanged = true;
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, observations: report.observations.map(o =>
      ({ name: o.name, title: o.cardTitle, localDraft: o.localDraft, persisted: o.persisted })),
    failed: report.checks.filter(c => c.status !== "PASS"), error: report.error,
    cleanupError: report.cleanupError, cacheRestored: report.cacheRestored }, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  });
