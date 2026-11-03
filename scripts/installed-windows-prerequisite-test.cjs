"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const out = path.join(__dirname, "../output/windows-prerequisite-validation",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", cases: [] };
try {
  const { validateWindowsPrerequisite } = require("./lib/installed-windows-prerequisite.cjs");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-windows-proof-"));
  const executable = path.join(temporary, "agentvn-editor.exe");
  fs.writeFileSync(executable, "test-only installed executable");
  const file = path.join(temporary, "windows.json");
  const auditFile = path.join(temporary, "installation.json");
  const identity = { kind: "NSIS actual isolated installation", installedRoot: temporary,
    executable: { path: executable, sha256: sha256(fs.readFileSync(executable)) } };
  fs.writeFileSync(auditFile, JSON.stringify({ status: "PASS", deployments: [identity] }));
  const evidence = p => ({ path: p, sha256: sha256(fs.readFileSync(p)) });
  const fixture = { projectId: "installed_resource_flow_story_test" };
  const valid = { status: "INSTALLED_CURRENT_WINDOWS_PASS", installRoot: temporary,
    executable: evidence(executable), installationAudit: evidence(auditFile), fixture,
    editorCleanup: { editor: { exitCode: 0 }, backend: { exitCode: 0 } }, errors: [], cases: [] };
  const player = path.join(temporary, "player.exe"); fs.writeFileSync(player, "test-only exported player");
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const viewport = { width, height, dpr, reduced };
      const nativeFile = path.join(temporary, `native-${width}-${dpr}-${reduced}.json`);
      const pngFile = path.join(temporary, `sample-${width}-${dpr}-${reduced}.png`);
      const header = Buffer.alloc(24);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
      header.writeUInt32BE(width * dpr, 16); header.writeUInt32BE(height * dpr, 20);
      fs.writeFileSync(pngFile, header);
      fs.writeFileSync(nativeFile, JSON.stringify({ status: "INSTALLED_FULL_STORY_RUNTIME_PASS",
        scope: "Actual installed-editor export; native player with WebView CDP viewport emulation",
        viewport, executable: player, executableSha256: evidence(player).sha256, cleanupExitCode: 0,
        viewportChecks: [viewport], finalViewport: viewport,
        screenshots: [{ ...evidence(pngFile), before: viewport, after: viewport,
          png: { width: width * dpr, height: height * dpr } }],
        cases: [{ name: "real native flow", status: "PASS" }], errors: [] }));
      valid.cases.push({ ...viewport, status: "PASS", report: evidence(nativeFile) });
    }
  }
  function test(name, mutate, expected) {
    const value = structuredClone(valid); mutate(value);
    fs.writeFileSync(file, JSON.stringify(value));
    if (expected) assert.throws(() => validateWindowsPrerequisite(file, { auditFile, fixture }), expected);
    else assert.equal(validateWindowsPrerequisite(file, { auditFile, fixture }).status, "VERIFIED_CURRENT_INSTALLED_WINDOWS");
    report.cases.push({ name, status: "PASS" });
  }
  test("current real installed matrix accepted", () => {});
  test("empty matrix rejected", v => { v.cases = []; }, /12/);
  test("duplicate matrix rejected", v => { v.cases[1] = v.cases[0]; }, /Duplicate/);
  test("failed matrix rejected", v => { v.cases[0].status = "FAILED"; }, /PASS/);
  test("different project rejected", v => { v.fixture.projectId = "other"; }, /project/);
  test("different installation rejected", v => { v.installRoot += "-other"; }, /installation/);
  test("editor bytes drift rejected", v => { v.executable.sha256 = "0".repeat(64); }, /SHA|hash/);
  test("failed cleanup rejected", v => { v.editorCleanup.backend.exitCode = 1; }, /cleanup/);
  test("runtime evidence drift rejected", v => { v.cases[0].report.sha256 = "0".repeat(64); }, /SHA|hash/);
  test("pending report rejected", v => { v.status = "RUNNING"; }, /Unsupported/);
  function mutateNative(value, mutate) {
    const native = JSON.parse(fs.readFileSync(value.cases[0].report.path)); mutate(native);
    const changed = path.join(temporary, "changed-native.json");
    fs.writeFileSync(changed, JSON.stringify(native)); value.cases[0].report = evidence(changed);
  }
  test("DPR claims without actual viewport samples rejected",
    v => mutateNative(v, n => { delete n.viewportChecks; }), /viewport/i);
  fs.writeFileSync(file, JSON.stringify({ status: "INSTALLED_PORTABLE_SAVE_FLOW_PASS" }));
  assert.equal(validateWindowsPrerequisite(file, { auditFile, fixture }).status, "HISTORICAL_PORTABLE_SAVE_SCOPE_ONLY");
  report.cases.push({ name: "legacy proof explicitly scoped, never called current matrix", status: "PASS" });
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
}
