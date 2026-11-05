"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const path = require("node:path");
const { verifyResourceProvenance } = require("./android-resource-provenance.cjs");
const JSZip = require("../../editor/node_modules/jszip");
const { validateExportTarget } = require("./android-export-target.cjs");
const { sha256 } = require("./installed-acceptance.cjs");
const { measureSettingsIconProportions, assertSettingsIconProportions } = require("./runtime-settings-proportions.cjs");
const { renderedDialogGlyphs } = require("./rendered-dialog-glyphs.cjs");
const { verifyScrollableSaveCards } = require("./android-save-reachability.cjs");
function assertCanonical(manifest, script, expectedAssetIds) {
  assert.equal(manifest.game_id, "project_msiz08p7_0_89ebc8a8cb");
  assert.equal(manifest.title, "隐忍的成长");
  if (expectedAssetIds) {
    assert([115, 143].includes(expectedAssetIds.length));
    assert.equal(new Set(expectedAssetIds).size, expectedAssetIds.length);
    assert.deepEqual(manifest.assets.map(a => a.asset_id).sort(), [...expectedAssetIds].sort());
  } else assert.equal(manifest.assets.length, 143);
  assert.equal(script.scenes.length, 18);
  assert(script.scenes.some(s => s.scene_id === "scene_opening"));
}
async function validateHiddenGrowthApk(apk, proofFile) {
  const proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
  const target = validateExportTarget({ title: proof.title, proofFile,
    projectFile: proof.projectFile, sessionRoot: proof.sessionRoot });
  const zip = await JSZip.loadAsync(fs.readFileSync(apk));
  const manifests = Object.values(zip.files).filter(e => !e.dir && e.name.endsWith("embedded-cartridge/manifest.json"));
  assert.equal(manifests.length, 1);
  const base = manifests[0].name.slice(0, -"manifest.json".length);
  const manifest = JSON.parse(await manifests[0].async("string"));
  const script = JSON.parse(await zip.file(`${base}script.json`).async("string"));
  const layoutEntry = zip.file(`${base}ui/layout.json`);
  const layoutBytes = layoutEntry ? await layoutEntry.async("nodebuffer") : null;
  assertCanonical(manifest, script, target.exportedAssetIds);
  if (layoutBytes) assert.equal(JSON.parse(layoutBytes).layout_type ?? "agentvn", "agentvn");
  const expected = new Map(target.resource.assets.map(a => [a.assetId, a]));
  const originals = new Map(target.provenance.assets.map(a => [a.assetId, a]));
  const optimizationFile = path.join(path.dirname(apk), "release-optimization-report.json");
  const optimizationBytes = fs.readFileSync(optimizationFile);
  const optimization = JSON.parse(optimizationBytes);
  assert.equal(optimization.profile, "balanced");
  const assets = [];
  for (const asset of manifest.assets) {
    assert(!asset.path.split(/[\\/]/).includes(".."));
    const e = zip.file(`${base}${asset.path}`); assert(e, `APK asset missing: ${asset.asset_id}`);
    const bytes = await e.async("nodebuffer"), hash = sha256(bytes);
    const provenance = verifyResourceProvenance(asset, hash, bytes.length,
      expected.get(asset.asset_id), originals.get(asset.asset_id), optimization);
    assets.push({ assetId: asset.asset_id, sha256: hash, bytes: bytes.length, provenance });
  }
  assert.equal(sha256(await zip.file(`${base}script.json`).async("nodebuffer")), target.resource.script.sha256);
  return { title: manifest.title, gameId: manifest.game_id, script, assets, proof: target.proof,
    optimization: { path: optimizationFile, sha256: sha256(optimizationBytes), warnings: optimization.warnings },
    layout: { present: !!layoutBytes, sha256: layoutBytes ? sha256(layoutBytes) : null },
    scope: "Canonical authored AgentVN story; representative first branch, not all routes or NVL/bubble" };
}
function readStory() {
  const p = document.querySelector(".story-player"), d = document.querySelector(".dialog-box");
  return { scene: p?.dataset.currentSceneId, command: Number(p?.dataset.currentCommandIndex),
    page: Number(d?.dataset.dialogPage), pages: Number(d?.dataset.dialogPages),
    done: d?.dataset.dialogPageDone === "true", waiting: p?.dataset.waitingChoice === "true",
    text: d?.querySelector(".dialog-text")?.textContent || "" };
}
async function exerciseHiddenGrowth({ cdp, input, report, tap, wait, capture, assertLayout, expand,
  menuActions, rotation, stability, systemBack, save }) {
  const state = () => cdp.evaluate(`(${readStory.toString()})()`);
  const idle = () => wait(`document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition === 'idle'
    && !document.querySelector('.game-launch-blackout, .boot-overlay')`, "final story screen idle");
  const shot = async label => {
    await idle(); const s = await capture(label);
    await verifyScrollableSaveCards(s, tap);
    assertLayout(s, label); return s;
  };
  const reveal = async () => {
    await idle();
    await wait(`document.querySelector('.dialog-box')?.dataset.dialogPageDone === 'true'
      || document.querySelector('.story-player')?.dataset.waitingChoice === 'true'`, "final story typing completed", 60000);
    return state();
  };
  const next = async () => {
    const s = await reveal(); assert(!s.waiting, "Select an authored branch");
    await tap(".dialog-box", "final story advance one page or command");
    await wait(`(() => {const s=(${readStory.toString()})(); return s.scene!==${JSON.stringify(s.scene)}
      || s.command!==${s.command} || s.page!==${s.page} || s.waiting;})()`, "final story advances");
    return state();
  };
  const same = (a, b) => { for (const k of ["scene", "command", "page", "pages", "text"]) assert.deepEqual(b[k], a[k], `Story position changed: ${k}`); };
  const tests = report.finalStory = { status: "RUNNING", cases: [] };
  const test = async (name, action) => {
    const row = { name, status: "RUNNING" }; tests.cases.push(row); save();
    try { row.evidence = await action(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; throw e; } finally { save(); }
  };
  await test("original title, five settings categories, about and returns", async () => {
    await shot("final-title"); assert.equal(await cdp.evaluate(`document.querySelectorAll('.renpy-quick-bar').length`), 0);
    await tap('[data-testid="open-settings"]', "final title settings"); await idle();
    report.settingsIconProportions = await cdp.evaluate(`(${measureSettingsIconProportions.toString()})()`);
    assertSettingsIconProportions(report.settingsIconProportions);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.settings-tabs button').length`), 5);
    for (let n = 1; n <= 5; n++) {
      await tap(`.settings-tabs button:nth-child(${n})`, `final settings category ${n}`); await shot(`final-settings-${n}`);
    }
    await tap('[data-testid="settings-finish"]', "final finish settings"); await idle();
    await tap('[data-testid="open-about"]', "final about"); await shot("final-about");
    await tap('[data-testid="back-to-main-menu"]', "final about return"); await shot("final-title-return");
    for (const k of ["title", "settings", "about"]) report.requiredCoverage[k] = "PASS";
  });
  await test("canonical intro and actual white-route branch", async () => {
    await tap('[data-testid="start-new-game"]', "final start original story"); await idle();
    for (let i = 0; i < 12; i++) { if ((await state()).waiting) break; await next(); }
    assert((await state()).waiting, "Expected canonical intro branch");
    await shot("final-original-branch");
    await tap('[aria-label="选择：白线第一部分"]', "final select white first chapter");
    await wait(`document.querySelector('.story-player')?.dataset.currentSceneId === 'scene_opening'`, "final opening scene");
    await shot("final-first-chapter"); report.requiredCoverage.branch = "PASS";
  });
  let saved;
  await test("authored dialogue characters, page bounds and original sprite", async () => {
    const lines = [], pages = [];
    let sprite = false;
    for (let step = 0; step < 25; step++) {
      const first = await reveal(), chunks = [];
      for (let index = first.page; index <= first.pages; index++) {
        const s = await reveal(); chunks.push(s.text);
        const g = await cdp.evaluate(`(() => {
          const d=document.querySelector('.dialog-box'),t=d.querySelector('.dialog-text'),r=d.getBoundingClientRect();
          return {rect:r.toJSON(),glyphs:(${renderedDialogGlyphs.toString()})(t),
            overflowX:t.scrollWidth-t.clientWidth,overflowY:t.scrollHeight-t.clientHeight,
            width:innerWidth,height:innerHeight};})()`);
        assert(g.rect.left >= -1 && g.rect.right <= g.width + 1 && g.rect.top >= -1 && g.rect.bottom <= g.height + 1);
        assert(g.glyphs.length && g.overflowX <= 1 && g.overflowY <= 1);
        for (const r of g.glyphs) assert(r.left >= g.rect.left - 1 && r.right <= g.rect.right + 1 &&
          r.top >= g.rect.top - 1 && r.bottom <= g.rect.bottom + 1, "Authored dialogue clipped");
        pages.push({ position: s, geometry: g });
        if (index < first.pages) await next();
      }
      const authored = input.script.scenes.find(s => s.scene_id === first.scene).commands[first.command].text;
      assert.equal(chunks.join("").trim(), authored.trim(), "All authored characters must survive rendering");
      lines.push({ scene: first.scene, command: first.command, pages: first.pages, characters: authored.length });
      sprite = await cdp.evaluate(`[...document.querySelectorAll('.sprite-slot img')].some(i=>i.complete && i.naturalWidth>0)`);
      if (sprite) break; await next();
    }
    assert(sprite); assert(lines.some(s => s.characters > 60));
    await shot("final-sprite-dialogue");
    report.requiredCoverage.sprites = "PASS"; report.requiredCoverage.dialogueIntegrity = "PASS";
    return { lines, pages, actualPagination: lines.some(l => l.pages > 1),
      note: "If all original lines fit one page, do not inject synthetic text or claim forced multipage coverage." };
  });
  await test("single column seven actions plus collapse, actual save/load", async () => {
    await expand("final expand quick menu"); await shot("final-quick-menu");
    const menu = await cdp.evaluate(`(() => {const n=document.querySelector('.playback-controls');return {
      columns:n.dataset.quickMenuColumns,scrollable:n.dataset.quickMenuScrollable,
      widthOverflow:n.scrollWidth-n.clientWidth,heightOverflow:n.scrollHeight-n.clientHeight,
      buttons:[...n.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).length};})()`);
    assert.equal(menu.buttons, 8); assert.equal(menu.columns, "1"); assert.equal(menu.scrollable, "false");
    assert(menu.widthOverflow <= 1 && menu.heightOverflow <= 1);
    saved = await reveal();
    await tap('[data-ui-component-id="quick_save_load_button"]', "final open manual save"); await idle();
    await tap('[data-testid="save-slot-manual-1"] .save-card-main', "final save slot 1");
    await wait(`document.body.innerText.includes('存档已保存')`, "final native save complete");
    await shot("final-manual-save");
    await tap(".save-mode-switch button:nth-child(2)", "final select load");
    await tap('[data-testid="save-slot-manual-1"] .save-card-main', "final load slot 1"); await idle();
    const loaded = await reveal(); same(saved, loaded); await shot("final-save-loaded");
    report.requiredCoverage.saveWriteRead = "PASS"; report.requiredCoverage.quickMenu = "PASS";
    return { menu, saved, loaded };
  });
  await test("history, hide, effective rollback, auto, skip and collapse", async () => {
    // Keep several genuinely read lines available for rollback and read-only skip.
    for (let i = 0; i < 3; i++) { await next(); await reveal(); }
    await menuActions(); await rotation(); await stability();
    report.requiredCoverage.menuActions = "PASS"; report.requiredCoverage.rotation = "PASS";
    report.requiredCoverage.stability = "PASS";
    return { actions: report.menuActions, rotation: report.rotationEvidence.status, stability: report.runtimeStability.status };
  });
  await test("main-menu settings and continue preserve current story", async () => {
    const before = await reveal(); await expand("final return menu");
    await tap('[data-testid="open-main-menu"]', "final open main menu"); await idle();
    await tap('[data-testid="open-settings"]', "final in-game settings"); await idle();
    await systemBack();
    await wait(`document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimePresentedScreen === 'main_menu'`,
      "final Android system back returns to parent game menu");
    await idle();
    await tap('[data-testid="continue-game"]', "final continue story"); await idle();
    const after = await reveal(); same(before, after); await shot("final-menu-return");
    report.menuActions.mainMenu = "PASS";
    report.requiredCoverage.return = "PASS"; return { before, after };
  });
  assert.equal(tests.cases.length, 6); assert(tests.cases.every(c => c.status === "PASS"));
  tests.status = "PASS"; save();
}
module.exports = { assertCanonical, validateHiddenGrowthApk, readStory, exerciseHiddenGrowth };
