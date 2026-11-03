"use strict";
// Replays actual prior installed UI save data through installed shared modules
// and the current source exporter. Explicitly not a new installed UI/export test.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), req = createRequire(path.join(root, "editor/package.json"));
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = `F:/AgentVN/QA/Layout-Pages-Evidence-20261021-01/export-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fileSha = file => sha(fs.readFileSync(file));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sourceReport = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-31/report.json";
const receiptFile = "F:/AgentVN/QA/Editor-1.9.13-20261021-01/installation.json";
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], sources: [],
  modelRequests: 0, productChanges: 0, nativeUiStatus: "NOT_RUN", playerConsumption: "NOT_RUN",
  scope: "SOURCE_ZIP_EXPORT_REPLAY_OF_PRIOR_INSTALLED_PERSISTED_DATA_NOT_INSTALLED_UI_AUTHOR_CHAIN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function load(base, contents) {
  const compiled = req("esbuild").buildSync({ stdin: { resolveDir: base, contents, loader: "ts" },
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false, metafile: true });
  for (const p of Object.keys(compiled.metafile.inputs).filter(p => !p.startsWith("<"))) {
    const filename = path.resolve(root, p);
    report.sources.push({ path: filename, sha256: fileSha(filename) });
  }
  const module = { exports: {} };
  new Function("module", "exports", "require", compiled.outputFiles[0].text)(module, module.exports, req);
  return module.exports;
}
const pages = [
  ["title", "title_hero"], ["player", "dialog_panel"], ["game_menu", "game_menu_nav"],
  ["save_load", "save_grid"], ["preferences", "settings_group"], ["history", "history_list"],
  ["gallery", "gallery_grid"], ["about", "about_panel"],
];
(async () => {
  const receipt = read(receiptFile), prior = read(sourceReport);
  assert.equal(receipt.status, "PASS"); assert.equal(prior.status, "PASS");
  assert.equal(fileSha(receipt.executable.path), receipt.executable.sha256);
  const installed = load(receipt.installRoot, `
    export { resolveRuntimeUILayoutSettings, updateActiveRuntimeUILayout, switchRuntimeUILayoutType }
      from "./shared/cartridge/uiLayoutProfiles";
    export { normalizeUISkinLayoutForRuntime, getDefaultUISkinLayout, validateUISkinHealth }
      from "./shared/cartridge/uiSkin";`);
  const source = load(root, 'export { exportEditorCartridge } from "./editor/src/cartridge/exportCartridge";');
  const installedShared = report.sources.filter(s => s.path.toLowerCase().startsWith(path.resolve(receipt.installRoot).toLowerCase() + path.sep)
    && s.path.toLowerCase().includes("shared"));
  assert(installedShared.length > 5);
  for (const s of installedShared) {
    const current = path.join(root, path.relative(receipt.installRoot, s.path));
    assert.equal(fileSha(current), s.sha256, `Installed/source shared mismatch: ${s.path}`);
  }
  report.provenance = { prior: { path: sourceReport, sha256: fileSha(sourceReport) },
    receipt: { path: receiptFile, sha256: fileSha(receiptFile) },
    sharedByteParity: installedShared.length, exporter: "CURRENT_SOURCE_NOT_NATIVE_INSTALLED_UI" };
  const baseline = structuredClone(prior.persistedProfiles), original = JSON.stringify(baseline);
  const assetFixtures = ["agentvn", "renpy"].map((type, i) => ({
    asset_id: `layout-${type}-exclusive`, asset_type: "ui", filename: `${type} 独占.svg`,
    mime_type: "image/svg+xml", path: `assets/ui/${type}-独占.svg`,
    bytes: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="${i ? "#064e3b" : "#312e81"}"/></svg>`),
  }));
  const assets = assetFixtures.map(({ bytes, ...a }) => ({ ...a, size_bytes: bytes.length }));
  const refs = assetFixtures.map(a => ({ asset_id: a.asset_id, asset_type: a.asset_type,
    metadata: { filename: a.filename, display_name: a.filename, mime_type: a.mime_type,
      size_bytes: a.bytes.length, project_path: a.path, data_url: `data:${a.mime_type};base64,${a.bytes.toString("base64")}` } }));
  let settings = installed.resolveRuntimeUILayoutSettings({ runtimeUILayoutProfiles: baseline });
  for (const [type, layout] of Object.entries(settings.runtimeUILayoutProfiles.profiles)) {
    const hero = layout.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_hero");
    hero.style = { ...hero.style, backgroundImage: `asset:layout-${type}-exclusive` };
  }
  let cases = 0;
  for (const type of ["agentvn", "renpy"]) {
    settings = installed.switchRuntimeUILayoutType(settings, type);
    for (const [i, [screenId, componentId]] of [...pages, ...(type === "renpy" ? [["help", "help_panel"]] : [])].entries()) {
      const before = structuredClone(settings), other = type === "agentvn" ? "renpy" : "agentvn";
      const draft = structuredClone(settings.runtimeUILayout);
      const part = draft.screens.find(s => s.screen_id === screenId).components.find(c => c.component_id === componentId);
      assert(part);
      const color = "#" + (0x162839 + i * 0x010203).toString(16);
      part.style = { ...part.style, backgroundColor: color };
      const next = installed.updateActiveRuntimeUILayout(settings, draft);
      assert.deepEqual(settings, before, "Author update cannot mutate caller");
      assert.deepEqual(next.runtimeUILayoutProfiles.profiles[other], before.runtimeUILayoutProfiles.profiles[other],
        "Author update cannot mutate inactive layout");
      assert.deepEqual(installed.resolveRuntimeUILayoutSettings(next), next, "Reopen must be idempotent");
      assert.deepEqual(next.runtimeUILayout, next.runtimeUILayoutProfiles.profiles[type]);
      const sourceBeforeExport = structuredClone(next);
      const exported = await source.exportEditorCartridge({
        gameId: "layout-pages-evidence", title: "布局证据离线回放", author: "QA", version: "1.0.0",
        language: "zh-CN", description: "非安装版用户导出流程", includeGallery: false, includeMetadata: false,
        projectAssets: assets, projectAssetRefs: refs, uiLayoutProfiles: next.runtimeUILayoutProfiles,
        script: { schema_version: "1.1.0", game_id: "layout-pages-evidence", title: "布局证据离线回放",
          entry_scene_id: "entry", characters: [], scenes: [{ scene_id: "entry", title: "入口", chapter: 1,
            tags: [], commands: [{ type: "narration", text: "独立小工程，无用户剧情或模型调用。" }] }] },
      });
      assert.deepEqual(exported.errors, []);
      const bytes = Buffer.from(await exported.blob.arrayBuffer()), zip = await req("jszip").loadAsync(bytes);
      const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer");
      const packed = JSON.parse(layoutBytes), manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      const checksum = JSON.parse(await zip.file("checksum.json").async("string"));
      assert.equal(checksum.algorithm, "sha256");
      assert.deepEqual(packed, JSON.parse(JSON.stringify(
        installed.normalizeUISkinLayoutForRuntime(next.runtimeUILayout).layout)),
      "Packed JSON must equal the canonical layout after JSON's ordinary undefined omission");
      assert.equal(packed.screens.find(s => s.screen_id === screenId).components.find(c => c.component_id === componentId)
        .style.backgroundColor, color);
      assert.deepEqual(manifest.assets.map(a => a.asset_id), [`layout-${type}-exclusive`]);
      const declared = manifest.assets[0], asset = assetFixtures.find(a => a.asset_id === declared.asset_id);
      assert.deepEqual(await zip.file(declared.path).async("nodebuffer"), asset.bytes);
      assert.equal(zip.file(assetFixtures.find(a => a !== asset).path), null);
      for (const f of checksum.files) {
        assert(zip.file(f.path), `Checksum target missing: ${f.path}`);
        const actual = await zip.file(f.path).async("nodebuffer");
        assert.match(f.hash_sha256, /^[a-f0-9]{64}$/);
        assert.equal(sha(actual), f.hash_sha256, `Checksum mismatch: ${f.path}`);
      }
      assert(!JSON.stringify(packed).includes("runtimeUILayoutProfiles"));
      assert.deepEqual(next, sourceBeforeExport, "ZIP export cannot mutate author data");
      const target = path.join(out, `${type}-${screenId}.vncart`);
      fs.writeFileSync(target, bytes, { flag: "wx" });
      report.cases.push({ type, screenId, componentId, status: "PASS", color, path: target,
        sha256: sha(bytes), layoutSha256: sha(layoutBytes), bytes: bytes.length,
        runtimeVersion: manifest.runtime_version, warnings: exported.warnings,
        activeAsset: { path: declared.path, sha256: sha(asset.bytes) }, inactiveAssetExcluded: true,
        inactiveProfileUnchanged: true, authorInputUnchanged: true, checksumEntries: checksum.files.length });
      cases++; settings = next; save();
    }
  }
  assert.equal(cases, 17); assert.equal(JSON.stringify(baseline), original);
  const defaults = installed.validateUISkinHealth(installed.getDefaultUISkinLayout());
  report.defaultPlayerWarnings = defaults.warnings.filter(i => i.path?.startsWith("ui.player."));
  const previousHealth = installed.validateUISkinHealth(baseline.profiles.agentvn);
  assert.deepEqual(previousHealth.warnings.filter(i => i.path?.startsWith("ui.player.")),
    report.defaultPlayerWarnings, "The six player warnings must be inherited, not introduced by name radius edits");
  assert.equal(report.defaultPlayerWarnings.length, 6);
  report.finalSettings = settings;
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
    save(); console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
  });
