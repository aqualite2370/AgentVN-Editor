"use strict";
// Read-only timing probes of the frozen installed Player; no clock/style/store overrides.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { rows, listeners, until, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { readInstalledViewport, captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { beginRuntimeMotion, finishRuntimeMotion } = require("./lib/installed-runtime-motion-sampler.cjs");
assert(process.env.AGENTVN_EXIT_CANDIDATE_CONFIG, "Explicit diagnostic candidate required");
const options = require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate();
assert(process.argv.includes(`--candidate=${options.version}`), "Matching diagnostic version required");
const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/runtime-clock-${options.stamp}-${attempt}`);
const installed = require("./candidate-1930-exit.cjs").validateInstallation(options.installation);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const player = installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"); assert(player);
const exported = read(options.binding.exported.path), fixture = read(options.binding.fixture.path);
const cartridge = exported.cartridges.find(c => c.layout === "agentvn"); assert(cartridge);
assert.equal(exported.status, "PASS"); assert.equal(sha(cartridge.path), cartridge.sha256);
assert.equal(sha(fixture.input), fixture.inputSha256); assert.equal(sha(player.path), player.sha256);
assert(!rows().some(p => p.Name === "agentvn-player.exe"), "Do not share an active Player");
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const metric = { width: 1920, height: 1080, dpr: 2, reduced: false };
const report = { status: "RUNNING", at: new Date().toISOString(), version: options.version,
  scope: "INSTALLED_PLAYER_READ_ONLY_CLOCK_DIAGNOSTIC_NOT_ACCEPTANCE", out, metric,
  installation: desc(options.installation), player, cartridge, fixture: desc(fixture.input),
  bindings: [options.bindingFile, ...["candidateConfig", "installation", "predecessor", "exported", "fixture"]
    .map(k => options.binding[k].path)].map(desc),
  tools: [__filename, "scripts/lib/installed-runtime-motion-sampler.cjs", "scripts/native-dev-preview-profile.ps1",
    "scripts/lib/current-native-capture.cjs", "scripts/lib/owned-process-tree.cjs", "scripts/lib/owned-process-stop.cjs"].map(desc),
  productSources: ["GameCli_framework/src/app/RuntimeScreenNavigator.tsx", "GameCli_framework/src/styles/shell.css"].map(desc),
  probes: [], screenshots: [], errors: [], normalCloseClaimed: false, productChanges: 0, builds: 0, modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let child, browser, page, cdp, port, protectedProfiles = false, identity;
const known = new Map(), key = p => `${p.ProcessId}:${p.Created}`;
function remember() {
  if (child && identity) for (const p of ownedProcessTree(rows(), child.pid, identity.Created)) known.set(key(p), p);
  report.knownProcesses = [...known.values()]; save();
}
function profiles(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.resolve("scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out, "-Storage", "NativeRoaming"],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profiles-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function ready(screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === screen
      && n?.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen);
}
(async () => {
  save(); for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);
  protectedProfiles = true; profiles("Prepare");
  port = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
  });
  assert.equal(listeners([port]).length, 0);
  const temp = path.join(out, "temporary"); fs.mkdirSync(temp);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_TEST_PROJECT: fixture.input, AGENTVN_WORKSPACE_OUTPUT: out, TEMP: temp, TMP: temp });
  const fd = fs.openSync(path.join(out, "player.log"), "wx");
  child = spawn(player.path, ["--mode", "preview", "--cartridge", cartridge.path],
    { cwd: installed.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
  report.launch = { pid: child.pid, port, executable: desc(player.path), isolation: {
    project: fixture.input, out, webview: env.WEBVIEW2_USER_DATA_FOLDER }, args: ["--mode", "preview", "--cartridge", cartridge.path] };
  await until(() => { identity = rows().find(p => p.ProcessId === child.pid); return identity; }, "diagnostic Player identity");
  assert.equal(path.resolve(identity.ExecutablePath), path.resolve(player.path)); report.launch.identity = identity;
  await until(async () => {
    assert.equal(child.exitCode, null); remember();
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(700) })).ok; }
    catch { return false; }
  }, "owned diagnostic WebView", 45000);
  assert(listeners([port]).every(p => [...known.values()].some(k => k.ProcessId === p.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "diagnostic document");
  page.setDefaultTimeout(20000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: metric.width, height: metric.height, deviceScaleFactor: metric.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  report.viewport = await readInstalledViewport(page, metric);
  await ready("title_menu");
  await page.getByTestId("start-new-game").click(); await ready("playing"); await page.locator(".dialog-box").waitFor();
  for (const mode of ["events-only", "full-original-sampler", "events-only", "full-original-sampler"]) {
    const probe = { mode, status: "RUNNING" }; report.probes.push(probe); save();
    await page.evaluate(() => {
      const root = document.querySelector("[data-runtime-screen-transition]"), events = [], phases = [];
      const names = ["transitionrun", "transitionstart", "transitionend", "transitioncancel"];
      const handler = e => {
        if (e.target !== root || e.pseudoElement !== "::before" || e.propertyName !== "opacity") return;
        events.push({ type: e.type, elapsedMs: e.elapsedTime * 1000, at: performance.now(),
          phase: root.dataset.runtimeTransitionPhase, className: root.className, pseudo: e.pseudoElement });
      };
      const observer = new MutationObserver(records => {
        for (const r of records) if (r.attributeName === "data-runtime-transition-phase")
          phases.push({ at: performance.now(), previous: r.oldValue, current: root.dataset.runtimeTransitionPhase });
      });
      observer.observe(root, { attributes: true, attributeOldValue: true, attributeFilter: ["data-runtime-transition-phase"] });
      for (const n of names) root.addEventListener(n, handler);
      const css = getComputedStyle(root);
      window.__qaInstalledClock = { events, phases,
        declared: { cover: css.getPropertyValue("--runtime-screen-cover-duration"), reveal: css.getPropertyValue("--runtime-screen-reveal-duration") },
        stop() { observer.disconnect(); for (const n of names) root.removeEventListener(n, handler); } };
    });
    if (mode === "full-original-sampler") await beginRuntimeMotion(page, `clock-${report.probes.length}`);
    await page.keyboard.press("Escape"); await ready("main_menu");
    probe.observation = await page.evaluate(() => {
      const r = window.__qaInstalledClock; r.stop(); delete window.__qaInstalledClock;
      return { declared: r.declared, events: r.events, phases: r.phases };
    });
    if (mode === "full-original-sampler") {
      const trace = await finishRuntimeMotion(page), file = path.join(out, `trace-${report.probes.length}.json`);
      fs.writeFileSync(file, JSON.stringify(trace), { flag: "wx" }); probe.trace = desc(file);
    }
    assert(probe.observation.events.length >= 4, "Need both real opacity transitions, not only phases");
    probe.coverCancelled = probe.observation.events.some(e => e.type === "transitioncancel");
    probe.status = "OBSERVED"; save();
    console.log(JSON.stringify({ mode, events: probe.observation.events.map(e => [e.type, e.phase, e.elapsedMs]) }));
    await page.getByTestId("continue-game").click(); await ready("playing");
  }
  assert.equal(report.probes.length, 4); assert.deepEqual(report.errors, []);
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, "final.png"), metric));
  report.finding = report.probes.some(p => p.coverCancelled) ? "REAL_TRANSITION_CANCEL_REPRODUCED" : "NOT_REPRODUCED_NOT_ACCEPTANCE_PASS";
  report.status = "DIAGNOSTIC_COMPLETE";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    try {
      if (page && !page.isClosed()) await page.evaluate(() => { window.__qaInstalledClock?.stop?.(); delete window.__qaInstalledClock; window.__qaRuntimeMotion?.stop?.(); }).catch(() => {});
      remember(); await browser?.close().catch(() => {});
      for (const p of [...known.values()].reverse()) stopOwnedProcess(p, ps);
      await until(() => !rows().some(p => known.has(key(p))) && (!port || !listeners([port]).length), "diagnostic exact cleanup", 15000);
      report.cleanup = { status: "PASS", identities: known.size, port, normalCloseClaimed: false };
    } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    try {
      if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
        profiles("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(report.restoration.path).status, "PASS");
      }
      for (const f of [player, ...report.bindings, ...report.tools, ...report.productSources]) assert.equal(sha(f.path), f.sha256);
    } catch (e) { report.restorationError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, finding: report.finding, out, error: report.error }));
  });
