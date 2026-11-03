"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validateConfig, build } = require("./installed-editor-android-candidate.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const [configFile, reportFile] = process.argv.slice(2);
assert(configFile && reportFile && !fs.existsSync(reportFile));
const c = read(configFile), r = { status: "RUNNING", startedAt: new Date().toISOString(),
  tests: [], productLaunches: 0, apkBuilds: 0, modelRequests: 0 };
function test(name, fn) {
  const row = { name, status: "RUNNING" }; r.tests.push(row);
  try { row.evidence = fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
try {
  test("Official GUI selection uses the actual saved author project and byte checks", () => {
    const next = { ...c, fixtureKind: "renpy-official" }; validateConfig(next);
    const source = build("business", next).source;
    assert(source.includes('renpyAndroidFixture: retainedAndroidFixture'));
    assert(source.includes("report.fixtureProvenance = upgrade.provenance"));
    assert(source.includes("report.exportedAssetProofs = upgrade.provenance.priorCartridge.assets"));
    assert(source.includes('upgrade ? "GUI_CONTINUE"'));
    assert(source.includes('upgrade.applicationId'));
    assert(source.includes("WAIT_NATIVE_EDITOR_CLOSE"));
    assert(source.includes("Real Android publish UI, native picker and one elevated APK build"));
    return require("./lib/candidate-1924-renpy-android-fixture.cjs").selfTest();
  });
  test("Unspecified fixture retains the signed old-game upgrade workflow", () => {
    const source = build("business", c).source;
    assert(source.includes('const { retainedAndroidFixture } = require("./lib/android-game-upgrade-fixture.cjs")'));
    assert(source.includes('upgrade ? "QA_ANDROID_UPGRADE_NEW_2"'));
    assert(!source.includes("exportedAssetProofs"));
  });
  test("Unknown selectors and changed source are refused before any native launch", () => {
    for (const kind of ["", "renpy", "D:/arbitrary", "renpy-official;run"])
      assert.throws(() => validateConfig({ ...c, fixtureKind: kind }));
    for (const kind of ["business", "launcher"]) {
      const before = build(kind, { ...c, fixtureKind: "renpy-official" }).changes[0].before;
      const file = kind === "business" ? "installed-android-package-current.cjs" : "android-current-physical-host.ps1";
      const sample = fs.readFileSync(require("node:path").join(__dirname, file), "utf8");
      assert.throws(() => build(kind, { ...c, fixtureKind: "renpy-official" }, sample.replace(before, "DRIFT")));
    }
    return { rejectedSelectors: 4, rejectedSourceChanges: 2 };
  });
  test("Generated launcher binds the selected fixture for administrator provenance", () => {
    const source = build("launcher", { ...c, fixtureKind: "renpy-official" }).source;
    assert(source.includes("scripts\\lib\\candidate-1924-renpy-android-fixture.cjs"));
    require("./android-candidate-device.cjs").validateStartSyntax(source);
  });
  r.status = "PASS";
} catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
r.finishedAt = new Date().toISOString();
fs.writeFileSync(reportFile, JSON.stringify(r, null, 2), { flag: "wx" });
console.log(JSON.stringify(r, null, 2));
