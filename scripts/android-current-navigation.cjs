"use strict";
// QA only. Actual ADB input; CDP observes the installed APK, never writes its store.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { fileEvidence, verifyColdBoot } = require("./android-acceptance-evidence.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const { runningPackagePid } = require("./android-native-upgrade-device.cjs");
const { visibleControlRect } = require("./visible-control-geometry.cjs");
const { observeAndroidExit } = require("./lib/android-exit-observer.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const pkg = "com.agentvn.qa.androidcurrent20261021";
function validateNavigationRequest(q) {
  assert.equal(q.scope, "installed-current-navigation"); assert.equal(q.package, pkg);
  assert.equal(q.serial, "emulator-5554"); assert.equal(q.coldBoot?.avd, "AgentVN_API35");
  assert.equal(q.sdk, "D:\\Android_dev\\Sdk");
  assert(q.exitProbe === undefined || q.exitProbe === "no-game-autosave-disabled");
  assert(q.traceExitBoundary === undefined || (q.traceExitBoundary === true && Boolean(q.exitProbe)),
    "Boundary observation is allowed only on the explicit no-game exit diagnostic");
  assert.equal(path.resolve(q.outputDir), q.outputDir);
  assert.match(q.outputDir, /^F:\\AgentVN\\QA\\Android-Package-20261021-01\\device-navigation-12-\d{2}\\runtime$/);
  const ports = [q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort];
  assert.equal(new Set(ports).size, 4);
  assert(ports.every(p => Number.isInteger(p) && p > 1024 && p <= 65535));
  assert.equal(fileEvidence(q.apk.path).sha256, q.apk.sha256);
  assert.equal(q.apk.sha256, "118f2efe1ffedd860d444e704e23904e1295559f5a0d6d8bf8eb61a46511a8e0");
  const audit = read(q.packageAudit.path);
  assert.equal(fileEvidence(q.packageAudit.path).sha256, q.packageAudit.sha256);
  assert.equal(audit.status, "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN");
  assert.equal(audit.upgradePair.currentApk.sha256, q.apk.sha256);
  assert.equal(audit.publishingWorkflow.normalCloseStatus, "FAILED");
}
class Client {
  constructor(socket) {
    this.socket = socket; this.seq = 0; this.pending = new Map(); this.events = new Map();
    socket.onmessage = event => {
      const m = JSON.parse(event.data), cb = this.pending.get(m.id);
      if (cb) { this.pending.delete(m.id); cb(m); }
      else if (m.method) for (const listener of this.events.get(m.method) || []) listener(m.params);
    };
  }
  on(event, listener) {
    if (!this.events.has(event)) this.events.set(event, new Set());
    this.events.get(event).add(listener);
  }
  off(event, listener) { this.events.get(event)?.delete(listener); }
  send(method, params) { return this.call(method, params); }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error("CDP timeout: " + method)); }, 15000);
      this.pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    assert(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result?.value;
  }
  close() { this.socket.close(); }
}
async function main(requestFile) {
  const q = read(requestFile); validateNavigationRequest(q);
  const out = q.outputDir, adb = path.join(q.sdk, "platform-tools/adb.exe");
  const reportFile = path.join(out, "navigation-report.json"), staging = path.join(out, "staging.apk");
  assert(!fs.existsSync(reportFile)); assert(!fs.existsSync(staging));
  const r = { status: "RUNNING", scope: q.scope, startedAt: new Date().toISOString(),
    sourceApk: q.apk, cases: [], commands: [], touches: [], screenshots: [], pids: [],
    modelRequests: 0, productChanges: 0, uninstallStatus: "NOT_RUN", apkCleanupStatus: "NOT_RUN", cleanupError: null };
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
  let ownedAdb = false, installed = false, forwarded = false, client, observer, rotationChanged = false, sensorChanged = false;
  const cmd = (args, binary = false, allowFailure = false) => {
    const value = spawnSync(adb, ["-P", String(q.adbPort), "-s", q.serial, ...args],
      { windowsHide: true, encoding: binary ? null : "utf8", timeout: 120000, maxBuffer: 40 * 1024 ** 2 });
    r.commands.push({ at: new Date().toISOString(), args, status: value.status,
      ...(binary ? {} : { stdout: value.stdout, stderr: value.stderr }) });
    if (!allowFailure) assert.equal(value.status, 0, String(value.stderr || value.error || value.stdout));
    return value;
  };
  const text = args => cmd(args).stdout.trim();
  const wait = async (fn, label, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 200)); }
    throw Error("Timed out: " + label);
  };
  const evalWait = (expression, label) => wait(() => client.evaluate(expression), label);
  const idle = () => evalWait(`document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition==='idle'
    && !document.querySelector('.boot-overlay,.game-launch-blackout')`, "actual navigation idle");
  const shot = async label => {
    const expression = `({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
      angle:screen.orientation.angle,hidden:document.querySelector('.story-interface')?.dataset.hidden,
      focus:document.activeElement?.outerHTML?.slice(0,400)})`;
    const before = await client.evaluate(expression);
    const bytes = cmd(["exec-out", "screencap", "-p"], true).stdout;
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    const physical = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    assert(physical.width > physical.height);
    const after = await client.evaluate(expression); assert.deepEqual(before, after);
    r.physical = physical;
    const file = path.join(out, label + ".png"); fs.writeFileSync(file, bytes, { flag: "wx" });
    const value = { ...fileEvidence(file), before, after, physical }; r.screenshots.push(value);
    const remote = `/sdcard/agentvn-navigation-${q.runId}.xml`;
    try {
      text(["shell", "uiautomator", "dump", remote]);
      const xml = text(["exec-out", "cat", remote]); assert(xml.includes("<hierarchy") && xml.includes(pkg));
      const tree = path.join(out, label + ".xml"); fs.writeFileSync(tree, xml, { flag: "wx" });
      value.uiautomator = fileEvidence(tree);
    } finally { cmd(["shell", "rm", "-f", remote]); }
    return value;
  };
  const tap = async (selector, label) => {
    await idle();
    const hit = await wait(() => client.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});
      if(!e||e.disabled||e.closest('[inert],[aria-hidden="true"]'))return null;
      const b=(${visibleControlRect.toString()})(e);if(b.width<1||b.height<1)return null;
      for(const [u,v] of [[.5,.5],[.25,.25],[.75,.75]]){const x=b.x+b.width*u,y=b.y+b.height*v,t=document.elementFromPoint(x,y);
        if(x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&(e===t||e.contains(t))
          &&(!t?.closest('button,input,a')||t.closest('button,input,a')===e))
          return{x,y,width:innerWidth,height:innerHeight,rect:b};}return null;})()`), label + ": actual hit target");
    const x = Math.round(hit.x * r.physical.width / hit.width), y = Math.round(hit.y * r.physical.height / hit.height);
    cmd(["shell", "input", "tap", String(x), String(y)]); r.touches.push({ selector, label, x, y, hit });
    await client.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
  };
  const back = async label => {
    cmd(["shell", "input", "keyevent", "KEYCODE_BACK"]); r.touches.push({ label, key: "KEYCODE_BACK" });
    await client.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
    await idle();
  };
  const step = async (name, fn) => {
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; r.cases.push(c); save();
    try { c.evidence = await fn(); c.status = "PASS"; }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  };
  const position = async () => {
    await evalWait(`document.querySelector('.dialog-box')?.dataset.dialogPageDone==='true'`, "revealed authored dialogue");
    return client.evaluate(`({scene:document.querySelector('.story-player')?.dataset.currentSceneId,
      command:document.querySelector('.story-player')?.dataset.currentCommandIndex,text:document.querySelector('.dialog-text')?.textContent})`);
  };
  const expand = async () => {
    if (await client.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded')!=='true'`))
      await tap('[data-testid="quick-menu-toggle"]', "expand current quick menu");
    await evalWait(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded')==='true'
      && [...document.querySelectorAll('.playback-controls')].every(e=>e.getAnimations({subtree:true}).every(a=>a.playState==='finished'))`,
    "menu expansion complete");
  };
  try {
    save();
    const token = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
      { encoding: "utf8", windowsHide: true });
    assert.equal(token.stdout.trim().toLowerCase(), "true"); r.isElevated = true;
    r.symlinkProbe = read(path.join(out, "acceptance-permission.json")); assert(r.symlinkProbe.isElevated && r.symlinkProbe.success);
    cmd(["start-server"]); ownedAdb = true;
    r.coldBoot = verifyColdBoot(read(path.join(out, "cold-boot.json")),
      text(["shell", "cat", "/proc/sys/kernel/random/boot_id"]), r.startedAt); assert.equal(r.coldBoot.status, "PASS");
    assert(!/package:/.test(cmd(["shell", "pm", "path", pkg], false, true).stdout), "Never replace an existing device package");
    fs.copyFileSync(q.apk.path, staging, fs.constants.COPYFILE_EXCL);
    assert.equal(fileEvidence(staging).sha256, q.apk.sha256); cmd(["logcat", "-c"]);
    installed = true; assert.match(text(["install", staging]), /Success/);
    text(["shell", "monkey", "-p", pkg, "1"]);
    const pid = await wait(() => runningPackagePid(cmd(["shell", "pidof", pkg], false, true)), "current package running");
    r.pids.push(pid);
    cmd(["forward", "--no-rebind", `tcp:${q.cdpPort}`, `localabstract:webview_devtools_remote_${pid}`]); forwarded = true;
    const tab = await wait(async () => {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${q.cdpPort}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
        return pages.find(p => p.type === "page" && p.url && p.url !== "about:blank");
      } catch (e) { if (!/fetch|abort|timeout|JSON/i.test(String(e))) throw e; }
    }, "actual current WebView");
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("WebSocket open timeout")), 15000);
      socket.onopen = () => { clearTimeout(timer); resolve(); }; socket.onerror = reject;
    }); client = new Client(socket);
    await evalWait(`Boolean(document.querySelector('[data-testid="start-new-game"]'))`, "actual title"); await idle(); await shot("title");
    if (q.traceExitBoundary) {
      observer = await observeAndroidExit(client);
      r.exitObserver = await observer.snapshot();
      assert.equal(r.exitObserver.pauses, 0); save();
    }
    if (q.exitProbe) {
      await step("Title exit without gameplay after real UI disables autosave", async () => {
        await tap('[data-testid="open-settings"]', "root probe settings");
        await evalWait(`Boolean(document.querySelector('.settings-screen'))`, "root probe settings mounted");
        await tap(".settings-tabs button:nth-child(5)", "root probe system category");
        await evalWait(`Boolean(document.querySelector('input[aria-label="自动存档"]'))`, "root probe autosave setting");
        assert.equal(await client.evaluate(`document.querySelector('input[aria-label="自动存档"]').checked`), true);
        await tap('input[aria-label="自动存档"]', "disable autosave by actual UI");
        await evalWait(`document.querySelector('input[aria-label="自动存档"]').checked===false`, "autosave disabled");
        await shot("autosave-disabled");
        await back("settings to untouched title");
        await evalWait(`Boolean(document.querySelector('[data-testid="start-new-game"]'))`, "untouched title");
        assert.equal(await client.evaluate(`Boolean(document.querySelector('.story-player'))`), false);
        await back("root probe open exit confirmation");
        await evalWait(`Boolean(document.querySelector('[data-testid="confirm-exit-game"]'))`, "root probe exit modal");
        assert.match(await client.evaluate("document.body.innerText"), /自动保存已关闭/);
        r.exitProbe = { mode: q.exitProbe, gameplayStarted: false, autosaveDisabledThroughUI: true };
        await shot("root-probe-exit-confirmation"); save();
        await tap('[data-testid="confirm-exit-game"]', "root probe confirm exit once");
        await wait(() => runningPackagePid(cmd(["shell", "pidof", pkg], false, true)) === null,
          "untouched title native exit with autosave disabled", 60000);
        return { ...r.exitProbe, exitedWithoutForceStop: true, confirmationClicks: 1 };
      });
    } else {
    await step("Root BACK opens confirmation; BACK dismisses only top modal; child BACK returns title", async () => {
      await back("title BACK");
      await evalWait(`Boolean(document.querySelector('[data-testid="confirm-exit-game"]'))`, "root confirmation");
      assert(await client.evaluate(`Boolean(document.activeElement?.closest('[data-runtime-modal="true"]'))`));
      await shot("root-exit-confirmation"); await back("dismiss root confirmation");
      await evalWait(`!document.querySelector('[data-runtime-modal="true"]')
        && Boolean(document.querySelector('[data-testid="start-new-game"]'))`, "title retained");
      await tap('[data-testid="open-about"]', "title about");
      await evalWait(`Boolean(document.querySelector('[data-testid="about-screen"][data-runtime-screen="about"]'))`, "about mounted");
      await back("about BACK");
      await evalWait(`Boolean(document.querySelector('[data-testid="start-new-game"]'))
        && !document.querySelector('[data-runtime-modal="true"]')`, "about returns title without exit");
      return { rootConfirm: true, topModalOnly: true, childReturnsTitle: true };
    });
    let first;
    await step("Hide restores by touch or system BACK without consuming a dialogue advance", async () => {
      await tap('[data-testid="start-new-game"]', "start current game"); await idle(); first = await position();
      assert(first.text.startsWith("QA_ANDROID_UPGRADE_NEW_0："));
      for (const method of ["touch", "back"]) {
        await expand(); await tap('[data-ui-component-id="quick_hide_ui_button"]', "hide UI: " + method);
        await evalWait(`document.querySelector('.story-interface')?.dataset.hidden==='true'
          && document.querySelector('.story-interface')?.inert===true`, "hidden and inert");
        await shot("hidden-" + method);
        if (method === "touch") await tap(".story-player", "restore only by touch");
        else await back("restore only by system BACK");
        await evalWait(`document.querySelector('.story-interface')?.dataset.hidden==='false'
          && document.querySelector('.story-interface')?.inert===false`, "interface restored");
        assert.deepEqual(await position(), first);
        assert.equal(await client.evaluate(`Boolean(document.querySelector('[data-testid="continue-game"]'))`), false);
      }
      await shot("restored-without-advance"); return { position: first, restores: ["touch", "system BACK"] };
    });
    await step("Actual reverse landscape and return preserve dialogue; all eight menu controls stay reachable", async () => {
      const before = await client.evaluate("({angle:screen.orientation.angle,width:innerWidth,height:innerHeight})");
      const target = before.angle === 270 ? 1 : 3, initial = before.angle === 270 ? 3 : 1;
      r.rotationBefore = text(["shell", "cmd", "window", "user-rotation"]);
      assert(/^(free|lock [0-3])$/.test(r.rotationBefore), "Unrecognized rotation policy; preserve it without changing");
      r.sensorBefore = text(["emu", "sensor", "get", "acceleration"])
        .match(/acceleration\s*=\s*(-?[\d.]+:-?[\d.]+:-?[\d.]+)/)?.[1];
      assert(r.sensorBefore, "Sensor baseline is required before rotating sensorLandscape activity");
      rotationChanged = true; const samples = [];
      for (const rotation of [target, initial]) {
        text(["shell", "cmd", "window", "user-rotation", "lock", String(rotation)]);
        sensorChanged = true;
        text(["emu", "sensor", "set", "acceleration", rotation === 3 ? "-9.81:0:0" : "9.81:0:0"]);
        await evalWait(`screen.orientation.angle===${rotation * 90} && innerWidth>innerHeight`, "actual display angle " + rotation * 90);
        assert.deepEqual(await position(), first); await expand();
        const controls = await client.evaluate(`[...document.querySelectorAll('.playback-controls button')].map(e=>{
          const b=(${visibleControlRect.toString()})(e),x=b.x+b.width/2,y=b.y+b.height/2,t=document.elementFromPoint(x,y);
          return {component:e.dataset.uiComponentId||e.dataset.testid,disabled:e.disabled,
            visible:b.width>0&&b.height>0&&b.x>=-1&&b.y>=-1&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1,
            hit:t===e||e.contains(t)};})`);
        assert.equal(controls.length, 8); assert(controls.every(c => c.visible && c.hit));
        samples.push({ rotation, controls, shot: await shot("rotation-" + rotation),
          windowDisplay: text(["shell", "dumpsys", "window", "displays"]) });
      }
      return { before, samples };
    });
    await step("Playing BACK opens menu; child and menu BACK return one level without losing position", async () => {
      await back("playing to game menu");
      await evalWait(`Boolean(document.querySelector('[data-testid="continue-game"]'))`, "game menu");
      await tap('[data-testid="open-settings"]', "game menu settings");
      await evalWait(`Boolean(document.querySelector('.settings-screen'))`, "settings mounted");
      await back("settings to game menu");
      await evalWait(`Boolean(document.querySelector('[data-testid="continue-game"]'))`, "game menu after child back");
      await back("game menu to playing");
      await evalWait(`Boolean(document.querySelector('.story-player'))`, "resumed player");
      assert.deepEqual(await position(), first); await shot("back-to-playing");
      return { position: first, menuThenChildThenMenuThenPlayer: true };
    });
    await step("Current APK actual exit confirmation waits for completion and closes native process", async () => {
      await back("playing to menu for explicit exit");
      await evalWait(`Boolean(document.querySelector('[data-testid="continue-game"]'))`, "menu before exit");
      await tap('[data-testid="open-settings"]', "settings exit link");
      await evalWait(`Boolean(document.querySelector('.settings-screen'))`, "settings before exit");
      await tap('[data-testid="open-exit-confirmation"]', "current explicit exit");
      await evalWait(`Boolean(document.querySelector('[data-testid="confirm-exit-game"]'))`, "current exit confirmation");
      await shot("current-exit-confirmation");
      await tap('[data-testid="confirm-exit-game"]', "confirm current exit once");
      await wait(() => runningPackagePid(cmd(["shell", "pidof", pkg], false, true)) === null, "current native process exit", 60000);
      return { exitedWithoutForceStop: true, confirmationClicks: 1 };
    });
    }
    const logs = text(["logcat", "-d", "-v", "threadtime"]); fs.writeFileSync(path.join(out, "logcat.txt"), logs);
    r.logs = scopedRuntimeLog(logs, pkg, r.pids); assert.deepEqual(r.logs.fatal, []);
    r.status = r.logs.warnings.length ? "BLOCKED_RENDERER_REVIEW" : "PASS_LIMITED_AGENTVN_NAVIGATION";
  } catch (e) {
    r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1;
    if (client) try {
      r.failurePage = await client.evaluate(`({text:document.body.innerText,hidden:document.querySelector('.story-interface')?.dataset.hidden,
        transition:document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition})`);
      await shot("failure-state");
    } catch (captureError) { r.failureCaptureError = String(captureError); }
  } finally {
    if (observer) {
      try {
        const trace = await observer.snapshot();
        const traceFile = path.join(out, "exit-boundary-trace.json");
        fs.writeFileSync(traceFile, JSON.stringify(trace, null, 2), { flag: "wx" });
        r.exitTrace = fileEvidence(traceFile);
      } catch (e) { r.exitTraceError = String(e); }
      try { r.exitObserverCleanup = await observer.stop(); }
      catch (e) { r.exitObserverCleanupError = String(e); }
    }
    client?.close(); const errors = [];
    const clean = (label, action) => { try { action(); } catch (e) { errors.push(label + ": " + String(e)); } };
    clean("logcat", () => {
      if (!r.logs && installed) {
        const logs = text(["logcat", "-d", "-v", "threadtime"]); fs.writeFileSync(path.join(out, "failure-logcat.txt"), logs);
        r.logs = scopedRuntimeLog(logs, pkg, r.pids);
      }
    });
    clean("rotation", () => {
      if (sensorChanged) {
        text(["emu", "sensor", "set", "acceleration", r.sensorBefore]);
        const actual = text(["emu", "sensor", "get", "acceleration"])
          .match(/acceleration\s*=\s*(-?[\d.]+:-?[\d.]+:-?[\d.]+)/)?.[1];
        assert(actual && actual.split(":").every((v, n) => Math.abs(Number(v) - Number(r.sensorBefore.split(":")[n])) < 0.01));
        r.sensorRestoreStatus = "PASS";
      }
      if (rotationChanged) {
        text(["shell", "cmd", "window", "user-rotation", ...r.rotationBefore.split(" ")]);
        assert.equal(text(["shell", "cmd", "window", "user-rotation"]), r.rotationBefore);
      }
      r.rotationRestoreStatus = rotationChanged ? "PASS_EXACT_POLICY_RESTORED" : "NOT_CHANGED";
    });
    clean("uninstall", () => { if (installed) assert.match(text(["uninstall", pkg]), /Success/); r.uninstallStatus = installed ? "PASS" : "NOT_INSTALLED"; });
    clean("forward", () => { if (forwarded) text(["forward", "--remove", `tcp:${q.cdpPort}`]); });
    clean("staging", () => {
      assert.equal(path.dirname(staging), out); assert.notEqual(staging, q.apk.path);
      if (fs.existsSync(staging)) fs.unlinkSync(staging);
      assert(!fs.existsSync(staging)); r.apkCleanupStatus = "PASS";
      assert.equal(fileEvidence(q.apk.path).sha256, q.apk.sha256);
    });
    clean("adb", () => { if (ownedAdb) text(["kill-server"]); r.adbCleanupStatus = ownedAdb ? "PASS" : "NOT_STARTED"; });
    if (errors.length) { r.cleanupError = errors.join("\n"); r.status = "FAILED"; process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, reportFile, cases: r.cases.map(c => ({ name: c.name, status: c.status })), error: r.error }));
  }
}
if (require.main === module) main(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { validateNavigationRequest };
