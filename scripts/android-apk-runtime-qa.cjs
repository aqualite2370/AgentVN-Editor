#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { visibleControlRect, rectOutsideRoot } = require("./visible-control-geometry.cjs");
const { planControlSwipe } = require("./android-touch-scroll.cjs");
const { fileEvidence, verifyProvenance, acceptanceStatus, verifyColdBoot } = require('./android-acceptance-evidence.cjs');
const { runtimeFailures, scopedRuntimeLog, assessRestartTrials, compareRestartScreenshots } = require('./android-runtime-log-analysis.cjs');
const { runtimeFailureDetails, rendererDiagnosticStatus } = require('./lib/android-runtime-result.cjs');
const { startCacheProbe } = require('./lib/android-cache-probe.cjs');
const { startCacheStack } = require('./lib/android-cache-stack.cjs');
const { startCacheDebugger } = require('./lib/android-cache-debugger.cjs');
const { startCachePerf } = require('./lib/android-cache-perf.cjs');
const { compareCapturedAudio } = require('./android-audio-evidence.cjs');
const { readAudioFocusSnapshot } = require('./android-audio-focus-snapshot.cjs');
const { observeMenuAction, finishMenuAction, assessSkipAction } = require('./android-menu-action-observer.cjs');
const { captureProcessTimeoutMs } = require('./android-audio-capture-policy.cjs');
const { installedResourceFlow, assertTitlePolicy, resourceSmokeStatus, renpyDialogHasClearance, assertDisplayRotation, assertResourceBarStable, assertResourceBarSafeDock } = require('./lib/android-installed-resource-flow.cjs');
const { assertRenpyQuickBarGeometry } = require('./lib/installed-portable-layout.cjs');
const { exerciseFullStory, validateFullStoryInput } = require('./lib/android-full-story-flow.cjs');
const { renderedDialogGlyphs } = require('./lib/rendered-dialog-glyphs.cjs');
const { measureSettingsIconProportions, assertSettingsIconProportions } = require('./lib/runtime-settings-proportions.cjs');
const { validateDefaultTitleApk, measureAndroidDefaultTitle, exerciseAndroidDefaultTitle } = require('./lib/android-default-title-flow.cjs');
const { validateHiddenGrowthApk, exerciseHiddenGrowth } = require('./lib/android-hidden-growth-flow.cjs');
const { packageSmokeCoverage, packageSmokeStatus, validatePackageSmokeApk, exercisePackageSmoke } = require('./lib/android-package-smoke.cjs');

const root = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const apkPath = path.resolve(option("--apk"));
let stagingApk = option("--staging-apk", "");
const adbPort = Number(option('--adb-port', '5042'));
const cdpPort = Number(option('--cdp-port', '9223'));
const runId = option('--run-id', require('node:crypto').randomUUID());
const emulatorDiscovery = option('--emulator-discovery');
const scope = option('--scope', 'complete-runtime');
const defaultTitleScope = scope === 'installed-agentvn-title';
const hiddenGrowthScope = scope === 'installed-hidden-growth';
const packageSmokeScope = scope === 'installed-package-smoke';
const rendererOnly = argv.includes('--renderer-only');
const totalDeadline = Date.now() + Number(option('--total-timeout-ms', '1800000'));
const packageName = option("--package");
const serial = option("--serial", "emulator-5554");
const sdkRoot = path.resolve(option("--sdk", "D:\\Android_dev\\Sdk"));
const outputDir = path.resolve(option("--output", path.join(root, "output", "android-apk-runtime-qa", runId)));
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const report = {
  schemaVersion: 1,
  apkPath,
  packageName,
  serial,
  platform: "android",
  status: "BLOCKED",
  runId,
  requiredCoverage: { branch: 'NOT_RUN', sprites: 'NOT_RUN', pagination: 'NOT_RUN', saveWriteRead: 'NOT_RUN', menuActions: 'NOT_RUN', coldEmulatorBoot: 'NOT_VERIFIED', rendererWarnings: 'NOT_VERIFIED' },
  stages: { build: 'BLOCKED', runtime: 'BLOCKED', audio: 'BLOCKED', provenance: 'BLOCKED', cleanup: 'BLOCKED' },
  interaction: 'administrator-adb-real-touch',
  ownership: { runnerPid: process.pid, adbPort, cdpPort, emulator: 'external-not-terminated' },
  failureCode: null,
  startedAt: new Date().toISOString(),
  viewport: null,
  screens: [],
  touches: [],
  screenshots: [],
  layoutChecks: [],
  audio: {},
  logcat: {},
  uninstallStatus: "NOT_RUN",
  apkCleanupStatus: "NOT_RUN",
  cleanupError: null,
  isElevated: null,
};

function isElevated() {
  if (process.platform !== "win32") return true;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status === 0 && result.stdout.trim().toLowerCase() === "true") return true;
  return false;
}

let cleanupAttempted = false;
let installAttempted = false;
let stagingCreated = false;
let forwardCreated = false;
let adbOwned = false;
let rotationLocked = false;
let sensorAdjusted = false;
let sensorBefore = null;
function cleanupArtifacts() {
  // Error handling can reach this from install, main and the outer catch.
  // Keep the first result authoritative; a second uninstall of an absent
  // package can return DELETE_FAILED_INTERNAL_ERROR on API 35.
  if (cleanupAttempted || report.isElevated !== true) return;
  cleanupAttempted = true;
  try {
    const uninstall = installAttempted ? runQuiet(["uninstall", packageName]) : { status: 0, stdout: 'not installed by this run', stderr: '' };
    report.uninstallStatus = uninstall.status === 0 || /Unknown package/i.test(`${uninstall.stdout}\n${uninstall.stderr}`)
      ? "PASS"
      : `FAIL:${(uninstall.stderr || uninstall.stdout || "").trim()}`;
    if (report.uninstallStatus !== "PASS") report.cleanupError = report.uninstallStatus;
  } catch (error) {
    report.cleanupError = error instanceof Error ? error.message : String(error);
    report.uninstallStatus = "FAIL";
  }
  try {
    if (stagingCreated) {
      const stagingPath = path.resolve(stagingApk);
      if (stagingPath === apkPath || path.dirname(stagingPath) !== outputDir) throw new Error('UNSAFE_STAGING_PATH');
      if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { force: true });
      report.apkCleanupStatus = fs.existsSync(stagingPath) ? "FAIL_REMAINS" : "PASS";
    } else report.apkCleanupStatus = 'PASS';
  } catch (error) {
    report.cleanupError = [report.cleanupError, error instanceof Error ? error.message : String(error)].filter(Boolean).join("; ");
    if (report.apkCleanupStatus === "NOT_RUN") report.apkCleanupStatus = "FAIL";
  }
  if (forwardCreated) runQuiet(['forward', '--remove', `tcp:${cdpPort}`]);
  if (sensorAdjusted) {
    const sensor = runQuiet(['emu', 'sensor', 'set', 'acceleration', sensorBefore]);
    report.sensorRestoreStatus = sensor.status === 0 ? 'PASS' : 'FAILED';
    if (sensor.status !== 0) report.cleanupError = [report.cleanupError, 'SENSOR_RESTORE_FAILED'].filter(Boolean).join('; ');
    sensorAdjusted = false;
  }
  if (rotationLocked) {
    const rotation = runQuiet(['shell', 'cmd', 'window', 'user-rotation', 'free']);
    report.rotationRestoreStatus = rotation.status === 0 ? 'PASS' : 'FAILED';
    if (rotation.status !== 0) report.cleanupError = [report.cleanupError, 'ROTATION_RESTORE_FAILED'].filter(Boolean).join('; ');
    rotationLocked = false;
  }
  if (adbOwned) spawnSync(adb, ['-P', String(adbPort), 'kill-server'], { windowsHide: true, timeout: 10_000 });
  report.stages.cleanup = report.uninstallStatus === 'PASS'
    && report.apkCleanupStatus === 'PASS'
    && report.diagnosticCleanupStatus !== 'FAILED'
    && report.rotationRestoreStatus !== 'FAILED'
    && report.sensorRestoreStatus !== 'FAILED' ? 'PASS' : 'FAILED';
  if (report.stagingApk) report.stagingApk.cleaned = report.apkCleanupStatus === 'PASS';
  report.status = packageSmokeScope ? packageSmokeStatus(report.stages, report.requiredCoverage)
    : scope === 'installed-resources' ? resourceSmokeStatus(report.stages) : acceptanceStatus(report.stages);
}

function fail(message, failureCode = "ANDROID_APK_RUNTIME_QA_FAILED") {
  report.failureCode = failureCode;
  report.message = message;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "runtime-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  throw new Error(`${failureCode}: ${message}`);
}

function run(args, options = {}) {
  if (!cleanupAttempted && Date.now() > totalDeadline) throw new Error('ANDROID_TOTAL_TIMEOUT');
  const result = spawnSync(adb, ["-P", String(adbPort), "-s", serial, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
    ...options,
  });
  if (result.error || result.status !== 0) throw new Error(`${result.error?.code || 'ADB_COMMAND_FAILED'} ${args[0]}: ${(result.stderr || result.stdout || result.error?.message || 'adb command failed').trim()}`);
  return result.stdout || "";
}

async function waitForRuntimeDevice(timeoutMs = 60_000, pollMs = 250) {
  const started = Date.now(), deadline = started + timeoutMs;
  const evidence = report.adbReadiness = { status: 'RUNNING', observations: [] };
  let stable = 0, lastError = 'device not observed';
  while (Date.now() <= deadline) {
    try {
      const state = run(['get-state'], {
        timeout: Math.max(1, Math.min(5000, deadline - Date.now())),
      }).trim();
      evidence.observations.push({ elapsedMs: Date.now() - started, state });
      if (state !== 'device') throw Error(`Emulator is not online: ${state}`);
      if (++stable >= 2) {
        evidence.status = 'PASS';
        evidence.elapsedMs = Date.now() - started;
        return;
      }
    } catch (error) {
      stable = 0;
      lastError = String(error.message || error);
      evidence.observations.push({ elapsedMs: Date.now() - started, error: lastError });
      // Cold boot intentionally releases its diagnostic server. The runner's
      // new server may see an offline/not-yet-discovered transport while it
      // reconnects. Do not retry authorization errors, command timeouts or
      // unrelated failures, and never restart someone else's ADB server.
      if (!/device offline|device .*not found|no devices\/emulators found|no devices found/i.test(lastError)) {
        evidence.status = 'BLOCKED';
        throw error;
      }
    }
    await delay(pollMs);
  }
  evidence.status = 'BLOCKED';
  evidence.elapsedMs = Date.now() - started;
  throw Error(`EMULATOR_NOT_READY: ADB readiness timed out: ${lastError}`);
}

function runQuiet(args) {
  return spawnSync(adb, ["-P", String(adbPort), "-s", serial, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function captureScreenshot(name) {
  const filePath = path.join(outputDir, `${name}.png`);
  const bytes = captureScreenshotBytes();
  fs.writeFileSync(filePath, bytes);
  report.screenshots.push(filePath);
  return filePath;
}

function captureScreenshotBytes() {
  let lastError = "screencap failed";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = spawnSync(adb, ["-P", String(adbPort), "-s", serial, "exec-out", "screencap", "-p"], {
      windowsHide: true,
      encoding: null,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15_000,
    });
    if (result.status === 0 && result.stdout?.length > 24) return result.stdout;
    lastError = result.stderr?.toString("utf8") || lastError;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(lastError);
}

function parsePhysicalSize() {
  const bytes = captureScreenshotBytes();
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error("Android screencap did not return a PNG");
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    source: "screencap",
  };
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const resolve = this.pending.get(message.id);
      if (!resolve) return;
      this.pending.delete(message.id);
      resolve(message);
    };
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP_STEP_TIMEOUT: ${method}`)); }, 20_000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function connectCdp() {
  const pid = run(["shell", "pidof", packageName]).trim().split(/\s+/)[0];
  if (!pid) throw new Error(`No running process for ${packageName}`);
  run(["forward", "--no-rebind", `tcp:${cdpPort}`, `localabstract:webview_devtools_remote_${pid}`]);
  forwardCreated = true;
  let tabs = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      tabs = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
      if (tabs.some(tab => tab.type === 'page' && tab.url && tab.url !== 'about:blank')) break;
    } catch {
      // WebView devtools starts shortly after the activity.
    }
    await delay(250);
  }
  const tab = tabs.find((item) => item.type === "page" && item.url && item.url !== 'about:blank');
  if (!tab?.webSocketDebuggerUrl) throw new Error("No WebView CDP page exposed by the APK");
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP_CONNECT_TIMEOUT')), 10_000);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = error => { clearTimeout(timer); reject(error); };
  });
  return new CdpClient(socket);
}

async function waitFor(cdp, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await cdp.evaluate(expression); }
    catch (error) {
      if (!/Inspected target navigated or closed|Execution context was destroyed|Cannot find context/i.test(String(error))) throw error;
      last = { transientNavigation: String(error) };
      await delay(250);
      continue;
    }
    if (last) return last;
    await delay(250);
  }
  throw new Error(`${label} did not become ready: ${JSON.stringify(last)}`);
}

async function dom(cdp) {
  return cdp.evaluate(`(() => {
    const root = document.querySelector("#root");
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.01 && box.width > 0 && box.height > 0;
    };
    return {
      title: document.title,
      screen: document.querySelector("[data-runtime-screen]")?.getAttribute("data-runtime-screen")
        || document.querySelector("[data-ui-screen]")?.getAttribute("data-ui-screen")
        || null,
      root: rect(root),
      innerWidth,
      innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      dialogContentRects: [...document.querySelectorAll(".dialog-box > .dialog-text, .dialog-box > .speaker, .dialog-box > .continue-indicator, .nvl-page")]
        .filter(visible).map(rect),
      buttons: [...document.querySelectorAll("button")].filter(visible).map((button) => {
        const buttonRect = (${visibleControlRect.toString()})(button);
        const hit = document.elementFromPoint(
          buttonRect.x + buttonRect.width / 2,
          buttonRect.y + buttonRect.height / 2,
        );
        return {
          testid: button.dataset.testid || null,
          componentId: button.dataset.uiComponentId || null,
          label: button.getAttribute("aria-label") || button.innerText.trim(),
          className: button.className,
          disabled: button.disabled,
          interactive: buttonRect.width > 0 && buttonRect.height > 0 && (hit === button || button.contains(hit)),
          rect: rect(button),
          visibleRect: buttonRect,
        };
      }),
      text: document.body.innerText.slice(0, 6000),
      player: (() => {
        const element = document.querySelector(".story-player");
        return element ? {
          sceneId: element.getAttribute("data-current-scene-id"),
          commandIndex: Number(element.getAttribute("data-current-command-index")),
          commandType: element.getAttribute("data-current-command-type"),
          isTyping: element.getAttribute("data-is-typing"),
          ended: element.getAttribute("data-ended"),
          dialog: document.querySelector(".dialog-text")?.textContent || "",
        } : null;
      })(),
      audioElements: [...document.querySelectorAll("audio")].map((audio) => ({
        src: audio.currentSrc || audio.src,
        paused: audio.paused,
        currentTime: audio.currentTime,
        volume: audio.volume,
      })),
      diagnostics: window.__AGENTVN_RUNTIME_DIAGNOSTICS__ ?? null,
    };
  })()`);
}

function assertLayout(state, label) {
  const root = state.root;
  if (!root) throw new Error(`${label}: #root has no geometry`);
  const interactiveButtons = state.buttons.filter((button) => button.interactive);
  const occludedButtons = state.buttons.filter((button) => !button.interactive);
  // A scrollable card may initially extend below the frame. Only accept it
  // after a real device swipe has proved its entire hit rectangle reachable.
  const outOfBounds = interactiveButtons.filter((button) => rectOutsideRoot(button.reachableRect || button.rect, root));
  const overlaps = [];
  for (let left = 0; left < interactiveButtons.length; left += 1) {
    for (let right = left + 1; right < interactiveButtons.length; right += 1) {
      const a = interactiveButtons[left].visibleRect;
      const b = interactiveButtons[right].visibleRect;
      const intentionalQuickMenuOverlap = (
        (interactiveButtons[left].testid === "quick-menu-toggle" && String(interactiveButtons[right].className).includes("dialog-box"))
        || (interactiveButtons[right].testid === "quick-menu-toggle" && String(interactiveButtons[left].className).includes("dialog-box"))
      );
      if (intentionalQuickMenuOverlap) continue;
      const dialogControl = [interactiveButtons[left], interactiveButtons[right]].find(button =>
        String(button.className).split(/\s+/).includes("dialog-box"));
      const renpyAction = [interactiveButtons[left], interactiveButtons[right]].find(button =>
        button.testid?.startsWith("renpy-quick-"));
      if (dialogControl && renpyAction && renpyDialogHasClearance(state.dialogContentRects, renpyAction.rect)) continue;
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
      // CSS transforms scale the authored 16:9 frame to fractional pixels.
      // Ignore a sub-half-pixel seam where adjacent controls merely touch
      // after rounding, but keep asserting any meaningful overlap.
      if (width > 0.5 && height > 0.5) {
        overlaps.push([interactiveButtons[left].label, interactiveButtons[right].label, width * height]);
      }
    }
  }
  const check = {
    label,
    screen: state.screen,
    root,
    scrollWidth: state.scrollWidth,
    bodyScrollWidth: state.bodyScrollWidth,
    buttonCount: state.buttons.length,
    interactiveButtonCount: interactiveButtons.length,
    occludedButtons,
    outOfBounds,
    overlaps,
  };
  report.layoutChecks.push(check);
  if (outOfBounds.length > 0) throw new Error(`${label}: visible control outside root: ${JSON.stringify(outOfBounds)}`);
  if (overlaps.length > 0) throw new Error(`${label}: visible controls overlap: ${JSON.stringify(overlaps)}`);
  if (state.scrollWidth > state.innerWidth + 1 || state.bodyScrollWidth > state.innerWidth + 1) {
    throw new Error(`${label}: horizontal overflow ${state.scrollWidth}/${state.bodyScrollWidth} > ${state.innerWidth}`);
  }
}

async function tapSelector(cdp, selector, label, { scrollOnly = false } = {}) {
  await waitFor(cdp, `!document.querySelector('.runtime-screen-transition.is-active')`, `${label} screen transition`, 20_000);
  await waitFor(cdp, `[...document.querySelectorAll('.playback-controls')].every(root => root.getAnimations({ subtree: true }).every(animation => animation.playState === 'finished'))`, `${label} menu transition`, 20_000);
  const locate = () => cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return null;
    const value = element.getBoundingClientRect();
    const root = document.querySelector("#root")?.getBoundingClientRect();
    const visible = (${visibleControlRect.toString()})(element);
    const physical = ${JSON.stringify(report.viewport.physical)};
    const isDialogue = element.classList.contains("dialog-box");
    // The quick bar intentionally shares the dialogue backdrop. Its center
    // is not necessarily a dialogue hit target. Probe safe points and verify
    // the exact coordinates after rounding to physical ADB pixels.
    const candidates = isDialogue
      ? [[0.5, 0.5], [0.5, 0.3], [0.25, 0.3], [0.75, 0.3], [0.25, 0.75], [0.75, 0.75]]
      : [[0.5, 0.5]];
    const hitSamples = (root ? candidates : []).map(([fx, fy]) => {
      const x = Math.round((visible.x + visible.width * fx) * physical.width / root.width) * root.width / physical.width;
      const y = Math.round((visible.y + visible.height * fy) * physical.height / root.height) * root.height / physical.height;
      const target = document.elementFromPoint(x, y);
      const control = target?.closest('button,[role="button"],a,input,select,textarea,[contenteditable="true"]');
      return { x, y, hit: visible.width > 0 && visible.height > 0
        && x >= visible.x && x < visible.right && y >= visible.y && y < visible.bottom
        && (target === element || element.contains(target))
        && (!control || control === element),
        tag: target?.tagName, testId: target?.getAttribute("data-testid"),
        className: target?.getAttribute("class") };
    });
    const touchPoint = hitSamples.find(point => point.hit) || null;
    let scroll = null;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
        const box = parent.getBoundingClientRect();
        scroll = { x: box.x, y: box.y, width: box.width, height: box.height };
        break;
      }
    }
    return {
      disabled: element instanceof HTMLButtonElement ? element.disabled : false,
      rect: { x: value.x, y: value.y, width: value.width, height: value.height },
      root: root ? { width: root.width, height: root.height } : null,
      visible,
      hit: Boolean(touchPoint),
      touchPoint,
      hitSamples,
      scroll,
    };
  })()`);
  let info = await locate();
  for (let attempt = 0; info?.scroll && attempt < 8; attempt++) {
    if (info.hit && info.visible.height >= info.rect.height - 1 && info.visible.width >= info.rect.width - 1) break;
    const scaleX = report.viewport.physical.width / info.root.width;
    const scaleY = report.viewport.physical.height / info.root.height;
    const gesture = planControlSwipe(info);
    const x = Math.round(gesture.x * scaleX);
    const y1 = Math.round(gesture.y1 * scaleY);
    const y2 = Math.round(gesture.y2 * scaleY);
    run(["shell", "input", "swipe", String(x), String(y1), String(x), String(y2), "300"]);
    const touch = { label: `scroll to ${label}`, selector, x, y1, y2, kind: "swipe", before: info };
    report.touches.push(touch);
    await delay(350);
    info = await locate();
    touch.after = info;
    if (gesture.settleWithDomScroll && info && (!info.hit || info.visible.height < info.rect.height - 1)) {
      const settled = await cdp.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLElement)) return false;
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        return true;
      })()`);
      report.touches.push({ label: `settle scroll position for ${label}`, selector, kind: 'dom-scroll-settle', settled });
      await delay(250);
      info = await locate();
      touch.settled = info;
    }
  }
  if (!info) throw new Error(`${label}: selector not found: ${selector}`);
  if (info.disabled) throw new Error(`${label}: selector is disabled: ${selector}`);
  if (!info.root) throw new Error(`${label}: root geometry missing`);
  if (!info.hit || info.visible.height < info.rect.height - 1 || info.visible.width < info.rect.width - 1) {
    report.failedInteraction = { label, selector, geometry: info, state: await dom(cdp) };
    throw new Error(`${label}: target is clipped or occluded after real scrolling: ${JSON.stringify(info)}`);
  }
  const targetRect = { ...info.rect, right: info.rect.x + info.rect.width, bottom: info.rect.y + info.rect.height };
  if (rectOutsideRoot(targetRect, info.root)) throw new Error(`${label}: complete target remains outside the device viewport`);
  if (scrollOnly) {
    report.touches.push({ label, selector, kind: "scroll-reachability", cssRect: targetRect });
    return targetRect;
  }
  const x = Math.round(info.touchPoint.x * report.viewport.physical.width / info.root.width);
  const y = Math.round(info.touchPoint.y * report.viewport.physical.height / info.root.height);
  // `input tap` on this rotated API-35 image can be coalesced before the
  // WebView dispatches a pointerup. A short zero-distance swipe preserves the
  // same real touch coordinates while reliably delivering down/up.
  run(["shell", "input", "swipe", String(x), String(y), String(x), String(y), "120"]);
  report.touches.push({ label, selector, x, y, cssRect: info.rect,
    touchPoint: info.touchPoint, hitSamples: info.hitSamples });
  await delay(650);
}

async function ensureQuickMenuExpanded(cdp, label) {
  const expanded = await cdp.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded') === 'true'`);
  const before = await cdp.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getBoundingClientRect().toJSON()`);
  if (!expanded) await tapSelector(cdp, '[data-testid="quick-menu-toggle"]', label);
  // No animation is running when a touch has not yet reached the WebView.
  // Wait for the semantic state too; never retry a toggle blindly.
  await waitFor(cdp, `document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded') === 'true'`, `${label} expanded state`, 20_000);
  const after = await cdp.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.getBoundingClientRect().toJSON()`);
  if (!before || !after || Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1) {
    throw new Error(`QUICK_MENU_TOGGLE_DRIFT: ${JSON.stringify({ label, before, after })}`);
  }
  (report.menuPositionChecks ||= []).push({ label, before, after, status: 'PASS' });
}

async function captureState(cdp, label) {
  await waitFor(cdp, `!document.querySelector('.runtime-screen-transition.is-active') &&
    [...document.querySelectorAll('.playback-controls')].every(root => root.getAnimations({ subtree: true }).every(animation => animation.playState === 'finished'))`, `${label} compositor settle`, 20_000);
  await delay(350);
  const state = await dom(cdp);
  report.screens.push({ label, state, screenshot: captureScreenshot(label) });
  let dumpReady = false;
  let lastDumpError = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (Date.now() > totalDeadline) throw new Error('ANDROID_TOTAL_TIMEOUT');
    const remoteXml = `/sdcard/agentvn-${runId}.xml`;
    run(['shell', 'rm', '-f', remoteXml]);
    const dump = runQuiet(['shell', 'uiautomator', 'dump', remoteXml]);
    const exists = dump.status === 0 && !dump.error
      ? runQuiet(['shell', 'test', '-s', remoteXml]) : null;
    if (exists?.status === 0 && !exists.error) { dumpReady = true; break; }
    lastDumpError = [dump.error?.code, dump.error?.message, dump.stderr, dump.stdout,
      exists?.stderr, exists?.error?.message].filter(Boolean).join('; ') || 'XML missing or empty';
    report.uiAutomatorRetries ??= [];
    report.uiAutomatorRetries.push({ label, attempt, exitCode: dump.status, output: lastDumpError });
    if (attempt < 3) await delay(1000);
  }
  if (!dumpReady) throw new Error(`UIAUTOMATOR_CAPTURE_UNAVAILABLE: ${label}: ${lastDumpError}`);
  run(['pull', `/sdcard/agentvn-${runId}.xml`, path.join(outputDir, `${label}.xml`)]);
  runQuiet(['shell', 'rm', `/sdcard/agentvn-${runId}.xml`]);
  return state;
}

async function requireFreePort(port) {
  const net = require('node:net');
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => reject(new Error(`PORT_OCCUPIED:${port}:${error.code}`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function restartTrials() {
  report.restartTrials = [];
  report.webviewVersion = run(['shell', 'dumpsys', 'webviewupdate']);
  for (const kind of ['clean-install', 'retained-data']) {
    for (let iteration = 1; iteration <= 3; iteration++) {
      const label = `${kind}-${iteration}`;
      run(['shell', 'am', 'force-stop', packageName]);
      if (kind === 'clean-install') {
        run(['uninstall', packageName]);
        run(['install', stagingApk]);
      }
      run(['logcat', '-c']);
      const startedAt = new Date().toISOString();
      const cacheObserver = argv.includes('--cache-probe') ? startCacheProbe({
        adb, adbPort, serial, packageName, outputDir, label,
      }) : null;
      const stackObserver = argv.includes('--cache-stack') ? startCacheStack({
        adb, adbPort, serial, packageName, outputDir, label,
      }) : null;
      const debuggerObserver = argv.includes('--cache-debugger') ? startCacheDebugger({
        adb, adbPort, serial, packageName, outputDir, label, runId,
        ndk: option('--debugger-ndk'), localPort: Number(option('--debugger-port')),
        remotePort: 38471,
      }) : null;
      const perfObserver = argv.includes('--cache-perf') ? startCachePerf({
        adb, adbPort, serial, packageName, outputDir, label, runId,
        fileTrace: argv.includes('--cache-file-trace'),
      }) : null;
      let client;
      try {
        if (debuggerObserver) await debuggerObserver.ready;
        if (perfObserver) await perfObserver.ready;
        run(['shell', 'monkey', '-p', packageName, '1']);
        if (debuggerObserver) await debuggerObserver.completion;
        if (perfObserver) await perfObserver.completion;
        await delay(2500);
        if (forwardCreated) { runQuiet(['forward', '--remove', `tcp:${cdpPort}`]); forwardCreated = false; }
        client = await connectCdp();
        await waitFor(client, `Boolean(document.querySelector('[data-testid="start-new-game"]') && !document.querySelector('.game-launch-blackout') && !document.querySelector('.boot-overlay'))`, label);
        const startup = await captureState(client, label);
        if (defaultTitleScope) {
          assertLayout(startup, label);
          (report.defaultTitleRestartSamples ??= []).push({ label,
            ...await measureAndroidDefaultTitle(client, path.join(outputDir, `${label}.png`), report.defaultTitleInput.fixture.title) });
        }
        const layers = await client.call('Memory.getDOMCounters');
        const images = await client.evaluate(`[...document.images].map(image => ({ source: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight, complete: image.complete }))`);
        const pid = run(['shell', 'pidof', packageName]).trim().split(/\s+/)[0];
        const processes = run(['shell', 'ps', '-A', '-o', 'PID,PPID,NAME,ARGS']);
        const log = run(['logcat', '-d', '-v', 'threadtime']);
        const memory = run(['shell', 'dumpsys', 'meminfo', packageName]);
        fs.writeFileSync(path.join(outputDir, `${label}-logcat.txt`), log, 'utf8');
        fs.writeFileSync(path.join(outputDir, `${label}-memory.txt`), memory, 'utf8');
        fs.writeFileSync(path.join(outputDir, `${label}-processes.txt`), processes, 'utf8');
        const processRows = processes.split(/\r?\n/).filter(line => line.includes(packageName));
        const analysis = scopedRuntimeLog(log, packageName, [pid, ...processRows.map(line => line.trim().split(/\s+/)[0])]);
        fs.writeFileSync(path.join(outputDir, `${label}-app-renderer-logcat.txt`), analysis.lines.join('\n'), 'utf8');
        const pssKb = Number(memory.match(/TOTAL PSS:\s+(\d+)/)?.[1]);
        const screenshotPath = path.join(outputDir, `${label}.png`);
        const screenshotSha256 = fileEvidence(screenshotPath).sha256;
        report.restartTrials.push({ kind, iteration, startedAt, finishedAt: new Date().toISOString(), pid, layers, images, pssKb,
          screenshotPath, screenshotSha256, warnings: analysis.warnings,
          fatal: analysis.fatal, appAndRendererPids: analysis.pids, rendererAnalysis: 'REQUIRES_REVIEW', status: analysis.fatal.length ? 'FAILED' : 'TITLE_OBSERVED' });
        if (analysis.fatal.length) throw new Error(`ANDROID_FATAL_RUNTIME_ERROR: ${label}: ${analysis.fatal.join('; ')}`);
      } finally {
        client?.close();
        if (cacheObserver) {
          const observation = await cacheObserver.completion;
          report.cacheProbes ||= [];
          report.cacheProbes.push({ label, ...observation });
          fs.writeFileSync(path.join(outputDir, `${label}-cache-probe.json`), JSON.stringify(observation, null, 2), 'utf8');
        }
        if (stackObserver) {
          const observation = await stackObserver.completion;
          report.cacheStacks ||= [];
          report.cacheStacks.push({ label, ...observation });
          fs.writeFileSync(path.join(outputDir, `${label}-cache-stack.json`), JSON.stringify(observation, null, 2), 'utf8');
        }
        if (debuggerObserver) {
          const observation = await debuggerObserver.completion;
          report.cacheDebuggers ||= [];
          report.cacheDebuggers.push({ label, ...observation });
          fs.writeFileSync(path.join(outputDir, `${label}-cache-debugger.json`), JSON.stringify(observation, null, 2), 'utf8');
        }
        if (perfObserver) {
          const observation = await perfObserver.completion;
          report.cachePerf ||= [];
          report.cachePerf.push({ label, ...observation });
          fs.writeFileSync(path.join(outputDir, `${label}-cache-perf.json`), JSON.stringify(observation, null, 2), 'utf8');
          if (observation.cleanupStatus !== 'PASS') {
            report.diagnosticCleanupStatus = 'FAILED';
            report.cleanupError = [report.cleanupError, observation.cleanupError || 'CACHE_PERF_CLEANUP_FAILED'].filter(Boolean).join('; ');
          }
        }
      }
    }
  }
  const visualReference = report.restartTrials.find(trial =>
    !(trial.warnings || []).some(line => /tile memory limits exceeded/i.test(line))
  )?.screenshotPath;
  if (visualReference && fs.existsSync(visualReference)) {
    for (const trial of report.restartTrials) {
      if (!(trial.warnings || []).some(line => /tile memory limits exceeded/i.test(line))
        || !trial.screenshotPath || !fs.existsSync(trial.screenshotPath)) continue;
      trial.visualComparison = await compareRestartScreenshots(trial.screenshotPath, visualReference);
    }
  }
  report.rendererWarningAssessment = assessRestartTrials(report.restartTrials);
  report.requiredCoverage.rendererWarnings = report.rendererWarningAssessment.status.startsWith('PASS') ? 'PASS' : 'BLOCKED';
}

async function exerciseStory(cdp) {
  let previous;
  for (let step = 0; step < 50; step++) {
    const state = await cdp.evaluate(`(() => {
      const player = document.querySelector('.story-player');
      const dialog = document.querySelector('[data-dialog-page]');
      return { scene: player?.getAttribute('data-current-scene-id'), command: player?.getAttribute('data-current-command-index'),
        page: Number(dialog?.getAttribute('data-dialog-page')), pages: Number(dialog?.getAttribute('data-dialog-pages')),
        choice: Boolean(document.querySelector('.choice-option:not(:disabled)')),
        sprite: [...document.querySelectorAll('img.sprite-visual')].some(image => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0) };
    })()`);
    if (!state.scene) break;
    if (state.sprite && report.requiredCoverage.sprites !== 'PASS') {
      await captureState(cdp, 'story-sprite');
      report.requiredCoverage.sprites = 'PASS';
    }
    if (previous && state.scene === previous.scene && state.command === previous.command && state.page > previous.page && previous.pages > 1) {
      await captureState(cdp, 'story-pagination');
      report.requiredCoverage.pagination = 'PASS';
    }
    if (state.choice) {
      await captureState(cdp, 'story-choices');
      await tapSelector(cdp, '.choice-option:not(:disabled)', 'select story branch');
      await waitFor(cdp, `!document.querySelector('.choice-option:not(:disabled)')`, 'branch accepted');
      await captureState(cdp, 'story-branch');
      report.requiredCoverage.branch = 'PASS';
    } else await tapSelector(cdp, '.dialog-box', `story advance ${step}`);
    previous = state;
    if (['branch', 'sprites', 'pagination'].every(key => report.requiredCoverage[key] === 'PASS')) break;
  }
}

async function exerciseMenuActions(cdp) {
  const button = id => `[data-ui-component-id="quick_${id}_button"]`;
  report.menuActions = {};
  await ensureQuickMenuExpanded(cdp, 'menu action matrix');
  const expanded = await captureState(cdp, 'menu-actions-before');
  assertLayout(expanded, 'menu-actions-before');
  const actions = expanded.buttons.filter(item => item.componentId?.startsWith('quick_'));
  if (actions.length !== 7 || actions.some(item => !item.interactive)) throw new Error('MENU_ALL_SEVEN_NOT_REACHABLE');
  await tapSelector(cdp, button('history'), 'open history');
  await waitFor(cdp, `Boolean(document.querySelector('.history-list article'))`, 'history contains played dialogue');
  await captureState(cdp, 'menu-history');
  await tapSelector(cdp, '[data-testid="back-to-player"]', 'history back to player');
  await waitFor(cdp, `Boolean(document.querySelector('.story-player'))`, 'player after history');
  report.menuActions.history = 'PASS';
  await ensureQuickMenuExpanded(cdp, 'menu hide action');
  await tapSelector(cdp, button('hide_ui'), 'hide player interface');
  await waitFor(cdp, `!document.querySelector('.dialog-box') && !document.querySelector('.playback-controls')`, 'interface hidden');
  await tapSelector(cdp, '.story-player', 'touch to restore interface');
  await waitFor(cdp, `Boolean(document.querySelector('.dialog-box') && document.querySelector('.playback-controls'))`, 'interface restored');
  report.menuActions.hide = 'PASS';
  await ensureQuickMenuExpanded(cdp, 'menu rollback action');
  const before = (await dom(cdp)).player;
  await tapSelector(cdp, button('rollback'), 'rollback played dialogue');
  await waitFor(cdp, `(() => { const p=document.querySelector('.story-player'); return p &&
    (p.getAttribute('data-current-scene-id') !== ${JSON.stringify(before.sceneId)} ||
    Number(p.getAttribute('data-current-command-index')) !== ${before.commandIndex}); })()`, 'rollback changes story position');
  report.menuActions.rollback = 'PASS';
  for (const action of ['auto']) {
    await ensureQuickMenuExpanded(cdp, `menu ${action} enable`);
    await cdp.evaluate(`(${observeMenuAction.toString()})('quick_auto_button')`);
    try {
      await tapSelector(cdp, button(action), `enable ${action}`);
      await waitFor(cdp, `document.querySelector(${JSON.stringify(button(action))})?.classList.contains('active')`, `${action} enabled`);
      await tapSelector(cdp, button(action), `disable ${action}`);
      await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(button(action))})) && !document.querySelector(${JSON.stringify(button(action))}).classList.contains('active')`, `${action} disabled`);
    } finally {
      report.autoActionEvidence = await cdp.evaluate(`(${finishMenuAction.toString()})(true)`);
    }
    report.menuActions[action] = 'PASS';
  }
  // Return to a known read line: auto mode may have reached unread text, where
  // skip is correctly refused. Observe during the touch, not 650ms afterwards.
  const beforeSkipRollback = (await dom(cdp)).player;
  await tapSelector(cdp, button('rollback'), 'rollback to read line before skip');
  await waitFor(cdp, `(() => { const p=document.querySelector('.story-player'); return p &&
    (p.getAttribute('data-current-scene-id') !== ${JSON.stringify(beforeSkipRollback.sceneId)} ||
    Number(p.getAttribute('data-current-command-index')) !== ${beforeSkipRollback.commandIndex}); })()`, 'read line before skip');
  await cdp.evaluate(`(${observeMenuAction.toString()})('quick_skip_button')`);
  try {
    await tapSelector(cdp, button('skip'), 'enable skip on read line');
    await waitFor(cdp, `window.__agentvnMenuActionObserver.samples.some(sample => sample.state.active) &&
      window.__agentvnMenuActionObserver.samples.some(sample => sample.state.scene &&
        (sample.state.scene !== window.__agentvnMenuActionObserver.samples[0].state.scene ||
         sample.state.command !== window.__agentvnMenuActionObserver.samples[0].state.command))`, 'skip enabled and advanced read dialogue');
  } finally {
    report.skipActionEvidence = assessSkipAction(await cdp.evaluate(`(${finishMenuAction.toString()})()`));
  }
  if (report.skipActionEvidence.status !== 'PASS') throw new Error('SKIP_DID_NOT_ADVANCE_READ_DIALOGUE');
  if (report.skipActionEvidence.activeAtEnd) {
    await tapSelector(cdp, button('skip'), 'disable skip');
    await waitFor(cdp, `!document.querySelector(${JSON.stringify(button('skip'))})?.classList.contains('active')`, 'skip disabled');
  }
  report.menuActions.skip = 'PASS';
  await tapSelector(cdp, '[data-testid="quick-menu-toggle"]', 'collapse after menu actions');
  await waitFor(cdp, `document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded') === 'false' &&
    [...document.querySelectorAll('.quick-menu-action-layer button')].every(button => button.tabIndex === -1)`, 'collapsed actions not focusable');
  report.menuActions.collapse = 'PASS';
  report.menuActions.saveLoad = report.requiredCoverage.saveWriteRead;
}

async function exerciseReverseLandscape(cdp) {
  const before = { physical: parsePhysicalSize(), state: await dom(cdp) };
  run(['shell', 'cmd', 'window', 'user-rotation', 'lock', '3']);
  rotationLocked = true;
  await delay(1500);
  await waitFor(cdp, `innerWidth > innerHeight && Boolean(document.querySelector('.story-player'))`, 'reverse landscape player');
  await ensureQuickMenuExpanded(cdp, 'reverse landscape quick menu');
  const state = await captureState(cdp, 'reverse-landscape-quick-menu');
  assertLayout(state, 'reverse-landscape-quick-menu');
  const actions = state.buttons.filter(item => item.componentId?.startsWith('quick_'));
  if (actions.length !== 7 || actions.some(item => !item.interactive)) throw new Error('REVERSE_LANDSCAPE_MENU_NOT_REACHABLE');
  await tapSelector(cdp, '[data-testid="quick-menu-toggle"]', 'reverse landscape collapse');
  await waitFor(cdp, `document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute('aria-expanded') === 'false'`, 'reverse landscape collapsed');
  await ensureQuickMenuExpanded(cdp, 'reverse landscape reopen');
  report.rotationEvidence = { status: 'PASS', requestedRotation: 3, before, after: { physical: parsePhysicalSize(), state },
    windowState: run(['shell', 'dumpsys', 'window', 'displays']) };
}

async function exerciseRuntimeStability(cdp) {
  const samples = [];
  for (let iteration = 0; iteration < 7; iteration++) {
    const pid = run(['shell', 'pidof', packageName]).trim().split(/\s+/)[0];
    const memory = run(['shell', 'dumpsys', 'meminfo', packageName]);
    const layers = await cdp.call('Memory.getDOMCounters');
    const screenshot = captureScreenshot(`runtime-stability-${iteration + 1}`);
    samples.push({ iteration: iteration + 1, at: new Date().toISOString(), pid, layers,
      pssKb: Number(memory.match(/TOTAL PSS:\s+(\d+)/)?.[1]), screenshotSha256: fileEvidence(screenshot).sha256 });
    if (iteration < 6) await delay(10_000);
  }
  const pss = samples.map(sample => sample.pssKb);
  const nodeGrowth = samples.at(-1).layers.nodes - samples[0].layers.nodes;
  const listenerGrowth = samples.at(-1).layers.jsEventListeners - samples[0].layers.jsEventListeners;
  const monotonicPssGrowth = pss.slice(1).every((value, index) => value > pss[index] + 4096);
  report.runtimeStability = { status: !monotonicPssGrowth && nodeGrowth <= 10 && listenerGrowth <= 10 ? 'PASS' : 'BLOCKED',
    durationSeconds: 60, monotonicPssGrowth, nodeGrowth, listenerGrowth, samples };
  if (report.runtimeStability.status !== 'PASS') throw new Error('RUNTIME_STABILITY_EVIDENCE_FAILED');
}

async function exerciseInstalledResources(cdp, layoutType) {
  const flow = installedResourceFlow({ layout_type: layoutType });
  if (layoutType !== "renpy") throw new Error("INSTALLED_RESOURCE_FIXTURE_REQUIRES_RENPY_LAYOUT");

  const current = () => dom(cdp);
  await cdp.evaluate(`window.__agentvnAcceptanceInsets = null;
    window.addEventListener('agentvn:android-insets', event => {
      window.__agentvnAcceptanceInsets = { ...event.detail };
    });`);
  let initialBar;
  const checkBar = async (label, compare = true) => {
    const snapshot = await cdp.evaluate(`(() => {
      const bar = document.querySelector('[data-testid="renpy-quick-bar"]');
      const surface = document.querySelector('[data-runtime-safe-revision]');
      const rect = bar?.getBoundingClientRect();
      const style = surface ? getComputedStyle(surface) : null;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        devicePixelRatio,
        nativeInsets: window.__agentvnAcceptanceInsets,
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        barStyle: bar?.getAttribute('style'),
        safeRevision: surface?.getAttribute('data-runtime-safe-revision'),
        insets: style ? Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side =>
          [side, style.getPropertyValue('--runtime-safe-' + side)])) : null,
        visualViewport: visualViewport ? { width: visualViewport.width, height: visualViewport.height,
          offsetTop: visualViewport.offsetTop, offsetLeft: visualViewport.offsetLeft } : null
      };
    })()`);
    report.barCheckpoints ||= [];
    report.barCheckpoints.push({ label, ...snapshot });
    if (!initialBar) initialBar = snapshot;
    else if (compare) assertResourceBarStable(initialBar, snapshot, label);
    return snapshot;
  };
  const settle = () => waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'
    && !document.querySelector('.game-launch-blackout')`, "resource page settled");
  const position = async () => {
    await settle();
    const player = (await current()).player;
    if (!player) throw new Error("RESOURCE_PLAYER_POSITION_MISSING");
    return { scene: player.sceneId, command: player.commandIndex, dialog: player.dialog };
  };
  const restorePosition = async expected => {
    const actual = await position();
    require("node:assert/strict").deepEqual(actual, expected, "Native save/load must restore actual gameplay position");
  };
  let state;
  await tapSelector(cdp, '[data-testid="open-exit-confirmation"]', "resource title exit confirmation");
  await waitFor(cdp, `Boolean(document.querySelector('[data-runtime-modal="true"]'))`, "resource title confirmation");
  const confirmation = await captureState(cdp, "resource-exit-confirmation");
  const focus = await cdp.evaluate(`Boolean(document.querySelector('[data-runtime-modal="true"]')?.contains(document.activeElement))`);
  if (!focus) throw new Error("RESOURCE_CONFIRMATION_FOCUS_OUTSIDE_MODAL");
  report.exitConfirmation = { focusInside: focus, screen: confirmation.screen };
  await tapSelector(cdp, '.modal-actions button:first-child', "resource cancel title exit");
  await waitFor(cdp, `!document.querySelector('[data-runtime-modal="true"]')`, "resource title confirmation dismissed");

  await tapSelector(cdp, '[data-testid="open-settings"]', "resource smoke open settings");
  await waitFor(cdp, `Boolean(document.querySelector('[data-testid="settings-screen"], .settings-screen'))`, "resource settings");
  await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, "resource settings transition");
  state = await captureState(cdp, "resource-settings");
  assertLayout(state, "resource-settings");
  report.settingsIconProportions = await cdp.evaluate(`(${measureSettingsIconProportions.toString()})()`);
  assertSettingsIconProportions(report.settingsIconProportions);
  const settingsTabs = await cdp.evaluate(`document.querySelectorAll(".settings-tabs button").length`);
  if (settingsTabs < 5) throw new Error(`RESOURCE_SETTINGS_CATEGORIES_MISSING:${settingsTabs}`);
  for (let index = 1; index <= settingsTabs; index += 1) {
    await tapSelector(cdp, `.settings-tabs button:nth-child(${index})`, `resource settings tab ${index}`);
    state = await current();
    assertLayout(state, `resource settings tab ${index}`);
  }
  await tapSelector(cdp, '[data-testid="settings-finish"]', "resource settings finish");
  await waitFor(cdp, `Boolean(document.querySelector('[data-testid="game-state-title"], [data-testid="main-menu"]'))`, "resource title after settings");
  report.requiredCoverage.settings = "PASS";

  for (const [testid, screen, label] of [
    ["open-about", "about-screen", "resource about"],
    ["open-help", "help-screen", "resource help"],
  ]) {
    await tapSelector(cdp, `[data-testid="${testid}"]`, `${label} open`);
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="${screen}"]'))`, `${label} screen`);
    await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, `${label} transition`);
    state = await captureState(cdp, label);
    assertLayout(state, label);
    await tapSelector(cdp, flow.back, `${label} return`);
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="game-state-title"], [data-testid="main-menu"]'))`, `${label} returned`);
    report.requiredCoverage[label.includes("about") ? "about" : "help"] = "PASS";
  }

  await tapSelector(cdp, '[data-testid="start-new-game"]', "resource start game");
  await waitFor(cdp, `Boolean(document.querySelector(".story-player") && document.querySelector(".dialog-box"))`, "resource story");
  await settle();
  await waitFor(cdp, `document.querySelector('.story-player')?.getAttribute('data-is-typing') === 'false'
    && !document.querySelector('[data-testid="renpy-quick-save"]')?.disabled`, "resource ready dialogue and native save");
  state = await captureState(cdp, "resource-playing");
  assertLayout(state, "resource-playing");
  if (!state.player?.dialog) throw new Error("RESOURCE_DIALOG_MISSING");
  const expectedBackground = scope === "installed-full-story" ? "story_background" : "p1_acceptance_background";
  const background = await cdp.evaluate(`(async () => {
    const frame = document.querySelector('.background-transition-frame.is-current[data-background-id="${expectedBackground}"]');
    if (!frame || frame.classList.contains("is-missing")) return null;
    const source = getComputedStyle(frame).backgroundImage.match(/url\\(["']?(.*?)["']?\\)/)?.[1];
    if (!source) return null;
    const image = new Image(); image.src = source; await image.decode();
    const rect = frame.getBoundingClientRect();
    return { assetId: frame.dataset.backgroundId, source, naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight, rect: rect.toJSON() };
  })()`);
  if (!background || background.naturalWidth !== 1920 || background.naturalHeight !== 1080
    || background.rect.width <= 0 || background.rect.height <= 0) {
    throw new Error(`RESOURCE_VISUAL_ASSET_NOT_RENDERED:${JSON.stringify(background)}`);
  }
  report.resourceEvidence = background;
  report.requiredCoverage.title = "PASS";
  report.requiredCoverage.resources = "PASS";

  const bar = await cdp.evaluate(`(() => {
    const node = document.querySelector('[data-testid="renpy-quick-bar"]');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      overflow: node.scrollWidth - node.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      buttons: [...node.querySelectorAll("button")].map(button => {
        const value = button.getBoundingClientRect();
        const hit = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
        return { label: button.textContent.trim(), rect: { x: value.x, y: value.y, width: value.width, height: value.height },
          hit: hit === button || button.contains(hit),
          clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1 };
      }),
    };
  })()`);
  if (!bar) throw new Error("RESOURCE_RENPY_QUICK_BAR_MISSING");
  assertRenpyQuickBarGeometry(bar, { width: (await current()).innerWidth, height: (await current()).innerHeight });
  report.quickBarGeometry = bar;
  report.requiredCoverage.quickBar = "PASS";
  await checkBar("initial-playing");
  await waitFor(cdp, `document.querySelector('.story-player')?.getAttribute('data-is-typing') === 'false'`, "resource dialogue fully revealed");
  const savedPosition = await position();
  const rollbackDisabled = await cdp.evaluate(`document.querySelector('[data-testid="renpy-quick-rollback"]')?.disabled === true`);
  if (!rollbackDisabled) throw new Error("RESOURCE_FIRST_DIALOGUE_ROLLBACK_MUST_BE_DISABLED");

  await tapSelector(cdp, '[data-testid="renpy-quick-history"]', "resource history");
  await waitFor(cdp, `Boolean(document.querySelector(".history-list"))`, "resource history loaded");
  const historyText = await cdp.evaluate(`document.querySelector(".history-list")?.textContent`);
  if (!historyText?.includes(savedPosition.dialog)) throw new Error("RESOURCE_DIALOGUE_HISTORY_MISSING");
  await captureState(cdp, "resource-history");
  await tapSelector(cdp, flow.back, "resource history return");
  await restorePosition(savedPosition);
  await checkBar("after-history-return");

  await tapSelector(cdp, '[data-testid="renpy-quick-save"]', "resource quick save");
  await waitFor(cdp, `document.body.innerText.includes("快存已保存")`, "resource quick save completed");
  await tapSelector(cdp, '[data-testid="renpy-quick-load"]', "resource quick load");
  await waitFor(cdp, `Boolean(document.querySelector('[data-runtime-modal="true"]'))`, "resource quick load confirmation");
  await tapSelector(cdp, '[data-testid="confirm-quick-load"]', "resource quick load confirm");
  await waitFor(cdp, `Boolean(document.querySelector(".story-player"))`, "resource quick load returned");
  await restorePosition(savedPosition);
  await checkBar("after-quick-load");
  report.requiredCoverage.quickSaveLoad = "PASS";

  await tapSelector(cdp, flow.save, "resource manual save load");
  await waitFor(cdp, `Boolean(document.querySelector(".save-load-screen"))`, "resource save load screen");
  await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, "resource save load transition");
  await tapSelector(cdp, '[data-testid="save-slot-manual-1"] .save-card-main', "resource manual save");
  await waitFor(cdp, `Boolean(document.querySelector('[data-testid="save-slot-manual-1"].has-save'))`, "resource manual save persisted");
  await tapSelector(cdp, '.save-mode-switch button:nth-child(2)', "resource switch load");
  await tapSelector(cdp, '[data-testid="save-slot-manual-1"] .save-card-main', "resource manual load");
  await waitFor(cdp, `Boolean(document.querySelector(".story-player"))`, "resource manual load returned");
  await restorePosition(savedPosition);
  await checkBar("after-manual-load");
  report.requiredCoverage.saveWriteRead = "PASS";
  await tapSelector(cdp, flow.save, "resource save load return entry");
  await waitFor(cdp, `Boolean(document.querySelector(".save-load-screen"))`, "resource save return entry ready");
  await tapSelector(cdp, flow.back, "resource save load return");
  await restorePosition(savedPosition);
  await checkBar("before-rotation");
  report.requiredCoverage.return = "PASS";

  await cdp.evaluate(`window.__agentvnAcceptanceRotationBefore = { width: innerWidth, height: innerHeight }`);
  const sensorState = run(['emu', 'sensor', 'get', 'acceleration']);
  sensorBefore = sensorState.match(/acceleration\s*=\s*(-?[\d.]+:-?[\d.]+:-?[\d.]+)/)?.[1];
  if (!sensorBefore) throw new Error('RESOURCE_ROTATION_SENSOR_STATE_UNAVAILABLE');
  run(["shell", "cmd", "window", "user-rotation", "lock", "3"]);
  rotationLocked = true;
  sensorAdjusted = true;
  const sensor = run(['emu', 'sensor', 'set', 'acceleration', '-9.81:0:0']);
  if (!sensor) throw new Error('RESOURCE_REVERSE_ROTATION_SENSOR_COMMAND_EMPTY');
  let windowState;
  await waitFor({ evaluate: async () => {
    windowState = run(['shell', 'dumpsys', 'window', 'displays']);
    try { assertDisplayRotation(windowState, 270); return true; } catch { return false; }
  } }, 'true', 'actual reverse landscape display rotation', 15000);
  await waitFor(cdp, `innerWidth > innerHeight && Boolean(document.querySelector('[data-testid="renpy-quick-bar"]'))`, "resource reverse landscape");
  const rotatedBar = await cdp.evaluate(`(() => {
    const node = document.querySelector('[data-testid="renpy-quick-bar"]');
    const rect = node?.getBoundingClientRect();
    return rect ? { width: rect.width, height: rect.height, buttons: node.querySelectorAll("button").length } : null;
  })()`);
  if (!rotatedBar || rotatedBar.buttons !== 8) throw new Error("RESOURCE_ROTATION_QUICK_BAR_INVALID");
  windowState = run(['shell', 'dumpsys', 'window', 'displays']);
  const observedRotationDegrees = assertDisplayRotation(windowState, 270);
  state = await captureState(cdp, "resource-reverse-landscape");
  assertLayout(state, "resource-reverse-landscape");
  await restorePosition(savedPosition);
  const dockAfterRotation = await checkBar("after-rotation", false);
  assertResourceBarSafeDock(dockAfterRotation, "after-rotation");
  report.rotationEvidence = { status: "PASS", requestedDegrees: 270, observedDegrees: observedRotationDegrees,
    sensorBefore, sensorRequested: '-9.81:0:0', sensorObserved: run(['emu', 'sensor', 'get', 'acceleration']),
    before: await cdp.evaluate("window.__agentvnAcceptanceRotationBefore"), after: rotatedBar, windowState };
  report.requiredCoverage.rotation = "PASS";
  if (scope === "installed-full-story") {
    // Run the authored story after the common real-device resource/menu/rotation
    // checks, preserving the native cleanup and log collection around both.
    await exerciseInstalledFullStory(cdp);
  }
  await exerciseRuntimeStability(cdp);
  report.requiredCoverage.stability = "PASS";
}

async function exerciseInstalledFullStory(cdp) {
  const fixtureFile = option("--story-fixture");
  if (!fixtureFile) throw new Error("FULL_STORY_FIXTURE_REQUIRED");
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  const JSZip = require("../editor/node_modules/jszip");
  const archive = await JSZip.loadAsync(fs.readFileSync(stagingApk));
  const readEntry = async suffix => {
    const entries = Object.values(archive.files).filter(entry => !entry.dir
      && entry.name.endsWith(`embedded-cartridge/${suffix}`));
    if (entries.length !== 1) throw new Error(`FULL_STORY_APK_ENTRY_AMBIGUOUS:${suffix}`);
    const bytes = await entries[0].async("nodebuffer");
    return { data: JSON.parse(bytes.toString("utf8")),
      sha256: require("node:crypto").createHash("sha256").update(bytes).digest("hex") };
  };
  const manifest = await readEntry("manifest.json"), script = await readEntry("script.json");
  validateFullStoryInput(fixture, manifest.data, script.data);
  report.fullStorySource = { fixture: fileEvidence(fixtureFile),
    manifestSha256: manifest.sha256, scriptSha256: script.sha256, assets: [] };
  for (const asset of manifest.data.assets) {
    const entries = Object.values(archive.files).filter(entry => !entry.dir
      && entry.name.endsWith(`embedded-cartridge/${asset.path}`));
    if (entries.length !== 1) throw new Error(`FULL_STORY_ASSET_AMBIGUOUS:${asset.asset_id}`);
    const bytes = await entries[0].async("nodebuffer");
    const actual = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    if (actual !== asset.hash_sha256) throw new Error(`FULL_STORY_ASSET_HASH_MISMATCH:${asset.asset_id}`);
    report.fullStorySource.assets.push({ assetId: asset.asset_id, path: entries[0].name,
      bytes: bytes.length, sha256: actual });
  }
  const geometry = async () => {
    const state = await dom(cdp); assertLayout(state, "full-story");
    const value = await cdp.evaluate(`(() => {
      const dialog = document.querySelector('.dialog-box'), bar = document.querySelector('.renpy-quick-bar');
      const text = dialog?.querySelector('.dialog-text') || dialog?.querySelector('.nvl-page');
      const rect = element => element?.getBoundingClientRect().toJSON();
      const glyphs = (${renderedDialogGlyphs.toString()})(text);
      return { dialog: rect(dialog), bar: rect(bar), glyphs, width: innerWidth, height: innerHeight,
        overflowX: text ? text.scrollWidth - text.clientWidth : 0,
        overflowY: text ? text.scrollHeight - text.clientHeight : 0 };
    })()`);
    const assert = require("node:assert/strict"), bounds = value.dialog;
    assert(bounds && value.bar && value.glyphs.length, "Full-story geometry missing");
    assert(bounds.x >= -1 && bounds.y >= -1 && bounds.right <= value.width + 1
      && bounds.bottom <= value.height + 1, "Full-story dialogue outside screen");
    assert(value.overflowX <= 1 && value.overflowY <= 1, "Full-story text is cropped or scrolling");
    for (const rect of value.glyphs) {
      assert(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
        && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1, "Full-story glyph cropped");
      assert(Math.min(rect.right, value.bar.right) - Math.max(rect.left, value.bar.left) <= 1
        || Math.min(rect.bottom, value.bar.bottom) - Math.max(rect.top, value.bar.top) <= 1,
      "Full-story glyph overlaps quick bar");
    }
    return { dialog: bounds, glyphCount: value.glyphs.length,
      overflowX: value.overflowX, overflowY: value.overflowY };
  };
  await exerciseFullStory({ cdp, script: script.data, report, geometry,
    tap: (selector, label) => tapSelector(cdp, selector, label),
    wait: (expression, label) => waitFor(cdp, expression, label),
    capture: label => captureState(cdp, label),
    save: () => fs.writeFileSync(path.join(outputDir, "runtime-smoke-report.json"),
      JSON.stringify(report, null, 2), "utf8") });
  for (const key of ["branch", "sprites", "pagination", "nvl", "bubble", "rollback", "menuActions"])
    report.requiredCoverage[key] = "PASS";
}

async function main() {
  report.isElevated = isElevated();
  if (!report.isElevated) fail("管理员权限未生效，已停止 Android 验收。", "ANDROID_ADMIN_REQUIRED");
  if (!apkPath || !fs.existsSync(apkPath)) fail(`APK not found: ${apkPath}`, "APK_MISSING");
  if (!packageName) fail("--package is required for deterministic APK UI testing", "APK_PACKAGE_REQUIRED");
  if (!['complete-runtime', 'installed-resources', 'installed-full-story', 'installed-agentvn-title', 'installed-hidden-growth', 'installed-package-smoke'].includes(scope)) fail(`Unsupported acceptance scope: ${scope}`, 'SCOPE_INVALID');
  report.scope = scope;
  if (packageSmokeScope) {
    if (rendererOnly) throw new Error("Package smoke requires actual gameplay touches, not renderer-only diagnostics");
    report.packageSmokeInput = await validatePackageSmokeApk(apkPath, option("--story-fixture"));
    report.requiredCoverage = packageSmokeCoverage();
    report.excludedCoverage = {
      completeRuntime: "Asset-free three-line AgentVN fixture only; no full-story or final-project claim",
      advancedCapabilities: "No NVL, bubble, branches, sprites, pagination, quicksave, skip or rollback proof",
      upgrade: "No credible old same-identity signed APK supplied; restart is not upgrade",
      audio: "Fixture has no audio assets; user's prior confirmation retained elsewhere, no new listening",
      legacyAndroid: "API35 does not cover Android<10 devices",
    };
  }
  if (hiddenGrowthScope) {
    if (rendererOnly) throw new Error("Final user-project acceptance cannot be renderer-only");
    report.hiddenGrowthInput = await validateHiddenGrowthApk(apkPath, option("--story-fixture"));
    report.requiredCoverage = Object.fromEntries(["title", "settings", "about", "branch", "sprites",
      "dialogueIntegrity", "quickMenu", "saveWriteRead", "menuActions", "rotation", "stability", "return",
      "coldEmulatorBoot", "rendererWarnings"].map(key => [key, "NOT_RUN"]));
    report.excludedCoverage = {
      everyStoryRoute: "Representative canonical first branch; not every authored route or line",
      nvlBubbleRenpy: "Final original project uses AgentVN layout and ordinary dialogue; independent fixture evidence retained",
      legacyAndroid: "API35 is not the user's Android<10 phone",
    };
    const confirmation = JSON.parse(fs.readFileSync(option("--audio-confirmation"), "utf8"));
    if (confirmation.status !== "USER_CONFIRMED_PASS") throw new Error("AUDIO_USER_CONFIRMATION_INVALID");
    report.audioConfirmation = { ...confirmation, provenance: fileEvidence(option("--audio-confirmation")),
      appliedScope: "Retained explicit user audio confirmation; no new listening claimed", newCapture: false };
  }
  if (defaultTitleScope) {
    if (rendererOnly) throw new Error("Default title flow cannot be replaced by renderer-only diagnostics");
    report.defaultTitleInput = await validateDefaultTitleApk(apkPath, option("--story-fixture"));
    report.requiredCoverage = Object.fromEntries(["title", "titleContrast", "settingsReturn", "aboutReturn",
      "startGame", "coldEmulatorBoot", "rendererWarnings"].map(key => [key, "NOT_RUN"]));
    report.excludedCoverage = { fullStory: "Title/settings/about/start regression only; other stories retain their own evidence",
      legacyAndroid: "API35 is not the user's Android<10 device" };
    const confirmation = JSON.parse(fs.readFileSync(option("--audio-confirmation"), "utf8"));
    if (confirmation.status !== "USER_CONFIRMED_PASS") throw new Error("AUDIO_USER_CONFIRMATION_INVALID");
    report.audioConfirmation = { ...confirmation, provenance: fileEvidence(option("--audio-confirmation")),
      appliedScope: "retained user confirmation; no new capture/listening", newCapture: false };
  }
  if (scope === 'installed-resources') {
    report.requiredCoverage = Object.fromEntries(['title', 'settings', 'about', 'help', 'resources',
      'quickBar', 'saveWriteRead', 'quickSaveLoad', 'return', 'rotation', 'stability',
      'coldEmulatorBoot', 'rendererWarnings'].map(key => [key, 'NOT_RUN']));
    report.excludedCoverage = {
      branch: 'Not present in isolated fixture; final story acceptance pending',
      sprites: 'Not present in isolated fixture; final story acceptance pending',
      pagination: 'Not present in isolated fixture; final story acceptance pending',
      rollback: 'First dialogue disabled state only; valid rollback not claimed',
      audio: 'No audio asset in this APK; user confirmation retained separately, no new listening claimed',
    };
    const confirmationFile = option('--audio-confirmation');
    if (confirmationFile) {
      report.audioConfirmation = { ...JSON.parse(fs.readFileSync(confirmationFile, 'utf8')),
        provenance: fileEvidence(confirmationFile), newCapture: false };
    }
  }
  if (scope === "installed-full-story") {
    const fixtureFile = option("--story-fixture");
    if (!fixtureFile || !fs.existsSync(fixtureFile)) fail("Explicit full-story fixture missing", "FULL_STORY_FIXTURE_REQUIRED");
    report.requiredCoverage = Object.fromEntries(["title", "settings", "about", "help", "resources",
      "quickBar", "saveWriteRead", "quickSaveLoad", "return", "rotation", "stability",
      "branch", "sprites", "pagination", "nvl", "bubble", "rollback", "menuActions",
      "coldEmulatorBoot", "rendererWarnings"].map(key => [key, "NOT_RUN"]));
    const confirmation = option("--audio-confirmation");
    if (confirmation) {
      const prior = JSON.parse(fs.readFileSync(confirmation, "utf8"));
      if (prior.status !== "USER_CONFIRMED_PASS") throw new Error("AUDIO_USER_CONFIRMATION_INVALID");
      report.audioConfirmation = { ...prior, provenance: fileEvidence(confirmation),
        appliedScope: "User-approved retained audio conclusion; not a new APK capture or listening",
        newCapture: false };
    }
  }
  fs.mkdirSync(outputDir, { recursive: true });
  stagingApk ||= path.join(outputDir, 'staging.apk');
  if (path.resolve(stagingApk) === apkPath || path.dirname(path.resolve(stagingApk)) !== outputDir) fail('Staging must be a separate APK inside this run directory', 'UNSAFE_STAGING_PATH');
  const permission = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'android-acceptance-preflight.ps1'), '-OutputDir', outputDir], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  report.permission = JSON.parse(fs.readFileSync(path.join(outputDir, 'acceptance-permission.json'), 'utf8'));
  if (permission.status !== 0 || !report.permission.success || !report.permission.isElevated) fail('Administrator symlink probe failed', 'ANDROID_SYMLINK_REQUIRED');
  const metadataPath = `${apkPath}.acceptance.json`;
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : null;
  report.provenance = verifyProvenance(apkPath, metadata);
  report.stages.provenance = report.provenance.status;
  report.stages.build = metadata?.buildStatus === 'PASS' && report.provenance.status === 'PASS' ? 'PASS' : 'BLOCKED';
  report.sourceApk = fileEvidence(apkPath);
  fs.copyFileSync(apkPath, stagingApk, fs.constants.COPYFILE_EXCL);
  stagingCreated = true;
  report.stagingApk = fileEvidence(stagingApk);
  await requireFreePort(adbPort);
  await requireFreePort(cdpPort);
  adbOwned = true;
  run(['start-server']);
  await waitForRuntimeDevice();
  const bootPath = path.join(outputDir, 'cold-boot.json');
  report.coldBoot = verifyColdBoot(fs.existsSync(bootPath) ? JSON.parse(fs.readFileSync(bootPath, 'utf8')) : null,
    run(['shell', 'cat', '/proc/sys/kernel/random/boot_id']), report.startedAt);
  report.requiredCoverage.coldEmulatorBoot = report.coldBoot.status;
  const existing = runQuiet(['shell', 'pm', 'path', packageName]);
  if (/package:/.test(existing.stdout || '')) fail('Package is already installed; device is occupied. Existing user data was preserved.', 'DEVICE_OCCUPIED');
  run(["logcat", "-c"]);
  installAttempted = true;
  run(["install", stagingApk]);
  run(["shell", "pm", "clear", packageName]);
  run(["shell", "monkey", "-p", packageName, "1"]);
  await waitFor({
    evaluate: async (expression) => {
      const output = run(["shell", "dumpsys", "activity", "activities"]);
      return output.includes(packageName) && output.includes("ResumedActivity");
    },
  }, "true", "APK activity foreground", 20_000).catch(() => undefined);
  await delay(2500);
  // The APK requests sensor-landscape during launch. Read the physical
  // coordinate orientation after the activity is foreground; before launch
  // this API-35 image reports its portrait base orientation.
  report.viewport = { physical: parsePhysicalSize() };
  const cdp = await connectCdp();
  try {
    await waitFor(cdp, `(() => {
      window.__AGENTVN_RUNTIME_DIAGNOSTICS_ENABLED__ = true;
      return true;
    })()`, 'diagnostic context');
    await waitFor(
      cdp,
      `Boolean(
        document.querySelector('[data-testid="game-state-title"]')
        && !document.querySelector('.game-launch-blackout')
        && [...document.querySelectorAll('[data-testid="start-new-game"], [data-testid="open-save-load"], [data-testid="open-gallery"]')]
          .every((button) => !button.disabled)
        && (() => {
          const button = document.querySelector('[data-testid="open-settings"]');
          const rect = button?.getBoundingClientRect();
          const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
          return Boolean(button && hit && (hit === button || button.contains(hit)));
        })()
      )`,
      "title menu",
    );
    let state = await captureState(cdp, "title");
    assertLayout(state, "title");
    const layoutType = await cdp.evaluate(`(
      document.querySelector("[data-layout-type]")?.getAttribute("data-layout-type")
      || document.querySelector("[data-runtime-layout-type]")?.getAttribute("data-runtime-layout-type")
      || "agentvn"
    )`);
    report.layoutType = layoutType;
    assertTitlePolicy(layoutType, state.buttons);
    if (packageSmokeScope) {
      if (layoutType !== "agentvn") throw new Error("Package fixture requires AgentVN layout");
      await exercisePackageSmoke({
        cdp, input: report.packageSmokeInput, report,
        tap: (selector, label, options) => tapSelector(cdp, selector, label, options),
        wait: (expression, label, timeout) => waitFor(cdp, expression, label, timeout),
        capture: label => captureState(cdp, label), assertLayout,
        expand: label => ensureQuickMenuExpanded(cdp, label),
        rotation: () => exerciseReverseLandscape(cdp),
        stability: () => exerciseRuntimeStability(cdp),
        save: () => fs.writeFileSync(path.join(outputDir, "runtime-smoke-report.json"), JSON.stringify(report, null, 2)),
      });
    } else if (defaultTitleScope) {
      if (layoutType !== "agentvn") throw new Error("Default title must consume AgentVN layout");
      await exerciseAndroidDefaultTitle({ cdp, fixture: report.defaultTitleInput.fixture, report,
        tap: (selector, label) => tapSelector(cdp, selector, label),
        wait: (expression, label) => waitFor(cdp, expression, label),
        capture: label => captureState(cdp, label), assertLayout });
    } else if (hiddenGrowthScope) {
      if (layoutType !== "agentvn") throw new Error("Canonical final project must retain AgentVN layout");
      await exerciseHiddenGrowth({
        cdp, input: report.hiddenGrowthInput, report,
        tap: (selector, label, options) => tapSelector(cdp, selector, label, options),
        wait: (expression, label, timeout) => waitFor(cdp, expression, label, timeout),
        capture: label => captureState(cdp, label), assertLayout,
        expand: label => ensureQuickMenuExpanded(cdp, label),
        menuActions: () => exerciseMenuActions(cdp),
        rotation: () => exerciseReverseLandscape(cdp),
        stability: () => exerciseRuntimeStability(cdp),
        systemBack: async () => {
          (report.systemBackEvents ??= []).push({ at: new Date().toISOString(), interaction: "administrator-adb-keyevent-4" });
          run(["shell", "input", "keyevent", "4"]);
        },
        save: () => fs.writeFileSync(path.join(outputDir, "runtime-smoke-report.json"), JSON.stringify(report, null, 2)),
      });
    } else if (rendererOnly) {
      report.diagnosticOnly = true;
      report.diagnosticScope = 'renderer-startup-lifecycle-not-gameplay-acceptance';
      report.requiredCoverage = { title: 'PASS', coldEmulatorBoot: report.coldBoot.status,
        rendererWarnings: 'NOT_RUN' };
    } else if (scope === 'installed-resources' || scope === 'installed-full-story') {
      await exerciseInstalledResources(cdp, layoutType);
    } else {
    const titleOptionsButton = state.buttons.find((button) => button.testid === "open-settings");
    if (!titleOptionsButton || !titleOptionsButton.label.trim()) {
      throw new Error(`title menu options accessible label missing: ${JSON.stringify(titleOptionsButton)}`);
    }

    await tapSelector(cdp, '[data-testid="open-settings"]', "open settings");
    await waitFor(cdp, `Boolean(document.querySelector(".settings-screen"))`, "settings screen");
    await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, "settings transition");
    state = await captureState(cdp, "settings");
    assertLayout(state, "settings");
    report.settingsIconProportions = await cdp.evaluate(`(${measureSettingsIconProportions.toString()})()`);
    assertSettingsIconProportions(report.settingsIconProportions);
    if (!state.buttons.some((button) => button.testid === "open-exit-confirmation" && button.interactive)) {
      throw new Error("options screen must expose an interactive exit text link");
    }
    const exitLinkStyle = await cdp.evaluate(`(() => {
      const element = document.querySelector('[data-testid="open-exit-confirmation"]');
      const normal = document.querySelector(".settings-tabs button");
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        borderWidth: style.borderWidth,
        fontSize: Number.parseFloat(style.fontSize),
        normalFontSize: normal ? Number.parseFloat(getComputedStyle(normal).fontSize) : 0,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        viewport: { width: innerWidth, height: innerHeight },
      };
    })()`);
    if (!exitLinkStyle || Number.parseFloat(exitLinkStyle.borderWidth) > 1) {
      throw new Error(`options exit link has an excessive border: ${JSON.stringify(exitLinkStyle)}`);
    }
    if (!(exitLinkStyle.fontSize < exitLinkStyle.normalFontSize)) {
      throw new Error(`options exit link must use smaller text: ${JSON.stringify(exitLinkStyle)}`);
    }
    if (
      exitLinkStyle.rect.left < 0
      || exitLinkStyle.rect.top < 0
      || exitLinkStyle.rect.right > exitLinkStyle.viewport.width
      || exitLinkStyle.rect.bottom > exitLinkStyle.viewport.height
    ) {
      throw new Error(`options exit link is outside viewport: ${JSON.stringify(exitLinkStyle)}`);
    }
    await tapSelector(cdp, '[data-testid="open-exit-confirmation"]', "open options exit confirmation");
    await waitFor(cdp, `Boolean(document.querySelector('[data-runtime-modal="true"]'))`, "options exit confirmation");
    await tapSelector(cdp, '.modal-actions button:first-child', "cancel options exit confirmation");
    await waitFor(cdp, `Boolean(document.querySelector(".settings-screen"))`, "options after exit cancel");
    const tabCount = await cdp.evaluate(`document.querySelectorAll(".settings-tabs button").length`);
    for (let index = 1; index <= tabCount; index += 1) {
      await tapSelector(cdp, `.settings-tabs button:nth-child(${index})`, `settings tab ${index}`);
      state = await dom(cdp);
      assertLayout(state, `settings tab ${index}`);
      if (index === tabCount) {
        await cdp.evaluate(`(() => {
          const content = document.querySelector(".settings-content");
          if (content) content.scrollTop = content.scrollHeight;
        })()`);
        await delay(200);
        state = await dom(cdp);
        assertLayout(state, "settings system scrolled bottom");
      }
    }
    await tapSelector(cdp, '[data-testid="settings-finish"]', "settings finish");
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="game-state-title"], [data-testid="main-menu"]'))`, "title after settings");
    await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, "title transition after settings");

    await tapSelector(cdp, '[data-testid="open-about"]', "open about");
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="about-screen"]'))`, "about screen");
    await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, "about transition");
    state = await captureState(cdp, "about");
    assertLayout(state, "about");
    await tapSelector(cdp, '[data-testid="back-to-main-menu"]', "about back");
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="game-state-title"], [data-testid="main-menu"]'))`, "title after about");
    await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, "title transition after about");

    await tapSelector(cdp, '[data-testid="open-gallery"]', "open gallery");
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="gallery-screen"]'))`, "gallery screen");
    await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, "gallery transition");
    state = await captureState(cdp, "gallery");
    assertLayout(state, "gallery");
    if (!/已解锁|未解锁/.test(state.text)) throw new Error("gallery screen did not render unlock state text");
    await tapSelector(cdp, '[data-testid="back-to-main-menu"]', "gallery back");
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="game-state-title"], [data-testid="main-menu"]'))`, "title after gallery");
    await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, "title transition after gallery");

    await tapSelector(cdp, '[data-testid="start-new-game"]', "start game");
    await waitFor(cdp, `Boolean(document.querySelector(".story-player") && document.querySelector(".dialog-box"))`, "story player");
    await delay(1200);
    state = await captureState(cdp, "playing");
    assertLayout(state, "playing");
    if (!state.player?.dialog) throw new Error("playing screen has no dialogue text");
    fs.writeFileSync(path.join(outputDir, 'audio-flinger-before.txt'), run(['shell', 'dumpsys', 'media.audio_flinger']), 'utf8');
    await waitFor(
      cdp,
      `Boolean(window.__AGENTVN_RUNTIME_DIAGNOSTICS__?.audio?.some((entry) => entry.payload?.phase === "play-request" && entry.payload?.kind === "bgm"))`,
      "BGM play request",
      20_000,
    );
    const activeBgm = await cdp.evaluate(`(() => {
      const entries = window.__AGENTVN_RUNTIME_DIAGNOSTICS__?.audio || [];
      return [...entries].reverse().find((entry) =>
        entry.payload?.kind === 'bgm' && entry.payload?.phase === 'play-request'
      )?.payload?.assetId || null;
    })()`);
    if (emulatorDiscovery) {
      report.audioFocusBeforeCapture = await readAudioFocusSnapshot(cdp);
      const captureSeconds = 8;
      const capture = spawnSync(option('--python', 'python'), [path.join(__dirname, 'capture-emulator-audio.py'), '--discovery', emulatorDiscovery, '--output', path.join(outputDir, 'audio'), '--seconds', String(captureSeconds)], { encoding: 'utf8', windowsHide: true, timeout: captureProcessTimeoutMs(captureSeconds) });
      const audioReport = path.join(outputDir, 'audio', 'audio-capture-report.json');
      report.audioCapture = fs.existsSync(audioReport) ? JSON.parse(fs.readFileSync(audioReport, 'utf8')) : { status: 'BLOCKED', error: String(capture.error || capture.stderr) };
      report.audioSourceComparison = compareCapturedAudio({ apkPath: stagingApk,
        apkSha256: report.stagingApk.sha256, capture: report.audioCapture, assetId: activeBgm,
        outputDir: path.join(outputDir, 'audio'), python: option('--python', 'python') });
    }
    fs.writeFileSync(path.join(outputDir, 'audio-flinger-after.txt'), run(['shell', 'dumpsys', 'media.audio_flinger']), 'utf8');
    await ensureQuickMenuExpanded(cdp, "open quick menu");
    await waitFor(cdp, `Boolean(document.querySelector(".quick-menu-surface.is-expanded"))`, "expanded quick menu");
    state = await captureState(cdp, "quick-menu");
    assertLayout(state, "quick-menu");
    const saveButton = state.buttons.find((button) => (
      button.testid === "quick_save_load_button" || button.componentId === "quick_save_load_button"
    ));
    if (!saveButton || saveButton.disabled) throw new Error("normal gameplay save button should be enabled");
    await tapSelector(cdp, '[data-ui-component-id="quick_save_load_button"]', "open save load");
    await waitFor(cdp, `Boolean(document.querySelector(".save-load-screen"))`, "save load screen");
    await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, "save load transition");
    state = await captureState(cdp, "save-load");
    for (const button of state.buttons) {
      if (!button.className.split(/\s+/).includes("save-card-main") || !rectOutsideRoot(button.rect, state.root)) continue;
      button.reachableRect = await tapSelector(
        cdp, `button.save-card-main[aria-label=${JSON.stringify(button.label)}]`,
        `reach ${button.label}`, { scrollOnly: true },
      );
    }
    assertLayout(state, "save-load");
    const savedPosition = report.screens.find(screen => screen.label === 'playing')?.state.player;
    await tapSelector(cdp, '[data-testid="save-slot-manual-1"] .save-card-main', 'save manual slot 1');
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="save-slot-manual-1"].has-save .save-card-main:not(:disabled)'))`, 'manual save persisted');
    await tapSelector(cdp, '.save-mode-switch button:nth-child(2)', 'switch to load');
    await tapSelector(cdp, '[data-testid="save-slot-manual-1"] .save-card-main', 'load manual slot 1');
    await waitFor(cdp, `Boolean(document.querySelector('.story-player'))`, 'loaded story');
    await captureState(cdp, 'save-reloaded');
    const loadedPosition = (await dom(cdp)).player;
    if (!loadedPosition || loadedPosition.sceneId !== savedPosition?.sceneId || loadedPosition.commandIndex !== savedPosition?.commandIndex) throw new Error('SAVE_LOAD_POSITION_MISMATCH');
    report.requiredCoverage.saveWriteRead = 'PASS';
    await ensureQuickMenuExpanded(cdp, 'menu after load');
    await tapSelector(cdp, '[data-ui-component-id="quick_save_load_button"]', 'save screen after load');
    await waitFor(cdp, `Boolean(document.querySelector('.save-load-screen'))`, 'save screen restored');
    await tapSelector(cdp, '[data-testid="back-to-player"]', "save load back");
    await waitFor(cdp, `Boolean(document.querySelector(".story-player"))`, "player after save load");
    await waitFor(cdp, `document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`, "player transition after save load");
    await waitFor(
      cdp,
      `Boolean(document.querySelector(".story-player .dialog-text")?.textContent?.trim())`,
      "player dialogue after save load",
    );
    state = await dom(cdp);
    const before = state.player;
    if (!before?.dialog) throw new Error("player did not restore dialogue after save-load screen");
    await tapSelector(cdp, ".dialog-box", "dialog advance");
    await delay(150);
    const after = await dom(cdp);
    if (after.player && after.player.commandIndex > before.commandIndex + 1) {
      throw new Error(`one touch advanced more than one command: ${before.commandIndex} -> ${after.player.commandIndex}`);
    }
    report.screens.push({ label: "playing-after-touch", state: after, screenshot: captureScreenshot("playing-after-touch") });
    await exerciseStory(cdp);

    if ((await dom(cdp)).player) {
      await exerciseMenuActions(cdp);
      await exerciseReverseLandscape(cdp);
      await exerciseRuntimeStability(cdp);
      await ensureQuickMenuExpanded(cdp, "reopen quick menu");
      await tapSelector(cdp, '[data-testid="open-main-menu"]', "open main menu from player");
      await waitFor(cdp, `Boolean(document.querySelector('[data-testid="game-state-title"], [data-testid="main-menu"]'))`, "title after player menu");
      report.menuActions.mainMenu = 'PASS';
      report.requiredCoverage.menuActions = Object.values(report.menuActions).every(value => value === 'PASS') ? 'PASS' : 'FAILED';
    } else {
      await waitFor(cdp, `Boolean(document.querySelector('[data-testid="game-state-title"], [data-testid="main-menu"]'))`, "title after story ending");
    }
    state = await captureState(cdp, "title-after-player-menu");
    assertLayout(state, "title-after-player-menu");
    }
  } finally {
    cdp.close();
  }

  const pid = run(["shell", "pidof", packageName]).trim().split(/\s+/)[0];
  const appLogcat = pid
    ? run(["logcat", "-d", "-v", "threadtime", "--pid", pid])
    : "";
  const fatalLogcat = run([
    "logcat", "-d", "-v", "threadtime",
    "AndroidRuntime:E", "DEBUG:E", "libc:F", "ActivityManager:E", "*:S",
  ]);
  const logcat = `${appLogcat}\n${fatalLogcat}`;
  const lines = logcat.split(/\r?\n/).filter(Boolean);
  const appFatalLines = runtimeFailures(lines, packageName, pid ? [pid] : []);
  report.logcat = {
    pid: pid || null,
    fatal: appFatalLines,
    errors: lines.filter((line) => /\sE\s|: E\//.test(line) && /sampleqa|agentvn|chromium/i.test(line)),
    warnings: lines.filter((line) => /\sW\s|: W\//.test(line) && /sampleqa|agentvn|chromium/i.test(line)),
  };
  fs.writeFileSync(path.join(outputDir, "logcat.txt"), logcat, "utf8");
  const diagnosticAudio = report.screens
    .flatMap((screen) => screen.state.diagnostics?.audio || [])
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.at === entry.at && candidate.payload?.phase === entry.payload?.phase) === index);
  const mediaSession = run(["shell", "dumpsys", "media_session"]);
  const audioService = run(["shell", "dumpsys", "audio"]);
  const playRequestObserved = diagnosticAudio.some((entry) => entry.payload?.phase === "play-request" && entry.payload?.kind === "bgm");
  const audioServiceObserved = mediaSession.includes(packageName) || audioService.includes(packageName);
  report.audio = {
    observedAudioElements: report.screens.flatMap((screen) => screen.state.audioElements || []),
    diagnosticEvents: diagnosticAudio,
    mediaSessionObserved: mediaSession.includes(packageName),
    audioServiceObserved: audioService.includes(packageName),
    status: playRequestObserved && audioServiceObserved ? "PLAYBACK_OBSERVED" : "NOT_OBSERVED",
  };
  fs.writeFileSync(path.join(outputDir, "media-session.txt"), mediaSession, "utf8");
  fs.writeFileSync(path.join(outputDir, "audio-service.txt"), audioService, "utf8");
  await restartTrials();
  const runtimeCoverage = rendererOnly ? Object.keys(report.requiredCoverage) : scope === 'installed-resources'
    ? ['title', 'settings', 'about', 'help', 'resources', 'quickBar', 'saveWriteRead', 'quickSaveLoad', 'return', 'rotation', 'stability', 'coldEmulatorBoot', 'rendererWarnings']
    : Object.keys(report.requiredCoverage);
  report.stages.runtime = report.logcat.fatal.length ? 'FAILED'
    : runtimeCoverage.every(key => report.requiredCoverage[key] === 'PASS') ? 'PASS' : 'BLOCKED';
  // Events and active tracks prove a request, not audible output. A scoped
  // capture, source comparison and listening evidence are still required.
  report.stages.audio = report.audioSourceComparison?.sourceComparisonStatus === 'FAILED' ? 'FAILED' : 'BLOCKED';
  report.audio.outputCaptureStatus = 'BLOCKED';
  report.audio.reason = report.audioSourceComparison?.reason || 'SCOPED_OUTPUT_CAPTURE_AND_LISTENING_REQUIRED';
  if ((scope === "installed-full-story" || defaultTitleScope || hiddenGrowthScope) && report.audioConfirmation?.status === "USER_CONFIRMED_PASS") {
    report.stages.audio = "PASS";
    report.audio.confirmationSource = "retained-user-confirmation";
    report.audio.reason = "User explicitly accepted audio; no new capture or listening claimed";
  }
  if (packageSmokeScope) report.audio.reason =
    "No audio assets in this isolated fixture; audio excluded from this limited smoke, no new listening claimed";
  report.status = acceptanceStatus(report.stages);
  report.finishedAt = new Date().toISOString();
  cleanupArtifacts();
  Object.assign(report, runtimeFailureDetails(report));
  if (rendererOnly) {
    report.runtimeTrialStatus = report.status;
    report.status = rendererDiagnosticStatus(report.status);
  }
  fs.writeFileSync(path.join(outputDir, "runtime-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (rendererOnly && report.status === 'RENDERER_DIAGNOSTIC_PASS') {
    console.log(`Renderer startup diagnostics collected; no full gameplay claim: ${path.join(outputDir, "runtime-smoke-report.json")}`);
    return;
  }
  if (packageSmokeScope && report.status === "INSTALLED_PACKAGE_SMOKE_PASS") {
    console.log(`Android installed-package limited smoke passed: ${path.join(outputDir, "runtime-smoke-report.json")}`);
    return;
  }
  if (scope === 'installed-resources' && report.status === 'INSTALLED_RESOURCE_SMOKE_PASS') {
    report.failureCode = null;
    report.audio.reason = 'No audio assets in isolated resource fixture; user confirmation recorded separately';
    fs.writeFileSync(path.join(outputDir, "runtime-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Android installed resource smoke passed: ${path.join(outputDir, "runtime-smoke-report.json")}`);
    return;
  }
  if (report.status !== "RUNTIME_PASS") throw new Error(report.message);
  console.log(`Android APK runtime QA passed: ${path.join(outputDir, "runtime-smoke-report.json")}`);
}

main().catch((error) => {
  try {
    if (installAttempted && !cleanupAttempted) {
      try { captureScreenshot('failure'); } catch (captureError) { report.failureCaptureError = String(captureError); }
      const failureLog = runQuiet(['logcat', '-d', '-v', 'threadtime']);
      fs.writeFileSync(path.join(outputDir, 'failure-logcat.txt'), `${failureLog.stdout || ''}\n${failureLog.stderr || ''}`, 'utf8');
      const fatal = runtimeFailures(failureLog.stdout || '', packageName, report.logcat.pid ? [report.logcat.pid] : []);
      if (fatal.length) {
        report.logcat.fatal = fatal;
        report.stages.runtime = 'FAILED';
        report.failureCode = 'ANDROID_FATAL_RUNTIME_ERROR';
      }
    }
    if (installAttempted && !cleanupAttempted && !['PASS', 'FAILED'].includes(report.stages.runtime)) report.stages.runtime = /ETIMEDOUT|TIMEOUT|offline|not found|No WebView|No running process|CAPTURE_UNAVAILABLE/i.test(String(error)) ? 'BLOCKED' : 'FAILED';
    cleanupArtifacts();
    report.status = packageSmokeScope ? packageSmokeStatus(report.stages, report.requiredCoverage)
      : scope === 'installed-resources' ? resourceSmokeStatus(report.stages) : acceptanceStatus(report.stages);
    fs.mkdirSync(outputDir, { recursive: true });
    report.failureCode ||= "ANDROID_APK_RUNTIME_QA_FAILED";
    report.message = error instanceof Error ? error.message : String(error);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "runtime-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch {
    // Preserve the original error.
  }
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
