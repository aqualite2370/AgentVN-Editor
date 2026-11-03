"use strict";
// QA only: real touches create old saves, install -r preserves them, real UI loads them.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { fileEvidence, verifyColdBoot } = require("./android-acceptance-evidence.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const { visibleControlRect } = require("./visible-control-geometry.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pkg = "com.agentvn.qa.androidcurrent20261021";
function validateRequest(request) {
  assert.equal(request.scope, "installed-native-upgrade");
  assert.equal(request.package, pkg);
  assert.equal(request.upgradePair.old.versionName, "0.1.0");
  assert.equal(request.upgradePair.current.versionName, "0.1.1");
  assert.equal(request.upgradePair.old.versionCode, 1000);
  assert.equal(request.upgradePair.current.versionCode, 1001);
  assert.equal(request.upgradePair.old.signerSha256, request.upgradePair.current.signerSha256);
  assert.match(request.upgradePair.old.signerSha256, /^[a-f0-9]{64}$/);
  for (const key of ["oldApk", "apk"]) {
    assert.equal(fileEvidence(request[key].path).sha256, request[key].sha256);
    assert(request[key].path.startsWith("F:\\AgentVN\\QA\\Android-Package-20261021-01\\"));
  }
  assert(request.outputDir.startsWith("F:\\AgentVN\\QA\\Android-Package-20261021-01\\device-upgrade-"));
  assert.equal(request.serial, "emulator-5554"); assert(request.coldBoot);
  const audit = read(request.packageAudit.path);
  assert.equal(fileEvidence(request.packageAudit.path).sha256, request.packageAudit.sha256);
  assert(["APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN",
    "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN"].includes(audit.status));
  if (audit.status === "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN") {
    assert.equal(audit.publishingWorkflow?.normalCloseStatus, "FAILED");
    assert.equal(audit.publishingWorkflow?.publishingWorkflowStatus, "FAILED");
    assert.equal(audit.publishingWorkflow?.artifactBuildStatus, "PASS");
  }
  assert.deepEqual(audit.upgradePair.current, request.upgradePair.current);
  assert.deepEqual(audit.upgradePair.old, request.upgradePair.old);
  assert.equal(request.apk.sha256, audit.upgradePair.currentApk.sha256);
  assert.equal(request.oldApk.sha256, "504ea034c14f393465b44160898516a7875d3031c65d108779ecb51897b5de5b");
}
function assertPreservedUpgradeData(args, preservationWindow, cleanup) {
  assert(!preservationWindow || cleanup || !(args[0] === "uninstall"
    || args.slice(0, 3).join(" ") === "shell pm clear"), "Upgrade must preserve the old data");
}
function runningPackagePid(result) {
  if (result.status === 1 && !result.stdout?.trim() && !result.stderr?.trim()) return null;
  assert.equal(result.status, 0, String(result.stderr || result.error || result.stdout));
  const pid = result.stdout?.trim().split(/\s+/)[0];
  assert.match(pid || "", /^\d+$/); return pid;
}
async function main(requestFile) {
  const q = read(requestFile); validateRequest(q);
  const out = q.outputDir, adb = path.join(q.sdk, "platform-tools/adb.exe");
  const reportFile = path.join(out, "upgrade-runtime-report.json");
  assert(!fs.existsSync(reportFile), "Do not overwrite a runtime attempt");
  const r = { status: "RUNNING", scope: q.scope, startedAt: new Date().toISOString(),
    modelRequests: 0, productChanges: 0, cases: [], touches: [], screenshots: [], commands: [], pids: [],
    oldQuickCreation: "BLOCKED_OLD_DEFAULT_LAYOUT_HAS_NO_CREATION_ENTRY",
    oldAutoCreation: "NOT_RUN",
    uninstallStatus: "NOT_RUN", apkCleanupStatus: "NOT_RUN", cleanupError: null,
    sourceApks: { old: q.oldApk, current: q.apk }, restartTrials: [] };
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
  let installed = false, ownedAdb = false, forwarded = false, client, cleanup = false, preservationWindow = false;
  const staged = [path.join(out, "old-staging.apk"), path.join(out, "current-staging.apk")];
  const cmd = (args, binary = false, allowFailure = false) => {
    assertPreservedUpgradeData(args, preservationWindow, cleanup);
    const result = spawnSync(adb, ["-P", String(q.adbPort), "-s", q.serial, ...args],
      { windowsHide: true, encoding: binary ? null : "utf8", timeout: 120000, maxBuffer: 40 * 1024 ** 2 });
    r.commands.push({ at: new Date().toISOString(), args, status: result.status,
      ...(binary ? {} : { stdout: result.stdout, stderr: result.stderr }) });
    if (!allowFailure) assert.equal(result.status, 0, String(result.stderr || result.error || result.stdout));
    return result;
  };
  const text = args => cmd(args).stdout.trim();
  const wait = async (action, label, timeout = 60000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const result = await action(); if (result) return result; await pause(250); }
    throw Error("Timed out: " + label);
  };
  const step = async (name, fn) => {
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; r.cases.push(c); save();
    try { c.evidence = await fn(); c.status = "PASS"; }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  };
  class Client {
    constructor(socket) {
      this.socket = socket; this.seq = 0; this.pending = new Map();
      socket.onmessage = event => {
        const m = JSON.parse(event.data), cb = this.pending.get(m.id);
        if (cb) { this.pending.delete(m.id); cb(m); }
      };
    }
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++this.seq;
        const timer = setTimeout(() => { this.pending.delete(id); reject(Error("CDP timeout: " + method)); }, 20000);
        this.pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
        this.socket.send(JSON.stringify({ id, method, params }));
      });
    }
    async evaluate(expression) {
      const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    }
    close() { this.socket.close(); }
  }
  const connect = async () => {
    client?.close(); client = null;
    if (forwarded) { cmd(["forward", "--remove", `tcp:${q.cdpPort}`]); forwarded = false; }
    const pid = await wait(() => runningPackagePid(cmd(["shell", "pidof", pkg], false, true)), "running package PID");
    r.pids.push(pid);
    cmd(["forward", "--no-rebind", `tcp:${q.cdpPort}`, `localabstract:webview_devtools_remote_${pid}`]); forwarded = true;
    const tab = await wait(async () => {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${q.cdpPort}/json/list`,
          { signal: AbortSignal.timeout(2000) })).json();
        return pages.find(p => p.type === "page" && p.url && p.url !== "about:blank");
      } catch (e) { if (!(e instanceof SyntaxError) && !/fetch|abort|timeout/i.test(String(e))) throw e; }
    }, "actual APK WebView");
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("WebSocket open timeout")), 15000);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = e => { clearTimeout(timer); reject(e); };
    });
    client = new Client(socket);
    await wait(() => client.evaluate(`Boolean(document.querySelector('[data-testid="start-new-game"]'))
      && !document.querySelector('.boot-overlay, .game-launch-blackout')
      && document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition === 'idle'`), "actual title ready");
  };
  const idle = () => wait(() => client.evaluate(`document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition==='idle'
    && !document.querySelector('.boot-overlay,.game-launch-blackout')`), "page transition completion");
  const screenshot = async label => {
    const before = await client.evaluate(`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches})`);
    const bytes = cmd(["exec-out", "screencap", "-p"], true).stdout;
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    const physical = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    assert(physical.width > physical.height); r.physical = physical;
    const after = await client.evaluate(`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches})`);
    assert.deepEqual(before, after);
    const file = path.join(out, label + ".png"); fs.writeFileSync(file, bytes, { flag: "wx" });
    const sample = { ...fileEvidence(file), before, after, physical, source: "real Android ADB screencap; no viewport override" };
    if (/^(old-title|new-title|new-loaded-)/.test(label)) {
      assert.match(q.runId, /^[a-zA-Z0-9-]+$/);
      const remote = `/sdcard/agentvn-upgrade-${q.runId}.xml`;
      try {
        cmd(["shell", "uiautomator", "dump", remote]);
        const xml = text(["exec-out", "cat", remote]);
        assert(xml.includes("<hierarchy") && xml.includes(pkg), "Actual package UIAutomator tree required");
        const tree = path.join(out, label + "-uiautomator.xml");
        fs.writeFileSync(tree, xml, { flag: "wx" }); sample.uiautomator = fileEvidence(tree);
      } finally { cmd(["shell", "rm", "-f", remote]); }
    }
    r.screenshots.push(sample); return sample;
  };
  const tap = async (selector, label) => {
    await idle();
    const hit = await wait(() => client.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)});
      if(!e||e.disabled) return null;
      const b=(${visibleControlRect.toString()})(e);
      const points=[[.5,.5],[.5,.25],[.25,.25],[.75,.25],[.25,.75]];
      for(const [u,v] of points){const x=b.x+b.width*u,y=b.y+b.height*v,t=document.elementFromPoint(x,y);
        if(x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&(t===e||e.contains(t))&&
          (!t?.closest('button,input,a')||t.closest('button,input,a')===e))
          return {x,y,width:innerWidth,height:innerHeight,rect:b};}
      return null; })()`), label + ": visible, enabled and uncovered target");
    assert(hit, label + ": control is hidden, clipped, covered or disabled");
    if (!r.physical) await screenshot("initial-touch-baseline");
    const x = Math.round(hit.x * r.physical.width / hit.width);
    const y = Math.round(hit.y * r.physical.height / hit.height);
    cmd(["shell", "input", "tap", String(x), String(y)]); r.touches.push({ label, selector, x, y, hit });
    // Observe actual render turns, not a fixed delay that may inspect the old idle page.
    await client.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
  };
  const settings = () => client.evaluate(`Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('vn.runtime.settings.')).sort().map(k=>[k,JSON.parse(localStorage.getItem(k))]))`);
  const position = async expectedCommand => {
    await idle();
    await wait(() => client.evaluate(`document.querySelector('.dialog-box')?.dataset.dialogPageDone==='true'
      && Number(document.querySelector('.story-player')?.dataset.currentCommandIndex)===${expectedCommand}`),
    "fully revealed authored dialogue at command " + expectedCommand);
    return client.evaluate(`(() => {const p=document.querySelector('.story-player');return {scene:p?.dataset.currentSceneId,
      command:Number(p?.dataset.currentCommandIndex),text:document.querySelector('.dialog-text')?.textContent};})()`);
  };
  const expand = async () => {
    if (await client.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded')!=='true'`))
      await tap('[data-testid="quick-menu-toggle"]', "expand real quick menu");
    await wait(() => client.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded')==='true'
      && [...document.querySelectorAll('.playback-controls')].every(e=>e.getAnimations({subtree:true}).every(a=>a.playState==='finished'))`), "expanded menu settled");
  };
  const diskSaves = label => {
    const listing = cmd(["shell", "find", `/data/user/0/${pkg}/saves`, "-type", "f"], false, true);
    if (listing.status === 1 && !listing.stdout?.trim()
      && String(listing.stderr).includes(`/data/user/0/${pkg}/saves`)
      && /No such file or directory/.test(String(listing.stderr))) return [];
    assert.equal(listing.status, 0, String(listing.stderr));
    const files = listing.stdout.trim().split(/\r?\n/)
      .filter(f => /\/saves\/[^/]+\/(slot|auto|quick)-\d\d\.json$/.test(f));
    const values = files.map((remote, n) => {
      assert(remote.startsWith(`/data/user/0/${pkg}/saves/`) && !remote.includes(".."));
      const bytes = cmd(["exec-out", "cat", remote], true).stdout;
      const file = path.join(out, `${label}-save-${n}.json`); fs.writeFileSync(file, bytes, { flag: "wx" });
      return { remote, ...fileEvidence(file), value: JSON.parse(bytes.toString("utf8")) };
    });
    return values;
  };
  try {
    save();
    const token = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
    { windowsHide: true, encoding: "utf8" });
    assert.equal(token.stdout.trim().toLowerCase(), "true"); r.isElevated = true;
    const probe = read(path.join(out, "acceptance-permission.json"));
    assert(probe.isElevated && probe.success); r.symlinkProbe = probe;
    for (const port of [q.adbPort, q.cdpPort]) await new Promise((resolve, reject) => {
      const server = require("node:net").createServer(); server.once("error", reject);
      server.listen(port, "127.0.0.1", () => server.close(resolve));
    });
    cmd(["start-server"]); ownedAdb = true;
    await wait(() => cmd(["get-state"], false, true).stdout?.trim() === "device", "owned cold emulator");
    r.coldBoot = verifyColdBoot(read(path.join(out, "cold-boot.json")),
      text(["shell", "cat", "/proc/sys/kernel/random/boot_id"]), r.startedAt);
    assert.equal(r.coldBoot.status, "PASS");
    assert(!/package:/.test(cmd(["shell", "pm", "path", pkg], false, true).stdout), "Existing package must be preserved");
    const rootResult = text(["shell", "id", "-u"]) === "0"
      ? { status: 0, stdout: "already running as root; verified uid=0", stderr: "" }
      : cmd(["root"], false, true);
    r.adbRoot = { status: rootResult.status, stdout: rootResult.stdout, stderr: rootResult.stderr };
    r.rootTransport = await require("./lib/android-adb-root-recovery.cjs").recoverOwnedRootTransport(rootResult,
      async () => { assert(ownedAdb); cmd(["kill-server"]); cmd(["start-server"]); },
      async () => {
        await wait(() => cmd(["get-state"], false, true).stdout?.trim() === "device", "same owned emulator after root");
        assert.equal(text(["shell", "cat", "/proc/sys/kernel/random/boot_id"]), r.coldBoot.observedBootId);
        await wait(() => cmd(["shell", "id", "-u"], false, true).stdout?.trim() === "0",
          "owned userdebug emulator read-only save inspection");
      });
    [q.oldApk, q.apk].forEach((source, n) => {
      fs.copyFileSync(source.path, staged[n], fs.constants.COPYFILE_EXCL);
      assert.equal(fileEvidence(staged[n]).sha256, source.sha256);
    });
    cmd(["logcat", "-c"]);
    let first, second, pref, baseline;
    await step("Install retained real old APK; create preferences and manual save by touch", async () => {
      preservationWindow = true; installed = true; assert.match(text(["install", staged[0]]), /Success/);
      cmd(["shell", "monkey", "-p", pkg, "1"]); await connect(); await screenshot("old-title");
      await tap('[data-testid="open-settings"]', "old title settings"); await idle();
      const control = 'input[aria-label="High contrast text"]';
      await wait(() => client.evaluate(`Boolean(document.querySelector(${JSON.stringify(control)}))`), "actual old settings mounted");
      assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(control)})?.checked`), false);
      await tap(control, "old preference high contrast");
      await wait(() => client.evaluate(`document.querySelector(${JSON.stringify(control)})?.checked===true`), "old preference updated");
      await tap('[data-testid="settings-finish"]', "old settings finish"); await idle();
      pref = await settings(); assert.equal(Object.keys(pref).length, 1); assert.equal(Object.values(pref)[0].highContrastText, true);
      await tap('[data-testid="start-new-game"]', "old start"); first = await position(0);
      assert.equal(first.command, 0); assert(first.text.startsWith("QA_ANDROID_0："));
      await expand(); await tap('[data-ui-component-id="quick_save_load_button"]', "old open saves"); await idle();
      await tap('[data-testid="save-slot-manual-1"] .save-card-main', "old create manual save");
      await wait(() => client.evaluate(`document.querySelector('[data-testid="save-slot-manual-1"]')?.classList.contains('has-save')`), "old manual persisted");
      await screenshot("old-manual-created");
      await tap('[data-testid="back-to-player"]', "old return player");
      if (await client.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded')==='true'`))
        await tap('[data-testid="quick-menu-toggle"]', "old collapse menu");
      await tap(".dialog-box", "old advance command"); second = await position(1);
      assert.equal(second.command, 1); assert(second.text.startsWith("QA_ANDROID_1："));
      return { first, second, pref };
    });
    await step("Snapshot UI-created old saves; keep independently observed old exit failure", async () => {
      if (q.autoSaveSampleStrategy === "background-resume") {
        cmd(["shell", "input", "keyevent", "KEYCODE_HOME"]);
        await wait(() => client.evaluate("document.visibilityState==='hidden'"), "actual old activity backgrounded");
        cmd(["shell", "monkey", "-p", pkg, "1"]);
        await wait(() => client.evaluate("document.visibilityState==='visible'"), "actual old activity resumed");
        await wait(() => {
          const files = text(["shell", "find", `/data/user/0/${pkg}/saves`, "-type", "f"]);
          return /\/auto-\d\d\.json(?:\r?\n|$)/.test(files);
        }, "real old background-resume automatic save bytes");
        r.oldAutoSampleRoute = "ACTUAL_ANDROID_HOME_AND_ACTIVITY_RESUME_NOT_NORMAL_EXIT";
      }
      baseline = diskSaves("before-upgrade");
      assert(baseline.some(s => s.value.save_kind === "manual"));
      assert(!baseline.some(s => s.value.save_kind === "quick"));
      const exitReport = read(path.join(path.dirname(path.dirname(out)), "device-upgrade-12-05/runtime/upgrade-runtime-report.json"));
      assert.equal(exitReport.status, "FAILED");
      assert.match(exitReport.error, /Timed out: old actual process exit/);
      r.oldExitObservation = { status: "FAILED", source: fileEvidence(path.join(
        path.dirname(path.dirname(out)), "device-upgrade-12-05/runtime/upgrade-runtime-report.json")),
        scope: "Real old 0.1.0 APK exit confirmation remained pending for 60s, not a current APK finding" };
      r.oldAutoCreation = baseline.some(s => s.value.save_kind === "auto")
        ? "PRESENT_REAL_OLD_SAVE" : "BLOCKED_OLD_EXIT_PENDING_NO_AUTO_SAMPLE";
      cmd(["shell", "am", "force-stop", pkg]); client?.close(); client = null;
      return { baseline, oldAutoCreation: r.oldAutoCreation, normalExitClaimed: false };
    });
    await step("Real install -r without uninstall/clear; exact old save bytes and preferences survive", async () => {
      assert.match(text(["install", "-r", staged[1]]), /Success/);
      const installedVersion = text(["shell", "dumpsys", "package", pkg]);
      assert.match(installedVersion, /versionCode=1001\b/); assert.match(installedVersion, /versionName=0\.1\.1\b/);
      const after = diskSaves("after-upgrade");
      assert.deepEqual(after.map(s => ({ remote: s.remote, sha256: s.sha256 })).sort((a,b)=>a.remote.localeCompare(b.remote)),
        baseline.map(s=>({remote:s.remote,sha256:s.sha256})).sort((a,b)=>a.remote.localeCompare(b.remote)));
      cmd(["shell", "monkey", "-p", pkg, "1"]); await connect(); await screenshot("new-title");
      assert.deepEqual(await settings(), pref);
      return { after, installedVersion };
    });
    await step("Actual available old saves load old snapshots, next advance consumes new script", async () => {
      await tap('[data-testid="open-save-load"]', "new open old saves"); await idle();
      await tap(".save-mode-switch button:nth-child(2)", "new read mode");
      for (const [kind, expected, next] of [["manual", first, 1], ["auto", second, 2]]) {
        if (!baseline.some(s => s.value.save_kind === kind)) continue;
        if (kind === "auto") await tap(".save-kind-tabs button:nth-child(2)", "select old automatic saves");
        const slot = baseline.find(s => s.value.save_kind === kind).value.slot;
        await tap(`[data-testid="save-slot-${kind}-${slot}"] .save-card-main`, `new load old ${kind}`);
        const loaded = await position(expected.command); assert.deepEqual(loaded, expected);
        if (await client.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded')==='true'`))
          await tap('[data-testid="quick-menu-toggle"]', "collapse before advancing loaded save");
        await tap(".dialog-box", `new advance loaded ${kind}`);
        const advanced = await position(next); assert.equal(advanced.command, next);
        assert(advanced.text.startsWith(`QA_ANDROID_UPGRADE_NEW_${next}：`));
        await screenshot(`new-loaded-${kind}`);
        if (kind === "manual" && baseline.some(s => s.value.save_kind === "auto")) {
          await expand(); await tap('[data-ui-component-id="quick_save_load_button"]', "reopen for auto load"); await idle();
        }
      }
      assert.deepEqual(await settings(), pref); preservationWindow = false;
      return { oldKinds: [...new Set(baseline.map(s => s.value.save_kind))], snapshotAndNewScript: true, preferences: pref };
    });
    await step("Three retained-data restarts preserve old saves and preferences", async () => {
      for (let n = 1; n <= 3; n++) {
        cmd(["shell", "am", "force-stop", pkg]); cmd(["shell", "monkey", "-p", pkg, "1"]);
        await connect(); assert.deepEqual(await settings(), pref);
        const actual = diskSaves("retained-" + n);
        for (const old of baseline) assert(actual.some(s => s.remote === old.remote && s.sha256 === old.sha256));
        const shot = await screenshot("retained-title-" + n);
        r.restartTrials.push({ kind: "retained-data", n, screenshot: shot.path, status: "PASS" }); save();
      }
      return { trials: 3 };
    });
    await step("Three clean starts of this same new APK after upgrade proof", async () => {
      for (let n = 1; n <= 3; n++) {
        client?.close(); client = null; assert.match(text(["uninstall", pkg]), /Success/);
        assert.match(text(["install", staged[1]]), /Success/);
        cmd(["shell", "monkey", "-p", pkg, "1"]); await connect();
        const shot = await screenshot("clean-title-" + n);
        assert(Object.values(await settings()).every(s => s.highContrastText === false));
        assert.equal(diskSaves("clean-" + n).length, 0);
        r.restartTrials.push({ kind: "clean-install", n, screenshot: shot.path, status: "PASS" }); save();
      }
      return { trials: 3, cleanOperationsOnlyAfterUpgradeVerified: true };
    });
    const logs = text(["logcat", "-d", "-v", "threadtime"]);
    fs.writeFileSync(path.join(out, "logcat.txt"), logs);
    r.logs = scopedRuntimeLog(logs, pkg, r.pids); assert.deepEqual(r.logs.fatal, []);
    // Unknown renderer warnings remain unreviewed; no blanket historical allowlist.
    r.rendererWarningsStatus = r.logs.warnings.length ? "BLOCKED_REQUIRES_CURRENT_VERSION_REVIEW" : "PASS";
    r.status = r.logs.warnings.length ? "BLOCKED" : "PARTIAL_PASS";
  } catch (e) {
    r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1;
    if (client) {
      try {
        r.failurePage = await client.evaluate(`({text:document.body.innerText,transition:document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition,
          viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}})`);
        await screenshot("failure-state");
      } catch (captureError) { r.failureCaptureError = String(captureError); }
    }
  }
  finally {
    cleanup = true; client?.close();
    const cleanupErrors = [];
    try {
      if (installed && !r.logs) {
        const log = cmd(["logcat", "-d", "-v", "threadtime"], false, true);
        fs.writeFileSync(path.join(out, "failure-logcat.txt"), log.stdout || log.stderr || "");
        r.logs = scopedRuntimeLog(log.stdout || "", pkg, r.pids);
      }
    } catch (e) { cleanupErrors.push("logcat: " + String(e)); }
    try {
      if (installed) {
        const result = cmd(["uninstall", pkg], false, true);
        assert(result.status === 0 && /Success/.test(result.stdout) ||
          /Unknown package/.test(String(result.stdout) + String(result.stderr)), String(result.stderr || result.stdout));
      }
      r.uninstallStatus = installed ? "PASS" : "NOT_INSTALLED";
    } catch (e) { r.uninstallStatus = "FAILED"; cleanupErrors.push("uninstall: " + String(e)); }
    try { if (forwarded) cmd(["forward", "--remove", `tcp:${q.cdpPort}`]); }
    catch (e) { cleanupErrors.push("forward: " + String(e)); }
    let stagingClean = true;
    for (const file of staged) {
      try {
        assert.equal(path.dirname(file), out);
        assert(![q.apk.path, q.oldApk.path].includes(file));
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (e) { stagingClean = false; cleanupErrors.push("staging: " + String(e)); }
    }
    r.apkCleanupStatus = stagingClean && staged.every(f => !fs.existsSync(f)) ? "PASS" : "FAILED";
    try {
      assert.equal(fileEvidence(q.apk.path).sha256, q.apk.sha256);
      assert.equal(fileEvidence(q.oldApk.path).sha256, q.oldApk.sha256);
    } catch (e) { cleanupErrors.push("source: " + String(e)); }
    if (ownedAdb) {
      const stopped = spawnSync(adb, ["-P", String(q.adbPort), "kill-server"], { windowsHide: true, timeout: 10000 });
      r.adbCleanupStatus = stopped.status === 0 ? "PASS" : "FAILED";
      if (stopped.status !== 0) { r.status = "FAILED"; process.exitCode = 1; }
    }
    if (cleanupErrors.length) { r.cleanupError = cleanupErrors.join("\n"); r.status = "FAILED"; process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, reportFile, cases: r.cases.map(c=>({name:c.name,status:c.status})), error:r.error }));
  }
}
if (require.main === module) main(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { validateRequest, assertPreservedUpgradeData, runningPackagePid };
