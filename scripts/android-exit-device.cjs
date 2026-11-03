"use strict";
// No store writes, native-command interception, or simulated native IO.
// Optional bounded native debugger is attribution-only, under a separate scope.
// CDP reads DOM/geometry only; every product action is actual ADB input.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const { fileEvidence, verifyColdBoot, verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { allocateAndroidDevicePorts } = require("./lib/android-device-ports.cjs");
const { visibleControlRect } = require("./visible-control-geometry.cjs");
const { runningPackagePid } = require("./android-native-upgrade-device.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const { activityState, validateActivityExit } = require("./lib/android-activity-exit.cjs");
const { initializeOwnedAdb } = require("./lib/android-adb-handoff.cjs");
const base = "F:\\AgentVN\\QA\\Android-Exit-20261024-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const same = f => assert.equal(fileEvidence(f.path).sha256, f.sha256, f.path);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function sameOwnerProcess(row, origin) {
  // CIM reports microseconds; Process.StartTime can include a final 100ns digit.
  return Boolean(row && row.ProcessId === origin.helperPid
    && Number.isFinite(Date.parse(row.Created))
    && Date.parse(row.Created) === Date.parse(origin.helperCreated));
}
function transientNavigationReadError(error) {
  try {
    const value = JSON.parse(error.message);
    return value.code === -32000 && /^(?:Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id)\.?$/.test(value.message);
  } catch { return false; }
}
function paintedControl(element) {
  if (!element || element.closest("[inert],[aria-hidden='true']")) return false;
  for (let node = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || /hidden|collapse/.test(style.visibility)
      || Number(style.opacity) < 0.98) return false;
  }
  return element.getClientRects().length > 0;
}
function validateImmediateActivityReopen(exit) {
  assert.equal(exit.basis, "ACTIVITY_FINISH");
  assert.equal(exit.nextLaunchPolicy, "IMMEDIATE_ACTIVITY_REOPEN");
  assert.equal(exit.forcedBeforeExit, false); assert.equal(exit.confirmationClicks, 1);
  assert(exit.before.live.length > 0 && exit.after.closed && exit.after.live.length === 0);
  assert(exit.elapsedMs >= 0 && exit.elapsedMs < 15000);
  assert.deepEqual(exit.fatalBeforeReclaim, []);
  assert.equal(exit.reclaim, undefined);
  assert(exit.reopened.activity.live.length > 0);
  assert.match(exit.reopened.pid, /^\d+$/);
  assert(exit.reopened.commandIndex > exit.closedCommandIndex);
  assert.equal(exit.reopened.titleReady, true);
  assert.equal(exit.reopened.processRetained, exit.reopened.pid === exit.pid);
  if (exit.activityRestoration === "CACHED_RUNTIME_RECREATION") {
    assert.equal(exit.reopened.processRetained, true, "This acceptance must exercise the cached process");
    assert.equal(exit.reopened.nativeRestoreCount, 1);
    assert.match(exit.reopened.nativeRestoreLine, /Android Runtime window restored for Activity -?\d+\./);
    assert(exit.reopened.nativeLog && exit.reopened.nativeLog.path && exit.reopened.nativeLog.sha256);
    assert(exit.reopened.targetId && exit.reopened.priorTargetId);
    assert.notEqual(exit.reopened.targetId, exit.reopened.priorTargetId);
    assert(exit.reopened.liveTargetIds.includes(exit.reopened.targetId));
    assert(!exit.reopened.liveTargetIds.includes(exit.reopened.priorTargetId),
      "The old Java WebView must be gone by restored title readiness");
    assert(exit.reopened.targetSnapshot?.path && exit.reopened.targetSnapshot?.sha256);
  }
}
function validateRequest(q) {
  assert.equal(q.scope, q.lifecycleDebugger ? "SOURCE_APK_BOUNDED_NATIVE_LIFECYCLE_DIAGNOSTIC"
    : "SOURCE_APK_UNINSTRUMENTED_CONFIRMED_EXIT");
  assert.equal(q.outputDir, path.join(base, `device-${q.attempt}`, "runtime"));
  assert.match(q.attempt, /^\d{2}$/); assert.equal(q.sdk, "D:\\Android_dev\\Sdk");
  assert.equal(q.serial, "emulator-5554"); assert.equal(q.coldBoot.avd, "AgentVN_API35");
  assert.equal(q.cells.length, 2); assert.deepEqual(q.cells.map(c => c.layout), ["agentvn", "renpy"]);
  const ports = [q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort];
  assert.equal(new Set(ports).size, 4);
  assert(ports.every(p => Number.isInteger(p) && p > 1024 && p <= 65535));
  if (q.lifecycleDebugger) {
    const d = q.lifecycleDebugger;
    assert.equal(d.mode, "lifecycle-exit"); assert.equal(d.plan, "close-without-reopen");
    assert(!ports.includes(d.localPort));
    require("./lib/android-cache-debugger.cjs").debuggerConfig({
      ...d, packageName: q.cells[0].package, runId: q.runId,
    });
    const environment = read(path.join(base, `apk-build-${q.buildAttempt}`,
      "agentvn-diagnostics/android-env-check.json"));
    assert.equal(d.ndk, environment.ndkHome, "Use the actual recorded NDK, not a guessed installation");
    assert(fs.existsSync(path.join(d.ndk, "toolchains/llvm/prebuilt/windows-x86_64/bin/lldb.exe")));
  }
  assert.match(q.buildAttempt, /^\d{2}$/);
  assert.equal(path.resolve(q.build.path), path.join(base, `apk-build-${q.buildAttempt}`, "build-report.json"));
  same(q.build); const build = read(q.build.path);
  assert(build.finishedAt);
  if (q.buildAudit) {
    // Explicit independent evidence only; keep the original failed QA intact.
    assert.equal(path.resolve(q.buildAudit.path),
      path.join(base, `apk-build-audit-${q.buildAttempt}`, "report.json"));
    same(q.buildAudit); const audit = read(q.buildAudit.path);
    assert.equal(audit.status, "APKS_VERIFIED_ORIGINAL_QA_FAILURE_PRESERVED");
    assert(audit.finishedAt); assert.equal(audit.build.sha256, q.build.sha256);
    assert.equal(build.status, "FAILED"); assert.equal(audit.counts.completedApks, 2);
    assert(audit.counts.originalFilesUnchanged > 100);
    assert.equal(audit.counts.originalFilesUnchanged, audit.counts.cloneFilesChecked);
    assert.equal(audit.counts.generatedCloneDifferences, audit.differences.length);
    assert(audit.differences.length > 0); same(audit.tool);
    const { generatedAndroidOutput } = require("./android-exit-built-artifacts-audit.cjs");
    assert(audit.differences.every(f => generatedAndroidOutput(f.relative)));
  } else {
    assert.equal(build.status, "SOURCE_APKS_BUILT_DEVICE_NOT_RUN");
    assert.equal(build.sourceAndCloneRestoration, "PASS");
  }
  for (const c of q.cells) {
    const original = build.cells.find(b => b.layout === c.layout); assert(original);
    assert.equal(original.status, "PASS"); assert.equal(original.exitCode, 0);
    assert.equal(c.apk.sha256, original.apk.sha256);
    assert.equal(c.package, original.releaseIdentity.androidApplicationId);
    same(c.apk); same(c.provenance);
    assert.equal(verifyProvenance(c.apk.path, read(c.provenance.path)).status, "PASS");
  }
  q.tools.forEach(same);
}
class Client {
  constructor(socket) {
    this.socket = socket; this.seq = 0; this.pending = new Map();
    socket.onmessage = event => {
      const m = JSON.parse(event.data), p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); p(m); }
    };
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq, timer = setTimeout(() => {
        this.pending.delete(id); reject(Error("Read-only CDP timeout: " + method));
      }, 10000);
      this.pending.set(id, m => {
        clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result?.value;
  }
  close() { this.socket.close(); }
}
async function launch(attempt, buildAttempt = "02", auditedBuild = false, lifecycle = false) {
  assert.match(attempt || "", /^\d{2}$/);
  assert.match(buildAttempt, /^\d{2}$/);
  const out = path.join(base, "device-" + attempt); assert(!fs.existsSync(out));
  const buildPath = path.join(base, `apk-build-${buildAttempt}/build-report.json`), build = read(buildPath);
  const [adbPort, cdpPort, bootPort, grpcPort] = await allocateAndroidDevicePorts();
  const q = { scope: "SOURCE_APK_UNINSTRUMENTED_CONFIRMED_EXIT", attempt, buildAttempt,
    activityRestoration: "CACHED_RUNTIME_RECREATION",
    outputDir: path.join(out, "runtime"), sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554",
    runId: `android-exit-20261024-${attempt}`, adbPort, cdpPort, build: fileEvidence(buildPath),
    cells: build.cells.map(c => ({ layout: c.layout, package: c.releaseIdentity.androidApplicationId,
      apk: c.apk, provenance: c.provenance })),
    coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: bootPort,
      grpcPort, discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running", mediaVolumeTarget: 13 },
    tools: [__filename, path.join(__dirname, "android-exit-device.ps1"),
      path.join(__dirname, "android-cold-boot.ps1"), path.join(__dirname, "android-acceptance-preflight.ps1"),
      path.join(__dirname, "visible-control-geometry.cjs"),
      path.join(__dirname, "lib/android-adb-handoff.cjs"),
      path.join(__dirname, "lib/android-activity-exit.cjs"),
      path.join(__dirname, "lib/android-exit-failure-evidence.cjs")].map(fileEvidence) };
  if (lifecycle) {
    const [localPort] = await allocateAndroidDevicePorts();
    const environment = read(path.join(base, `apk-build-${buildAttempt}`,
      "agentvn-diagnostics/android-env-check.json"));
    q.scope = "SOURCE_APK_BOUNDED_NATIVE_LIFECYCLE_DIAGNOSTIC";
    q.lifecycleDebugger = { mode: "lifecycle-exit", plan: "close-without-reopen",
      ndk: environment.ndkHome, localPort, remotePort: 38471 };
    q.tools.push(...["lib/android-cache-debugger.cjs", "lib/android_cache_debugger.py"].map(
      f => fileEvidence(path.join(__dirname, f))));
  }
  if (auditedBuild) q.buildAudit = fileEvidence(path.join(base, `apk-build-audit-${buildAttempt}/report.json`));
  validateRequest(q); fs.mkdirSync(out); fs.mkdirSync(q.outputDir);
  for (const f of q.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);
  const request = path.join(out, "request.json");
  fs.writeFileSync(request, JSON.stringify(q, null, 2), { flag: "wx" });
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "android-exit-device.ps1"), "-RequestPath", request],
    { encoding: "utf8", windowsHide: true, timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
  const { rows } = require("./lib/current-native-editor-session.cjs");
  const origin = read(path.join(out, "origin.json"));
  let finished;
  const deadline = Date.now() + 30 * 60000;
  while (Date.now() < deadline) {
    const f = path.join(q.outputDir, "acceptance-launch.json");
    if (fs.existsSync(f)) {
      let r; try { r = read(f); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
      if (r?.finishedAt) { finished = r; break; }
    }
    assert(rows().some(p => sameOwnerProcess(p, origin)),
      "Original elevated helper is absent without a terminal receipt; inspect, never relaunch");
    await pause(3000);
  }
  assert(finished, "Observation deadline: inspect the same elevated owner; do not relaunch");
  assert.equal(finished.emulatorCleanupStatus, "PASS");
  const result = read(path.join(q.outputDir, "report.json"));
  assert.equal(result.cleanupError, null); assert.equal(result.adbCleanupStatus, "PASS");
  assert(result.cells.length > 0 && result.cells.every(c => c.uninstallStatus === "PASS" && c.apkCleanupStatus === "PASS"));
  q.tools.forEach(same);
  console.log(JSON.stringify({ status: result.status, out, cases: result.cases.length, exits: result.exits.length }));
  if (result.status !== (lifecycle ? "DIAGNOSTIC_OBSERVATION_COMPLETE" : "PASS_LIMITED_EXIT_AND_RESTART"))
    process.exitCode = 1;
}
async function run(requestFile) {
  const q = read(requestFile); validateRequest(q); const out = q.outputDir;
  const reportFile = path.join(out, "report.json"); assert(!fs.existsSync(reportFile));
  const adb = path.join(q.sdk, "platform-tools/adb.exe");
  const r = { status: "RUNNING", scope: q.scope, startedAt: new Date().toISOString(),
    activityRestoration: q.activityRestoration,
    modelRequests: 0, debuggerBreakpoints: 0, nativeOverrides: 0, storeWrites: 0,
    commands: [], touches: [], cases: [], cells: [], exits: [], screenshots: [], launches: [], readRetries: [], toolWarnings: [],
    ...(q.lifecycleDebugger ? { diagnosticPlan: q.lifecycleDebugger.plan, diagnostics: [],
      limitation: "Debugger changes scheduling. Attribution only; never acceptance or normal-exit PASS." } : {}),
    adbCleanupStatus: "NOT_RUN", cleanupError: null };
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
  let client, forwarded = false, ownedAdb = false, current, activeDebugger;
  async function finishDebugger() {
    if (!activeDebugger) return;
    const result = await activeDebugger.completion; activeDebugger = undefined;
    const raw = fs.readFileSync(result.rawPath, "utf8");
    r.debuggerBreakpoints += [...raw.matchAll(/^LIFECYCLE_BREAKPOINT\|[^|]+\|(\d+)/gm)]
      .reduce((sum, m) => sum + Number(m[1]), 0);
    r.diagnostics.push({ ...result, evidence: fileEvidence(result.rawPath) }); save();
    return result;
  }
  const cmd = (args, binary = false, allowed = false, timeoutMs = 120000) => {
    const startedAt = new Date().toISOString();
    const result = spawnSync(adb, ["-P", String(q.adbPort), "-s", q.serial, ...args],
      { windowsHide: true, encoding: binary ? null : "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 ** 2 });
    r.commands.push({ args, code: result.status, startedAt, at: new Date().toISOString(),
      ...(binary ? {} : { stdout: result.stdout, stderr: result.stderr }) });
    if (!allowed) assert.equal(result.status, 0, String(result.error || result.stderr || result.stdout));
    return result;
  };
  const text = args => cmd(args).stdout.trim();
  const wait = async (fn, label, timeout = 45000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { const result = await fn(); if (result) return result; }
      catch (error) {
        // Initial WebView navigation can replace the execution context after
        // connection. Retry a read only while the same native app is alive.
        if (!transientNavigationReadError(error) || client?.socket.readyState !== WebSocket.OPEN
          || !current || runningPackagePid(cmd(["shell", "pidof", current.package], false, true)) === null) throw error;
        r.readRetries.push({ label, at: new Date().toISOString(), error: String(error) }); save();
      }
      await pause(200);
    }
    throw Error("Timeout " + label);
  };
  const dom = (s, label) => wait(() => client.evaluate(s), label);
  const idle = () => dom(`document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition==='idle'
    && !document.querySelector('.boot-overlay,.game-launch-blackout')`, "actual screen transition idle");
  const back = async label => {
    text(["shell", "input", "keyevent", "KEYCODE_BACK"]); r.touches.push({ label, key: "KEYCODE_BACK" });
    await idle();
  };
  const tap = async (selector, label) => {
    const hit = await wait(() => client.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});
      if(!e||e.disabled||!(${paintedControl.toString()})(e))return null;
      const b=(${visibleControlRect.toString()})(e);if(b.width<=0||b.height<=0)return null;
      const x=b.x+b.width/2,y=b.y+b.height/2,t=document.elementFromPoint(x,y);
      return x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&(e===t||e.contains(t))
        ?{x,y,width:innerWidth,height:innerHeight,rect:b}:null;})()`), label + " hit");
    const x = Math.round(hit.x * r.physical.width / hit.width), y = Math.round(hit.y * r.physical.height / hit.height);
    text(["shell", "input", "tap", String(x), String(y)]);
    r.touches.push({ selector, label, x, y, hit }); save();
  };
  async function screenshot(label) {
    const selector = label.endsWith("-confirmation")
      ? '[data-testid="confirm-exit-game"]' : '[data-testid="start-new-game"]';
    await dom(`(${paintedControl.toString()})(document.querySelector(${JSON.stringify(selector)}))`,
      "painted control before native screenshot " + label);
    await client.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
    const sample = `({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
      reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,angle:screen.orientation.angle})`;
    const before = await client.evaluate(sample), bytes = cmd(["exec-out", "screencap", "-p"], true).stdout;
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    const after = await client.evaluate(sample); assert.deepEqual(before, after);
    r.physical = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    assert(r.physical.width > r.physical.height);
    const file = path.join(out, label + ".png"); fs.writeFileSync(file, bytes, { flag: "wx" });
    const value = { ...fileEvidence(file), before, after, physical: r.physical }; r.screenshots.push(value);
    const remote = `/sdcard/${q.runId}-${label}.xml`;
    try {
      const dump = cmd(["shell", "uiautomator", "dump", remote], false, true);
      assert([0, 137].includes(dump.status), dump.stderr || dump.stdout);
      assert(dump.stdout.includes(remote), "UIAutomator must report its actual output");
      const xml = text(["exec-out", "cat", remote]); assert(xml.includes("<hierarchy") && xml.includes(current.package));
      const hierarchy = await client.evaluate(`(() => {
        const doc=new DOMParser().parseFromString(${JSON.stringify(xml)},"application/xml");
        return {root:doc.documentElement.tagName,parseErrors:doc.querySelectorAll("parsererror").length,
          appNodes:[...doc.querySelectorAll("node")].filter(n=>n.getAttribute("package")===${JSON.stringify(current.package)}).length};
      })()`);
      assert.equal(hierarchy.root, "hierarchy"); assert.equal(hierarchy.parseErrors, 0); assert(hierarchy.appNodes > 0);
      assert.notEqual(runningPackagePid(cmd(["shell", "pidof", current.package], false, true)), null);
      const file = path.join(out, label + ".xml"); fs.writeFileSync(file, xml, { flag: "wx" });
      value.uiautomator = fileEvidence(file); value.hierarchy = hierarchy; value.uiautomatorExitCode = dump.status;
      if (dump.status !== 0) {
        // Preserve the tool anomaly for explicit review even with a valid XML.
        r.toolWarnings.push({ label, code: dump.status, message: dump.stdout, hierarchy,
          evidence: value.uiautomator });
      }
    } finally { text(["shell", "rm", "-f", remote]); }
    save();
  }
  async function connect(label) {
    assert(!client);
    const lastLaunch = r.launches.at(-1);
    const launchCommandIndex = r.commands.length;
    text(["shell", "monkey", "-p", current.package, "1"]);
    const pid = await wait(() => runningPackagePid(cmd(["shell", "pidof", current.package], false, true)), "native launch");
    current.pids.push(pid);
    const launched = { label, package: current.package, pid };
    r.launches.push(launched); save();
    text(["forward", "--no-rebind", `tcp:${q.cdpPort}`, `localabstract:webview_devtools_remote_${pid}`]); forwarded = true;
    const tab = await wait(async () => {
      try { return (await (await fetch(`http://127.0.0.1:${q.cdpPort}/json/list`,
        { signal: AbortSignal.timeout(1500) })).json()).find(p => p.type === "page" && p.url !== "about:blank"
          && !(lastLaunch?.package === current.package && lastLaunch.pid === pid && lastLaunch.targetId === p.id)); }
      catch (e) { if (!/fetch|abort|timeout|JSON/i.test(String(e))) throw e; }
    }, "actual APK WebView");
    launched.targetId = tab.id; save();
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("WebSocket open timeout")), 15000);
      socket.onopen = () => { clearTimeout(timer); resolve(); }; socket.onerror = reject;
    });
    client = new Client(socket);
    await dom(`Boolean(document.querySelector('[data-testid="start-new-game"]'))`, "title ready"); await idle();
    await screenshot(label + "-title");
    const previous = r.exits.at(-1);
    if (previous?.nextLaunchPolicy === "IMMEDIATE_ACTIVITY_REOPEN" && !previous.reopened) {
      assert.equal(label, previous.label + "-restart");
      const dump = text(["shell", "dumpsys", "activity", "activities"]);
      const file = path.join(out, label + "-activity-reopened.txt");
      fs.writeFileSync(file, dump, { flag: "wx" });
      previous.reopened = { pid, processRetained: pid === previous.pid, commandIndex: launchCommandIndex,
        activity: activityState(dump, current.package), evidence: fileEvidence(file), titleReady: true,
        targetId: tab.id, priorTargetId: lastLaunch?.targetId };
      if (q.activityRestoration === "CACHED_RUNTIME_RECREATION") {
        const targets = await (await fetch(`http://127.0.0.1:${q.cdpPort}/json/list`,
          { signal: AbortSignal.timeout(1500) })).json();
        const targetFile = path.join(out, label + "-targets-ready.json");
        fs.writeFileSync(targetFile, JSON.stringify(targets, null, 2), { flag: "wx" });
        previous.reopened.liveTargetIds = targets.filter(p => p.type === "page").map(p => p.id);
        previous.reopened.targetSnapshot = fileEvidence(targetFile);
        const prefix = `/data/user/0/${current.package}/`;
        const paths = text(["shell", "find", prefix, "-type", "f", "-name", "player-desktop.log"])
          .split(/\r?\n/).filter(Boolean);
        assert.equal(paths.length, 1, "One real native Runtime log");
        assert(paths[0].startsWith(prefix) && !paths[0].includes(".."));
        const raw = cmd(["exec-out", "cat", paths[0]], true).stdout;
        const nativeLog = path.join(out, label + "-native.log");
        fs.writeFileSync(nativeLog, raw, { flag: "wx" });
        const restored = raw.toString("utf8").split(/\r?\n/)
          .filter(line => /Android Runtime window restored for Activity -?\d+\./.test(line));
        previous.reopened.nativeRestoreCount = restored.length;
        previous.reopened.nativeRestoreLine = restored.at(-1);
        previous.reopened.nativeLog = fileEvidence(nativeLog);
      }
      validateImmediateActivityReopen(previous); save();
    }
  }
  async function disconnect() {
    client?.close(); client = undefined;
    if (forwarded) { text(["forward", "--remove", `tcp:${q.cdpPort}`]); forwarded = false; }
  }
  async function settings(auto) {
    const playing = await client.evaluate(`document.querySelector('[data-runtime-screen-transition]')
      ?.getAttribute('data-runtime-presented-screen')==='playing'`);
    if (playing) {
      await back("playing to game menu");
      await dom(`Boolean(document.querySelector('[data-testid="continue-game"]'))`, "game menu ready");
    }
    await tap('[data-testid="open-settings"]', "open actual settings"); await idle();
    await dom(`Boolean(document.querySelector('.settings-screen'))`, "settings ready");
    if (auto !== undefined) {
      await tap(".settings-tabs button:nth-child(5)", "system settings");
      await dom(`Boolean(document.querySelector('input[aria-label="自动存档"]'))`, "autosave checkbox");
      if (await client.evaluate(`document.querySelector('input[aria-label="自动存档"]').checked`) !== auto)
        await tap('input[aria-label="自动存档"]', "set autosave " + auto);
      await dom(`document.querySelector('input[aria-label="自动存档"]')?.checked===${JSON.stringify(auto)}`,
        "actual autosave checkbox state " + auto);
    }
  }
  async function exit(label, immediateReopen = false) {
    await settings();
    await tap('[data-testid="open-exit-confirmation"]', "request confirmed exit");
    await dom(`Boolean(document.querySelector('[data-testid="confirm-exit-game"]'))`, "exit modal");
    assert(await client.evaluate(`Boolean(document.activeElement?.closest('[data-runtime-modal="true"]'))`));
    await screenshot(label + "-confirmation");
    const pid = current.pids.at(-1);
    const beforeDump = text(["shell", "dumpsys", "activity", "activities"]);
    const before = activityState(beforeDump, current.package);
    assert(before.live.length > 0, "the current Activity must be present before confirmed exit");
    const beforePath = path.join(out, label + "-activity-before.txt");
    fs.writeFileSync(beforePath, beforeDump, { flag: "wx" });
    text(["shell", "log", "-p", "i", "-t", "AgentVNExitQA", label + ":before-confirm"]);
    if (q.lifecycleDebugger) {
      activeDebugger = require("./lib/android-cache-debugger.cjs").startCacheDebugger({
        ...q.lifecycleDebugger, adb, adbPort: q.adbPort, serial: q.serial,
        packageName: current.package, runId: q.runId, outputDir: out, label,
      });
      assert(await activeDebugger.attached, "Actual native breakpoints must be installed before confirmed exit");
    }
    const started = Date.now();
    await tap('[data-testid="confirm-exit-game"]', "confirm exit once");
    let afterDump, after;
    await wait(() => {
      afterDump = text(["shell", "dumpsys", "activity", "activities"]);
      after = activityState(afterDump, current.package); return after.closed;
    }, "actual Activity finish without force-stop", 15000);
    const closedCommandIndex = r.commands.length - 1, elapsedMs = Date.now() - started;
    text(["shell", "log", "-p", "i", "-t", "AgentVNExitQA", label + ":activity-finished"]);
    const afterPath = path.join(out, label + "-activity-after.txt");
    fs.writeFileSync(afterPath, afterDump, { flag: "wx" });
    const logs = text(["logcat", "-d", "-v", "threadtime"]);
    const cachedPid = runningPackagePid(cmd(["shell", "pidof", current.package], false, true));
    const record = { label, package: current.package, pid, elapsedMs, basis: "ACTIVITY_FINISH",
      activityRestoration: q.activityRestoration,
      before, after, beforeEvidence: fileEvidence(beforePath), afterEvidence: fileEvidence(afterPath),
      closedCommandIndex, cachedPid, fatalBeforeReclaim: scopedRuntimeLog(logs, current.package, current.pids).fatal,
      confirmationClicks: 1, forcedBeforeExit: false };
    r.exits.push(record); save();
    if (!q.lifecycleDebugger)
      assert.deepEqual(record.fatalBeforeReclaim, [], "crash is not a normal Activity exit");
    await disconnect();
    if (q.lifecycleDebugger) {
      record.nextLaunchPolicy = "DIAGNOSTIC_NO_REOPEN";
      const observed = await finishDebugger();
      assert.equal(observed.status, "COLLECTED", "Preserve diagnostic failure; no product PASS");
      save(); return; // No force-stop/reopen while native teardown is being observed.
    }
    if (immediateReopen) {
      record.nextLaunchPolicy = "IMMEDIATE_ACTIVITY_REOPEN";
      save(); return; // The next real launch verifies Activity recreation without force-stop.
    }
    // Separate from normal exit: force reclamation of an already-closed cached
    // process to prove the following launch restores actual files from disk.
    if (cachedPid !== null) {
      assert.equal(cachedPid, pid);
      const commandIndex = r.commands.length;
      text(["shell", "am", "force-stop", current.package]);
      await wait(() => runningPackagePid(cmd(["shell", "pidof", current.package], false, true)) === null,
        "OS reclaim simulation after verified Activity finish");
      record.reclaim = { kind: "OS_RECLAIM_SIMULATION_AFTER_ACTIVITY_FINISH",
        commandIndex, pidBefore: cachedPid, pidAfter: null };
    }
    validateActivityExit(record); save();
  }
  function disk(label) {
    const prefix = `/data/user/0/${current.package}/saves`;
    const listing = cmd(["shell", "find", prefix, "-type", "f"], false, true);
    if (listing.status !== 0 && /No such file or directory/.test(listing.stderr || "") && !listing.stdout.trim()) return [];
    assert.equal(listing.status, 0, listing.stderr);
    const files = listing.stdout.trim().split(/\r?\n/).filter(f => /\/(?:slot|auto|quick)-\d\d\.json$/.test(f));
    return files.map((remote, index) => {
      assert(remote.startsWith(prefix + "/") && !remote.includes(".."));
      const bytes = cmd(["exec-out", "cat", remote], true).stdout, file = path.join(out, `${label}-save-${index}.json`);
      fs.writeFileSync(file, bytes, { flag: "wx" });
      return { ...fileEvidence(file), remote, value: JSON.parse(bytes.toString("utf8")) };
    });
  }
  async function position() {
    await dom(`document.querySelector('.dialog-box')?.dataset.dialogPageDone==='true'`, "full current dialogue");
    return client.evaluate(`({scene:document.querySelector('.story-player')?.dataset.currentSceneId,
      command:Number(document.querySelector('.story-player')?.dataset.currentCommandIndex),
      text:document.querySelector('.dialog-text')?.textContent})`);
  }
  try {
    save();
    const token = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
      { encoding: "utf8", windowsHide: true });
    assert.equal(token.status, 0); assert.equal(token.stdout.trim().toLowerCase(), "true"); r.isElevated = true;
    r.symlinkProbe = read(path.join(out, "acceptance-permission.json"));
    assert(r.symlinkProbe.isElevated && r.symlinkProbe.success);
    r.coldBoot = await initializeOwnedAdb({
      command: (args, timeoutMs) => cmd(args, false, true, timeoutMs),
      coldBoot: read(path.join(out, "cold-boot.json")), startedAt: r.startedAt,
      onServerStarted: () => { ownedAdb = true; },
      onAttempt: attempt => { (r.initialAdbHandoff ??= []).push(attempt); save(); },
    });
    assert.equal(r.coldBoot.status, "PASS");
    const rootResult = text(["shell", "id", "-u"]) === "0"
      ? { status: 0, stdout: "already running as root; verified uid=0", stderr: "" }
      : cmd(["root"], false, true);
    r.adbRoot = rootResult;
    r.rootTransport = await require("./lib/android-adb-root-recovery.cjs").recoverOwnedRootTransport(rootResult,
      async () => { assert(ownedAdb); text(["kill-server"]); text(["start-server"]); },
      async () => {
        await wait(() => cmd(["get-state"], false, true).stdout?.trim() === "device", "same emulator root transport");
        assert.equal(text(["shell", "cat", "/proc/sys/kernel/random/boot_id"]), r.coldBoot.observedBootId);
        await wait(() => cmd(["shell", "id", "-u"], false, true).stdout?.trim() === "0", "owned root transport");
      });
    assert.equal(text(["shell", "id", "-u"]), "0");
    for (const c of (q.lifecycleDebugger ? q.cells.slice(0, 1) : q.cells)) {
      assert(!/package:/.test(cmd(["shell", "pm", "path", c.package], false, true).stdout), "Preserve any existing package");
      current = { ...c, pids: [], staging: path.join(out, c.layout + "-staging.apk"),
        uninstallStatus: "NOT_RUN", apkCleanupStatus: "NOT_RUN", installed: false };
      r.cells.push(current); save();
      try {
        fs.copyFileSync(c.apk.path, current.staging, fs.constants.COPYFILE_EXCL); same({ path: current.staging, sha256: c.apk.sha256 });
        text(["logcat", "-c"]); current.installed = true; assert.match(text(["install", current.staging]), /Success/);
        for (const mode of (q.lifecycleDebugger ? ["title_auto_off"]
          : ["title_auto_off", "playing_auto_off", "playing_auto_on"])) {
          const label = `${c.layout}-${mode}`, test = { label, status: "RUNNING" }; r.cases.push(test); save();
          await connect(label);
          await settings(mode === "playing_auto_on");
          await tap('[data-testid="settings-finish"]', "finish settings"); await idle();
          await dom(`Boolean(document.querySelector('[data-testid="start-new-game"]'))`, "return title");
          if (mode !== "title_auto_off") {
            await tap('[data-testid="start-new-game"]', "begin actual game"); await idle();
            test.before = await position(); assert(test.before.text?.length > 0 && test.before.scene);
          }
          await exit(label, !q.lifecycleDebugger && mode === "title_auto_off");
          if (q.lifecycleDebugger) { test.status = "OBSERVED_NOT_ACCEPTANCE"; save(); break; }
          test.disk = disk(label);
          if (mode === "playing_auto_on") assert(test.disk.some(f => f.value.save_kind === "auto"
            && f.value.scene_id === test.before.scene && f.value.command_index === test.before.command));
          else assert.equal(test.disk.length, 0, "disabled autosave must not create a snapshot");
          await connect(label + "-restart");
          if (mode === "playing_auto_on") {
            await tap('[data-testid="continue-game"]', "continue disk save"); await idle();
            test.restored = await position(); assert.deepEqual(test.restored, test.before);
          } else assert.equal(await client.evaluate(`Boolean(document.querySelector('[data-testid="continue-game"]'))`), false);
          await exit(label + "-restart");
          test.status = "PASS"; save();
        }
        const logs = text(["logcat", "-d", "-v", "threadtime"]), file = path.join(out, c.layout + "-logcat.txt");
        fs.writeFileSync(file, logs, { flag: "wx" }); current.logcat = fileEvidence(file);
        current.logs = scopedRuntimeLog(logs, c.package, current.pids);
        if (q.lifecycleDebugger)
          current.productOutcome = current.logs.fatal.length ? "NATIVE_FATAL_OBSERVED" : "NO_FATAL_IN_INSTRUMENTED_WINDOW";
        else assert.deepEqual(current.logs.fatal, []);
      } finally {
        const errors = [];
        try { await finishDebugger(); } catch (e) { errors.push("debugger: " + e); }
        if (current.installed && (!current.logs || current.logs.fatal.length)) {
          try {
            current.failureEvidence = await require("./lib/android-exit-failure-evidence.cjs").captureExitFailure({
              outputDir: out, packageName: current.package, label: r.cases.at(-1)?.label || current.layout,
              evaluate: client ? expression => client.evaluate(expression) : undefined,
              getTargets: forwarded ? async () => {
                const response = await fetch(`http://127.0.0.1:${q.cdpPort}/json/list`, { signal: AbortSignal.timeout(1500) });
                assert(response.ok); return response.json();
              } : undefined,
              command: (args, binary) => cmd(args, binary, true, 10000),
            });
          } catch (error) { current.failureEvidenceError = String(error.stack || error); }
          save();
        }
        try { await disconnect(); } catch (e) { errors.push("disconnect: " + e); }
        if (!current.logs && current.installed) try {
          const logs = text(["logcat", "-d", "-v", "threadtime"]), file = path.join(out, c.layout + "-failure-logcat.txt");
          fs.writeFileSync(file, logs, { flag: "wx" }); current.logcat = fileEvidence(file);
          current.logs = scopedRuntimeLog(logs, c.package, current.pids);
        } catch (e) { errors.push("logcat: " + e); }
        try {
          if (current.installed) assert.match(text(["uninstall", c.package]), /Success/);
          current.uninstallStatus = current.installed ? "PASS" : "NOT_INSTALLED";
        } catch (e) { errors.push("uninstall: " + e); }
        try {
          assert.equal(path.dirname(current.staging), out); assert.notEqual(current.staging, c.apk.path);
          if (fs.existsSync(current.staging)) fs.unlinkSync(current.staging);
          assert(!fs.existsSync(current.staging)); same(c.apk); current.apkCleanupStatus = "PASS";
        } catch (e) { errors.push("staging: " + e); }
        current.cleanupError = errors.length ? errors.join("\n") : null; save();
        assert.equal(current.cleanupError, null);
      }
    }
    if (q.lifecycleDebugger) {
      assert.equal(r.cases.length, 1); assert.equal(r.exits.length, 1);
      assert.equal(r.diagnostics.length, 1); assert.equal(r.diagnostics[0].status, "COLLECTED");
      r.status = "DIAGNOSTIC_OBSERVATION_COMPLETE";
    } else {
      assert.equal(r.cases.length, 6); assert(r.cases.every(c => c.status === "PASS")); assert.equal(r.exits.length, 12);
      assert.equal(r.exits.filter(e => e.nextLaunchPolicy === "IMMEDIATE_ACTIVITY_REOPEN").length, 2);
      r.exits.filter(e => e.nextLaunchPolicy === "IMMEDIATE_ACTIVITY_REOPEN").forEach(validateImmediateActivityReopen);
      r.status = r.toolWarnings.length ? "BLOCKED_EVIDENCE_REVIEW"
        : r.cells.some(c => c.logs.warnings.length) ? "BLOCKED_RENDERER_REVIEW" : "PASS_LIMITED_EXIT_AND_RESTART";
    }
  } catch (e) {
    r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1;
    if (r.cases.at(-1)?.status === "RUNNING") { r.cases.at(-1).status = "FAILED"; r.cases.at(-1).error = r.error; }
  } finally {
    const errors = r.cells.filter(c => c.cleanupError).map(c => c.cleanupError);
    try { await disconnect(); } catch (e) { errors.push("disconnect: " + e); }
    try { if (ownedAdb) text(["kill-server"]); r.adbCleanupStatus = ownedAdb ? "PASS" : "NOT_STARTED"; }
    catch (e) { errors.push("adb: " + e); }
    try { q.tools.forEach(same); q.cells.forEach(c => same(c.apk)); same(q.build); }
    catch (e) { errors.push("source: " + e); }
    r.cleanupError = errors.length ? errors.join("\n") : null;
    if (r.cleanupError) { r.status = "FAILED"; process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, reportFile, cases: r.cases.length, exits: r.exits.length, error: r.error }));
  }
}
if (require.main === module) {
  const [phase, arg, buildAttempt] = process.argv.slice(2); assert(["launch", "run"].includes(phase));
  (phase === "launch" ? launch(arg, buildAttempt, process.argv.includes("--audited-build"),
    process.argv.includes("--lifecycle-debugger")) : run(arg))
    .catch(e => { console.error(e); process.exitCode = 1; });
}
module.exports = { validateRequest, sameOwnerProcess, transientNavigationReadError, paintedControl,
  validateImmediateActivityReopen };
