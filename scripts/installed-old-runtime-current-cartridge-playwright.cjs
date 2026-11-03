"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");

assert.equal(process.argv.length, 5, "Pass retained old Player, current cartridge and fresh output directory");
const [playerExe, cartridgePath, out] = process.argv.slice(2).map(value => path.resolve(value));
assert(!fs.existsSync(out), "Never overwrite compatibility evidence");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = {
  status: "RUNNING",
  scope: "REAL_RETAINED_1_8_0_PLAYER_RUNTIME_PROTOCOL_GATE",
  startedAt: new Date().toISOString(),
  player: { path: playerExe, sha256: sha(playerExe), bytes: fs.statSync(playerExe).size },
  cartridge: { path: cartridgePath, sha256: sha(cartridgePath), bytes: fs.statSync(cartridgePath).size },
  cases: [],
  errors: [],
  cleanup: null,
};
fs.mkdirSync(out, { recursive: true });
const isolated = {
  appData: path.join(out, "profile", "Roaming"),
  localAppData: path.join(out, "profile", "Local"),
  webview: path.join(out, "webview"),
  temp: path.join(out, "temp"),
};
for (const directory of Object.values(isolated)) fs.mkdirSync(directory, { recursive: true });
let child, browser, page, cdp, port;

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

function processIdentity(pid) {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){$p|Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate|ConvertTo-Json -Compress}`],
  { encoding: "utf8", windowsHide: true });
  return raw.trim() ? JSON.parse(raw.replace(/^\uFEFF/, "")) : null;
}

function ownedWebviews() {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "$p=Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match '--user-data-dir='}; " +
    "if($p){$p|Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate|ConvertTo-Json -Compress}"],
  { encoding: "utf8", windowsHide: true });
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function main() {
  const version = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `(Get-Item -LiteralPath '${playerExe}').VersionInfo.ProductVersion`],
  { encoding: "utf8", windowsHide: true });
  assert.equal(version.status, 0, version.stderr);
  report.player.productVersion = version.stdout.trim();
  assert.equal(report.player.productVersion, "1.8.0");
  assert.equal(report.player.sha256, "1923c4f320d5ef0521ca0b3a37f405a0cea7fe3d4d641568b8fc62d895ad6b6e");

  const archive = await JSZip.loadAsync(fs.readFileSync(cartridgePath), { checkCRC32: true });
  const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
  const layoutEntry = archive.file("ui/layout.json");
  const layout = layoutEntry ? JSON.parse(await layoutEntry.async("string")) : null;
  assert.match(manifest.runtime_version, /^\d+\.\d+\.\d+$/);
  if (layout) assert.equal(layout.layout_type, "renpy");
  report.cartridge.manifestRuntime = manifest.runtime_version;
  report.cartridge.layoutType = layout?.layout_type ?? null;
  report.cartridge.title = manifest.title;
  report.scope = `REAL_RETAINED_1_8_0_PLAYER_PROTOCOL_GATE_RUNTIME_${manifest.runtime_version}`;
  if (manifest.runtime_version === "0.18.0") {
    const script = JSON.parse(await archive.file("script.json").async("string"));
    assert.equal(script.default_dialog_presentation, "nvl");
    assert.equal(script.schema_version, "1.10.0");
    assert.equal(layout, null, "Protocol gate fixture must not include a UI layout schema");
  }

  port = await freePort();
  child = spawn(playerExe, ["--mode", "fixed", "--cartridge", cartridgePath], {
    cwd: path.dirname(playerExe),
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      APPDATA: isolated.appData,
      LOCALAPPDATA: isolated.localAppData,
      TEMP: isolated.temp,
      TMP: isolated.temp,
      WEBVIEW2_USER_DATA_FOLDER: isolated.webview,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      AGENTVN_TEST_PROJECT: undefined,
      AGENTVN_WORKSPACE_OUTPUT: undefined,
      DATABASE_PATH: undefined,
    },
  });
  report.player.pid = child.pid;
  report.playerProcess = processIdentity(child.pid);
  assert.equal(path.resolve(report.playerProcess?.ExecutablePath), playerExe);
  assert(report.playerProcess.CommandLine.includes(cartridgePath));

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
  assert(ready, "Retained old Player WebView did not become ready");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pageDeadline = Date.now() + 30000;
  while (Date.now() < pageDeadline && !page) {
    page = browser.contexts().flatMap(context => context.pages())
      .find(candidate => /^(https?:\/\/tauri\.localhost|tauri:)/.test(candidate.url()));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(page);
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push(String(error)));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? "";
    return /客户端布局版本不支持|GameCLI 版本过低|卡带要求\s*0\.\d+\.\d+|开始游戏/.test(text);
  }, null, { timeout: 45000 });
  const bodyText = await page.locator("body").innerText();
  const refusalText = bodyText.split("\n").filter(line =>
    /客户端布局版本不支持|GameCLI 版本过低|卡带要求/.test(line)).join("\n");
  assert(refusalText, `Old Runtime did not visibly refuse the cartridge. Body: ${bodyText}`);
  const refusalElement = page.getByText(/客户端布局版本不支持|GameCLI 版本过低|卡带要求/).first();
  const start = page.getByRole("button", { name: "开始游戏", exact: true });
  const playingCount = await page.locator('[data-testid="game-state-playing"]').count();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const refusalGeometry = await refusalElement.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const root = node.closest('[role="alert"],[role="dialog"]')
      ?? node.parentElement?.parentElement?.parentElement
      ?? node.parentElement;
    const buttons = [...(root?.querySelectorAll("button") ?? [])].map(button => {
      const r = button.getBoundingClientRect();
      return {
        label: button.textContent.trim(),
        visible: r.width > 0 && r.height > 0 && getComputedStyle(button).visibility !== "hidden",
        enabled: !button.disabled,
        hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        rect: r.toJSON(),
      };
    });
    return { messageRect: rect.toJSON(), rootRect: root?.getBoundingClientRect().toJSON() ?? null, buttons };
  });
  const webviews = ownedWebviews();
  const ownWebviews = webviews.filter(process => process.CommandLine.includes(isolated.webview));
  const defaultProfileWebviews = webviews.filter(process =>
    /--user-data-dir=.*\\AppData\\Local\\com\.agentvn\.player/i.test(process.CommandLine));

  report.isolation = {
    directories: isolated,
    webviewProcesses: webviews.map(({ ProcessId, ParentProcessId, CommandLine }) =>
      ({ ProcessId, ParentProcessId, CommandLine })),
    ownedWebviewCount: ownWebviews.length,
    defaultProfileWebviewCount: defaultProfileWebviews.length,
    ownedDirectoriesPresent: Object.fromEntries(Object.entries(isolated)
      .map(([key, directory]) => [key, fs.existsSync(directory)])),
  };
  report.cases.push({
    name: "old-runtime-refuses-current-installed-editor-cartridge",
    status: "PASS",
    bodyText,
    refusalText,
    refusalKind: /客户端布局版本不支持/.test(refusalText) ? "LAYOUT_SCHEMA_GATE"
      : "RUNTIME_VERSION_GATE",
    startButton: { visible: await start.isVisible().catch(() => false),
      enabled: await start.isEnabled().catch(() => false) },
    playingCount,
    overflow,
    refusalGeometry,
    actualRuntime: bodyText.match(/(?:当前|运行时|GameCLI)[^\n]{0,60}0\.\d+\.\d+/)?.[0] ?? null,
    requiredRuntimeVersion: report.cartridge.manifestRuntime,
  });
  if (report.cases[0].refusalKind === "LAYOUT_SCHEMA_GATE") {
    assert(/当前为\s*2\.0\.0[\s\S]*需要\s*1\.0\.0/.test(refusalText),
      "Layout refusal must identify actual and required layout schema versions");
  } else {
    const requiredVersion = report.cartridge.manifestRuntime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert(new RegExp(`卡带要求\\s*${requiredVersion}`).test(refusalText),
      "Runtime refusal must identify the cartridge's required Runtime version");
  }
  assert(!(await start.isVisible().catch(() => false) && await start.isEnabled().catch(() => false)),
    "Unsupported cartridge was offered as playable");
  assert.equal(playingCount, 0, "Unsupported story mounted a playing screen");
  assert(overflow <= 1, "Compatibility refusal overflows the viewport");
  const messageRect = refusalGeometry.messageRect;
  assert(messageRect.width > 0 && messageRect.height > 0 && messageRect.left >= -1 && messageRect.top >= -1
    && messageRect.right <= 1921 && messageRect.bottom <= 1081, "Refusal message is clipped");
  if (refusalGeometry.buttons.length) assert(refusalGeometry.buttons.every(button =>
    button.visible && button.hit && button.rect.left >= -1 && button.rect.top >= -1
      && button.rect.right <= 1921 && button.rect.bottom <= 1081),
  "Refusal controls must remain visible, in bounds and hittable");
  assert(ownWebviews.length > 0, "Player WebView did not use the isolated QA directory");
  assert.equal(defaultProfileWebviews.length, 0, "Player accessed the user's default WebView profile");
  assert.deepEqual(report.errors, []);
  const screenshot = path.join(out, "old-runtime-refusal-1920x1080.png");
  report.screenshot = await captureInstalledWebview(page, cdp, screenshot, {
    width: 1920, height: 1080, dpr: 1, reduced: false,
  });
  report.status = "PASS";
}

main().catch(async error => {
  report.status = "FAILED";
  report.error = String(error.stack || error);
  if (page) {
    report.diagnostics = {
      url: page.url(),
      bodyText: await page.locator("body").innerText().catch(() => null),
      alertCount: await page.locator('[role="alert"]').count().catch(() => null),
      buttons: await page.locator("button").allTextContents().catch(() => []),
    };
    try {
      const diagnosticPath = path.join(out, "failure-diagnostic.png");
      report.diagnostics.screenshot = await captureInstalledWebview(page, cdp, diagnosticPath, {
        width: 1920, height: 1080, dpr: 1, reduced: false,
      });
    } catch (captureError) {
      report.diagnostics.screenshotError = String(captureError);
    }
  } else if (browser) {
    report.diagnostics = {
      pages: browser.contexts().flatMap(context => context.pages())
        .map(candidate => ({ url: candidate.url(), title: candidate.title().catch(() => null) })),
    };
  }
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
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    runtime: report.cases[0]?.actualRuntime, cleanup: report.cleanup, out }));
});
