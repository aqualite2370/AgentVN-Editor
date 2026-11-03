"use strict";
// Offline continuation of an actual completed download whose later oracle failed.
// No new import, application launch, export or model request.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), JSZip = require("../editor/node_modules/jszip");
const { assertAssistantExportLayout } = require("./lib/assistant-export-layout.cjs");
assert(process.argv.includes("--candidate=1.9.22"), "Recovery is explicit-current-candidate only");
const [from, attempt] = process.argv.slice(2, 4);
for (const n of [from, attempt]) assert.match(n, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Installed-Assistant-Export-1922-20261022-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const priorRoot = path.join(qa, `editor-${from}`), priorFile = path.join(priorRoot, "report.json"), prior = read(priorFile);
assert.equal(prior.version, "1.9.22"); assert.equal(prior.status, "FAILED"); assert(prior.finishedAt);
assert.equal(prior.steps.length, 3); assert(prior.steps.slice(0, 2).every(s => s.status === "PASS"));
assert.equal(prior.steps[2].status, "FAILED"); assert.match(prior.steps[2].error, /style: \{/);
assert.match(prior.error, /installed-assistant-export-current\.cjs:150:/);
assert.equal(prior.cleanupError, undefined); assert.equal(read(prior.cacheRestoration.path).status, "PASS");
assert.equal(prior.cleanups.length, 1); assert.equal(prior.cleanups[0].status, "PASS");
assert.equal(prior.cases.length, 12); assert.equal(prior.modelRequests, 0);
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { ...prior, status: "RUNNING", startedAt: new Date().toISOString(), finishedAt: undefined,
  error: undefined, failureText: undefined, captureError: undefined,
  priorEvidence: { ...desc(priorFile), originalStatus: "FAILED", newExportRequests: 0, newLaunches: 0,
    downloadBoundary: "Recovered exact sole file after successful Download.failure()/ZIP CRC checks and before layout-oracle failure; no raw CDP event journal was recorded.",
    inheritedLaunchesAndScreenshots: true },
  steps: prior.steps.slice(0, 2).map(s => ({ ...s, inheritedFrom: desc(priorFile) })),
  tools: [...prior.tools, ...[__filename, "scripts/lib/assistant-export-layout.cjs"].map(f => desc(path.resolve(f)))] };
const row = { label: prior.steps[2].label, status: "RUNNING" }; report.steps.push(row);
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
(async () => {
  for (const f of report.tools) {
    assert.equal(sha(f.path), f.sha256);
    fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);
  }
  for (const f of [...prior.products, prior.source, prior.input, prior.cacheRestoration])
    assert.equal(sha(f.path), f.sha256);
  const source = read(prior.source.path), portable = await JSZip.loadAsync(fs.readFileSync(prior.input.path), { checkCRC32: true });
  const project = JSON.parse(await portable.file("project.json").async("string"));
  assert.equal(project.project_id, source.baseline.id);
  assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, source.merged.settings.runtimeUILayoutProfiles);
  const filename = `${project.project_id}-0.1.0.vncart`, dir = path.join(priorRoot, "cartridge");
  assert.deepEqual(fs.readdirSync(dir), [filename], "Only the exact expected download may be resumed");
  const file = path.join(dir, filename), stat = fs.statSync(file);
  assert(stat.mtimeMs >= Date.parse(prior.startedAt) && stat.mtimeMs <= Date.parse(prior.finishedAt));
  // Confirm the frozen executed QA performs download-success and CRC checks
  // before the exact failing oracle; do not infer a new successful UI action.
  const executed = fs.readFileSync(path.join(priorRoot, "installed-assistant-export-current.cjs"), "utf8");
  const success = executed.indexOf("assert.equal(await download.failure(), null)");
  const crc = executed.indexOf('checkCRC32: true', success);
  const failedOracle = executed.indexOf("assert.deepEqual(layout, project.editor_settings.runtimeUILayout)", crc);
  assert(success > 0 && crc > success && failedOracle > crc);
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(layoutBytes);
  const canonicalized = assertAssistantExportLayout(layout, project.editor_settings.runtimeUILayout);
  assert.equal(canonicalized.length, 6);
  // Ensure the oracle still rejects lost explicit styles, altered geometry,
  // changed component actions and omitted selected components.
  const negatives = [
    a => { a.screens.find(s => s.screen_id === "title").components.find(c => c.component_type === "custom_component").rect.x += 1; },
    a => { a.screens.find(s => s.screen_id === "title").components.pop(); },
    a => { a.layout_type = "agentvn"; },
  ];
  for (const mutate of negatives) {
    const bad = structuredClone(layout); mutate(bad);
    assert.throws(() => assertAssistantExportLayout(bad, project.editor_settings.runtimeUILayout));
  }
  const explicit = structuredClone(project.editor_settings.runtimeUILayout);
  const edited = explicit.screens.find(s => s.screen_id === "title").components.find(c => c.component_type === "main_menu_start_button");
  edited.titleButtonStyleSource = "layout";
  assert.throws(() => assertAssistantExportLayout(layout, explicit));
  assert.equal(layout.layout_type, "renpy");
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.equal(manifest.game_id, project.project_id); assert.equal(manifest.title, project.title);
  const components = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
  assert.equal(components.length, 2); assert(!JSON.stringify(layout).includes("排除候选"));
  const ids = components.map(c => c.customComponent.root.children.find(n => n.tag === "img").assetId).sort();
  assert.deepEqual(manifest.assets.map(a => a.asset_id).sort(), ids);
  assert(!manifest.assets.some(a => ["private-project", "project-asset-1"].includes(a.asset_id)));
  const assets = [];
  for (const a of manifest.assets) {
    const bytes = await zip.file(a.path).async("nodebuffer"); assert.equal(hash(bytes), prior.image.sha256);
    assets.push({ id: a.asset_id, path: a.path, sha256: hash(bytes), bytes: bytes.length });
  }
  const scriptBytes = await zip.file("script.json").async("nodebuffer");
  assert.equal(JSON.parse(scriptBytes).game_id, project.project_id);
  assert(!zip.file("project.json")); assert(!JSON.stringify(manifest).includes("test-only-secret"));
  report.cartridge = { ...desc(file), generatedAt: stat.mtime.toISOString(), layoutSha256: hash(layoutBytes),
    scriptSha256: hash(scriptBytes), layout, manifest, assets };
  row.result = { cartridge: report.cartridge, canonicalizedIgnoredTitleStyles: canonicalized,
    rejectedInvalidLayoutVariants: negatives.length + 1, actualOtherFieldsExact: true, newExportRequests: 0 };
  row.status = "PASS"; report.status = "PASS";
})().catch(e => { row.status = "FAILED"; report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  });
