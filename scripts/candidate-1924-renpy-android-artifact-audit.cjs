"use strict";
// Independent installed-builder artifact audit. No native picker/normal close,
// upgrade, device or full-acceptance claim can be inferred from these results.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { renpyAndroidFixture } = require("./lib/candidate-1924-renpy-android-fixture.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = "F:/AgentVN/QA/Android-Package-20261021-01";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: hash(fs.readFileSync(file)),
  bytes: fs.statSync(file).size, generatedAt: fs.statSync(file).mtime.toISOString() });
function verify(file) {
  const bytes = fs.readFileSync(file.path); assert.equal(hash(bytes), file.sha256, file.path);
  if (file.bytes !== undefined) assert.equal(bytes.length, file.bytes); return bytes;
}
function validateTerminal({ build, admin, origin, task, restored }) {
  assert.equal(build.status, "PASS_SUPPLEMENTAL_NATIVE_BUILD_NOT_NORMAL_PUBLISH");
  assert(build.finishedAt); assert.equal(build.version, "1.9.24");
  assert.equal(build.builds, 1); assert.equal(build.steps.length, 3);
  assert(build.steps.every(step => step.status === "PASS"));
  assert.equal(build.currentNativeUI, false);
  assert.equal(build.normalUIExportStatus, "BLOCKED_PRIOR_NATIVE_PICKER");
  assert.equal(build.normalClose, undefined); assert.equal(build.nativeOutput, undefined);
  assert.equal(build.androidBuildStatus, "STATIC_ONLY"); assert.equal(build.androidDeviceStatus, "NOT_RUN");
  assert.equal(build.sourceBuilderInvocation, false);
  assert.equal(build.modelRequests, 0); assert.equal(build.productChanges, 0); assert.deepEqual(build.errors, []);
  assert.equal(build.protectedUnchanged, true); assert.equal(build.cleanupError, undefined);
  assert.equal(build.artifacts.length, 2);
  assert.deepEqual(build.artifacts.map(item => item.kind).sort(),
    ["android_apk_signed", "release_optimization_report"]);
  assert.deepEqual(build.boundaries, { nativePicker: false, normalEditorClose: false, device: false, fullAcceptance: false });
  assert(admin.finishedAt); assert.equal(admin.exitCode, 0);
  assert.equal(admin.isElevated, true); assert.equal(admin.probe.isElevated, true); assert.equal(admin.probe.success, true);
  assert.equal(admin.policyRestoration, "PASS"); assert.equal(admin.physicalProtectionRestoration, "PASS");
  assert.equal(origin.originIsElevated, false); assert.equal(origin.userSid, admin.userSid);
  assert.equal(origin.originProcessId, admin.originProcessId);
  assert(task.finishedAt); assert.equal(task.status, "TERMINAL"); assert.equal(task.cleanup, "PASS");
  assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
  assert.equal(restored.rows.length, 4); assert(restored.rows.every(row => row.physicalTestCache === true));
}
function selfTest() {
  const good = { build: { status: "PASS_SUPPLEMENTAL_NATIVE_BUILD_NOT_NORMAL_PUBLISH", finishedAt: "terminal",
    version: "1.9.24", builds: 1, steps: Array.from({ length: 3 }, () => ({ status: "PASS" })),
    currentNativeUI: false, normalUIExportStatus: "BLOCKED_PRIOR_NATIVE_PICKER", androidBuildStatus: "STATIC_ONLY",
    androidDeviceStatus: "NOT_RUN", sourceBuilderInvocation: false, modelRequests: 0, productChanges: 0,
    errors: [], protectedUnchanged: true,
    artifacts: [{ kind: "android_apk_signed" }, { kind: "release_optimization_report" }],
    boundaries: { nativePicker: false, normalEditorClose: false, device: false, fullAcceptance: false } },
    admin: { finishedAt: "terminal", exitCode: 0, isElevated: true, probe: { isElevated: true, success: true },
      policyRestoration: "PASS", physicalProtectionRestoration: "PASS", userSid: "QA", originProcessId: 11 },
    origin: { originIsElevated: false, userSid: "QA", originProcessId: 11 },
    task: { finishedAt: "terminal", status: "TERMINAL", cleanup: "PASS" },
    restored: { status: "PASS", deletedUserFiles: 0, rows: Array.from({ length: 4 }, () => ({ physicalTestCache: true })) } };
  validateTerminal(good);
  const bad = [
    r => { r.build.status = "PASS"; }, r => { delete r.build.finishedAt; },
    r => { r.build.builds = 2; }, r => { r.build.steps[1].status = "FAILED"; },
    r => { r.build.currentNativeUI = true; }, r => { r.build.normalUIExportStatus = "PASS_NATIVE_UI"; },
    r => { r.build.normalClose = {}; }, r => { r.build.nativeOutput = {}; },
    r => { r.build.boundaries.fullAcceptance = true; }, r => { r.build.modelRequests = 1; },
    r => { r.build.cleanupError = "failed"; }, r => { r.admin.isElevated = false; },
    r => { r.admin.probe.success = false; }, r => { r.admin.policyRestoration = "FAILED"; },
    r => { r.origin.originIsElevated = true; }, r => { r.origin.userSid = "OTHER"; },
    r => { r.task.cleanup = "FAILED"; }, r => { delete r.task.finishedAt; },
    r => { r.restored.rows.pop(); }, r => { r.restored.rows[0].physicalTestCache = false; },
    r => { r.restored.deletedUserFiles = 1; },
    r => { r.build.artifacts.pop(); }, r => { r.build.artifacts[1].kind = "unknown"; },
    r => { r.build.artifacts[1].kind = "android_apk_signed"; },
  ];
  for (const mutate of bad) { const r = structuredClone(good); mutate(r); assert.throws(() => validateTerminal(r)); }
  console.log(JSON.stringify({ status: "PASS", invalidReceiptsRejected: bad.length, deviceOperations: 0, apkBuilds: 0 }));
}
async function main() {
  if (process.argv[2] === "--self-test") return selfTest();
  assert.deepEqual(process.argv.slice(2), ["01"]);
  const out = path.join(root, "renpy-artifact-19-audit-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "SUPPLEMENTAL_INSTALLED_NATIVE_RENPY_RESOURCE_APK_NOT_NORMAL_PUBLISH_OR_DEVICE", checks: [], sources: [] };
  const load = file => { const d = desc(file); r.sources.push(d); return read(file); };
  const check = async (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await fn(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; throw e; }
  };
  try {
    const build = load(path.join(root, "editor-19/report.json"));
    const admin = load(path.join(root, "administrator-19/result.json"));
    const origin = load(path.join(root, "administrator-19/origin.json"));
    const task = load(path.join(root, "administrator-19/task-engine.json"));
    const restored = load(path.join(root, "editor-19/cache-restoration.json"));
    await check("Single controlled installed builder, real administrator and complete recovery", () => {
      validateTerminal({ build, admin, origin, task, restored });
      for (const file of [build.installation, ...build.tools, build.priorExportAudit]) verify(file);
      const prior = read(build.priorExportAudit.path);
      assert.equal(prior.status, "EXPORT_EVIDENCE_PASS_ANDROID_BLOCKED_NATIVE_INPUT");
      const installation = read(build.installation.path);
      for (const file of [installation.package, installation.executable, ...installation.resources]) verify(file);
      return { source: desc(path.join(root, "editor-19/report.json")), normalPublishStatus: "BLOCKED_NATIVE_INPUT",
        normalClose: "NOT_TESTED_ATTRIBUTED_CLEANUP_ONLY" };
    });
    const optimization = build.artifacts.find(item => item.kind === "release_optimization_report");
    verify(optimization); r.sources.push(desc(optimization.path));
    const apk = build.artifacts.find(item => item.kind === "android_apk_signed");
    verify(apk); r.apk = apk; r.sources.push(desc(apk.path));
    const toolchain = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain";
    const java = path.join(toolchain, "jdk-17/bin/java.exe");
    const signer = path.join(toolchain, "Sdk/build-tools/35.0.0/lib/apksigner.jar");
    const aapt = path.join(toolchain, "Sdk/build-tools/35.0.0/aapt2.exe");
    const command = (exe, args, name) => {
      const output = execFileSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
      const file = path.join(out, name); fs.writeFileSync(file, output, { flag: "wx" }); r.sources.push(desc(file)); return output;
    };
    await check("Actual APK signature, application identity and acceptance provenance", () => {
      const signature = command(java, ["-jar", signer, "verify", "--verbose", "--print-certs", apk.path], "signature.log");
      const badging = command(aapt, ["dump", "badging", apk.path], "badging.log");
      assert.match(signature, /^Verifies\r?$/m);
      assert.match(signature, /^Verified using v2 scheme.*:\s*true\r?$/m);
      const certs = [...signature.matchAll(/^Signer #(\d+) certificate SHA-256 digest:\s*([a-f0-9]{64})\r?$/gim)];
      assert.equal(certs.length, 1);
      assert.match(badging, /^package: name='com\.agentvn\.qa\.renpygui20261025' versionCode='1000' versionName='0\.1\.0'/m);
      const metadata = load(apk.path + ".acceptance.json");
      assert.equal(verifyProvenance(apk.path, metadata).status, "PASS");
      assert.equal(metadata.editorVersion, "1.9.24"); assert.equal(metadata.gameVersion, "0.1.0");
      assert.equal(metadata.packageName, "com.agentvn.qa.renpygui20261025");
      r.identity = { packageName: metadata.packageName, versionCode: 1000, versionName: "0.1.0",
        signerSha256: certs[0][2].toLowerCase() };
      return { identity: r.identity, metadata: desc(apk.path + ".acceptance.json") };
    });
    await check("APK embeds identical authored Renpy layout, script and every selected resource byte", async () => {
      const fixture = renpyAndroidFixture();
      const zip = await JSZip.loadAsync(verify(apk), { checkCRC32: true });
      const exported = await JSZip.loadAsync(verify(build.cartridge), { checkCRC32: true });
      const embedded = async name => {
        const entries = Object.values(zip.files).filter(e => !e.dir && e.name.endsWith("embedded-cartridge/" + name));
        assert.equal(entries.length, 1, name); return entries[0].async("nodebuffer");
      };
      const layout = await embedded("ui/layout.json");
      const sourceLayout = await exported.file("ui/layout.json").async("nodebuffer");
      assert.equal(hash(sourceLayout), fixture.provenance.priorCartridge.layoutSha256);
      assert.deepEqual(JSON.parse(layout), JSON.parse(sourceLayout));
      assert.equal(JSON.parse(layout).layout_type, "renpy");
      assert.deepEqual(JSON.parse(await embedded("script.json")),
        JSON.parse(await exported.file("script.json").async("string")));
      const manifest = JSON.parse(await embedded("manifest.json"));
      assert.equal(manifest.assets.length, 7); assert.equal(manifest.game_id, fixture.project.project_id);
      r.embeddedAssets = [];
      for (const asset of fixture.provenance.priorCartridge.assets) {
        const bytes = await embedded(asset.path); assert.equal(hash(bytes), asset.sha256); assert.equal(bytes.length, asset.bytes);
        r.embeddedAssets.push({ id: asset.id, path: asset.path, sha256: hash(bytes), bytes: bytes.length });
      }
      return { layoutSha256: hash(layout), sourceLayoutSha256: hash(sourceLayout),
        jsonComparison: "FULL_PARSED_CONTENT_ALLOW_SERIALIZATION_WHITESPACE", assets: r.embeddedAssets };
    });
    await check("Owned identities and ports gone; screenshots retain actual parameters", () => {
      const live = rows(), known = [...build.knownProcesses, ...build.buildKnownProcesses];
      assert(!known.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
      assert.deepEqual(listeners(build.launches.flatMap(item => item.ports)), []);
      assert.equal(build.screenshots.length, 2);
      for (const shot of build.screenshots) {
        const bytes = verify(shot); assert.deepEqual(shot.before, shot.after);
        assert.equal(shot.before.width, 1920); assert.equal(shot.before.height, 1080);
        assert.equal(shot.before.dpr, 1); assert.equal(shot.before.reduced, false);
        assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1080);
      }
      return { identities: known.length, screenshots: build.screenshots.length, displayMatrix: "NOT_CLAIMED" };
    });
    r.status = "RENPY_RESOURCE_APK_PASS_SUPPLEMENTAL_NORMAL_PUBLISH_BLOCKED_DEVICE_NOT_RUN";
  } catch (error) { r.status = "FAILED"; r.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    for (const file of r.sources) verify(file);
    r.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
    fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
    console.log(JSON.stringify({ status: r.status, checks: r.checks, error: r.error, out }));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
