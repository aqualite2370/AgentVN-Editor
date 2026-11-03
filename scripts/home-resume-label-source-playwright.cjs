"use strict";
// Real App + isolated real source backend; no store injection or successful HTTP mocks.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Home-Resume-Repair-20261021-01";
const checkpoint = "F:/AgentVN/Checkpoints/Home-Resume-Repair-20261021-01";
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
if (process.argv[2] === "--prepare") {
  assert(!fs.existsSync(qa) && !fs.existsSync(checkpoint), "Fresh checkpoint required");
  fs.mkdirSync(qa, { recursive: true }); fs.mkdirSync(checkpoint, { recursive: true });
  const files = ["editor/src/components/project/ProjectHome.tsx", "editor/src/app/App.tsx",
    "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
    "scripts/installed-home-resume-label.cjs", "scripts/home-resume-label-source-playwright.cjs",
    "AgentVN Dev.exe"];
  const copies = files.map(relative => {
    const source = path.join(root, relative), copy = path.join(checkpoint, relative);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
    return { path: source, copy, sha256: hash(source) };
  });
  const diff = spawnSync("git", ["diff", "--binary", "HEAD"], { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(diff.status, 0);
  fs.writeFileSync(path.join(checkpoint, "tracked.patch"), diff.stdout, { flag: "wx" });
  const project = fixture("home-resume-repair-20261021");
  project.title = "首页已保存工程 中文"; project.author = "独立测试";
  const input = path.join(qa, "首页标签 隔离小工程.vnproj");
  fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
  fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify({
    at: new Date().toISOString(), scope: "Full tracked patch, affected files including untracked QA, prior Dev bytes; no reset/cleanup",
    files: copies, input, indexSha256: hash(path.join(root, ".git/index")),
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ checkpoint, qa, input })); process.exit(0);
}
const paths = resolveAcceptancePaths(), out = paths.output;
assert(path.dirname(out) === path.resolve(qa), "Dedicated QA child only");
fs.mkdirSync(out, { recursive: true });
const project = JSON.parse(fs.readFileSync(paths.input, "utf8"));
const report = { status: "RUNNING", scope: "SOURCE_APP_REAL_ISOLATED_BACKEND_NOT_INSTALLED_RELEASE",
  startedAt: new Date().toISOString(), testProject: paths.input, workspaceOutput: out,
  matrix: [], fallbackCases: [], checks: [], screenshots: [], errors: [], requests: [], blockedModelRequests: 0,
  productSource: { path: path.join(root, "editor/src/components/project/ProjectHome.tsx"),
    sha256: hash(path.join(root, "editor/src/components/project/ProjectHome.tsx")) } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let session, browser;
async function importProject(value) {
  const response = await fetch(`${session.backendUrl}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent("测试.vnproj") },
    body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
  assert(response.ok, await response.text()); return;
}
async function homeReady(page) {
  await page.locator(".project-home").waitFor();
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "detached" });
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-home-hydrating, .app-transition-stage.is-switching"));
}
async function observe(page, name, expected) {
  const detail = await page.locator(".project-command-panel").evaluate(panel => {
    const title = panel.querySelector(".command-panel-copy p"), rect = title.getBoundingClientRect();
    const button = [...panel.querySelectorAll("button")].find(n => n.textContent.trim() === "继续上次编辑");
    const b = button.getBoundingClientRect(), parent = panel.getBoundingClientRect();
    return { title: title.textContent.trim(), titleRect: rect.toJSON(), panelRect: parent.toJSON(),
      disabled: button.disabled, hit: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  report.checks.push({ name, detail, expected }); save();
  assert.equal(detail.title, expected, "HOME-RESUME-LABEL-01: card must name the same-ID saved project, not stale local draft");
  assert(detail.hit && !detail.disabled && detail.overflow <= 1);
  assert(detail.titleRect.left >= detail.panelRect.left && detail.titleRect.right <= detail.panelRect.right
    && detail.titleRect.top >= detail.panelRect.top && detail.titleRect.bottom <= detail.panelRect.bottom, "Card text clipped");
}
(async () => {
  session = await startEditorAcceptance(out, { isolateBackendWorkingDirectory: true });
  report.server = { pid: session.server.pid, runId: session.server.runId, url: session.url,
    backendPid: session.backendPid, backendUrl: session.backendUrl, backendCwd: session.backendCwd };
  report.ownedServices = rows().filter(p => [session.server.pid, session.backendPid].includes(p.ProcessId));
  assert.equal(report.ownedServices.length, 2);
  assert.equal(path.resolve(session.backendCwd), out);
  await importProject(project);
  // A newer unrelated row must never replace the current draft's identity.
  const other = { ...structuredClone(project), project_id: "home-resume-unrelated-newer", title: "另一个较新工程",
    updated_at: "2026-10-21T23:59:00.000Z" };
  await importProject(other);
  browser = await chromium.launch({ headless: true });
  const combinations = process.argv.includes("--smoke") ? [[1920, 1080, 1, false]]
    : [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true]
      .map(reduced => [width, width === 1920 ? 1080 : width === 2560 ? 1440 : 2160, dpr, reduced])));
  for (const [width, height, dpr, reduced] of combinations) {
    await session.server.assertAlive();
    const stale = { ...structuredClone(project), title: "未命名视觉小说", author: "",
      nodes: structuredClone(project.nodes) };
    stale.nodes[1].data.scene.summary = "只在本机的草稿标记，不得由名称同步覆盖";
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
      reducedMotion: reduced ? "reduce" : "no-preference" });
    await context.addInitScript(value => {
      if (!localStorage.getItem("agentvn.currentProjectDraft"))
        localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(value));
    }, stale);
    const page = await context.newPage();
    page.on("pageerror", e => report.errors.push(String(e)));
    await context.route("**/api/**", route => {
      const req = route.request(), url = new URL(req.url());
      report.requests.push({ method: req.method(), path: url.pathname });
      if (/\/(?:assistant|novel|generate)/.test(url.pathname) && req.method() === "POST") {
        report.blockedModelRequests++; save(); return route.abort();
      }
      return route.continue();
    });
    try {
      await page.goto(session.url, { waitUntil: "domcontentloaded" }); await homeReady(page);
      if (width === 1920 && dpr === 1 && !reduced)
        report.screenshots.push(await captureSourceBrowser(page, path.join(out, "initial-home.png"),
          { width, height, dpr, reduced }));
      await observe(page, "Saved same-ID title after full startup", project.title);
      const untouched = await page.evaluate(() => JSON.parse(localStorage.getItem("agentvn.currentProjectDraft")));
      assert.deepEqual(untouched, stale, "Displaying authoritative title must not overwrite local draft bytes");
      await page.reload({ waitUntil: "domcontentloaded" }); await homeReady(page);
      await observe(page, "Reload preserves corrected display without rewriting draft", project.title);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("agentvn.currentProjectDraft"))), stale);
      // Exercise primary resume, not a recent-project shortcut or internal event.
      await page.getByRole("button", { name: "继续上次编辑", exact: true }).click();
      await page.locator(".editor-toolbar").waitFor();
      await page.locator(".project-entry-loading-overlay").waitFor({ state: "detached" });
      await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
      const loaded = await page.evaluate(() => {
        const p = window.__AGENTVN_PROJECT_STORE__.getState(), g = window.__AGENTVN_EDITOR_STORE__.getState();
        return { id: p.projectId, title: p.title,
          nodes: g.nodes.map(n => ({ id: n.id, kind: n.data.nodeKind, scene: n.data.scene })),
          edges: g.edges.map(({ selected, ...edge }) => edge) };
      });
      assert.equal(loaded.id, project.project_id); assert.equal(loaded.title, project.title);
      assert.deepEqual(loaded.nodes, project.nodes.map(n => ({ id: n.id, kind: n.data.nodeKind, scene: n.data.scene })));
      assert.deepEqual(loaded.edges, project.edges);
      assert.deepEqual(await page.locator(".react-flow__node").evaluateAll(nodes => nodes.map(n => n.dataset.id).sort()),
        project.nodes.map(n => n.id).sort(), "Actual canvas must contain only the resumed project nodes");
      const detail = await fetch(`${session.backendUrl}/api/project/projects/${project.project_id}`).then(r => r.json());
      assert.equal(detail.data.title, project.title);
      assert.deepEqual(detail.data.nodes.map(n => ({ id: n.id, kind: n.data.nodeKind, scene: n.data.scene })),
        project.nodes.map(n => ({ id: n.id, kind: n.data.nodeKind, scene: n.data.scene })),
        "Saved scene identities/content must not be replaced by the stale cached graph");
      assert.deepEqual(detail.data.edges, project.edges);
      await page.getByRole("button", { name: "返回首页", exact: true }).click(); await homeReady(page);
      await observe(page, "Return preserves title and same project", project.title);
      const preservedOther = await fetch(`${session.backendUrl}/api/project/projects/${other.project_id}`).then(r => r.json());
      assert.equal(preservedOther.data.title, other.title);
      report.matrix.push({ width, height, dpr, reduced, status: "PASS",
        localDraftPreservedBeforeResume: true, actualResumeSameIdSceneCommandsAndEdges: true, otherProjectUnchanged: true });
      save();
    } finally { await context.close(); }
  }
  assert.equal(report.matrix.length, combinations.length); assert(report.matrix.length > 0);
  for (const mode of ["missing-current-summary", "offline-catalog"]) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const local = { ...structuredClone(project), title: "仅本机草稿名称" };
    await context.addInitScript(p => localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(p)), local);
    const page = await context.newPage();
    page.on("pageerror", e => report.errors.push(String(e)));
    await page.route("**/api/project/catalog", async route => {
      if (mode === "offline-catalog") return route.fulfill({ status: 503, contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ detail: "受控目录不可用" }) });
      const response = await route.fetch(), payload = await response.json();
      payload.data = payload.data.filter(p => p.project_id !== project.project_id);
      await route.fulfill({ response, json: payload });
    });
    try {
      await page.goto(session.url, { waitUntil: "domcontentloaded" }); await homeReady(page);
      await observe(page, `Controlled ${mode}: keep the local title, never use another project's title`, local.title);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("agentvn.currentProjectDraft"))), local);
      if (mode === "offline-catalog") await page.getByText("后端暂不可用，当前显示本机缓存项目。", { exact: true }).waitFor();
      report.fallbackCases.push({ mode, status: "PASS", controlled: true, localBytesPreserved: true });
    } finally { await context.close(); }
  }
  assert.equal(report.fallbackCases.length, 2);
  assert.equal(report.blockedModelRequests, 0); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    try {
      await browser?.close(); await session?.stop();
      const live = rows();
      assert(!(report.ownedServices || []).some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
      const ports = session ? [Number(new URL(session.url).port), Number(new URL(session.backendUrl).port)] : [];
      assert.equal(listeners(ports).length, 0);
      report.cleanup = { status: "PASS", browserClosed: true, ownedServicesStopped: true, ports };
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, combinations: report.matrix.length, error: report.error, out }, null, 2));
  });
