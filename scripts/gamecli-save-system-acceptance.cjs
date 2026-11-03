const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeDir = path.join(root, "GameCli_framework");
const fixture = path.join(root, "test_AgentVN", "layout-runtime", "layout-runtime.vncart");
const outputDir = path.join(root, "output", "playwright", "gamecli-save-system");
const checkpointFixture = path.join(outputDir, "auto-checkpoint.vncart");
const runtimeUrl = "http://127.0.0.1:6868/?mode=preview";
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
  const deadline = Date.now() + 30000;
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
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function prepareCheckpointFixture() {
  const zip = await JSZip.loadAsync(fs.readFileSync(fixture));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const scene = script.scenes.find((item) => item.scene_id === script.entry_scene_id) || script.scenes[0];
  const background = scene.commands.find((command) => command.type === "background");
  scene.commands = [
    ...(background ? [background] : []),
    ...Array.from({ length: 13 }, (_, index) => ({
      type: "narration",
      text: `自动存档稳定检查点 ${index + 1}`,
    })),
    {
      type: "choice",
      choices: [
        {
          choice_id: "loop",
          text: "继续下一轮",
          target_scene_id: scene.scene_id,
          conditions: [],
        },
      ],
    },
  ];
  const scriptText = JSON.stringify(script, null, 2);
  zip.file("script.json", scriptText);
  const checksum = JSON.parse(await zip.file("checksum.json").async("string"));
  const scriptChecksum = checksum.files.find((entry) => entry.path === "script.json");
  scriptChecksum.size_bytes = Buffer.byteLength(scriptText);
  scriptChecksum.hash_sha256 = crypto.createHash("sha256").update(scriptText).digest("hex");
  zip.file("checksum.json", JSON.stringify(checksum, null, 2));
  fs.writeFileSync(checkpointFixture, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

async function loadCartridge(page, clearSaves = false, cartridgePath = fixture) {
  const base64 = fs.readFileSync(cartridgePath).toString("base64");
  await page.goto(runtimeUrl, { waitUntil: "domcontentloaded" });
  if (clearSaves) {
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("agentvn.gamecli.saves.") || key === "vn.runtime.settings") localStorage.removeItem(key);
      }
    });
  }
  await page.evaluate((payload) => {
    window.postMessage({
      type: "agentvn.runtime.preview",
      cartridgeBase64: payload,
      fileName: "save-system.vncart",
      previewNonce: `save-${Date.now()}`,
      screen: "title_menu",
    }, window.location.origin);
  }, base64);
  await page.waitForFunction(() => Boolean(document.querySelector("[data-testid='start-new-game']")), undefined, { timeout: 60000 });
  await page.locator("[data-testid='start-new-game']").waitFor({ state: "visible", timeout: 60000 });
  await page.locator(".boot-overlay").waitFor({ state: "hidden", timeout: 60000 }).catch(() => undefined);
}

async function waitForDialog(page) {
  await page.locator(".boot-overlay").waitFor({ state: "hidden", timeout: 60000 }).catch(() => undefined);
  await page.waitForFunction(() => {
    const overlay = document.querySelector(".boot-overlay");
    if (!overlay) return true;
    const style = getComputedStyle(overlay);
    return style.visibility === "hidden"
      || style.display === "none"
      || style.pointerEvents === "none"
      || Number.parseFloat(style.opacity || "1") < 0.01;
  }, undefined, { timeout: 10000 }).catch(() => undefined);
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-testid='start-new-game']");
    const state = document.querySelector("[data-runtime-state]")?.getAttribute("data-runtime-state");
    return Boolean(button && state === "title_menu" && !(button instanceof HTMLButtonElement && button.disabled)
      && button.getAttribute("aria-busy") !== "true");
  }, undefined, { timeout: 20000 });
  await page.locator("[data-testid='start-new-game']").click();
  await page.locator("[data-testid='game-state-playing']").waitFor({ state: "visible", timeout: 20000 }).catch(async (error) => {
    const debug = await page.evaluate(() => ({
      body: document.body.innerText,
      screen: document.querySelector("[data-runtime-state]")?.getAttribute("data-runtime-state"),
      launch: document.querySelector("[data-runtime-state]")?.getAttribute("data-launch-transition"),
      start: document.querySelector("[data-testid='start-new-game']")?.outerHTML?.slice(0, 500),
      blackout: document.querySelector(".game-launch-blackout")?.outerHTML?.slice(0, 300),
    })).catch(() => null);
    await page.screenshot({ path: path.join(outputDir, "start-game-timeout.png") });
    const network = page.__saveNetwork ?? [];
    throw new Error(`start-new-game did not enter playing: ${JSON.stringify({ ...debug, network })}`, { cause: error });
  });
  await page.locator(".dialog-box, .choice-panel").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".game-launch-blackout").waitFor({ state: "detached", timeout: 10000 }).catch(() => undefined);
}

async function saveRecords(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("agentvn.gamecli.saves."));
    return key ? { key, records: JSON.parse(localStorage.getItem(key) || "[]") } : { key: undefined, records: [] };
  });
}

async function waitForAutoSaveChange(page, previousSaveIds = []) {
  await page.waitForFunction((previous) => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("agentvn.gamecli.saves."));
    const saves = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
    const ids = saves.filter((item) => item.save_kind === "auto").map((item) => item.save_id);
    return ids.some((id) => !previous.includes(id));
  }, previousSaveIds, { timeout: 20000 });
}

async function advanceUntilChoice(page) {
  if (await page.locator(".main-menu").isVisible().catch(() => false)) {
    const continueButton = page.locator("[data-testid='continue-game']").first();
    if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
  }
  await page.locator(".story-player").waitFor({ state: "visible", timeout: 20000 });
  for (let index = 0; index < 100; index += 1) {
    const visibleChoice = page.locator(".choice-panel button").first();
    if (await visibleChoice.isVisible().catch(() => false)) {
      const exitingChoice = page.locator(".choice-panel.is-exiting button").first();
      if (await exitingChoice.isVisible().catch(() => false)) {
        await exitingChoice.waitFor({ state: "hidden", timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(40);
        continue;
      }
      await page.locator(".choice-panel:not(.is-exiting) button:not(:disabled)").first().waitFor({ state: "visible", timeout: 10000 });
      return;
    }
    const dialog = page.locator(".dialog-box");
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.click({ position: { x: 120, y: 80 } });
    } else {
      const player = page.locator(".story-player");
      if (await player.isVisible().catch(() => false)) {
        await player.click({ position: { x: 620, y: 340 } });
      } else {
        const continueButton = page.locator("[data-testid='continue-game']").first();
        if (await continueButton.isVisible().catch(() => false)) {
          await continueButton.click();
          await player.waitFor({ state: "visible", timeout: 10000 });
        }
      }
    }
    await page.waitForTimeout(120);
  }
  throw new Error("Fixture did not reach a choice checkpoint.");
}

async function clickReadyChoice(page) {
  const choice = page.locator(".choice-panel:not(.is-exiting) button:not(:disabled)").first();
  await choice.waitFor({ state: "visible", timeout: 10000 });
  await choice.click({ force: true });
}

async function openQuickMenu(page) {
  const toggle = page.getByTestId("quick-menu-toggle");
  await toggle.waitFor({ state: "visible", timeout: 10000 });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await page.waitForTimeout(240);
  }
}

async function main() {
  if (!fs.existsSync(fixture)) throw new Error(`Missing fixture: ${fixture}`);
  fs.mkdirSync(outputDir, { recursive: true });
  await prepareCheckpointFixture();
  const existingServer = await isListening();
  const server = existingServer ? undefined : startServer();
  if (!existingServer) await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const report = { checks: [], screenshots: [] };
  page.__saveNetwork = [];
  page.on("response", (response) => {
    const url = response.url();
    if (response.status() >= 400 || /\.json(?:$|\?)/i.test(url)) {
      page.__saveNetwork.push({ kind: "response", status: response.status(), url });
    }
  });
  page.on("requestfailed", (request) => {
    page.__saveNetwork.push({ kind: "failed", url: request.url(), error: request.failure()?.errorText });
  });
  try {
    await page.addInitScript(() => {
      const realNow = Date.now.bind(Date);
      let offset = 0;
      Date.now = () => realNow() + offset;
      window.__advanceSaveClock = (milliseconds) => {
        offset += milliseconds;
      };
    });
    // A previous standalone-package build may leave the dev server's
    // fixed-only marker enabled. This acceptance flow is explicitly a
    // browser preview and must not accidentally boot the packaged
    // embedded-cartridge path.
    await page.route("**/fixed-only.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fixedOnly: false }),
    }));
    await loadCartridge(page, true);
    await waitForDialog(page);
    await openQuickMenu(page);
    const saveQuickButton = page.locator('.playback-controls button[aria-label="打开存档读档"]');
    await saveQuickButton.evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });
    await page.locator(".save-load-screen").waitFor({ state: "visible", timeout: 20000 });
    await page.locator("[data-testid='save-slot-manual-1']").waitFor({ state: "visible", timeout: 10000 });
    const saveScreenCopy = await page.locator(".save-load-screen").innerText();
    const forbiddenSaveCopy = [
      "SAVE ARCHIVE",
      "\u4fdd\u5b58\u8fdb\u5ea6",
      "\u8bfb\u53d6\u5b58\u6863",
      "FILE 01",
      "AUTO 01",
      "\u5c1a\u672a\u4fdd\u5b58",
      "\u7a7a\u5b58\u6863\u69fd",
      "\u70b9\u51fb\u4fdd\u5b58",
    ];
    for (const forbiddenCopy of forbiddenSaveCopy) {
      if (saveScreenCopy.includes(forbiddenCopy)) {
        throw new Error(`Save screen still contains removed copy: ${forbiddenCopy}`);
      }
    }
    const kindLabels = await page.locator(".save-kind-tabs button").allTextContents();
    if (JSON.stringify(kindLabels.map(label => label.trim())) !== JSON.stringify(["手动", "自动", "快存"])) {
      throw new Error(`Save kind tabs must show 手动/自动/快存 in order: ${JSON.stringify(kindLabels)}`);
    }
    await page.getByRole("tab", { name: "快存", exact: true }).click();
    await page.getByTestId("save-slot-quick-1").waitFor({ state: "visible" });
    if (await page.getByRole("button", { name: "保存", exact: true }).isEnabled()) {
      throw new Error("Quick saves are created from the Ren’Py quick bar, not overwritten through the manual save screen.");
    }
    report.checks.push("quick-save-category-is-load-only-from-archive");
    await page.getByRole("tab", { name: "手动", exact: true }).click();
    if (!saveScreenCopy.includes("\u5b58\u6863 01")) {
      throw new Error(`Save screen is missing the enlarged slot label: ${saveScreenCopy}`);
    }
    if (/\?{2,}/.test(saveScreenCopy)) {
      throw new Error(`Save screen contains corrupted question-mark text: ${saveScreenCopy}`);
    }
    report.checks.push("save-screen-copy-is-readable");
    await page.locator(".save-kind-tabs button").filter({ hasText: "\u81ea\u52a8" }).click();
    if (await page.getByRole("button", { name: "\u4fdd\u5b58", exact: true }).isEnabled()) {
      throw new Error("Save button must be disabled when auto saves are selected.");
    }
    report.checks.push("auto-save-disables-save");
    await page.getByRole("button", { name: "\u8bfb\u53d6", exact: true }).click({ force: true });
    await page.waitForTimeout(100);
    const emptyLoadScreenCopy = await page.locator(".save-load-screen").innerText();
    if (emptyLoadScreenCopy.includes("\u8bfb\u53d6\u5b58\u6863") || emptyLoadScreenCopy.includes("\u9009\u62e9\u4e00\u4e2a\u624b\u52a8\u5b58\u6863\u8bfb\u53d6")) {
      throw new Error(`Empty load screen still contains removed helper copy: ${emptyLoadScreenCopy}`);
    }
    await page.getByRole("tab", { name: "\u624b\u52a8", exact: true }).click();
    await page.getByRole("button", { name: "\u4fdd\u5b58", exact: true }).click();
    await page.locator("[data-testid='save-slot-manual-1'] .save-card-main").click();
    await page.waitForFunction(() => document.querySelector(".save-operation-status")?.textContent?.includes("存档已保存"), null, { timeout: 20000 });

    const manual = await saveRecords(page);
    const manualSave = manual.records.find((item) => (item.save_kind || "manual") === "manual" && item.slot === 1);
    if (!manualSave) throw new Error("Manual save was not persisted.");
    if (manualSave.save_version !== 3) throw new Error("Manual save version is not 3.");
    if (manualSave.camera?.schema_version !== 1) throw new Error("Manual save camera state is missing.");
    if (!String(manualSave.preview_image || "").startsWith("data:image/webp;base64,")) throw new Error("Manual save preview is missing.");
    if (manualSave.playtime_seconds < 0) throw new Error("Manual save playtime is invalid.");
    report.checks.push("manual-save-with-webp-preview");

    const desktopScreenshot = path.join(outputDir, "save-gallery-1280x720.png");
    await page.screenshot({ path: desktopScreenshot, fullPage: false });
    report.screenshots.push(desktopScreenshot);

    await page.getByRole("button", { name: "\u8bfb\u53d6", exact: true }).click({ force: true });
    await page.waitForTimeout(100);
    const loadScreenCopy = await page.locator(".save-load-screen").innerText();
    const deleteButtonCount = await page.locator("[data-testid='save-slot-manual-1'] .save-delete-button").count();
    if (deleteButtonCount !== 1 || loadScreenCopy.includes("\u8bfb\u53d6\u5b58\u6863")) {
      throw new Error(`Load screen copy is incorrect: ${loadScreenCopy}`);
    }
    await page.locator("[data-testid='save-slot-manual-1']").getByRole("button", { name: "\u5220\u9664" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "\u5220\u9664\u5b58\u6863" });
    await deleteDialog.waitFor({ state: "visible" });
    const deleteDialogCopy = await deleteDialog.innerText();
    if (!deleteDialogCopy.includes("\u786e\u5b9a\u8981\u5220\u9664\u8fd9\u4e2a\u5b58\u6863\u5417\uff1f\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\u3002")) {
      throw new Error(`Delete confirmation copy is incorrect: ${deleteDialogCopy}`);
    }
    await deleteDialog.getByRole("button", { name: "\u53d6\u6d88", exact: true }).click();
    await deleteDialog.waitFor({ state: "hidden" });
    report.checks.push("load-and-delete-copy-is-readable");

    await page.locator(".save-load-header .screen-back-button").click();
    await advanceUntilChoice(page);
    await page.waitForFunction(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("agentvn.gamecli.saves."));
      const saves = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
      return saves.some((item) => item.save_kind === "auto");
    }, null, { timeout: 20000 });
    const withAuto = await saveRecords(page);
    if (!withAuto.records.some((item) => item.save_kind === "auto" && item.slot >= 1 && item.slot <= 8)) {
      throw new Error("Choice checkpoint did not create an auto save.");
    }
    report.checks.push("choice-checkpoint-auto-save");

    await openQuickMenu(page);
    await page.locator('.playback-controls button[aria-label="打开存档读档"]').click({ force: true });
    await page.locator(".save-load-screen").waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "读取", exact: true }).click();
    await page.getByRole("tab", { name: "自动", exact: true }).click();
    await page.locator("[data-testid='save-slot-auto-1'].has-save").waitFor({ state: "visible", timeout: 10000 });
    const autoActionLabel = await page.locator("[data-testid='save-slot-auto-1'] .save-card-main").getAttribute("aria-label");
    if (!autoActionLabel?.startsWith("读取自动存档")) throw new Error(`Auto save card is not read-only: ${autoActionLabel}`);
    report.checks.push("auto-save-category-read-only");
    await page.locator(".save-load-header .screen-back-button").click();

    const legacy = { ...manualSave, save_version: undefined, save_kind: undefined, preview_image: undefined, slot: 2 };
    await page.evaluate(({ key, legacy }) => {
      const records = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify([
        legacy,
        ...records.filter((item) => !((item.save_kind || "manual") === "manual" && item.slot === 2)),
      ]));
    }, { key: withAuto.key, legacy });
    await page.reload({ waitUntil: "domcontentloaded" });
    await loadCartridge(page);
    await page.evaluate(() => {
      window.postMessage({ type: "agentvn.runtime.screen", screen: "save_load" }, window.location.origin);
    });
    await page.locator("[data-testid='save-slot-manual-2'].has-save").waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".boot-overlay").waitFor({ state: "hidden", timeout: 60000 }).catch(() => undefined);
    report.checks.push("legacy-save-normalized-as-manual");

    await page.setViewportSize({ width: 700, height: 394 });
    await page.waitForTimeout(900);
    const narrowScreenshot = path.join(outputDir, "save-gallery-700x394.png");
    await page.screenshot({ path: narrowScreenshot, fullPage: false });
    report.screenshots.push(narrowScreenshot);
    const columns = await page.locator("[data-testid='save-slot-grid']").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    if (columns < 2 || columns > 3) throw new Error(`Expected two or three narrow columns, received ${columns}.`);
    report.checks.push("narrow-grid-layout");

    await page.setViewportSize({ width: 1280, height: 720 });
    await loadCartridge(page, true, checkpointFixture);
    await page.locator("[data-testid='open-settings']").click();
    await page.locator(".settings-tabs button").filter({ hasText: "系统" }).click();
    await page.getByRole("checkbox", { name: "自动存档" }).uncheck();
    await page.locator("[data-testid='settings-finish']").click();
    await waitForDialog(page);
    const beforeTwelve = await saveRecords(page);
    await advanceUntilChoice(page);
    await page.waitForTimeout(1200);
    const disabledRecords = await saveRecords(page);
    if (disabledRecords.records.some((item) => item.save_kind === "auto")) {
      throw new Error("Disabled automatic saving still wrote an auto slot.");
    }
    report.checks.push("disabled-auto-save-writes-nothing");

    await openQuickMenu(page);
    await page.locator('.playback-controls button[data-testid="open-main-menu"]').click({ force: true });
    await page.locator("[data-testid='main-menu']").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.locator("[data-testid='open-settings']").click({ force: true });
    await page.locator("[data-testid='settings-screen']").waitFor({ state: "visible", timeout: 20000 });
    await page.locator(".settings-tabs button").filter({ hasText: "系统" }).click();
    await page.getByRole("checkbox", { name: "自动存档" }).check();
    await page.locator("[data-testid='settings-finish']").click();
    await page.evaluate(() => window.__advanceSaveClock(31_000));
    if (await page.locator("[data-testid='start-new-game']").isVisible().catch(() => false)) {
      await waitForDialog(page);
    }
    await page.locator("[data-testid='game-state-playing']").waitFor({ state: "visible", timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(1800);
    await advanceUntilChoice(page);
    await clickReadyChoice(page);
    await page.locator(".dialog-box").waitFor({ state: "visible", timeout: 10000 });
    await advanceUntilChoice(page);
    await waitForAutoSaveChange(page, beforeTwelve.records.filter((item) => item.save_kind === "auto").map((item) => item.save_id));
    const firstCheckpointRecords = await saveRecords(page);
    const firstAuto = firstCheckpointRecords.records.find((item) => item.save_kind === "auto" && item.slot === 1);
    if (!firstAuto) throw new Error("Twelve stable checkpoints did not create the first auto save.");
    report.checks.push("twelve-stable-checkpoints-auto-save");

    for (let cycle = 0; cycle < 8; cycle += 1) {
      const beforeCycle = await saveRecords(page);
      const previousIds = beforeCycle.records.filter((item) => item.save_kind === "auto").map((item) => item.save_id);
      await page.evaluate(() => window.__advanceSaveClock(31_000));
      await advanceUntilChoice(page);
      await clickReadyChoice(page);
      await page.locator(".choice-panel:not(.is-exiting) button:not(:disabled)").first().waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
      await page.locator(".dialog-box").waitFor({ state: "visible", timeout: 10000 });
      await advanceUntilChoice(page);
      await waitForAutoSaveChange(page, previousIds);
    }
    const rotated = await saveRecords(page);
    const autoSaves = rotated.records.filter((item) => item.save_kind === "auto");
    if (autoSaves.length !== 8) throw new Error(`Auto save rotation retained ${autoSaves.length} slots instead of 8.`);
    const rotatedSlotOne = autoSaves.find((item) => item.slot === 1);
    if (!rotatedSlotOne || rotatedSlotOne.save_id === firstAuto.save_id) throw new Error("The ninth auto save did not replace the oldest slot.");
    report.checks.push("eight-slot-oldest-first-rotation");
  } finally {
    report.ok = report.checks.length === 12;
    if (!report.ok) throw new Error(`Save-system acceptance completed ${report.checks.length}/12 required checks.`);
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
