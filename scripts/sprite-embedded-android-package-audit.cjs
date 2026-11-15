"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const sharp = require("../GameCli_framework/node_modules/sharp");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const base = "F:/testavn/Sprite-Embedded-Android-1975-20261116-01";
const output = path.join(base, "package-audit-01.json");
assert(!fs.existsSync(output));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
const abis = { "arm64-v8a": "aarch64-linux-android", "armeabi-v7a": "armv7-linux-androideabi",
  x86: "i686-linux-android", x86_64: "x86_64-linux-android" };
const r = { status: "RUNNING", at: new Date().toISOString(), cases: [], links: [], inputs: [],
  editorBuilds: 0, models: 0, scope: "SUPPORTED_BUILD_TWO_REAL_UI_CARTRIDGES_EMBEDDED_ASSETS_AND_FOUR_ABIS_NOT_DEVICE" };
function input(file) { r.inputs.push(desc(file)); return read(file); }
(async () => {
  const build = input(path.join(base, "administrator.json")), prep = input(path.join(base, "preparation.json"));
  assert.equal(build.status, "PASS_TWO_INSTALLED_RESOURCE_APK_BUILDS_DEVICE_PENDING");
  assert(build.isElevated && build.persistentEnvironmentUnchanged);
  assert.equal(build.builds.length, 2); assert(build.builds.every(b => b.status === "PASS"));
  assert.equal(prep.sources.length, 351);
  for (const source of prep.sources) assert.equal(sha(path.join(prep.sourceRoot, source.file)), source.sha256);
  for (const type of ["agentvn", "renpy"]) {
    const original = prep.builds.find(b => b.type === type).cartridge;
    assert.equal(sha(original.path), original.sha256);
    const manifest = input(path.join(base, type, "diagnostics/package-build-manifest.json"));
    const probe = input(path.join(base, type, "diagnostics/android-symlink-capability-runner.json"));
    const optimization = input(path.join(base, type, "diagnostics/release-optimization-report.json"));
    assert.equal(manifest.status, "PASS"); assert(probe.success && probe.isElevated);
    const artifact = manifest.artifacts.find(a => a.kind === "android_apk_signed");
    assert.equal(artifact.applicationId, "com.agentvn.qa.sprite1975." + type);
    assert.equal(artifact.versionName, "0.1.0"); assert.equal(artifact.versionCode, 1);
    assert.match(artifact.certificateSha256, /^[A-F0-9]{64}$/);
    const row = { type, apk: desc(artifact.path), signature: artifact.certificateSha256,
      sourceCartridge: original, native: [], assets: [], status: "RUNNING" };
    r.cases.push(row); assert.equal(row.apk.sha256, build.builds.find(b => b.type === type).apk.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(artifact.path), { checkCRC32: true });
    const source = await JSZip.loadAsync(fs.readFileSync(original.path), { checkCRC32: true });
    const prefix = "assets/embedded-cartridge/";
    const packedManifest = JSON.parse(await zip.file(prefix + "manifest.json").async("string"));
    const sourceManifest = JSON.parse(await source.file("manifest.json").async("string"));
    assert.equal(packedManifest.game_id, sourceManifest.game_id);
    assert.equal(packedManifest.entry_scene_id, sourceManifest.entry_scene_id);
    const actualScript = JSON.parse(await zip.file(prefix + packedManifest.entry_script).async("string"));
    const sourceScript = JSON.parse(await source.file(sourceManifest.entry_script).async("string"));
    assert.deepEqual(actualScript, sourceScript, "Real authored sprite commands reach embedded APK");
    const packedLayout = JSON.parse(await zip.file(prefix + "ui/layout.json").async("string"));
    assert.deepEqual(packedLayout, JSON.parse(await source.file("ui/layout.json").async("string")));
    assert.equal(packedLayout.layout_type || "agentvn", type);
    for (const asset of sourceManifest.assets) {
      const packed = packedManifest.assets.find(a => a.asset_id === asset.asset_id);
      assert(packed, "No omitted source image");
      const expectedBytes = await source.file(asset.path).async("nodebuffer");
      const actualBytes = await zip.file(prefix + packed.path).async("nodebuffer");
      const expected = await sharp(expectedBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const actual = await sharp(actualBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual(actual.info, expected.info);
      const optimizationAsset = optimization.assets.find(a => a.assetId === asset.asset_id);
      assert(optimizationAsset);
      const pixelExact = hash(actual.data) === hash(expected.data);
      if (asset.asset_type === "sprite") {
        assert.equal(optimizationAsset.mode, "lossless-webp");
        assert(pixelExact, "Original sprite pixels retained");
      } else assert.equal(optimizationAsset.mode, "quality-90-webp",
        "Background follows the normal declared lossy profile, not a lossless-pixel claim");
      let maximumChannelDifference = 0, absoluteDifference = 0;
      for (let i = 0; i < actual.data.length; i++) {
        const difference = Math.abs(actual.data[i] - expected.data[i]);
        maximumChannelDifference = Math.max(maximumChannelDifference, difference);
        absoluteDifference += difference;
      }
      row.assets.push({ assetId: asset.asset_id, sourcePath: asset.path, packedPath: packed.path,
        width: actual.info.width, height: actual.info.height, pixelSha256: hash(actual.data),
        sourceSha256: hash(expectedBytes), packedSha256: hash(actualBytes), pixelExact,
        optimizationMode: optimizationAsset.mode, maximumChannelDifference,
        meanChannelDifference: absoluteDifference / actual.data.length });
    }
    assert.equal(row.assets.length, 3);
    for (const abi of Object.keys(abis)) {
      const bytes = await zip.file(`lib/${abi}/libagentvn_player_lib.so`).async("nodebuffer");
      assert(bytes.length > 1000000); assert.equal(bytes.subarray(0, 4).toString("hex"), "7f454c46");
      row.native.push({ abi, bytes: bytes.length, sha256: hash(bytes) });
    }
    assert.equal(row.native.find(n => n.abi === "x86_64").sha256,
      build.builds.find(b => b.type === type).nativeLibrary.sha256);
    row.status = "PASS";
  }
  for (const [abi, target] of Object.entries(abis)) {
    const link = path.join(prep.sourceRoot, "GameCli_framework/src-tauri/gen/android/app/src/main/jniLibs",
      abi, "libagentvn_player_lib.so");
    assert(fs.lstatSync(link).isSymbolicLink());
    const destination = fs.realpathSync(link);
    const expected = path.join(prep.sourceRoot, "GameCli_framework/src-tauri/target", target, "release/libagentvn_player_lib.so");
    assert.equal(path.resolve(destination).toLowerCase(), path.resolve(expected).toLowerCase());
    assert.equal(sha(destination), r.cases.find(c => c.type === "renpy").native.find(n => n.abi === abi).sha256);
    r.links.push({ path: link, target: destination, sha256: sha(destination) });
  }
  r.status = "PASS_TWO_EMBEDDED_UI_AUTHOR_CARTRIDGES_FOUR_ABIS_SPRITE_PIXELS_DEVICE_PENDING";
})().catch(error => { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; })
  .finally(() => {
    r.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, cases: r.cases.length, error: r.error, output }));
  });
