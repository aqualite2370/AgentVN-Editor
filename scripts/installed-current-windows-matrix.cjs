"use strict";
// Re-exercise an unchanged actual installed-editor export. No second import,
// export, build, installation, or reuse of unverified native DPR assertions.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");
const { validateWindowsPrerequisite } = require("./lib/installed-windows-prerequisite.cjs");
assert([4, 5].includes(process.argv.length),
  "node script <actual-windows-acceptance-root> <fresh-matrix-output> [--resume-matrix=failed-report]");
const root = path.resolve(__dirname, ".."), originalRoot = path.resolve(process.argv[2]), out = path.resolve(process.argv[3]);
assert(A.inside(path.join(root, "output"), originalRoot) && A.inside(path.join(root, "output"), out));
assert(!fs.existsSync(out));
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const evidence = file => ({ path: file, sha256: A.sha256(fs.readFileSync(file)) });
const previousFile = path.join(originalRoot, "report.json"), previous = read(previousFile);
const exportFile = path.join(originalRoot, "windows-installed-report.json"), exported = read(exportFile);
assert.equal(exported.status, "INSTALLED_WINDOWS_EXPORT_PASS_RUNTIME_PENDING");
assert.equal(read(exported.exportReport).status, "RESULT_READY");
assert.match(read(exported.exportReport).result, /Windows[\s\S]*构建成功/);
assert.equal(previous.editorCleanup.editor.exitCode, 0); assert.equal(previous.editorCleanup.backend.exitCode, 0);
const fixture = previous.fixture, auditFile = previous.installationAudit.path, audit = read(auditFile);
assert.equal(evidence(auditFile).sha256, previous.installationAudit.sha256);
assert.equal(evidence(previous.executable.path).sha256, previous.executable.sha256);
const installations = audit.deployments.filter(d => d.kind === "NSIS actual isolated installation");
assert.equal(installations.length, 1); assert.equal(installations[0].installedRoot, previous.installRoot);
assert.equal(fixture.projectId, exported.fixture.projectId);
assert.equal(evidence(previous.input.path).sha256, fixture.sha256);
assert(previous.resources.length > 0);
for (const row of previous.resources)
  for (const base of [root, previous.installRoot])
    assert.equal(evidence(path.join(base, row.relative)).sha256, row.sha256);
fs.mkdirSync(out);
const file = path.join(out, "report.json");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "Actual unchanged installed-editor export, corrected native viewport capture and full-story matrix",
  fixture, installRoot: previous.installRoot, executable: previous.executable, input: previous.input,
  sourceFixture: previous.sourceFixture, installationAudit: previous.installationAudit, resources: previous.resources,
  editorCleanup: previous.editorCleanup, errors: [], cases: [],
  exportEvidence: evidence(exportFile), environment: previous.environment,
  supersededNativeMatrix: { path: previousFile, scope: "Original DPR2 claims are unverified; no native rows reused" } };
const resumeArg = process.argv[4];
let resumed;
if (resumeArg) {
  assert(resumeArg.startsWith("--resume-matrix="));
  const resumeFile = path.resolve(resumeArg.slice("--resume-matrix=".length));
  resumed = read(resumeFile);
  assert.equal(resumed.status, "FAILED", "Keep the previous failed matrix unchanged");
  assert.equal(resumed.exportEvidence.sha256, report.exportEvidence.sha256, "Cannot reuse another export");
  assert.equal(resumed.installRoot, report.installRoot);
  assert.equal(resumed.executable.sha256, report.executable.sha256);
  report.referencedVerifiedRows = { ...evidence(resumeFile), scope: "Only PASS rows with actual viewport and screenshot proof" };
}
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));
(async () => {
  save();
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const reusable = resumed?.cases.find(c => c.status === "PASS" && c.width === width && c.height === height
        && c.dpr === dpr && c.reduced === reduced);
      if (reusable) {
        assert.equal(evidence(reusable.report.path).sha256, reusable.report.sha256);
        const native = read(reusable.report.path), viewport = { width, height, dpr, reduced };
        assert.equal(native.status, "INSTALLED_FULL_STORY_RUNTIME_PASS");
        assert.deepEqual(native.viewport, viewport); assert.deepEqual(native.finalViewport, viewport);
        assert(native.viewportChecks.length > 0 && native.screenshots.length > 0);
        for (const actual of native.viewportChecks) assert.deepEqual(actual, viewport);
        for (const shot of native.screenshots) {
          assert.equal(evidence(shot.path).sha256, shot.sha256);
          assert.deepEqual(shot.before, viewport); assert.deepEqual(shot.after, viewport);
          const png = fs.readFileSync(shot.path);
          assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), height * dpr);
        }
        report.cases.push({ ...reusable, execution: "REFERENCED_UNCHANGED_VERIFIED_NATIVE_FLOW" }); save();
        console.log(`REFERENCED verified ${width}/${dpr}/${reduced}`);
        continue;
      }
      const row = { width, height, dpr, reduced, status: "RUNNING", startedAt: new Date().toISOString() };
      report.cases.push(row); save();
      const oldDirectories = new Set(fs.readdirSync(originalRoot));
      row.command = [process.execPath, path.join(__dirname, "installed-full-story-runtime-playwright.cjs"), originalRoot];
      row.environment = { ...previous.environment, FULL_STORY_ATTEMPT: "", FULL_STORY_SESSION: "nsis-session-01",
        FULL_STORY_FIXTURE_REPORT: path.join(originalRoot, "fixture-report.json"), E5_LIFECYCLE_SOURCE: "",
        INSTALLED_ACCEPTANCE_VIEWPORT_WIDTH: String(width), INSTALLED_ACCEPTANCE_VIEWPORT_HEIGHT: String(height),
        INSTALLED_ACCEPTANCE_DPR: String(dpr), INSTALLED_ACCEPTANCE_REDUCED_MOTION: reduced ? "1" : "" };
      const log = fs.createWriteStream(path.join(out, `native-${width}-${dpr}-${reduced}.log`), { flags: "wx" });
      const child = spawn(process.execPath, row.command.slice(1), { cwd: root, windowsHide: true,
        env: { ...process.env, ...row.environment }, stdio: ["ignore", "pipe", "pipe"] });
      row.pid = child.pid; save();
      child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
      row.exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject); child.once("close", resolve);
      });
      log.end();
      assert.equal(row.exitCode, 0, "Stop on original native failure, never replace it");
      const fresh = fs.readdirSync(originalRoot).filter(n => n.startsWith("full-story-runtime-") && !oldDirectories.has(n));
      assert.equal(fresh.length, 1);
      const nativeFile = path.join(originalRoot, fresh[0], "report.json"), native = read(nativeFile);
      assert.equal(native.status, "INSTALLED_FULL_STORY_RUNTIME_PASS");
      assert.equal(native.cases.length, 9); assert(native.cases.every(c => c.status === "PASS"));
      assert.equal(native.cleanupExitCode, 0);
      row.report = evidence(nativeFile); row.status = "PASS"; row.finishedAt = new Date().toISOString(); save();
      console.log(`PASS ${width}x${height} DPR=${dpr} reduced=${reduced}`);
    }
  }
  report.status = "INSTALLED_CURRENT_WINDOWS_PASS"; save();
  report.prerequisiteValidation = validateWindowsPrerequisite(file, { auditFile, fixture });
})().catch(error => {
  if (report.cases.at(-1)?.status === "RUNNING") report.cases.at(-1).status = "FAILED";
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, file, error: report.error }));
});
