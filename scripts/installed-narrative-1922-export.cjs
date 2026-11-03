"use strict";
// New evidence and fixture; historical exporters and their recorded hashes stay intact.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { makeNarrativeFixture, validateNarrativeFixture } = require("./lib/installed-narrative-1922-fixture.cjs");
const root = "F:/AgentVN/QA/Installed-Layout-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
async function validateCartridge(file, fixture, layout) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const project = read(fixture.input);
  validateNarrativeFixture(project, fixture, fs.readFileSync(fixture.voice.path));
  assert.equal(manifest.game_id, fixture.projectId); assert.equal(skin.layout_type || "agentvn", layout);
  assert.equal(script.entry_scene_id, "narrative_entry"); assert.equal(script.scenes.length, 7);
  assert.equal(script.default_dialog_presentation, "dialog");
  for (const node of project.nodes.filter(n => n.data?.scene)) {
    const actual = script.scenes.find(s => s.scene_id === node.data.scene.scene_id); assert(actual);
    assert.equal(actual.commands.length, node.data.scene.commands.length);
    for (let i = 0; i < actual.commands.length; i++) {
      const expected = node.data.scene.commands[i], value = actual.commands[i];
      for (const key of ["type", "text", "voice", "presentation_mode"])
        if (expected[key] !== undefined) assert.equal(value[key], expected[key], `${actual.scene_id}:${i}.${key}`);
      if (expected.choices) assert.deepEqual(value.choices.map(c => [c.choice_id, c.text, c.target_scene_id]),
        expected.choices.map(c => [c.choice_id, c.text, c.target_scene_id]));
    }
  }
  const audio = manifest.assets.find(a => a.asset_id === fixture.voice.assetId); assert(audio);
  assert.equal(A.sha256(await zip.file(audio.path).async("nodebuffer")), fixture.voice.sha256);
  return { ...desc(file), layout, gameId: manifest.game_id, generatedAt: fs.statSync(file).mtime.toISOString(),
    scriptSha256: A.sha256(await zip.file("script.json").async("nodebuffer")),
    layoutSha256: A.sha256(await zip.file("ui/layout.json").async("nodebuffer")),
    manifestSha256: A.sha256(await zip.file("manifest.json").async("nodebuffer")),
    voiceBytesVerified: true, runtimeVersion: manifest.runtime_version, scriptSchema: script.schema_version };
}
async function main() {
  const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
  const configArgs = process.argv.slice(3).filter(a => a.startsWith("--candidate-config="));
  assert(configArgs.length <= 1);
  assert(process.argv.slice(3).every(a => a === "--mixed-capacity" || configArgs.includes(a)));
  const configFile = configArgs[0]?.slice("--candidate-config=".length);
  const config = configFile && require("./candidate-layout-consumption.cjs").validateCandidateConfig(read(configFile));
  const installed = config && require("./installed-profile-data-replay.cjs").deriveActual(config.actual, config.version);
  const installedReceipt = config && read(path.join(config.qa, "derived-installed-01.json"));
  if (config) {
    for (const key of Object.keys(installed)) assert.deepEqual(installedReceipt[key], installed[key], key);
    assert(Array.isArray(installedReceipt.protectedFiles));
  }
  fs.mkdirSync(root, { recursive: true });
  const out = path.join(root, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", out, startedAt: new Date().toISOString(), steps: [], screenshots: [],
    launches: [], cleanups: [], errors: [], cartridges: [], downloadEvents: [],
    scope: config ? "CURRENT_INSTALLED_EDITOR_NARRATIVE_BOUNDARY_UI_EXPORT" : "ACTUAL_1922_INSTALLED_EDITOR_NARRATIVE_BOUNDARY_UI_EXPORT",
    ...(config ? { candidateVersion: config.version, candidateConfig: desc(configFile) } : {}),
    productChanges: 0, builds: 0, modelRequests: 0, normalCloseClaimed: false };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  let owner, page, prepared = false;
  function cache(action) {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/installed-layout-cache-session.ps1", "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
    { windowsHide: true, encoding: "utf8", timeout: 45000 });
    (r.cache ??= []).push({ action, code: result.status, stdout: result.stdout, stderr: result.stderr }); save();
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  async function step(name, fn) {
    const s = { name, status: "RUNNING", startedAt: new Date().toISOString() }; r.steps.push(s); save();
    try { s.detail = await fn(); s.status = "PASS"; }
    catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); throw e; }
    finally { s.finishedAt = new Date().toISOString(); save(); console.log(`${s.status}: ${name}`); }
  }
  async function publish(layout) {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await A.settleEditor(page);
    const panel = page.locator(".cartridge-export-panel"); await panel.waitFor();
    await until(async () => {
      const initial = page.getByTestId("package-environment-operation-dialog");
      if (await initial.isVisible()) {
        const phase = await initial.getAttribute("data-environment-phase");
        if (!["completed", "failed"].includes(phase)) return false;
        await initial.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
        await initial.waitFor({ state: "detached" });
      }
      try { await panel.locator('[data-package-stage="settings"]').click({ timeout: 750 }); } catch { return false; }
      return panel.locator('[data-help-key="package.mode"]').isVisible();
    }, "actual publish settings readiness", 180000);
    await panel.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warnings.isVisible()) await warnings.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]');
    if (await consent.isVisible()) await consent.check();
    (r.warnings ??= {})[layout] = await panel.locator(".preflight-check.is-warning").allTextContents();
    const directory = path.join(out, `download-${layout}`); fs.mkdirSync(directory);
    const download = await A.realDownload(page, owner.cdp, directory, panel.locator('[data-help-key="package.export"]'));
    const value = await validateCartridge(download.path, r.fixture, layout);
    const event = r.downloadEvents.find(e => e.type === "begin" && e.suggestedFilename === path.basename(download.path));
    assert(event); await until(() => r.downloadEvents.some(e => e.guid === event.guid &&
      e.type === "progress" && e.state === "completed"), "actual completed download");
    if (r.cartridges.length) assert.equal(value.scriptSha256, r.cartridges[0].scriptSha256);
    r.cartridges.push(value); save(); await owner.shot(`export-${layout}`); return value;
  }
  try {
    save();
    if (config) {
      r.protectedProducts = [installedReceipt.executable, ...installedReceipt.resources, ...installedReceipt.protectedFiles];
    } else {
      r.checkpoint = desc("F:/AgentVN/Checkpoints/Installed-Narrative-1922-20261023-01/report.json");
      r.protectedProducts = read(r.checkpoint.path).products;
    }
    for (const f of r.protectedProducts) assert.equal(sha(f.path), f.sha256);
    r.originalExport = desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json");
    const prior = read(r.originalExport.path); assert.equal(prior.status, "PASS");
    assert.equal(sha(prior.fixture.input), prior.fixture.inputSha256);
    const { project, metadata, wav } = makeNarrativeFixture(read(prior.fixture.input),
      { mixedCapacity: process.argv.includes("--mixed-capacity") });
    const input = path.join(out, "NVL容量与语音去重隔离工程.vnproj"), voice = path.join(out, "合成语音探针.wav");
    fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" }); fs.writeFileSync(voice, wav, { flag: "wx" });
    r.fixture = { ...metadata, input, inputSha256: sha(input), voice: { ...metadata.voice, path: voice } };
    fs.writeFileSync(path.join(out, "fixture.json"), JSON.stringify(r.fixture, null, 2), { flag: "wx" });
    Object.assign(process.env, { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out });
    r.environment = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out };
    r.installation = desc(config ? path.join(config.qa, "derived-installed-01.json")
      : "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json");
    assert.equal(read(r.installation.path).version, config?.version || "1.9.22");
    if (config) {
      const receipt = read(r.installation.path);
      for (const key of Object.keys(installed)) assert.deepEqual(receipt[key], installed[key], key);
    }
    r.tools = [__filename, "scripts/lib/installed-narrative-1922-fixture.cjs",
      "scripts/lib/installed-release-session.cjs", "scripts/lib/current-native-capture.cjs",
      "scripts/installed-layout-cache-session.ps1"].map(file => {
      const f = desc(file), copy = path.join(out, "tools", path.basename(file));
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(f.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...f, copy };
    });
    owner = installedReleaseSession({ installationFile: r.installation.path, out, input, report: r, save });
    cache("SelfTest"); prepared = true; cache("Prepare"); page = await owner.start();
    owner.cdp.on("Browser.downloadWillBegin", e => { r.downloadEvents.push({ type: "begin", ...e }); save(); });
    owner.cdp.on("Browser.downloadProgress", e => { r.downloadEvents.push({ type: "progress", ...e }); save(); });
    await step("Controlled fixture imported by actual packaged backend, then real home entry", async () => {
      const response = await fetch(`http://127.0.0.1:${owner.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "content-type": "application/octet-stream",
          "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
        body: fs.readFileSync(input), signal: AbortSignal.timeout(30000),
      });
      const result = await response.json(); assert(response.ok && result.ok);
      assert.equal(result.data.project_id, r.fixture.projectId);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".recent-project-open:visible").filter({ hasText: r.fixture.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
      return { projectId: r.fixture.projectId, controlledPublicImport: true, nativePickerClaim: false };
    });
    await step("AgentVN actual UI export, every scene text/choice/voice byte verified", () => publish("agentvn"));
    await step("Renpy real type switch and UI export, same narrative and WAV bytes", async () => {
      await page.getByRole("button", { name: "关闭发布与打包", exact: true }).click(); await A.settleEditor(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
      await page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
      return publish("renpy");
    });
    assert.equal(r.steps.length, 3); assert.equal(r.cartridges.length, 2); assert.equal(r.errors.length, 0);
    assert.equal(r.downloadEvents.filter(e => e.type === "begin").length, 2); r.status = "PASS";
  } catch (e) {
    r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1;
    if (page) { r.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-7000);
      await owner.shot("failure").catch(() => {}); }
  } finally {
    try {
      await owner?.stop("Narrative fixture exports complete; owned termination, not normal close");
      assert(!rows().some(p => /^(agentvn-editor|creator-backend)\.exe$/.test(p.Name) ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
      if (prepared && fs.existsSync(path.join(out, "native-cache-protection.json"))) {
        cache("Restore"); r.restoration = desc(path.join(out, "native-cache-restoration.json"));
        assert.equal(read(r.restoration.path).status, "PASS");
      }
      for (const f of [...r.protectedProducts || [], ...r.tools || []]) assert.equal(sha(f.path), f.sha256);
      assert.deepEqual(listeners(r.launches.flatMap(l => l.ports)), []);
    } catch (e) { r.status = "FAILED"; r.cleanupError = String(e.stack || e); process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error, cleanupError: r.cleanupError }));
  }
}
module.exports = { validateCartridge };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
