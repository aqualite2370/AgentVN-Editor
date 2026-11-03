"use strict";
// Production installed WebView and backend; only novel task HTTP payloads and
// initial recovery records are controlled. Never import frontend source/store.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { armFloatingMotion, finishFloatingMotion, assertFloatingMotion } = require("./lib/floating-motion-probe.cjs");
const candidateArgument = process.argv.find(value => value.startsWith("--candidate="));
const currentCandidate = Boolean(candidateArgument);
const candidateVersion = candidateArgument?.slice("--candidate=".length);
if (currentCandidate) assert.match(candidateVersion, /^\d+\.\d+\.\d+$/);
const { captureInstalledWebview, readInstalledViewport, validateNativeViewport } = require(currentCandidate
  ? "./lib/current-native-capture.cjs" : "./lib/installed-webview-capture.cjs");
const { startCurrentInstalledNovelSession, verifyCurrentInstalledNovelSession } = require("./lib/current-installed-novel-session.cjs");
const { novel1922Session } = require("./lib/installed-novel-1922-session.cjs");

assert(process.argv[2] && process.argv[3], "Pass actual installation resource report and fresh output directory");
const root = path.resolve(__dirname, "..");
const auditFile = path.resolve(process.argv[2]), out = path.resolve(process.argv[3]);
assert(!fs.existsSync(out), "Preserve every prior acceptance result");
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), out);
const input = path.resolve(process.env.AGENTVN_TEST_PROJECT || "");
const candidateInstallationArgument = process.argv.find(value => value.startsWith("--installation-file="));
const candidateInstallationFile = candidateInstallationArgument
  ? path.resolve(candidateInstallationArgument.slice("--installation-file=".length)) : undefined;
const candidateQaRoot = process.argv.find(value => value.startsWith("--candidate-qa-root="))
  ?.slice("--candidate-qa-root=".length);
if (currentCandidate) {
  assert(candidateInstallationFile && candidateQaRoot, "Current candidate requires --installation-file and --candidate-qa-root");
  assert(A.inside(candidateQaRoot, out));
}
const currentDefaultSession = process.argv.includes("--current-default-session");
assert(!(currentCandidate && currentDefaultSession));
const resumeArgument = process.argv.find(a => a.startsWith("--resume-attempt="));
const resumeAttempt = resumeArgument?.split("=")[1];
if (resumeArgument) assert(currentCandidate && /^\d{2}$/.test(resumeAttempt));
const adoptNativeArgument = process.argv.find(a => a.startsWith("--resume-native-attempt="));
const adoptNativeAttempt = adoptNativeArgument ? Number(adoptNativeArgument.split("=")[1]) : undefined;
if (adoptNativeArgument) assert(currentDefaultSession && Number.isInteger(adoptNativeAttempt) && adoptNativeAttempt > 0);
const currentWork = "F:/AgentVN-QA-InstalledNovelSession-20261018-01";
if (currentDefaultSession) {
  assert.equal(path.dirname(out), path.resolve("D:/AgentVN/output/installed-novel-session-20261018-01"));
  assert(A.inside(currentWork, input) && input.endsWith(".vnproj"));
} else assert(A.inside(out, input) && input.endsWith(".vnproj"));
assert.notEqual(process.env.E5_LIFECYCLE_SOURCE, "1", "Source harness is not installed acceptance");
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(auditFile, path.join(out, "installer-resource-report.json"));
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(),
  scope: currentDefaultSession
    ? "FROZEN_NSIS_1.9.9_DEFAULT_PATHS_WHOLE_PROFILES_PROTECTED; controlled novel HTTP/recovery/cache/export-directory seeds; NO_REAL_MODEL"
    : "Actual NSIS installed Release; isolated DB/WebView, controlled novel HTTP and recovery fixtures, no paid AI",
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out },
  cases: [], matrix: [], screenshots: [], launches: [], cleanup: [], errors: [], transport: [], forbiddenRequests: [],
};
report.productChanges = 0; report.realModelRequests = 0;
if (currentCandidate) report.version = candidateVersion;
report.controlledBoundaries = ["Task HTTP payloads, not real backend/model task execution",
  "Two recovery-cache seeds and per-project export-directory map, not real native directory selection",
  "Actual author UI/project backend/position persistence; no frontend source module or store mutation"];
report.tools = ["scripts/installed-novel-task-floating-playwright.cjs", "scripts/lib/current-installed-novel-session.cjs",
  "scripts/lib/floating-motion-probe.cjs", ...(currentCandidate ? [
    "scripts/lib/installed-novel-1922-session.cjs", "scripts/lib/current-native-capture.cjs",
    "scripts/lib/installed-release-session.cjs", "scripts/installed-layout-cache-session.ps1",
  ] : ["scripts/lib/installed-webview-capture.cjs"])]
  .map(file => ({ path: path.join(root, file), sha256: A.sha256(fs.readFileSync(path.join(root, file))) }));
const exportsDirectory = currentDefaultSession
  ? path.join(currentWork, `${path.basename(out)}-project-exports`) : path.join(out, "project-exports");
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const snapshotKey = id => `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(id)}`;
const positionKey = id => `agentvn.novelTask.position.${encodeURIComponent(id)}`;
const projects = ["a", "b"].map(suffix => {
  const p = fixture(`installed_novel_${resumeAttempt ? `session-${resumeAttempt}` : path.basename(out)}_${suffix}`);
  p.title = `安装版解析验收 ${suffix.toUpperCase()}`;
  p.nodes[1].data.editorMeta = { ...p.nodes[1].data.editorMeta, source: "imported",
    sourceProcessJobId: "unrelated-completed-task", sourceProcessChapterIndex: 0,
    importLineId: "existing-unrelated-line" };
  return p;
});
function task(project, suffix) {
  return { projectId: project.project_id, events: [], job: {
    jobId: `installed-floating-${suffix}`, novelTitle: `解析任务 ${suffix.toUpperCase()}`, status: "running",
    selectedChapterCount: 1, totalChunks: 4, completedChunks: 2, failedChunks: 0, cancelledChunks: 0,
    runningAgentCount: 1, estimatedRemainingChunks: 2, progressPercent: 50,
    tokenStats: { totalInputTokens: 320, totalOutputTokens: 180, totalTokens: 500,
      estimatedTokens: 1000, actualTokens: 500, averageChunkTokens: 250,
      retryExtraTokens: 0, byAgent: [], byChapter: [] },
    agents: [], chapters: [], source: "api", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } };
}
const tasks = projects.map((p, i) => task(p, i ? "b" : "a"));
const scenes = index => ({
  chapterIndex: index, chapterTitle: `受控章节 ${index}`, sourceChunkIds: [`chunk_${index}`],
  summary: "仅验证结果写图和定位，不请求模型。", qualityWarnings: [],
  scene: { scene_id: `installed_novel_chapter_${index}`, title: `受控章节 ${index}`, summary: "",
    chapter: index + 1, tags: [], commands: [{ type: "narration", text: "实际安装版解析结果定位。" }] },
});
let owner, state, browser, page, cdp, context;
let candidateSession, cachePrepared = false;
let declaredViewport = { width: 1920, height: 1080, dpr: 1, reduced: false };
async function metrics(expected) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: expected.width, height: expected.height,
    deviceScaleFactor: expected.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: expected.reduced ? "reduce" : "no-preference" });
  await readInstalledViewport(page, expected); declaredViewport = { ...expected };
}
function cache(action) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action,
    "-RunDirectory", out, "-CodexCacheView"];
  if (currentCandidate) args.push("-AllowedRunRoot", candidateQaRoot);
  const result = spawnSync("powershell.exe", args,
    { encoding: "utf8", windowsHide: true, timeout: 45000 });
  (report.cache ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function nativePosition(id) {
  const file = path.join(state.dataRoot, "ui-preferences/novel-card-positions",
    require("node:crypto").createHash("sha256").update(id).digest("hex") + ".json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(data.projectId, id); assert.equal(data.schemaVersion, 1);
  return { path: file, sha256: A.sha256(fs.readFileSync(file)), data };
}
let panelDelay = 0, holdAction, holdResult, chapterCount = 1, resultsFail = false;
const pendingReleases = new Set();
const requestRecords = new WeakMap();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stage(name, body) {
  const inherited = report.cases.find(c => c.name === name && c.inheritedFrom);
  if (inherited) { console.log(`REUSE verified ${name}`); return inherited; }
  report.stage = name; save(); console.log(`START ${name}`);
  const evidence = await body();
  report.cases.push({ name, status: "PASS", ...evidence }); save(); console.log(`PASS ${name}`);
}
async function getProject(p) {
  const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/${p.project_id}`,
    { signal: AbortSignal.timeout(10000) });
  assert(response.ok);
  return (await response.json()).data;
}
async function until(predicate, message, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await predicate()) return; await wait(100); }
  throw Error(message);
}
function held() {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const done = () => { pendingReleases.delete(done); release(); };
  pendingReleases.add(done);
  return { pending, release: done };
}
async function routeTask(route) {
  const request = route.request(), url = new URL(request.url());
  const match = /\/execute\/jobs\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  assert(match, `Unexpected novel task transport: ${url.pathname}`);
  const value = tasks.find(t => t.job.jobId === decodeURIComponent(match[1]));
  assert(value, `Unexpected task identity ${match[1]}`);
  const operation = match[2];
  const record = { projectId: value.projectId, jobId: value.job.jobId, operation,
    method: request.method(), start: Date.now() };
  report.transport.push(record);
  requestRecords.set(request, record);
  try {
    if (operation === "panel") {
      const response = structuredClone(value.job);
      if (panelDelay) await wait(panelDelay);
      await route.fulfill({ json: response });
    } else if (operation === "events") {
      await route.fulfill({ json: value.events });
    } else if (operation === "results") {
      record.chapterCount = chapterCount;
      const response = { jobId: value.job.jobId, status: value.job.status, completedResults: [],
        failedResults: [], completedChapterResults: Array.from({ length: chapterCount }, (_, i) => scenes(i)),
        failedChapterResults: [], warnings: [] };
      if (holdResult) { const hold = holdResult; holdResult = undefined; record.held = true; await hold.pending; }
      if (resultsFail) await route.fulfill({ status: 500, json: { detail: "controlled-result-read-failure" } });
      else await route.fulfill({ json: response });
    } else {
      assert.equal(request.method(), "POST");
      const next = { pause: "paused", resume: "running", retry_failed_chunks: "retrying", cancel: "cancelled" }[operation];
      assert(next, `Forbidden task operation ${operation}`);
      if (holdAction) {
        const hold = holdAction; holdAction = undefined; record.held = true; await hold.pending;
        if (hold.error) {
          record.controlledFailure = hold.error;
          await route.fulfill({ status: 500, json: { detail: hold.error } }); return;
        }
      }
      value.job.status = next;
      await route.fulfill({ json: value.job });
    }
  } catch (error) {
    record.error = String(error);
    if (!request.failure()) throw error;
  } finally { record.end = Date.now(); record.failure = request.failure(); }
}
async function connect() {
  state = owner.state;
  const verified = currentCandidate ? candidateSession.verify()
    : currentDefaultSession ? verifyCurrentInstalledNovelSession(owner) : A.readInstalledSession(out);
  report.launches.push({ ...state, exeSha256: verified.exeSha256 });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  context = browser.contexts()[0];
  context.on("requestfinished", request => {
    const record = requestRecords.get(request);
    if (record) record.browserFinished = Date.now();
  });
  await context.route("**/api/novel/processing/execute/jobs/*/**", routeTask);
  await context.route("**/api/novel/**", async (route, request) => {
    if (/\/execute\/jobs\/[^/]+\//.test(request.url())) { await route.fallback(); return; }
    if (request.method() !== "GET") {
      report.forbiddenRequests.push({ url: request.url(), method: request.method() });
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  await until(() => {
    page = context.pages().find(p => /^http:\/\/tauri\.localhost/.test(p.url()));
    return Boolean(page);
  }, "Actual installed WebView not found", 45000);
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push(String(error)));
  cdp = await context.newCDPSession(page);
}
const mini = () => page.getByTestId("novel-task-mini-entry");
const panel = () => page.getByTestId("novel-task-workbench");
async function openProject(p) {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: p.title }).first().click();
  await page.locator(".editor-toolbar").waitFor();
  await A.settleEditor(page);
  assert.equal((await A.projectSnapshot(state.backendPort)).projectId, p.project_id);
  await mini().waitFor({ state: "visible" });
  assert.equal(await mini().getAttribute("data-project-id"), p.project_id);
  await positionCommitted();
}
async function positionCommitted() {
  assert.equal(await mini().getAttribute("data-position-storage"), "native");
  await page.waitForFunction(() => document.querySelector('[data-testid="novel-task-mini-entry"]')
    ?.getAttribute("data-position-persistence") === "saved");
}
async function screenshot(name, expected) {
  expected ??= currentCandidate ? declaredViewport : await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const capture = await captureInstalledWebview(page, cdp, path.join(out, name), expected);
  report.screenshots.push(capture);
  return capture;
}
async function home() {
  if (await panel().isVisible()) {
    await panel().getByRole("button", { name: "最小化任务面板", exact: true }).click();
    await panel().waitFor({ state: "hidden" });
  }
  await page.locator('[data-workspace-surface="edit"]:visible').click();
  await A.settleEditor(page);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
}
async function openPanel() {
  await mini().getByRole("button", { name: /打开小说任务面板/ }).click();
  await panel().waitFor({ state: "visible" });
}
async function status(expected) {
  await page.waitForFunction(expected =>
    document.querySelector('[data-testid="novel-task-mini-entry"]')?.getAttribute("data-job-status") === expected, expected);
}
async function closePanel() {
  if (!await panel().isVisible()) return;
  await panel().getByRole("button", { name: "最小化任务面板", exact: true }).click();
  await panel().waitFor({ state: "hidden" });
}
async function geometry() {
  return page.evaluate(() => {
    const r = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    const card = document.querySelector('[data-testid="novel-task-mini-entry"]');
    const button = card.querySelector(".novel-task-card-open"), br = button.getBoundingClientRect();
    return { card: r('[data-testid="novel-task-mini-entry"]'), palette: r(".node-palette"),
      flow: r(".editor-workspace > .flow-surface"), inspector: r(".scene-editor-pane"),
      toolbar: r(".editor-workspace-toolbar"), status: r(".workspace-status-bar"),
      hit: button.contains(document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2)),
      text: card.textContent, nestedButtons: card.querySelectorAll("button button").length,
      progress: card.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
async function readPosition(id) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null"), positionKey(id));
}
async function closeOwnedWindowNormally() {
  if (currentDefaultSession || currentCandidate) {
    // Controlled process-restart durability is independent of the known HOST-02
    // normal-close defect. The actual attributed stop happens once in main.
    if (currentCandidate) candidateSession.verify(); else verifyCurrentInstalledNovelSession(owner);
    report.normalWindowClose = { status: "NOT_RUN", method: "ATTRIBUTED_TERMINATION_FOR_RESTART_NOT_NORMAL_CLOSE" };
    await browser.close(); browser = undefined; return;
  }
  A.readInstalledSession(out);
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `$p=Get-Process -Id ${Number(state.editorPid)} -ErrorAction Stop; ` +
    `if (-not $p.CloseMainWindow()) { throw 'Owned native close request was not accepted' }; ` +
    `if (-not $p.WaitForExit(15000)) { throw 'Owned window did not close normally' }`],
  { windowsHide: true, encoding: "utf8", timeout: 20000 });
  report.normalWindowClose = { pid: state.editorPid, exitCode: result.status, error: result.stderr };
  assert.equal(result.status, 0, result.stderr || String(result.error));
  await browser.close(); browser = undefined;
}
async function dragCard() {
  const initial = await mini().boundingBox();
  const grip = mini().getByRole("button", { name: "拖动小说任务卡片" }), r = await grip.boundingBox();
  await page.mouse.move(r.x + 40, r.y + r.height / 2); await page.mouse.down();
  await page.mouse.move(r.x + 44, r.y + r.height / 2);
  const small = await mini().boundingBox();
  assert(Math.abs(small.x - initial.x) < 1 && Math.abs(small.y - initial.y) < 1, "Under 6px must not drag");
  await page.mouse.move(r.x - 120, r.y - 70, { steps: 8 }); await page.mouse.up();
  await positionCommitted();
  const moved = await mini().boundingBox();
  assert(initial.x - moved.x > 100 && initial.y - moved.y > 40);
  assert(!await panel().isVisible(), "Drag release must not expand task");
  const saved = await readPosition(projects[0].project_id);
  assert(saved && saved.x >= 0 && saved.x <= 1 && saved.y >= 0 && saved.y <= 1);
  return { initial, small, moved, saved };
}
async function main() {
  // Recoverable checkpoint before this slice's new acceptance. Source files
  // and dirty tracked diff are evidence, not a commit/reset/cleanup operation.
  const checkpoint = path.join(out, "checkpoint"); fs.mkdirSync(checkpoint);
  report.checkpoint = [];
  for (const file of ["plans/ACTIVE_TASKS.md", "editor/src/components/novel-import/NovelTaskCard.tsx",
    "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx", "editor/src/store/novelImportStore.ts"]) {
    const bytes = fs.readFileSync(path.join(root, file));
    fs.writeFileSync(path.join(checkpoint, file.replaceAll("/", "__")), bytes, { flag: "wx" });
    report.checkpoint.push({ file, sha256: A.sha256(bytes) });
  }
  const diff = spawnSync("git", ["diff", "--binary"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(diff.status, 0); fs.writeFileSync(path.join(checkpoint, "tracked.patch"), diff.stdout, { flag: "wx" });
  if (currentCandidate) {
    const baselineArgument = process.argv.find(value => value.startsWith("--candidate-baseline="));
    if (baselineArgument) {
      const baseline = JSON.parse(fs.readFileSync(path.resolve(baselineArgument.slice("--candidate-baseline=".length)), "utf8"));
      report.protectedFiles = baseline.cases.find(c => c.name === "protected-file-baseline").detail;
      for (const f of report.protectedFiles) assert.equal(A.sha256(fs.readFileSync(f.path)), f.sha256);
    }
    report.executedTools = report.tools.map(f => {
      const target = path.join(checkpoint, "executed-tools", path.relative(root, f.path));
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(f.path, target, fs.constants.COPYFILE_EXCL);
      return { ...f, copy: target };
    });
    cache("SelfTest"); cache("Prepare"); cachePrepared = true;
    if (resumeAttempt) {
      const parentFile = path.join(path.dirname(out), `session-${resumeAttempt}`, "report.json");
      const parent = JSON.parse(fs.readFileSync(parentFile, "utf8"));
      assert.equal(parent.status, "FAILED"); assert.equal(parent.cases.length, 4); assert.equal(parent.matrix.length, 12);
      assert.equal(parent.stage, "installed-pointer-capture-cancel-and-nonmodal-workspace");
      assert.match(parent.error, /releasePointerCapture/);
      assert.equal(parent.cache.at(-1).action, "Restore"); assert(parent.cache.every(c => c.exitCode === 0));
      report.continuation = { path: parentFile, sha256: A.sha256(fs.readFileSync(parentFile)),
        completedCases: parent.cases.map(c => c.name), reason: "Keep verified display/drag evidence; await actual reset motion before pointer probe.",
        originalFailurePreserved: true };
      report.inheritedKnownProcesses = structuredClone(parent.nativeSession.knownProcesses);
      for (const key of ["matrix", "launches", "cleanup", "nativeSession", "nativePositionBeforeRestart",
        "nativePositionAfterRestart", "nativePositionReset", "restartProbe", "normalWindowClose", "transport"])
        report[key] = structuredClone(parent[key]);
      report.cases = parent.cases.map(c => ({ ...structuredClone(c), inheritedFrom: report.continuation }));
      report.screenshots = parent.screenshots.filter(s => path.basename(s.path) !== "failure.png");
      for (const dir of ["data", "webview"]) fs.cpSync(path.join(path.dirname(parentFile), dir), path.join(out, dir),
        { recursive: true, force: false, errorOnExist: true });
      fs.writeFileSync(input, fs.readFileSync(parent.environment.AGENTVN_TEST_PROJECT), { flag: "wx" });
      report.clonedState = ["data", "webview"].map(n => ({ from: path.join(path.dirname(parentFile), n), to: path.join(out, n) }));
    }
    const install = JSON.parse(fs.readFileSync(candidateInstallationFile, "utf8"));
    candidateSession = novel1922Session({
      out, input, report, save, receiptFile: candidateInstallationFile,
      expectedVersion: candidateVersion, expectedSha: install.executable.sha256, qaRoot: candidateQaRoot,
    });
  }
  owner = currentCandidate ? await candidateSession.start()
    : currentDefaultSession ? await startCurrentInstalledNovelSession({ adoptAttempt: adoptNativeAttempt }) : await startInstalledEditor(out);
  state = owner.state;
  for (const p of resumeAttempt ? [] : projects) {
    const file = p === projects[0] ? input : path.join(currentDefaultSession ? currentWork : out, "独立工程 B.vnproj");
    fs.writeFileSync(file, JSON.stringify(p, null, 2), { flag: "wx" });
    const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(file)) },
      body: fs.readFileSync(file),
    });
    assert(response.ok, "Isolated installed backend must import fixture");
  }
  await connect();
  fs.mkdirSync(exportsDirectory);
  await page.evaluate(({ tasks, directories }) => {
    for (const value of tasks) localStorage.setItem(
      `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(value.projectId)}`, JSON.stringify(value));
    localStorage.setItem("agentvn.projectExportDirectories.v1", JSON.stringify(directories));
  }, { tasks, directories: Object.fromEntries(projects.map(p => [p.project_id, exportsDirectory])) });
  await page.reload({ waitUntil: "domcontentloaded" });
  if (resumeAttempt) await openProject(projects[0]);
  await stage("installed-task-recovery-and-real-project-entry", async () => {
    await openProject(projects[0]);
    assert((await mini().innerText()).includes("解析任务 A"));
    await until(() => report.transport.some(r => r.operation === "panel" && r.end), "Production controller must refresh restored API job");
    return { initial: await geometry() };
  });
  await stage("installed-high-resolution-card-workspace-motion-and-focus-matrix", async () => {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const viewport = { width, height }, item = { ...viewport, dpr, reduced };
        report.currentMatrix = item;
        const expected = { width, height, dpr, reduced };
        await metrics(expected);
        item.actualBefore = await readInstalledViewport(page, expected);
        await page.locator('[data-workspace-surface="options"]:visible').click(); await A.settleEditor(page);
        const before = await geometry(), card = before.card;
        assert((currentCandidate ? card.width >= 138 && card.width <= 142 : card.width >= 250 && card.width <= 282)
          && card.height >= 80 && card.height <= 96);
        assert(before.text.includes("处理中") && before.progress === "50" && before.hit && !before.nestedButtons && before.overflow <= 1);
        assert(card.x >= 12 && card.y >= before.toolbar.bottom + 11 && card.right <= width - 12
          && card.bottom <= Math.min(height - 12, before.status.top - 12) + 1);
        const open = mini().getByRole("button", { name: /打开小说任务面板/ });
        const keyboard = dpr === 2;
        if (keyboard) await open.focus();
        await armFloatingMotion(page, '[data-testid="novel-task-workbench"]',
          keyboard ? { input: "keydown", key: "Enter" } : {});
        if (keyboard) await page.keyboard.press("Enter"); else await open.click();
        item.entry = await finishFloatingMotion(page);
        item.entrySummary = assertFloatingMotion(item.entry, viewport, { reduced, duration: reduced ? 80 : 240 });
        assert(item.entry.frames.filter(f => f.rendered && f.panel.visible).every(f => f.panel.ownsFocus && !f.panel.inert));
        const after = await geometry();
        for (const track of ["palette", "flow", "inspector"]) for (const field of ["x", "y", "width", "height"])
          assert(Math.abs(before[track][field] - after[track][field]) < 1, `${track}.${field} moved`);
        const footer = await panel().locator(".novel-task-actions button").evaluateAll(buttons => buttons.map(button => {
          const r = button.getBoundingClientRect(), p = button.closest("section").getBoundingClientRect();
          return { label: button.textContent, hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
            contained: r.x >= p.x && r.y >= p.y && r.right <= p.right && r.bottom <= p.bottom };
        }));
        assert(footer.length && footer.every(b => b.hit && b.contained)); item.footer = footer;
        const tokenTab = panel().getByRole("tab", { name: item.reduced ? "按章节" : "按处理槽", exact: true });
        await armFloatingMotion(page, ".novel-token-view-content", { settledView: item.reduced ? "chapter" : "agent" });
        await tokenTab.click(); item.token = await finishFloatingMotion(page);
        item.tokenSummary = assertFloatingMotion(item.token, viewport, { reduced, duration: reduced ? 80 : 160, minOpacity: .65 });
        if (width === 1920 && dpr === 1 && !reduced)
          await screenshot("installed-expanded-task-panel.png", expected);
        await armFloatingMotion(page, '[data-testid="novel-task-workbench"]',
          keyboard ? { input: "keydown", key: "Escape", visible: false } : { visible: false });
        if (keyboard) await page.keyboard.press("Escape");
        else await panel().getByRole("button", { name: "最小化任务面板", exact: true }).click();
        item.exit = await finishFloatingMotion(page);
        item.exitSummary = assertFloatingMotion(item.exit, viewport, { reduced, duration: reduced ? 80 : 240 });
        await page.waitForFunction(() => document.activeElement?.matches(".novel-task-card-open"));
        assert.equal(await page.locator('[data-workspace-surface="options"]:visible').getAttribute("aria-current"), "page");
        assert.equal(await page.locator(".novel-task-backdrop").count(), 0);
        await openPanel();
        await armFloatingMotion(page, '[data-testid="novel-task-workbench"]');
        await panel().getByRole("button", { name: "最小化任务面板", exact: true }).click();
        // Reverse a *rendered* exit. Two clicks before its first frame may
        // correctly coalesce to no visual displacement, not a missing fade.
        await page.waitForFunction(() => {
          const p = document.querySelector('[data-testid="novel-task-workbench"]');
          const opacity = p && Number(getComputedStyle(p).opacity);
          return p?.closest("[inert]") && opacity > .005 && opacity < .99;
        }, undefined, { polling: "raf", timeout: 5000 });
        item.redirectInput = await mini().getByRole("button", { name: /打开小说任务面板/ }).evaluate(button => {
          const r = button.getBoundingClientRect(), p = document.querySelector('[data-testid="novel-task-workbench"]');
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, previousMounted: Boolean(p),
            previousInert: !p || Boolean(p.closest("[inert]")),
            hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
        });
        assert(item.redirectInput.previousInert && item.redirectInput.hit, "Exit must immediately yield to visible card");
        await page.mouse.click(item.redirectInput.x, item.redirectInput.y);
        item.redirect = await finishFloatingMotion(page);
        item.redirectSummary = assertFloatingMotion(item.redirect, viewport, { reduced, duration: reduced ? 80 : 240 });
        assert.equal(await panel().count(), 1);
        assert(!await panel().evaluate(n => Boolean(n.closest("[inert]"))));
        await closePanel();
        await page.waitForFunction(() => document.activeElement?.matches(".novel-task-card-open"));
        for (const probe of [item.entry, item.token, item.exit, item.redirect])
          for (const frame of probe.frames.filter(f => f.rendered))
            if (currentCandidate) validateNativeViewport({ ...frame.viewport, reduced }, expected);
            else assert.deepEqual(frame.viewport, { width, height, dpr }, "Every motion frame must retain actual native DPR");
        item.screenshot = await screenshot(`${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`, expected);
        item.actualAfter = await readInstalledViewport(page, expected);
        item.geometry = before; item.status = "PASS"; report.matrix.push(item); save();
        delete report.currentMatrix;
      }
    }
    assert.equal(report.matrix.length, 12);
    return { viewportNote: "Production Windows WebView logical viewport/DPR emulation, not physical 4K" };
  });
  await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
  if (currentCandidate) await stage("installed-dismiss-card-keeps-refresh-and-toolbar-reveals-same-task", async () => {
    const start = report.transport.length;
    await mini().getByRole("button", { name: "隐藏任务卡片", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="novel-task-mini-entry"]')?.getAttribute("data-card-hidden") === "true");
    assert(await page.locator('[data-help-key="toolbar.novelImport"]').evaluate(b => b === document.activeElement));
    await until(() => report.transport.slice(start).some(r => r.operation === "panel" && r.end),
      "Dismissal must not stop the current task refresh", 12000);
    await page.locator('[data-help-key="toolbar.novelImport"]:visible').click();
    await page.getByRole("button", { name: "关闭小说导入工作台", exact: true }).waitFor();
    await page.getByRole("button", { name: "关闭小说导入工作台", exact: true }).click();
    await mini().waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector('[data-testid="novel-task-mini-entry"]')
      ?.getAttribute("data-card-hidden") === "false");
    assert.equal(await mini().getAttribute("data-project-id"), projects[0].project_id);
    assert.equal(await mini().getAttribute("data-job-status"), "running");
    return { currentTask: tasks[0].job.jobId, continuedPanelReads: report.transport.slice(start).filter(r => r.operation === "panel").length };
  });
  let moved;
  await stage("installed-drag-threshold-project-position-and-real-process-restart", async () => {
    moved = await dragCard();
    if (currentCandidate) {
      report.nativePositionBeforeRestart = nativePosition(projects[0].project_id);
      assert.deepEqual(report.nativePositionBeforeRestart.data.position, moved.saved);
    }
    report.restartProbe = { moved, beforeHome: await geometry() }; save();
    await home(); await openProject(projects[1]);
    const b = await geometry();
    assert(Math.abs(b.card.x - moved.initial.x) < 2 && Math.abs(b.card.y - moved.initial.y) < 2);
    assert.equal(await readPosition(projects[1].project_id), null);
    await home();
    report.restartProbe.beforeClosePosition = await readPosition(projects[0].project_id); save();
    // Test ordinary editor restart, not an artificial force-kill of WebView's
    // asynchronously flushed localStorage. Crash durability is a separate scope.
    await closeOwnedWindowNormally();
    report.cleanup.push(await owner.stop()); owner = undefined;
    owner = currentCandidate ? await candidateSession.start()
      : currentDefaultSession ? await startCurrentInstalledNovelSession() : await startInstalledEditor(out, { restart: true });
    await connect();
    await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await openProject(projects[0]);
    const restored = await mini().boundingBox();
    report.restartProbe.restored = { rect: restored, saved: await readPosition(projects[0].project_id),
      geometry: await geometry(), url: page.url() }; save();
    assert(Math.abs(restored.x - moved.moved.x) < 2 && Math.abs(restored.y - moved.moved.y) < 2);
    assert.deepEqual(await readPosition(projects[0].project_id), moved.saved);
    if (currentCandidate) {
      report.nativePositionAfterRestart = nativePosition(projects[0].project_id);
      assert.deepEqual(report.nativePositionAfterRestart.data.position, moved.saved);
    }
    await metrics({ width: 2560, height: 1440, dpr: 2, reduced: false });
    await page.waitForFunction(() => {
      const r = document.querySelector('[data-testid="novel-task-mini-entry"]').getBoundingClientRect();
      return r.right <= innerWidth - 12 && r.bottom <= innerHeight - 12;
    });
    await mini().getByRole("button", { name: "恢复任务卡片默认位置" }).click();
    await positionCommitted();
    assert.equal(await readPosition(projects[0].project_id), null);
    if (currentCandidate) {
      report.nativePositionReset = nativePosition(projects[0].project_id);
      assert.equal(report.nativePositionReset.data.position, null);
    }
    return { ...moved, restored, otherProject: b.card };
  });
  await stage("installed-pointer-capture-cancel-and-nonmodal-workspace", async () => {
    if (currentCandidate) await page.waitForFunction(() => {
      const card = document.querySelector('[data-testid="novel-task-mini-entry"]');
      return card && !card.getAnimations().some(a => ["running", "pending"].includes(a.playState));
    }, undefined, { polling: "raf" });
    const grip = mini().getByRole("button", { name: "拖动小说任务卡片" });
    await grip.evaluate(button => button.addEventListener("pointerdown", event => {
      button.dataset.acceptancePointerId = String(event.pointerId);
    }, { once: true }));
    const r = await grip.boundingBox();
    await page.mouse.move(r.x + 40, r.y + r.height / 2); await page.mouse.down();
    if (currentCandidate) assert(await grip.evaluate(button =>
      button.hasPointerCapture(Number(button.dataset.acceptancePointerId))), "Pointer down must actually hit the settled handle");
    await page.mouse.move(r.x + 16, r.y + r.height / 2);
    await grip.evaluate(button => button.releasePointerCapture(Number(button.dataset.acceptancePointerId)));
    await page.mouse.move(r.x + 15, r.y + r.height / 2); await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('[data-testid="novel-task-mini-entry"]').classList.contains("is-dragging"));
    assert(!await panel().isVisible());
    const touchGrip = await grip.boundingBox();
    const first = { id: 1, x: touchGrip.x + 40, y: touchGrip.y + touchGrip.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
    first.x -= 24;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [first] });
    await page.waitForFunction(() => document.querySelector('[data-testid="novel-task-mini-entry"]').classList.contains("is-dragging"));
    const one = await mini().boundingBox();
    const second = { id: 2, x: one.x + 110, y: first.y };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first, second] });
    second.x += 30;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [first, second] });
    const two = await mini().boundingBox(); assert.deepEqual(one, two, "Second pointer stole drag ownership");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await page.waitForFunction(() => !document.querySelector('[data-testid="novel-task-mini-entry"]').classList.contains("is-dragging"));
    assert(!await panel().isVisible());
    await mini().getByRole("button", { name: "恢复任务卡片默认位置" }).click();
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    await openPanel();
    const count = await page.locator(".react-flow__node").count(), before = await geometry();
    const rail = page.locator(".node-palette").getByRole("button", { name: /场景节点/ });
    assert(!await rail.evaluate(n => Boolean(n.closest("[inert]"))));
    await rail.click();
    await page.waitForFunction(count => document.querySelectorAll(".react-flow__node").length === count + 1, count);
    assert(await panel().isVisible(), "Nonmodal task must not close when node rail is used");
    const after = await geometry();
    for (const track of ["palette", "flow", "inspector"]) for (const field of ["x", "y", "width", "height"])
      assert(Math.abs(before[track][field] - after[track][field]) < 1);
    await closePanel();
    return { captureLoss: "PASS", singlePointer: one, extraPointer: two, before, after };
  });
  await stage("installed-slow-refresh-single-flight-and-task-controls", async () => {
    panelDelay = 1200;
    const start = report.transport.length;
    await until(() => report.transport.slice(start).filter(r => r.operation === "panel" && r.end).length >= 3,
      "Need multiple completed slow production refreshes", 16000);
    const reads = report.transport.slice(start).filter(r => r.operation === "panel" && r.end && !r.failure);
    assert(reads.length >= 3);
    assert(!reads.some((r, i) => reads.slice(i + 1).some(next => next.start < r.end)), "Polling overlapped");
    panelDelay = 0; await openPanel();
    const actions = async (label, expected) => {
      await panel().getByRole("button", { name: label, exact: true }).click(); await status(expected);
    };
    await actions("暂停", "paused"); await actions("继续", "running");
    tasks[0].job.status = "failed_partial"; await status("failed_partial");
    await actions("重试失败项", "retrying"); await actions("取消", "cancelled");
    await panel().getByRole("button", { name: "查看已完成结果", exact: true }).click();
    await panel().getByText("暂无可定位的本任务已完成节点。", { exact: true }).waitFor();
    assert.equal((await getProject(projects[0])).nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === tasks[0].job.jobId).length, 0,
      "A cancelled task without results must not select/import arbitrary nodes");
    await closePanel();
    tasks[0].job.status = "running"; await status("running");
    return { reads, operations: report.transport.filter(r => ["pause", "resume", "retry_failed_chunks", "cancel"].includes(r.operation)) };
  });
  await stage("installed-late-action-and-result-reject-A-B-A-ownership", async () => {
    const deliveries = [];
    for (const failure of [false, true]) {
      if (failure) { await home(); tasks[0].job.status = "running"; await openProject(projects[0]); await status("running"); }
      const delay = held(); if (failure) delay.error = "controlled-stale-action-error";
      holdAction = delay; await openPanel();
      const start = report.transport.length;
      await panel().getByRole("button", { name: "暂停", exact: true }).click();
      await until(() => report.transport.slice(start).some(r => r.operation === "pause" && r.held), "Expected held pause");
      await home(); await openProject(projects[1]); delay.release();
      await until(() => report.transport.slice(start).some(r => r.operation === "pause" && r.browserFinished),
        "Late pause response not completed by actual browser");
      assert.equal(await mini().getAttribute("data-job-status"), "running");
      assert((await mini().innerText()).includes("解析任务 B"));
      await openPanel();
      assert(!(await panel().innerText()).includes("controlled-stale-action-error"), "Obsolete action error leaked into B");
      await closePanel();
      deliveries.push({ failure, response: report.transport.slice(start).find(r => r.operation === "pause") });
    }
    await home(); tasks[0].job.status = "completed"; await openProject(projects[0]); await status("completed");
    const resultHold = held(); holdResult = resultHold; await openPanel();
    const resultStart = report.transport.length;
    await panel().getByRole("button", { name: "查看结果", exact: true }).click();
    await until(() => report.transport.slice(resultStart).some(r => r.operation === "results" && r.held), "Expected held results");
    await home(); await openProject(projects[1]); await home(); await openProject(projects[0]);
    resultHold.release();
    await until(() => report.transport.slice(resultStart).some(r => r.operation === "results" && r.browserFinished),
      "Late result not completed by actual browser");
    // Reopen the target after the original request's actual response; do not
    // regard the route handler's completion alone as browser state settlement.
    await openPanel();
    await panel().getByRole("button", { name: "查看结果", exact: true }).waitFor();
    await closePanel();
    const a = await getProject(projects[0]), b = await getProject(projects[1]);
    for (const p of [a, b]) assert.equal(p.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === tasks[0].job.jobId).length, 0);
    assert.equal(await panel().isVisible(), false);
    return { staleActionSuccessAndError: deliveries, staleAbaResult: "PASS" };
  });
  await stage("installed-results-failure-retry-real-navigation-idempotence-and-chapter-append", async () => {
    await page.locator('[data-workspace-surface="options"]:visible').click(); await A.settleEditor(page);
    await openPanel(); resultsFail = true;
    await panel().getByRole("button", { name: "查看结果", exact: true }).click();
    await panel().getByText("结果导入未完成，请检查错误后重试。", { exact: true }).waitFor();
    assert.equal(await page.locator('[data-workspace-surface="options"]:visible').getAttribute("aria-current"), "page");
    resultsFail = false;
    const baseline = await getProject(projects[0]);
    assert.equal(baseline.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === tasks[0].job.jobId).length, 0,
      "Late result must still be rejected after the next completed browser task roundtrip");
    const performImport = async () => {
      await panel().getByRole("button", { name: "查看结果", exact: true }).click();
      await panel().waitFor({ state: "hidden" });
      assert.equal(await page.locator('[data-workspace-surface="edit"]:visible').getAttribute("aria-current"), "page");
      await until(async () => (await getProject(projects[0])).nodes.filter(n =>
        n.data.editorMeta?.sourceProcessJobId === tasks[0].job.jobId).length === chapterCount,
      "Expected task chapter count not persisted");
      const p = await getProject(projects[0]);
      const imported = p.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === tasks[0].job.jobId);
      const selected = page.locator(`.react-flow__node[data-id="${imported.at(-1).id}"]`);
      await selected.waitFor();
      await page.waitForFunction(id => document.activeElement?.closest(".react-flow__node")?.getAttribute("data-id") === id,
        imported.at(-1).id);
      assert(await selected.evaluate(n => n.classList.contains("selected")), "Must select current task result");
      return p;
    };
    const first = await performImport();
    await page.locator('[data-workspace-surface="options"]:visible').click(); await A.settleEditor(page);
    await openPanel(); const repeat = await performImport();
    const graphIdentity = p => ({ nodes: p.nodes.map(n => n.id), edges: p.edges.map(e => e.id) });
    assert.deepEqual(graphIdentity(first), graphIdentity(repeat));
    chapterCount = 2;
    await page.locator('[data-workspace-surface="options"]:visible').click(); await A.settleEditor(page);
    await openPanel(); const appended = await performImport();
    for (const n of first.nodes) {
      const current = appended.nodes.find(c => c.id === n.id); assert(current);
      assert.deepEqual(current.data.scene, n.data.scene, "Append altered authored scene");
      assert.equal(current.data.editorMeta?.importLineId, n.data.editorMeta?.importLineId);
    }
    for (const e of first.edges) assert.deepEqual(appended.edges.find(c => c.id === e.id), e);
    assert(baseline.nodes.every(n => appended.nodes.some(c => c.id === n.id)));
    await screenshot("installed-imported-result-focused.png");
    report.importedNodes = appended.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === tasks[0].job.jobId);
    return { first: graphIdentity(first), repeated: graphIdentity(repeat), appended: graphIdentity(appended) };
  });
  await stage("installed-native-save-confirmation-priority-and-floating-focus", async () => {
    await openPanel();
    await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const dialog = page.getByTestId("project-save-confirmation");
    await dialog.waitFor();
    assert(await panel().evaluate(n => Boolean(n.closest("[inert]"))), "Task panel must yield to real confirmation");
    const modal = dialog.getByRole("dialog");
    const priority = await modal.evaluate(n => {
      const r = n.getBoundingClientRect();
      return { hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        focus: n.contains(document.activeElement), rect: r.toJSON() };
    });
    assert(priority.hit && priority.focus);
    for (const key of ["Tab", "Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      assert(await modal.evaluate(n => n.contains(document.activeElement)), "Confirmation lost keyboard ownership");
    }
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    assert(await panel().isVisible(), "Escape must close only topmost dialog");
    assert(!await panel().evaluate(n => Boolean(n.closest("[inert]"))));
    await closePanel();
    await page.waitForFunction(() => document.activeElement?.matches(".novel-task-card-open"));
    assert(fs.readdirSync(exportsDirectory).some(file => file.endsWith(".vnproj")),
      "Actual native save must write only to the isolated export directory");
    return { priority, exportDirectory: exportsDirectory, exportedFiles: fs.readdirSync(exportsDirectory) };
  });
  assert.equal(report.cases.length, currentCandidate ? 9 : 8); assert.equal(report.matrix.length, 12);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.forbiddenRequests, []);
  report.status = "PASS";
}
main().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-6000);
    await screenshot("failure.png").catch(() => {});
  }
}).finally(async () => {
  for (const release of pendingReleases) release();
  await browser?.close().catch(() => {});
  if (owner) report.cleanup.push(await owner.stop());
  if (report.cleanup.some(c => c.editor.exitCode !== 0 || c.backend.exitCode !== 0)) {
    report.status = "FAILED"; report.cleanupError = "Owned process cleanup failed"; process.exitCode = 1;
  }
  try {
    const ports = [...new Set(report.launches.flatMap(l => [l.backendPort, l.cdpPort]))];
    const listening = port => new Promise(resolve => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      const finish = value => { socket.destroy(); resolve(value); };
      socket.once("connect", () => finish(true)); socket.once("error", () => finish(false));
      socket.setTimeout(1000, () => finish(true));
    });
    await until(async () => !(await Promise.all(ports.map(listening))).some(Boolean),
      "Owned acceptance ports remain live after cleanup", 10000);
    report.portCleanup = { status: "PASS", ports };
    report.sourceUnchanged = report.checkpoint.every(item =>
      A.sha256(fs.readFileSync(path.join(root, item.file))) === item.sha256);
    assert(report.sourceUnchanged, "Product source changed during installed acceptance");
    if (currentCandidate) {
      candidateSession?.verify();
      for (const f of [...report.tools, ...(report.protectedFiles || [])])
        assert.equal(A.sha256(fs.readFileSync(f.path)), f.sha256);
    }
  } catch (error) {
    report.status = "FAILED"; report.cleanupError = String(error); process.exitCode = 1;
  }
  if (cachePrepared) {
    try { cache("Restore"); }
    catch (error) { report.status = "FAILED"; report.cacheRestoreError = String(error); process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    matrix: report.matrix.length, out, error: report.error?.slice(0, 1500), cleanup: report.cleanup }));
});
