"use strict";
// Freeze a focused device harness; never modify a runner after it is started.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Renpy-Quick-Placement-Android-1981-20261116-01";
const remaining = process.argv[2] === "--remaining";
assert(process.argv.length === (remaining ? 3 : 2));
const attempt = remaining ? "02" : "01", out = path.join(base, "device-" + attempt);
const report = "F:/testavn/Windows-Isolated-1981-20261116-04/resource-01/report.json";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
assert(!fs.existsSync(out), "Preserve old evidence");
assert.equal(read(path.join(base, "package-audit-01.json")).status, "PASS1981_ONE_NATIVE032_APK_REAL_AUTHOR_LAYOUT_FOUR_ABIS_DEVICE_PENDING");
const names = ["sprite-count-android-preview.cjs", "sprite-count-android-preview-launch.ps1", "lib/file-sha256-bounded.cjs",
  "lib/android-startup-observer.cjs", "lib/android-startup-host-identity.cjs", "lib/installed-acceptance.cjs",
  "android-runtime-log-analysis.cjs", "lib/android-custom-quick-bar-flow.cjs"];
const inputs = names.map(name => ({ path: path.join(root, "scripts", name), sha256: sha(path.join(root, "scripts", name)) }));
for (const file of [path.join(base, "package-audit-01.json"), report]) inputs.push({ path: file, sha256: sha(file) });
if (remaining) {
  const first = path.join(base, "device-01/report.json"), original = read(first);
  assert.equal(original.status, "FAILED"); assert(original.error.includes("2400 !== 1920"));
  assert.equal(original.cleanup, "PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP"); assert.deepEqual(original.cleanupErrors, []);
  assert.equal(read(path.join(base, "device-01/cleanup.json")).status, "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
  assert.equal(original.cases[0].displayCases.filter(c => c.status === "PASS").length, 3);
  inputs.push({ path: first, sha256: sha(first) });
}
const scripts = path.join(out, "harness/scripts"); fs.mkdirSync(path.join(scripts, "lib"), { recursive: true });
function once(text, before, after) { assert.equal(text.split(before).length, 2, before); return text.replace(before, after); }
function between(text, first, last, value) { const a = text.indexOf(first), b = text.indexOf(last, a);
  assert(a >= 0 && b > a, first); return text.slice(0, a) + value + text.slice(b); }
const copies = [];
for (const name of names) {
  let source = fs.readFileSync(path.join(root, "scripts", name), "utf8");
  if (name === "sprite-count-android-preview.cjs") {
    source = once(source, 'const { createSpritePreview } = require("./lib/sprite-preview-fixture.cjs");',
      'const { exercise, measure, validate } = require("./lib/android-custom-quick-bar-flow.cjs");');
    source = once(source, 'assert(["01", "02", "03"].includes(attempt));', 'assert.equal(attempt, ' + JSON.stringify(attempt) + ');');
    source = once(source, 'const out = "F:/testavn/Android-Sprite-Preview-1975-20261116-" + attempt;', "const out = " + JSON.stringify(out) + ";");
    source = once(source, 'const build = "F:/testavn/Client-Presentation-Android-1975-20261116-04";', "const build = " + JSON.stringify(base) + ";");
    source = once(source, 'const installedReport = "F:/testavn/Windows-Isolated-1975-20261116-01/resource-01/report.json";', "const installedReport = " + JSON.stringify(report) + ";");
    source = once(source, 'const ports = [5582, 5583, adbPort, cdpPort, grpcPort], avd = "Sprite1975_20261116_01";',
      'const ports = [5582, 5583, adbPort, cdpPort, grpcPort], avd = "Quick1981_20261116_01";');
    source = once(source, '"PASS_TWO_FOUR_ABI_APKS_LAYOUTS_SOURCES_AND_EXACT_LINKS_DEVICE_PENDING"',
      '"PASS1981_ONE_NATIVE032_APK_REAL_AUTHOR_LAYOUT_FOUR_ABIS_DEVICE_PENDING"');
    source = once(source, '"UNCHANGED_1975_APK_NATIVE_WEBVIEW_CONTROLLED_V2_PREVIEW_RASTER_GEOMETRY"',
      '"1981_INSTALLED_UI_EXPORT_NORMAL_EMBEDDED_ANDROID_CUSTOM_POSITION_ACTUAL_ADB"');
    source = once(source, '"Controlled preview initialization, not author UI export or fixed-game sprite loading"',
      '"Actual installed Editor UI export embedded normally; no preview injection, no physical phone claim"');
    source = between(source, 'if (attempt === "02" || attempt === "03") {', "const save =", "const save =");
    // The adaptation boundary includes the marker; avoid duplicating it.
    source = source.replace("const save =const save =", "const save =");
    if (remaining) source = once(source, "const save =", `
const inheritedFile = ${JSON.stringify(path.join(base, "device-01/report.json"))};
const inherited = read(inheritedFile);
assert.equal(inherited.status, "FAILED"); assert(inherited.error.includes("2400 !== 1920"));
r.inheritedDisplayCases = { ...desc(inheritedFile), originalTotalStatus: inherited.status,
  cases: inherited.cases[0].displayCases.filter(c => c.status === "PASS"),
  scope: "THREE_1920_DISPLAY_CASES_ONLY_DIFFERENT_BOOT_REMAINDER_NOT_RERUN" };
assert.equal(r.inheritedDisplayCases.cases.length, 3);
const save =`);
    source = source.replaceAll("sprite1975-qa.xml", "quick1981-qa.xml");
    const start = source.indexOf("async function tapDialog() {"), end = source.indexOf("\nasync function geometry(", start);
    assert(start >= 0 && end > start);
    let tap = source.slice(start, end);
    tap = once(tap, "async function tapDialog() {", "async function tap(locator) {");
    tap = once(tap, 'page.locator(".dialog-box").evaluate(', "locator.evaluate(");
    tap = once(tap, 'text(["shell", "wm", "size"]).match(/(?:Physical|Override) size: (\\d+)x(\\d+)/)',
      'Array.from(text(["shell", "wm", "size"]).matchAll(/(?:Physical|Override) size: (\\d+)x(\\d+)/g)).at(-1)');
    source = source.slice(0, start) + tap + source.slice(end);
    source = between(source, "async function check(type) {", "async function main() {", `async function check(type) {
  assert.equal(type, "renpy");
  const artifact = audit.cases.find(row => row.type === type);
  assert.equal(sha(artifact.apk.path), artifact.apk.sha256);
  const row = { type, apk: artifact.apk, package: "com.agentvn.qa.quick1981.renpy", status: "RUNNING" };
  r.cases.push(row); save();
  assert(!text(["shell", "pm", "list", "packages", row.package]).includes(row.package));
  const staged = path.join(out, "staging.apk"); fs.copyFileSync(artifact.apk.path, staged, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(staged), artifact.apk.sha256); currentPackage = row.package;
  cmd(["install", staged], { timeout: 90000 }); fs.unlinkSync(staged); cmd(["logcat", "-c"]);
  async function launch(label) {
    cmd(["shell", "monkey", "-p", currentPackage, "-c", "android.intent.category.LAUNCHER", "1"]);
    const pid = await until(() => cmd(["shell", "pidof", currentPackage], { optional: true }).stdout.trim(), "host PID");
    row[label + "Pid"] = pid; let recoveredRead = false;
    const expectedHost = { boot: r.bootId, pid };
    const session = await observeStartup({
      identity: () => readStartupHostIdentity({ expected: expectedHost,
        samplePid: () => { const v = cmd(["shell", "pidof", currentPackage], { optional: true });
          return { status: v.status, stdout: v.stdout, stderr: v.stderr }; },
        readBoot: () => text(["shell", "cat", "/proc/sys/kernel/random/boot_id"]),
        allowRecovery: () => { if (recoveredRead) return false; recoveredRead = true; return true; },
        pause: () => delay(150), record: o => { r.startupObservations.push({ label, ...o }); save(); } }),
      connect, ready: p => p.waitForFunction(() => {
        const e = document.querySelector("[data-runtime-screen-transition]");
        return e?.getAttribute("data-runtime-presented-screen") === "title_menu"
          && e.getAttribute("data-runtime-screen-transition") === "idle" && !document.querySelector(".boot-overlay");
      }), record: o => { r.startupObservations.push({ label, ...o }); save(); } });
    browser = session.browser; page = session.page;
    page.on("pageerror", error => { r.errors.push({ label, error: String(error) }); save(); });
    await surface(); return pid;
  }
  row.pid = await launch("first");
  assert(!new URL(page.url()).searchParams.has("cartridge"));
  row.formalLaunch = { url: page.url(), method: "NORMAL_ANDROID_LAUNCHER_EMBEDDED_GAME" }; save();
  await exercise({ page, tap, cmd, text, capture, settle: settleRuntime, save, report: r, row });
  cmd(["shell", "am", "force-stop", currentPackage]); await disconnect();
  const restartPid = await launch("restart");
  assert.notEqual(restartPid, row.pid); await tap(page.getByTestId("start-new-game")); await settleRuntime(page);
  await page.locator(".dialog-box").waitFor();
  row.restartGeometry = await page.evaluate(measure); validate(row.restartGeometry, "4:3");
  row.playerRatioPersistedAcrossProcess = true; await capture("renpy-custom-restart");
  const file = path.join(out, "renpy-logcat.txt"), log = text(["logcat", "-d", "-v", "threadtime"]);
  fs.writeFileSync(file, log, { flag: "wx" }); row.logcat = desc(file);
  row.logReview = scopedRuntimeLog(log, currentPackage, [row.pid, restartPid]); assert.equal(row.logReview.fatal.length, 0);
  cmd(["shell", "am", "force-stop", currentPackage]); await disconnect(); cmd(["uninstall", currentPackage]);
  assert(!text(["shell", "pm", "list", "packages", currentPackage]).includes(currentPackage));
  currentPackage = undefined; row.status = "PASS"; row.cleanup = "PACKAGE_AND_FORWARD_RETIRED"; save();
}
`);
    source = once(source, 'for (const type of attempt === "03" ? ["renpy"] : ["agentvn", "renpy"]) await check(type);', 'for (const type of ["renpy"]) await check(type);');
    source = once(source, 'assert.equal(r.cases.length, attempt === "03" ? 1 : 2);', 'assert.equal(r.cases.length, 1);');
    source = once(source, '"PASS_TWO_THEME_ANDROID_PREVIEW_SPRITE_GEOMETRY_LOGS_RETAINED"', '"PASS1981_NATIVE_CUSTOM_BAR_SIX_PROPORTIONS_ROTATION_NVL_RESTART_LOGS_RETAINED"');
    source = once(source, 'for (const type of ["agentvn", "renpy"]) {', 'for (const type of ["renpy"]) {');
    source = source.replaceAll("com.agentvn.qa.client1975.", "com.agentvn.qa.quick1981.");
    assert(!source.includes("window.postMessage") && !source.includes("createSpritePreview("));
  } else if (name.endsWith(".ps1")) {
    source = once(source, "$run='F:\\testavn\\Android-Sprite-Preview-1975-20261116-01'", "$run='" + out.replaceAll("/", "\\") + "'");
    source = once(source, "FINISHED_TARGETED_PREVIEW_AND_CLEANUP_CHECK_REPORT", "FINISHED1981_NATIVE_CUSTOM_BAR_AND_CLEANUP_CHECK_REPORT");
  }
  source = source.replace(/require\(["'](?:\.\.\/){1,2}editor\/node_modules\/([^"']+)["']\)/g,
    (_, module) => "require(" + JSON.stringify(path.join(root, "editor/node_modules", module)) + ")");
  const target = path.join(scripts, name); fs.writeFileSync(target, source, { flag: "wx" });
  if (name.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", target], { windowsHide: true });
  else cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", `$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile('${target}',[ref]$t,[ref]$e);if($e.Count){throw($e|Out-String)}`], { windowsHide: true, timeout: 15000 });
  copies.push({ path: target, sha256: sha(target) });
}
cp.execFileSync(process.execPath, [path.join(scripts, "lib/android-custom-quick-bar-flow.cjs")], { windowsHide: true, stdio: "inherit" });
const git = args => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
const index = path.resolve(root, git(["rev-parse", "--git-path", "index"]));
fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify({ status: "SEALED1981_NATIVE_CUSTOM_BAR_DEVICE_NOT_STARTED",
  attempt, at: new Date().toISOString(), inputs, copies, git: { head: git(["rev-parse", "HEAD"]), index, sha256: sha(index) },
  editorBuilds: 0, models: 0, physicalPhoneClaim: false }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "SEALED_DEVICE_NOT_STARTED", scripts, files: copies.length }));
