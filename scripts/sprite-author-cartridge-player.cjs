"use strict";
// Consume untouched UI downloads through the formal fixed-cartridge path.
// The Player bytes match the previously actually installed candidate.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict"), net = require("node:net");
const { chromium } = require("../editor/node_modules/playwright");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners, until, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { assertCleanLegacySaveSource } = require("./lib/player-profile-launch-guard.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const source = path.resolve(process.argv[2] || ""), out = path.join(source, "formal-player");
assert.equal(path.dirname(source).toLowerCase(), path.resolve("F:/testavn").toLowerCase());
assert(/^Sprite-Author-Export-1975-20261116-\d{2}$/.test(path.basename(source)));
assert(!fs.existsSync(out), "Never replace previous evidence");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const inputFile = path.join(source, "report.json"), authored = read(inputFile);
assert.equal(authored.status, "PASS_SOURCE_AUTHOR_UI_PERSISTENCE_AND_TWO_NORMAL_CARTRIDGES");
assert.equal(authored.exports.length, 2);
const original = path.resolve("editor/src-tauri/binaries/agentvn-player.exe");
const installation = read("F:/testavn/Windows-Isolated-1975-20261116-01/installation.json");
assert.equal(installation.status, "PASS");
const expected = installation.resources.find(r => r.relative === "agentvn-player.exe").sha256;
assert.equal(sha(original), expected, "Use the unchanged actually-installed Player bytes");
assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)),
  "Do not interfere with a user's active product");
const profileSafety = assertCleanLegacySaveSource();
fs.mkdirSync(out);
const exe = path.join(out, "agentvn-player.exe");
fs.copyFileSync(original, exe, fs.constants.COPYFILE_EXCL); assert.equal(sha(exe), expected);
const report = { status: "RUNNING", at: new Date().toISOString(), cases: [], launches: [], cleanups: [],
  screenshots: [], errors: [], profileSafety, input: { path: inputFile, sha256: sha(inputFile) },
  executable: { path: exe, sha256: expected }, productBuilds: 0, models: 0,
  scope: "SOURCE_EDITOR_UI_EXPORT_UNCHANGED_CARTRIDGE_FORMAL_NATIVE_PLAYER_CONSUMPTION",
  limitations: ["Editor authoring is source browser with isolated backend",
    "Player executable matches actual installation; this is not a new install/default-profile test",
    "1080p DPR1 incremental consumption, not a repeated full display matrix",
    "Windows fixed-cartridge consumption, not Android or physical-phone acceptance"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const known = new Map(); let child, browser, page, launch;
function remember() {
  if (child && launch) for (const row of ownedProcessTree(rows(), child.pid, launch.created))
    known.set(`${row.ProcessId}:${row.Created}`, row);
  report.known = [...known.values()]; save();
}
async function stop() {
  await browser?.close().catch(() => {}); browser = undefined;
  remember(); const stopped = [];
  for (const row of [...known.values()].reverse())
    if (rows().some(p => p.ProcessId === row.ProcessId && p.Created === row.Created))
      stopped.push({ pid: row.ProcessId, result: stopOwnedProcess(row, ps) });
  await until(() => !rows().some(p => known.has(`${p.ProcessId}:${p.Created}`))
    && !listeners(report.launches.flatMap(l => l.ports)).length, "exact formal Player retirement");
  report.cleanups.push({ stopped, status: "PASS", naturalExit: stopped.length === 0 });
  child = page = launch = undefined; save();
}
async function start(item) {
  const port = await new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  const temporary = path.join(out, "temp-" + item.type); fs.mkdirSync(temporary);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(key)) delete env[key];
  Object.assign(env, { TEMP: temporary, TMP: temporary,
    WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview-" + item.type),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=" + port });
  const log = fs.openSync(path.join(out, item.type + ".log"), "wx");
  child = cp.spawn(exe, ["--mode", "fixed", "--cartridge", item.path],
    { cwd: out, env, windowsHide: true, stdio: ["ignore", log, log] });
  fs.closeSync(log);
  const identity = await until(() => rows().find(p => p.ProcessId === child.pid), "exact Player host", 10000);
  launch = { pid: identity.ProcessId, created: identity.Created, exe, ports: [port], type: item.type };
  report.launches.push(launch); remember();
  await until(async () => {
    assert.equal(child.exitCode, null);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "formal Player WebView", 90000);
  remember(); assert(listeners([port]).every(l => [...known.values()].some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
  page = await until(() => browser.contexts().flatMap(c => c.pages())
    .find(p => /tauri\.localhost|^tauri:/.test(p.url())), "formal Player document");
  page.setDefaultTimeout(45000); page.on("pageerror", error => report.errors.push(String(error)));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByTestId("start-new-game").click(); return cdp;
}
async function geometry(marker, count) {
  await page.locator(".dialog-text").filter({ hasText: marker }).waitFor();
  await page.waitForFunction(count => document.querySelectorAll(".sprite-slot:not(.is-exiting)").length === count, count);
  await page.waitForFunction(() => [...document.querySelectorAll(".sprite-slot img")]
    .every(image => image.complete && image.naturalWidth > 0));
  await settleRuntime(page);
  assert.equal(await page.getByText("缺少背景素材", { exact: true }).count(), 0);
  return page.locator('.sprite-slot[data-character-id="c0"]:not(.is-exiting) img').evaluate(image => ({
    rect: image.getBoundingClientRect().toJSON(), width: image.naturalWidth, height: image.naturalHeight,
    scale: image.closest("[data-sprite-scale]").dataset.spriteScale, src: image.currentSrc,
  }));
}
(async () => {
  for (const item of authored.exports) {
    assert.equal(sha(item.path), item.sha256);
    const row = { type: item.type, status: "RUNNING", cartridge: item, sizes: [] }; report.cases.push(row); save();
    const cdp = await start(item); let baseline;
    for (const [marker, count] of [["SIZE_STAGE_1", 1], ["SIZE_STAGE_2", 2], ["SIZE_STAGE_5", 5], ["SIZE_STAGE_RETURN_1", 1]]) {
      const measured = await geometry(marker, count); baseline ??= measured;
      assert.equal(measured.width, 900); assert.equal(measured.height, 600); assert.equal(measured.scale, "0.85");
      assert(Math.abs(measured.rect.width - baseline.rect.width) < .5
        && Math.abs(measured.rect.height - baseline.rect.height) < .5);
      row.sizes.push({ marker, count, ...measured }); save();
      await page.locator(".dialog-box").click();
    }
    row.authorScale = await geometry("SIZE_STAGE_AUTHOR_SCALE", 1);
    assert.equal(row.authorScale.scale, "1.1");
    assert(Math.abs(row.authorScale.rect.width / baseline.rect.width - 1.1 / .85) < .01);
    report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, item.type + ".png"),
      { width: 1920, height: 1080, dpr: 1, reduced: false }));
    assert.equal(sha(item.path), item.sha256);
    // State remains in formal fixed mode; no live-preview initialization or store mutation.
    row.status = "PASS"; save();
    await stop();
  }
  assert.equal(report.cases.length, 2); assert.deepEqual(report.errors, []);
  assert.equal(sha(inputFile), report.input.sha256);
  report.status = "PASS_TWO_UNCHANGED_UI_EXPORTS_FORMAL_FIXED_PLAYER_GEOMETRY";
})().catch(async error => {
  report.status = "FAILED"; report.error = error.stack; process.exitCode = 1;
  try { report.failureText = (await page.locator("body").innerText()).slice(-12000); } catch {}
}).finally(async () => {
  try { await stop(); } catch (error) { report.cleanupError = error.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, error: report.error, out }));
});
