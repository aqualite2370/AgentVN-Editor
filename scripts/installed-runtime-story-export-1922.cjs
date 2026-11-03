"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
async function validateCartridge(file, fixture, layout) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
  assert.equal(manifest.game_id, fixture.projectId); assert.equal(skin.layout_type || "agentvn", layout);
  assert.equal(script.default_dialog_presentation, "nvl");
  assert.equal(script.characters.find(c => c.character_id === "alice").dialog_presentation, "bubble");
  assert.equal(script.characters.find(c => c.character_id === "nvl_person").dialog_presentation, "nvl");
  assert.equal(script.entry_scene_id, "ordinary_nvl");
  const ordinary = script.scenes.find(s => s.scene_id === "ordinary_nvl");
  assert.equal(ordinary.commands[0].presentation_mode, "dialog");
  assert.equal(ordinary.commands[1].text, fixture.text.mid);
  assert.equal(ordinary.commands[2].text, fixture.text.extreme);
  assert(ordinary.commands.some(c => c.clear_nvl_page_before === true));
  const bubble = script.scenes.find(s => s.scene_id === "bubble");
  assert.equal(bubble.commands[8].text, fixture.text.bubbleLong);
  assert(bubble.commands.some(c => c.type === "camera"));
  assert(bubble.commands.some(c => c.type === "sprite" && c.visible === false && c.sprite_id === "qa_actor"));
  assert.equal(script.scenes.find(s => s.scene_id === "saves").commands.length, 18);
  const asset = manifest.assets.find(a => a.asset_id === "qa_actor"); assert(asset);
  assert.equal(A.sha256(await zip.file(asset.path).async("nodebuffer")), fixture.spriteSha256);
  return { path: file, sha256: sha(file), bytes: fs.statSync(file).size,
    generatedAt: fs.statSync(file).mtime.toISOString(), layout, gameId: manifest.game_id,
    scriptSha256: A.sha256(await zip.file("script.json").async("nodebuffer")),
    layoutSha256: A.sha256(await zip.file("ui/layout.json").async("nodebuffer")),
    manifestSha256: A.sha256(await zip.file("manifest.json").async("nodebuffer")),
    runtimeVersion: manifest.runtime_version, scriptSchema: script.schema_version,
    actorBytesVerified: true, scenes: script.scenes.length };
}
async function main() {
  const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
  const resumed = process.argv.find(a => a.startsWith("--resume-agentvn="))?.split("=")[1];
  if (resumed !== undefined) assert.match(resumed, /^\d{2}$/);
  const out = path.resolve(`F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), out, steps: [],
    launches: [], cleanups: [], errors: [], screenshots: [], cartridges: [], downloadEvents: [],
    modelRequests: 0, productChanges: 0, builds: 0, normalCloseClaimed: false,
    scope: "ACTUAL_1922_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE" };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  let owner, page, prepared = false;
  function cache(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/installed-layout-cache-session.ps1", "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
    { cwd: path.resolve(__dirname, ".."), encoding: "utf8", windowsHide: true, timeout: 45000 });
    (report.cache ??= []).push({ action, code: r.status, stdout: r.stdout, stderr: r.stderr }); save();
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  async function step(name, fn) {
    const s = { name, status: "RUNNING", startedAt: new Date().toISOString() };
    report.steps.push(s); save(); console.log(`START ${name}`);
    try { s.detail = await fn(); s.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); throw e; }
    finally { s.finishedAt = new Date().toISOString(); save(); }
  }
  async function publish(layout, fixture) {
    await page.locator('[data-workspace-surface="publish"]:visible').click();
    await A.settleEditor(page); const panel = page.locator(".cartridge-export-panel"); await panel.waitFor();
    await until(async () => {
      const initial = page.locator('[data-testid="package-environment-operation-dialog"]:visible');
      if (await initial.isVisible()) {
        const phase = await initial.getAttribute("data-environment-phase");
        if (!["completed", "failed"].includes(phase)) return false;
        await initial.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
        await initial.waitFor({ state: "detached" });
      }
      const settings = panel.locator('[data-package-stage="settings"]');
      try { await settings.click({ timeout: 750 }); } catch { return false; }
      return await panel.locator('[data-help-key="package.mode"]').isVisible();
    }, "actual package settings after environment completion", 180000);
    await panel.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warnings.isVisible()) await warnings.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]');
    if (await consent.isVisible()) await consent.check();
    report.warnings ??= {}; report.warnings[layout] = await panel.locator(".preflight-check.is-warning").allTextContents();
    const directory = path.join(out, `download-${layout}`); fs.mkdirSync(directory);
    const item = await A.realDownload(page, owner.cdp, directory, panel.locator('[data-help-key="package.export"]'));
    const value = await validateCartridge(item.path, fixture, layout);
    const event = report.downloadEvents.find(e => e.type === "begin" && e.suggestedFilename === path.basename(item.path));
    assert(event, "Actual download event required");
    await until(() => report.downloadEvents.find(e => e.guid === event.guid && e.type === "progress" &&
      e.state === "completed"), "download terminal event");
    if (report.cartridges.length) assert.equal(value.scriptSha256, report.cartridges[0].scriptSha256,
      "Changing layout cannot rewrite the story");
    report.cartridges.push(value); save(); await owner.shot(`export-${layout}`);
    return value;
  }
  try {
    save(); report.checkpoint = desc("F:/AgentVN/Checkpoints/Installed-Runtime-Story-1922-20261023-01/report.json");
    const checkpoint = read(report.checkpoint.path); report.protectedProducts = checkpoint.products;
    for (const f of report.protectedProducts) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(checkpoint.fixture.path), checkpoint.fixture.sha256);
    const historical = read(checkpoint.fixture.path);
    assert.equal(sha(historical.input), historical.inputSha256);
    const input = path.join(out, "剧情能力隔离工程.vnproj");
    fs.copyFileSync(historical.input, input, fs.constants.COPYFILE_EXCL);
    report.fixture = { ...historical, input, inputSha256: sha(input), historicalInput: desc(historical.input),
      copiedOriginalBytes: true };
    fs.writeFileSync(path.join(out, "fixture.json"), JSON.stringify(report.fixture, null, 2), { flag: "wx" });
    Object.assign(process.env, { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out });
    report.environment = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out };
    report.installation = desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json");
    assert.equal(read(report.installation.path).version, "1.9.22");
    owner = installedReleaseSession({ installationFile: report.installation.path, out, input, report, save });
    report.tools = [__filename, "scripts/lib/installed-release-session.cjs",
      "scripts/lib/current-native-capture.cjs", "scripts/installed-layout-cache-session.ps1"].map(f => {
      const source = desc(f), copy = path.join(out, "tools", path.basename(f));
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...source, copy };
    });
    cache("SelfTest"); prepared = true; cache("Prepare");
    page = await owner.start();
    owner.cdp.on("Browser.downloadWillBegin", e => {
      report.downloadEvents.push({ type: "begin", ...e }); save();
    });
    owner.cdp.on("Browser.downloadProgress", e => {
      report.downloadEvents.push({ type: "progress", ...e }); save();
    });
    await step("Current installed backend imports exact controlled fixture; actual home entry", async () => {
      const response = await fetch(`http://127.0.0.1:${owner.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "content-type": "application/octet-stream",
          "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
        body: fs.readFileSync(input), signal: AbortSignal.timeout(30000),
      });
      const result = await response.json(); assert(response.ok && result.ok);
      assert.equal(result.data.project_id, historical.projectId);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".recent-project-open:visible").filter({ hasText: historical.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
      const project = await A.projectSnapshot(owner.current.ports[0]); assert.equal(project.projectId, historical.projectId);
      return { projectId: project.projectId, controlledPublicImport: true, nativePickerClaim: false };
    });
    if (resumed) {
      await step("Retain completed actual AgentVN download from failed QA navigation; no re-export", async () => {
        const source = desc(`F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${resumed}/report.json`);
        const prior = read(source.path);
        assert.equal(prior.status, "FAILED"); assert(prior.finishedAt && !prior.cleanupError);
        assert(prior.error.includes('data-workspace-surface="options"'));
        assert.equal(prior.steps[0].status, "PASS"); assert.equal(prior.steps[1].status, "PASS");
        assert.equal(prior.steps[2].status, "FAILED"); assert.equal(prior.cartridges.length, 1);
        assert.equal(prior.fixture.inputSha256, report.fixture.inputSha256);
        assert.equal(prior.installation.sha256, report.installation.sha256);
        assert(prior.cleanups.every(c => c.status === "PASS"));
        assert.equal(sha(prior.restoration.path), prior.restoration.sha256);
        assert.equal(read(prior.restoration.path).status, "PASS");
        const item = prior.cartridges[0];
        assert.equal(item.layout, "agentvn"); assert.equal(sha(item.path), item.sha256);
        const actual = await validateCartridge(item.path, report.fixture, "agentvn");
        assert.equal(actual.scriptSha256, item.scriptSha256);
        const begin = prior.downloadEvents.filter(e => e.type === "begin");
        const complete = prior.downloadEvents.filter(e => e.type === "progress" && e.state === "completed");
        assert.equal(begin.length, 1); assert.equal(complete.length, 1);
        assert.equal(begin[0].guid, complete[0].guid);
        assert.equal(path.resolve(complete[0].filePath), path.resolve(item.path));
        assert.equal(complete[0].totalBytes, item.bytes); assert.equal(complete[0].receivedBytes, item.bytes);
        report.reusedAgentvn = { source, originalStatus: prior.status, newAgentvnExports: 0 };
        report.inheritedDownloadEvents = [begin[0], complete[0]];
        report.cartridges.push(item); return report.reusedAgentvn;
      });
    } else await step("Current AgentVN actual UI export preserves complete script and sprite bytes",
      () => publish("agentvn", report.fixture));
    await step("Current Renpy actual layout switch and UI export preserve same script bytes", async () => {
      const close = page.getByRole("button", { name: "关闭发布与打包", exact: true });
      if (await close.isVisible()) { await close.click(); await A.settleEditor(page); }
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
      await page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
      return publish("renpy", report.fixture);
    });
    assert.equal(report.steps.length, 3); assert.equal(report.cartridges.length, 2);
    assert.equal([...report.downloadEvents, ...report.inheritedDownloadEvents || []].filter(e => e.type === "begin").length, 2);
    assert.equal(report.errors.length, 0); report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page) {
      report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-7000);
      await owner.shot("failure").catch(() => {});
    }
  } finally {
    try {
      await owner?.stop("Current story UI export complete; attributed cleanup, not normal close");
      assert(!rows().some(p => p.Name === "agentvn-editor.exe" || p.Name === "creator-backend.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
      if (prepared && fs.existsSync(path.join(out, "native-cache-protection.json"))) {
        cache("Restore"); report.restoration = desc(path.join(out, "native-cache-restoration.json"));
        assert.equal(read(report.restoration.path).status, "PASS");
      }
      for (const f of [...report.protectedProducts || [], ...report.tools || []]) assert.equal(sha(f.path), f.sha256);
      assert.deepEqual(listeners(report.launches.flatMap(l => l.ports)), []);
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, cartridges: report.cartridges.length,
      error: report.error, cleanupError: report.cleanupError }));
  }
}
module.exports = { validateCartridge };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
