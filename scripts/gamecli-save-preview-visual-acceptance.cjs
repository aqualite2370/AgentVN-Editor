const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");
const sharp = require("../GameCli_framework/node_modules/sharp");

const root = path.resolve(__dirname, "..");
const runtimeDir = path.join(root, "GameCli_framework");
const fixture = path.join(root, "test_AgentVN", "final-e2e", "final-e2e.vncart");
const outputDir = path.join(root, "output", "playwright", "gamecli-save-preview-visual");
const runtimeUrl = "http://127.0.0.1:6868/?preview=1&embedded=1";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function isListening() {
  try {
    const response = await fetch("http://127.0.0.1:6868", { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isListening()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI dev server did not start.");
}

function startServer() {
  return spawn(npmCommand, ["run", "dev"], {
    cwd: runtimeDir,
    windowsHide: true,
    shell: process.platform === "win32",
    stdio: "ignore",
  });
}

function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

async function loadCartridge(page, clearSaves = true) {
  const base64 = fs.readFileSync(fixture).toString("base64");
  await page.goto(runtimeUrl, { waitUntil: "domcontentloaded" });
  if (clearSaves) {
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("agentvn.gamecli.saves.")) localStorage.removeItem(key);
      }
    });
  }
  await page.evaluate((payload) => {
    window.postMessage({
      type: "agentvn.runtime.preview",
      cartridgeBase64: payload,
      fileName: "save-preview-visual.vncart",
      previewNonce: `save-preview-${Date.now()}`,
      screen: "title_menu",
    }, window.location.origin);
  }, base64);
  await page.locator("[data-testid='start-new-game']").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(".boot-overlay").waitFor({ state: "hidden", timeout: 60_000 }).catch(() => undefined);
}

async function advanceToHero(page) {
  await page.locator("[data-testid='start-new-game']").click();
  const player = page.locator("[data-testid='game-state-playing']");
  await player.waitFor({ state: "visible", timeout: 20_000 });
  for (let index = 0; index < 40; index += 1) {
    const commandIndex = Number(await player.getAttribute("data-current-command-index"));
    if (commandIndex === 7) break;
    const dialog = page.locator(".dialog-box");
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.click({ position: { x: 160, y: 80 } });
    } else {
      await player.click({ position: { x: 620, y: 340 } });
    }
    await page.waitForTimeout(180);
  }
  await page.waitForFunction(() => (
    document.querySelector("[data-testid='game-state-playing']")?.getAttribute("data-current-command-index") === "7"
    && document.querySelector(".sprite-slot[data-character-id='hero']")?.getAttribute("data-sprite-phase") === "present"
  ), null, { timeout: 20_000 });
  await page.waitForTimeout(500);
}

async function imagePixels(buffer) {
  const { data, info } = await sharp(buffer)
    .resize(480, 270, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function blueSpriteBounds(image) {
  let left = image.width;
  let right = -1;
  let top = image.height;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * image.channels;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      if (blue < 118 || blue < green * 1.22 || blue < red * 1.35) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error("Could not find the blue sprite in the captured frame.");
  return {
    left,
    right,
    top,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function assertClose(actual, expected, label, tolerance = 1) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} differs: gameplay=${expected}, preview=${actual}, tolerance=${tolerance}`);
  }
}

async function main() {
  if (!fs.existsSync(fixture)) throw new Error(`Missing fixture: ${fixture}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const existingServer = await isListening();
  const server = existingServer ? undefined : startServer();
  if (!existingServer) await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await loadCartridge(page);
    await advanceToHero(page);
    const exclusionStyle = await page.addStyleTag({
      content: ".playback-controls,.save-status-toast,.animation-hint{visibility:hidden!important}",
    });
    const livePng = await page.locator(".story-player").screenshot({
      animations: "disabled",
      path: path.join(outputDir, "gameplay-frame.png"),
    });
    await exclusionStyle.evaluate((element) => element.remove());
    const liveBounds = blueSpriteBounds(await imagePixels(livePng));

    await page.locator(".playback-controls button").nth(2).click();
    await page.locator("[data-testid='save-slot-manual-1']").waitFor({ state: "visible", timeout: 20_000 });
    await page.locator("[data-testid='save-slot-manual-1'] .save-card-main").click();
    await page.waitForFunction(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("agentvn.gamecli.saves."));
      const saves = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
      return saves.some((save) => save.slot === 1 && save.preview_image);
    }, null, { timeout: 20_000 });
    const saved = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("agentvn.gamecli.saves."));
      const saves = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
      return saves.find((save) => save.slot === 1);
    });
    if (saved.preview_version !== 2) {
      throw new Error(`Expected preview_version 2, received ${String(saved.preview_version)}`);
    }
    const previewBuffer = Buffer.from(saved.preview_image.split(",")[1], "base64");
    fs.writeFileSync(path.join(outputDir, "saved-preview.webp"), previewBuffer);
    const previewBounds = blueSpriteBounds(await imagePixels(previewBuffer));

    for (const key of ["left", "right", "top", "bottom", "width", "height"]) {
      assertClose(previewBounds[key], liveBounds[key], `sprite ${key}`);
    }
    const legacyPreviewBuffer = await sharp({
      create: {
        width: 480,
        height: 270,
        channels: 3,
        background: "#20242c",
      },
    }).webp({ quality: 70 }).toBuffer();
    const legacyPreviewImage = `data:image/webp;base64,${legacyPreviewBuffer.toString("base64")}`;
    const legacySeed = {
      ...saved,
      save_id: `${saved.save_id}-legacy`,
      slot: 2,
      created_at: "2026-08-09T00:00:00.000Z",
      preview_image: legacyPreviewImage,
    };
    delete legacySeed.preview_version;
    await page.evaluate((legacy) => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("agentvn.gamecli.saves."));
      const saves = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
      localStorage.setItem(key, JSON.stringify([
        legacy,
        ...saves.filter((save) => !((save.save_kind || "manual") === "manual" && save.slot === 2)),
      ]));
    }, legacySeed);

    await loadCartridge(page, false);
    await page.evaluate(() => {
      window.postMessage({ type: "agentvn.runtime.screen", screen: "save_load" }, window.location.origin);
    });
    await page.locator("[data-testid='save-slot-manual-2'].has-save").waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForFunction((oldPreview) => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("agentvn.gamecli.saves."));
      const saves = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
      const legacy = saves.find((save) => (save.save_kind || "manual") === "manual" && save.slot === 2);
      return legacy?.preview_version === 2 && legacy.preview_image !== oldPreview;
    }, legacyPreviewImage, { timeout: 20_000 });
    const upgradedLegacy = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("agentvn.gamecli.saves."));
      const saves = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
      return saves.find((save) => (save.save_kind || "manual") === "manual" && save.slot === 2);
    });
    for (const key of ["save_id", "created_at", "scene_id", "command_index", "playtime_seconds"]) {
      if (upgradedLegacy[key] !== legacySeed[key]) {
        throw new Error(`Legacy preview upgrade changed ${key}.`);
      }
    }
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify({
      ok: true,
      liveBounds,
      previewBounds,
      previewVersion: saved.preview_version,
      legacyUpgrade: {
        previewVersion: upgradedLegacy.preview_version,
        preservedSaveId: upgradedLegacy.save_id,
      },
    }, null, 2));
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
