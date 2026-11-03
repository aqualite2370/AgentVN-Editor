"use strict";
// Offline verification of an already completed actual UI download.
// Preserve the original FAILED oracle and do not launch or export again.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { qa } = require("./current-assistant-batch-review.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const source = path.join(qa, "session-02/report.json"), old = read(source);
const out = path.join(qa, "session-03"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { ...old, status: "RUNNING", at: new Date().toISOString(),
  priorEvidence: { ...desc(source), newExportRequests: 0, newLaunches: 0 },
  recoveryScope: "Offline exact-byte verification of prior real UI output; inherited launch/UI evidence explicitly attributed",
  recoveryTool: desc(__filename), source: old.source };
report.originalExportError = old.error; delete report.error;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
  assert.equal(old.status, "FAILED"); assert(old.error.includes("assertAssistantExportLayout"));
  assert.equal(old.steps.length, 3); assert(old.steps.slice(0, 2).every(s => s.status === "PASS"));
  assert(old.cleanups.length === 1 && old.cleanups.every(c => c.status === "PASS"));
  assert.equal(read(old.cacheRestoration.path).status, "PASS");
  assert.equal(old.cases.length, 12); assert(old.cases.every(c => c.status === "PASS"));
  assert.deepEqual(old.errors, []); assert.equal(old.modelRequests, 0);
  const dir = path.join(qa, "session-02/cartridge"), files = fs.readdirSync(dir).filter(f => f.endsWith(".vncart"));
  assert.equal(files.length, 1); const file = path.join(dir, files[0]);
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(layoutBytes);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const scriptBytes = await zip.file("script.json").async("nodebuffer"), script = JSON.parse(scriptBytes);
  assert.deepEqual(layout, old.persisted.editor_settings.runtimeUILayout);
  assert.equal(layout.layout_type, "renpy"); assert.equal(manifest.game_id, old.persisted.project_id);
  assert.equal(manifest.title, old.persisted.title); assert.equal(script.game_id, manifest.game_id);
  const components = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
  assert.equal(components.length, 2);
  assert.deepEqual(components.map(c => c.label).sort(), ["审核关于卡", "审核帮助卡"]);
  assert(!JSON.stringify(layout).includes("排除候选"));
  const ids = components.map(c => c.customComponent.root.children.find(n => n.tag === "img").assetId).sort();
  assert.deepEqual(manifest.assets.map(a => a.asset_id).sort(), ids);
  assert(!manifest.assets.some(a => ["private-project", "project-asset-1"].includes(a.asset_id)));
  const assets = [];
  for (const asset of manifest.assets) {
    const bytes = await zip.file(asset.path).async("nodebuffer");
    const hash = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    assert.equal(hash, old.image.sha256);
    assets.push({ id: asset.asset_id, path: asset.path, sha256: hash, bytes: bytes.length });
  }
  assert(!zip.file("project.json")); assert(!JSON.stringify(manifest).includes("test-only-secret"));
  for (const f of [...old.products, old.source, old.input, ...old.tools]) assert.equal(sha(f.path), f.sha256);
  report.cartridge = { ...desc(file), layoutSha256: require("node:crypto").createHash("sha256").update(layoutBytes).digest("hex"),
    scriptSha256: require("node:crypto").createHash("sha256").update(scriptBytes).digest("hex"), layout, manifest, assets };
  report.steps[2] = { label: old.steps[2].label, status: "PASS", result: report.cartridge,
    recoveredFrom: desc(source), strictLayoutEquality: true, newDownloads: 0 };
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, newDownloads: 0, newStarts: 0 })); });
