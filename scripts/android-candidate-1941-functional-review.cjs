"use strict";
// Independent observation of frozen artifacts and completed device receipts.
// No builds, emulator launch, synthetic input, model requests or product edits.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { verify } = require("./lib/android-dialog-held-input.cjs");
const storyAudit = require("./android-current-story-device-audit.cjs");
const JSZip = require("../editor/node_modules/jszip");
const base = "F:/AgentVN/QA/Android-Candidate-1941-20261103-02";
const qa = "F:/AgentVN/QA/Android-Package-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
async function run(number) {
  assert.match(number, /^\d{2}$/);
  const out = path.join(base, `functional-review-${number}.json`); assert(!fs.existsSync(out));
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], sources: [desc(__filename)],
    builds: 0, deviceOperations: 0, productChanges: 0, modelRequests: 0 };
  const load = f => { r.sources.push(desc(f)); return read(f); };
  const check = async (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (e) {
      row.status = e.evidenceGap === true ? "BLOCKED" : "FAILED";
      row.error = String(e.stack || e);
      if (e.evidence) row.evidence = e.evidence;
    }
  };
  try {
    const c = load(path.join(base, "config.json"));
    const build = load(path.join(qa, "editor-43/report.json"));
    const artifact = load(path.join(qa, "story-artifact-43-audit-01/report.json"));
    const bindingFile = path.join(base, "android-story-device-43-01/binding.json");
    const binding = load(bindingFile);
    const directory = path.join(binding.output, "runtime");
    const runtime = load(path.join(directory, "runtime-smoke-report.json"));
    const owner = load(path.join(directory, "acceptance-launch.json"));
    const request = load(path.join(binding.output, "request-submitted.json"));
    const wrapper = load(path.join(binding.output, "report.json"));
    await check("Exactly one installed-candidate build after zero-build disk rejection", () => {
      const failed = load(path.join(qa, "editor-42/report.json"));
      assert.equal(failed.builds, 0); assert.equal(failed.launches.length, 0); assert(failed.finishedAt);
      assert.match(failed.error, /Insufficient C-space/);
      assert.equal(build.status, "PASS"); assert.equal(build.version, "1.9.41");
      assert.equal(build.builds, 1); assert.equal(build.productChanges, 0); assert.equal(build.modelRequests, 0);
      assert.equal(artifact.status, "NARRATIVE_APK_ARTIFACT_PASS_DEVICE_NOT_RUN");
      assert.equal(artifact.checks.length, 6); assert(artifact.checks.every(v => v.status === "PASS"));
      assert.equal(sha(artifact.apk.path), artifact.apk.sha256);
      const admin = load(path.join(qa, "administrator-43/result.json"));
      const origin = load(path.join(qa, "administrator-43/origin.json"));
      assert.equal(origin.originIsElevated, false); assert.equal(admin.isElevated, true);
      assert.equal(admin.userSid, origin.userSid); assert(admin.probe.success && admin.probe.isElevated);
      assert.equal(admin.physicalProtectionRestoration, "PASS");
      const prep = load(path.join(base, "preparation-source.json"));
      for (const f of [prep.source, prep.retry, prep.previous]) assert.equal(sha(f.path), f.sha256);
      return { apk: artifact.apk, version: c.version, gameVersion: c.gameVersion, buildAttempts: 1,
        failedBeforeBuild: desc(path.join(qa, "editor-42/report.json")), normalClose: build.normalClose?.method };
    });
    await check("Actual compiled dialogue bytes match installed source and APK frontend", async () => {
      const physical = path.resolve("C:/Users/1/AppData/Local/com.agentvn.editor/standalone-package");
      const rel = path.relative(physical, build.materializedWorkspace.path);
      assert(rel && !path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..");
      const archived = path.join(qa, "editor-43/native-standalone-package", rel);
      const installed = read(c.installation.path).installRoot;
      const proven = [];
      for (const relative of ["GameCli_framework/src/components/player/DialogBox.tsx",
        "GameCli_framework/src/components/player/StoryPlayer.tsx"]) {
        const a = path.join(archived, relative), b = path.join(installed, relative);
        const protectedFile = build.protectedFiles.find(f => path.resolve(f.path) === path.resolve(b));
        assert(protectedFile?.existed, "Installed source must have a pre-build hash");
        assert.equal(sha(b), protectedFile.sha256);
        r.sources.push(desc(b)); proven.push(desc(b));
        if (fs.existsSync(a)) {
          assert.equal(sha(a), sha(b)); r.sources.push(desc(a));
        }
      }
      if (!fs.existsSync(path.join(archived, "GameCli_framework/dist/assets"))) {
        const metadata = load(artifact.apk.path + ".acceptance.json");
        assert.equal(metadata.nativeCleanup?.source, "editor-native-final-cleanup");
        assert.equal(metadata.nativeCleanup?.status, "PASS");
        assert.equal(metadata.apk.sha256, artifact.apk.sha256);
        const retained = build.materializedWorkspace.files.map(f => {
          assert(f.archivedBytes); assert.equal(sha(f.archivedBytes.path), f.sha256);
          r.sources.push(desc(f.archivedBytes.path)); return f.archivedBytes;
        });
        const gap = new Error("Compiled frontend and dialogue build-input bytes were not captured before native success cleanup; installed-source hashes and four retained inputs cannot substitute for them");
        gap.evidenceGap = true;
        gap.evidence = { installedSource: proven, retainedBuildInputs: retained,
          unavailable: path.join(archived, "GameCli_framework/dist/assets"),
          apkEmbeddedChunkComparison: "NOT_RUN_MISSING_BUILD_BYTES",
          additionalBuilds: 0, historicalReview: desc(path.join(base, "functional-review-01.json")) };
        throw gap;
      }
      const assets = path.join(archived, "GameCli_framework/dist/assets");
      const chunks = fs.readdirSync(assets).filter(n => /^StoryPlayer-.*\.js$/.test(n));
      assert.equal(chunks.length, 1);
      const file = path.join(assets, chunks[0]), zip = await JSZip.loadAsync(fs.readFileSync(artifact.apk.path));
      const entries = Object.values(zip.files).filter(v => !v.dir && v.name.endsWith("/assets/" + chunks[0]));
      assert.equal(entries.length, 1);
      assert((await entries[0].async("nodebuffer")).equals(fs.readFileSync(file)));
      r.sources.push(desc(file)); return { source: proven, actualCompiledChunk: desc(file), apkEntry: entries[0].name };
    });
    await check("Real 650ms touches, all three dialogue modes, every authored page and menus", () => {
      storyAudit.assertStoryComplete(runtime);
      assert(runtime.heldDialogueInputs.length >= 3);
      for (const row of runtime.heldDialogueInputs) { assert.equal(row.status, "PASS"); verify(row); }
      const modes = [...new Set(runtime.heldDialogueInputs.map(v => v.before.mode))].sort();
      assert.deepEqual(modes, ["bubble", "dialog", "nvl"]);
      assert.equal(wrapper.builds, 0); assert.equal(wrapper.productChanges, 0); assert.equal(wrapper.modelRequests, 0);
      assert.equal(runtime.sourceApk.sha256, artifact.apk.sha256); assert.equal(runtime.sourceApk.path, artifact.apk.path);
      assert.equal(runtime.playerAspect.status, "PASS");
      return { modes, heldInputs: runtime.heldDialogueInputs.length, fullStoryCases: runtime.fullStory.cases.length,
        touches: runtime.touches.length, restarts: runtime.restartTrials.length,
        newListening: false, physicalOlderAndroid: "NOT_CLAIMED" };
    });
    await check("Actual screenshots, historical audio identity and final process/package/staging cleanup", () => {
      for (const f of runtime.screenshots) {
        const png = fs.readFileSync(f);
        assert.equal(png.readUInt32BE(16), runtime.viewport.physical.width);
        assert.equal(png.readUInt32BE(20), runtime.viewport.physical.height); r.sources.push(desc(f));
      }
      assert(runtime.screenshots.length > 0);
      assert.equal(runtime.audioConfirmation.newCapture, false);
      assert.equal(runtime.audioConfirmation.status, "USER_CONFIRMED_PASS");
      assert.equal(runtime.uninstallStatus, "PASS"); assert.equal(runtime.apkCleanupStatus, "PASS");
      assert.equal(runtime.cleanupError, null); assert.equal(owner.emulatorCleanupStatus, "PASS");
      assert(owner.finishedAt && wrapper.finishedAt);
      assert(!fs.existsSync(path.join(directory, "staging.apk")));
      assert.equal(sha(artifact.apk.path), artifact.apk.sha256);
      const ports = [request.adbPort, request.cdpPort, request.coldBoot.adbPort, request.coldBoot.grpcPort, 5554, 5555];
      assert.deepEqual(listeners(ports), []);
      const live = rows(), boot = load(path.join(directory, "cold-boot.json"));
      const owned = [...boot.processes.map(v => v.ProcessId), owner.processId, runtime.ownership.runnerPid];
      assert(!live.some(n => owned.includes(n.ProcessId)), "Recorded process still exists; inspect creation identity before any cleanup");
      return { screenshots: runtime.screenshots.length, package: "PASS", staging: "PASS", emulator: "PASS", ports, owned };
    });
    r.rendererReview = storyAudit.reviewLogs(runtime, directory);
    r.warnings = [runtime.logcat?.warnings || [], ...(runtime.restartTrials || []).map(t => t.warnings || [])].flat();
    r.rawStatus = runtime.status; r.featureStatus = r.checks[2].status;
    r.status = r.checks.some(v => v.status === "FAILED") ? "FAILED"
      : r.checks.some(v => v.status === "BLOCKED") ? "BLOCKED_BUILD_INPUT_RETENTION_AND_LOG_REVIEW"
      : r.rendererReview.events.length || r.warnings.length || runtime.status !== "RUNTIME_PASS"
        ? "BLOCKED_LOG_REVIEW_FEATURES_PASS" : "PASS";
    r.limitations = ["API35 emulator only; no Android<10 or physical phone claim",
      "No new audio listening; no covering-up of earlier FAILED/BLOCKED reports",
      "Installed Editor with one restored controlled output directory; native picker NOT_RUN",
      "Pure motion, unrelated candidate matrices and final user project not rerun"];
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); }
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, featureStatus: r.featureStatus, out,
    checks: r.checks.map(({ name, status }) => ({ name, status })), error: r.error }));
  if (r.status === "FAILED") process.exitCode = 1;
}
if (require.main === module) run(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
