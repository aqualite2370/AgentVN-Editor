"use strict";
// Current installed authoring -> portable/restart -> public reimport -> UI export
// -> the very same installed Player. No product writes or model calls.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until, rows } = require("./lib/current-native-editor-session.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Title-Text-1.9.35-20261102-01";
const runtimeRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01";
const attempt = process.argv[3] || "01";
assert.match(attempt, /^\d{2}$/);
const playerOut = path.join(runtimeRoot, "title-text-1935-" + attempt);
const profileHelper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const priorFile = "F:/AgentVN/QA/Renpy-Title-Text-20261024-01/green-06/1920x1080-dpr2-reduced/report.json";
const root = path.resolve(__dirname, ".."), out = path.join(qa, "editor-" + attempt);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true]
  .map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const expected = { title: { visible: false, text: "保留但隐藏的自定义标题" }, version: { text: "本轮特别版 · 第二卷" } };
const prior = read(priorFile), installed = descriptor();
assert.equal(prior.status, "PASS"); assert.equal(sha(prior.portable.path), prior.portable.sha256);
assert.deepEqual(read(receipt).executable, installed.executable);
const mode = process.argv[2]; assert(["self-test", "editor", "player"].includes(mode));
let host, page, cachePrepared = false, beforeAgent, project, portable, cartridge;
const report = { status: "RUNNING", startedAt: new Date().toISOString(), modelRequests: 0, productChanges: 0, builds: 0,
  source: desc(__filename), installation: desc(receipt), products: [installed.executable, ...installed.resources],
  tools: ["scripts/lib/installed-release-session.cjs", "scripts/lib/current-native-capture.cjs",
    "scripts/lib/candidate-1924-opening-session.cjs", "scripts/lib/wait-native-runtime-page.cjs",
    "scripts/installed-layout-cache-session.ps1", profileHelper].map(f => desc(path.resolve(root, f))),
  input: prior.portable, cases: [], matrix: [], launches: [], cleanups: [], errors: [], screenshots: [],
  scope: "ACTUAL_INSTALLED_TITLE_TEXT_AUTHOR_NATIVE_PORTABLE_EXPORT_PLAYER_NO_MODEL",
  boundaries: ["Synthetic preexisting portable imported with public backend API, not native picker",
    "Isolated DB/WebView and owned termination, not default-account migration or normal close",
    "Emulated WebView display matrix, not physical4K; no motion timing assertions",
    "Player is installed preview mode, not standalone/setup, Android or real model"] };
const save = () => fs.writeFileSync(path.join(mode === "player" ? playerOut : out, "report.json"), JSON.stringify(report, null, 2));
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
    "-AllowedRunRoot", qa, "-CodexCacheView"], { windowsHide: true, encoding: "utf8", timeout: 60000,
    env: { ...process.env, AGENTVN_INSTALLED_GUI_QA_ROOT: qa } });
  (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function stage(name, fn) {
  const c = { name, status: "RUNNING" }; report.cases.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; console.log("PASS " + name); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { save(); }
}
async function importProject(file) {
  const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, { method: "POST",
    headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(file)) },
    body: fs.readFileSync(file), signal: AbortSignal.timeout(30000) });
  const p = await r.json(); assert(r.ok && p.ok); assert.equal(p.data.project_id, project.project_id);
}
async function open() {
  await page.locator('[data-help-key="home.recentProject"]:not(:disabled):visible').filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await page.getByTestId("renpy-title-editor").waitFor();
  await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_hero"]').click();
}
async function frame() {
  const toggle = page.getByTestId("renpy-title-runtime-preview-toggle");
  if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
  await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
  return page.frameLocator(".renpy-editor-runtime-viewport iframe");
}
async function content(target, title, version) {
  await target.locator(".renpy-title-view").waitFor();
  for (const [selector, text] of [["h1", title], ["p", version]]) {
    const n = target.locator(".renpy-title-heading " + selector);
    if (text === undefined) await until(async () => await n.count() === 0, "hidden title text " + selector);
    else await until(async () => await n.count() === 1 && await n.innerText() === text, "exact title text " + selector);
  }
  assert.equal(await target.getByTestId("open-help").innerText(), "操作说明");
}
async function savedSettings() {
  return (await host.api(`/api/project/projects/${project.project_id}`)).editor_settings;
}
async function layoutSave() {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
}
async function editor() {
  assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
  save(); cache("SelfTest"); cachePrepared = true; cache("Prepare");
  const z = await JSZip.loadAsync(fs.readFileSync(prior.portable.path), { checkCRC32: true });
  project = JSON.parse(await z.file("project.json").async("string"));
  host = installedReleaseSession({ installationFile: receipt, out, input: prior.portable.path, report, save });
  await stage("current-installed-public-import-and-independent-title-version-authoring", async () => {
    page = await host.start(); await importProject(prior.portable.path); await page.reload(); await open();
    beforeAgent = structuredClone((await savedSettings()).runtimeUILayoutProfiles?.profiles?.agentvn);
    assert(beforeAgent && Array.isArray(beforeAgent.screens), "Other layout must exist; undefined cannot prove isolation");
    await content(await frame(), undefined, "特别版 · 第一卷");
    const visibleTitle = page.getByRole("checkbox", { name: "显示标题", exact: true });
    const visibleVersion = page.getByRole("checkbox", { name: "显示版本", exact: true });
    await visibleTitle.check(); await content(await frame(), project.title, "特别版 · 第一卷");
    await visibleVersion.uncheck(); await content(await frame(), project.title, undefined);
    await visibleVersion.check();
    await page.getByRole("button", { name: "自定义标题文字", exact: true }).click();
    await page.getByRole("textbox", { name: "标题文字", exact: true }).fill("保留但隐藏的自定义标题");
    await content(await frame(), "保留但隐藏的自定义标题", "特别版 · 第一卷");
    await page.getByRole("button", { name: "恢复标题工程继承", exact: true }).click();
    await content(await frame(), project.title, "特别版 · 第一卷");
    await page.getByRole("button", { name: "自定义标题文字", exact: true }).click();
    await page.getByRole("textbox", { name: "标题文字", exact: true }).fill(expected.title.text);
    await page.getByRole("textbox", { name: "版本文字", exact: true }).fill("");
    await content(await frame(), "保留但隐藏的自定义标题", undefined);
    await page.getByRole("button", { name: "恢复版本工程继承", exact: true }).click();
    assert.equal(await page.getByTestId("renpy-version-text-source").innerText(), "继承工程信息");
    const inherited = await (await frame()).locator(".renpy-title-heading p").innerText();
    assert(inherited.length > 0 && inherited !== "特别版 · 第一卷");
    await page.getByRole("button", { name: "自定义版本文字", exact: true }).click();
    await page.getByRole("textbox", { name: "版本文字", exact: true }).fill(expected.version.text);
    await visibleTitle.uncheck(); await content(await frame(), undefined, expected.version.text);
    await visibleTitle.check(); await content(await frame(), expected.title.text, expected.version.text);
    await visibleTitle.uncheck(); await layoutSave();
    const s = await savedSettings(); assert.deepEqual(s.runtimeUILayout.renpyTitleText, expected);
    assert.deepEqual(s.runtimeUILayoutProfiles?.profiles?.agentvn, beforeAgent);
    return { customTitlePreservedWhenHidden: true, emptyVersionHidden: true, independentVersion: true,
      restoredInheritedVersion: inherited, agentProfileUnchanged: true };
  });
  await stage("real-process-restart-and-twelve-editor-preview-displays", async () => {
    await host.stop("Owned restart, not normal close"); page = await host.start(); await open();
    assert.deepEqual((await savedSettings()).runtimeUILayout.renpyTitleText, expected);
    for (const m of matrix) {
      await host.metrics(m); await content(await frame(), undefined, expected.version.text);
      const control = page.getByRole("checkbox", { name: "显示标题", exact: true });
      await control.scrollIntoViewIfNeeded(); await control.focus();
      const geometry = await control.evaluate(n => {
        const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { box: r.toJSON(), width: innerWidth, height: innerHeight,
          focused: n === document.activeElement, hit: hit === n || n.contains(hit),
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(geometry.focused && geometry.hit && geometry.overflow <= 1 && geometry.box.left >= 0
        && geometry.box.top >= 0 && geometry.box.right <= m.width + 1 && geometry.box.bottom <= m.height + 1);
      await control.check(); await content(await frame(), expected.title.text, expected.version.text);
      await control.uncheck(); await content(await frame(), undefined, expected.version.text);
      report.matrix.push({ ...m, status: "PASS", geometry }); await host.shot(`title-${m.width}-${m.dpr}-${m.reduced}`);
    }
    await host.metrics(matrix[0]); await layoutSave();
    return { displays: report.matrix.length, trueRestart: true, clicksPerDisplay: 2 };
  });
  await stage("native-portable-save-fresh-database-reimport-and-real-ui-export", async () => {
    const downloads = "C:/Users/1/Downloads", before = new Set(fs.readdirSync(downloads));
    await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const confirmation = page.getByTestId("project-save-confirmation"); await confirmation.waitFor();
    const file = await until(() => {
      const n = fs.readdirSync(downloads).filter(n => n.endsWith(".vnproj") && !before.has(n));
      assert(n.length <= 1); return n.length === 1 && path.join(downloads, n[0]);
    }, "actual title portable download");
    const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
    const p = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(p.project_id, project.project_id); assert.deepEqual(p.editor_settings.runtimeUILayout.renpyTitleText, expected);
    assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles?.profiles?.agentvn, beforeAgent);
    const target = path.join(out, "标题文字保存后的工程.vnproj");
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); assert.equal(sha(target), sha(file));
    portable = desc(target); report.portable = portable;
    assert(path.resolve(file).startsWith(path.resolve(downloads) + path.sep));
    fs.unlinkSync(file); report.downloadCleanup = { deleted: desc(target), original: file, userFilesDeleted: 0 };
    await confirmation.getByRole("button", { name: "OK", exact: true }).click();
    await host.stop("Before fresh database portable reimport");
    const fresh = path.join(out, "fresh"); fs.mkdirSync(fresh);
    host = installedReleaseSession({ installationFile: receipt, out: fresh, input: target, report, save });
    page = await host.start(); await importProject(target); await page.reload(); await open();
    await content(await frame(), undefined, expected.version.text);
    assert.deepEqual((await savedSettings()).runtimeUILayout.renpyTitleText, expected);
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
    const operation = page.getByTestId("package-environment-operation-dialog");
    await until(async () => {
      if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
      const settings = page.locator('[data-package-stage="settings"]');
      if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await settings.click(); return false; }
      return await page.locator('[data-help-key="package.mode"]').count() > 0;
    }, "publish environment terminal or settings", 60000);
    if (await operation.isVisible()) {
      const phase = await operation.getAttribute("data-environment-phase");
      report.environment = { phase, text: await operation.innerText(), notNormalWindowsEnvironmentAcceptance: true };
      await operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
      await operation.waitFor({ state: "detached" });
    }
    await page.locator('[data-package-stage="settings"]').click();
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    for (const [key, value] of [["gameId", project.project_id], ["title", project.title],
      ["author", project.author || "QA"], ["description", "本轮标题文字显隐、保留与导出验收"]])
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warnings.isVisible()) await warnings.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]');
    if (await consent.isVisible()) await consent.check();
    const dir = path.join(out, "cartridge"); fs.mkdirSync(dir);
    await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
    const [d] = await Promise.all([page.waitForEvent("download"), page.locator('[data-help-key="package.export"]').click()]);
    assert.equal(path.basename(d.suggestedFilename()), d.suggestedFilename());
    const card = path.join(dir, d.suggestedFilename());
    await until(() => fs.existsSync(card) && !fs.existsSync(card + ".crdownload"), "exported title cartridge", 60000);
    assert.equal(await d.failure(), null);
    const c = await JSZip.loadAsync(fs.readFileSync(card), { checkCRC32: true });
    const layout = JSON.parse(await c.file("ui/layout.json").async("string"));
    assert.deepEqual(layout.renpyTitleText, expected);
    assert.deepEqual(layout, (await savedSettings()).runtimeUILayout);
    cartridge = { ...desc(card), layout, manifest: JSON.parse(await c.file("manifest.json").async("string")) };
    report.cartridge = cartridge; await host.shot("title-text-ui-export-complete");
    return { portable, cartridge, freshDatabase: true };
  });
  assert.equal(report.cases.length, 3); assert.equal(report.matrix.length, 12); assert.deepEqual(report.errors, []);
}
function playerSessionFactory() {
  const filename = path.join(__dirname, "lib/candidate-1924-opening-session.cjs");
  let source = fs.readFileSync(filename, "utf8");
  const a = source.indexOf("function openingCandidateEvidence(file,out){");
  const b = source.indexOf("async function candidateOpeningSession(", a); assert(a > 0 && b > a);
  source = source.slice(0, a) + "const openingCandidateEvidence = module.qaEvidence;\n" + source.slice(b);
  assert(source.includes('spawn(executable.path,["--mode","preview"],'));
  source = source.replace('spawn(executable.path,["--mode","preview"],', 'spawn(executable.path,["--mode","preview","--cartridge",input],');
  source = source.replace('assert.equal(gpu.featureStatus.gpu_compositing,"enabled");', '');
  const oldPage = 'page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri\\.localhost/.test(p.url())),"candidate opening page");';
  assert(source.includes(oldPage));
  source = source.replace(oldPage,
    'page=await require("./wait-native-runtime-page.cjs").waitNativeRuntimePage(browser);');
  new (require("node:vm").Script)(Module.wrap(source));
  const m = new Module(filename, module); Object.assign(m, { filename, paths: Module._nodeModulePaths(path.dirname(filename)),
    qaEvidence: (f, dir) => {
      assert.equal(path.resolve(f), path.resolve(receipt)); assert.equal(path.resolve(dir), path.resolve(playerOut));
      const i = descriptor(); return { executable: i.resources.find(p => path.basename(p.path) === "agentvn-player.exe"), receipt: desc(f) };
    } });
  return { filename, source, load() { m._compile(source, filename); return m.exports.candidateOpeningSession; } };
}
async function player() {
  const author = read(path.join(out, "report.json")); assert.equal(author.status, "PASS");
  assert.equal(author.cases.length, 3); assert.equal(author.matrix.length, 12);
  assert.equal(sha(author.cartridge.path), author.cartridge.sha256); assert.equal(sha(author.portable.path), author.portable.sha256);
  assert(!fs.existsSync(playerOut)); fs.mkdirSync(playerOut);
  Object.assign(report, { scope: "ACTUAL_INSTALLED_PLAYER_UI_EXPORTED_TITLE_TEXT_PREVIEW",
    authorReport: desc(path.join(out, "report.json")), cartridge: author.cartridge, portable: author.portable });
  const card = path.join(playerOut, path.basename(author.cartridge.path));
  fs.copyFileSync(author.cartridge.path, card, fs.constants.COPYFILE_EXCL);
  const adapter = playerSessionFactory(); fs.writeFileSync(path.join(playerOut, "session-executed.cjs"), adapter.source, { flag: "wx" });
  report.sessionAdapter = { original: desc(adapter.filename), executed: desc(path.join(playerOut, "session-executed.cjs")),
    substitutions: ["Current installation evidence", "--cartridge actual exported file",
      "Record GPU without functional performance gate", "Wait for actual runtime document"] };
  const profile = action => {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", profileHelper,
      "-Action", action, "-RunDirectory", playerOut, "-CodexCacheView"],
    { encoding: "utf8", windowsHide: true, timeout: 60000 });
    fs.writeFileSync(path.join(playerOut, `profile-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  };
  let s, protectedProfile = false;
  try {
    save(); protectedProfile = true; profile("Prepare");
    s = await adapter.load()({ installationFile: receipt, out: playerOut, report, save, viewport: matrix[0], index: 1, input: card });
    page = s.page; page.setDefaultTimeout(30000);
    page.on("pageerror", e => { report.errors.push(String(e)); save(); });
    const cdp = await page.context().newCDPSession(page);
    for (const v of matrix) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: v.reduced ? "reduce" : "no-preference" });
      await content(page, undefined, expected.version.text);
      await page.getByTestId("start-new-game").click({ trial: true });
      const g = await page.locator(".renpy-title-heading").evaluate(n => {
        const r = n.getBoundingClientRect();
        return { box: r.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(g.overflow <= 1 && g.box.left >= 0 && g.box.top >= 0 && g.box.right <= v.width + 1 && g.box.bottom <= v.height + 1);
      const shot = await require("./lib/current-native-capture.cjs").captureInstalledWebview(page, cdp,
        path.join(playerOut, `title-${v.width}-${v.dpr}-${v.reduced}.png`), v);
      report.screenshots.push(shot); report.matrix.push({ ...v, status: "PASS", geometry: g }); save();
    }
    await page.getByTestId("open-help").click(); await page.getByTestId("help-screen").waitFor();
    await page.getByTestId("renpy-menu-return").click(); await content(page, undefined, expected.version.text);
    await page.getByTestId("start-new-game").click(); await page.getByTestId("game-state-playing").waitFor();
    await page.locator(".dialog-text").waitFor(); report.storyText = await page.locator(".dialog-text").innerText();
    assert(report.storyText.length > 0); assert.deepEqual(report.errors, []);
    assert.equal(report.matrix.length, 12);
  } finally {
    await s?.close();
    if (protectedProfile && fs.existsSync(path.join(playerOut, "profile-protection.json"))) {
      profile("Restore"); report.profileRestoration = desc(path.join(playerOut, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.path).status, "PASS");
    }
  }
}
async function main() {
  if (mode === "self-test") {
    const z = await JSZip.loadAsync(fs.readFileSync(prior.portable.path), { checkCRC32: true });
    const p = JSON.parse(await z.file("project.json").async("string"));
    assert.deepEqual(p.editor_settings.runtimeUILayout.renpyTitleText, prior.portable.expected);
    assert.equal(matrix.length, 12); playerSessionFactory();
    console.log(JSON.stringify({ status: "PASS", fixture: prior.portable.sha256,
      editor: installed.executable.sha256, matrix: matrix.length, nativeStarts: 0 })); return;
  }
  assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  try {
    await (mode === "editor" ? editor() : player()); report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = await page.locator("body").innerText().catch(String);
      if (host) await host.shot("title-failure").catch(() => {});
    }
  } finally {
    try {
      await host?.stop("Final owned title acceptance cleanup");
      if (cachePrepared) { cache("Restore"); report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
        assert.equal(read(report.cacheRestoration.path).status, "PASS"); }
      for (const f of report.products) assert.equal(sha(f.path), f.sha256);
      for (const f of report.tools) assert.equal(sha(f.path), f.sha256);
      assert.equal(sha(report.source.path), report.source.sha256);
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, mode, cases: report.cases.length, matrix: report.matrix.length,
      error: report.error, cleanupError: report.cleanupError }));
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
