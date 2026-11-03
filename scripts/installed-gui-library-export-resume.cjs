"use strict";
// A completed real UI download survives a later QA-oracle failure. Validate
// that same artifact without re-exporting or rewriting the original result.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const [sourceAttempt, attempt] = process.argv.slice(2);
for (const value of [sourceAttempt, attempt]) assert.match(value, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Installed-GUI-Library-1922-20261022-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => sha256(fs.readFileSync(file));
const sourceFile = path.join(qa, `editor-${sourceAttempt}/report.json`), source = read(sourceFile);
assert.equal(source.status, "FAILED"); assert.equal(source.nativeCacheRestoration, "PASS");
assert.equal(source.cleanupError, undefined); assert(source.finishedAt);
assert.equal(source.steps.length, 8); assert(source.steps.slice(0, 7).every(row => row.status === "PASS"));
assert.match(source.error, /style: \{/);
const out = path.resolve(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const report = { ...source, status: "RUNNING", startedAt: new Date().toISOString(), finishedAt: undefined,
  error: undefined, failureDOM: undefined, launches: [], cleanups: [], knownProcesses: [], screenshots: [],
  cache: [], nativeCacheRestoration: "PASS",
  scope: "EXACT_COMPLETED_INSTALLED_GUI_EXPORT_CONTINUATION_NOT_A_NEW_EXPORT",
  inheritedAuthor: { path: sourceFile, sha256: sha(sourceFile), originalStatus: source.status,
    newExportRequests: 0, originalCleanup: source.nativeCacheRestoration },
  steps: source.steps.slice(0, 7).map(row => ({ ...row, inheritedFrom: { path: sourceFile, sha256: sha(sourceFile) } })) };
const row = { label: source.steps[7].label, status: "RUNNING" }; report.steps.push(row);
(async () => {
  const begins = source.downloadEvents.filter(event => event.type === "begin");
  assert.equal(begins.length, 1);
  const completed = source.downloadEvents.filter(event => event.type === "progress" && event.state === "completed");
  assert.equal(completed.length, 1); assert.equal(completed[0].guid, begins[0].guid);
  const file = path.resolve(completed[0].filePath);
  assert.equal(path.dirname(file), path.resolve(qa, `editor-${sourceAttempt}`));
  assert.equal(path.basename(file), begins[0].suggestedFilename);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, completed[0].totalBytes); assert.equal(bytes.length, completed[0].receivedBytes);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const actual = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const expected = structuredClone(source.savedProject.settings.runtimeUILayout);
  const builtin = new Set(["main_menu_continue_button", "main_menu_start_button", "main_menu_save_load_button",
    "main_menu_gallery_button", "main_menu_settings_button", "main_menu_about_button"]);
  const canonicalized = [];
  // The documented exporter intentionally excludes ignored, unmarked legacy
  // title styles. Preserve all explicit styles and every other field exactly.
  for (const screen of expected.screens) for (const component of screen.components)
    if (screen.screen_id === "title" && builtin.has(component.component_type) && component.titleButtonStyleSource !== "layout") {
      if (component.style !== undefined) canonicalized.push({ component: component.component_id, ignoredLegacyStyle: component.style });
      delete component.style;
    }
  assert(canonicalized.length > 0); assert.deepEqual(actual, expected);
  assert.equal(actual.layout_type, "renpy"); assert(!actual.profiles);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string")), assets = [];
  for (const asset of manifest.assets) {
    const original = source.assetProofs.find(value => value.id === asset.asset_id); assert(original);
    assert.equal(sha256(await zip.file(asset.path).async("nodebuffer")), original.sha256);
    assets.push({ ...original, path: asset.path });
  }
  assert(assets.length >= 6 && assets.length < 26);
  const targeted = actual.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_save_load_button");
  assert.equal(targeted.titleButtonStyleSource, "layout");
  assert(targeted.stateStyles.hover.backgroundImage.includes("main_menu"));
  report.cartridge = { path: file, sha256: sha256(bytes), bytes: bytes.length,
    generatedAt: fs.statSync(file).mtime.toISOString(), assets,
    layoutSha256: sha256(await zip.file("ui/layout.json").async("nodebuffer")),
    source: "Same completed real installed UI download; zero new export requests" };
  row.detail = { cartridge: report.cartridge, canonicalizedIgnoredTitleStyles: canonicalized, actualOtherFieldsExact: true };
  row.status = "PASS";
  assert.equal(report.steps.length, 8); assert(report.steps.every(value => value.status === "PASS"));
  assert.equal(report.matrix.length, 12); assert.equal(report.modelRequests, 0);
  report.status = "EDITOR_PASS_NATIVE_PLAYER_NOT_RUN";
})().catch(error => { row.status = "FAILED"; report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  });
