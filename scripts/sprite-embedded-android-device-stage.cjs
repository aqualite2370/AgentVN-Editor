"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Sprite-Embedded-Android-1975-20261116-01";
const followup = process.argv.includes("--renpy-followup");
assert(process.argv.length <= 3 && process.argv.slice(2).every(arg => arg === "--renpy-followup"));
const attempt = followup ? "02" : "01";
const out = path.join(base, "device-" + attempt), author = "F:/testavn/Sprite-Author-Export-1975-20261116-03";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
assert.equal(read(path.join(base, "package-audit-01.json")).status,
  "PASS_TWO_EMBEDDED_UI_AUTHOR_CARTRIDGES_FOUR_ABIS_SPRITE_PIXELS_DEVICE_PENDING");
assert(!fs.existsSync(out), "Preserve previous device evidence");
const names = ["sprite-count-android-preview.cjs", "sprite-count-android-preview-launch.ps1",
  "lib/file-sha256-bounded.cjs", "lib/android-startup-observer.cjs", "lib/android-startup-host-identity.cjs",
  "lib/installed-acceptance.cjs", "android-runtime-log-analysis.cjs"];
const inputs = names.map(relative => ({ relative, path: path.join(root, "scripts", relative),
  sha256: sha(path.join(root, "scripts", relative)) }));
inputs.push(...[path.join(base, "package-audit-01.json"), path.join(author, "report.json")]
  .map(file => ({ path: file, sha256: sha(file) })));
let original;
if (followup) {
  const file = path.join(base, "device-01/report.json");
  original = read(file);
  assert.equal(original.status, "FAILED");
  assert(original.error.includes("Retained sprite changed size between counts"));
  assert.equal(original.cleanup, "PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP");
  assert.deepEqual(original.cleanupErrors, []);
  assert.equal(read(path.join(base, "device-01/cleanup.json")).status,
    "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
  const complete = original.cases.find(row => row.type === "agentvn");
  assert.equal(complete.status, "PASS");
  assert(complete.exit.geometryStable && complete.authorScale);
  const renpy = original.cases.find(row => row.type === "renpy");
  const baseline = renpy.sizes[0].rect;
  assert.deepEqual(renpy.sizes.map(size => size.count), [1, 2, 5, 1]);
  const main = renpy.frames.filter(frame => frame.id === "c0");
  const firstRaster = main.find(frame => frame.rect.width > 0 && frame.rect.height > 0);
  const mismatches = main.filter(frame => Math.abs(frame.rect.width - baseline.width) >= .5
    || Math.abs(frame.rect.height - baseline.height) >= .5);
  assert(mismatches.length && mismatches.every(frame => frame.rect.width === 0
    && frame.rect.height === 0 && frame.at < firstRaster.at));
  assert(main.filter(frame => frame.at >= firstRaster.at).every(frame =>
    Math.abs(frame.rect.width - baseline.width) < .5
    && Math.abs(frame.rect.height - baseline.height) < .5));
  inputs.push({ path: file, sha256: sha(file) },
    ...["launcher.json", "cleanup.json"].map(name => ({
      path: path.join(base, "device-01", name), sha256: sha(path.join(base, "device-01", name)),
    })));
}
const scripts = path.join(out, "harness/scripts");
fs.mkdirSync(path.join(scripts, "lib"), { recursive: true });
function once(source, before, after) {
  assert.equal(source.split(before).length, 2, "Unique adaptation anchor: " + before.slice(0, 75));
  return source.replace(before, after);
}
function between(source, start, end, replacement) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, "Adaptation region");
  return source.slice(0, from) + replacement + source.slice(to);
}
const copies = [];
for (const name of names) {
  let text = fs.readFileSync(path.join(root, "scripts", name), "utf8");
  if (name === "sprite-count-android-preview.cjs") {
    text = once(text, 'const out = "F:/testavn/Android-Sprite-Preview-1975-20261116-" + attempt;',
      "const out = " + JSON.stringify(out) + ";");
    text = once(text, 'const build = "F:/testavn/Client-Presentation-Android-1975-20261116-04";',
      "const build = " + JSON.stringify(base) + ";");
    text = once(text, 'const installedReport = "F:/testavn/Windows-Isolated-1975-20261116-01/resource-01/report.json";',
      "const installedReport = " + JSON.stringify(path.join(author, "report.json")) + ";");
    text = once(text, 'const { createSpritePreview } = require("./lib/sprite-preview-fixture.cjs");', "");
    text = once(text, '"PASS_TWO_FOUR_ABI_APKS_LAYOUTS_SOURCES_AND_EXACT_LINKS_DEVICE_PENDING"',
      '"PASS_TWO_EMBEDDED_UI_AUTHOR_CARTRIDGES_FOUR_ABIS_SPRITE_PIXELS_DEVICE_PENDING"');
    text = once(text, '"UNCHANGED_1975_APK_NATIVE_WEBVIEW_CONTROLLED_V2_PREVIEW_RASTER_GEOMETRY"',
      '"NORMAL_EMBEDDED_APK_NATIVE_GAME_FROM_REAL_SOURCE_EDITOR_UI_EXPORTS"');
    text = once(text, '"Controlled preview initialization, not author UI export or fixed-game sprite loading"',
      '"Source Editor UI authoring and normal embedded APK packaging; not a new installed Editor author test"');
    if (followup) {
      text = between(text, 'if (attempt === "02" || attempt === "03") {', "const save =", `
const inheritedFile = ${JSON.stringify(path.join(base, "device-01/report.json"))};
const inherited = read(inheritedFile);
assert.equal(inherited.status, "FAILED");
assert(inherited.error.includes("Retained sprite changed size between counts"));
const defaultCase = inherited.cases.find(row => row.type === "agentvn");
assert.equal(defaultCase.status, "PASS");
const uninstall = inherited.commands.findIndex(command =>
  command.args[0] === "uninstall" && command.args[1] === defaultCase.package);
assert(uninstall > 0);
const nativeInputs = inherited.commands.slice(0, uninstall).filter(command =>
  command.args[0] === "shell" && command.args[1] === "input" && command.args[2] === "tap").length;
assert.equal(nativeInputs, 5);
r.inheritedDefaultComplete = {
  ...desc(inheritedFile), originalTotalStatus: inherited.status, case: defaultCase,
  screenshot: inherited.screenshots.find(item => item.path.endsWith("agentvn.png")),
  nativeInputs, scope: "DEFAULT_COMPLETE_EMBEDDED_GAME_ONLY_ORIGINAL_FAILED_RENPY_PRESERVED"
};
r.limitations.push("AgentVN is inherited from device01; RenPy alone runs in this new boot.");
`);
      text = once(text,
        'for (const type of attempt === "03" ? ["renpy"] : ["agentvn", "renpy"]) await check(type);',
        'for (const type of ["renpy"]) await check(type);');
      text = once(text, 'assert.equal(r.cases.length, attempt === "03" ? 1 : 2);',
        'assert.equal(r.cases.length, 1);');
    }
    text = between(text, "  const fixture = createSpritePreview(", "  row.package =", `  row.fixture = {
    sourceUiExport: desc(exported.path), entryScene: script.entry_scene_id,
    scope: "NORMAL_EMBEDDED_GAME_NO_PREVIEW_INJECTION_OR_EXTERNAL_QUERY"
  };
`);
    text = between(text, "  await page.evaluate(message => {", "  const selectors =", `  assert(!new URL(page.url()).searchParams.has("cartridge"));
  row.formalLaunch = { url: page.url(), method: "NORMAL_ANDROID_LAUNCHER_EMBEDDED_GAME" }; save();
  await tap(page.getByTestId("start-new-game"));
  // Arm count-change measurements after the first image really exists and the
  // title-to-game handoff has settled. Zero-sized frames after this remain a
  // failure; this is not a filter that hides later geometry loss.
  const readyImage = await geometry("SIZE_STAGE_1", 1);
  row.measurementReady = { marker: "SIZE_STAGE_1", ...readyImage }; save();
`);
    // Use the existing checked ADB point/hit-testing path for the title action.
    const pointStart = text.indexOf("async function tapDialog() {");
    const pointEnd = text.indexOf("\nasync function geometry(", pointStart);
    assert(pointStart > 0 && pointEnd > pointStart);
    let tap = text.slice(pointStart, pointEnd);
    tap = once(tap, "async function tapDialog() {", "async function tap(locator) {");
    tap = once(tap, 'page.locator(".dialog-box").evaluate(', "locator.evaluate(");
    text = text.slice(0, pointStart) + tap + '\nasync function tapDialog() { return tap(page.locator(".dialog-box")); }\n'
      + text.slice(pointEnd);
    text = text.replaceAll("com.agentvn.qa.client1975.", "com.agentvn.qa.sprite1975.");
    text = once(text, 'assert(["01", "02", "03"].includes(attempt));',
      "assert.equal(attempt, " + JSON.stringify(attempt) + ");");
    text = once(text, '"PASS_TWO_THEME_ANDROID_PREVIEW_SPRITE_GEOMETRY_LOGS_RETAINED"',
      '"PASS_TWO_NORMAL_EMBEDDED_AUTHOR_APKS_SPRITE_GEOMETRY_LOGS_RETAINED"');
    assert(!text.includes("window.postMessage") && !text.includes("createSpritePreview(")
      && !text.includes('searchParams.set("cartridge"'));
  } else if (name.endsWith(".ps1")) {
    text = once(text, "$run='F:\\testavn\\Android-Sprite-Preview-1975-20261116-01'",
      "$run='" + out.replaceAll("/", "\\") + "'");
    text = once(text, "'FINISHED_TARGETED_PREVIEW_AND_CLEANUP_CHECK_REPORT'",
      "'FINISHED_NORMAL_EMBEDDED_AUTHOR_APKS_AND_CLEANUP_CHECK_REPORT'");
  }
  text = text.replace(/require\(["'](?:\.\.\/){1,2}editor\/node_modules\/([^"']+)["']\)/g,
    (_, module) => "require(" + JSON.stringify(path.join(root, "editor/node_modules", module)) + ")");
  const file = path.join(scripts, name); fs.writeFileSync(file, text, { flag: "wx" });
  if (file.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", file], { windowsHide: true });
  else cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e);if($e.Count){throw($e|Out-String)}`],
    { windowsHide: true, timeout: 15000 });
  copies.push({ path: file, sha256: sha(file) });
}
const git = args => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
const index = path.resolve(root, git(["rev-parse", "--git-path", "index"]));
fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify({
  status: "SEALED_NORMAL_EMBEDDED_AUTHOR_APKS_DEVICE_NOT_STARTED", attempt, at: new Date().toISOString(),
  inputs, copies, git: { head: git(["rev-parse", "HEAD"]), index, sha256: sha(index) },
  productBuilds: 0, modelRequests: 0,
  limitations: ["Actual source Editor UI exports, frozen installed-source packaging, not a new Editor install",
    "Two new content APKs; API35 emulator only, not the reporting physical phones"],
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "SEALED_DEVICE_NOT_STARTED", scripts, files: copies.length }));
