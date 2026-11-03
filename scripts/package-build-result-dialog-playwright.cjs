const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const esbuild = require("../editor/node_modules/esbuild");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const outDir = process.env.AGENTVN_PACKAGE_RESULT_DIALOG_OUTPUT
  || path.join(root, "output", "playwright", "package-build-result-dialog",
    new Date().toISOString().replace(/[:.]/g, "-"));
const port = Number(process.env.AGENTVN_PACKAGE_RESULT_DIALOG_PORT || 6772);
const baseUrl = `http://127.0.0.1:${port}/`;
const vite = path.join(editorRoot, "node_modules", ".bin", "vite.cmd");

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

function buildHarness() {
  const source = `
    import React, { useEffect, useRef, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { AlertTriangle, CircleX, FolderOpen, PackageCheck } from "lucide-react";
    import { OperationResultDialog } from "./src/components/common/OperationResultDialog";
    import {
      createPackageBuildResultDialogModel,
      createPackageBuildExceptionDialogModel,
    } from "./src/packaging/packageBuildResultDialog";

    function mockResult(status, options = {}) {
      return {
        ok: status === "PASS",
        status,
        message: status === "PASS"
          ? "独立软件包、安装包与构建清单均已生成。"
          : status === "BLOCKED"
            ? "缺少构建环境，软件包没有生成。"
            : "编译器返回错误，软件包没有生成。",
        artifacts: status === "PASS" ? [
          { kind: "exe", path: "D:\\\\release\\\\game.exe", bytes: 24000000 },
          { kind: "installer", path: "D:\\\\release\\\\game-setup.exe", bytes: 26000000 },
        ] : [],
        warnings: status === "PASS" ? ["使用了默认图标"] : [],
        verifyReportPath: "",
        buildLogPath: status === "PASS" ? "" : "D:\\\\cache\\\\build.log",
        manifestPath: "",
        diagnosticsDir: options.withDiagnostics === false || status === "PASS" ? "" : "D:\\\\cache\\\\diagnostics",
        diagnosticsArchivePath: "",
        failureCode: status === "PASS" ? undefined : "BUILD_FAILED",
      };
    }

    function Harness() {
      const [model, setModel] = useState();
      const triggerRef = useRef(null);
      useEffect(() => {
        window.__AGENTVN_DIALOG_ACTIONS__ = [];
        window.__AGENTVN_SHOW_RESULT_DIALOG__ = (status, options = {}) => {
          const next = status === "EXCEPTION"
            ? createPackageBuildExceptionDialogModel(options.platform || "windows", new Error(options.message || "上传连接中断"))
            : createPackageBuildResultDialogModel({
                result: mockResult(status, options),
                targetPlatform: options.platform || "windows",
                outputDir: options.withOutput === false ? "" : "D:\\\\release",
              });
          setModel(next);
        };
        triggerRef.current?.focus();
      }, []);
      const Icon = model?.tone === "success" ? PackageCheck : model?.tone === "warning" ? AlertTriangle : CircleX;
      return React.createElement(
        "main",
        { className: "app-root operation-result-harness", id: "operation-result-harness" },
        React.createElement(
          "section",
          { className: "package-section package-build-panel", id: "underlying-package-panel" },
          React.createElement("strong", null, "软件包构建结果"),
          React.createElement("p", null, "弹窗关闭后，此处仍保留完整日志与重试入口。"),
          React.createElement("button", { id: "package-export-trigger", ref: triggerRef, type: "button" }, "构建 Windows 独立软件包"),
        ),
        model && React.createElement(OperationResultDialog, {
          open: true,
          tone: model.tone,
          label: model.label,
          title: model.title,
          message: model.message,
          icon: React.createElement(Icon, { size: 20 }),
          details: model.details,
          contextAction: model.action ? {
            label: model.action.label,
            icon: React.createElement(FolderOpen, { size: 16 }),
            onClick: () => window.__AGENTVN_DIALOG_ACTIONS__.push(model.action),
          } : undefined,
          testId: "package-build-result-dialog",
          closeAriaLabel: "关闭软件构建结果",
          returnFocusRef: triggerRef,
          onDismiss: () => setModel(undefined),
        }),
      );
    }

    createRoot(document.getElementById("root")).render(React.createElement(Harness));
  `;
  const result = esbuild.buildSync({
    stdin: {
      contents: source,
      loader: "jsx",
      resolveDir: editorRoot,
      sourcefile: "package-result-dialog-harness.jsx",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    write: false,
  });
  return result.outputFiles[0].text;
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Editor Vite server did not start: ${baseUrl}`);
}

async function preparePage(context, bundle) {
  const page = await context.newPage();
  await page.setContent(`
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="${baseUrl}src/styles/variables.css" />
        <link rel="stylesheet" href="${baseUrl}src/styles/layout.css" />
        <style>
          html, body, #root { width: 100%; min-height: 100%; margin: 0; }
          .operation-result-harness { display: grid; place-items: center; min-height: 100vh; padding: 24px; }
          #underlying-package-panel { width: min(760px, calc(100vw - 48px)); min-height: 260px; align-content: center; }
          #underlying-package-panel button { width: fit-content; margin-top: 18px; }
        </style>
      </head>
      <body><div id="root"></div></body>
    </html>
  `);
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => typeof window.__AGENTVN_SHOW_RESULT_DIALOG__ === "function");
  return page;
}

async function show(page, status, options = {}) {
  await page.evaluate(({ nextStatus, nextOptions }) => {
    window.__AGENTVN_SHOW_RESULT_DIALOG__(nextStatus, nextOptions);
  }, { nextStatus: status, nextOptions: options });
  await page.locator('[data-testid="package-build-result-dialog"]').waitFor({ state: "visible" });
  await page.waitForTimeout(420);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const bundle = buildHarness();
  const server = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", vite, "--host", "127.0.0.1", "--port", String(port)], {
    cwd: editorRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

  try {
    await waitForServer();
    const browser = await chromium.launch({ headless: true });
    try {
      const desktop = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await preparePage(desktop, bundle);

      await show(page, "PASS");
      const passDialog = page.locator(".operation-result-dialog");
      assert(await passDialog.getAttribute("class").then((value) => value.includes("is-success")), "PASS must use success styling");
      assert(await page.getByRole("heading", { name: "Windows 软件构建成功" }).isVisible(), "PASS title is missing");
      assert(await page.getByText("D:\\release", { exact: true }).isVisible(), "PASS output directory is missing");
      assert(await page.getByText("2 项", { exact: true }).isVisible(), "PASS artifact count is missing");
      assert(await page.getByText("1 条", { exact: true }).isVisible(), "PASS warning count is missing");
      await page.screenshot({ path: path.join(outDir, "01-pass-desktop.png"), fullPage: true });
      await page.getByRole("button", { name: "打开输出目录" }).click();
      const actions = await page.evaluate(() => window.__AGENTVN_DIALOG_ACTIONS__);
      assert(actions.length === 1 && actions[0].kind === "output", "PASS context action must target output directory", actions);
      assert(await passDialog.isVisible(), "context action must not dismiss the dialog");
      await page.keyboard.press("Escape");
      await page.locator('[data-testid="package-build-result-dialog"]').waitFor({ state: "detached" });
      assert(await page.locator("#underlying-package-panel").isVisible(), "Escape must keep the export panel mounted");
      await page.waitForFunction(() => document.activeElement?.id === "package-export-trigger");

      await show(page, "BLOCKED", { platform: "android" });
      assert(await page.locator(".operation-result-dialog.is-warning").isVisible(), "BLOCKED must use warning styling");
      assert(await page.getByRole("heading", { name: "Android 软件构建被阻断" }).isVisible(), "BLOCKED title is missing");
      assert(await page.getByRole("button", { name: "打开诊断目录" }).isVisible(), "BLOCKED diagnostics action is missing");
      await page.getByRole("button", { name: "完成" }).click();
      await page.locator('[data-testid="package-build-result-dialog"]').waitFor({ state: "detached" });

      await show(page, "FAIL", { withDiagnostics: false });
      assert(await page.locator(".operation-result-dialog.is-error").isVisible(), "FAIL must use error styling");
      assert(await page.getByRole("heading", { name: "Windows 软件构建失败" }).isVisible(), "FAIL title is missing");
      assert(await page.getByText("BUILD_FAILED", { exact: true }).isVisible(), "FAIL code is missing");
      assert(await page.getByRole("button", { name: "打开诊断目录" }).count() === 0, "invalid diagnostics path must hide context action");
      await page.getByRole("button", { name: "完成" }).click();
      await page.locator('[data-testid="package-build-result-dialog"]').waitFor({ state: "detached" });
      await desktop.close();

      for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 3840, height: 2160 }, { width: 2048, height: 1114 }, { width: 757, height: 299 }, { width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport });
        const longPage = await preparePage(context, bundle);
        const message = 'ReadAllBytes: 未能找到文件 C:/Users/1/AppData/Local/com.agentvn.editor/standalone-package/1790052152326/build-workspace/build-versions.json\n' + 'Info 编译器日志与路径 '.repeat(1800) + ' END-OF-LOG';
        await show(longPage, "EXCEPTION", { platform: "android", message });
        const geometry = await longPage.locator('.operation-result-dialog').evaluate(dialog => {
          const rect = dialog.getBoundingClientRect();
          const buttons = [...dialog.querySelectorAll('button')].map(button => {
            const r = button.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { bottom: r.bottom, top: r.top, hit: hit === button || button.contains(hit) };
          });
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, buttons, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert(geometry.x >= 0 && geometry.y >= 0 && geometry.right <= viewport.width && geometry.bottom <= viewport.height, 'long error dialog escaped viewport', { viewport, geometry });
        assert(!geometry.overflow && geometry.buttons.every(button => button.hit && button.top >= 0 && button.bottom <= viewport.height), 'long error actions are clipped or occluded', geometry);
        const messageNode = longPage.locator('.operation-result-dialog > p');
        assert(await messageNode.textContent() === message, 'full original error must be retained');
        await messageNode.evaluate(node => { node.scrollTop = node.scrollHeight; });
        assert(await messageNode.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1), 'end of error must remain reachable');
        await longPage.screenshot({ path: path.join(outDir, `long-error-${viewport.width}x${viewport.height}.png`) });
        await longPage.getByRole('button', { name: '完成', exact: true }).click();
        await longPage.locator('[data-testid="package-build-result-dialog"]').waitFor({ state: 'detached' });
        await context.close();
      }

      const compact = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const compactPage = await preparePage(compact, bundle);
      await show(compactPage, "BLOCKED", { platform: "android" });
      const compactBox = await compactPage.locator(".operation-result-dialog").boundingBox();
      assert(compactBox && compactBox.x >= 0 && compactBox.y >= 0 && compactBox.x + compactBox.width <= 390 && compactBox.y + compactBox.height <= 844, "compact dialog must stay inside viewport", compactBox);
      await compactPage.screenshot({ path: path.join(outDir, "02-blocked-compact.png"), fullPage: true });
      await compact.close();

      const reduced = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
      const reducedPage = await preparePage(reduced, bundle);
      await show(reducedPage, "PASS");
      const motion = await reducedPage.locator(".operation-result-dialog").evaluate((element) => ({
        dialogDuration: getComputedStyle(element).animationDuration,
        backdropDuration: getComputedStyle(element.closest(".operation-result-backdrop")).animationDuration,
      }));
      const toSeconds = (value) => value.endsWith("ms") ? Number.parseFloat(value) / 1000 : Number.parseFloat(value);
      assert(toSeconds(motion.dialogDuration) <= 0.01 && toSeconds(motion.backdropDuration) <= 0.01, "reduced motion must collapse dialog animation", motion);
      await reducedPage.screenshot({ path: path.join(outDir, "03-pass-reduced-motion.png"), fullPage: true });
      await reduced.close();
    } finally {
      await browser.close();
    }
    console.log(`package build result dialog playwright: PASS (${outDir})`);
  } finally {
    try {
      execFileSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      server.kill();
    }
    fs.writeFileSync(path.join(outDir, "vite.log"), serverLog, "utf8");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
