"use strict";
// Real source Editor controls, isolated backend, and normal cartridge downloads.
// The imported scaffold has event types but no media bindings or authored text.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { createSpritePreview } = require("./lib/sprite-preview-fixture.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const out = path.resolve(process.argv[2] || "");
assert.equal(path.dirname(out).toLowerCase(), path.resolve("F:/testavn").toLowerCase());
assert(/^Sprite-Author-Export-1975-20261116-\d{2}$/.test(path.basename(out)));
assert(!fs.existsSync(out), "Keep all previous evidence");
fs.mkdirSync(out);
const temporary = path.join(out, "temp");
fs.mkdirSync(temporary);
process.env.TEMP = process.env.TMP = temporary;
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const describe = file => ({ path: file, bytes: fs.statSync(file).size, sha256: hash(fs.readFileSync(file)) });
const project = fixture("sprite_author_" + path.basename(out).slice(-2));
project.title = "立绘作者导出专项";
const show = (id, visible = true) => ({ type: "sprite", character_id: id, sprite_id: "",
  visible, position: id === "c0" ? "left" : id === "c1" ? "right" : "center",
  scale: null, animation: visible ? "fade_in" : "fade_out" });
const say = () => ({ type: "narration", text: "" });
const commands = [
  { type: "background", background_id: "", transition: "fade" },
  show("c0"), say(), show("c1"), say(),
  show("c2"), show("c3"), show("c4"), say(),
  ...["c1", "c2", "c3", "c4"].map(id => show(id, false)), say(),
  show("c0"), say(),
];
project.nodes[1].data.scene.commands = commands;
const input = path.join(out, "scaffold.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
// Only reuse PNG generation, never its preview protocol or script submission.
const generated = createSpritePreview({ manifest: {}, script: {}, uiSkin: {}, type: "agentvn" });
const media = [
  { name: "作者宽立绘.png", kind: "sprite", bytes: Buffer.from(generated.message.assetUrls.sprite_wide.split(",")[1], "base64") },
  { name: "作者高立绘.png", kind: "sprite", bytes: Buffer.from(generated.message.assetUrls.sprite_tall.split(",")[1], "base64") },
  { name: "作者背景.png", kind: "background", bytes: Buffer.from(generated.message.assetUrls.sprite_wide.split(",")[1], "base64") },
];
const report = { status: "RUNNING", startedAt: new Date().toISOString(), stages: [], exports: [],
  scope: "SOURCE_EDITOR_UI_MEDIA_BIND_SCALE_SAVE_RELOAD_NORMAL_CARTRIDGE_EXPORT",
  limitations: ["Imported blank event scaffold; not all event creation via UI",
    "Source browser Editor with actual isolated backend, not an installed Editor",
    "No Android consumption claim from cartridge inspection"], models: 0, productBuilds: 0, errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let service, browser, page;
async function step(name, fn) {
  const item = { name, status: "RUNNING" }; report.stages.push(item); save();
  try { item.result = await fn(); item.status = "PASS"; }
  catch (error) { item.status = "FAILED"; item.error = error.stack; throw error; }
  finally { save(); console.log(JSON.stringify({ name, status: item.status })); }
}
async function current() {
  const response = await fetch(service.backendUrl + "/api/project/projects/" + project.project_id);
  assert(response.ok); return (await response.json()).data;
}
async function persisted(predicate) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const value = await current(); if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error("Actual backend did not contain the UI-authored changes");
}
async function choose(key, text) {
  await page.locator(`[data-help-key="${key}"]:visible`).click();
  await page.locator(`button[role="option"][data-help-key="${key}"][data-help-title="${text}"]:visible`).click();
}
async function download(action, label) {
  const event = page.waitForEvent("download", { timeout: 90000 });
  await action.click();
  const result = await event;
  assert.equal(await result.failure(), null);
  const file = path.join(out, label + path.extname(result.suggestedFilename()));
  await result.saveAs(file); return describe(file);
}
async function bind(card, key, id) {
  const trigger = card.locator(`[data-help-key="${key}.openPicker"]`);
  if (await trigger.count()) await trigger.click();
  await page.locator(`[data-help-key="${key}.select"][data-asset-id="${id}"]:visible`).click();
}
async function scale(card, value) {
  await card.locator('[data-help-key="command.sprite.scaleMode"]').check();
  const range = card.locator('[data-help-key="command.sprite.scale"]');
  await range.focus(); await range.press("Home");
  for (let i = 0; i < Math.round((value - .5) / .05); i++) await range.press("ArrowRight");
  assert(Math.abs(Number(await range.inputValue()) - value) < .001);
}
(async () => {
  save();
  service = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT,
    { isolateBackendWorkingDirectory: true });
  report.services = { backendUrl: service.backendUrl, url: service.url,
    backendPid: service.backendPid, vitePid: service.server.pid }; save();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(30000); page.on("pageerror", error => report.errors.push(String(error)));
  await service.open(page);
  await step("real-image-import-and-explicit-asset-types", async () => {
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('nav [data-help-key="advanced.tab.library"]').click();
    await settleEditor(page);
    for (const item of media) {
      await page.locator(".asset-library-panel input[type=file][multiple]").setInputFiles({
        name: item.name, mimeType: "image/png", buffer: item.bytes,
      });
      await choose("asset.assetType", item.kind === "sprite" ? "角色图像" : "背景图");
      await page.locator('[data-help-key="asset.confirmImport"]:visible').click();
      const saved = await persisted(value => value.asset_manifest.some(a =>
        a.asset_type === item.kind && a.metadata?.filename === item.name));
      const asset = saved.asset_manifest.find(a =>
        a.asset_type === item.kind && a.metadata?.filename === item.name);
      item.assetId = asset.asset_id;
    }
    return media.map(item => ({ name: item.name, assetId: item.assetId, sha256: hash(item.bytes), kind: item.kind }));
  });
  await step("UI-bind-every-event-and-author-independent-scales", async () => {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    await page.locator('.react-flow__node[data-id="scene"]').click();
    const narrative = new Map([[2, "SIZE_STAGE_1"], [4, "SIZE_STAGE_2"], [8, "SIZE_STAGE_5"],
      [13, "SIZE_STAGE_RETURN_1"], [15, "SIZE_STAGE_AUTHOR_SCALE"]]);
    for (let index = 0; index < commands.length; index++) {
      const card = page.locator(`.command-card[data-command-index="${index}"]`);
      await card.locator('[data-help-key="command.expand"]').click();
      if (commands[index].type === "background") {
        await bind(card, "command.background.backgroundId", media[2].assetId);
      } else if (commands[index].type === "sprite") {
        await card.locator('[data-help-key="command.sprite.characterId"]').fill(commands[index].character_id);
        await bind(card, "command.sprite.spriteId", media[commands[index].character_id === "c0" ? 0 : 1].assetId);
        await scale(card, index === 14 ? 1.1 : commands[index].character_id === "c0" ? .85 : 1.15);
      } else {
        await card.locator('[data-help-key="command.narration.text"]').fill(narrative.get(index));
      }
      await card.locator('[data-help-key="command.expand"]').click();
    }
    const saved = await persisted(value => {
      const authored = value.nodes.find(n => n.id === "scene").data.scene.commands;
      return authored[14].scale === 1.1 && authored[15].text === "SIZE_STAGE_AUTHOR_SCALE";
    });
    const actual = saved.nodes.find(n => n.id === "scene").data.scene.commands;
    assert.equal(actual[1].scale, .85); assert.equal(actual[3].scale, 1.15);
    assert(actual.filter(c => c.type === "sprite").every(c => c.sprite_id));
    assert.deepEqual(actual.filter(c => c.type === "narration").map(c => c.text), [...narrative.values()]);
    report.authored = { commands: actual, assetIds: media.map(item => item.assetId) };
    const file = path.join(out, "authored-backend.vnproj");
    fs.writeFileSync(file, JSON.stringify(saved), { flag: "wx" });
    return describe(file);
  });
  await step("reload-retains-authored-image-bindings-and-events", async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator(".recent-project-open").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    const saved = await current();
    assert.deepEqual(saved.nodes.find(n => n.id === "scene").data.scene.commands, report.authored.commands);
    const names = await page.locator(".node-palette").innerText(); assert(names.length > 0);
    return { sameProject: saved.project_id, commandCount: report.authored.commands.length };
  });
  for (const type of ["agentvn", "renpy"]) await step(type + "-normal-UI-cartridge-export-and-bytes", async () => {
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    const option = page.locator(`[data-layout-type-option="${type}"]:visible`);
    if (await option.getAttribute("aria-pressed") !== "true") await option.click();
    await page.waitForFunction(type => document.querySelector(".runtime-layout-designer")?.getAttribute("data-layout-type") === type
      && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false", type);
    await page.locator('[data-help-key="layout.save"]:visible').click();
    await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
    await page.locator('[data-package-stage="settings"]').click();
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warning.isVisible()) await warning.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]');
    if (await consent.isVisible()) await consent.check();
    const exported = await download(page.locator('[data-help-key="package.export"]:visible'), type + "-author");
    const zip = await JSZip.loadAsync(fs.readFileSync(exported.path));
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
    const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.equal(skin.layout_type || "agentvn", type);
    const scene = script.scenes.find(scene => scene.scene_id === "ui_acceptance"); assert(scene);
    assert.equal(script.entry_scene_id, scene.scene_id);
    const sprites = scene.commands.filter(c => c.type === "sprite");
    assert.equal(sprites.length, 10); assert.equal(sprites[0].scale, .85);
    assert.equal(sprites.at(-1).scale, 1.1);
    for (const item of media) {
      const asset = manifest.assets.find(a => a.asset_id === item.assetId); assert(asset);
      const bytes = await zip.file(asset.path).async("nodebuffer");
      assert.equal(hash(bytes), hash(item.bytes), "Export must preserve the imported source PNG");
    }
    const result = { type, ...exported, entry: script.entry_scene_id, assets: manifest.assets.length,
      scriptSha256: hash(await zip.file(manifest.entry_script).async("nodebuffer")) };
    report.exports.push(result); save();
    await page.locator('[data-help-key="package.close"]:visible').click();
    return result;
  });
  assert.equal(report.stages.length, 5); assert.deepEqual(report.errors, []);
  report.status = "PASS_SOURCE_AUTHOR_UI_PERSISTENCE_AND_TWO_NORMAL_CARTRIDGES";
})().catch(async error => {
  report.status = "FAILED"; report.error = error.stack; process.exitCode = 1;
  try { report.failureText = (await page.locator("body").innerText()).slice(-18000);
    await page.screenshot({ path: path.join(out, "failure.png") }); } catch {}
}).finally(async () => {
  await browser?.close(); await service?.stop();
  report.cleanup = "OWNED_BROWSER_AND_EDITOR_SERVICES_STOPPED_TEMP_FILES_PENDING";
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
