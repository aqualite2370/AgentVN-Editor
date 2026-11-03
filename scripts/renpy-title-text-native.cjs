"use strict";
// Native Dev or an explicitly sealed installation, with the same real UI assertions.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const { nativeSession, until, rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2], buildAttempt = process.argv[3];
assert.match(attempt, /^\d{2}$/); assert.match(buildAttempt, /^\d{2}$/);
const installationFile = process.argv.find(a => a.startsWith("--installed="))?.slice("--installed=".length);
if (installationFile) assert.equal(path.resolve(installationFile),
  path.resolve("F:/AgentVN/QA/Editor-Repair-Release-20261024-01/installation.json"));
const base = "F:/AgentVN/QA/Renpy-Title-Text-20261024-01", out = installationFile
  ? path.join("F:/AgentVN/QA/Editor-Repair-Release-20261024-01", `title-native-${attempt}`)
  : path.join(base, `native-${attempt}`);
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const buildFile = installationFile || path.join(base, `build-${buildAttempt}/report.json`), build = read(buildFile);
assert.equal(build.status, "PASS");
function verifyBuild() {
  if (installationFile) {
    assert.equal(build.metadataRestoration, "PASS"); assert.equal(build.executable.version, "1.9.23");
    for (const p of [build.executable, ...build.resources]) assert.equal(sha(p.path), p.sha256);
  } else {
    for (const p of [build.dev, build.preview, ...build.bundled, ...build.frozenProducts])
      assert.equal(sha(p.path), p.sha256);
    for (const s of build.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
  }
}
verifyBuild();
const priorFile = path.join(base, "green-06/1920x1080-dpr2-reduced/report.json"), prior = read(priorFile);
assert.equal(prior.status, "PASS"); assert.equal(sha(prior.portable.path), prior.portable.sha256);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const executed = fs.readFileSync(__filename), toolHash = createHash("sha256").update(executed).digest("hex");
const dependencies = ["scripts/lib/current-native-editor-session.cjs", "scripts/lib/installed-acceptance.cjs",
  "scripts/lib/installed-release-session.cjs", "scripts/lib/current-native-capture.cjs",
  "scripts/lib/owned-process-tree.cjs"].map(file => ({ file, sha256: sha(path.join(root, file)) }));
const r = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: installationFile ? "ACTUAL_INSTALLED_1_9_23_EDITOR_AND_BUNDLED_IFRAME_NOT_STANDALONE_OR_ANDROID"
    : "NATIVE_DEV_EDITOR_BUNDLED_IFRAME_NOT_RELEASE_INSTALLATION_OR_ANDROID",
  boundaries: ["Explicit isolated DB and WebView", "Real WebView CDP viewport/input, not physical 4K",
    installationFile ? "Restart uses owned termination; final normal close has a separate Computer Use receipt"
      : "Owned forced cleanup, not normal-close acceptance",
    "Public backend import prepares fixture; not native file picker acceptance"],
  build: { path: buildFile, sha256: sha(buildFile) }, input: prior.portable,
  tool: { path: __filename, sha256: toolHash }, dependencies, cases: [], matrix: [],
  launches: [], known: [], cleanups: [], screenshots: [], errors: [], modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
const session = installationFile
  ? installedReleaseSession({ installationFile, out, input: prior.portable.path, report: r, save })
  : nativeSession({ out, input: prior.portable.path, report: r, save });
let page;
async function step(name, fn) {
  const c = { name, status: "RUNNING" }; r.cases.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { save(); console.log(JSON.stringify({ name, status: c.status })); }
}
async function openLayout() {
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
  await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_hero"]').click();
}
async function openRecent() {
  await page.locator(".project-home").waitFor();
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: r.fixtureSetup.title }).click();
}
async function actualFrame() {
  const button = page.getByTestId("renpy-title-runtime-preview-toggle");
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
  return page.frameLocator(".renpy-editor-runtime-viewport iframe");
}
async function content(frame, title, version) {
  await frame.locator(".renpy-title-view").waitFor();
  if (title === undefined) assert.equal(await frame.locator(".renpy-title-heading h1").count(), 0);
  else assert.equal(await frame.locator(".renpy-title-heading h1").innerText(), title);
  if (version === undefined) assert.equal(await frame.locator(".renpy-title-heading p").count(), 0);
  else assert.equal(await frame.locator(".renpy-title-heading p").innerText(), version);
  assert.equal(await frame.getByTestId("open-help").innerText(), "操作说明");
}
async function saveLayout() {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
}
(async () => {
  try {
    save(); page = await session.start();
    await step("Public API fixture import followed by native recent-project UI and bundled Runtime", async () => {
      const zip = await JSZip.loadAsync(fs.readFileSync(prior.portable.path), { checkCRC32: true });
      const project = JSON.parse(await zip.file("project.json").async("string"));
      const imported = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": "title-text.vnproj" },
        body: fs.readFileSync(prior.portable.path), signal: AbortSignal.timeout(30000) });
      assert(imported.ok && (await imported.json()).ok);
      const stored = (await (installationFile ? session.rawApi(`/api/project/projects/${project.project_id}`)
        : session.api(`/api/project/projects/${project.project_id}`))).data;
      assert.deepEqual(stored.editor_settings.runtimeUILayout.renpyTitleText, prior.portable.expected);
      r.fixtureSetup = { method: "PUBLIC_BACKEND_IMPORT", projectId: project.project_id,
        title: project.title, inputSha256: prior.portable.sha256,
        savedTitleText: stored.editor_settings.runtimeUILayout.renpyTitleText };
      save(); await page.reload();
      await openRecent();
      await openLayout(); const frame = await actualFrame();
      await content(frame, undefined, "特别版 · 第一卷");
      const g = await page.getByRole("checkbox", { name: "显示标题", exact: true }).evaluate(n => n.getBoundingClientRect().toJSON());
      assert.equal(g.width, 16); assert.equal(g.height, 16); return { checkbox: g };
    });
    await step("Native live edits independently update title and version without losing retained wording", async () => {
      await page.getByRole("checkbox", { name: "显示标题", exact: true }).check();
      await content(await actualFrame(), "标题显隐隔离工程", "特别版 · 第一卷");
      await page.getByRole("checkbox", { name: "显示版本", exact: true }).uncheck();
      await content(await actualFrame(), "标题显隐隔离工程", undefined);
      await page.getByRole("checkbox", { name: "显示标题", exact: true }).uncheck();
      await content(await actualFrame(), undefined, undefined);
      await page.getByRole("checkbox", { name: "显示版本", exact: true }).check();
      await content(await actualFrame(), undefined, "特别版 · 第一卷"); await saveLayout();
    });
    await step("Native reload retains authoring settings and the actual Runtime preview", async () => {
      await page.reload(); await openRecent();
      await openLayout(); await content(await actualFrame(), undefined, "特别版 · 第一卷");
    });
    await step("New native Editor process restores the saved project and actual preview across the display matrix", async () => {
      await session.stop("Restart isolation test; forced owned termination, not normal close");
      page = await session.start();
      await openRecent();
      await openLayout();
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
        for (const dpr of [1, 2]) for (const reduced of [false, true]) {
          const v = { width, height, dpr, reduced }; await session.metrics(v); await settleEditor(page);
          await content(await actualFrame(), undefined, "特别版 · 第一卷");
          const g = await page.locator(".renpy-editor-runtime-viewport iframe").evaluate(n => {
            const b = n.getBoundingClientRect(), p = n.parentElement.getBoundingClientRect();
            return { frame: b.toJSON(), container: p.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth };
          });
          assert(g.overflow <= 1 && g.frame.width > 0 && g.frame.height > 0);
          assert(g.frame.left >= g.container.left - 1 && g.frame.top >= g.container.top - 1
            && g.frame.right <= g.container.right + 1 && g.frame.bottom <= g.container.bottom + 1);
          const shot = await session.shot(`${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}`);
          r.matrix.push({ viewport: v, status: "PASS", geometry: g, screenshot: shot.path }); save();
        }
      assert.equal(r.matrix.length, 12);
    });
    if (installationFile) {
      const request = { requestId: require("node:crypto").randomUUID(), ownerPid: session.current.pid,
        completion: path.join(out, "normal-close-input.json"), requestedAt: new Date().toISOString() };
      r.nativeClose = { status: "WAIT_COMPUTER_USE", request }; save();
      fs.writeFileSync(path.join(out, "input-request.json"), JSON.stringify(request, null, 2), { flag: "wx" });
      console.log("WAIT_COMPUTER_USE_NORMAL_CLOSE " + JSON.stringify(request));
      await until(() => fs.existsSync(request.completion), "installed title final native close input", 240000);
      const receipt = read(request.completion);
      assert.equal(receipt.status, "INPUT_COMPLETED"); assert.equal(receipt.requestId, request.requestId);
      assert.equal(receipt.ownerPid, request.ownerPid); assert(receipt.interaction.includes("Computer Use"));
      r.nativeClose = { status: "INPUT_DELIVERED", request, receipt }; save();
      const launch = session.current;
      await until(() => !rows().some(p => p.ProcessId === launch.pid && p.Created === launch.created)
        && listeners(launch.ports).length === 0, "installed title host/backend normal close", 30000);
      await session.stop("Computer Use normal close after installed title matrix");
      assert.deepEqual(r.cleanups.at(-1).killed, []);
      r.nativeClose = { status: "PASS", request, receipt, forcedTermination: false }; save();
    }
    assert.deepEqual(r.errors, []); r.status = "PASS";
  } catch (e) {
    r.status = r.nativeClose?.status === "WAIT_COMPUTER_USE" ? "BLOCKED_INPUT_HANDOFF" : "FAILED";
    r.error = String(e.stack || e); process.exitCode = 1;
    await session.shot("failure").catch(error => { r.captureError = String(error); });
  } finally {
    try {
      await session.stop("Terminal owned cleanup");
      assert.equal(r.cleanups.length, r.launches.length);
      assert(r.cleanups.every(c => installationFile ? c.status === "PASS"
        : c.survivors.length === 0 && c.listeners.length === 0));
      assert.equal(sha(__filename), toolHash);
      for (const d of dependencies) assert.equal(sha(path.join(root, d.file)), d.sha256);
      verifyBuild();
    } catch (e) { r.status = "FAILED"; r.cleanupError = String(e.stack || e); process.exitCode = 1; }
    fs.writeFileSync(path.join(out, "executed.cjs"), executed, { flag: "wx" });
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error, cleanupError: r.cleanupError }));
  }
})();
