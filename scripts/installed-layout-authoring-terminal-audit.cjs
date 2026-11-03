"use strict";
// Independent, read-only reconciliation of the installed author/player chain.
// Does not repair reports or turn a historical FAILED run into PASS.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const { assertRenpyQuickBarGeometry } = require("./lib/installed-portable-layout.cjs");

const matrixKeys = () => [1920, 2560, 3840].flatMap(width => [1, 2]
  .flatMap(dpr => [false, true].map(reduced => `${width}/${dpr}/${reduced}`))).sort();
const pages = ["title", "preferences", "save_load", "history", "about", "help", "gallery"];
function checkMatrixShape(rows) {
  assert.equal(rows.length, 12, "Empty, partial or duplicate matrices cannot pass");
  assert.deepEqual(rows.map(r => `${r.width}/${r.dpr}/${r.reduced}`).sort(), matrixKeys());
  for (const row of rows)
    assert.equal(row.height, ({ 1920: 1080, 2560: 1440, 3840: 2160 })[row.width]);
}
function checkCapture(capture, row) {
  assert(capture && fs.existsSync(capture.path), "Missing actual WebView capture");
  const bytes = fs.readFileSync(capture.path);
  assert.equal(sha256(bytes), capture.sha256);
  assert.equal(bytes.readUInt32BE(16), row.width * row.dpr);
  assert.equal(bytes.readUInt32BE(20), row.height * row.dpr);
  for (const sample of [capture.before, capture.after]) {
    assert.equal(sample.width, row.width); assert.equal(sample.height, row.height);
    assert.equal(sample.reduced, row.reduced);
    assert(Math.abs(sample.dpr - row.dpr) <= .001);
  }
}
function checkMatrix(rows, player) {
  checkMatrixShape(rows);
  for (const row of rows) {
    assert.equal(row.height, ({ 1920: 1080, 2560: 1440, 3840: 2160 })[row.width]);
    assert.deepEqual(row.pages.map(p => p.id), pages);
    checkCapture(row.capture, row);
    for (const [index, item] of row.pages.entries()) {
      const actual = player ? item.actual : item.runtime;
      const hex = (0x24384c + index * 0x040302).toString(16);
      const color = `rgb(${[0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
      assert.equal(actual.background, color);
      assert.equal(actual.material.opacity, 1);
      assert(actual.overflow <= 1 && actual.contentOverflow <= 1);
      assert(actual.buttons.length > 0 && actual.buttons.every(b => b.hit && !b.clipped));
      assert(Math.abs(actual.font / actual.scale - (23 + index)) < .15);
      assert(Math.abs(actual.gap / actual.scale - (7 + index)) < .15);
    }
    if (player) {
      assertRenpyQuickBarGeometry(row.quick, row);
      assert.equal(row.confirmation.source, "override"); assert(row.confirmation.focus);
      assert.equal(row.bubble.source, "override"); assert.equal(row.bubble.anchor, "fixed");
      assert.match(row.nvl.text, /作者工程继承NVL验证/);
    }
  }
}

async function auditLifecycle(file, report, bytes, kind) {
  const expectedCases = {
    profiles: [
      "installed-profile-draft-retention-and-cancel",
      "installed-profile-save-failure-blocks-switch-and-real-retry-persists",
      "installed-profile-discard-does-not-overwrite-either-saved-layout",
      "installed-profile-independent-view-state-and-stable-switch-matrix",
      "installed-profile-native-save-keeps-both-layouts-and-excludes-local-preferences",
      "installed-profile-normal-native-restart-and-real-file-picker-roundtrip",
    ],
    player: [
      "installed-ordinary-structure-style-inheritance-and-restore-isolation",
      "installed-story-choice-quick-bar-four-state-role-authoring-and-inheritance",
      "installed-author-actual-ordinary-preview-matrix",
      "installed-ordinary-native-save-restart-reopen-preserves-authored-data",
      "installed-publish-UI-cartridge-includes-authored-structure-and-role-bytes",
      "installed-player-consumes-ordinary-choice-quick-bar-and-real-state-matrix",
    ],
    fonts: [
      "installed-font-library-system-TTF-WOFF2-invalid-and-fallback-report",
      "installed-font-report-and-real-layout-runtime-preview-matrix",
      "installed-existing-node-iframe-priority-and-live-default-update-matrix",
      "installed-font-and-mode-native-save-restart-reopen-byte-roundtrip",
      "installed-font-export-byte-identity-and-player-fallback-matrix",
    ],
  };
  assert.deepEqual(report.cases.map(c => c.name), expectedCases[kind]);
  assert(report.cases.every(c => c.status === "PASS")); assert(!report.diagnosticOnly);
  assert(report.cleanup.length >= 2 && report.cleanup.every(c => c.editor.exitCode === 0 && c.backend.exitCode === 0));
  assert.equal(report.launches.length, 2); assert.equal(report.nativeInputs.length, 2);
  for (const launch of report.launches)
    assert.equal(sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.sha256);
  for (const item of report.nativeInputs) {
    assert.equal(item.receipt.result.status, "INPUT_COMPLETED");
    assert.equal(item.receipt.request.requestId, item.receipt.result.requestId);
    assert.equal(item.receipt.request.ownerPid, item.receipt.result.ownerPid);
    assert.equal(path.resolve(item.receipt.result.selectedPath), path.resolve(item.selectedPath));
    assert(item.receipt.result.interaction);
  }
  const matrices = kind === "fonts" ? [report.fontMatrix, report.nodeMatrix, report.playerMatrix]
    : kind === "player" ? [report.matrix, report.playerMatrix] : [report.matrix];
  for (const rows of matrices) {
    checkMatrixShape(rows);
    for (const row of rows) checkCapture(row.capture, row);
  }
  assert.equal(sha256(fs.readFileSync(report.projectArtifact.path)), report.projectArtifact.sha256);
  const projectZip = await JSZip.loadAsync(fs.readFileSync(report.projectArtifact.path));
  const project = JSON.parse(await projectZip.file("project.json").async("string"));
  const profiles = project.editor_settings.runtimeUILayoutProfiles;
  assert(profiles.profiles.agentvn && profiles.profiles.renpy);
  assert(!JSON.stringify(project).includes(path.dirname(report.projectArtifact.path)), "Local directory leaked to portable project");
  if (kind === "profiles") {
    assert.equal(profiles.activeType, "agentvn");
    assert.deepEqual(project.editor_settings.runtimeUILayout, profiles.profiles.agentvn);
    assert.equal(profiles.profiles.agentvn.screens.find(s => s.screen_id === "player")
      .components.find(c => c.component_id === "speaker_label").rect.x, 13);
    assert.equal(report.cases[1].failures.length, 1); assert.equal(report.cases[1].failures[0].status, 500);
    checkCapture(report.saveFailureCapture, { width: 1920, height: 1080, dpr: 1, reduced: false });
    for (const row of report.matrix) {
      for (const key of ["toRenpy", "toAgent"]) {
        const trace = row[key]; assert(!trace.error && trace.frames.length >= 3);
        for (const frame of trace.frames) assert(frame.root.width > 0 && frame.overflow <= 1);
      }
      for (const key of ["renpyGeometry", "agentGeometry"])
        assert(row[key].overflow <= 1 && row[key].controls.every(c => c.hit && !c.clipped));
    }
  } else {
    assert.equal(report.playerCleanup.exitCode, 0);
    assert.equal(sha256(fs.readFileSync(report.player.exe)), report.player.sha256);
    assert.equal(sha256(fs.readFileSync(report.cartridgeArtifact.path)), report.cartridgeArtifact.sha256);
    const cartridge = await JSZip.loadAsync(fs.readFileSync(report.cartridgeArtifact.path));
    const skin = JSON.parse(await cartridge.file("ui/layout.json").async("string"));
    assert.equal(profiles.activeType, "renpy");
    for (const key of ["screens", "tokens", "renpy"])
      assert.deepEqual(skin[key], profiles.profiles.renpy[key], `Export lost ${key}`);
    if (kind === "player") {
      for (const row of [...report.matrix, ...report.playerMatrix]) {
        const actual = row.actual ?? row.ordinary;
        assertRenpyQuickBarGeometry(actual.quick, row);
        assert.equal(actual.left, "12%"); assert.equal(actual.width, "76%");
        assert.equal(actual.continueDisplay, "none");
      }
      for (const row of report.playerMatrix) {
        assert.equal(row.states.normal, "rgb(104, 196, 183)");
        assert.equal(row.states.hover, "rgb(247, 214, 140)");
        assert.equal(row.states.selected, "rgb(255, 173, 204)");
        assert.equal(row.states.disabled, "rgb(129, 144, 156)");
        assert.deepEqual(row.choice.labels, ["继续", "重看"]); assert.equal(row.choice.left, "42%");
      }
    } else {
      const font = report.exportedFont;
      assert.equal(sha256(await cartridge.file(font.path).async("nodebuffer")), font.sha256);
      for (const row of [...report.fontMatrix, ...report.playerMatrix])
        assert(row.actual.faces.some(face => face.status === "loaded" && row.actual.font.includes(face.family)));
      for (const row of report.nodeMatrix) {
        assert(row.sameIframeWithinEditing);
        for (const value of [row.bubble, row.nvl, row.inherited]) {
          assert.equal(value.scene, "dialog_presentation_acceptance");
          assert.match(value.text, /对白呈现创作验收/); assert(value.overflow <= 1);
        }
        assert.equal(Number(row.bubble.pages), 1);
        assert.equal(row.bubble.textBoxes[0].text, "对白呈现创作验收，隔离中文字体缺字验证。");
      }
    }
  }
  return { status: "PASS", kind, scope: report.scope, report: path.resolve(file),
    reportSha256: sha256(bytes), cases: report.cases.length, matrices: matrices.map(rows => rows.length),
    captures: matrices.length * 12 + (kind === "profiles" ? 1 : 0),
    project: report.projectArtifact, cartridge: report.cartridgeArtifact ?? null,
    nativeInputs: report.nativeInputs.length, realModelRequests: 0, verifiedAt: new Date().toISOString() };
}

async function audit(file) {
  const bytes = fs.readFileSync(file), report = JSON.parse(bytes);
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.errors, []); assert(report.sourceUnchanged);
  const first = report.cases[0]?.name;
  const lifecycle = first === "installed-profile-draft-retention-and-cancel" ? "profiles"
    : first === "installed-ordinary-structure-style-inheritance-and-restore-isolation" ? "player"
    : first === "installed-font-library-system-TTF-WOFF2-invalid-and-fallback-report" ? "fonts" : null;
  if (lifecycle) return auditLifecycle(file, report, bytes, lifecycle);
  assert.equal(report.cases.length, 7);
  assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); assert(report.sourceUnchanged);
  assert.equal(report.playerCleanup.exitCode, 0);
  checkMatrix(report.matrix, false); checkMatrix(report.playerMatrix, true);
  let author = report;
  if (report.referencedAuthoring) {
    const sourceBytes = fs.readFileSync(report.referencedAuthoring.path);
    assert.equal(sha256(sourceBytes), report.referencedAuthoring.sha256);
    author = JSON.parse(sourceBytes);
    assert.equal(author.status, report.referencedAuthoring.originalStatus);
    assert.equal(author.cases.length, 6); assert(author.cases.every(c => c.status === "PASS"));
    assert(author.sourceUnchanged); assert.deepEqual(author.errors, []);
    assert.equal(author.playerCleanup.exitCode, 0);
  }
  assert(author.cleanup.length >= 2, "Authoring and restart require independent cleanup receipts");
  assert(author.cleanup.every(c => c.editor.exitCode === 0 && c.backend.exitCode === 0));
  assert.equal(author.nativeInputs.length, 2);
  for (const item of author.nativeInputs) {
    assert.equal(item.receipt.result.status, "INPUT_COMPLETED");
    assert.equal(item.receipt.request.requestId, item.receipt.result.requestId);
    assert.equal(item.receipt.request.ownerPid, item.receipt.result.ownerPid);
    assert.equal(path.resolve(item.receipt.result.selectedPath), path.resolve(item.selectedPath));
  }
  for (const item of [report.projectArtifact, report.cartridgeArtifact])
    assert.equal(sha256(fs.readFileSync(item.path)), item.sha256);
  const projectZip = await JSZip.loadAsync(fs.readFileSync(report.projectArtifact.path));
  const project = JSON.parse(await projectZip.file("project.json").async("string"));
  const cartridge = await JSZip.loadAsync(fs.readFileSync(report.cartridgeArtifact.path));
  const skin = JSON.parse(await cartridge.file("ui/layout.json").async("string"));
  const script = JSON.parse(await cartridge.file("script.json").async("string"));
  const manifest = JSON.parse(await cartridge.file("manifest.json").async("string"));
  const profiles = project.editor_settings.runtimeUILayoutProfiles;
  assert.equal(profiles.activeType, "renpy");
  assert(profiles.profiles.agentvn && profiles.profiles.renpy);
  for (const key of ["screens", "renpy", "dialogueLayouts", "confirmationLayout"])
    assert.deepEqual(skin[key], profiles.profiles.renpy[key], `Export lost ${key}`);
  assert.equal(script.default_dialog_presentation, "nvl");
  assert.equal(script.characters.find(c => c.character_id === "alice").dialog_presentation, "bubble");
  assert.equal(project.nodes.find(n => n.id === "scene").data.scene.commands[2].clear_nvl_page_before, true);
  assert.equal(manifest.runtime_version, "0.25.0");
  assert.equal(sha256(fs.readFileSync(report.player.exe)), report.player.sha256);
  return { status: "PASS", report: path.resolve(file), reportSha256: sha256(bytes),
    referencedAuthor: report.referencedAuthoring ?? null,
    scope: "Installed authoring 12 combinations plus actual installed Player 12 combinations; referenced author evidence is explicit",
    pagesPerCombination: 7, authorCombinations: 12, playerCombinations: 12,
    captures: 24, nativeInputs: 2, realModelRequests: 0,
    player: report.player, project: report.projectArtifact, cartridge: report.cartridgeArtifact,
    verifiedAt: new Date().toISOString() };
}
module.exports = { audit, checkMatrix, checkCapture, checkMatrixShape };
if (require.main === module) {
  assert(process.argv[2] && process.argv[3], "Pass report.json and a fresh audit output file");
  audit(process.argv[2]).then(result => {
    fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify(result));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
