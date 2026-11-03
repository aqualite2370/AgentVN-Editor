"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const JSZip = require("../../editor/node_modules/jszip");
const sharp = require("../../GameCli_framework/node_modules/sharp");
const { fileEvidence } = require("../android-acceptance-evidence.cjs");
const { validateDefaultTitleInput, readDefaultTitle, assertDefaultTitle } = require("./agentvn-default-title.cjs");
async function validateDefaultTitleApk(apk, fixtureFile) {
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  assert.equal(fileEvidence(fixture.input).sha256, fixture.sha256);
  const projectZip = await JSZip.loadAsync(fs.readFileSync(fixture.input));
  const project = JSON.parse(await projectZip.file("project.json").async("string"));
  assert.equal(project.project_id, fixture.projectId);
  assert.deepEqual(Object.keys(project.editor_settings), ["characterDisplayNames"],
    "Title fixture must not carry an authored shell/theme/layout");
  const zip = await JSZip.loadAsync(fs.readFileSync(apk));
  async function read(suffix) {
    const entries = Object.values(zip.files).filter(e => !e.dir && e.name.endsWith(`embedded-cartridge/${suffix}`));
    assert.equal(entries.length, 1, `APK title resource ${suffix} missing/ambiguous`);
    return JSON.parse(await entries[0].async("string"));
  }
  const manifest = await read("manifest.json"), layout = await read("ui/layout.json");
  validateDefaultTitleInput(fixture, manifest, layout);
  return { fixture, fixtureEvidence: fileEvidence(fixtureFile), apkEvidence: fileEvidence(apk),
    layoutType: layout.layout_type ?? "agentvn", gameId: manifest.game_id,
    scope: "Default AgentVN title only, not full-story/RenPy/legacy-device acceptance" };
}
async function measureAndroidDefaultTitle(cdp, screenshotPath, title) {
  const before = await cdp.evaluate(`(${readDefaultTitle.toString()})()`);
  const image = sharp(screenshotPath), png = await image.metadata();
  assert(png.width >= 1920 && png.height >= 1080 && png.width > png.height,
    "Actual Android title screenshot must be landscape >=1080p");
  const background = [...await image.removeAlpha().extract({
    left: Math.round(png.width * .04), top: Math.round(png.height * .3), width: 1, height: 1,
  }).raw().toBuffer()].slice(0, 3);
  const assessment = assertDefaultTitle(before, title, background);
  const after = await cdp.evaluate(`(${readDefaultTitle.toString()})()`);
  assert.deepEqual(after, before, "Title changed during evidence measurement");
  return { before, after, ...assessment, screenshot: fileEvidence(screenshotPath),
    png: { width: png.width, height: png.height }, interaction: "administrator-adb-real-touch" };
}
async function exerciseAndroidDefaultTitle({ cdp, fixture, report, tap, wait, capture, assertLayout }) {
  const settle = () => wait(`document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'
    && !document.querySelector('.boot-overlay, .game-launch-blackout')`, "default title page settled");
  const shot = async label => {
    await settle();
    const state = await capture(label); assertLayout(state, label); return state;
  };
  const inspect = async label => {
    await shot(label);
    const screen = report.screens.at(-1);
    const result = await measureAndroidDefaultTitle(cdp, screen.screenshot, fixture.title);
    (report.defaultTitleSamples ??= []).push({ label, ...result });
  };
  await inspect("default-title-before");
  report.requiredCoverage.title = "PASS"; report.requiredCoverage.titleContrast = "PASS";
  await tap('[data-testid="open-settings"]', "default title open settings");
  await wait(`Boolean(document.querySelector('[data-testid="settings-screen"]'))`, "default title settings");
  await settle();
  const categories = await cdp.evaluate(`document.querySelectorAll('.settings-tabs button').length`);
  assert.equal(categories, 5, "Keep all five current settings categories");
  for (let i = 1; i <= categories; i++) {
    await tap(`.settings-tabs button:nth-child(${i})`, `default title settings category ${i}`);
    await shot(`default-title-settings-${i}`);
  }
  await tap('[data-testid="settings-finish"]', "default title finish settings");
  await wait(`Boolean(document.querySelector('.menu-hero h1'))`, "default title restored after settings");
  await inspect("default-title-after-settings"); report.requiredCoverage.settingsReturn = "PASS";
  await tap('[data-testid="open-about"]', "default title open about");
  await wait(`Boolean(document.querySelector('[data-testid="about-screen"]'))`, "default title about");
  await shot("default-title-about");
  await tap('[data-testid="back-to-main-menu"]', "default title return from about");
  await wait(`Boolean(document.querySelector('.menu-hero h1'))`, "default title restored after about");
  await inspect("default-title-after-about"); report.requiredCoverage.aboutReturn = "PASS";
  await tap('[data-testid="start-new-game"]', "default title start actual game");
  await wait(`document.querySelector('.story-player')?.dataset.currentSceneId === 'main'
    && document.querySelector('.dialog-text')?.textContent?.includes('第一句')`, "default title first authored scene");
  await shot("default-title-first-scene");
  assert.equal(await cdp.evaluate(`document.querySelectorAll('.renpy-quick-bar').length`), 0);
  report.requiredCoverage.startGame = "PASS";
}
module.exports = { validateDefaultTitleApk, measureAndroidDefaultTitle, exerciseAndroidDefaultTitle };
