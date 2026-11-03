"use strict";
// Independent static audit; never builds, installs, touches ADB, or repairs receipts.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { parseIdentity, validatePair, validateCartridge } = require("./lib/android-upgrade-package-evidence.cjs");
const { verifyProvenance } = require("./android-acceptance-evidence.cjs");
const qa = "F:/AgentVN/QA/Android-Package-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
async function main() {
  const attempt = process.argv[2], auditAttempt = process.argv[3];
  assert.match(attempt, /^\d{2}$/); assert.match(auditAttempt, /^\d{2}$/);
  const artifactOnly = process.argv[4] === "--apk-artifact";
  const terminal = process.argv[4] === "--apk-terminal" || artifactOnly;
  assert(terminal || process.argv[4] === "--cartridge-only", "Choose an explicit prebuild or terminal APK scope");
  assert.equal(process.argv.length, 5);
  const out = path.join(qa, `native-upgrade-audit-${attempt}-${auditAttempt}`); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], sources: [],
    scope: artifactOnly ? "SIGNED_ARTIFACT_FOR_DEVICE_NORMAL_EDITOR_CLOSE_STILL_FAILED"
      : terminal ? "CURRENT_NATIVE_UI_APK_AND_SIGNED_UPGRADE_PAIR_NOT_DEVICE"
      : "PREBUILD_CARTRIDGE_AND_RETAINED_SIGNED_SAMPLE_ONLY",
    apkBuilds: 0, deviceOperations: 0, modelRequests: 0, deviceStatus: "NOT_RUN" };
  for (const [file, name] of [[__filename, "executed.cjs"],
    [path.join(__dirname, "lib/android-upgrade-package-evidence.cjs"), "validator.cjs"]]) {
    const snapshot = path.join(out, name);
    fs.copyFileSync(file, snapshot, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(file), sha(snapshot)); r.sources.push(desc(snapshot));
  }
  const load = f => { r.sources.push(desc(f)); return read(f); };
  const command = (exe, args, name) => {
    const text = execFileSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
    const file = path.join(out, name + ".log");
    fs.writeFileSync(file, text, { flag: "wx" }); r.sources.push(desc(file)); return text;
  };
  const check = async (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  };
  const zipJSON = async (zip, name) => {
    const entry = zip.file(name); assert(entry, name); return JSON.parse(await entry.async("string"));
  };
  try {
    const source = path.join(qa, "editor-" + attempt), buildFile = path.join(source, "report.json");
    const observation = fs.readFileSync(buildFile), snapshot = path.join(out, "build-observation.json");
    fs.writeFileSync(snapshot, observation, { flag: "wx" });
    r.buildObservation = { originalPath: buildFile, sha256AtObservation: hash(observation),
      observedAt: new Date().toISOString(), originalRemainsLive: !terminal };
    const build = load(snapshot);
    const old = load(path.join(qa, "editor-10/report.json"));
    const oldProject = load(old.input.path);
    assert.equal(sha(old.input.path), "6335ef181e05589ba1ae5102a86d02f6960aefe438be1aa554eb3ccdd50ffece");
    const project = load(build.input.path); assert.equal(sha(build.input.path), build.input.sha256);
    const currentZip = await JSZip.loadAsync(fs.readFileSync(build.cartridge.path), { checkCRC32: true });
    const manifest = await zipJSON(currentZip, "manifest.json"), script = await zipJSON(currentZip, "script.json");
    const layout = await zipJSON(currentZip, "ui/layout.json");
    await check("Actual installed current Editor and real UI-exported new same-game cartridge", async () => {
      assert.equal(build.version, "1.9.22"); assert.equal(build.currentNativeUI, true);
      assert.equal(build.modelRequests, 0); assert.equal(build.productChanges, 0);
      assert.equal(build.sourceBuilderInvocation, false);
      assert.equal(sha(build.installation.path), build.installation.sha256);
      const installation = load(build.installation.path);
      assert.equal(installation.version, "1.9.22");
      assert.equal(sha(installation.executable.path), installation.executable.sha256);
      assert(build.steps.length >= 2 && build.steps.slice(0, 2).every(s => s.status === "PASS"));
      assert.equal(sha(build.cartridge.path), build.cartridge.sha256);
      validateCartridge(oldProject, project, manifest, script, layout);
      assert.deepEqual(manifest, build.cartridge.manifest);
      assert.equal(hash(await currentZip.file("script.json").async("nodebuffer")), build.cartridge.scriptSha256);
      assert.equal(hash(await currentZip.file("ui/layout.json").async("nodebuffer")), build.cartridge.layoutSha256);
      return { installation: desc(build.installation.path), input: desc(build.input.path),
        cartridge: desc(build.cartridge.path), gameId: manifest.game_id, version: manifest.version };
    });
    const toolchain = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain";
    const java = path.join(toolchain, "jdk-17/bin/java.exe");
    const signer = path.join(toolchain, "Sdk/build-tools/35.0.0/lib/apksigner.jar");
    const aapt = path.join(toolchain, "Sdk/build-tools/35.0.0/aapt2.exe");
    r.sources.push(...[java, signer, aapt].map(desc));
    const identity = (apk, label) => parseIdentity(command(java,
      ["-jar", signer, "verify", "--verbose", "--print-certs", apk], label + "-signature"),
    command(aapt, ["dump", "badging", apk], label + "-badging"));
    let oldIdentity;
    await check("Retained actual old APK signature, Android identity and immutable source", async () => {
      assert.equal(old.status, "PASS"); assert.equal(old.version, "1.9.19");
      const apk = old.artifacts.find(f => f.kind === "android_apk_signed"); assert(apk);
      assert.equal(sha(apk.path), "504ea034c14f393465b44160898516a7875d3031c65d108779ecb51897b5de5b");
      oldIdentity = identity(apk.path, "old");
      assert.equal(oldIdentity.versionCode, 1000); assert.equal(oldIdentity.versionName, "0.1.0");
      assert.equal(oldIdentity.signerSha256, "c0eb991c5754b5556f8d5dcd966437c86e495e0fe7379fb76b35545247751718");
      const metadata = load(apk.path + ".acceptance.json");
      assert.equal(verifyProvenance(apk.path, metadata).status, "PASS");
      assert.equal(sha(apk.path), apk.sha256);
      return { apk: desc(apk.path), identity: oldIdentity };
    });
    if (terminal) {
      await check(artifactOnly ? "Artifact build eligibility and cleanup; normal close remains FAILED"
        : "Terminal single native UI build and normal close; administrator finally completed", async () => {
        if (!artifactOnly) assert.equal(build.status, "PASS"); assert(build.finishedAt);
        assert.equal(build.builds, 1); assert.equal(build.normalUIExportStatus, "PASS_NATIVE_UI");
        assert.equal(build.androidBuildStatus, "STATIC_ONLY"); assert.equal(build.androidDeviceStatus, "NOT_RUN");
        assert.equal(build.featureStatus, "PASS"); assert.deepEqual(build.errors, []);
        assert.equal(build.steps.length, 4);
        assert(build.steps.slice(0, artifactOnly ? 3 : 4).every(s => s.status === "PASS"));
        assert.equal(build.protectedUnchanged, true); assert.equal(build.cleanupError, undefined);
        const adminRoot = path.join(qa, "administrator-" + attempt);
        const admin = load(path.join(adminRoot, "result.json"));
        const origin = load(path.join(adminRoot, "origin.json"));
        const task = load(path.join(adminRoot, "task-engine.json"));
        assert(admin.finishedAt && admin.isElevated && admin.probe?.isElevated && admin.probe.success);
        if (!artifactOnly) assert.equal(admin.exitCode, 0); assert.equal(admin.policyRestoration, "PASS");
        assert.equal(admin.physicalProtectionRestoration, "PASS");
        assert.equal(origin.originIsElevated, false); assert.equal(origin.userSid, admin.userSid);
        assert.equal(task.status, "TERMINAL"); assert.equal(task.cleanup, "PASS"); assert(task.finishedAt);
        const selected = build.nativeOutput;
        assert.equal(selected.result.requestId, selected.request.requestId);
        assert.equal(selected.result.ownerPid, build.launches[0].pid);
        assert.equal(selected.result.cancelled, false);
        assert.equal(path.resolve(selected.result.selectedPath), path.resolve(source, "Android 输出"));
        assert.match(selected.result.interaction, /User manual native folder selection/);
        if (artifactOnly) {
          r.publishingWorkflow = require("./lib/android-artifact-terminal.cjs")
            .validateArtifactTerminal({ build, admin, task });
          r.sources.push(desc(path.join(__dirname, "lib/android-artifact-terminal.cjs")));
        } else {
          const close = build.normalClose;
          assert.equal(close.receipt.status, "INPUT_COMPLETED");
          assert.equal(close.receipt.requestId, close.request.requestId);
          assert.equal(close.receipt.ownerPid, build.launches[0].pid);
        }
        assert(build.cleanups.length === 1 && build.cleanups[0].status === "PASS");
        if (!artifactOnly) assert.deepEqual(build.cleanups[0].killed, []);
        const restored = load(path.join(source, "cache-restoration.json"));
        assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
        return { scope: "Actual elevated host, manual native directory and Computer Use observation",
          sourceBuildReport: desc(buildFile), administrator: desc(path.join(adminRoot, "result.json")),
          task: desc(path.join(adminRoot, "task-engine.json")), physicalProtection: admin.physicalProtectionRestoration,
          cacheView: "Physical cleanup verified by original same-boundary administrator, not Codex redirected paths" };
      });
      await check("Actual signed current APK has the same identity and signer, increasing version and new embedded content", async () => {
        assert.equal(build.artifacts.length, 1);
        const current = build.artifacts[0]; assert.equal(current.kind, "android_apk");
        assert.equal(sha(current.path), current.sha256); r.sources.push(desc(current.path));
        const currentIdentity = identity(current.path, "current"); validatePair(oldIdentity, currentIdentity);
        const metadata = load(current.path + ".acceptance.json");
        assert.equal(verifyProvenance(current.path, metadata).status, "PASS");
        assert.equal(metadata.editorVersion, "1.9.22"); assert.equal(metadata.gameVersion, "0.1.1");
        assert.equal(metadata.packageName, currentIdentity.packageName);
        const archive = await JSZip.loadAsync(fs.readFileSync(current.path), { checkCRC32: true });
        const embedded = async suffix => {
          const entries = Object.values(archive.files).filter(e => !e.dir && e.name.endsWith("embedded-cartridge/" + suffix));
          assert.equal(entries.length, 1, suffix);
          const bytes = await entries[0].async("nodebuffer");
          return { sha256: hash(bytes), value: JSON.parse(bytes.toString("utf8")) };
        };
        const [m, s, l] = await Promise.all(["manifest.json", "script.json", "ui/layout.json"].map(embedded));
        validateCartridge(oldProject, project, m.value, s.value, l.value);
        assert.deepEqual(s.value, script); assert.deepEqual(l.value, layout);
        assert.equal(m.sha256, metadata.embeddedManifest.sha256);
        assert.equal(l.sha256, metadata.embeddedLayout.sha256);
        for (const [kind, relative] of [["engine", "GameCli_framework/src-tauri/Cargo.toml"],
          ["protocol", "shared/cartridge/constants.ts"]]) {
          const installation = read(build.installation.path);
          assert.equal(metadata.versionEvidence.sources[kind].sha256, sha(path.join(installation.installRoot, relative)));
        }
        r.upgradePair = { old: oldIdentity, current: currentIdentity, currentApk: desc(current.path) };
        return { ...r.upgradePair, metadata: desc(current.path + ".acceptance.json"),
          embedded: { manifest: m.sha256, script: s.sha256, layout: l.sha256 },
          serialization: "Actual JSON content and recomputed metadata hashes; no unsupported raw pre-optimization equality" };
      });
      await check("No surviving owned processes or ports; valid actual WebView screenshot dimensions", async () => {
        const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
        const live = rows(), known = [...build.knownProcesses, ...build.buildKnownProcesses];
        assert(!known.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
        assert.deepEqual(listeners(build.launches.flatMap(l => l.ports)), []);
        assert(build.screenshots.length >= 3);
        for (const shot of build.screenshots) {
          assert.equal(sha(shot.path), shot.sha256);
          assert.deepEqual(shot.before, shot.after);
          assert.equal(shot.before.width, 1920); assert.equal(shot.before.height, 1080);
          assert(Math.abs(shot.before.dpr - 1) < 1e-6); assert.equal(shot.before.reduced, false);
          const bytes = fs.readFileSync(shot.path);
          assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1080);
        }
        return { identities: known.length, screenshots: build.screenshots.length,
          scope: "1080p DPR1 normal publishing smoke, not the full runtime display matrix" };
      });
    }
    r.status = artifactOnly ? "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN"
      : terminal ? "APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN" : "PREBUILD_PASS_APK_AND_DEVICE_NOT_RUN";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  for (const f of r.sources) assert.equal(sha(f.path), f.sha256, "Audit must not modify original evidence");
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, out, checks: r.checks, error: r.error }, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
