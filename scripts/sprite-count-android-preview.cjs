"use strict";
// One missing Android rendering check on unchanged APKs. Preview initialization
// is controlled; all subsequent progression uses native ADB input.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const cp = require("node:child_process"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip"), { chromium } = require("../editor/node_modules/playwright");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { createSpritePreview } = require("./lib/sprite-preview-fixture.cjs");
const { observeStartup } = require("./lib/android-startup-observer.cjs");
const { readStartupHostIdentity } = require("./lib/android-startup-host-identity.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const attempt = process.argv[2] || "01";
assert(["01", "02", "03"].includes(attempt));
const out = "F:/testavn/Android-Sprite-Preview-1975-20261116-" + attempt;
const build = "F:/testavn/Client-Presentation-Android-1975-20261116-04";
const installedReport = "F:/testavn/Windows-Isolated-1975-20261116-01/resource-01/report.json";
const sdk = "D:/Android_dev/Sdk", adb = path.join(sdk, "platform-tools/adb.exe");
const serial = "emulator-5582", adbPort = 5990, cdpPort = 5992, grpcPort = 5994;
const ports = [5582, 5583, adbPort, cdpPort, grpcPort], avd = "Sprite1975_20261116_01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
const reportFile = path.join(out, "report.json");
assert(fs.existsSync(path.join(out, "preparation.json")) && !fs.existsSync(reportFile));
const preparation = read(path.join(out, "preparation.json"));
for (const item of preparation.inputs) assert.equal(sha(item.path), item.sha256);
const sourceBefore = desc(installedReport), auditFile = path.join(build, "package-audit-01.json");
const auditBefore = desc(auditFile), audit = read(auditFile), prior = read(installedReport);
assert.equal(audit.status, "PASS_TWO_FOUR_ABI_APKS_LAYOUTS_SOURCES_AND_EXACT_LINKS_DEVICE_PENDING");
const r = { status: "RUNNING", at: new Date().toISOString(), cases: [], commands: [], touches: [],
  screenshots: [], startupObservations: [], errors: [], ports, serial, adbPort, cdpPort,
  inputs: [sourceBefore, auditBefore], productBuilds: 0, modelRequests: 0, userDatabaseWrites: 0,
  scope: "UNCHANGED_1975_APK_NATIVE_WEBVIEW_CONTROLLED_V2_PREVIEW_RASTER_GEOMETRY",
  limitations: ["Controlled preview initialization, not author UI export or fixed-game sprite loading",
    "API35 x86_64 emulator, not physical phones", "No repeated gallery/install-upgrade/display matrix",
    "ADB force-stop is teardown, not natural exit", "New logs remain independent of prior unresolved events"] };
if (attempt === "02" || attempt === "03") {
  const file = "F:/testavn/Android-Sprite-Preview-1975-20261116-01/report.json", first = read(file);
  assert.equal(first.status, "FAILED");
  assert(first.error.includes("Real exit and entered raster frames must be captured"));
  assert.equal(first.cleanup, "PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP");
  const old = first.cases[0];
  assert.equal(old.type, "agentvn"); assert.equal(old.sizes.length, 4);
  assert.deepEqual(old.sizes.map(size => size.count), [1, 2, 5, 1]);
  assert(old.sizes.every(size => Math.abs(size.rect.width - old.sizes[0].rect.width) < .5
    && size.authorScale === "0.85" && size.naturalWidth === 900));
  assert.equal(read("F:/testavn/Android-Sprite-Preview-1975-20261116-01/cleanup.json").status,
    "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
  r.inheritedDefaultCounts = { ...desc(file), originalTotalStatus: first.status, sizes: old.sizes,
    scope: "DEFAULT_THEME_COUNT_GEOMETRY_ONLY_NOT_EXIT_AUTHOR_SCALE_OR_SECOND_THEME" };
}
if (attempt === "03") {
  const file = "F:/testavn/Android-Sprite-Preview-1975-20261116-02/report.json", second = read(file);
  assert.equal(second.status, "FAILED");
  assert(second.error.includes("read") || second.error.includes("at identity"));
  const complete = second.cases.find(row => row.type === "agentvn");
  assert.equal(complete.status, "PASS"); assert(complete.exit.geometryStable && complete.authorScale);
  assert.equal(read("F:/testavn/Android-Sprite-Preview-1975-20261116-02/cleanup.json").status,
    "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
  r.inheritedDefaultComplete = { ...desc(file), originalTotalStatus: second.status, case: complete,
    screenshot: second.screenshots.find(item => item.path.endsWith("agentvn.png")),
    scope: "DEFAULT_COMPLETE_PREVIEW_GEOMETRY_ONLY_NOT_SECOND_THEME_OR_SAME_BOOT" };
  r.limitations.push("AgentVN complete geometry is inherited from attempt02 and count geometry from attempt01; RenPy alone runs in this boot.");
}
const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, ms = 45000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(200); }
  throw Error("Timeout: " + label);
}
function cmd(args, { optional = false, binary = false, timeout = 30000 } = {}) {
  const p = cp.spawnSync(adb, ["-P", String(adbPort), "-s", serial, ...args],
    { encoding: binary ? null : "utf8", timeout, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  r.commands.push({ args, at: new Date().toISOString(), code: p.status,
    ...(!binary ? { stdout: p.stdout, stderr: p.stderr } : {}) }); save();
  if (!optional) assert.equal(p.status, 0, String(p.stderr || p.error));
  return p;
}
const text = args => cmd(args).stdout.trim();
let emulator, browser, page, currentPackage, forwarded = false, adbStarted = false;
async function disconnect() {
  await browser?.close().catch(() => {}); browser = page = undefined;
  if (forwarded) { cmd(["forward", "--remove", "tcp:" + cdpPort]); forwarded = false; }
}
function hierarchy() {
  const remote = "/sdcard/sprite1975-qa.xml";
  cmd(["shell", "rm", "-f", remote]);
  try {
    const result = cmd(["shell", "uiautomator", "dump", remote], { optional: true });
    const xml = text(["exec-out", "cat", remote]);
    assert(xml.includes("<hierarchy") && xml.includes("</hierarchy>"));
    assert(result.status === 0 || (result.status === 137 && /UI hier(?:archy|chary) dumped to:/.test(result.stdout)));
    return xml;
  } finally { cmd(["shell", "rm", "-f", remote]); }
}
async function surface() {
  let xml = hierarchy();
  if (xml.includes('resource-id="android:id/ok"') && xml.includes("Viewing full screen")) {
    const node = xml.match(/<node[^>]*resource-id="android:id\/ok"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    assert(node);
    const x = Math.round((+node[1] + +node[3]) / 2), y = Math.round((+node[2] + +node[4]) / 2);
    cmd(["shell", "input", "tap", String(x), String(y)]);
    r.touches.push({ systemOverlay: true, x, y });
    xml = hierarchy();
  }
  assert(xml.includes(currentPackage) && !xml.includes("Viewing full screen"));
  return xml;
}
async function connect() {
  const pid = text(["shell", "pidof", currentPackage]);
  assert.match(pid, /^\d+$/);
  if (!forwarded) {
    cmd(["forward", "--no-rebind", "tcp:" + cdpPort, "localabstract:webview_devtools_remote_" + pid]);
    forwarded = true;
  }
  await until(async () => {
    try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "owned WebView CDP");
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { noDefaults: true });
  const p = await until(() => b.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^https?:/.test(p.url())), "runtime document");
  p.setDefaultTimeout(45000);
  return { page: p, browser: b, disconnect: async () => { await b.close().catch(() => {}); } };
}
async function tapDialog() {
  await surface();
  const point = await page.locator(".dialog-box").evaluate(e => {
    const box = e.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    return { x, y, dpr: devicePixelRatio, width: innerWidth, height: innerHeight,
      hit: e.contains(document.elementFromPoint(x, y)) };
  });
  const size = text(["shell", "wm", "size"]).match(/(?:Physical|Override) size: (\d+)x(\d+)/);
  assert(size && point.hit && point.x > 0 && point.y > 0);
  assert.equal(Math.round(point.width * point.dpr), +size[1]);
  assert.equal(Math.round(point.height * point.dpr), +size[2]);
  const x = Math.round(point.x * point.dpr), y = Math.round(point.y * point.dpr);
  cmd(["shell", "input", "tap", String(x), String(y)]); r.touches.push({ ...point, xPhysical: x, yPhysical: y }); save();
}
async function geometry(marker, count) {
  await page.locator(".dialog-text").filter({ hasText: marker }).waitFor();
  await page.waitForFunction(count => document.querySelectorAll(".sprite-slot:not(.is-exiting)").length === count, count);
  await page.waitForFunction(() => [...document.querySelectorAll(".sprite-slot:not(.is-exiting) img")]
    .every(image => image.complete && image.naturalWidth > 0));
  await settleRuntime(page);
  return page.locator('.sprite-slot[data-character-id="c0"]:not(.is-exiting) img').evaluate(image => ({
    rect: image.getBoundingClientRect().toJSON(), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
    authorScale: image.closest("[data-sprite-scale]").dataset.spriteScale,
  }));
}
async function capture(type) {
  const xml = await surface();
  const sample = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const before = await sample(), bytes = cmd(["exec-out", "screencap", "-p"], { binary: true }).stdout;
  const after = await sample(); assert.deepEqual(after, before);
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.equal(bytes.readUInt32BE(16), Math.round(before.width * before.dpr));
  assert.equal(bytes.readUInt32BE(20), Math.round(before.height * before.dpr));
  const file = path.join(out, type + ".png"), hierarchyFile = path.join(out, type + ".xml");
  fs.writeFileSync(file, bytes, { flag: "wx" }); fs.writeFileSync(hierarchyFile, xml, { flag: "wx" });
  r.screenshots.push({ ...desc(file), viewport: before, hierarchy: desc(hierarchyFile) }); save();
}
async function check(type) {
  const artifact = audit.cases.find(row => row.type === type);
  assert.equal(sha(artifact.apk.path), artifact.apk.sha256);
  const row = { type, apk: artifact.apk, status: "RUNNING", sizes: [] }; r.cases.push(row); save();
  const exported = prior.exports.find(row => row.type === type);
  assert.equal(sha(exported.path), exported.sha256);
  const zip = await JSZip.loadAsync(fs.readFileSync(exported.path));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
  const uiSkin = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const fixture = createSpritePreview({ manifest, script, uiSkin, type });
  if (attempt === "02" && type === "agentvn") {
    fixture.message.start.target.commandIndex = fixture.message.script.scenes[0].commands
      .findIndex(command => command.text === "SIZE_STAGE_5");
    assert(fixture.message.start.target.commandIndex > 0);
    fixture.evidence.followupStartsAt = "SIZE_STAGE_5_SKIP_ALREADY_VERIFIED_COUNTS";
  }
  row.fixture = { ...fixture.evidence, sourceUiExport: desc(exported.path) };
  row.package = "com.agentvn.qa.client1975." + type;
  assert(!text(["shell", "pm", "list", "packages", row.package]).includes(row.package));
  const staged = path.join(out, "staging.apk");
  fs.copyFileSync(artifact.apk.path, staged, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(staged), artifact.apk.sha256);
  // Keep ownership even when install partially succeeds and reports an error.
  currentPackage = row.package;
  cmd(["install", staged], { timeout: 90000 }); fs.unlinkSync(staged);
  cmd(["logcat", "-c"]);
  cmd(["shell", "monkey", "-p", currentPackage, "-c", "android.intent.category.LAUNCHER", "1"]);
  row.pid = await until(() => cmd(["shell", "pidof", currentPackage], { optional: true }).stdout.trim(), "host PID");
  let recoveredRead = false;
  const expectedHost = { boot: r.bootId, pid: row.pid };
  const session = await observeStartup({
    identity: () => readStartupHostIdentity({
      expected: expectedHost,
      samplePid: () => { const result = cmd(["shell", "pidof", currentPackage], { optional: true });
        return { status: result.status, stdout: result.stdout, stderr: result.stderr }; },
      readBoot: () => text(["shell", "cat", "/proc/sys/kernel/random/boot_id"]),
      allowRecovery: () => { if (recoveredRead) return false; recoveredRead = true; return true; },
      pause: () => delay(150),
      record: observation => { r.startupObservations.push({ type, ...observation }); save(); },
    }),
    connect,
    ready: p => p.waitForFunction(() => {
      const e = document.querySelector("[data-runtime-screen-transition]");
      return e?.getAttribute("data-runtime-presented-screen") === "title_menu"
        && e.getAttribute("data-runtime-screen-transition") === "idle"
        && !document.querySelector(".boot-overlay");
    }),
    record: observation => { r.startupObservations.push({ type, ...observation }); save(); },
  });
  browser = session.browser; page = session.page; row.startupReplacements = session.replacements;
  page.on("pageerror", error => { r.errors.push({ type, error: String(error) }); save(); });
  await surface();
  await page.evaluate(message => {
    window.__spritePreviewReply = undefined;
    const listener = event => {
      if (event.data?.requestId === message.requestId
        && ["agentvn.live-preview.ready", "agentvn.live-preview.error"].includes(event.data.type)) {
        window.__spritePreviewReply = event.data; window.removeEventListener("message", listener);
      }
    };
    window.addEventListener("message", listener);
    window.postMessage(message, window.location.origin);
  }, fixture.message);
  await page.waitForFunction(() => window.__spritePreviewReply);
  row.previewReply = await page.evaluate(() => window.__spritePreviewReply);
  assert.equal(row.previewReply.type, "agentvn.live-preview.ready", JSON.stringify(row.previewReply));
  const selectors = '.sprite-slot[data-character-id="c0"] img,.sprite-slot[data-character-id="c1"] img';
  await page.evaluate(selectors => {
    window.__spriteGeometryFrames = []; window.__spriteMeasurementPhase = "counts"; const start = performance.now();
    const sample = () => {
      for (const image of document.querySelectorAll(selectors)) {
        const slot = image.closest(".sprite-slot");
        window.__spriteGeometryFrames.push({ at: performance.now() - start, id: slot.dataset.characterId,
          exiting: slot.classList.contains("is-exiting"), animationId: slot.dataset.runtimeAnimationId,
          measurementPhase: window.__spriteMeasurementPhase,
          opacity: Number(getComputedStyle(slot.querySelector(".sprite-animation-frame")).opacity),
          rect: image.getBoundingClientRect().toJSON() });
      }
      if (window.__spriteGeometryFrames.length < 12000) window.__spriteFrameRequest = requestAnimationFrame(sample);
    };
    window.__spriteFrameRequest = requestAnimationFrame(sample);
  }, selectors);
  const stages = attempt === "02" && type === "agentvn"
    ? [["SIZE_STAGE_5", 5], ["SIZE_STAGE_RETURN_1", 1]]
    : [["SIZE_STAGE_1", 1], ["SIZE_STAGE_2", 2], ["SIZE_STAGE_5", 5], ["SIZE_STAGE_RETURN_1", 1]];
  for (const [marker, count] of stages) {
    const size = await geometry(marker, count); row.sizes.push({ marker, count, ...size }); save();
    assert.equal(size.naturalWidth, 900); assert.equal(size.naturalHeight, 600);
    assert.equal(size.authorScale, "0.85");
    const baseline = row.sizes[0].rect;
    assert(Math.abs(size.rect.width - baseline.width) < .5 && Math.abs(size.rect.height - baseline.height) < .5,
      "Actual Android raster size changed with sprite count");
    // Record all exit frames before the later explicit author scale change.
    if (marker === "SIZE_STAGE_RETURN_1") {
      row.frames = await page.evaluate(() => {
        cancelAnimationFrame(window.__spriteFrameRequest); return window.__spriteGeometryFrames;
      });
      const exits = row.frames.filter(frame => frame.id === "c1" && frame.measurementPhase === "leaving"
        && frame.opacity > 0 && frame.opacity < .99 && frame.rect.width > 0);
      const entered = row.frames.filter(frame => frame.measurementPhase === "counts"
        && frame.id === "c1" && frame.opacity >= .99 && frame.rect.width > 0);
      assert(exits.length && entered.length, "Real exit and entered raster frames must be captured");
      const settled = entered.at(-1).rect;
      assert(exits.every(frame => Math.abs(frame.rect.width - settled.width) < .5
        && Math.abs(frame.rect.height - settled.height) < .5), "Exiting sprite changed size");
      const mainFrames = row.frames.filter(frame => frame.id === "c0");
      assert(mainFrames.length > 10 && mainFrames.every(frame => Math.abs(frame.rect.width - baseline.width) < .5
        && Math.abs(frame.rect.height - baseline.height) < .5), "Retained sprite changed size between counts");
      row.exit = { path: "EXPLICIT_FADE_OUT_REMAINS_PRESENT_UNTIL_EFFECT_FINISHES",
        intermediateOpacityFrames: exits.length, geometryStable: true, removedBeforeReturnNarration: true };
    }
    if (marker === "SIZE_STAGE_5") await page.evaluate(() => { window.__spriteMeasurementPhase = "leaving"; });
    await tapDialog();
  }
  row.authorScale = await geometry("SIZE_STAGE_AUTHOR_SCALE", 1);
  assert.equal(row.authorScale.authorScale, "1.1");
  assert(Math.abs(row.authorScale.rect.width / row.sizes[0].rect.width - 1.1 / .85) < .01);
  await capture(type);
  const log = text(["logcat", "-d", "-v", "threadtime"]), file = path.join(out, type + "-logcat.txt");
  fs.writeFileSync(file, log, { flag: "wx" });
  row.logcat = desc(file); row.logReview = scopedRuntimeLog(log, currentPackage, [row.pid]);
  assert.equal(row.logReview.fatal.length, 0);
  cmd(["shell", "am", "force-stop", currentPackage]); await disconnect();
  cmd(["uninstall", currentPackage]); assert(!text(["shell", "pm", "list", "packages", currentPackage]).includes(currentPackage));
  currentPackage = undefined; row.status = "PASS"; row.cleanup = "PACKAGE_AND_FORWARD_RETIRED"; save();
}
async function main() {
  save();
  try {
    assert.equal(cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
    { windowsHide: true, encoding: "utf8" }).trim(), "True");
    r.isElevated = true;
    for (const port of ports) await new Promise((resolve, reject) => {
      const s = net.createServer(); s.once("error", reject); s.listen(port, "127.0.0.1", () => s.close(resolve));
    });
    const home = path.join(out, "avd"), data = path.join(home, avd + ".avd"), temp = path.join(out, "temp");
    fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(temp);
    fs.writeFileSync(path.join(home, avd + ".ini"), `avd.ini.encoding=UTF-8\npath=${data}\ntarget=android-35\n`, { flag: "wx" });
    fs.writeFileSync(path.join(data, "config.ini"), ["avd.ini.encoding=UTF-8", "abi.type=x86_64", `avd.id=${avd}`,
      `avd.name=${avd}`, "hw.cpu.arch=x86_64", "hw.cpu.ncore=2", "hw.ramSize=2048", "vm.heapSize=256",
      "hw.lcd.width=1920", "hw.lcd.height=1080", "hw.lcd.density=240", "hw.initialOrientation=landscape",
      "hw.gpu.enabled=yes", "hw.gpu.mode=swiftshader_indirect", "hw.keyboard=yes", "hw.mainKeys=no",
      "disk.dataPartition.size=4G", "disk.cachePartition.size=66MB", "hw.sdCard=no",
      "image.sysdir.1=system-images\\android-35\\google_apis\\x86_64\\", "tag.id=google_apis",
      "target=android-35", "fastboot.forceColdBoot=yes", "showDeviceFrame=no"].join("\n"), { flag: "wx" });
    const stdout = fs.openSync(path.join(out, "emulator-stdout.log"), "wx");
    const stderr = fs.openSync(path.join(out, "emulator-stderr.log"), "wx");
    emulator = cp.spawn(path.join(sdk, "emulator/emulator.exe"),
      ["-avd", avd, "-port", "5582", "-no-window", "-no-snapshot", "-no-boot-anim", "-no-audio",
        "-gpu", "swiftshader_indirect", "-accel", "on", "-grpc", String(grpcPort), "-grpc-use-token"],
      { windowsHide: true, env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_AVD_HOME: home,
        ANDROID_ADB_SERVER_PORT: String(adbPort), TEMP: temp, TMP: temp }, stdio: ["ignore", stdout, stderr] });
    fs.closeSync(stdout); fs.closeSync(stderr); r.emulator = { pid: emulator.pid, avd, home }; save();
    cmd(["start-server"]); adbStarted = true;
    await until(() => {
      assert.equal(emulator.exitCode, null, "Owned emulator exited during startup");
      return cmd(["shell", "getprop", "sys.boot_completed"], { optional: true, timeout: 4000 }).stdout.trim() === "1";
    }, "API35 boot", 240000);
    r.bootId = text(["shell", "cat", "/proc/sys/kernel/random/boot_id"]);
    r.environment = { sdk: text(["shell", "getprop", "ro.build.version.sdk"]),
      abi: text(["shell", "getprop", "ro.product.cpu.abi"]),
      fingerprint: text(["shell", "getprop", "ro.build.fingerprint"]), webview: text(["shell", "dumpsys", "webviewupdate"]) };
    assert.equal(r.environment.sdk, "35"); assert.equal(r.environment.abi, "x86_64"); save();
    for (const type of attempt === "03" ? ["renpy"] : ["agentvn", "renpy"]) await check(type);
    assert.equal(r.cases.length, attempt === "03" ? 1 : 2); assert.deepEqual(r.errors, []);
    r.status = "PASS_TWO_THEME_ANDROID_PREVIEW_SPRITE_GEOMETRY_LOGS_RETAINED";
  } catch (error) {
    r.status = "FAILED"; r.error = error.stack; process.exitCode = 1;
    if (page && !page.isClosed()) try { r.failureText = await page.locator("body").innerText(); } catch {}
  } finally {
    r.cleanupErrors = [];
    try {
      if (adbStarted) {
        if (r.bootId) assert.equal(text(["shell", "cat", "/proc/sys/kernel/random/boot_id"]), r.bootId);
        else assert(text(["emu", "avd", "name"]).split(/\r?\n/).includes(avd));
        if (currentPackage) {
          fs.writeFileSync(path.join(out, "failure-logcat.txt"), text(["logcat", "-d", "-v", "threadtime"]), { flag: "wx" });
          cmd(["shell", "am", "force-stop", currentPackage]); await disconnect();
          if (text(["shell", "pm", "list", "packages", currentPackage]).includes(currentPackage)) cmd(["uninstall", currentPackage]);
          assert(!text(["shell", "pm", "list", "packages", currentPackage]).includes(currentPackage));
          currentPackage = undefined;
        }
        await disconnect();
        r.packageCleanup = [];
        for (const type of ["agentvn", "renpy"]) {
          const pkg = "com.agentvn.qa.client1975." + type;
          assert(!text(["shell", "pm", "list", "packages", pkg]).includes(pkg));
          r.packageCleanup.push({ pkg, absent: true });
        }
        cmd(["emu", "kill"]);
      }
    } catch (error) { r.cleanupErrors.push(String(error)); }
    try { if (emulator) await until(() => emulator.exitCode !== null, "owned emulator exit", 40000); }
    catch (error) { r.cleanupErrors.push(String(error)); }
    if (adbStarted) try { cmd(["kill-server"]); } catch (error) { r.cleanupErrors.push(String(error)); }
    const staged = path.join(out, "staging.apk"); if (fs.existsSync(staged)) fs.unlinkSync(staged);
    for (const item of r.inputs) assert.equal(sha(item.path), item.sha256);
    r.cleanup = currentPackage || r.cleanupErrors.length ? "FAILED" : "PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP";
    if (r.cleanup === "FAILED") { r.status = "FAILED"; process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, cleanup: r.cleanup, error: r.error }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
