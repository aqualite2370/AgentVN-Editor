"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");

assert.equal(process.argv.length, 5, "Pass installation record, editor report and fresh output directory");
const [installationPath, editorReportPath, out] = process.argv.slice(2).map(value => path.resolve(value));
assert(!fs.existsSync(out), "Never overwrite player acceptance evidence");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const installation = verifiedInstalledCandidate(installationPath);
const editorReport = read(editorReportPath);
assert.equal(installation.status, "PASS");
assert.equal(installation.executable.version, "1.9.35");
assert.equal(editorReport.status, "EDITOR_PASS_PLAYER_NOT_RUN");
assert.equal(editorReport.steps.length, 7);
assert(editorReport.steps.every(step => step.status === "PASS"));
assert.equal(editorReport.matrix.length, 12);
assert.equal(editorReport.assetProofs.length, 26);
assert.equal(editorReport.cartridge.assets.length, 6);
assert.equal(sha(fs.readFileSync(editorReport.cartridge.path)), editorReport.cartridge.sha256);

const installRoot = installation.installRoot;
const playerExe = path.join(installRoot, "agentvn-player.exe");
const playerSha = sha(fs.readFileSync(playerExe));
const expectedPlayer = installation.resources.find(item => path.basename(item.path) === "agentvn-player.exe");
assert(expectedPlayer);
assert.equal(playerSha, expectedPlayer.sha256);

const archive = JSZip.loadAsync(fs.readFileSync(editorReport.cartridge.path), { checkCRC32: true });
const report = {
  status: "RUNNING",
  scope: "Actual installed 1.9.35 Player consumes official GUI resources exported by the same installed Editor",
  startedAt: new Date().toISOString(),
  runner: { path: __filename, sha256: sha(fs.readFileSync(__filename)) },
  environment: "Native installed WebView; logical viewport/DPR emulation, not a physical 4K display",
  installation: {
    installRoot,
    version: installation.executable.version,
    editorExe: installation.executable.path,
    editorSha: installation.executable.sha256,
    playerExe,
    playerSha,
    recordPath: installationPath,
    recordSha: sha(fs.readFileSync(installationPath)),
    sourceReceipt: installation.sourceReceipt,
  },
  editorReport: { path: editorReportPath, sha256: sha(fs.readFileSync(editorReportPath)) },
  cartridge: editorReport.cartridge,
  cases: [],
  matrix: [],
  loadedResources: [],
  passiveResources: [],
  responseReadErrors: [],
  resourceStages: [],
  errors: [],
  cleanup: null,
};
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
report.runner.originalPath = report.runner.path;
report.runner.path = path.join(out, "executed-test.cjs");
let child, browser, page, cdp, port;
let currentViewport;
let auditReading = false;
const pendingResponses = new Set();

function observeRuntimeResponse(response) {
  // Audit fetches must never become evidence of Runtime consumption.
  if (auditReading || !response.ok()) return;
  const pending = (async () => {
    try {
      const bytes = await response.body();
      report.passiveResources.push({
        url: response.url(),
        resourceType: response.request().resourceType(),
        bytes: bytes.length,
        sha256: sha(bytes),
        source: "passive Runtime response before audit reads",
      });
    } catch (error) {
      report.responseReadErrors.push({ url: response.url(), error: String(error) });
    }
  })();
  pendingResponses.add(pending);
  pending.finally(() => pendingResponses.delete(pending));
}

async function recordResourceStage(name) {
  await Promise.all([...pendingResponses]);
  const rendered = await page.evaluate(() => ({
    state: document.querySelector("[data-runtime-state]")?.getAttribute("data-runtime-state"),
    layers: [...document.querySelectorAll(
      ".renpy-title-view, .renpy-title-background, .main-menu-title-hero-background, .renpy-title-heading, .dialog-box, .choice-panel, .renpy-quick-bar button",
    )].map(node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        className: node.className, rect: rect.toJSON(),
        inlineStyle: node.getAttribute("style"),
        display: style.display, visibility: style.visibility,
        opacity: style.opacity, backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor, borderImageSource: style.borderImageSource,
        fontFamily: style.fontFamily,
      };
    }),
    resourcesBeforeAudit: performance.getEntriesByType("resource")
      .map(({ name, initiatorType }) => ({ name, initiatorType })),
  }));
  auditReading = true;
  let readableResources;
  try { readableResources = await loadedResourceDigests(); }
  finally { auditReading = false; }
  report.resourceStages.push({ name, viewport: currentViewport, rendered, readableResources,
    passiveResourceCountBeforeAudit: report.passiveResources.length,
    qualification: "Readable resource bytes are diagnostic only; final consumption requires a passive Runtime response" });
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const value = server.address().port;
      server.close(error => error ? reject(error) : resolve(value));
    });
  });
}

function processInfo(pid) {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"|Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate|ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true });
  return raw.trim() ? JSON.parse(raw.replace(/^\uFEFF/, "")) : null;
}

function assertDebugPortOwnership() {
  const listeners = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], {
    encoding: "utf8", windowsHide: true,
  }).split(/\r?\n/).map(line => line.trim().split(/\s+/))
    .filter(fields => fields[0] === "TCP" && fields[1].endsWith(`:${port}`)
      && fields[3] === "LISTENING");
  assert(listeners.length, "The owned Player debug port must have a live listener");
  report.debugPort = { port, listeners: listeners.map(fields => {
    let pid = Number(fields[4]);
    const ancestry = [];
    for (let depth = 0; depth < 16 && pid; depth++) {
      const info = processInfo(pid);
      assert(info, "Debug listener process vanished");
      ancestry.push(info);
      if (pid === child.pid) return { pid: Number(fields[4]), ancestry };
      pid = info.ParentProcessId;
    }
    throw new Error("Debug listener does not belong to this Player process tree");
  }) };
}

async function loadedResourceDigests() {
  return page.evaluate(async () => {
    const urls = new Set(performance.getEntriesByType("resource").map(entry => entry.name));
    const addCssUrls = value => {
      for (const match of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
        if (match[2]) urls.add(match[2]);
      }
    };
    for (const image of document.images) {
      if (image.currentSrc) urls.add(image.currentSrc);
      if (image.src) urls.add(image.src);
    }
    for (const element of document.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      addCssUrls(style.backgroundImage);
      addCssUrls(style.maskImage);
      addCssUrls(element.getAttribute("style") || "");
    }
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) addCssUrls(rule.cssText);
      } catch {}
    }
    const digests = [];
    for (const value of urls) {
      try {
        const url = new URL(value, location.href);
        if (!["http:", "https:", "data:", "blob:", "asset:", "tauri:"].includes(url.protocol)) continue;
        const response = await fetch(url.href);
        if (!response.ok) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        digests.push({
          url: url.href,
          bytes: bytes.length,
          sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join(""),
        });
      } catch {}
    }
    return digests;
  });
}

async function screenshot(name) {
  const { width, height, dpr, reduced } = currentViewport;
  const file = path.join(out, `${name}-${width}-${dpr}-${reduced}.png`);
  const capture = await captureInstalledWebview(page, cdp, file, currentViewport);
  report.cases.push({ name: `screenshot-${name}`, viewport: currentViewport, status: "PASS", ...capture });
}

async function main() {
  const zip = await archive;
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  assert.equal(layout.layout_type, "renpy");
  const expected = [];
  for (const asset of editorReport.cartridge.assets) {
    const packed = Buffer.from(await zip.file(asset.path).async("nodebuffer"));
    assert.equal(sha(packed), asset.sha256, `Cartridge bytes changed for ${asset.relative}`);
    expected.push({ id: asset.id, relative: asset.relative, sha256: asset.sha256, bytes: packed.length });
  }
  assert.deepEqual(expected.map(asset => asset.relative).sort(), [
    "DejaVuSans.ttf",
    "gui/button/choice_idle_background.png",
    "gui/button/quick_hover_background.png",
    "gui/button/quick_idle_background.png",
    "gui/main_menu.png",
    "gui/textbox.png",
  ].sort());
  report.expectedResources = expected;

  port = await freePort();
  child = spawn(playerExe, ["--mode", "preview", "--cartridge", editorReport.cartridge.path], {
    cwd: installRoot,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });
  report.playerPid = child.pid;
  report.playerProcess = processInfo(child.pid);
  assert.equal(path.resolve(report.playerProcess?.ExecutablePath), path.resolve(playerExe));
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      ready = (await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      })).ok;
    } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert(ready, "Installed Player WebView did not become ready");
  assertDebugPortOwnership();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages().find(candidate => candidate.url().includes("tauri.localhost"));
  assert(page);
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push(String(error)));
  page.on("response", observeRuntimeResponse);
  cdp = await browser.contexts()[0].newCDPSession(page);
  for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
  currentViewport = { width, height, dpr, reduced };
  await Promise.all([...pendingResponses]);
  const firstResponse = report.passiveResources.length;
  await page.setViewportSize({ width, height });
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: dpr, mobile: false,
  });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("game-state-title").waitFor();
  await page.getByTestId("start-new-game").waitFor();
  await page.waitForFunction(() => !document.querySelector("[data-runtime-boot-blocking]"));
  await page.evaluate(() => document.fonts.ready);
  await screenshot("official-gui-title");
  await recordResourceStage("title");
  const titleStage = report.resourceStages.at(-1);
  const hero = titleStage.rendered.layers.find(layer => layer.className === "main-menu-title-hero-background");
  assert(hero && hero.display !== "none" && hero.visibility === "visible" && Number(hero.opacity) > 0);
  assert(hero.rect.width >= width - 1 && hero.rect.height >= height - 1
    && hero.rect.left >= -1 && hero.rect.top >= -1, "Mapped title background must fill the actual frame");
  const titleImage = expected.find(asset => asset.relative === "gui/main_menu.png");
  const titleResponse = report.passiveResources.slice(firstResponse)
    .find(resource => resource.sha256 === titleImage.sha256 && hero.backgroundImage.includes(resource.url));
  assert(titleResponse, "The visible title background URL must match passive cartridge image bytes");
  report.cases.push({ name: "installed-player-title-and-launch", status: "PASS",
    title: (await page.locator("body").innerText()).slice(0, 600) });

  await page.getByTestId("start-new-game").click();
  await page.locator(".dialog-box").filter({ hasText: "GUI_CONSUMPTION" }).waitFor();
  await page.waitForFunction(() => document.querySelector(".story-player")?.dataset.isTyping === "false");
  await page.evaluate(() => document.fonts.ready);
  await screenshot("official-gui-dialogue");
  await recordResourceStage("dialogue");
  report.cases.push({ name: "dialogue-panel-and-imported-font", status: "PASS",
    dialogue: await page.locator(".dialog-box").innerText() });

  await page.locator(".dialog-box").click();
  await page.locator(".choice-panel").waitFor();
  await page.getByRole("button", { name: /再次检查/ }).waitFor();
  await screenshot("official-gui-choice");
  await recordResourceStage("choice");
  report.cases.push({ name: "choice-background-and-interaction", status: "PASS",
    choices: await page.locator(".choice-panel").innerText() });

  const quick = page.locator(".renpy-quick-bar");
  await quick.waitFor();
  const quickButton = quick.locator("button").first();
  await quickButton.hover();
  await page.evaluate(() => document.fonts.ready);
  report.quickBar = await quick.evaluate(element => ({
    count: element.querySelectorAll("button").length,
    labels: [...element.querySelectorAll("button")].map(button => button.textContent.trim()),
    rect: element.getBoundingClientRect().toJSON(),
    pageOverflow: document.documentElement.scrollWidth - innerWidth,
  }));
  assert.deepEqual(report.quickBar.labels, ["回退", "历史", "快进", "自动", "存档", "快存", "快读", "设置", "隐藏"]);
  assert.equal(report.quickBar.count, 9);
  assert(report.quickBar.pageOverflow <= 1);
  await screenshot("official-gui-quick-bar");
  await recordResourceStage("quick-hover");

  await Promise.all([...pendingResponses]);
  report.loadedResources = report.resourceStages.flatMap(stage => stage.readableResources);
  const loadedHashes = new Set(report.passiveResources.slice(firstResponse).map(resource => resource.sha256));
  const missing = expected.filter(resource => !loadedHashes.has(resource.sha256));
  report.missingRuntimeResources = missing;
  assert.deepEqual(missing, [], "Every mapped official resource requires a passive Player response, excluding audit fetches");
  report.cases.push({ name: "all-six-mapped-official-resources-consumed-by-player", status: "PASS",
    viewport: currentViewport, resources: expected.map(({ id, relative, sha256 }) => ({ id, relative, sha256 })) });
  report.matrix.push({ ...currentViewport, status: "PASS", titleBackground: {
    rect: hero.rect, url: titleResponse.url, sha256: titleResponse.sha256,
  }, resources: expected.map(asset => asset.sha256) });
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ stage: "matrix-cell", ...currentViewport, status: "PASS" }));
  }
  assert.equal(report.matrix.length, 12, "Full desktop/DPR/reduced-motion matrix required");
  assert.deepEqual(report.errors, []);
  report.status = "PASS";
}

main().catch(error => {
  report.status = "FAILED";
  report.error = String(error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null && child.signalCode === null) {
    const cleanup = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true, encoding: "utf8",
    });
    report.cleanup = { exitCode: cleanup.status, pid: child.pid };
    if (cleanup.status !== 0) {
      report.status = "FAILED";
      process.exitCode = 1;
    }
  } else {
    report.cleanup = { exitCode: 0, alreadyExited: true, pid: child?.pid };
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    matrix: report.matrix.length,
    loadedResources: report.loadedResources.length, missing: report.missingRuntimeResources?.length,
    cleanup: report.cleanup, out }));
});
