"use strict";
// Real installed start-node authoring, native portable save, fresh import, two
// UI exports, then unchanged-card playback and Ren'Py interruption. No motion gates.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const root = path.resolve(__dirname, ".."), mode = process.argv[2], attempt = process.argv[3] || "01";
assert(["self-test", "editor", "resume", "player", "audit"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Opening-Author-1.9.35-20261102-01";
const editorOut = path.join(qa, "session-" + attempt);
const playerOut = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/opening-author-1935-" + attempt;
const out = mode === "player" ? playerOut : editorOut;
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const seedReport = "F:/AgentVN/QA/Assets-Frozen-1.9.35-20261102-01/editor-01/report.json";
const seed = read(seedReport), installed = descriptor();
assert.equal(seed.status, "PASS"); assert.equal(sha(seed.portable.path), seed.portable.sha256);
assert.equal(seed.executable.sha256, installed.executable.sha256);
const expected = { kind: "video", video_asset_id: "qa_video" };
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true]
  .map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), installation: desc(receipt),
  products: [installed.executable, ...installed.resources], source: desc(__filename), seed: desc(seedReport),
  tools: ["scripts/lib/installed-release-session.cjs", "scripts/lib/candidate-1924-opening-session.cjs",
    "scripts/installed-layout-cache-session.ps1", "scripts/lib/current-native-capture.cjs",
    "scripts/lib/wait-native-runtime-page.cjs", helper].map(f => desc(path.resolve(root, f))),
  cases: [], matrix: [], launches: [], cleanups: [], screenshots: [], cartridges: [], errors: [],
  productChanges: 0, modelRequests: 0, builds: 0,
  scope: "ACTUAL_INSTALLED_OPENING_AUTHOR_NATIVE_SAVE_REIMPORT_TWO_UI_EXPORTS_PLAYER",
  boundaries: ["Synthetic existing project imported via public API; no native import-picker claim",
    "Actual installed WebView with simulated displays; no physical4K or motion timing claim",
    "Owned teardown, not native normal close; preview consumption, not setup or Android"] };
let host, page, project, cachePrepared = false;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function stage(name, fn) {
  const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.cases.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; console.log("PASS " + name); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { c.finishedAt = new Date().toISOString(); save(); }
}
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action,
    "-RunDirectory", editorOut, "-AllowedRunRoot", qa, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function importProject(file) {
  const res = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(file)) }, body: fs.readFileSync(file),
    signal: AbortSignal.timeout(30000) });
  const body = await res.json(); assert(res.ok && body.ok); assert.equal(body.data.project_id, project.project_id);
}
async function open() {
  await page.locator('[data-help-key="home.recentProject"]:not(:disabled):visible').filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  const start = project.nodes.find(n => n.data.nodeKind === "start");
  await page.locator(`.react-flow__node[data-id="${start.id}"]`).click();
  await page.locator('[data-help-key="start.loadingAnimation"]').waitFor();
}
async function currentAnimation() {
  return page.evaluate(() => window.__AGENTVN_EDITOR_STORE__.getState().nodes.find(n => n.data.nodeKind === "start").data.loadingAnimation);
}
async function chooseVideo() {
  await page.locator('[data-help-key="start.loadingAnimation.video"]').click();
  const trigger = page.locator('[data-asset-field="loading_animation.video_asset_id"] .asset-picker-trigger');
  await trigger.scrollIntoViewIfNeeded(); await trigger.click();
  const picker = page.getByRole("dialog", { name: "开屏视频素材选择", exact: true });
  await picker.locator('[data-asset-id="qa_video"]').click();
  await picker.waitFor({ state: "detached" });
  assert((await trigger.innerText()).includes("video保留名称")); assert.deepEqual(await currentAnimation(), expected);
  return trigger;
}
async function nativeSave() {
  const downloads = "C:/Users/1/Downloads", before = new Set(fs.readdirSync(downloads));
  await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
  const confirm = page.getByTestId("project-save-confirmation"); await confirm.waitFor();
  const file = await until(() => {
    const candidates = fs.readdirSync(downloads).filter(n => n.endsWith(".vnproj") && !before.has(n));
    assert(candidates.length <= 1); return candidates.length === 1 && path.join(downloads, candidates[0]);
  }, "actual portable save");
  const z = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const p = JSON.parse(await z.file("project.json").async("string"));
  assert.equal(p.project_id, project.project_id);
  assert.deepEqual(p.nodes.find(n => n.data.nodeKind === "start").data.loadingAnimation, expected);
  assert.deepEqual(p.edges, project.edges);
  for (const node of project.nodes.filter(n => n.data.scene))
    assert.deepEqual(p.nodes.find(n => n.id === node.id).data.scene, node.data.scene);
  const retained = path.join(editorOut, "开场视频作者工程.vnproj");
  fs.copyFileSync(file, retained, fs.constants.COPYFILE_EXCL); assert.equal(sha(retained), sha(file));
  report.portable = desc(retained); assert(path.resolve(file).startsWith(path.resolve(downloads) + path.sep));
  fs.unlinkSync(file); report.downloadCleanup = { original: file, retained: report.portable, deletedUserFiles: 0 };
  await confirm.getByRole("button", { name: "OK", exact: true }).click(); return p;
}
async function setLayout(type) {
  const close = page.locator('[data-help-key="package.close"]:visible');
  if (await close.isVisible()) {
    await close.click();
    await page.locator('[data-workspace-task="publish"]:visible').waitFor({ state: "detached" });
  }
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  const b = page.locator(`[data-layout-type-option="${type}"]:visible`);
  if (await b.getAttribute("aria-pressed") !== "true") await b.click();
  await page.waitForFunction(type => document.querySelector(".runtime-layout-designer")?.dataset.layoutType === type
    && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false", type);
}
async function exportCartridge(type) {
  await setLayout(type);
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  const operation = page.getByTestId("package-environment-operation-dialog");
  await until(async () => {
    if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
    const settings = page.locator('[data-package-stage="settings"]');
    if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await settings.click(); return false; }
    return await page.locator('[data-help-key="package.mode"]').count() > 0;
  }, "publish ready", 60000);
  if (await operation.isVisible()) {
    const phase = await operation.getAttribute("data-environment-phase");
    (report.environment ??= []).push({ type, phase, text: await operation.innerText(), notWindowsBuildAcceptance: true });
    await operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
    await operation.waitFor({ state: "detached" });
  }
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  for (const [key, value] of [["gameId", project.project_id], ["title", project.title],
    ["author", project.author || "QA"], ["description", "当前安装版开场视频作者与真实消费"]])
    await page.locator(`[data-help-key="package.${key}"]`).fill(value);
  const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warnings.isVisible()) await warnings.click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await consent.isVisible()) await consent.check();
  const dir = path.join(editorOut, "cartridge-" + type); fs.mkdirSync(dir);
  await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
  const [d] = await Promise.all([page.waitForEvent("download"), page.locator('[data-help-key="package.export"]').click()]);
  assert.equal(path.basename(d.suggestedFilename()), d.suggestedFilename());
  const file = path.join(dir, d.suggestedFilename());
  await until(() => fs.existsSync(file) && !fs.existsSync(file + ".crdownload"), "actual opening UI export", 60000);
  assert.equal(await d.failure(), null);
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  assert.deepEqual(script.loading_animation, expected); assert.equal(layout.layout_type || "agentvn", type);
  const video = manifest.assets.find(a => a.asset_id === "qa_video"); assert(video);
  const bytes = await zip.file(video.path).async("nodebuffer");
  assert.equal(require("node:crypto").createHash("sha256").update(bytes).digest("hex"),
    seed.replacements.find(a => a.type === "video").newSha256);
  const card = { ...desc(file), type, opening: script.loading_animation, video: { ...video, sha256: seed.replacements.find(a => a.type === "video").newSha256 } };
  report.cartridges.push(card); await host.shot("opening-export-" + type); return card;
}
async function editor() {
  const zip = await JSZip.loadAsync(fs.readFileSync(seed.portable.path), { checkCRC32: true });
  project = JSON.parse(await zip.file("project.json").async("string"));
  assert.deepEqual(project.nodes.find(n => n.data.nodeKind === "start").data.loadingAnimation, { kind: "default" });
  cache("SelfTest"); cachePrepared = true; cache("Prepare");
  host = installedReleaseSession({ installationFile: receipt, out: editorOut, input: seed.portable.path, report, save });
  await stage("real-start-node-video-authoring-and-twelve-control-displays", async () => {
    page = await host.start(); await importProject(seed.portable.path); await page.reload(); await open();
    for (const m of matrix) {
      await host.metrics(m); await page.locator('[data-help-key="start.loadingAnimation.default"]').click();
      assert.deepEqual(await currentAnimation(), { kind: "default" });
      const selected = await chooseVideo(); await selected.focus();
      const geometry = await selected.evaluate(n => { const r = n.getBoundingClientRect(); return {
        rect: r.toJSON(), hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        focused: document.activeElement === n, overflow: document.documentElement.scrollWidth - innerWidth }; });
      assert(geometry.hit && geometry.focused && geometry.overflow <= 1 && geometry.rect.left >= 0 && geometry.rect.top >= 0
        && geometry.rect.right <= m.width + 1 && geometry.rect.bottom <= m.height + 1);
      report.matrix.push({ ...m, status: "PASS", geometry }); await host.shot(`opening-control-${m.width}-${m.dpr}-${m.reduced}`);
    }
    await host.metrics(matrix[0]); return { displays: report.matrix.length, expected };
  });
  await stage("native-project-save-and-real-host-backend-restart", async () => {
    const p = await nativeSave(); await host.stop("Actual author restart; owned teardown");
    page = await host.start(); await open(); assert.deepEqual(await currentAnimation(), expected);
    const saved = await host.api("/api/project/projects/" + project.project_id);
    assert.deepEqual(saved.nodes.find(n => n.data.nodeKind === "start").data.loadingAnimation, expected);
    return { portable: report.portable, restart: true, edgesPreserved: true, scenesPreserved: true };
  });
  await stage("fresh-database-reopen-and-two-actual-ui-exports", async () => {
    await host.stop("Fresh DB reimport"); const fresh = path.join(editorOut, "fresh"); fs.mkdirSync(fresh);
    host = installedReleaseSession({ installationFile: receipt, out: fresh, input: report.portable.path, report, save });
    page = await host.start(); await importProject(report.portable.path); await page.reload(); await open();
    assert.deepEqual(await currentAnimation(), expected);
    for (const type of ["agentvn", "renpy"]) await exportCartridge(type);
    return { freshDatabase: true, exports: report.cartridges };
  });
  assert.equal(report.cases.length, 3); assert.equal(report.matrix.length, 12); assert.equal(report.cartridges.length, 2);
}
function partialAuthor(file) {
  const previous = read(file);
  assert.equal(previous.status, "FAILED"); assert.equal(previous.cases.length, 3);
  assert(previous.cases.slice(0, 2).every(c => c.status === "PASS"));
  assert.equal(previous.cases[2].status, "FAILED");
  assert(previous.error.includes("package-workbench-header") && previous.error.includes("setLayout"));
  assert.equal(previous.matrix.length, 12); assert(previous.matrix.every(c => c.status === "PASS"));
  assert.equal(previous.cartridges.length, 1); assert.equal(previous.cartridges[0].type, "agentvn");
  assert.equal(previous.installation.sha256, report.installation.sha256);
  assert.deepEqual(previous.products, report.products); assert(!previous.cleanupError);
  for (const f of [previous.portable, previous.cartridges[0], previous.cacheRestoration, ...previous.tools]) assert.equal(sha(f.path), f.sha256);
  assert.equal(read(previous.cacheRestoration.path).status, "PASS");
  const executed = path.join(path.dirname(file), "executed.cjs");
  assert.equal(sha(executed), previous.source.sha256);
  return { previous, executed };
}
async function resume() {
  const previousAttempt = process.argv[4]; assert.match(previousAttempt || "", /^\d{2}$/); assert.notEqual(previousAttempt, attempt);
  const file = path.join(qa, "session-" + previousAttempt, "report.json");
  const { previous, executed } = partialAuthor(file);
  report.continuation = { report: desc(file), executed: desc(executed),
    completedStages: previous.cases.slice(0, 2).map(c => c.name),
    retainedMatrix: previous.matrix.length, remainingExport: "renpy", originalFailurePreserved: true };
  report.matrix = previous.matrix; report.portable = previous.portable;
  report.cartridges = previous.cartridges; report.downloadCleanup = previous.downloadCleanup;
  const zip = await JSZip.loadAsync(fs.readFileSync(report.portable.path), { checkCRC32: true });
  project = JSON.parse(await zip.file("project.json").async("string"));
  cache("SelfTest"); cachePrepared = true; cache("Prepare");
  host = installedReleaseSession({ installationFile: receipt, out: editorOut, input: report.portable.path, report, save });
  await stage("resume-only-missing-renpy-export-from-real-saved-project", async () => {
    page = await host.start(); await importProject(report.portable.path); await page.reload(); await open();
    assert.deepEqual(await currentAnimation(), expected); await exportCartridge("renpy");
    return { previous: desc(file), priorMatrixNotReplayed: true, agentvnExportNotRepeated: true, exports: report.cartridges };
  });
  assert.equal(report.cartridges.length, 2); assert.equal(report.cases.length, 1);
}
function playerFactory() {
  const filename = path.join(__dirname, "lib/candidate-1924-opening-session.cjs");
  let source = fs.readFileSync(filename, "utf8");
  const a = source.indexOf("function openingCandidateEvidence(file,out){");
  const b = source.indexOf("async function candidateOpeningSession(", a); assert(a > 0 && b > a);
  source = source.slice(0, a) + "const openingCandidateEvidence=module.qaEvidence;\n" + source.slice(b);
  source = source.replace('assert.equal(gpu.featureStatus.gpu_compositing,"enabled");', "");
  const old = 'page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri\\.localhost/.test(p.url())),"candidate opening page");';
  assert(source.includes(old)); source = source.replace(old, 'page=await require("./wait-native-runtime-page.cjs").waitNativeRuntimePage(browser);');
  new vm.Script(Module.wrap(source));
  const worker = new Module(filename, module);
  Object.assign(worker, { filename, paths: Module._nodeModulePaths(path.dirname(filename)), qaEvidence: (file, directory) => {
    assert.equal(path.resolve(file), path.resolve(receipt)); assert.equal(path.resolve(directory), path.resolve(playerOut));
    const i = descriptor(); return { executable: i.resources.find(f => path.basename(f.path) === "agentvn-player.exe"), receipt: desc(file) };
  } });
  return { source, load() { worker._compile(source, filename); return worker.exports.candidateOpeningSession; } };
}
async function player() {
  const authorFile = path.join(editorOut, "report.json"), author = read(authorFile);
  assert.equal(author.status, "PASS"); assert.equal(author.cartridges.length, 2); report.author = desc(authorFile);
  assert.equal(read(author.cacheRestoration.path).status, "PASS");
  if (author.continuation) {
    partialAuthor(author.continuation.report.path);
    assert.equal(sha(author.continuation.report.path), author.continuation.report.sha256);
    assert.equal(author.cases.length, 1); assert.equal(author.cases[0].status, "PASS");
  } else { assert.equal(author.cases.length, 3); assert(author.cases.every(c => c.status === "PASS")); }
  const priorFile = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/opening-functional-1935-01/report.json";
  const fallback = read(priorFile).fixtures.find(f => f.kind === "default" && f.layout === "renpy");
  assert(fallback); assert.equal(sha(fallback.path), fallback.sha256); report.interruptionFallback = fallback;
  for (const card of author.cartridges) { assert.equal(sha(card.path), card.sha256);
    const file = path.join(playerOut, card.type + ".vncart"); fs.copyFileSync(card.path, file, fs.constants.COPYFILE_EXCL);
    report.cartridges.push({ ...card, original: card.path, path: file }); }
  const factory = playerFactory(); fs.writeFileSync(path.join(playerOut, "session-executed.cjs"), factory.source, { flag: "wx" });
  report.executedSession = desc(path.join(playerOut, "session-executed.cjs"));
  let protectedProfile = false, session;
  function profile(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper,
      "-Action", action, "-RunDirectory", playerOut, "-CodexCacheView"],
    { encoding: "utf8", windowsHide: true, timeout: 60000 });
    fs.writeFileSync(path.join(playerOut, "profile-" + action + ".log"), r.stdout + r.stderr, { flag: "wx" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  try {
    protectedProfile = true; profile("Prepare");
    const cases = [{ type: "agentvn", reduced: false }, { type: "renpy", reduced: false },
      { type: "renpy", reduced: false, interrupt: true }, { type: "renpy", reduced: true, interrupt: true }];
    for (const c of cases) await stage(`exported-${c.type}-${c.reduced}-${c.interrupt ? "interrupt" : "complete"}`, async () => {
      const viewport = { ...matrix[0], reduced: c.reduced }, card = report.cartridges.find(f => f.type === c.type);
      const localErrors = [];
      session = await factory.load()({ installationFile: receipt, out: playerOut, report, save, viewport,
        index: report.cases.length, input: card.path });
      const p = session.page; p.setDefaultTimeout(20000); p.on("pageerror", e => localErrors.push(String(e)));
      await p.locator(".boot-card .project-entry-loader").waitFor();
      await p.evaluate(() => { window.__qaOpeningEvents = []; document.addEventListener("ended", e => {
        if (e.target instanceof HTMLVideoElement) window.__qaOpeningEvents.push({ time: e.target.currentTime });
      }, true); });
      await p.evaluate(base64 => window.postMessage({ type: "agentvn.runtime.preview", cartridgeBase64: base64,
        fileName: "ui-exported-opening.vncart", previewNonce: "actual-author-export" }, "*"), fs.readFileSync(card.path).toString("base64"));
      const video = p.locator(".custom-loading-animation video"); await video.waitFor();
      const geometry = await video.evaluate(v => ({ media: v.getBoundingClientRect().toJSON(),
        stage: v.closest('[data-testid="runtime-opening-screen"]').getBoundingClientRect().toJSON(),
        inCard: !!v.closest(".boot-card"), overflow: document.documentElement.scrollWidth - innerWidth }));
      assert(!geometry.inCard && geometry.overflow <= 1 && geometry.stage.x === 0 && geometry.stage.y === 0);
      assert(geometry.media.width >= viewport.width - 1 && geometry.media.height >= viewport.height - 1);
      await p.waitForFunction(() => document.querySelector(".custom-loading-animation video")?.currentTime > .1);
      const playing = await video.evaluate(v => ({ time: v.currentTime, duration: v.duration, paused: v.paused }));
      assert(!playing.paused && playing.duration > 1);
      await p.keyboard.press("Tab"); await p.keyboard.press("Enter");
      const input = await p.evaluate(() => ({ focused: document.activeElement === document.querySelector('[data-testid="runtime-opening-screen"]'),
        backgroundInert: document.querySelector(".runtime-boot-content")?.inert }));
      assert(input.focused && input.backgroundInert); assert.equal(await p.getByTestId("game-state-playing").count(), 0);
      if (c.interrupt) {
        await video.evaluate(v => { window.__qaAbandonedOpening = v; });
        await p.evaluate(base64 => window.postMessage({ type: "agentvn.runtime.preview", cartridgeBase64: base64,
          fileName: "default-replacement.vncart", previewNonce: "interrupt-author-export" }, "*"), fs.readFileSync(fallback.path).toString("base64"));
      }
      report.screenshots.push(await session.shot(path.join(playerOut, `${c.type}-${c.reduced}-${!!c.interrupt}.png`)));
      await p.getByTestId("runtime-opening-screen").waitFor({ state: "detached" });
      const events = await p.evaluate(() => window.__qaOpeningEvents);
      assert.equal(events.length, c.interrupt ? 0 : 1);
      if (c.interrupt) assert(await p.evaluate(() => window.__qaAbandonedOpening.paused && !window.__qaAbandonedOpening.hasAttribute("src")));
      await p.locator(".boot-overlay").waitFor({ state: "detached" });
      await p.getByTestId("start-new-game").click(); await p.getByTestId("game-state-playing").waitFor();
      await p.locator(".dialog-text").waitFor(); assert.deepEqual(localErrors, []);
      await session.close(); session = undefined;
      return { ...c, cartridge: desc(card.path), geometry, input, playing, events, reachedStory: true };
    });
  } finally {
    await session?.close();
    if (protectedProfile && fs.existsSync(path.join(playerOut, "profile-protection.json"))) {
      profile("Restore"); report.profileRestoration = desc(path.join(playerOut, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.path).status, "PASS");
    }
  }
}
function audit() {
  const aFile = path.join(editorOut, "report.json"), pFile = path.join(playerOut, "report.json");
  const a = read(aFile), p = read(pFile); assert.equal(a.status, "PASS"); assert.equal(p.status, "PASS");
  let prior;
  if (a.continuation) {
    assert.equal(sha(a.continuation.report.path), a.continuation.report.sha256);
    assert.equal(sha(a.continuation.executed.path), a.continuation.executed.sha256);
    prior = partialAuthor(a.continuation.report.path).previous; assert.equal(a.cases.length, 1);
    assert.deepEqual(a.matrix, prior.matrix);
  } else assert.equal(a.cases.length, 3);
  assert.equal(a.matrix.length, 12); assert.equal(p.cases.length, 4);
  assert.equal(p.author.sha256, sha(aFile)); assert(a.cases.every(c => c.status === "PASS") && p.cases.every(c => c.status === "PASS"));
  for (const r of [a, p]) for (const f of [r.source, r.installation, ...r.products, ...r.tools, ...r.cartridges])
    assert.equal(sha(f.path), f.sha256);
  const screenshots = [...(prior?.screenshots || []), ...a.screenshots, ...p.screenshots];
  for (const s of screenshots) { const b = fs.readFileSync(s.path); assert.equal(sha(s.path), s.sha256);
    assert.equal(b.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
    assert.equal(b.readUInt32BE(20), Math.round(s.before.height * s.before.dpr)); assert.deepEqual(s.before, s.after); }
  for (const f of [a.portable, a.cacheRestoration, p.profileRestoration, p.executedSession, p.interruptionFallback])
    assert.equal(sha(f.path), f.sha256);
  assert.equal(read(a.cacheRestoration.path).status, "PASS"); assert.equal(read(p.profileRestoration.path).status, "PASS");
  assert(a.cleanups.every(c => c.status === "PASS")); assert(p.launches.every(l => l.cleanup.status === "PASS"));
  const owned = [...(prior?.knownProcesses || []), ...a.knownProcesses, ...p.launches.flatMap(l => l.knownProcesses)];
  assert(!rows().some(n => owned.some(o => o.ProcessId === n.ProcessId && o.Created === n.Created)));
  const ports = [...(prior?.launches || []).flatMap(l => l.ports), ...a.launches.flatMap(l => l.ports), ...p.launches.map(l => l.port)];
  assert.equal(listeners(ports).length, 0); assert(!fs.existsSync(a.downloadCleanup.original));
  const result = { status: "PASS", at: new Date().toISOString(), author: desc(aFile), player: desc(pFile),
    authorStages: a.cases.length + (prior ? 2 : 0), displays: a.matrix.length, playerCases: p.cases.length,
    originalPartial: a.continuation?.report, screenshots: screenshots.length, ownedIdentities: owned.length, ports: ports.length,
    productChanges: 0, modelRequests: 0, builds: 0 };
  fs.writeFileSync(path.join(qa, "audit-" + attempt + ".json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result));
}
(async () => {
  if (mode === "self-test") {
    const zip = await JSZip.loadAsync(fs.readFileSync(seed.portable.path), { checkCRC32: true });
    const p = JSON.parse(await zip.file("project.json").async("string"));
    assert(p.nodes.find(n => n.data.nodeKind === "start")); assert(p.asset_manifest.find(a => a.asset_id === "qa_video"));
    playerFactory(); assert.equal(matrix.length, 12);
    console.log(JSON.stringify({ status: "PASS", starts: 0, source: desc(__filename), fixture: seed.portable })); return;
  }
  if (mode === "audit") return audit();
  assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL); save();
  try { await (mode === "editor" ? editor() : mode === "resume" ? resume() : player()); report.status = "PASS"; }
  catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (host && page && !page.isClosed()) { report.failureText = await page.locator("body").innerText().catch(String);
      await host.shot("opening-author-failure").catch(() => {}); } }
  finally {
    try { await host?.stop("Final owned author cleanup");
      if (cachePrepared) { cache("Restore"); report.cacheRestoration = desc(path.join(editorOut, "native-cache-restoration.json")); }
      for (const f of report.products) assert.equal(sha(f.path), f.sha256);
      assert.equal(sha(__filename), report.source.sha256);
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, mode, out, cases: report.cases.length, error: report.error, cleanupError: report.cleanupError }));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
