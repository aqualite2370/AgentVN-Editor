const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.join(__dirname, "..", "editor", "node_modules", "playwright"));

const editorUrl = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";

async function main() {
  const browser = await chromium.launch();
  try {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport });
      await page.addInitScript(() => {
        const calls = [];
        const result = {
          ok: true,
          status: "PASS",
          message: "Windows standalone package environment is ready.",
          checks: [],
          missing: [],
          warnings: [],
          manualFix: [],
          cacheHit: false,
        };
        window.__AGENTVN_ENVIRONMENT_CALLS__ = calls;
        window.__TAURI_INTERNALS__ = {
          invoke: async (command, args) => {
            calls.push({ command, args });
            if (command === "install_windows_build_environment") {
              return new Promise((resolve) => {
                window.__AGENTVN_RESOLVE_WINDOWS_INSTALL__ = () => resolve(result);
              });
            }
            throw new Error(`Unexpected mocked Tauri command: ${command}`);
          },
          transformCallback: () => 1,
          unregisterCallback: () => {},
          callbacks: {},
        };
      });
      await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
      const create = page.locator('[data-help-key="home.createProject"]:not([disabled])').first();
      await create.waitFor({ state: "visible", timeout: 60000 });
      await create.click();
      await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60000 });
      await page.locator('[data-help-key="toolbar.exportCartridge"]').click();
      await page.locator(".cartridge-export-panel").waitFor({ state: "visible", timeout: 30000 });
      await page.locator('.windows-env-panel[data-environment-verification="unchecked"]').waitFor({ state: "visible", timeout: 30000 });

      await page.locator('[data-help-key="package.windowsEnvInstall"]').click();
      const dialog = page.locator('[data-testid="package-environment-operation-dialog"]');
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      const initialRunId = await dialog.getAttribute("data-environment-run-id");
      assert.ok(initialRunId, "active environment task must expose a run id");
      assert.equal(await page.locator('[data-help-key="package.windowsEnvInstall"]').isDisabled(), true);

      assert.equal(
        await page.getByRole("button", { name: "隐藏面板，后台继续" }).count(),
        0,
        "an active environment operation must not expose a background/hide action",
      );
      assert.equal(
        await dialog.locator("footer button:not(:disabled)").count(),
        0,
        "an active environment dialog must not expose an enabled close action",
      );
      assert.equal(await dialog.isVisible(), true, "the active operation dialog must remain visible");
      assert.equal(await page.locator('[data-help-key="package.windowsEnvInstall"]').isDisabled(), true);

      const activeBounds = await dialog.boundingBox();
      assert.ok(
        activeBounds
        && activeBounds.x >= 0
        && activeBounds.y >= 0
        && activeBounds.x + activeBounds.width <= viewport.width
        && activeBounds.y + activeBounds.height <= viewport.height,
        `active dialog must stay inside viewport at ${viewport.width}x${viewport.height}`,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        true,
        `active package panel must not overflow horizontally at ${viewport.width}x${viewport.height}`,
      );

      await page.evaluate(() => window.__AGENTVN_RESOLVE_WINDOWS_INSTALL__());
      await dialog.locator('[data-environment-operation-phase="completed"]').waitFor({ state: "visible", timeout: 5000 });
      await page.locator('.windows-env-panel[data-environment-verification="passed"]').waitFor({ state: "visible", timeout: 30000 });
      assert.equal(
        await dialog.locator("footer button:not(:disabled)").count(),
        1,
        "a completed environment dialog must expose exactly one close action",
      );
      await dialog.locator("footer button:not(:disabled)").click();
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      await page.close();
    }
    console.log("PASS package environment dialog lifecycle browser acceptance");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
