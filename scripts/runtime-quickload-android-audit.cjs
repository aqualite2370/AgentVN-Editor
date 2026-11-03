"use strict";
// Static checks only. A valid source APK is still not device or installed-editor acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { execFileSync, spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { directory, validatePrepared } = require("./runtime-quickload-android-build.cjs");
const { fileEvidence, verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { inspectLifecycle, inspectPluginBridge } = require("./android-runtime-lifecycle-dex-audit.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function assetEvidence(asset, actual, original) {
  assert.equal(typeof asset.asset_id, "string"); assert(asset.asset_id.length);
  assert.equal(hash(actual), hash(original));
  return { id: asset.asset_id, path: asset.path, sha256: hash(actual), bytes: actual.length };
}
async function main() {
  const out = directory(process.argv[2]), reportDir = path.join(out, "audit");
  const p = read(path.join(out, "preparation.json")), b = read(path.join(out, "build-report.json"));
  const admin = read(path.join(out, "administrator.json")), origin = read(path.join(out, "origin.json"));
  assert.equal(b.status, "SOURCE_QUICKLOAD_APK_BUILT_DEVICE_NOT_RUN"); assert(b.finishedAt);
  fs.mkdirSync(reportDir);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "SOURCE_QUICKLOAD_APK_STATIC_NOT_INSTALLED_PUBLISH_OR_DEVICE", checks: [],
    sources: [path.join(out, "preparation.json"), path.join(out, "build-report.json"),
      path.join(out, "administrator.json"), path.join(out, "origin.json"), __filename].map(fileEvidence),
    modelRequests: 0, productChanges: 0 };
  const check = async (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (error) { row.status = "FAILED"; throw error; }
  };
  const command = (exe, args, name) => {
    const value = execFileSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
    const file = path.join(reportDir, name); fs.writeFileSync(file, value, { flag: "wx" });
    r.sources.push(fileEvidence(file)); return value;
  };
  try {
    await check("Single elevated source build, successful symlink and original/clone source restoration", () => {
      assert.equal(b.buildInvocations, 1); assert.equal(b.exitCode, 0);
      assert.equal(b.sourceAndCloneRestoration, "PASS");
      assert.equal(admin.isElevated, true); assert.equal(admin.permission.isElevated, true);
      assert.equal(admin.permission.success, true); assert.equal(admin.exitCode, 0); assert(admin.finishedAt);
      assert.equal(origin.originIsElevated, false); assert.equal(origin.userSid, admin.userSid);
      assert.equal(origin.processId, admin.originProcessId); validatePrepared(p, out);
      const compiler = read(b.compilerSnapshot.path);
      assert.equal(fileEvidence(b.compilerSnapshot.path).sha256, b.compilerSnapshot.sha256);
      assert.equal(compiler.status, "PASS"); assert.equal(compiler.files.length, 8);
      assert.equal(compiler.packageName, p.releaseIdentity.androidApplicationId);
      for (const row of compiler.files) assert.equal(fileEvidence(row.snapshot.path).sha256, row.snapshot.sha256);
      return { sourcesChecked: p.sources.length, compilerInputs: compiler.files.length };
    });
    const apk = b.apk; assert.equal(fileEvidence(apk.path).sha256, apk.sha256);
    r.apk = apk; r.sources.push(apk);
    const tools = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain";
    await check("Actual signature, package and game/embedded version agree", () => {
      const signed = command(path.join(tools, "jdk-17/bin/java.exe"),
        ["-jar", path.join(tools, "Sdk/build-tools/35.0.0/lib/apksigner.jar"),
          "verify", "--verbose", "--print-certs", apk.path], "signature.log");
      assert.match(signed, /^Verifies\r?$/m); assert.match(signed, /^Verified using v2 scheme.*:\s*true\r?$/m);
      const certs = [...signed.matchAll(/^Signer #(\d+) certificate SHA-256 digest:\s*([a-f0-9]{64})\r?$/gim)];
      assert.equal(certs.length, 1);
      const badging = command(path.join(tools, "Sdk/build-tools/35.0.0/aapt2.exe"),
        ["dump", "badging", apk.path], "badging.log");
      const actual = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
      assert(actual);
      assert.equal(actual[1], p.releaseIdentity.androidApplicationId);
      assert.equal(Number(actual[2]), p.releaseIdentity.versionCode); assert.equal(actual[3], p.releaseIdentity.versionName);
      const evidence = read(b.provenance.path);
      assert.equal(verifyProvenance(apk.path, evidence).status, "PASS");
      assert.equal(evidence.sourceCartridge.sha256, p.cartridge.sha256);
      assert.equal(evidence.gameVersion, actual[3]);
      r.identity = { packageName: actual[1], versionCode: Number(actual[2]), versionName: actual[3],
        signerSha256: certs[0][2].toLowerCase() };
      return r.identity;
    });
    const zip = await JSZip.loadAsync(fs.readFileSync(apk.path), { checkCRC32: true });
    await check("Authored script, layout and seven resource bytes preserved", async () => {
      const source = await JSZip.loadAsync(fs.readFileSync(p.cartridge.path), { checkCRC32: true });
      const embedded = async name => {
        const entries = Object.values(zip.files).filter(f => !f.dir && f.name.endsWith("embedded-cartridge/" + name));
        assert.equal(entries.length, 1, name); return entries[0].async("nodebuffer");
      };
      for (const name of ["script.json", "ui/layout.json"])
        assert.deepEqual(JSON.parse(await embedded(name)), JSON.parse(await source.file(name).async("string")));
      const sourceManifest = JSON.parse(await source.file("manifest.json").async("string"));
      const manifest = JSON.parse(await embedded("manifest.json"));
      assert.equal(manifest.version, r.identity.versionName); assert.equal(manifest.game_id, sourceManifest.game_id);
      assert.equal(manifest.assets.length, 7); assert.equal(sourceManifest.assets.length, 7);
      r.embeddedAssets = [];
      for (const asset of sourceManifest.assets) {
        const actual = await embedded(asset.path), original = await source.file(asset.path).async("nodebuffer");
        r.embeddedAssets.push(assetEvidence(asset, actual, original));
      }
      return { assetCount: r.embeddedAssets.length, fullParsedLayoutAndScript: true };
    });
    await check("Final release DEX retains inherited getter and all five lifecycle JNI methods", async () => {
      const tool = path.join(tools, "Sdk/build-tools/36.0.0/dexdump.exe");
      r.sources.push(fileEvidence(tool));
      const dex = Object.values(zip.files).filter(f => /^classes(?:\d+)?\.dex$/.test(f.name));
      assert(dex.length); const dumps = []; let classes = 0; const methods = [];
      for (const entry of dex) {
        const file = path.join(reportDir, entry.name), dump = file + ".txt";
        fs.writeFileSync(file, await entry.async("nodebuffer"), { flag: "wx" });
        const fd = fs.openSync(dump, "wx"); let value;
        try { value = spawnSync(tool, [file], { windowsHide: true, encoding: "utf8",
          stdio: ["ignore", fd, "pipe"], timeout: 90000 }); } finally { fs.closeSync(fd); }
        assert.equal(value.status, 0, value.stderr);
        const text = fs.readFileSync(dump, "utf8"), inspected = inspectLifecycle(text, r.identity.packageName);
        classes += inspected.classCount; methods.push(...inspected.methods); dumps.push(text);
        r.sources.push(fileEvidence(file), fileEvidence(dump));
      }
      assert.equal(classes, 1); assert.equal(methods.length, 5);
      return { methods, inheritedGetter: inspectPluginBridge(dumps.join("\n"), r.identity.packageName) };
    });
    r.status = "SOURCE_QUICKLOAD_APK_STATIC_PASS_DEVICE_NOT_RUN";
  } catch (error) { r.status = "FAILED"; r.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    r.finishedAt = new Date().toISOString();
    for (const row of r.sources) assert.equal(fileEvidence(row.path).sha256, row.sha256);
    fs.writeFileSync(path.join(reportDir, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, reportDir, error: r.error }));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { assetEvidence };
