"use strict";
// QA scope for the installed Editor's deliberately asset-free three-line
// fixture. Never upgrades this result into full runtime/story acceptance.
const assert = require("node:assert/strict"), fs = require("node:fs");
const JSZip = require("../../editor/node_modules/jszip");
const { fileEvidence } = require("../android-acceptance-evidence.cjs");
const { verifyScrollableSaveCards } = require("./android-save-reachability.cjs");
const { measureSettingsIconProportions, assertSettingsIconProportions } = require("./runtime-settings-proportions.cjs");
const coverageNames = ["title", "settingsReturn", "aboutReturn", "startGame", "dialogueAdvance",
  "quickMenu", "saveWriteRead", "return", "rotation", "stability", "coldEmulatorBoot", "rendererWarnings"];
function packageSmokeCoverage() { return Object.fromEntries(coverageNames.map(k => [k, "NOT_RUN"])); }
function packageSmokeStatus(stages, coverage) {
  const values = [...["build", "runtime", "provenance", "cleanup"].map(k => stages?.[k]),
    ...coverageNames.map(k => coverage?.[k])];
  if (values.some(v => v === "FAILED" || v === "FAIL")) return "FAILED";
  return values.every(v => v === "PASS") ? "INSTALLED_PACKAGE_SMOKE_PASS" : "BLOCKED";
}
function validatePackageSmokeInput(fixture, project, manifest, script, layout) {
  assert.match(fixture.projectId, /^qa_android_pkg_20261021_\d{2}$/);
  assert.equal(fixture.title, "AVN Android QA 20261021");
  assert.equal(fixture.sceneId, "ui_acceptance");
  assert.equal(fixture.texts.length, 3);
  assert(fixture.texts.every((text, n) => typeof text === "string" && text.startsWith(`QA_ANDROID_${n}：`)));
  assert.equal(project.project_id, fixture.projectId); assert.equal(project.title, fixture.title);
  assert.deepEqual(project.asset_manifest, []); assert.deepEqual(project.editor_settings, {});
  assert.equal(manifest.game_id, fixture.projectId); assert.equal(manifest.title, fixture.title);
  assert.equal(manifest.entry_scene_id, fixture.sceneId); assert.deepEqual(manifest.assets, []);
  assert.equal(layout.layout_type ?? "agentvn", "agentvn");
  const source = project.nodes.map(n => n.data?.scene).filter(Boolean);
  assert.equal(source.length, 1); assert.equal(script.scenes.length, 1);
  for (const scene of [source[0], script.scenes[0]]) {
    assert.equal(scene.scene_id, fixture.sceneId);
    assert.deepEqual(scene.commands.map(c => ({ type: c.type, text: c.text })),
      fixture.texts.map(text => ({ type: "narration", text })));
  }
}
async function validatePackageSmokeApk(apk, proofFile) {
  const fixture = JSON.parse(fs.readFileSync(proofFile, "utf8"));
  assert.equal(fileEvidence(fixture.input).sha256, fixture.sha256);
  const project = JSON.parse(fs.readFileSync(fixture.input, "utf8"));
  const zip = await JSZip.loadAsync(fs.readFileSync(apk));
  const read = async suffix => {
    const entries = Object.values(zip.files).filter(e => !e.dir && e.name.endsWith(`embedded-cartridge/${suffix}`));
    assert.equal(entries.length, 1, `APK fixture entry missing/ambiguous: ${suffix}`);
    return JSON.parse(await entries[0].async("string"));
  };
  const [manifest, script, layout] = await Promise.all(["manifest.json", "script.json", "ui/layout.json"].map(read));
  validatePackageSmokeInput(fixture, project, manifest, script, layout);
  return { fixture, apk: fileEvidence(apk), proof: fileEvidence(proofFile),
    scope: "Installed-package three-line AgentVN smoke; not full story, NVL, bubble or upgrade acceptance" };
}
function readPosition() {
  const p = document.querySelector(".story-player"), d = document.querySelector(".dialog-box");
  return { scene: p?.dataset.currentSceneId, command: Number(p?.dataset.currentCommandIndex),
    text: d?.querySelector(".dialog-text")?.textContent, done: d?.dataset.dialogPageDone === "true" };
}
async function exercisePackageSmoke({ cdp, input, report, tap, wait, capture, assertLayout, expand,
  rotation, stability, save }) {
  const { fixture } = input;
  const idle = () => wait(`document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition === 'idle'
    && !document.querySelector('.game-launch-blackout, .boot-overlay')`, "package smoke page settled");
  const shot = async label => {
    await idle(); const s = await capture(label);
    await verifyScrollableSaveCards(s, tap); assertLayout(s, label); return s;
  };
  const position = async () => {
    await wait(`document.querySelector('.dialog-box')?.dataset.dialogPageDone === 'true'`,
      "package smoke revealed dialogue", 60000);
    const s = await cdp.evaluate(`(${readPosition.toString()})()`);
    assert.equal(s.scene, fixture.sceneId); assert(s.command >= 0 && s.command < fixture.texts.length);
    assert.equal(s.text, fixture.texts[s.command]); return s;
  };
  const tests = report.packageSmoke = { status: "RUNNING", cases: [] };
  const test = async (name, action) => {
    const row = { name, status: "RUNNING" }; tests.cases.push(row); save();
    try { row.evidence = await action(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
    finally { save(); }
  };
  await test("title, five settings categories and about return by real touch", async () => {
    await shot("package-title");
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.renpy-quick-bar').length`), 0);
    report.requiredCoverage.title = "PASS";
    await tap('[data-testid="open-settings"]', "package title settings"); await idle();
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.settings-tabs button').length`), 5);
    report.settingsIconProportions = await cdp.evaluate(`(${measureSettingsIconProportions.toString()})()`);
    assertSettingsIconProportions(report.settingsIconProportions);
    for (let n = 1; n <= 5; n++) {
      await tap(`.settings-tabs button:nth-child(${n})`, `package settings category ${n}`);
      await shot(`package-settings-${n}`);
    }
    await tap('[data-testid="settings-finish"]', "package finish settings"); await idle();
    await wait(`Boolean(document.querySelector('[data-testid="start-new-game"]'))`, "package title after settings");
    report.requiredCoverage.settingsReturn = "PASS";
    await tap('[data-testid="open-about"]', "package about"); await idle(); await shot("package-about");
    await tap('[data-testid="back-to-main-menu"]', "package about back"); await idle();
    await wait(`Boolean(document.querySelector('[data-testid="start-new-game"]'))`, "package title after about");
    report.requiredCoverage.aboutReturn = "PASS";
    return { categories: 5 };
  });
  let first;
  await test("first authored line, eight visible single-column menu buttons and manual save", async () => {
    await tap('[data-testid="start-new-game"]', "package start game"); await idle();
    first = await position(); assert.equal(first.command, 0); await shot("package-first-line");
    report.requiredCoverage.startGame = "PASS";
    await expand("package expand quick menu"); await shot("package-menu");
    const menu = await cdp.evaluate(`(() => { const n=document.querySelector('.playback-controls'); return {
      columns:n.dataset.quickMenuColumns, scrollable:n.dataset.quickMenuScrollable,
      overflowX:n.scrollWidth-n.clientWidth, overflowY:n.scrollHeight-n.clientHeight,
      buttons:[...n.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).length }; })()`);
    assert.equal(menu.buttons, 8); assert.equal(menu.columns, "1"); assert.equal(menu.scrollable, "false");
    assert(menu.overflowX <= 1 && menu.overflowY <= 1);
    report.requiredCoverage.quickMenu = "PASS";
    await tap('[data-ui-component-id="quick_save_load_button"]', "package save page"); await idle();
    await tap('[data-testid="save-slot-manual-1"] .save-card-main', "package write manual 1");
    await wait(`Boolean(document.querySelector('[data-testid="save-slot-manual-1"].has-save .save-card-main:not(:disabled)'))`,
      "package manual save persisted");
    await shot("package-manual-save");
    await tap('[data-testid="back-to-player"]', "package return from save"); await idle();
    assert.deepEqual(await position(), first);
    return { first, menu };
  });
  await test("one touch advances one command, actual load restores earlier line", async () => {
    if (await cdp.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded') === 'true'`))
      await tap('[data-testid="quick-menu-toggle"]', "package collapse menu");
    await wait(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded') === 'false'`,
      "package collapsed");
    await tap(".dialog-box", "package advance one line");
    await wait(`document.querySelector('.story-player')?.dataset.currentCommandIndex === '1'`, "package second line");
    const second = await position(); assert.equal(second.command, 1); await shot("package-second-line");
    report.requiredCoverage.dialogueAdvance = "PASS";
    await expand("package reopen for load");
    await tap('[data-ui-component-id="quick_save_load_button"]', "package reopen saves"); await idle();
    await tap(".save-mode-switch button:nth-child(2)", "package switch load");
    await tap('[data-testid="save-slot-manual-1"] .save-card-main', "package load manual 1"); await idle();
    const loaded = await position(); assert.deepEqual(loaded, first); await shot("package-reloaded");
    report.requiredCoverage.saveWriteRead = "PASS";
    return { second, loaded };
  });
  await test("reverse landscape, stability and game-menu continue", async () => {
    await rotation(); report.requiredCoverage.rotation = "PASS";
    await stability(); report.requiredCoverage.stability = "PASS";
    const before = await position(); await expand("package menu return");
    await tap('[data-testid="open-main-menu"]', "package open game menu"); await idle();
    await tap('[data-testid="continue-game"]', "package continue"); await idle();
    const after = await position(); assert.deepEqual(after, before); await shot("package-continued");
    report.requiredCoverage.return = "PASS"; return { before, after };
  });
  assert.equal(tests.cases.length, 4); assert(tests.cases.every(t => t.status === "PASS"));
  tests.status = "PASS"; save();
}
module.exports = { packageSmokeCoverage, packageSmokeStatus, validatePackageSmokeInput,
  validatePackageSmokeApk, exercisePackageSmoke };
