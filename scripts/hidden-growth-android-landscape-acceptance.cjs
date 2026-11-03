#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
function option(name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
}

const apkPath = path.resolve(option("--apk", path.join(root, "output", "hidden-growth", "android", "隐忍的成长-0.1.0.apk")));
const stagingApk = option("--staging-apk", "");
const packageName = option("--package", "com.agentvn.hidden.growth");
const serial = option("--serial", "emulator-5554");
const sdkRoot = path.resolve(option("--sdk", "D:\\Android_dev\\Sdk"));
const outputDir = path.resolve(option("--output", path.join(root, "output", "hidden-growth", "android", "landscape-acceptance")));
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const cartridge = path.join(root, "output", "hidden-growth", "hidden-growth.vncart");
const unpackedManifest = path.join(root, "output", "hidden-growth", "unpacked", "manifest.json");
const unpackedLayout = path.join(root, "output", "hidden-growth", "unpacked", "ui", "layout.json");

const report = {
  schemaVersion: 1,
  status: "FAIL",
  failureCode: null,
  startedAt: new Date().toISOString(),
  apkPath,
  packageName,
  serial,
  outputDir,
  resolutions: [],
  sourceArtifacts: null,
  systemUiChecks: [],
  uninstallStatus: "NOT_RUN",
  apkCleanupStatus: "NOT_RUN",
  cleanupError: null,
  isElevated: null,
};

function isElevated() {
  if (process.platform !== "win32") return true;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent().IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status === 0 && result.stdout.trim().toLowerCase() === "true") return true;
  // PowerShell can observe a filtered token when Node is launched from a
  // split-token elevated shell. fltmc is a direct privileged-operation probe.
  const privilegeProbe = spawnSync("fltmc.exe", [], { windowsHide: true, stdio: "ignore" });
  return privilegeProbe.status === 0;
}

let cleanupAttempted = false;
function cleanupArtifacts() {
  if (cleanupAttempted || report.isElevated !== true) return;
  cleanupAttempted = true;
  try {
    const uninstall = spawnSync(adb, ["-s", serial, "uninstall", packageName], { encoding: "utf8", windowsHide: true });
    report.uninstallStatus = uninstall.status === 0 || /Unknown package/i.test(`${uninstall.stdout}\n${uninstall.stderr}`)
      ? "PASS"
      : `FAIL:${(uninstall.stderr || uninstall.stdout || "").trim()}`;
    if (report.uninstallStatus !== "PASS") {
      report.cleanupError = [report.cleanupError, report.uninstallStatus].filter(Boolean).join("; ");
    }
  } catch (cleanupError) {
    report.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    report.uninstallStatus = "FAIL";
  }
  try {
    const stagingPath = path.resolve(stagingApk);
    if (stagingApk && fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { force: true });
    report.apkCleanupStatus = stagingApk
      ? (fs.existsSync(stagingPath) ? "FAIL_REMAINS" : "PASS")
      : "SKIPPED_SOURCE_APK";
    if (report.sourceArtifacts?.apk.path === stagingPath) report.sourceArtifacts.apk.cleaned = report.apkCleanupStatus === "PASS";
  } catch (cleanupError) {
    report.cleanupError = [report.cleanupError, cleanupError instanceof Error ? cleanupError.message : String(cleanupError)].filter(Boolean).join("; ");
    report.apkCleanupStatus = "FAIL";
  }
}

function fail(message, failureCode = "ANDROID_LANDSCAPE_ACCEPTANCE_FAILED") {
  report.failureCode = failureCode;
  report.message = message;
  cleanupArtifacts();
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  throw new Error(`${failureCode}: ${message}`);
}

function run(args, options = {}) {
  const result = spawnSync(adb, ["-s", serial, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "adb command failed").trim());
  return result.stdout || "";
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function assertNoBlockingSystemUi(context) {
  const dumpPath = "/sdcard/agentvn-window.xml";
  run(["shell", "uiautomator", "dump", dumpPath]);
  const hierarchy = run(["shell", "cat", dumpPath]);
  const blockingDialog = /System UI isn(?:'|&apos;)t responding|Application Not Responding|Close app/i.test(hierarchy);
  report.systemUiChecks.push({
    context,
    checkedAt: new Date().toISOString(),
    blockingDialog,
  });
  if (blockingDialog) {
    throw new Error(`blocking Android system dialog is visible during ${context}`);
  }
}

function parsePngSize(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error(`Invalid PNG: ${filePath}`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
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
      this.pending.set(id, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result));
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        || result.exceptionDetails.exception?.value
        || result.exceptionDetails.text
        || "Runtime.evaluate failed";
      throw new Error(String(detail));
    }
    return result.result?.value;
  }
  close() { this.socket.close(); }
}

async function connectCdp() {
  const pid = run(["shell", "pidof", packageName]).trim().split(/\s+/)[0];
  if (!pid) throw new Error(`No running process for ${packageName}`);
  spawnSync(adb, ["-s", serial, "forward", "--remove", "tcp:9222"], { windowsHide: true, stdio: "ignore" });
  run(["forward", "tcp:9222", `localabstract:webview_devtools_remote_${pid}`]);
  let tabs = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      tabs = await (await fetch("http://127.0.0.1:9222/json/list")).json();
      if (tabs.length > 0) break;
    } catch {}
    await delay(250);
  }
  const tab = tabs.find((item) => item.type === "page") || tabs[0];
  if (!tab?.webSocketDebuggerUrl) throw new Error("No WebView CDP page exposed by APK");
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  return new CdpClient(socket);
}

async function connectStableCdp(waiter, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let cdp = null;
    try {
      cdp = await connectCdp();
      await waiter(cdp);
      return cdp;
    } catch (error) {
      lastError = error;
      try { cdp?.close(); } catch {}
      const message = error instanceof Error ? error.message : String(error);
      if (!/navigated or closed|No WebView CDP page|No running process|WebSocket/i.test(message)) {
        throw error;
      }
      await delay(750);
    }
  }
  throw new Error(`${label} did not expose a stable WebView target: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForTitle(cdp) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await cdp.evaluate(`Boolean(
      (
        document.querySelector('[data-testid="game-state-title"]')
        || document.querySelector('[data-ui-screen="title"]')
      )
      && !document.querySelector('.game-launch-blackout')
      && !document.querySelector('.boot-overlay')
      && [...document.querySelectorAll('.menu-action-button')].filter((button) => getComputedStyle(button).display !== 'none').every((button) => !button.disabled)
    )`);
    if (ready) return;
    await delay(250);
  }
  throw new Error("title menu did not become ready");
}

async function inspectTitle(cdp, requestedResolution) {
  const metrics = await cdp.evaluate(`(() => {
    const rect = (element) => { const value = element?.getBoundingClientRect(); return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null; };
    const frame = document.querySelector('.runtime-layout-frame');
    const hero = document.querySelector('.main-menu-title-hero-background');
    const scope = document.querySelector('.ui-skin-scope');
    const frameRect = rect(frame);
    const controls = [...document.querySelectorAll('.menu-action-button')]
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => { const value = rect(element); const hit = value && document.elementFromPoint(value.x + value.width / 2, value.y + value.height / 2); return { id: element.getAttribute('data-ui-component-id'), source: element.getAttribute('data-ui-layout-source'), disabled: element.disabled, rect: value, hit: Boolean(hit && (hit === element || element.contains(hit))) }; });
    return {
      requestedResolution: ${JSON.stringify(requestedResolution)},
      viewport: { innerWidth, innerHeight, visualWidth: visualViewport?.width ?? null, visualHeight: visualViewport?.height ?? null, devicePixelRatio },
      breakpoint: scope?.getAttribute('data-ui-breakpoint'),
      formFactor: scope?.getAttribute('data-ui-form-factor'),
      frame: frameRect,
      hero: rect(hero),
      controls,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      diagnostics: window.__AGENTVN_RUNTIME_DIAGNOSTICS__ ?? null,
    };
  })()`);
  if (!metrics.frame) throw new Error("runtime frame is missing");
  const expectedWidth = Math.min(metrics.viewport.innerWidth, metrics.viewport.innerHeight * (16 / 9));
  const expectedHeight = expectedWidth * (9 / 16);
  if (Math.abs(metrics.frame.width - expectedWidth) > 2 || Math.abs(metrics.frame.height - expectedHeight) > 2 || Math.abs(metrics.frame.width / metrics.frame.height - 16 / 9) > 0.01) {
    throw new Error(`frame is not viewport-fitted 16:9: ${JSON.stringify(metrics)}`);
  }
  // The shipped Android runtime must use the PC-authored layout. A mobile
  // breakpoint or explicit_mobile source proves the APK predates the current
  // parity implementation, so fail loudly instead of accepting a stale APK.
  if (metrics.breakpoint !== "desktop" || metrics.formFactor !== "handheld" || metrics.controls.some((item) => item.source === "mobile" || item.source === "explicit_mobile")) {
    const error = new Error(`APK is stale or still resolves mobile layout on Android: ${JSON.stringify(metrics)}`);
    error.code = "STALE_APK_OR_LAYOUT";
    throw error;
  }
  if (metrics.hero && (metrics.hero.x < metrics.frame.x - 1 || metrics.hero.y < metrics.frame.y - 1 || metrics.hero.right > metrics.frame.right + 1 || metrics.hero.bottom > metrics.frame.bottom + 1 || metrics.hero.width < metrics.frame.width * 0.97 || metrics.hero.height < metrics.frame.height * 0.97)) {
    throw new Error(`title hero background does not cover frame: ${JSON.stringify(metrics)}`);
  }
  if (metrics.controls.some((item) => item.disabled || !item.hit || !item.rect || item.rect.x < metrics.frame.x - 1 || item.rect.y < metrics.frame.y - 1 || item.rect.right > metrics.frame.right + 1 || item.rect.bottom > metrics.frame.bottom + 1 || item.source === "mobile")) {
    throw new Error(`title controls are not inside/clickable PC frame: ${JSON.stringify(metrics)}`);
  }
  if (metrics.scrollWidth > metrics.viewport.innerWidth + 1 || metrics.bodyScrollWidth > metrics.viewport.innerWidth + 1) {
    throw new Error(`unexpected horizontal overflow: ${JSON.stringify(metrics)}`);
  }
  return metrics;
}

async function inspectSettings(cdp, requestedResolution) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const present = await cdp.evaluate(`Boolean(document.querySelector('[data-testid="settings-screen"] .settings-renpy'))`);
    if (present) break;
    await delay(250);
  }
  const transitionDeadline = Date.now() + 15_000;
  while (Date.now() < transitionDeadline) {
    const settled = await cdp.evaluate(`!document.querySelector('[data-runtime-screen-transition]') || document.querySelector('[data-runtime-screen-transition]')?.getAttribute('data-runtime-screen-transition') === 'idle'`);
    if (settled) break;
    await delay(150);
  }
  const metrics = await cdp.evaluate(`(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      const value = element?.getBoundingClientRect();
      return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
    };
    const frame = box('.runtime-layout-frame');
    const panel = box('.settings-renpy');
    const finish = document.querySelector('[data-testid="settings-finish"]');
    const finishRect = finish?.getBoundingClientRect();
    const hit = finishRect ? document.elementFromPoint(finishRect.x + finishRect.width / 2, finishRect.y + finishRect.height / 2) : null;
    return {
      requestedResolution: ${JSON.stringify(requestedResolution)},
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      frame,
      panel,
      hasHeaderTitle: Boolean(document.querySelector('[data-testid="settings-screen"] > header h2')),
      hasHeaderClose: Boolean(document.querySelector('[data-testid="back-to-main-menu"]')),
      finishClickable: Boolean(hit && finish && (hit === finish || finish.contains(hit))),
      scrollWidth: document.documentElement.scrollWidth,
    };
  })()`);
  if (metrics.hasHeaderTitle || metrics.hasHeaderClose || !metrics.finishClickable) {
    throw new Error(`settings header/finish contract failed: ${JSON.stringify(metrics)}`);
  }
  if (!metrics.panel || !metrics.frame || metrics.panel.top > metrics.frame.top + Math.max(24, metrics.frame.height * 0.08)) {
    throw new Error(`settings panel did not move into the authored frame: ${JSON.stringify(metrics)}`);
  }
  if (metrics.scrollWidth > metrics.viewportWidth + 1) {
    throw new Error(`settings page overflowed horizontally: ${JSON.stringify(metrics)}`);
  }
  return metrics;
}

async function waitForPlaying(cdp) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await cdp.evaluate(`Boolean(
      document.querySelector('.story-player .dialog-box')
      && document.querySelector('.story-player .dialog-text')?.textContent?.trim()
    )`);
    if (ready) return;
    await delay(250);
  }
  throw new Error("story player did not render a visible dialogue");
}

async function inspectPlaying(cdp, requestedResolution) {
  const metrics = await cdp.evaluate(`(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      const value = element?.getBoundingClientRect();
      return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
    };
    const frame = box('.runtime-layout-frame');
    const player = document.querySelector('.story-player');
    const quick = document.querySelector('.playback-controls');
    return {
      requestedResolution: ${JSON.stringify(requestedResolution)},
      viewport: { innerWidth, innerHeight, visualWidth: visualViewport?.width ?? null, visualHeight: visualViewport?.height ?? null, devicePixelRatio },
      frame,
      player: box('.story-player'),
      dialog: box('.dialog-box'),
      dialogText: document.querySelector('.dialog-text')?.textContent?.trim() || '',
      quickMenu: (() => {
        if (!quick) return null;
        const quickValue = quick.getBoundingClientRect();
        return {
          rect: {
            x: quickValue.x,
            y: quickValue.y,
            width: quickValue.width,
            height: quickValue.height,
            right: quickValue.right,
            bottom: quickValue.bottom,
          },
          frame,
          authored: {
            x: Number(quick.getAttribute('data-quick-menu-authored-x')),
            y: Number(quick.getAttribute('data-quick-menu-authored-y')),
            width: Number(quick.getAttribute('data-quick-menu-authored-width')),
            height: Number(quick.getAttribute('data-quick-menu-authored-height')),
            anchor: quick.getAttribute('data-quick-menu-authored-anchor') || '',
          },
          expanded: quick.classList.contains('is-expanded'),
          frameWidth: frame?.width ?? null,
          frameHeight: frame?.height ?? null,
        };
      })(),
      sceneId: player?.getAttribute('data-current-scene-id') || null,
      commandIndex: player?.getAttribute('data-current-command-index') || null,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      diagnostics: window.__AGENTVN_RUNTIME_DIAGNOSTICS__ ?? null,
    };
  })()`);
  if (!metrics.frame || !metrics.player || !metrics.dialog || !metrics.dialogText) {
    throw new Error(`playing surface is incomplete after restore: ${JSON.stringify(metrics)}`);
  }
  const expectedWidth = Math.min(metrics.viewport.innerWidth, metrics.viewport.innerHeight * (16 / 9));
  const expectedHeight = expectedWidth * (9 / 16);
  if (Math.abs(metrics.frame.width - expectedWidth) > 2 || Math.abs(metrics.frame.height - expectedHeight) > 2 || Math.abs(metrics.frame.width / metrics.frame.height - 16 / 9) > 0.01) {
    throw new Error(`playing frame is not stable 16:9 after restore: ${JSON.stringify(metrics)}`);
  }
  if (metrics.scrollWidth > metrics.viewport.innerWidth + 1 || metrics.bodyScrollWidth > metrics.viewport.innerWidth + 1) {
    throw new Error(`playing surface overflowed after restore: ${JSON.stringify(metrics)}`);
  }
  if (metrics.quickMenu) {
    const menu = metrics.quickMenu;
    const dialog = metrics.dialog;
    if (menu.expanded) {
      // Expanded state owns the complete eight-row drawer.  Its bottom edge
      // remains above the dialogue; the collapsed-toggle anchor is not the
      // expected rectangle once the drawer has opened.
      const actionCount = Number(await cdp.evaluate(
        `document.querySelectorAll('.quick-menu-surface.is-expanded .quick-menu-action-layer > .quick-menu-button').length`,
      ));
      const rows = Number(await cdp.evaluate(
        `document.querySelector('[data-testid="quick-menu-toggle"]')?.closest('.playback-controls')?.getAttribute('data-quick-menu-rows') || 0`,
      ));
      const columns = Number(await cdp.evaluate(
        `document.querySelector('[data-testid="quick-menu-toggle"]')?.closest('.playback-controls')?.getAttribute('data-quick-menu-columns') || 0`,
      ));
      const scrollable = await cdp.evaluate(
        `document.querySelector('.playback-controls')?.getAttribute('data-quick-menu-scrollable') === 'true'`,
      );
      if (actionCount !== 7
        || rows !== 8
        || columns !== 1
        || scrollable
        || menu.rect.left < menu.frame.x - 1
        || menu.rect.right > menu.frame.right + 1
        || menu.rect.top < menu.frame.y - 1
        || menu.rect.bottom > menu.frame.bottom + 1
        || (dialog && menu.rect.bottom > dialog.top + 1)) {
        throw new Error(`expanded quick menu is not a complete in-frame drawer: ${JSON.stringify({ metrics, actionCount, rows, columns, scrollable })}`);
      }
      const toggleRect = await cdp.evaluate(
        `document.querySelector('[data-testid="quick-menu-toggle"]')?.getBoundingClientRect().toJSON() || null`,
      );
      const minimumDrawerWidth = menu.frame.width * 0.28;
      const minimumToggleHitSize = menu.frame.width * 0.038;
      if (menu.rect.width < minimumDrawerWidth
        || menu.rect.height < menu.frame.height * 0.55
        || !toggleRect
        || toggleRect.width < minimumToggleHitSize
        || toggleRect.height < minimumToggleHitSize) {
        throw new Error(`expanded quick menu is visually too small for Android frame: ${JSON.stringify({
          metrics,
          toggleRect,
          minimumDrawerWidth,
          minimumToggleHitSize,
        })}`);
      }
    } else {
      // The runtime quick menu is intentionally no longer positioned by the
      // legacy authored percentage rectangle.  Its fixed mobile contract is
      // attached to the dialogue panel: the collapsed toggle sits directly
      // above the dialogue's top-right corner with an 8px frame-space gap.
      // Keep the authored anchor as a compatibility marker, but assert the
      // user-visible placement against the rendered dialogue geometry.
      const expectedRight = dialog?.right ?? Number.NaN;
      const expectedBottom = dialog ? dialog.top - 8 : Number.NaN;
      if (menu.authored.anchor !== "top_right"
        || Math.abs(menu.rect.right - expectedRight) > 2
        || Math.abs(menu.rect.bottom - expectedBottom) > 2
        || menu.rect.left < menu.frame.x - 1
        || menu.rect.right > menu.frame.right + 1
        || menu.rect.top < menu.frame.y - 1
        || menu.rect.bottom > menu.frame.bottom + 1) {
        throw new Error(`quick menu did not remain at dialogue-top-right position after restore: ${JSON.stringify(metrics)}`);
      }
    }
  }
  return metrics;
}

async function assertQuickMenuAfterRestore(cdp, requestedResolution) {
  const ready = await cdp.evaluate(`Boolean(document.querySelector('.playback-controls'))`);
  if (!ready) throw new Error(`quick menu is missing after restore: ${requestedResolution}`);
  await cdp.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.click()`);
  await delay(260);
  const expanded = await inspectPlaying(cdp, `${requestedResolution}:quick-menu-expanded`);
  await cdp.evaluate(`document.querySelector('[data-testid="quick-menu-toggle"]')?.click()`);
  return expanded.quickMenu;
}

async function main() {
  report.isElevated = isElevated();
  if (!report.isElevated) fail("管理员权限未生效，已停止 Android 验收。", "ANDROID_ADMIN_REQUIRED");
  if (!fs.existsSync(apkPath)) fail(`APK not found: ${apkPath}`, "APK_MISSING");
  for (const filePath of [cartridge, unpackedManifest, unpackedLayout]) if (!fs.existsSync(filePath)) fail(`source artifact missing: ${filePath}`, "SOURCE_ARTIFACT_MISSING");
  if (!stagingApk) fail("--staging-apk is required; source APKs are never cleaned by this acceptance.", "STAGING_APK_REQUIRED");
  fs.mkdirSync(outputDir, { recursive: true });
  report.sourceArtifacts = {
    apk: { path: apkPath, bytes: fs.statSync(apkPath).size, sha256: sha256(apkPath), generatedAt: fs.statSync(apkPath).mtime.toISOString(), cleaned: false },
    cartridge: { path: cartridge, bytes: fs.statSync(cartridge).size, sha256: sha256(cartridge), generatedAt: fs.statSync(cartridge).mtime.toISOString(), cleaned: false },
    manifest: { path: unpackedManifest, bytes: fs.statSync(unpackedManifest).size, sha256: sha256(unpackedManifest), generatedAt: fs.statSync(unpackedManifest).mtime.toISOString(), cleaned: false },
    layout: { path: unpackedLayout, bytes: fs.statSync(unpackedLayout).size, sha256: sha256(unpackedLayout), generatedAt: fs.statSync(unpackedLayout).mtime.toISOString(), cleaned: false },
  };
  if (run(["get-state"]).trim() !== "device") fail("emulator is not online", "EMULATOR_NOT_READY");
  const originalSize = run(["shell", "wm", "size"]).match(/Physical size:\s*(\d+x\d+)/)?.[1] || "2400x1080";
  try {
    run(["install", "-r", apkPath]);
    for (const resolution of ["1920x864", "2400x1080"]) {
      run(["shell", "wm", "size", resolution]);
      run(["shell", "pm", "clear", packageName]);
      run(["shell", "monkey", "-p", packageName, "1"]);
      await delay(2500);
      const cdp = await connectStableCdp(waitForTitle, `${resolution}:title`);
      try {
        assertNoBlockingSystemUi(`${resolution}:title`);
        const metrics = await inspectTitle(cdp, resolution);
        await cdp.evaluate(`document.querySelector('[data-testid="open-settings"]')?.click()`);
        await delay(450);
        const settings = await inspectSettings(cdp, resolution);
        await cdp.evaluate(`document.querySelector('[data-testid="settings-finish"]')?.click()`);
        await delay(450);
        assertNoBlockingSystemUi(`${resolution}:settings-return`);
        const screenshotPath = path.join(outputDir, `title-${resolution}.png`);
        const screenshot = spawnSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { encoding: null, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
        if (screenshot.status !== 0) throw new Error("screencap failed");
        fs.writeFileSync(screenshotPath, screenshot.stdout);
        const physical = parsePngSize(screenshotPath);
        report.resolutions.push({ resolution, physical, metrics, settings, screenshot: screenshotPath });
      } finally {
        cdp.close();
      }

      const reentry = [];
      const exerciseReentry = async (label, action) => {
        await action();
        await delay(1800);
        assertNoBlockingSystemUi(`${resolution}:${label}`);
        const resumed = await connectStableCdp(waitForTitle, `${resolution}:${label}`);
        try {
          const resumedMetrics = await inspectTitle(resumed, `${resolution}:${label}`);
          reentry.push({ label, metrics: resumedMetrics });
        } finally {
          resumed.close();
        }
      };
      await exerciseReentry("launcher-reopen", async () => {
        run(["shell", "input", "keyevent", "3"]);
        await delay(500);
        run(["shell", "monkey", "-p", packageName, "1"]);
      });
      await exerciseReentry("recent-task-resume", async () => {
        run(["shell", "input", "keyevent", "3"]);
        await delay(350);
        run(["shell", "input", "keyevent", "187"]);
        await delay(500);
        run(["shell", "input", "keyevent", "66"]);
      });
      await exerciseReentry("screen-unlock-resume", async () => {
        run(["shell", "input", "keyevent", "26"]);
        await delay(700);
        run(["shell", "input", "keyevent", "26"]);
        await delay(500);
        run(["shell", "monkey", "-p", packageName, "1"]);
      });
      report.resolutions[report.resolutions.length - 1].reentry = reentry;

      // Reproduce the user-reported case while a game is active: leave the
      // activity without ending the run, then restore it through launcher,
      // recent tasks and lock-screen resume. The expected screen is still
      // the story player, with its dialogue and authored frame intact.
      const playingCdp = await connectCdp();
      await playingCdp.evaluate(`document.querySelector('[data-testid="start-new-game"]')?.click()`);
      await waitForPlaying(playingCdp);
      assertNoBlockingSystemUi(`${resolution}:playing-before-reentry`);
      const playingBefore = await inspectPlaying(playingCdp, `${resolution}:playing-before-reentry`);
      const playingReentry = [];
      const exercisePlayingReentry = async (label, action) => {
        await action();
        await delay(1800);
        assertNoBlockingSystemUi(`${resolution}:playing:${label}`);
        const resumed = await connectStableCdp(waitForPlaying, `${resolution}:playing:${label}`);
        try {
          const resumedMetrics = await inspectPlaying(resumed, `${resolution}:${label}`);
          resumedMetrics.quickMenuAfterRestore = await assertQuickMenuAfterRestore(resumed, `${resolution}:${label}`);
          playingReentry.push({ label, metrics: resumedMetrics });
        } finally {
          resumed.close();
        }
      };
      await exercisePlayingReentry("launcher-reopen", async () => {
        run(["shell", "input", "keyevent", "3"]);
        await delay(500);
        run(["shell", "monkey", "-p", packageName, "1"]);
      });
      await exercisePlayingReentry("recent-task-resume", async () => {
        run(["shell", "input", "keyevent", "3"]);
        await delay(350);
        run(["shell", "input", "keyevent", "187"]);
        await delay(500);
        run(["shell", "input", "keyevent", "66"]);
      });
      await exercisePlayingReentry("screen-unlock-resume", async () => {
        run(["shell", "input", "keyevent", "26"]);
        await delay(700);
        run(["shell", "input", "keyevent", "26"]);
        await delay(500);
        run(["shell", "monkey", "-p", packageName, "1"]);
      });
      playingCdp.close();
      report.resolutions[report.resolutions.length - 1].playing = { beforeReentry: playingBefore, reentry: playingReentry };
    }
  } finally {
    try {
      run(["shell", "am", "force-stop", packageName]);
    } catch (cleanupError) {
      report.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    }
    try {
      run(["shell", "wm", "size", originalSize]);
    } catch (cleanupError) {
      report.cleanupError = [report.cleanupError, cleanupError instanceof Error ? cleanupError.message : String(cleanupError)].filter(Boolean).join("; ");
    }
    cleanupArtifacts();
  }
  report.status = report.uninstallStatus === "PASS" && report.apkCleanupStatus === "PASS" && !report.cleanupError
    ? "RUNTIME_PASS"
    : "FAIL";
  if (report.status !== "RUNTIME_PASS") report.failureCode = "ANDROID_CLEANUP_FAILED";
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.status !== "RUNTIME_PASS") throw new Error(`Android cleanup failed: ${report.cleanupError || report.uninstallStatus}`);
  console.log(`hidden-growth-android-landscape-acceptance: RUNTIME_PASS (${outputDir})`);
}

main().catch((error) => {
  cleanupArtifacts();
  report.finishedAt = new Date().toISOString();
  report.message = error instanceof Error ? error.message : String(error);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(error.stack || error);
  process.exitCode = 1;
});
