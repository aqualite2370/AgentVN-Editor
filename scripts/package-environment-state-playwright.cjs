const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.join(__dirname, "..", "editor", "node_modules", "playwright"));

const root = path.resolve(__dirname, "..");
const editorUrl = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";

async function main() {
  const browser = await chromium.launch();
  try {
    for (const viewport of [
      { width: 2048, height: 1114 },
      { width: 1280, height: 720 },
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport });
      await page.addInitScript(() => {
        const environmentCalls = [];
        const passedResult = {
          ok: true,
          status: "PASS",
          message: "Windows standalone package environment is ready.",
          checks: [],
          missing: [],
          warnings: [],
          manualFix: [],
          cacheHit: false,
        };
        const failedResult = {
          ok: false,
          status: "BLOCKED",
          message: "Windows standalone package environment is missing required tools: cargo",
          checks: [],
          missing: ["cargo"],
          warnings: [],
          manualFix: ["Install stable-msvc"],
          cacheHit: false,
        };
        window.__TAURI_INTERNALS__ = {
          invoke: async (command, args) => {
            environmentCalls.push({ command, args });
            window.__AGENTVN_ENVIRONMENT_CALLS__ = environmentCalls;
            if (command === "install_windows_build_environment") {
              return new Promise((resolve) => {
                window.__AGENTVN_RESOLVE_WINDOWS_INSTALL__ = () => resolve(passedResult);
              });
            }
            if (command === "check_windows_build_environment") {
              return new Promise((resolve) => {
                window.__AGENTVN_RESOLVE_WINDOWS_CHECK__ = (cached = false) => resolve(cached ? { ...passedResult, cacheHit: true } : failedResult);
              });
            }
            if (command === "install_android_build_environment") {
              return new Promise((resolve) => {
                window.__AGENTVN_RESOLVE_ANDROID_INSTALL__ = () => resolve({
                  ...passedResult,
                  message: "Android build environment is ready.",
                });
              });
            }
            if (command === "check_android_build_environment") {
              return new Promise((resolve) => {
                window.__AGENTVN_RESOLVE_ANDROID_CHECK__ = (cached = false) => resolve(cached ? { ...passedResult, cacheHit: true } : {
                  ...failedResult,
                  message: "Android build environment is missing required tools: Android SDK",
                  missing: ["Android SDK"],
                });
              });
            }
            if (command === "import_android_environment_package") {
              return new Promise((resolve) => {
                window.__AGENTVN_RESOLVE_ANDROID_IMPORT__ = () => resolve({
                  ...passedResult,
                  message: "Android build environment is ready.",
                  installSource: "avnenv",
                  symlinkCapability: {
                    schemaVersion: 2,
                    probeRoot: "C:\\AgentVN\\build-workspace",
                    success: false,
                    win32ErrorCode: 1314,
                    isElevated: false,
                  },
                  symlinkElevation: {
                    attempted: false,
                    status: "DEFERRED_TO_BUILD",
                  },
                  importedEnvironmentPackage: {
                    path: "C:\\Packages\\AgentVN-Android-Environment.avnenv",
                    packageId: "agentvn.android.windows-x86_64.api36",
                    packVersion: "test-pack",
                    totalBytes: 1024,
                    fileCount: 8,
                    installSource: "avnenv",
                    status: "PASS",
                  },
                });
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
      await page.locator('[data-workspace-surface="publish"]').click();
      await page.locator(".cartridge-export-panel").waitFor({ state: "visible", timeout: 30000 });
      const card = page.locator(".windows-env-panel");
      await page.waitForFunction(() => typeof window.__AGENTVN_RESOLVE_WINDOWS_CHECK__ === "function");
      await page.evaluate(() => window.__AGENTVN_RESOLVE_WINDOWS_CHECK__());
      const automaticDialog = page.locator('[data-testid="package-environment-operation-dialog"]');
      await automaticDialog.locator('[data-environment-operation-phase="failed"]').waitFor();
      await automaticDialog.locator('footer button:not(:disabled)').click();
      await page.locator('.windows-env-panel[data-environment-verification="failed"]').waitFor();
      const exportAction = page.locator('[data-help-key="package.export"]');
      assert.equal(await exportAction.isDisabled(), true, "unchecked environments must block builds");
      assert.match(await exportAction.innerText(), /请先补齐 Windows 环境/);

      await card.locator('[data-help-key="package.windowsEnvInstall"]').click();
      const environmentDialog = page.locator('[data-testid="package-environment-operation-dialog"]');
      await environmentDialog.waitFor({ state: "visible", timeout: 5000 });
      assert.equal(await environmentDialog.getAttribute("data-environment-platform"), "windows");
      assert.equal(await environmentDialog.getAttribute("data-environment-operation"), "install");
      assert.notEqual(await environmentDialog.getAttribute("data-environment-phase"), "completed");
      assert.equal(await environmentDialog.locator("footer button:disabled").isDisabled(), true, "an active repair dialog must not be dismissible");
      assert.equal(
        await environmentDialog.locator("footer button:not(:disabled)").count(),
        0,
        "an active repair dialog must not expose an enabled hide or close action",
      );
      assert.match(await environmentDialog.innerText(), /检查当前环境/);
      await page.waitForFunction(() => typeof window.__AGENTVN_RESOLVE_WINDOWS_INSTALL__ === "function");
      await page.evaluate(() => window.__AGENTVN_RESOLVE_WINDOWS_INSTALL__());
      await environmentDialog.locator('[data-environment-operation-phase="completed"]').waitFor({ state: "visible", timeout: 5000 });
      await page.locator('.windows-env-panel[data-environment-verification="passed"]').waitFor({ state: "visible", timeout: 30000 });
      assert.equal(await card.locator("span").first().innerText(), "已通过");
      assert.equal(await environmentDialog.locator("footer button:not(:disabled)").count(), 1, "a completed repair dialog must have one completion action");
      await environmentDialog.locator("footer button:not(:disabled)").click();
      await environmentDialog.waitFor({ state: "hidden", timeout: 5000 });

      await card.locator('[data-help-key="package.windowsEnvCheck"]').click();
      await environmentDialog.waitFor({ state: "visible", timeout: 5000 });
      assert.equal(await environmentDialog.getAttribute("data-environment-operation"), "check");
      assert.equal(await environmentDialog.locator("footer button:disabled").isDisabled(), true, "an active check dialog must not be dismissible");
      assert.equal(
        await environmentDialog.locator("footer button:not(:disabled)").count(),
        0,
        "an active check dialog must not expose an enabled hide or close action",
      );
      await page.waitForFunction(() => typeof window.__AGENTVN_RESOLVE_WINDOWS_CHECK__ === "function");
      await page.evaluate(() => window.__AGENTVN_RESOLVE_WINDOWS_CHECK__());
      await environmentDialog.locator('[data-environment-operation-phase="failed"]').waitFor({ state: "visible", timeout: 5000 });
      await page.locator('.windows-env-panel[data-environment-verification="failed"]').waitFor({ state: "visible", timeout: 30000 });
      await card.waitFor({ state: "visible", timeout: 30000 });
      assert.equal(await card.locator("span").first().innerText(), "未通过");
      assert.match(await card.innerText(), /cargo/);
      assert.match(await environmentDialog.innerText(), /cargo/);
      assert.equal(await environmentDialog.locator("footer button").isDisabled(), false, "a failed check dialog must be dismissible");
      await environmentDialog.locator("footer button").click();
      await environmentDialog.waitFor({ state: "hidden", timeout: 5000 });
      assert.equal(await exportAction.isDisabled(), true, "failed environments must block builds");
      assert.match(await exportAction.innerText(), /请先补齐 Windows 环境/);
      const checkCall = await page.evaluate(() => window.__AGENTVN_ENVIRONMENT_CALLS__.find(
        (item) => item.command === "check_windows_build_environment",
      ));
      assert.equal(checkCall.args.forceRecheck, false, "normal check must reuse this editor version's cached PASS");

      await page.locator('[data-help-key="package.platform"]').click();
      await page.getByRole("option", { name: /Android/ }).click();
      const androidCard = page.locator(".android-env-panel.package-environment-card");
      await androidCard.waitFor({ state: "visible", timeout: 5000 });

      // Selecting an unchecked platform automatically starts its versioned check.
      await environmentDialog.waitFor({ state: "visible", timeout: 5000 });
      assert.equal(await environmentDialog.getAttribute("data-environment-platform"), "android");
      assert.equal(await environmentDialog.getAttribute("data-environment-operation"), "check");
      assert.match(await environmentDialog.innerText(), /检查当前环境/);
      await page.waitForFunction(() => typeof window.__AGENTVN_RESOLVE_ANDROID_CHECK__ === "function");
      await page.evaluate(() => window.__AGENTVN_RESOLVE_ANDROID_CHECK__());
      await environmentDialog.locator('[data-environment-operation-phase="failed"]').waitFor({ state: "visible", timeout: 5000 });
      assert.match(await environmentDialog.innerText(), /Android SDK/);
      await environmentDialog.locator("footer button").click();
      await environmentDialog.waitFor({ state: "hidden", timeout: 5000 });

      await androidCard.locator('[data-help-key="package.androidEnvInstall"]').click();
      await environmentDialog.waitFor({ state: "visible", timeout: 5000 });
      assert.equal(await environmentDialog.getAttribute("data-environment-platform"), "android");
      assert.equal(await environmentDialog.getAttribute("data-environment-operation"), "install");
      assert.match(await environmentDialog.innerText(), /安装构建依赖/);
      await page.waitForFunction(() => typeof window.__AGENTVN_RESOLVE_ANDROID_INSTALL__ === "function");
      await page.evaluate(() => window.__AGENTVN_RESOLVE_ANDROID_INSTALL__());
      await environmentDialog.locator('[data-environment-operation-phase="completed"]').waitFor({ state: "visible", timeout: 5000 });
      await page.locator('.android-env-panel[data-environment-verification="passed"]').waitFor({ state: "visible", timeout: 5000 });
      await environmentDialog.locator("footer button").click();
      await environmentDialog.waitFor({ state: "hidden", timeout: 5000 });

      await androidCard.locator('[data-help-key="package.androidEnvImport"]').click();
      await environmentDialog.waitFor({ state: "visible", timeout: 5000 });
      assert.equal(await environmentDialog.getAttribute("data-environment-platform"), "android");
      assert.equal(await environmentDialog.getAttribute("data-environment-operation"), "import");
      assert.equal(
        await environmentDialog.locator("footer button:disabled").isDisabled(),
        true,
        "an active import dialog must not be dismissible",
      );
      assert.equal(
        await environmentDialog.locator("footer button:not(:disabled)").count(),
        0,
        "an active import dialog must not expose an enabled hide or close action",
      );
      assert.match(
        await environmentDialog.innerText(),
        /MSVC.*管理员权限/,
        "Android environment import must explain the administrator prompt before host-tool verification",
      );
      await page.waitForFunction(() => typeof window.__AGENTVN_RESOLVE_ANDROID_IMPORT__ === "function");
      await page.evaluate(() => window.__AGENTVN_RESOLVE_ANDROID_IMPORT__());
      await environmentDialog.locator('[data-environment-operation-phase="completed"]').waitFor({ state: "visible", timeout: 5000 });
      assert.match(
        await environmentDialog.innerText(),
        /Android 独立包构建默认需要管理员权限/,
        "the default administrator requirement must be explained at import completion",
      );
      await environmentDialog.locator("footer button").click();
      await environmentDialog.waitFor({ state: "hidden", timeout: 5000 });
      const environmentCheckCalls = () => page.evaluate(() => window.__AGENTVN_ENVIRONMENT_CALLS__.filter(
        item => /^(check_windows|check_android)_build_environment$/.test(item.command),
      ));
      for (const platform of ["windows", "android"]) {
        await page.locator('[data-help-key="package.platform"]').click();
        await page.getByRole("option", { name: platform === "windows" ? /Windows/ : /Android/ }).click();
        await page.evaluate(() => {
          delete window.__AGENTVN_RESOLVE_WINDOWS_CHECK__;
          delete window.__AGENTVN_RESOLVE_ANDROID_CHECK__;
        });
        await page.locator(`[data-help-key="package.${platform}EnvCheck"]`).click();
        await page.waitForFunction(platform => typeof window[`__AGENTVN_RESOLVE_${platform.toUpperCase()}_CHECK__`] === "function", platform);
        await page.evaluate(platform => window[`__AGENTVN_RESOLVE_${platform.toUpperCase()}_CHECK__`](true), platform);
        await environmentDialog.locator('[data-environment-operation-phase="completed"]').waitFor();
        assert.doesNotMatch(await environmentDialog.locator('#package-environment-operation-description').innerText(), /正在/);
        await environmentDialog.locator("footer button").click();
        await environmentDialog.waitFor({ state: "hidden" });
        const cachedCard = page.locator(`.${platform}-env-panel.package-environment-card`);
        assert.equal(await cachedCard.getAttribute("data-environment-verification"), "passed", `${platform}: cached PASS must agree with the completed dialog`);
        assert.match(await cachedCard.innerText(), /已复用当前编辑器版本/);
        assert.doesNotMatch(await exportAction.innerText(), /请先检测|请先补齐/);
        assert.equal(await page.getByText("环境尚未检测", { exact: true }).count(), 0);
      }
      const checksBeforeRevisit = await environmentCheckCalls();
      assert.equal(checksBeforeRevisit.length, 5, "initial checks and both cached rechecks must run exactly once each");
      assert.ok(checksBeforeRevisit.every(item => item.args.forceRecheck === false), "both platforms must request the versioned cache");
      await page.getByRole("button", { name: "关闭发布与打包", exact: true }).click();
      await page.locator('.cartridge-export-panel').waitFor({ state: "hidden" });
      await page.locator('[data-workspace-surface="publish"]').click();
      await androidCard.waitFor({ state: "visible" });
      await page.locator('[data-help-key="package.platform"]').click();
      await page.getByRole("option", { name: /Windows/ }).click();
      await card.waitFor({ state: "visible" });
      await page.locator('[data-help-key="package.platform"]').click();
      await page.getByRole("option", { name: /Android/ }).click();
      await androidCard.waitFor({ state: "visible" });
      assert.deepEqual(await environmentCheckCalls(), checksBeforeRevisit, "reopening publish and switching platforms must retain the existing detection results");
      const bounds = await androidCard.boundingBox();
      assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `card is not visible at ${viewport.width}x${viewport.height}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      assert.equal(overflow, true, `horizontal overflow at ${viewport.width}x${viewport.height}`);
      await page.close();
    }
    console.log("PASS package environment verification browser acceptance");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
