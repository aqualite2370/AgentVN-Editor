"use strict";
// Seal a narrowly adapted existing device runner. The normal fixed launch
// parameter loads the unmodified author download through native ZIP validation.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, "..");
const stageAttempt = process.argv[2] || "01";
assert(["01", "02", "03"].includes(stageAttempt));
const out = "F:/testavn/Android-Sprite-Author-Cartridge-1975-20261116-" + stageAttempt;
const author = "F:/testavn/Sprite-Author-Export-1975-20261116-03";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
assert(!fs.existsSync(out), "Do not replace device evidence");
const authored = read(path.join(author, "report.json"));
assert.equal(authored.status, "PASS_SOURCE_AUTHOR_UI_PERSISTENCE_AND_TWO_NORMAL_CARTRIDGES");
assert.equal(read(path.join(author, "formal-player/report.json")).status,
  "PASS_TWO_UNCHANGED_UI_EXPORTS_FORMAL_FIXED_PLAYER_GEOMETRY");
for (const item of authored.exports) assert.equal(sha(item.path), item.sha256);
const names = ["sprite-count-android-preview.cjs", "sprite-count-android-preview-launch.ps1",
  "lib/sprite-preview-fixture.cjs", "lib/file-sha256-bounded.cjs", "lib/android-startup-observer.cjs",
  "lib/android-startup-host-identity.cjs", "lib/installed-acceptance.cjs", "android-runtime-log-analysis.cjs"];
const inputs = names.map(relative => {
  const file = path.join(root, "scripts", relative);
  return { relative, path: file, sha256: sha(file) };
});
inputs.push(...[path.join(author, "report.json"), path.join(author, "formal-player/report.json"),
  ...authored.exports.map(item => item.path)].map(file => ({ path: file, sha256: sha(file) })));
const scripts = path.join(out, "harness/scripts"); fs.mkdirSync(path.join(scripts, "lib"), { recursive: true });
const copies = [];
function once(source, before, after) {
  assert.equal(source.split(before).length, 2, "Expected exactly one adaptation anchor: " + before.slice(0, 65));
  return source.replace(before, after);
}
function between(source, start, end, replacement) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from); return source.slice(0, from) + replacement + source.slice(to);
}
for (const name of names) {
  let source = fs.readFileSync(path.join(root, "scripts", name), "utf8");
  if (name === "sprite-count-android-preview.cjs") {
    source = once(source, 'const out = "F:/testavn/Android-Sprite-Preview-1975-20261116-" + attempt;',
      "const out = " + JSON.stringify(out) + ";");
    source = once(source, 'const installedReport = "F:/testavn/Windows-Isolated-1975-20261116-01/resource-01/report.json";',
      "const installedReport = " + JSON.stringify(path.join(author, "report.json")) + ";");
    source = once(source, 'const { createSpritePreview } = require("./lib/sprite-preview-fixture.cjs");', "");
    source = once(source, '"UNCHANGED_1975_APK_NATIVE_WEBVIEW_CONTROLLED_V2_PREVIEW_RASTER_GEOMETRY"',
      '"UNCHANGED_1975_APK_FORMAL_QUERY_CARTRIDGE_NATIVE_LOAD_REAL_UI_EXPORT"');
    source = once(source, '"Controlled preview initialization, not author UI export or fixed-game sprite loading"',
      '"Source Editor real UI export; formal fixed-query native load, not newly embedded APK contents"');
    source = between(source, '  const fixture = createSpritePreview(', '  row.package =', `  row.fixture = {
    sourceUiExport: desc(exported.path), entryScene: script.entry_scene_id,
    scope: "UNCHANGED_SOURCE_EDITOR_UI_EXPORT_NATIVE_FORMAL_FIXED_CARTRIDGE"
  };
`);
    source = between(source, "  await page.evaluate(message => {", "  const selectors =", `  // Existing public launch parameter, not postMessage, a store mutation or IPC mock.
  const privateFile = "/sdcard/Android/data/" + currentPackage + "/files/qa-author.vncart";
  try {
    cmd(["shell", "mkdir", "-p", "/sdcard/Android/data/" + currentPackage + "/files"]);
    cmd(["push", exported.path, privateFile]);
    const actual = text(["shell", "sha256sum", privateFile]).split(/\\s+/)[0];
    assert.equal(actual, exported.sha256);
    row.cartridgeDeviceFile = { path: privateFile, sha256: actual, transferredBytes: exported.bytes,
      storage: "THIS_QA_PACKAGE_EXTERNAL_FILES_NO_RUN_AS_OR_ROOT" };
  } finally { assert.equal(sha(exported.path), exported.sha256); }
  const launchUrl = new URL(page.url());
  launchUrl.search = ""; launchUrl.searchParams.set("cartridge", privateFile);
  row.formalLaunch = { url: launchUrl.href, method: "EXISTING_FIXED_LAUNCH_QUERY_NATIVE_CARTRIDGE" }; save();
  await page.goto(launchUrl.href, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByTestId("start-new-game").click();
`);
    source = once(source, '"PASS_TWO_THEME_ANDROID_PREVIEW_SPRITE_GEOMETRY_LOGS_RETAINED"',
      '"PASS_TWO_THEME_ANDROID_FORMAL_AUTHOR_CARTRIDGE_GEOMETRY_LOGS_RETAINED"');
    assert(!source.includes("window.postMessage") && !source.includes("createSpritePreview("));
    const begin = source.indexOf("    const actual = text(");
    const finish = source.indexOf("\n  } finally", begin);
    assert(begin > 0 && finish > begin);
    const sandbox = { assert, text: () => "abcdef  /sdcard/Android/data/qa/files/qa-author.vncart",
      currentPackage: "qa", privateFile: "/sdcard/Android/data/qa/files/qa-author.vncart",
      exported: { sha256: "abcdef", bytes: 100 }, row: {} };
    require("node:vm").runInNewContext(source.slice(begin, finish), sandbox);
    assert.equal(sandbox.row.cartridgeDeviceFile.sha256, "abcdef", "Generated native SHA parser must work before launching");
    // Adaptation is fixed at attempt01; no old case inheritance can execute.
    source = once(source, 'assert(["01", "02", "03"].includes(attempt));', 'assert.equal(attempt, "01");');
  } else if (name.endsWith(".ps1")) {
    source = once(source, "$run='F:\\testavn\\Android-Sprite-Preview-1975-20261116-01'",
      "$run='" + out.replaceAll("/", "\\") + "'");
    source = once(source, "'FINISHED_TARGETED_PREVIEW_AND_CLEANUP_CHECK_REPORT'",
      "'FINISHED_FORMAL_AUTHOR_CARTRIDGE_AND_CLEANUP_CHECK_REPORT'");
  }
  source = source.replace(/require\(["'](?:\.\.\/){1,2}editor\/node_modules\/([^"']+)["']\)/g,
    (_, module) => "require(" + JSON.stringify(path.join(root, "editor/node_modules", module)) + ")");
  const file = path.join(scripts, name); fs.writeFileSync(file, source, { flag: "wx" });
  if (file.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", file], { windowsHide: true });
  else cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e);if($e.Count){throw($e|Out-String)}`],
    { windowsHide: true });
  copies.push({ path: file, sha256: sha(file) });
}
const git = args => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
const index = path.resolve(git(["rev-parse", "--git-path", "index"]));
const preparation = { status: "SEALED_FORMAL_AUTHOR_CARTRIDGE_DEVICE_NOT_STARTED", attempt: "01",
  at: new Date().toISOString(), inputs, copies,
  git: { head: git(["rev-parse", "HEAD"]), index, sha256: sha(index) },
  productBuilds: 0, modelRequests: 0,
  limitations: ["Existing fixed launch query with actual native cartridge loading, not newly embedded APK packaging",
    "Source Editor UI-authored exports, not a repeated installed Editor authoring group"] };
fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify(preparation, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: preparation.status, scripts, inputs: inputs.length, files: copies.length }));
