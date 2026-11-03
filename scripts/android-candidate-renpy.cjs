"use strict";
// Candidate-bound official-GUI acceptance. Reuses the frozen ADB flow, never
// modifies product files or treats the controlled directory as a native picker.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), { execFileSync, spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { validateConfig } = require("./installed-editor-android-candidate.cjs");
const { fileEvidence: desc, verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => require("node:crypto").createHash("sha256").update(bytes).digest("hex");
const verify = file => { assert.equal(sha(file.path), file.sha256, file.path); return file; };
const replace = (s, a, b) => {
  assert.equal(s.split(a).length - 1, 1, a); return s.replace(a, b);
};
const pkg = "com.agentvn.qa.renpygui20261025";
function config(file) {
  const c = read(file); validateConfig(c); assert.equal(c.fixtureKind, "renpy-official");
  assert.equal(c.outputDirectoryMode, "controlled-once"); return c;
}
function terminal(c, b, admin, origin, task, restored, artifactOnly = false) {
  assert.equal(typeof artifactOnly, "boolean");
  assert.equal(b.version, c.version); assert(b.finishedAt);
  assert.equal(b.builds, 1); assert.equal(b.featureStatus, "PASS");
  assert.equal(b.currentNativeUI, true); assert.equal(b.normalUIExportStatus, "PASS_UI_CONTROLLED_DIRECTORY");
  assert.equal(b.nativePickerStatus, "NOT_RUN_CONTROLLED_INPUT"); assert.equal(b.nativeOutput, undefined);
  assert.equal(b.controlledOutput.status, "CONTROLLED_DIRECTORY_INJECTED");
  assert.equal(b.controlledOutput.nativePickerTested, false);
  assert.equal(b.controlledOutput.result.calls, 1); assert.equal(b.controlledOutput.cleanup.restored, true);
  assert.equal(b.controlledOutput.persistedHook, false);
  assert.equal(b.productChanges, 0); assert.equal(b.modelRequests, 0);
  assert.equal(b.sourceBuilderInvocation, false); assert.deepEqual(b.errors, []);
  assert.equal(b.protectedUnchanged, true); assert.equal(b.cleanupError, undefined);
  assert.equal(b.cleanups.length, 1); assert.equal(b.cleanups[0].status, "PASS");
  assert.equal(origin.originIsElevated, false); assert.equal(admin.isElevated, true);
  assert.equal(origin.taskEngine, true); assert.equal(admin.taskEngine, true);
  assert.equal(admin.originProcessId, origin.originProcessId); assert.equal(admin.userSid, origin.userSid);
  assert(admin.probe?.isElevated && admin.probe.success);
  assert.equal(admin.error, null); assert.equal(admin.policyRestoration, "PASS");
  assert.equal(admin.physicalProtectionRestoration, "PASS"); assert(admin.finishedAt);
  assert.equal(task.status, "TERMINAL"); assert.equal(task.cleanup, "PASS"); assert(task.finishedAt);
  assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
  assert.equal(restored.rows.length, 4); assert(restored.rows.every(r => r.physicalTestCache));
  assert.equal(b.steps.length, 4);
  if (artifactOnly) {
    // Accept only the known *post-build* close timeout. Keep the original failed
    // receipt and forced-cleanup facts; this is never a publishing-workflow PASS.
    assert.equal(b.status, "FAILED"); assert.equal(b.stage, "WAIT_NATIVE_EDITOR_CLOSE");
    assert.match(b.error, /^Error: Timeout Computer Use normal Editor close: not ready\n/);
    assert(b.steps.slice(0, 3).every(s => s.status === "PASS"));
    assert.equal(b.steps[3].label, "Normal native elevated Editor close");
    assert.equal(b.steps[3].status, "FAILED"); assert.equal(b.steps[3].error, b.error);
    assert.equal(b.normalClose, undefined);
    assert.equal(b.cleanups[0].normalCloseClaimed, false); assert(b.cleanups[0].killed.length > 0);
    assert.equal(admin.status, "CHECK_EDITOR_REPORT"); assert.equal(admin.exitCode, 1);
    return { artifactBuildStatus: "PASS", normalEditorClose: "FAILED",
      publishingWorkflowStatus: "FAILED", cleanupMode: "ATTRIBUTED_FORCED_CLEANUP",
      nativePicker: "NOT_RUN_CONTROLLED_INPUT", responseRestored: true };
  }
  assert.equal(b.status, "PASS"); assert(b.steps.every(s => s.status === "PASS"));
  assert.deepEqual(b.cleanups[0].killed, []);
  assert(b.normalClose?.receipt.interaction.includes("Computer Use"));
  assert.equal(admin.exitCode, 0); assert.equal(admin.status, "BUILD_PASS_DEVICE_PENDING");
  return { normalEditorClose: "PASS", nativePicker: "NOT_RUN_CONTROLLED_INPUT", responseRestored: true };
}
function materializedEvidence(c, b, source) {
  const expected = ["build-versions.json", "GameCli_framework/src-tauri/src/lib.rs",
    "scripts/build-runtime-standalone-android.cjs", "scripts/build-runtime-standalone-android.ps1"];
  assert.deepEqual(b.materializedWorkspace.files.map(f => f.relative), expected);
  const physicalCache = path.resolve("C:/Users/1/AppData/Local/com.agentvn.editor/standalone-package");
  const observed = Date.parse(b.materializedWorkspace.observedAt);
  assert(observed >= Date.parse(b.steps[2].startedAt) && observed <= Date.parse(b.steps[2].finishedAt));
  const files = b.materializedWorkspace.files.map(f => {
    verify(f.installed);
    assert.equal(f.path, path.join(b.materializedWorkspace.path, f.relative));
    const relative = path.relative(physicalCache, f.path);
    assert(relative && !path.isAbsolute(relative) && !relative.startsWith(".."));
    assert.match(f.sha256, /^[a-f0-9]{64}$/); assert(f.bytes > 0);
    if (f.relative === expected[0]) {
      assert.equal(f.comparison, "SEMANTIC_JSON");
      assert.equal(read(f.installed.path).editorVersion, c.version);
    } else {
      assert.equal(f.comparison, "SHA256_BYTES"); assert.equal(f.sha256, f.installed.sha256);
      assert.equal(f.bytes, fs.statSync(f.installed.path).size);
    }
    const archived = path.join(source, "native-standalone-package", relative);
    const retained = fs.existsSync(archived);
    if (retained) {
      assert.equal(sha(archived), f.sha256, "Archived actual build input");
      if (f.comparison === "SEMANTIC_JSON") assert.deepEqual(read(archived), read(f.installed.path));
    }
    return { relative: f.relative, observedSha256: f.sha256, installed: f.installed,
      archivedBytes: retained ? desc(archived) : null,
      evidenceKind: retained ? "ARCHIVED_ORIGINAL_BYTES" : "BUILD_TIME_OBSERVATION_ORIGINAL_NOT_RETAINED" };
  });
  return { status: files.every(f => f.archivedBytes) ? "RETAINED" : "NOT_RETAINED",
    files, limitation: "Observed records are not retrospectively archived original inputs" };
}
async function compareOptimizedResource(original, optimized, kind, text) {
  if (kind === "ui") {
    const sharp = require("../GameCli_framework/node_modules/sharp");
    const decode = bytes => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const [a, b] = await Promise.all([decode(original), decode(optimized)]);
    for (const key of ["width", "height", "channels"]) assert.equal(a.info[key], b.info[key]);
    assert.equal(a.info.channels, 4);
    // Lossless WebP may discard invisible RGB beneath alpha=0.
    for (let i = 0; i < a.data.length; i += 4) {
      assert.equal(a.data[i + 3], b.data[i + 3], "Image alpha changed");
      if (a.data[i + 3]) assert(a.data.subarray(i, i + 3).equals(b.data.subarray(i, i + 3)),
        "Visible image pixels changed");
    }
    return { comparison: "DECODED_VISIBLE_RGBA_IDENTICAL", width: a.info.width, height: a.info.height };
  }
  assert.equal(kind, "font");
  const fontkit = require("../editor/node_modules/fontkit");
  const a = fontkit.create(original), b = fontkit.create(optimized);
  assert.equal(a.unitsPerEm, b.unitsPerEm);
  let checkedGlyphs = 0;
  const missingInOriginal = [];
  for (const character of new Set(text)) {
    const cp = character.codePointAt(0);
    if (!a.hasGlyphForCodePoint(cp)) { missingInOriginal.push(cp); continue; }
    assert(b.hasGlyphForCodePoint(cp), `Optimized font lost U+${cp.toString(16)}`);
    const sourceGlyph = a.glyphForCodePoint(cp), targetGlyph = b.glyphForCodePoint(cp);
    assert.equal(targetGlyph.advanceWidth, sourceGlyph.advanceWidth);
    assert.deepEqual(targetGlyph.path.commands, sourceGlyph.path.commands, "Font outline changed");
    checkedGlyphs++;
  }
  assert(checkedGlyphs >= 62, "Font evidence must include the required alphanumeric corpus");
  return { comparison: "REQUIRED_SUPPORTED_GLYPH_OUTLINES_AND_METRICS_IDENTICAL", checkedGlyphs,
    missingInOriginal, limitation: "Original font missing characters still require Runtime fallback; not full glyph coverage" };
}
async function audit(configFile, number, scope) {
  assert(scope === undefined || scope === "--apk-artifact");
  const artifactOnly = scope === "--apk-artifact";
  const c = config(configFile); assert.match(number, /^\d{2}$/);
  const source = path.join(root, "editor-" + c.attempt), adminRoot = path.join(root, "administrator-" + c.attempt);
  const out = path.join(root, `renpy-artifact-${c.attempt}-audit-${number}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], sources: [],
    scope: "ACTUAL_INSTALLED_UI_RENPY_APK_CONTROLLED_DIRECTORY_NOT_PICKER_OR_DEVICE",
    config: desc(configFile), candidate: c, artifactOnly, modelRequests: 0, productChanges: 0 };
  const load = file => { r.sources.push(desc(file)); return read(file); };
  const check = async (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  };
  try {
    const b = load(path.join(source, "report.json"));
    await check(artifactOnly
      ? "Completed installed UI APK, controlled response and restoration; normal close remains FAILED"
      : "Actual installed UI build, one controlled response, normal close and complete restoration", () => {
      const boundary = terminal(c, b, load(path.join(adminRoot, "result.json")), load(path.join(adminRoot, "origin.json")),
        load(path.join(adminRoot, "task-engine.json")), load(path.join(source, "cache-restoration.json")), artifactOnly);
      const binding = load(b.candidateBinding.path); verify(b.candidateBinding);
      for (const f of binding.sources) verify(f);
      for (const f of [b.installation, ...b.tools]) verify(f);
      r.materializedInputRetention = materializedEvidence(c, b, source);
      for (const f of r.materializedInputRetention.files) {
        r.sources.push(f.installed);
        if (f.archivedBytes) r.sources.push(f.archivedBytes);
      }
      r.build = desc(path.join(source, "report.json"));
      return { ...boundary, materializedInputRetention: r.materializedInputRetention.status };
    });
    assert.equal(b.artifacts.length, 1); assert.equal(b.artifacts[0].kind, "android_apk");
    r.apk = verify(b.artifacts[0]);
    const toolchain = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain";
    const tool = (relative, args, name) => {
      const executable = path.join(toolchain, relative); r.sources.push(desc(executable));
      const text = execFileSync(executable, args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
      const file = path.join(out, name); fs.writeFileSync(file, text, { flag: "wx" }); r.sources.push(desc(file)); return text;
    };
    await check("Release APK signature, actual identity and installed candidate provenance", () => {
      const signature = tool("jdk-17/bin/java.exe", ["-jar", path.join(toolchain,
        "Sdk/build-tools/35.0.0/lib/apksigner.jar"), "verify", "--verbose", "--print-certs", r.apk.path], "signature.log");
      const badging = tool("Sdk/build-tools/35.0.0/aapt2.exe", ["dump", "badging", r.apk.path], "badging.log");
      assert.match(signature, /^Verifies\r?$/m); assert.match(signature, /^Verified using v2 scheme.*:\s*true\r?$/m);
      const certs = [...signature.matchAll(/^Signer #(\d+) certificate SHA-256 digest:\s*([a-f0-9]{64})\r?$/gim)];
      assert.equal(certs.length, 1);
      const record = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
      assert(record); assert.equal(record[1], pkg); assert.equal(+record[2], c.versionCode); assert.equal(record[3], c.gameVersion);
      const metadata = load(r.apk.path + ".acceptance.json");
      assert.equal(verifyProvenance(r.apk.path, metadata).status, "PASS");
      assert.equal(metadata.editorVersion, c.version); assert.equal(metadata.gameVersion, c.gameVersion);
      assert.equal(metadata.packageName, pkg);
      const installation = load(b.installation.path);
      for (const [kind, relative] of [["engine", "GameCli_framework/src-tauri/Cargo.toml"],
        ["protocol", "shared/cartridge/constants.ts"]])
        assert.equal(metadata.versionEvidence.sources[kind].sha256, sha(path.join(installation.installRoot, relative)));
      r.identity = { packageName: pkg, versionCode: c.versionCode, versionName: c.gameVersion, signerSha256: certs[0][2] };
      return r.identity;
    });
    const zip = await JSZip.loadAsync(fs.readFileSync(r.apk.path), { checkCRC32: true });
    await check("Authored layout/script and seven assets survive declared lossless image/font optimization", async () => {
      verify(b.cartridge);
      const cart = await JSZip.loadAsync(fs.readFileSync(b.cartridge.path), { checkCRC32: true });
      const embedded = async name => {
        const entries = Object.values(zip.files).filter(f => !f.dir && f.name.endsWith("embedded-cartridge/" + name));
        assert.equal(entries.length, 1, name); return entries[0].async("nodebuffer");
      };
      const fixture = require("./lib/candidate-1924-renpy-android-fixture.cjs").renpyAndroidFixture();
      const prior = await JSZip.loadAsync(fs.readFileSync(fixture.provenance.priorCartridge.path));
      const expected = require("./lib/gui-export-title-oracle.cjs").expectedExportLayout(
        JSON.parse(await prior.file("ui/layout.json").async("string")));
      const layout = JSON.parse(await embedded("ui/layout.json"));
      assert.deepEqual(layout, expected); assert.equal(layout.layout_type, "renpy");
      for (const name of ["script.json", "ui/layout.json"])
        assert.deepEqual(JSON.parse(await embedded(name)), JSON.parse(await cart.file(name).async("string")));
      const manifest = JSON.parse(await embedded("manifest.json"));
      const originalManifest = JSON.parse(await cart.file("manifest.json").async("string"));
      assert.equal(manifest.game_id, fixture.project.project_id); assert.equal(manifest.assets.length, 7);
      for (const value of [manifest, originalManifest]) {
        assert.equal(value.created_at, value.updated_at);
        assert(Date.parse(value.created_at) >= Date.parse(b.steps[1].startedAt) &&
          Date.parse(value.created_at) <= Date.parse(b.steps[2].finishedAt));
      }
      // Publish-cartridge and publish-APK each export the same project once;
      // validate their genuine generation times instead of requiring equality.
      const authoredManifest = ({ assets, created_at, updated_at, ...value }) => value;
      assert.deepEqual(authoredManifest(manifest), authoredManifest(originalManifest));
      r.cartridgeGenerationTimes = { publishedCartridge: originalManifest.created_at, apkExport: manifest.created_at };
      const optimizationFile = path.join(path.dirname(r.apk.path), "release-optimization-report.json");
      const optimization = load(optimizationFile);
      assert.equal(optimization.profile, "balanced"); assert.deepEqual(optimization.warnings, []);
      assert.equal(optimization.assets.length, 7);
      const strings = value => typeof value === "string" ? value : value && typeof value === "object"
        ? Object.values(value).map(strings).join("") : "";
      const corpus = strings([originalManifest, JSON.parse(await cart.file("script.json").async("string")),
        layout, cart.file("gallery.json") ? JSON.parse(await cart.file("gallery.json").async("string")) : null]) +
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      const checksums = JSON.parse(await embedded("checksum.json"));
      r.embeddedAssets = [];
      for (const asset of fixture.provenance.priorCartridge.assets) {
        const original = await cart.file(asset.path).async("nodebuffer");
        assert.equal(hash(original), asset.sha256); assert.equal(original.length, asset.bytes);
        const candidates = manifest.assets.filter(a => a.asset_id === asset.id); assert.equal(candidates.length, 1);
        const target = candidates[0], steps = optimization.assets.filter(a => a.assetId === asset.id);
        assert.equal(steps.length, 1); const step = steps[0];
        assert.equal(step.status, "optimized"); assert.equal(step.originalBytes, original.length);
        assert.equal(step.mode, target.asset_type === "font" ? "subset-woff2" : "lossless-webp");
        const bytes = await embedded(target.path);
        assert.equal(hash(bytes), target.hash_sha256); assert.equal(bytes.length, target.size_bytes);
        assert.equal(bytes.length, step.resultBytes);
        const checksum = checksums.files.filter(f => f.path === target.path); assert.equal(checksum.length, 1);
        assert.equal(checksum[0].hash_sha256, hash(bytes)); assert.equal(checksum[0].size_bytes, bytes.length);
        const comparison = await compareOptimizedResource(original, bytes, target.asset_type, corpus);
        r.embeddedAssets.push({ id: asset.id, path: target.path, sha256: hash(bytes), bytes: bytes.length,
          source: { path: asset.path, sha256: asset.sha256, bytes: asset.bytes }, comparison });
      }
      return { layoutSha256: hash(await embedded("ui/layout.json")), assets: r.embeddedAssets };
    });
    await check("Final optimized DEX retains lifecycle JNI and inherited PluginManager bridge", async () => {
      const inspector = require("./android-runtime-lifecycle-dex-audit.cjs");
      const entries = Object.values(zip.files).filter(f => /^classes(?:\d+)?\.dex$/.test(f.name));
      assert(entries.length); let classCount = 0, methods = [], dumps = [];
      for (const entry of entries) {
        const file = path.join(out, entry.name), dump = file + ".txt";
        fs.writeFileSync(file, await entry.async("nodebuffer"), { flag: "wx" });
        const fd = fs.openSync(dump, "wx");
        try {
          const result = spawnSync(path.join(toolchain, "Sdk/build-tools/35.0.0/dexdump.exe"), [file],
            { windowsHide: true, stdio: ["ignore", fd, "pipe"], timeout: 90000 });
          assert.equal(result.status, 0, result.stderr?.toString());
        } finally { fs.closeSync(fd); }
        const text = fs.readFileSync(dump, "utf8"), result = inspector.inspectLifecycle(text, pkg);
        classCount += result.classCount; methods.push(...result.methods); dumps.push(text);
        r.sources.push(desc(file), desc(dump));
      }
      assert.equal(classCount, 1); assert.equal(methods.length, 5);
      return { methods, pluginBridge: inspector.inspectPluginBridge(dumps.join("\n"), pkg) };
    });
    await check("Owned processes/ports gone and real WebView screenshot parameters match pixels", () => {
      const live = rows(), known = [...b.knownProcesses, ...b.buildKnownProcesses];
      assert(!known.some(p => live.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
      assert.deepEqual(listeners(b.launches.flatMap(l => l.ports)), []);
      assert(b.screenshots.length >= 3);
      for (const shot of b.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
        validateNativeViewport(shot.before, expected);
        validateNativeViewport(shot.after, expected);
        const bytes = fs.readFileSync(shot.path); assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1080);
      }
      return { screenshots: b.screenshots.length, displayMatrix: "NOT_CLAIMED" };
    });
    r.status = r.materializedInputRetention.status !== "RETAINED"
      ? "RENPY_CANDIDATE_APK_BYTES_PASS_INPUT_ARCHIVE_NOT_RETAINED_DEVICE_NOT_RUN"
      : artifactOnly
      ? "RENPY_CANDIDATE_APK_ARTIFACT_PASS_NORMAL_CLOSE_FAILED_DEVICE_NOT_RUN"
      : "RENPY_CANDIDATE_APK_PASS_CONTROLLED_DIRECTORY_DEVICE_NOT_RUN";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  for (const f of r.sources) verify(f);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, checks: r.checks.map(({ name, status }) => ({ name, status })), error: r.error, out }));
}
function loadAudit(configFile, auditFile) {
  const c = config(configFile), a = read(auditFile);
  if (a.materializedInputRetention?.status === "NOT_RETAINED") {
    assert.equal(a.status, "RENPY_CANDIDATE_APK_BYTES_PASS_INPUT_ARCHIVE_NOT_RETAINED_DEVICE_NOT_RUN");
    assert(a.materializedInputRetention.files.some(f => f.archivedBytes === null));
  } else assert.equal(a.materializedInputRetention.status, "RETAINED");
  if (a.artifactOnly === true) {
    if (a.materializedInputRetention.status === "RETAINED")
      assert.equal(a.status, "RENPY_CANDIDATE_APK_ARTIFACT_PASS_NORMAL_CLOSE_FAILED_DEVICE_NOT_RUN");
    const boundary = a.checks[0].evidence;
    assert.equal(boundary.artifactBuildStatus, "PASS");
    assert.equal(boundary.normalEditorClose, "FAILED");
    assert.equal(boundary.publishingWorkflowStatus, "FAILED");
    assert.equal(boundary.cleanupMode, "ATTRIBUTED_FORCED_CLEANUP");
  } else if (a.materializedInputRetention.status === "RETAINED")
    assert.equal(a.status, "RENPY_CANDIDATE_APK_PASS_CONTROLLED_DIRECTORY_DEVICE_NOT_RUN");
  assert.deepEqual(a.candidate, c); assert.deepEqual(a.config, desc(configFile));
  assert.equal(a.checks.length, 5); assert(a.checks.every(s => s.status === "PASS"));
  verify(a.apk); verify(a.build); assert.equal(a.embeddedAssets.length, 7);
  for (const f of a.sources) verify(f);
  return { c, a };
}
function deviceSource() {
  const file = path.join(__dirname, "candidate-1924-renpy-android-device.cjs");
  assert.equal(sha(file), "9114d433383ad188196df86ad0f014ceb25f68f6aa9dcb3555df2a41f7fea036");
  let source = fs.readFileSync(file, "utf8"), captured;
  source = replace(source, "const adapted = adapt(), worker = new Module(__filename, module);",
    "const adapted = adapt(), worker = new Module(__filename, module); module.capture(adapted.source);");
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  worker.capture = value => { captured = value; };
  worker._compile(source, file); assert(captured);
  captured = replace(captured, "function validateNavigationRequest(q) { return module.validateRenpyRequest(q); }",
    "function validateNavigationRequest(q) { return module.validateBoundRequest(q); }");
  captured = replace(captured,
    '      text(["shell", "cat", "/proc/sys/kernel/random/boot_id"]), r.startedAt);',
    '      await module.readOwnedBootId(cmd, wait), r.startedAt);');
  // The scene index is intentionally the same after a branch loop. Assert full
  // history advances beyond the quick-load baseline, not merely index equality.
  captured = replace(captured, '      priorTabId:tab.id,getClient:()=>client,setClient:value=>{client=value;}});',
    `      priorTabId:tab.id,getClient:()=>client,setClient:value=>{client=value;}});
    const exits=r.cases.at(-1).evidence;
    const quick=r.quickSaveSnapshots.at(-1).reduce((a,b)=>a.value.created_at>b.value.created_at?a:b).value;
    const auto=items=>items.filter(s=>s.value.save_kind==="auto").sort((a,b)=>b.value.created_at.localeCompare(a.value.created_at))[0].value;
    const firstAuto=auto(exits.saved),secondAuto=auto(exits.savedAfterSecond);
    assert.equal(firstAuto.history.length,quick.history.length+1,"First exit must persist the post-quick-load branch");
    assert.equal(secondAuto.history.length,firstAuto.history.length+1,"Reopened branch must persist its new history");
    assert.notEqual(firstAuto.history.at(-1).id,quick.history.at(-1).id);
    assert.notEqual(secondAuto.history.at(-1).id,firstAuto.history.at(-1).id);
    assert.deepEqual(firstAuto.variables,quick.variables);
    assert.deepEqual(secondAuto.variables,firstAuto.variables);
    r.exitSnapshotHistoryProof={quickHistory:quick.history.length,firstHistory:firstAuto.history.length,secondHistory:secondAuto.history.length,
      firstLastId:firstAuto.history.at(-1).id,secondLastId:secondAuto.history.at(-1).id};
    save();`);
  return captured + "\nmodule.exports.run=main;\n";
}
async function readOwnedBootId(cmd, wait) {
  return wait(() => {
    const result = cmd(["shell", "cat", "/proc/sys/kernel/random/boot_id"], false, true);
    if (result.status === 0) {
      const id = result.stdout.trim();
      assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
      return id;
    }
    assert.match(String(result.stderr), /device offline|device .*not found|no devices\/emulators found/i);
    return false;
  }, "same cold-boot transport readable");
}
function findBoundResource(assets, role) {
  const selectors = {
    title: [/bd5abc92$/, /-main_menu\.(?:png|webp)$/],
    font: [/6cf0825e$/, /-DejaVuSans\.(?:ttf|woff2)$/],
    textbox: [/7ffe109f$/, /-textbox\.(?:png|webp)$/],
    quickIdle: [/7bfef58f$/, /-quick_idle_background\.(?:png|webp)$/],
    choiceIdle: [/95df9c31$/, /-choice_idle_background\.(?:png|webp)$/],
  };
  assert(Object.hasOwn(selectors, role));
  const [id, file] = selectors[role], found = assets.filter(a => id.test(a.id));
  assert.equal(found.length, 1, "Exactly one audited resource for " + role);
  const asset = found[0];
  assert(file.test(asset.path), "Unexpected resource path for " + role);
  assert.match(asset.sha256, /^[a-f0-9]{64}$/); assert(asset.bytes > 0);
  return asset;
}
function loadResourceFlow() {
  const file = path.join(__dirname, "lib/renpy-official-android-flow.cjs");
  assert.equal(sha(file), "522dcd5279222e114766bed28219bfdb9a91f7baf6a055ffe17a76ab82669ef1");
  let source = fs.readFileSync(file, "utf8");
  for (const [before, role] of [
    ['c.q.resourceAssets.find(asset => asset.id.endsWith("bd5abc92"))', "title"],
    ['c.q.resourceAssets.find(asset => asset.path.endsWith(".ttf"))', "font"],
    ['c.q.resourceAssets.find(asset => asset.path.endsWith("-textbox.png"))', "textbox"],
    ['c.q.resourceAssets.find(asset => asset.path.endsWith("-quick_idle_background.png"))', "quickIdle"],
    ['c.q.resourceAssets.find(asset => asset.path.endsWith("-choice_idle_background.png"))', "choiceIdle"],
  ]) source = replace(source, before, `module.findBoundResource(c.q.resourceAssets, "${role}")`);
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  worker.findBoundResource = findBoundResource; worker._compile(source, file);
  return worker.exports;
}
function validateDeviceShape(q, b, receipt, a) {
  assert.deepEqual(q.candidateBinding, receipt);
  assert.equal(q.scope, "installed-renpy-resource-navigation"); assert.equal(q.package, pkg);
  assert.equal(q.sdk, "D:\\Android_dev\\Sdk"); assert.equal(q.serial, "emulator-5554");
  assert.equal(q.coldBoot?.avd, "AgentVN_API35"); assert.equal(q.coldBoot.avdHome, "D:\\Android_dev\\avd");
  assert.equal(q.coldBoot.discoveryRoot, "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running");
  assert.equal(q.coldBoot.mediaVolumeTarget, 13);
  assert.equal(q.exitProbe, undefined); assert.equal(q.traceExitBoundary, undefined);
  assert.equal(q.outputDir, path.join(b.output, "runtime"));
  assert.deepEqual(q.apk, a.apk); assert.deepEqual(q.packageAudit, b.audit);
  assert.deepEqual(q.resourceAssets, a.embeddedAssets);
  const ports = [q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort];
  assert.equal(new Set(ports).size, 4); assert(ports.every(p => Number.isInteger(p) && p > 1024 && p <= 65535));
}
function validateDevice(q, b, receipt) {
  const { a } = loadAudit(b.config.path, b.audit.path);
  validateDeviceShape(q, b, receipt, a);
}
function bound(file, digest) {
  assert.equal(sha(file), digest); const b = read(file);
  for (const f of b.sources) verify(f);
  loadAudit(b.config.path, b.audit.path);
  return { b, receipt: { path: path.resolve(file), sha256: digest } };
}
async function runPrepared(file, digest, args) {
  const { b, receipt } = bound(file, digest), only = args[0] === "--validate";
  assert.equal(args.length, only ? 2 : 1);
  const requestFile = args[only ? 1 : 0], q = read(requestFile); validateDevice(q, b, receipt);
  if (only) return;
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  const originalRequire = worker.require.bind(worker);
  worker.require = id => id === "./lib/renpy-official-android-flow.cjs" ? loadResourceFlow() : originalRequire(id);
  worker.readOwnedBootId = readOwnedBootId;
  worker.validateBoundRequest = value => validateDevice(value, b, receipt);
  worker._compile(fs.readFileSync(b.runnerSource, "utf8"), __filename);
  await worker.exports.run(requestFile);
}
function prepare(configFile, auditNumber, deviceNumber) {
  for (const n of [auditNumber, deviceNumber]) assert.match(n, /^\d{2}$/);
  const c = config(configFile), auditFile = path.join(root, `renpy-artifact-${c.attempt}-audit-${auditNumber}/report.json`);
  loadAudit(configFile, auditFile);
  const out = path.join(path.dirname(configFile), `android-renpy-${c.attempt}-${deviceNumber}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const output = path.join(root, `device-renpy-${c.attempt}-${deviceNumber}`); assert(!fs.existsSync(output));
  const runnerFile = path.join(out, "runner.cjs"), startFile = path.join(out, "start.ps1");
  const tools = require("./android-candidate-device.cjs");
  let start = tools.startSource(startFile, runnerFile);
  start = replace(start, "'installed-current-navigation'", "'installed-renpy-resource-navigation'");
  start = replace(start, "(Join-Path 'D:\\AgentVN\\scripts' 'android-current-navigation.cjs')",
    "'" + runnerFile.replaceAll("/", "\\") + "'");
  tools.validateStartSyntax(start);
  fs.writeFileSync(startFile, start, { flag: "wx" });
  const runnerSource = path.join(out, "executed-runner.cjs");
  fs.writeFileSync(runnerSource, deviceSource(), { flag: "wx" });
  const sources = [__filename, configFile, auditFile, startFile, runnerSource,
    ...["candidate-1924-renpy-android-device.cjs", "android-current-navigation.cjs", "start-android-acceptance.ps1",
      "android-candidate-device.cjs", "android-cold-boot.ps1", "android-acceptance-preflight.ps1",
      "android-runtime-log-analysis.cjs", "visible-control-geometry.cjs", "android-acceptance-evidence.cjs",
      "lib/renpy-official-android-flow.cjs", "lib/current-android-navigation-exit.cjs", "android-exit-device.cjs",
      "lib/android-activity-exit.cjs", "lib/android-exit-observer.cjs", "lib/android-adb-root-recovery.cjs"].map(f => path.join(__dirname, f))];
  const b = { config: desc(configFile), audit: desc(auditFile), output, runnerSource, startFile, sources: sources.map(desc) };
  const bindingFile = path.join(out, "binding.json"); fs.writeFileSync(bindingFile, JSON.stringify(b, null, 2), { flag: "wx" });
  for (const [name, method] of [["runner.cjs", "runPrepared"], ["launch.cjs", "launchPrepared"]])
    fs.writeFileSync(path.join(out, name), `require(${JSON.stringify(__filename)}).${method}(${JSON.stringify(bindingFile)},` +
      `${JSON.stringify(sha(bindingFile))},process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1});\n`, { flag: "wx" });
  return { status: "PREPARED_NOT_LAUNCHED", launchFile: path.join(out, "launch.cjs"), binding: desc(bindingFile) };
}
async function launchPrepared(file, digest, args) {
  assert.deepEqual(args, []); const { b, receipt } = bound(file, digest);
  assert(!fs.existsSync(b.output)); fs.mkdirSync(b.output);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), scope: "INSTALLED_RENPY_CONTROLLED_DIRECTORY_REAL_DEVICE",
    candidateBinding: receipt, productChanges: 0, modelRequests: 0, buildInvocations: 0 };
  const save = () => fs.writeFileSync(path.join(b.output, "report.json"), JSON.stringify(r, null, 2));
  save();
  try {
    const ports = await require("./lib/android-device-ports.cjs").allocateAndroidDevicePorts(), a = read(b.audit.path);
    const q = { scope: "installed-renpy-resource-navigation", package: pkg, sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554",
      candidateBinding: receipt, apk: a.apk, packageAudit: b.audit, resourceAssets: a.embeddedAssets,
      runId: path.basename(b.output), outputDir: path.join(b.output, "runtime"), adbPort: ports[0], cdpPort: ports[1],
      coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: ports[2], grpcPort: ports[3],
        discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running", mediaVolumeTarget: 13 } };
    validateDevice(q, b, receipt);
    const requestFile = path.join(b.output, "request.json");
    fs.writeFileSync(requestFile, JSON.stringify(q, null, 2), { flag: "wx" });
    fs.copyFileSync(requestFile, path.join(b.output, "request-submitted.json"), fs.constants.COPYFILE_EXCL);
    r.launchOutput = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", b.startFile,
      "-RequestPath", requestFile], { encoding: "utf8", windowsHide: true, timeout: 120000 }); save();
    const launchFile = path.join(q.outputDir, "acceptance-launch.json"), deadline = Date.now() + 20 * 60000;
    let launch;
    while (Date.now() < deadline) {
      if (fs.existsSync(launchFile)) {
        try { launch = read(launchFile); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
        if (launch?.finishedAt) break;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    assert(launch?.finishedAt, "Inspect same owner, never relaunch"); r.launch = desc(launchFile);
    assert.equal(launch.emulatorCleanupStatus, "PASS");
    const runtimeFile = path.join(q.outputDir, "navigation-report.json"), runtime = read(runtimeFile);
    r.runtime = desc(runtimeFile);
    require("./candidate-1924-renpy-android-device-launch.cjs").validateCompletion(runtime);
    if (runtime.status !== "FAILED") assert(runtime.exitSnapshotHistoryProof);
    r.status = runtime.status; r.cases = runtime.cases.map(({ name, status, error }) => ({ name, status, error }));
    if (runtime.status === "FAILED") process.exitCode = 1;
    bound(file, digest);
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.limitations = ["Native directory picker NOT_RUN; controlled response restored before actual installed builder",
    ...(read(b.audit.path).artifactOnly ? ["Editor normal close FAILED; forced cleanup is not a successful publishing workflow"] : []),
    ...(read(b.audit.path).materializedInputRetention.status === "NOT_RETAINED"
      ? ["Temporary build inputs not retained; build-time observation and installed originals only, not archived-input verification"] : []),
    "Official GUI fixture, API35 emulator only; not NVL/bubble, full font coverage, physical phone or complete acceptance",
    "Historical cold-start warnings remain BLOCKED independently"];
  r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(r, null, 2));
}
function selfTest(configFile) {
  const c = config(configFile), old = read(path.join(root, "editor-25/report.json"));
  const adminRoot = path.join(root, "administrator-25");
  const values = [read(path.join(adminRoot, "result.json")), read(path.join(adminRoot, "origin.json")),
    read(path.join(adminRoot, "task-engine.json")), read(path.join(root, "editor-25/cache-restoration.json"))];
  assert.throws(() => terminal(c, old, ...values), "Native result cannot stand for controlled result");
  const fixture = structuredClone(old);
  // Synthetic validator fixture only; never rebind the historical product
  // receipt. The real audit still requires the current candidate's version.
  fixture.version = c.version;
  fixture.normalUIExportStatus = "PASS_UI_CONTROLLED_DIRECTORY"; fixture.nativePickerStatus = "NOT_RUN_CONTROLLED_INPUT";
  delete fixture.nativeOutput;
  fixture.controlledOutput = { status: "CONTROLLED_DIRECTORY_INJECTED", nativePickerTested: false,
    result: { calls: 1 }, cleanup: { restored: true }, persistedHook: false };
  terminal(c, fixture, ...values);
  const bad = [b => b.steps = [], b => b.builds = 2, b => b.modelRequests = 1, b => b.productChanges = 1,
    b => b.controlledOutput.result.calls = 2, b => b.controlledOutput.cleanup.restored = false,
    b => b.controlledOutput.persistedHook = true, b => b.nativePickerStatus = "PASS",
    b => b.normalUIExportStatus = "PASS_NATIVE_UI", b => b.cleanups[0].killed.push("forced"),
    b => b.status = "FAILED", b => delete b.normalClose,
    b => b.version = c.version + ".stale"];
  for (const change of bad) { const b = structuredClone(fixture); change(b); assert.throws(() => terminal(c, b, ...values)); }
  const source = deviceSource(); new (require("node:vm").Script)(Module.wrap(source));
  assert(source.includes("First exit must persist the post-quick-load branch"));
  assert(source.includes("Reopened branch must persist its new history"));
  const b = { output: path.join(root, `device-renpy-${c.attempt}-01`), audit: { path: "bound-audit", sha256: "a".repeat(64) } };
  const receipt = { path: "bound-candidate", sha256: "b".repeat(64) };
  const a = { apk: { path: "bound-apk", sha256: "c".repeat(64) }, embeddedAssets: Array.from({ length: 7 }, (_, i) => ({ id: i })) };
  const q = { candidateBinding: receipt, scope: "installed-renpy-resource-navigation", package: pkg,
    sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554", outputDir: path.join(b.output, "runtime"),
    apk: a.apk, packageAudit: b.audit, resourceAssets: a.embeddedAssets, adbPort: 50001, cdpPort: 50002,
    coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: 50003, grpcPort: 50004,
      discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running", mediaVolumeTarget: 13 } };
  validateDeviceShape(q, b, receipt, a);
  const badRequests = [v => v.candidateBinding.sha256 = "wrong", v => v.scope = "other",
    v => v.package = "other", v => v.outputDir = "D:\\AgentVN", v => v.apk.sha256 = "old",
    v => v.packageAudit.sha256 = "old", v => v.resourceAssets.pop(), v => delete v.coldBoot.avdHome,
    v => v.cdpPort = v.adbPort, v => v.coldBoot.grpcPort = 0, v => v.exitProbe = true,
    v => v.traceExitBoundary = true];
  for (const change of badRequests) { const v = structuredClone(q); change(v); assert.throws(() => validateDeviceShape(v, b, receipt, a)); }
  return { status: "PASS", rejectedReceipts: bad.length + 1, realFrozenAdbFlowSyntax: "PASS",
    rejectedDeviceRequests: badRequests.length, productLaunches: 0, modelRequests: 0, deviceOperations: 0 };
}
module.exports = { config, terminal, materializedEvidence, compareOptimizedResource, audit, selfTest, loadAudit,
  findBoundResource, loadResourceFlow, readOwnedBootId, validateDevice, deviceSource, prepare, runPrepared, launchPrepared };
if (require.main === module) {
  const [action, file, number, deviceNumber] = process.argv.slice(2);
  if (action === "audit") audit(file, number, deviceNumber).catch(e => { console.error(e); process.exitCode = 1; });
  else if (action === "prepare") console.log(JSON.stringify(prepare(file, number, deviceNumber), null, 2));
  else { assert.equal(action, "self-test"); console.log(JSON.stringify(selfTest(file), null, 2)); }
}
