"use strict";
// Read-only candidate audit; never builds, installs or edits product files.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fileEvidence: desc, verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { validateConfig } = require("./installed-editor-android-candidate.cjs");
const { narrativeFixture } = require("./android-current-story-package.cjs");
const common = require("./android-current-renpy-wm.cjs").adapter();
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => require("node:crypto").createHash("sha256").update(bytes).digest("hex");
async function audit(configFile, number, recoveryFile) {
  assert.match(number, /^\d{2}$/);
  const c = read(configFile); validateConfig(c); narrativeFixture(c.storyFixture.path);
  const source = path.join(root, "editor-" + c.attempt), adminRoot = path.join(root, "administrator-" + c.attempt);
  const out = path.join(root, `story-artifact-${c.attempt}-audit-${number}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], sources: [desc(__filename)],
    config: desc(configFile), candidate: c, productChanges: 0, builds: 0, deviceOperations: 0, modelRequests: 0 };
  const verify = f => { assert.equal(sha(f.path), f.sha256, f.path); r.sources.push(desc(f.path)); };
  const load = f => { r.sources.push(desc(f)); return read(f); };
  const check = async (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  };
  try {
    const b = load(path.join(source, "report.json")); r.build = desc(path.join(source, "report.json"));
    await check("Actual frozen installation, one build, restored directory response, normal close and default data", () => {
      const admin = load(path.join(adminRoot, "result.json")), origin = load(path.join(adminRoot, "origin.json"));
      const task = load(path.join(adminRoot, "task-engine.json"));
      let boundary;
      if (!recoveryFile) boundary = common.terminal(c, b, admin, origin, task, load(path.join(source, "cache-restoration.json")));
      else {
        assert.equal(path.resolve(recoveryFile), path.join(source, "cache-recovery-02/report.json"));
        const recovered = load(recoveryFile), journal = load(path.join(source, "cache-protection.json"));
        assert.equal(b.status, "FAILED"); assert.equal(b.featureStatus, "PASS"); assert.equal(b.error, undefined);
        assert.match(b.cleanupError, /New-Item/); assert.match(b.cleanupError, /native-standalone-package/);
        assert.equal(b.builds, 1); assert.equal(b.version, c.version); assert(b.finishedAt);
        assert.equal(b.steps.length, 4); assert(b.steps.every(s => s.status === "PASS"));
        assert.deepEqual(b.errors, []); assert.equal(b.modelRequests, 0); assert.equal(b.productChanges, 0);
        assert.equal(b.currentNativeUI, true); assert.equal(b.sourceBuilderInvocation, false);
        assert.equal(b.normalUIExportStatus, "PASS_UI_CONTROLLED_DIRECTORY");
        assert.equal(b.nativePickerStatus, "NOT_RUN_CONTROLLED_INPUT"); assert.equal(b.nativeOutput, undefined);
        assert.equal(b.controlledOutput.status, "CONTROLLED_DIRECTORY_INJECTED");
        assert.equal(b.controlledOutput.result.calls, 1); assert.equal(b.controlledOutput.cleanup.restored, true);
        assert.equal(b.controlledOutput.persistedHook, false); assert.equal(b.controlledOutput.nativePickerTested, false);
        require("./android-current-controlled-wm.cjs").validateClose(b);
        assert.equal(origin.originIsElevated, false); assert.equal(origin.taskEngine, true);
        assert.equal(admin.isElevated, true); assert.equal(admin.taskEngine, true);
        assert.equal(admin.originProcessId, origin.originProcessId); assert.equal(admin.userSid, origin.userSid);
        assert(admin.probe.success && admin.probe.isElevated); assert.equal(admin.error, null);
        assert.equal(admin.status, "CHECK_EDITOR_REPORT"); assert.equal(admin.exitCode, 1);
        assert.equal(admin.policyRestoration, "PASS"); assert.equal(admin.physicalProtectionRestoration, "PASS");
        assert.equal(task.status, "TERMINAL"); assert.equal(task.cleanup, "PASS"); assert(task.finishedAt);
        assert.equal(recovered.status, "PASS_RECOVERED_QA_CACHE_ARCHIVE");
        assert.equal(recovered.originalWorkflowStatus, "FAILED_QA_ARCHIVE_COLLISION");
        assert.equal(recovered.deletedUserFiles, 0); assert.equal(recovered.rows.length, 4);
        for (const row of recovered.rows) {
          const original = journal.rows.find(v => v.original === row.original); assert(original);
          assert.equal(row.status, "PASS"); assert.equal(row.owned, original.owned);
          assert.equal(row.originalIdBefore, row.originalIdAfter); assert.notEqual(row.originalIdAfter, original.testDirectoryId);
          assert(!fs.existsSync(row.owned)); assert(!fs.existsSync(original.held));
          const id = execFileSync("fsutil.exe", ["file", "queryfileid", row.original], { encoding: "utf8", windowsHide: true });
          assert.equal(id.match(/0x[0-9a-fA-F]+/)[0].toLowerCase(), row.originalIdAfter);
          for (const f of row.files) { const archive = path.join(row.archive, f.relative); assert.equal(sha(archive), f.sha256); assert.equal(fs.statSync(archive).size, f.bytes); r.sources.push(desc(archive)); }
        }
        for (const f of b.protectedFiles) verify(f);
        boundary = { artifactBuildStatus: "PASS", normalEditorClose: "PASS_WM_CLOSE",
          publishingWorkflowStatus: "FAILED_QA_CACHE_ARCHIVE", cleanupRecovery: desc(recoveryFile),
          nativePicker: "NOT_RUN_CONTROLLED_INPUT", responseRestored: true };
        r.originalWorkflowStatus = boundary.publishingWorkflowStatus; r.cleanupRecovery = desc(recoveryFile);
      }
      verify(b.candidateBinding); const binding = load(b.candidateBinding.path);
      for (const f of binding.sources) verify(f);
      verify(b.installation); for (const f of b.tools) verify(f);
      const installed = load(b.installation.path);
      assert.equal(sha(installed.executable.path), "a1ece0a5d69cc0c319fd5d8fe6a9cdca8259f88fd7eeaeae1cc18e88c4fb5dd8");
      assert.deepEqual(b.storyFixture, desc(c.storyFixture.path));
      assert.equal(b.artifacts.length, 1); r.apk = b.artifacts[0]; verify(r.apk);
      return boundary;
    });
    await check("Actual materialized build inputs retained byte for byte before cache restoration", () => {
      r.materializedInputRetention = common.materializedEvidence(c, b, source);
      assert.equal(r.materializedInputRetention.status, "RETAINED");
      for (const f of r.materializedInputRetention.files) verify(f.archivedBytes);
      return r.materializedInputRetention;
    });
    const toolchain = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain";
    const tool = (relative, args, name) => {
      const executable = path.join(toolchain, relative); r.sources.push(desc(executable));
      const text = execFileSync(executable, args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
      const f = path.join(out, name); fs.writeFileSync(f, text, { flag: "wx" }); r.sources.push(desc(f)); return text;
    };
    await check("Real APK v2 signature, game identity and installed engine/protocol provenance", () => {
      const signature = tool("jdk-17/bin/java.exe", ["-jar", path.join(toolchain,
        "Sdk/build-tools/35.0.0/lib/apksigner.jar"), "verify", "--verbose", "--print-certs", r.apk.path], "signature.log");
      const badging = tool("Sdk/build-tools/35.0.0/aapt2.exe", ["dump", "badging", r.apk.path], "badging.log");
      assert.match(signature, /^Verifies\r?$/m); assert.match(signature, /^Verified using v2 scheme.*:\s*true\r?$/m);
      const certs = [...signature.matchAll(/^Signer #(\d+) certificate SHA-256 digest:\s*([a-f0-9]{64})\r?$/gim)];
      const identities = [...badging.matchAll(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/gm)];
      assert.equal(certs.length, 1); assert.equal(certs[0][1], "1"); assert.equal(identities.length, 1);
      const [, packageName, versionCode, versionName] = identities[0];
      r.identity = { packageName, versionCode: Number(versionCode), versionName, signerSha256: certs[0][2].toLowerCase() };
      assert.deepEqual(r.identity, { packageName: "com.agentvn.qa.narrative20261102", versionCode: c.versionCode,
        versionName: c.gameVersion, signerSha256: "c0eb991c5754b5556f8d5dcd966437c86e495e0fe7379fb76b35545247751718" });
      const metadata = load(r.apk.path + ".acceptance.json");
      assert.equal(verifyProvenance(r.apk.path, metadata).status, "PASS");
      assert.equal(metadata.editorVersion, c.version); assert.equal(metadata.gameVersion, c.gameVersion);
      assert.equal(metadata.packageName, r.identity.packageName);
      const installed = load(b.installation.path);
      for (const [kind, relative] of [["engine", "GameCli_framework/src-tauri/Cargo.toml"],
        ["protocol", "shared/cartridge/constants.ts"]])
        assert.equal(metadata.versionEvidence.sources[kind].sha256, sha(path.join(installed.installRoot, relative)));
      return r.identity;
    });
    const zip = await JSZip.loadAsync(fs.readFileSync(r.apk.path), { checkCRC32: true });
    await check("Complete authored graph, actual NVL/bubble commands and generated media bytes consumed by APK", async () => {
      verify(b.cartridge);
      const cart = await JSZip.loadAsync(fs.readFileSync(b.cartridge.path), { checkCRC32: true });
      const embedded = async name => {
        const entries = Object.values(zip.files).filter(f => !f.dir && f.name.endsWith("embedded-cartridge/" + name));
        assert.equal(entries.length, 1, name); return entries[0].async("nodebuffer");
      };
      const scriptBytes = await embedded("script.json"), layoutBytes = await embedded("ui/layout.json");
      r.jsonPackaging = [];
      for (const [name, actual, expectedHash] of [["script.json", scriptBytes, b.cartridge.scriptSha256],
        ["ui/layout.json", layoutBytes, b.cartridge.layoutSha256]]) {
        const original = await cart.file(name).async("nodebuffer"); assert.equal(hash(original), expectedHash);
        assert(actual.equals(original) || actual.length === original.length + 1
          && actual.subarray(0, original.length).equals(original) && actual.at(-1) === 10,
        "Native packaging may append one LF; all authored JSON bytes must otherwise match");
        assert.deepEqual(JSON.parse(actual), JSON.parse(original));
        r.jsonPackaging.push({ name, cartridgeSha256: hash(original), apkSha256: hash(actual),
          appendedSingleLF: actual.length === original.length + 1 });
      }
      const script = JSON.parse(scriptBytes), manifest = JSON.parse(await embedded("manifest.json"));
      const fixture = narrativeFixture(c.storyFixture.path);
      require("./lib/android-full-story-flow.cjs").validateFullStoryInput(read(c.storyFixture.path), manifest, script);
      assert.equal(JSON.parse(layoutBytes).layout_type, "renpy");
      const checksum = JSON.parse(await embedded("checksum.json")); r.assets = [];
      const optimization = load(path.join(path.dirname(r.apk.path), "release-optimization-report.json"));
      assert.equal(optimization.profile, "balanced"); assert.deepEqual(optimization.warnings, []);
      const sharp = require("../GameCli_framework/node_modules/sharp");
      assert.equal(optimization.tools.sharp, sharp.versions.sharp);
      const installed = load(b.installation.path);
      for (const name of ["build-release-runtime-assets.cjs", "optimize-release-images-batch.cjs"]) {
        const local = path.join(__dirname, name), deployed = path.join(installed.installRoot, "scripts", name);
        assert.equal(sha(local), sha(deployed)); r.sources.push(desc(local), desc(deployed));
      }
      assert.equal(manifest.assets.length, fixture.project.asset_manifest.length);
      for (const target of manifest.assets) {
        const original = fixture.project.asset_manifest.find(a => a.asset_id === target.asset_id); assert(original);
        const input = Buffer.from(original.metadata.data_url.split(",")[1], "base64");
        assert.equal(hash(await cart.file(original.metadata.path).async("nodebuffer")), hash(input));
        const actual = await embedded(target.path), expected = checksum.files.filter(f => f.path === target.path);
        assert.equal(expected.length, 1); assert.equal(expected[0].hash_sha256, hash(actual));
        assert.equal(expected[0].size_bytes, actual.length);
        let compare;
        if (original.asset_type === "bgm") {
          assert.equal(hash(actual), hash(input)); compare = { comparison: "GENERATED_WAV_BYTES_IDENTICAL_NOT_LISTENING" };
        } else {
          const steps = optimization.assets.filter(v => v.assetId === target.asset_id); assert.equal(steps.length, 1);
          assert.equal(steps[0].status, "optimized"); assert.equal(steps[0].originalBytes, input.length);
          assert.equal(steps[0].resultBytes, actual.length);
          if (original.asset_type === "background") {
            assert.equal(steps[0].mode, "quality-90-webp");
            const expectedBytes = await sharp(input, { failOn: "error", limitInputPixels: 268402689, sequentialRead: true })
              .webp({ quality: 90, alphaQuality: 100, smartSubsample: true, effort: 5 }).toBuffer();
            assert.equal(hash(expectedBytes), hash(actual), "Exact declared quality-90 optimizer output must match");
            const before = await sharp(input).metadata(), after = await sharp(actual).metadata();
            assert.equal(before.width, after.width); assert.equal(before.height, after.height);
            compare = { comparison: "EXACT_DECLARED_QUALITY90_WEBP_BYTES", width: after.width, height: after.height };
          } else {
            assert.equal(steps[0].mode, "lossless-webp");
            compare = await common.compareOptimizedResource(input, actual, "ui", "");
          }
        }
        r.assets.push({ id: target.asset_id, type: original.asset_type, path: target.path, bytes: actual.length,
          sha256: hash(actual), sourceSha256: hash(input), ...compare });
      }
      return { scriptSha256: hash(scriptBytes), layoutSha256: hash(layoutBytes), scenes: 4, assets: r.assets };
    });
    await check("Optimized DEX retains lifecycle JNI and PluginManager bridge for the actual package", async () => {
      const inspector = require("./android-runtime-lifecycle-dex-audit.cjs");
      const entries = Object.values(zip.files).filter(f => /^classes(?:\d+)?\.dex$/.test(f.name));
      assert(entries.length); let classCount = 0, methods = [], dumps = [];
      for (const entry of entries) {
        const f = path.join(out, entry.name), dump = f + ".txt";
        fs.writeFileSync(f, await entry.async("nodebuffer"), { flag: "wx" }); const fd = fs.openSync(dump, "wx");
        try {
          const result = spawnSync(path.join(toolchain, "Sdk/build-tools/35.0.0/dexdump.exe"), [f],
            { windowsHide: true, stdio: ["ignore", fd, "pipe"], timeout: 90000 });
          assert.equal(result.status, 0, result.stderr?.toString());
        } finally { fs.closeSync(fd); }
        const text = fs.readFileSync(dump, "utf8"), result = inspector.inspectLifecycle(text, r.identity.packageName);
        classCount += result.classCount; methods.push(...result.methods); dumps.push(text);
        r.sources.push(desc(f), desc(dump));
      }
      assert.equal(classCount, 1); assert.equal(methods.length, 5);
      return { methods, pluginBridge: inspector.inspectPluginBridge(dumps.join("\n"), r.identity.packageName) };
    });
    await check("Owned processes and ports released; real screenshot parameters match actual PNG pixels", () => {
      const live = rows(), known = [...b.knownProcesses, ...b.buildKnownProcesses];
      assert(!known.some(p => live.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
      assert.deepEqual(listeners(b.launches.flatMap(l => l.ports)), []); assert(b.screenshots.length >= 3);
      for (const shot of b.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        validateNativeViewport(shot.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
        const bytes = fs.readFileSync(shot.path); assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1080);
      }
      return { screenshots: b.screenshots.length, displayMatrix: "NOT_CLAIMED" };
    });
    r.status = recoveryFile ? "NARRATIVE_APK_ARTIFACT_PASS_AFTER_QA_CACHE_RECOVERY_DEVICE_NOT_RUN"
      : "NARRATIVE_APK_ARTIFACT_PASS_DEVICE_NOT_RUN";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, out, checks: r.checks.map(s => ({ name: s.name, status: s.status })), error: r.error }));
}
if (require.main === module) audit(...process.argv.slice(2)).catch(e => { console.error(e); process.exitCode = 1; });
