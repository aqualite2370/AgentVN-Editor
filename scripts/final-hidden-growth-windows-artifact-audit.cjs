"use strict";
// Source bytes and optimized release bytes are distinct evidence surfaces.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const sharp = require("../GameCli_framework/node_modules/sharp");
const A = require("./lib/installed-acceptance.cjs");
assert.equal(process.argv.length, 5, "node audit <windows-run> <input-provenance.json> <fresh-review.json>");
const [run, provenanceFile, reportFile] = process.argv.slice(2).map(p => path.resolve(p));
assert(!fs.existsSync(reportFile));
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const evidence = f => ({ path: f, sha256: A.sha256(fs.readFileSync(f)), bytes: fs.statSync(f).size });
const provenance = read(provenanceFile), original = read(path.join(run, "source-cartridge-original-bytes.json"));
const session = path.join(run, "installed-session"), portable = path.join(session, "windows-export/portable");
const report = { status: "RUNNING", scope: "Final-project actual Windows UI export and optimization provenance; native runtime pending",
  startedAt: new Date().toISOString(), run, inputProvenance: evidence(provenanceFile),
  originalCartridgeEvidence: evidence(path.join(run, "source-cartridge-original-bytes.json")), assets: [] };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
(async () => {
  save();
  assert.equal(original.status, "SOURCE_CARTRIDGE_ORIGINAL_BYTES_PASS");
  assert.equal(original.provenanceSha256, report.inputProvenance.sha256);
  assert.equal(original.assets.length, 143); assert.equal(provenance.assets.length, 143);
  assert.equal(evidence(provenance.source).sha256, provenance.sourceSha256);
  const prior = read(path.join(run, "report.json"));
  assert(prior.cases.some(c => c.name.startsWith("Native import") && c.status === "PASS"));
  assert(prior.cases.some(c => c.count === 48 && c.status === "PASS"));
  const uiNames = fs.readdirSync(session).filter(n => n.startsWith("windows-export-ui-")); assert.equal(uiNames.length, 1);
  const uiFile = path.join(session, uiNames[0], "report.json"), ui = read(uiFile);
  assert.equal(ui.status, "RESULT_READY"); assert.match(ui.result, /Windows[\s\S]*构建成功/);
  report.uiExport = evidence(uiFile); report.initialHarness = evidence(path.join(run, "report.json"));
  report.initialHarnessStatus = prior.status;
  // A failed byte-equality assumption is not a product failure or a new build.
  if (prior.status === "FAILED") {
    assert.match(prior.error, /AssertionError/);
    assert.equal(prior.commands.at(-1).name, "windows-ui-export");
    assert.equal(prior.commands.at(-1).status, "PASS");
    assert.equal(prior.inputPreserved, true); assert.equal(prior.sourcePreserved, true);
    report.initialHarnessLimitation = "Original test compared compressed release bytes directly with source bytes. Original failure retained; this audit verifies both surfaces without rebuilding.";
  }
  // Successful disposable builds remove the staging diagnostic directory.
  // The optimizer publishes its report beside the delivered EXE/installer.
  const optimizationFile = path.join(session, "windows-export/release-optimization-report.json"), optimization = read(optimizationFile);
  assert.equal(optimization.profile, "balanced"); assert.deepEqual(optimization.warnings, []);
  report.optimization = evidence(optimizationFile);
  const cart = path.join(portable, "embedded-cartridge"), manifestFile = path.join(cart, "manifest.json");
  const manifest = read(manifestFile);
  assert.equal(manifest.game_id, "project_msiz08p7_0_89ebc8a8cb"); assert.equal(manifest.assets.length, 143);
  const optimized = new Map(optimization.assets.map(a => [a.assetId, a]));
  for (const source of provenance.assets) {
    const before = original.assets.find(a => a.assetId === source.assetId);
    assert.equal(before.sha256, source.sha256); assert.equal(before.bytes, source.bytes);
    const asset = manifest.assets.find(a => a.asset_id === source.assetId);
    assert(asset); const file = path.join(cart, asset.path);
    assert(A.inside(cart, file)); const actual = evidence(file);
    assert.equal(actual.sha256, asset.hash_sha256);
    assert.equal(actual.bytes, asset.size_bytes);
    const row = { assetId: source.assetId, sourceSha256: source.sha256, final: actual };
    if (actual.sha256 !== source.sha256) {
      const changed = optimized.get(source.assetId);
      assert(changed && changed.status === "optimized", `Unexplained resource change: ${source.assetId}`);
      assert.equal(changed.originalBytes, source.bytes); assert.equal(changed.resultBytes, actual.bytes);
      row.optimization = changed;
      if (changed.kind === "image") {
        const sourceImage = await sharp(source.source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const finalImage = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(finalImage.info.width, sourceImage.info.width);
        assert.equal(finalImage.info.height, sourceImage.info.height);
        row.image = { width: finalImage.info.width, height: finalImage.info.height };
        if (changed.mode === "lossless-webp") {
          // RGB behind alpha=0 is not painted; WebP may discard that invisible
          // data while preserving every visible RGBA value and alpha byte.
          for (const buffer of [sourceImage.data, finalImage.data]) {
            for (let offset = 0; offset < buffer.length; offset += 4)
              if (buffer[offset + 3] === 0) buffer[offset] = buffer[offset + 1] = buffer[offset + 2] = 0;
          }
          const inputHash = A.sha256(sourceImage.data), outputHash = A.sha256(finalImage.data);
          assert.equal(outputHash, inputHash, `Lossless image pixels changed: ${source.assetId}`);
          row.image.decodedPixelSha256 = inputHash; row.image.decodedPixelsPreserved = true;
          row.image.comparison = "RGBA8; normalize invisible RGB only where alpha=0";
        } else assert.equal(changed.mode, "quality-90-webp");
      }
    } else row.sourceBytesPreserved = true;
    report.assets.push(row);
  }
  const exes = fs.readdirSync(portable).filter(n => n.endsWith(".exe")); assert.equal(exes.length, 1);
  report.executable = evidence(path.join(portable, exes[0]));
  report.manifest = evidence(manifestFile); report.script = evidence(path.join(cart, "script.json"));
  report.layout = evidence(path.join(cart, "ui/layout.json"));
  const script = read(report.script.path); assert(script.scenes.length >= 16);
  report.sceneCount = script.scenes.length;
  report.sourceCartridge = { path: original.sourcePath, sha256: original.sourceSha256,
    bytes: original.sourceBytes, cleanedAfterBuild: !fs.existsSync(original.sourcePath) };
  report.cases = [
    { name: "143 original input/cartridge assets verified", status: "PASS" },
    { name: "143 final asset hashes and optimization mappings verified", status: "PASS" },
    { name: "Lossless image decoded pixels and all image dimensions preserved", status: "PASS" },
    { name: "Actual installed native Windows export and artifact identity", status: "PASS" },
  ];
  report.status = "INSTALLED_FINAL_WINDOWS_EXPORT_AUDIT_PASS_RUNTIME_PENDING";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, reportFile, assets: report.assets.length, error: report.error }));
});
