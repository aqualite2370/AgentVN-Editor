"use strict";
// Review the one new Android capability without repeating old device matrices.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validate } = require("./lib/android-custom-quick-bar-flow.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Renpy-Quick-Placement-Android-1981-20261116-01";
const deviceName = "device-03";
const mode = process.argv[2]; assert(["--audit", "--stage-cleanup"].includes(mode)); assert.equal(process.argv.length, 3);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
const verify = file => assert.equal(sha(file.path), file.sha256, file.path);
function once(text, before, after) { assert.equal(text.split(before).length, 2, before); return text.replace(before, after); }
function between(text, first, last, value) { const a = text.indexOf(first), b = text.indexOf(last, a);
  assert(a >= 0 && b > a, first); return text.slice(0, a) + value + text.slice(b); }
if (mode === "--stage-cleanup") {
  const destination = path.join(base, "qa-scripts/cleanup.ps1"), output = path.join(base, "cleanup-preparation.json");
  assert(!fs.existsSync(destination) && !fs.existsSync(output));
  const device = read(path.join(base, deviceName, "report.json")), launch = read(path.join(base, deviceName, "launcher.json"));
  assert(device.finishedAt && launch.finishedAt); assert.equal(device.cleanup, "PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP");
  assert.deepEqual(device.cleanupErrors, []);
  const original = path.join(root, "scripts/sprite-embedded-android-cleanup.ps1");
  let text = fs.readFileSync(original, "utf8");
  text = once(text, "$base='F:\\testavn\\Sprite-Embedded-Android-1975-20261116-01'", "$base='" + base.replaceAll("/", "\\") + "'");
  text = once(text, "$deviceName=if($RenpyFollowup){'device-02'}else{'device-01'}", "$deviceName='device-03'");
  text = between(text, "  if($RenpyFollowup){\n    $original=", "  if($build.status", "");
  text = once(text, "PASS_TWO_INSTALLED_RESOURCE_APK_BUILDS_DEVICE_PENDING", "PASS_ONE1981_INSTALLED_RESOURCE_APK_BUILD_DEVICE_PENDING");
  text = once(text, "PASS_TWO_EMBEDDED_UI_AUTHOR_CARTRIDGES_FOUR_ABIS_SPRITE_PIXELS_DEVICE_PENDING", "PASS1981_ONE_NATIVE032_APK_REAL_AUTHOR_LAYOUT_FOUR_ABIS_DEVICE_PENDING");
  text = once(text, "  if($RenpyFollowup){$evidence+=@('device-01\\report.json','device-01\\launcher.json','device-01\\cleanup.json')}\n",
    "  $evidence+=@('device-01\\report.json','device-01\\launcher.json','device-01\\cleanup.json','device-02\\report.json','device-02\\launcher.json','device-02\\cleanup.json','device-audit-01.json','current-log-review-01.json')\n");
  fs.writeFileSync(destination, text, { flag: "wx" });
  cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", `$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile('${destination}',[ref]$t,[ref]$e);if($e.Count){throw($e|Out-String)}`], { windowsHide: true });
  fs.writeFileSync(output, JSON.stringify({ status: "SEALED_EXACT_CLEANUP_NOT_EXECUTED", at: new Date().toISOString(),
    source: desc(original), generated: desc(destination), scope: base, oldRejectedProfilesTouched: false }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "SEALED_EXACT_CLEANUP_NOT_EXECUTED", destination }));
} else {
  const output = path.join(base, "device-audit-01.json"); assert(!fs.existsSync(output));
  const r = { status: "RUNNING", at: new Date().toISOString(), inputs: [], checks: [], deviceInputs: 0, models: 0 };
  const input = file => { r.inputs.push(desc(file)); return read(file); };
  const check = (name, action) => { const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.detail = action(); row.status = "PASS"; } catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; } };
  try {
    const prep = input(path.join(base, "preparation.json")), build = input(path.join(base, "administrator.json"));
    const packages = input(path.join(base, "package-audit-01.json")), device = input(path.join(base, deviceName, "report.json"));
    const launch = input(path.join(base, deviceName, "launcher.json")), cleanup = input(path.join(base, deviceName, "cleanup.json"));
    check("frozen1981 installed-UI export and native032 APK", () => {
      verify(prep.installer); verify(prep.builds[0].cartridge);
      assert.equal(build.status, "PASS_ONE1981_INSTALLED_RESOURCE_APK_BUILD_DEVICE_PENDING"); assert(build.isElevated && build.persistentEnvironmentUnchanged);
      assert.equal(packages.status, "PASS1981_ONE_NATIVE032_APK_REAL_AUTHOR_LAYOUT_FOUR_ABIS_DEVICE_PENDING");
      assert.equal(packages.cases.length, 1); verify(packages.cases[0].apk); assert.equal(packages.cases[0].native.length, 4);
      return { apk: packages.cases[0].apk, sourceFiles: prep.sources.length, editorBuilds: 0 };
    });
    check("actual ADB custom position six combinations and readable NVL", () => {
      assert.equal(device.status, "PASS1981_NATIVE_CUSTOM_BAR_SIX_PROPORTIONS_ROTATION_NVL_RESTART_LOGS_RETAINED");
      assert.equal(device.cases.length, 1); const row = device.cases[0]; assert.equal(row.status, "PASS");
      assert.equal(row.formalLaunch.method, "NORMAL_ANDROID_LAUNCHER_EMBEDDED_GAME");
      assert.equal(row.displayCases.length, 0, "Do not repeat the six completed display cases");
      verify(device.inheritedDisplayCases); assert.equal(device.inheritedDisplayCases.originalTotalStatus, "FAILED");
      const original = input(device.inheritedDisplayCases.path); assert.equal(original.status, "FAILED");
      assert(original.error.includes("2400 !== 1920")); assert.equal(device.inheritedDisplayCases.cases.length, 3);
      const remainder = device.inheritedRemainingDisplayCases; verify(remainder);
      const second = input(remainder.path); assert.equal(second.status, "FAILED");
      assert(second.error.includes("android-custom-quick-bar-flow.cjs:92"));
      assert.equal(remainder.cases.length, 3); assert.deepEqual(remainder.cases, second.cases[0].displayCases);
      assert.deepEqual(device.inheritedDisplayCases.cases, original.cases[0].displayCases.filter(c => c.status === "PASS"));
      assert(remainder.historyReturnAndHiddenTouchRestore && second.cases[0].historyReturnAndHiddenTouchRestore);
      const complete = [...device.inheritedDisplayCases.cases, ...remainder.cases];
      for (const item of complete) { assert.equal(item.status, "PASS"); validate(item.geometry, item.ratio); }
      assert.equal(new Set(complete.map(c => c.size + "/" + c.ratio)).size, 6);
      assert(row.rotationStatePreserved && row.playerRatioPersistedAcrossProcess);
      assert.equal(row.rotationSamples.length, 2); validate(row.restartGeometry, "4:3"); validate(row.nvl, "4:3");
      assert.notEqual(row.rotationSamples[0].screen.angle, row.rotationSamples[1].screen.angle);
      for (const sample of row.rotationSamples) { assert.equal(sample.screen.angle, sample.degrees); validate(sample.geometry, "4:3"); }
      assert(row.nvl.nvl.height > 12 && row.nvl.bar.bottom < row.nvl.nvl.top);
      return { cases: 6, inheritedFromFailedFirstBoot: 3, inheritedFromFailedSecondBoot: 3, repeatedDisplayCases: 0,
        realAdbTapsThisBoot: device.commands.filter(c => c.args[0] === "shell" && c.args[1] === "input" && c.args[2] === "tap").length,
        physicalPhone: false, fullPriorMatrixRepeated: false };
    });
    check("actual screenshot dimensions and full raw logs retained", () => {
      assert(device.screenshots.length >= 3);
      for (const image of device.screenshots) { verify(image); verify(image.hierarchy);
        const bytes = fs.readFileSync(image.path); assert.equal(bytes.readUInt32BE(16), Math.round(image.viewport.width * image.viewport.dpr));
        assert.equal(bytes.readUInt32BE(20), Math.round(image.viewport.height * image.viewport.dpr)); }
      const row = device.cases[0]; verify(row.logcat); assert.equal(row.logReview.fatal.length, 0);
      return { screenshots: device.screenshots.length, log: row.logcat, noFatalCapturedIsNotAllLogsExempt: true };
    });
    check("unique emulator package staging ports and temp retired", () => {
      assert(launch.finishedAt && device.finishedAt); assert.equal(device.cleanup, "PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP");
      assert.deepEqual(device.cleanupErrors, []); assert.equal(cleanup.status, "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
      assert(cleanup.targets.every(t => t.removed && !fs.existsSync(t.path)));
      assert(device.packageCleanup.every(p => p.absent)); assert(!fs.existsSync(path.join(base, deviceName, "staging.apk")));
      assert.equal(listeners(device.ports).length, 0);
      const process = rows().find(p => p.ProcessId === device.emulator.pid);
      assert(!process || new Date(process.Created) > new Date(device.finishedAt));
      return { bootId: device.bootId, packageRetired: true, physicalBytesClaim: false };
    });
    check("daily real checkout and source constraints protected", () => {
      verify(prep.protected.dailyDev); verify(prep.protected.index);
      assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(), prep.protected.head);
      const sealed = input(path.join(base, deviceName, "preparation.json")); for (const file of sealed.inputs) verify(file); for (const file of sealed.copies) verify(file);
      assert.equal(sealed.git.head, prep.protected.head); verify({ path: sealed.git.index, sha256: sealed.git.sha256 });
      // The inherited launcher derives cwd from inputs[0]. The supplemental
      // runner's first input is the previous report, not a repository script.
      // Preserve that FAILED receipt and independently verify the real repo.
      assert.equal(launch.exitCode, 0); assert.equal(launch.status, "FAILED");
      assert.equal(launch.error, "System.Management.Automation.RuntimeException: HEAD changed");
      const inferred = path.dirname(path.dirname(sealed.inputs[0].path)); assert.notEqual(path.resolve(inferred), root);
      const wrongRoot = cp.spawnSync("git", ["rev-parse", "HEAD"], { cwd: inferred, encoding: "utf8", windowsHide: true });
      assert.notEqual(wrongRoot.status, 0);
      return { oldRejectedProfilesTouched: false, userDatabaseWrites: device.userDatabaseWrites, modelRequests: device.modelRequests,
        launcherFailedPreserved: true, launcherFailure: "QA inferred repository from report path; actual HEAD/index independently unchanged" };
    });
    r.status = "PASS1981_ANDROID_CUSTOM_BAR_NATIVE_INCREMENT_NOT_PHYSICAL_PHONE_OR_WHOLE_GOAL";
  } catch (error) { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; }
  finally { r.finishedAt = new Date().toISOString(); fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, checks: r.checks.length, error: r.error, output })); }
}
