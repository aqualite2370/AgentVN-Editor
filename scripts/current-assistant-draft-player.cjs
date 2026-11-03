"use strict";
// Actual installed Player consumption of a reviewed queue draft. No generation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const net = require("node:net");
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port; server.close(e => e ? reject(e) : resolve(port));
  });
});
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { waitNativeRuntimePage } = require("./lib/wait-native-runtime-page.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const sourceFile = "F:/AgentVN/QA/Assistant-Queue-1.9.35-20261102-01/session-04/report.json";
const priorRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/assistant-queue-consumer-01";
const out = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/assistant-queue-consumer-02";
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const original = read(sourceFile), installation = descriptor();
assert.equal(original.status, "PASS");
assert.equal(sha(original.cartridge.path), original.cartridge.sha256);
const earlier = read(path.join(priorRoot, "report.json"));
assert.equal(earlier.status, "FAILED"); assert.equal(earlier.cases.length, 12);
assert.equal(earlier.cleanup.status, "PASS");
for (const c of earlier.cases) {
  assert(c.error.includes("locator.scrollIntoViewIfNeeded") && c.custom.hit && c.titleControls.length === 3);
  assert(c.titleControls.every(n => n.geometry.hit));
  assert(c.body.includes("作品信息"), "Earlier forward navigation must actually reach About");
}
const executable = installation.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
assert(executable);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), source: desc(sourceFile),
  cartridge: desc(original.cartridge.path), executable, tools: [desc(__filename), desc(helper)],
  continuedFrom: desc(path.join(priorRoot, "report.json")),
  scope: "ACTUAL_INSTALLED_PLAYER_PREVIEW_QUEUE_DRAFT_WEBVIEW_LOGICAL_VIEWPORT_NOT_PHYSICAL_4K",
  defaultPlacement: original.defaultRect, cases: [], screenshots: [], pageErrors: [], knownProcesses: [],
  productChanges: 0, builds: 0, modelRequests: 0,
  notProven: ["Real model quality", "Standalone/setup", "Android", "Normal native close", "Physical mouse/touch/display"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
let child, browser, page, cdp, identity, port, protectedProfile = false;
const known = new Map();
function remember() {
  if (!child) return;
  const tree = ownedProcessTree(rows(), child.pid, identity?.Created);
  if (tree.length && !identity) identity = tree[0];
  for (const p of tree) known.set(`${p.ProcessId}:${p.Created}`, p);
  report.knownProcesses = [...known.values()]; save();
}
function profile(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    helper, "-Action", action, "-RunDirectory", path.resolve(out), "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  (report.profiles ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
  save(); assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function geometry(n) {
  await n.scrollIntoViewIfNeeded();
  const g = await n.evaluate(node => {
    const r = node.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: r.toJSON(), hit: top === node || node.contains(top),
      top: top ? { tag: top.tagName, className: top.className, text: top.textContent?.slice(0, 90) } : null,
      width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert(g.hit, "Actual hit target is occluded: " + JSON.stringify(g));
  assert(g.rect.width > 0 && g.rect.height > 0 && g.rect.left >= 0 && g.rect.top >= 0
    && g.rect.right <= g.width + 1 && g.rect.bottom <= g.height + 1 && g.overflow <= 1,
  JSON.stringify(g));
  await n.click({ trial: true }); return g;
}
async function ready(testId) {
  await page.getByTestId(testId).waitFor(); await settleRuntime(page);
}
(async () => {
  assert(!rows().some(p => /^(agentvn-editor|creator-backend|agentvn-player)\.exe$/i.test(p.Name)));
  save(); protectedProfile = true; profile("Prepare");
  port = await freePort(); assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, TEMP: temporary, TMP: temporary });
  const log = fs.openSync(path.join(out, "player.log"), "wx");
  try {
    child = spawn(executable.path, ["--mode", "preview", "--cartridge", original.cartridge.path],
      { cwd: path.dirname(executable.path), env, windowsHide: true, stdio: ["ignore", log, log] });
  } finally { fs.closeSync(log); }
  remember(); assert(identity);
  assert.equal(path.resolve(identity.ExecutablePath), path.resolve(executable.path));
  report.launch = { pid: child.pid, port, identity, executable, mode: "preview" }; save();
  await until(async () => {
    assert.equal(child.exitCode, null);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "exact installed Player DevTools", 60000);
  remember();
  const ownedListeners = listeners([port]);
  assert.equal(ownedListeners.length, 1);
  assert(report.knownProcesses.some(p => p.ProcessId === ownedListeners[0].OwningProcess));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await waitNativeRuntimePage(browser);
  page.setDefaultTimeout(15000);
  page.on("pageerror", e => { report.pageErrors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
  await ready("game-state-title");
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const m = { width, height: width * 9 / 16, dpr, reduced }, item = { ...m, status: "RUNNING" };
    report.cases.push(item); save(); console.log(`START Player ${width}/${dpr}/${reduced}`);
    try {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: m.height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      item.viewport = await readInstalledViewport(page, m); await settleRuntime(page);
      const custom = page.getByTestId("runtime-custom-component").getByRole("button", { name: "QUEUE_C", exact: true });
      assert.equal(await custom.count(), 1);
      const completed = earlier.cases.find(c => c.width === width && c.dpr === dpr && c.reduced === reduced);
      item.custom = completed.custom; item.titleControls = completed.titleControls; item.focus = completed.focus;
      item.priorCompletedAssertions = { source: report.continuedFrom,
        scope: "Prior actual title hit/focus/menu geometry and forward navigation, not prior failed return check" };
      await custom.click(); await ready("about-screen");
      const back = page.getByTestId("renpy-menu-return");
      item.aboutBack = await geometry(back);
      await back.click(); await ready("game-state-title");
      assert.equal(await custom.count(), 1);
      report.screenshots.push(await captureInstalledWebview(page, cdp,
        path.join(out, `returned-title-${width}-${dpr}-${reduced}.png`), m));
      item.action = { name: "open_about", actualNavigation: true, returnedToTitle: true };
      item.status = "PASS"; console.log(`PASS Player ${width}/${dpr}/${reduced}`);
    } catch (e) {
      item.status = "FAILED"; item.error = String(e.stack || e);
      item.body = await page.locator("body").innerText().catch(String);
      report.screenshots.push(await captureInstalledWebview(page, cdp,
        path.join(out, `failure-${width}-${dpr}-${reduced}.png`), m));
      // Retain all matrix failures, but do not fabricate navigation on a blocked control.
      if (await page.getByTestId("about-screen").isVisible().catch(() => false)) {
        await page.keyboard.press("Escape"); await ready("game-state-title");
      }
    } finally { save(); }
  }
  if (report.cases.every(c => c.status === "PASS")) {
    await page.getByTestId("start-new-game").click(); await ready("game-state-playing");
    report.realStoryStart = { status: "PASS", text: await page.locator("body").innerText() };
  }
  assert.equal(report.cases.length, 12);
  assert(report.cases.every(c => c.status === "PASS"), "At least one Player consumption/navigation matrix failed");
  assert.deepEqual(report.pageErrors, []);
  report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
}).finally(async () => {
  try {
    remember(); await browser?.close().catch(() => {});
    for (const p of [...known.values()].reverse())
      if (rows().some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)) stopOwnedProcess(p, ps);
    if (port) await until(() => listeners([port]).length === 0
      && !rows().some(p => known.has(`${p.ProcessId}:${p.Created}`)), "owned Player cleanup", 15000);
    report.cleanup = { status: "PASS", port, remainingOwned: 0, normalCloseClaimed: false };
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) profile("Restore");
    for (const f of [report.source, report.cartridge, executable]) assert.equal(sha(f.path), f.sha256);
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error, cleanupError: report.cleanupError }));
});
