"use strict";
// Read-only product checks for this candidate. Evidence is always append-only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Editor-1.9.22-20261022-01";
const [mode, attempt = "01"] = process.argv.slice(2);
assert(["baseline", "terminal", "terminal-expanded"].includes(mode));
assert.match(attempt, /^\d{2}$/);
const destination = path.join(qa, `${mode}-${attempt}.json`);
assert(!fs.existsSync(destination), "Never overwrite evidence");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({
  path: file, sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString(),
});
const protectedFiles = [
  path.join(process.env.APPDATA, "com.agentvn.editor/backend/vn_engine.db"),
  path.join(root, "AgentVN Dev.exe"),
  path.join(root, "releases/editor/AgentVN_Editor_v1.9.21_20261022_005853.exe"),
  path.join(root, "releases/editor/AgentVN_Editor_v1.9.22_20261022_122816.exe"),
];
const report = {
  status: "RUNNING", mode, startedAt: new Date().toISOString(), cases: [],
  scope: "CURRENT_CANDIDATE_PROVENANCE_AND_INSTALLED_AUTHORING_NOT_FULL_REGRESSION",
  modelRequests: 0,
};
function check(name, fn) {
  const row = { name, status: "RUNNING" };
  report.cases.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; throw error; }
}
try {
  if (mode === "baseline") {
    check("protected-file-baseline", () => {
      report.protectedFiles = protectedFiles.map(describe);
      assert.equal(report.protectedFiles.length, 4);
      return report.protectedFiles;
    });
    check("completed-dev-and-single-exe-candidate", () => {
      const dev = read(path.join(qa, "dev-01/report.json"));
      const built = read(path.join(qa, "package-01/report.json"));
      assert.equal(dev.status, "PASS"); assert.equal(built.status, "PASS");
      assert.equal(dev.exitCode, 0); assert.equal(built.exitCode, 0);
      assert.equal(sha(dev.dev.path), dev.dev.sha256);
      assert.equal(dev.dev.sha256, sha(dev.debug.path));
      assert.equal(built.newInstallers.length, 1);
      assert.equal(sha(built.newInstallers[0].path), built.newInstallers[0].sha256);
      assert.equal(built.versionMetadata.value.editorVersion, "1.9.22");
      return { dev: dev.dev, installer: built.newInstallers[0] };
    });
  } else {
    const baseline = read(path.join(qa, "baseline-01.json"));
    assert.equal(baseline.status, "PASS");
    check("default-database-dev-and-frozen-installers-unchanged", () => {
      for (const file of baseline.protectedFiles) assert.equal(sha(file.path), file.sha256, file.path);
      return baseline.protectedFiles;
    });
    check("actual-installation-matches-sealed-payload", () => {
      const installed = read(path.join(qa, "install-01/actual-installation.json"));
      const payload = read(path.join(qa, "payload-01/installer-resource-report.json"));
      assert.equal(installed.status, "PASS"); assert.equal(installed.registryRestored, true);
      assert.equal(payload.status, "PASS");
      assert.equal(sha(installed.executable.path), payload.deployments[0].executable.sha256);
      assert.equal(installed.installer.sha256, baseline.protectedFiles[3].sha256);
      for (const item of payload.runtimeCandidate)
        assert.equal(sha(path.join(installed.installRoot, item.name)), item.sha256);
      return { installed: installed.executable, installer: installed.installer };
    });
    const author = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/report.json");
    check("seventeen-real-installed-author-pages-and-process-restart", () => {
      assert.equal(author.status, "PASS"); assert.equal(author.mode, "author");
      assert.equal(author.pages.length, 17); assert.equal(author.expectedPages, 17);
      assert(author.pages.every(p => p.status === "PASS" && p.author?.otherTypeUnchanged));
      assert.equal(author.matrix.length, 1);
      assert(author.steps.some(s => s.label === "Process restart preserves two layout profiles" && s.status === "PASS"));
      assert.equal(author.modelRequests, 0);
      assert.deepEqual(author.errors, []);
      assert.equal(author.nativeCacheRestoration, "PASS");
      assert.equal(author.launches.length, 2);
      assert.equal(author.cleanups.length, 2);
      assert(author.cleanups.every(c => c.status === "PASS"));
      return { pages: 17, matrix: author.matrix, launches: 2, nativeCacheRestoration: "PASS" };
    });
    check("owned-processes-ports-and-cache-restoration", () => {
      const processIds = [...new Set(author.knownProcesses.map(p => p.ProcessId))];
      const ports = [...new Set(author.launches.flatMap(p => p.ports))];
      assert(processIds.length > 0 && ports.length === 4);
      const output = execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `$qaIds=@(${processIds.join(",")});$qaPorts=@(${ports.join(",")});` +
        "[pscustomobject]@{processes=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in $qaIds}|Select-Object ProcessId,CreationDate);" +
        "listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in $qaPorts}|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 5 -Compress"],
      { encoding: "utf8", windowsHide: true });
      const actual = JSON.parse(output); assert.deepEqual(actual.processes, []); assert.deepEqual(actual.listeners, []);
      const restored = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/native-cache-restoration.json");
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      return { processIds, ports, actual, restored };
    });
    if (mode === "terminal-expanded") {
      const special = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-39/report.json");
      const exported = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-44/report.json");
      check("installed-special-authoring-portable-and-shipped-player-consumption", () => {
        for (const [result, count] of [[special, 6], [exported, 2]]) {
          assert.equal(result.status, "PASS"); assert(result.finishedAt);
          assert.equal(result.steps.length, count);
          assert(result.steps.every(s => s.status === "PASS"));
          if (result === special) assert.equal(result.nativeCacheRestoration, "PASS");
          assert.equal(result.modelRequests, 0); assert.deepEqual(result.errors, []);
          if (result === special) assert(result.cleanups.length > 0 && result.cleanups.every(c => c.status === "PASS"));
        }
        assert.equal(exported.playerCleanup, "PASS");
        assert.equal(sha(special.portable.retained), special.portable.sha256);
        assert(!fs.existsSync(special.portable.original), "Owned download must be retained on F and removed from Downloads");
        assert.equal(sha(exported.cartridge.path), exported.cartridge.sha256);
        assert.equal(sha(exported.player.executable), exported.player.sha256);
        const failed = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-37/report.json");
        assert.equal(failed.status, "FAILED");
        assert(failed.error.includes("details"));
        assert.equal(failed.nativeCacheRestoration, "PASS");
        assert.equal(exported.resumedDownload.originalStatus, "FAILED");
        assert.equal(exported.resumedDownload.newExportRequests, 0);
        return { specialCases: 6, exportContinuationCases: 2, portable: special.portable, cartridge: exported.cartridge,
          player: exported.player, originalFailedEvidenceRetained: true };
      });
      check("actual-screenshot-parameters-and-png-pixels", () => {
        const screenshots = [...author.screenshots, ...special.screenshots, ...exported.screenshots];
        assert(screenshots.length >= 6);
        for (const shot of screenshots) {
          assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
          const bytes = fs.readFileSync(shot.path), { width, height, dpr, reduced } = shot.before;
          assert.equal(width, 1920); assert.equal(height, 1080); assert.equal(reduced, false);
          assert(Math.abs(dpr - 1) <= 1e-6);
          assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
        }
        return { count: screenshots.length, display: "1080p DPR1 ordinary; not full matrix or physical 4K" };
      });
      check("all-current-success-and-failed-qa-sessions-have-no-process-port-or-cache-residue", () => {
        const sessions = Array.from({ length: 8 }, (_, index) => {
          const number = index + 37;
          const result = read(`F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${number}/report.json`);
          assert(result.finishedAt, `Session ${number} must have ended before terminal audit`);
          if (result.launches.length > 0) assert.equal(result.nativeCacheRestoration, "PASS");
          if (result.player) assert.equal(result.playerCleanup, "PASS");
          return { number, result };
        });
        const processIds = [...new Set(sessions.flatMap(({ result }) =>
          [...(result.knownProcesses || []), ...(result.playerProcesses || [])].map(p => p.ProcessId)))];
        const ports = [...new Set(sessions.flatMap(({ result }) =>
          result.launches.flatMap(l => l.ports).concat(result.player ? [result.player.port] : [])))];
        assert(processIds.length > 0 && ports.length >= 5);
        const output = execFileSync("powershell.exe", ["-NoProfile", "-Command",
          `$qaIds=@(${processIds.join(",")});$qaPorts=@(${ports.join(",")});` +
          "[pscustomobject]@{processes=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in $qaIds}|Select-Object ProcessId);" +
          "listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in $qaPorts}|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 5 -Compress"],
        { encoding: "utf8", windowsHide: true });
        const actual = JSON.parse(output); assert.deepEqual(actual.processes, []); assert.deepEqual(actual.listeners, []);
        return { sessions: sessions.map(({ number, result }) => ({ number, originalStatus: result.status })),
          processIds, ports, actual };
      });
    }
  }
  assert(report.cases.length > 0 && report.cases.every(row => row.status === "PASS"));
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}
report.finishedAt = new Date().toISOString(); report.tool = describe(__filename);
fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, destination, cases: report.cases.length, error: report.error }));
