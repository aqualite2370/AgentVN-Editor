"use strict";
// Controlled fault injection at the REAL installed Release native IPC boundary.
// Not a normal UI build, picker, Android, or clean-machine acceptance claim.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const root = "D:/AgentVN", run = `${root}/output/installed-resource-versions-20261019-01`;
const work = "F:/AgentVN/QA/Resource-Versions-20261019-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const shaBytes = b => crypto.createHash("sha256").update(b).digest("hex");
const normalized = p => path.resolve(p).replace(/^\\\\\?\\/, "").toLowerCase();
const mode = process.argv[2] || "run";
assert(["run", "audit"].includes(mode));
const attempt = process.argv.find(a => a.startsWith("--attempt="))?.slice(10) || "01";
assert(/^\d{2}$/.test(attempt));
const sourceAttempt = process.argv.find(a => a.startsWith("--source-attempt="))?.slice(17) || attempt;
assert(/^\d{2}$/.test(sourceAttempt));
const rawReportFile = path.join(run, `native-faults-${sourceAttempt}.json`);
const reportFile = mode === "run" ? rawReportFile : path.join(run, `terminal-audit-${attempt}.json`);
assert(fs.existsSync(run) && !fs.existsSync(reportFile), "Fresh evidence required");
const prep = read(path.join(run, "preparation.json"));
assert.equal(prep.status, "PASS");
const versionFile = path.join(prep.installRoot, "build-versions.json");
const backupFile = path.join(work, "original-build-versions.json");
const baselineFile = path.join(work, "fault-baseline.json");
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [],
  scope: "REAL_INSTALLED_NSIS_NATIVE_IPC_WINDOWS_CONTROLLED_RESOURCE_FAULTS_NOT_UI_EXPORT",
  realModelRequests: 0, androidInvocations: 0, productSourceChanges: 0,
  normalPickerTest: "NOT_RUN", fullCU10Status: "BLOCKED", error: null };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
async function check(name, fn) {
  const item = { name, status: "RUNNING" }; report.checks.push(item); save();
  try { item.detail = await fn(); item.status = "PASS"; return item.detail; }
  catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
  finally { save(); }
}
function inputs() {
  const source = `${root}/output/installed-runtime-abilities-20261018-01/export-03/report.json`;
  const exported = read(source); assert.equal(exported.status, "PASS");
  const cart = exported.cartridges.find(c => c.layout === "agentvn");
  assert(cart); assert.equal(sha(cart.path), cart.sha256);
  const project = read(`${root}/output/installed-runtime-abilities-20261018-01/fixtures-02.json`);
  assert.equal(normalized(fs.realpathSync(process.env.AGENTVN_TEST_PROJECT)),
    normalized(fs.realpathSync(project.input)));
  assert.equal(normalized(process.env.AGENTVN_WORKSPACE_OUTPUT), normalized(run));
  return { source, sourceSha256: sha(source), cart, project: { input: project.input,
    sha256: sha(project.input), projectId: project.projectId } };
}
function sourceBaseline() {
  const candidate = read(`${root}/output/full-regression-20261017-01/candidate-02/manifest.json`);
  const changed = read(`${root}/output/editor-selection-mask-20261019-01/terminal-audit-02.json`).sources;
  assert.equal(candidate.source.length, 560);
  const allowed = new Map(changed.map(s => [normalized(path.join(root, s.file)), s.sha256]));
  for (const file of candidate.source)
    assert.equal(sha(file.path), allowed.get(normalized(file.path)) || file.sha256, file.path);
  return { count: candidate.source.length, authorizedEditorChanges: allowed.size };
}
async function main() {
  let browser, original, mutated = false;
  try {
    if (mode === "audit") {
      const raw = read(rawReportFile), baseline = read(baselineFile);
      const restoredProfiles = read(path.join(run, "profile-restoration.json"));
      const originalLocal = prep.profiles.find(p => p.app === "editor" && p.kind === "Local");
      const testedLocal = restoredProfiles.profiles.find(p => p.app === "editor" && p.kind === "Local");
      assert(originalLocal && testedLocal && testedLocal.testHeld);
      const retainedPath = p => {
        const relative = path.relative(originalLocal.original, p);
        assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Diagnostic path escaped QA Local profile");
        return path.join(testedLocal.testHeld, relative);
      };
      await check("Five actual native faults completed and installation resource restored", () => {
        assert.equal(raw.status, "PASS"); assert.equal(raw.checks.length, 7);
        assert(raw.checks.every(c => c.status === "PASS"));
        assert.deepEqual(raw.checks.slice(1, 6).map(c => c.detail.case),
          ["missing", "empty-file", "malformed", "empty-version", "mismatch"]);
        assert.equal(sha(versionFile), baseline.version.sha256);
        assert.equal(sha(backupFile), baseline.version.sha256);
        for (const f of baseline.fixed) assert.equal(sha(f.path), f.sha256, f.path);
        return { cases: 5, rawSha256: sha(rawReportFile) };
      });
      await check("Every retained native failure has manifest/log/ZIP and no workspace or build output", async () => {
        for (const item of raw.checks.slice(1, 6)) {
          const { result, retained, case: label } = item.detail;
          assert.equal(result.failureCode, item.detail.expectedCode);
          for (const f of retained) assert.equal(sha(retainedPath(f.path)), f.sha256);
          assert(!fs.existsSync(retainedPath(path.join(path.dirname(result.diagnosticsDir), "build-workspace"))));
          assert.deepEqual(fs.readdirSync(path.join(work, "outputs", label)), []);
          const entries = await JSZip.loadAsync(fs.readFileSync(retainedPath(result.diagnosticsArchivePath)), { checkCRC32: true });
          assert(Object.keys(entries.files).some(n => /package-build-manifest\.json$/.test(n)));
          assert(Object.keys(entries.files).some(n => /standalone-windows-build\.log$/.test(n)));
        }
        return { retainedCases: 5, originalLocal: originalLocal.original, retainedLocal: testedLocal.testHeld,
          source: "Actual native return values and preserved QA diagnostics after original profile restoration, not mocked runner" };
      });
      await check("Original four profiles and independent backups restored", () => {
        const restored = read(path.join(run, "profile-restoration.json"));
        assert.equal(restored.status, "PASS");
        let count = 0;
        for (const p of prep.profiles) {
          assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
          for (const f of p.files) {
            assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
            assert.equal(sha(f.backup), f.sha256); count++;
          }
        }
        assert.equal(count, 55); return { files: count };
      });
      await check("Source identities and current Dev preserved", () => {
        assert.equal(sha(`${root}/AgentVN Dev.exe`), prep.originalDevSha256);
        return { ...sourceBaseline(), devSha256: prep.originalDevSha256 };
      });
      await check("Attributed cleanup completed without pretending normal close", () => {
        const stop = read(path.join(run, "final-stop.json"));
        assert.equal(stop.status, "PASS"); assert.equal(stop.normalWindowClose, "NOT_RUN");
        const { execFileSync } = require("node:child_process");
        const launch = read(path.join(run, "launch.json"));
        const text = execFileSync("powershell.exe", ["-NoProfile", "-Command", `
          $qaRemaining=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
            ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
          $qaListeners=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(8278,${launch.cdpPort},${launch.playerCdpPort})}|Select-Object LocalPort,OwningProcess)
          @{processes=$qaRemaining;listeners=$qaListeners}|ConvertTo-Json -Depth 4
        `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
        const state = JSON.parse(text.replace(/^\uFEFF/, ""));
        assert.equal(state.processes.length, 0); assert.equal(state.listeners.length, 0);
        return state;
      });
    } else {
      const fixture = inputs(), launch = read(path.join(run, "launch.json"));
      assert(prep.profiles.every(p => fs.existsSync(p.held)));
      assert.equal(launch.status, "PASS");
      assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")),
        "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
      assert.equal(fs.realpathSync(versionFile), fs.realpathSync(
        "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/build-versions.json"));
      original = fs.readFileSync(versionFile);
      assert.equal(JSON.parse(original.toString("utf8")).editorVersion, "1.9.9");
      assert(!fs.existsSync(backupFile) && !fs.existsSync(baselineFile));
      fs.writeFileSync(backupFile, original, { flag: "wx" });
      const baseline = { version: { path: versionFile, sha256: shaBytes(original) },
        fixed: ["agentvn-editor.exe", "creator-backend.exe", "agentvn-player.exe",
          "scripts/build-runtime-standalone-windows.cjs", "scripts/build-runtime-standalone-android.cjs"]
          .map(f => ({ path: path.join(prep.installRoot, f), sha256: sha(path.join(prep.installRoot, f)) })),
        fixture, sources: sourceBaseline() };
      fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2), { flag: "wx" });
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
      const page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
      assert(page);
      const native = (command, args) => page.evaluate(({ command, args }) =>
        window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
      report.launch = launch; report.fixture = fixture;
      await check("Preflight: frozen installed Release, authorized source identities and independent version backup", () => baseline);
      const cases = [
        ["missing", null, "EDITOR_BUILD_VERSION_MISSING"],
        ["empty-file", "", "EDITOR_BUILD_VERSION_INVALID"],
        ["malformed", "{", "EDITOR_BUILD_VERSION_INVALID"],
        ["empty-version", '{"editorVersion":" "}', "EDITOR_BUILD_VERSION_INVALID"],
        ["mismatch", '{"editorVersion":"0.0.0"}', "EDITOR_BUILD_VERSION_MISMATCH"],
      ];
      for (const [label, content, expectedCode] of cases) {
        assert.equal(sha(versionFile), shaBytes(original), "Previous fault was not restored");
        const output = path.join(work, "outputs", label);
        fs.mkdirSync(output, { recursive: true }); assert.deepEqual(fs.readdirSync(output), []);
        // Recovery journal exists on disk before the first installed-file mutation.
        report.pendingMutation = { path: versionFile, backup: backupFile,
          sha256: shaBytes(original), case: label }; save();
        mutated = true;
        if (content === null) fs.renameSync(versionFile, path.join(work, "temporarily-missing-build-versions.json"));
        else fs.writeFileSync(versionFile, content);
        let result;
        try {
          const bytes = fs.readFileSync(fixture.cart.path);
          const begin = await native("begin_standalone_package_upload", {
            fileName: path.basename(fixture.cart.path), expectedSize: bytes.length });
          const appended = await native("append_standalone_package_upload_chunk", {
            uploadId: begin.uploadId, fileKind: "cartridge", offsetBytes: 0, chunkBytes: [...bytes] });
          assert.equal(appended.writtenBytes, bytes.length);
          result = await native("build_standalone_package_from_upload", {
            uploadId: begin.uploadId, targetPlatform: "windows", outputDir: output,
            runId: `resource-version-${label}-20261019`, optimizationProfile: "off",
            releaseIdentity: { gameId: fixture.cart.gameId, gameVersion: "0.1.0",
              releaseId: `resource-fault-${label}` }, iconSource: "default" });
        } finally {
          if (content === null) fs.renameSync(path.join(work, "temporarily-missing-build-versions.json"), versionFile);
          else fs.writeFileSync(versionFile, original);
          assert.equal(sha(versionFile), shaBytes(original)); mutated = false;
          report.pendingMutation = null; save();
        }
        await check(`Native Windows resource failure: ${label}`, async () => {
          assert.equal(result.ok, false); assert.equal(result.status, "FAIL");
          assert.equal(result.failureCode, expectedCode);
          assert(result.message.includes("build-versions.json") && result.message.includes("重新安装"), result.message);
          const lookup = result.message.match(/editor build version (.*?): /);
          assert(lookup, "Actual lookup path missing from error");
          assert.equal(fs.realpathSync(path.dirname(lookup[1])), fs.realpathSync(prep.installRoot));
          assert(!/D:[\\/]AgentVN/i.test(result.message), "Release fell back to development workspace");
          assert.deepEqual(result.artifacts, []); assert.deepEqual(fs.readdirSync(output), []);
          const retained = ["manifestPath", "buildLogPath", "diagnosticsArchivePath"].map(key => {
            assert(result[key] && fs.existsSync(result[key]), `${key} missing`);
            assert(normalized(result[key]).startsWith(normalized(
              "C:/Users/1/AppData/Local/com.agentvn.editor/standalone-package") + path.sep.toLowerCase()));
            return { kind: key, path: result[key], sha256: sha(result[key]), bytes: fs.statSync(result[key]).size };
          });
          assert.equal(read(result.manifestPath).failureCode, expectedCode);
          assert(fs.readFileSync(result.buildLogPath, "utf8").includes(expectedCode));
          const zip = await JSZip.loadAsync(fs.readFileSync(result.diagnosticsArchivePath), { checkCRC32: true });
          assert(Object.keys(zip.files).some(n => /package-build-manifest\.json$/.test(n)));
          assert(Object.keys(zip.files).some(n => /standalone-windows-build\.log$/.test(n)));
          assert(!fs.existsSync(path.join(path.dirname(result.diagnosticsDir), "build-workspace")));
          return { case: label, expectedCode, result, retained,
            lookupPath: lookup[1], nativePickerClaim: false, compilationStarted: false };
        });
        console.log(`PASS native resource case ${label}`);
      }
      await check("Installed resource and fixed binaries/scripts restored after every case", () => {
        assert.equal(sha(versionFile), baseline.version.sha256);
        for (const f of baseline.fixed) assert.equal(sha(f.path), f.sha256);
        return { versionSha256: sha(versionFile), fixedFiles: baseline.fixed.length };
      });
    }
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    if (mutated && original) {
      try { fs.writeFileSync(versionFile, original); report.emergencyRestoreSha256 = sha(versionFile); }
      catch (e) { report.restoreError = String(e); }
    }
    if (browser) await browser.close().catch(() => {});
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, reportFile, error: report.error }));
  }
}
main();
