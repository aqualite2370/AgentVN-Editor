#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const fontkit = require("../editor/node_modules/fontkit");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

const root = path.resolve(__dirname, "..");
const acceptance = resolveAcceptancePaths();
const output = acceptance.output;
const deviceScaleFactor = Number(process.env.FONT_COVERAGE_DPR ?? 1);
assert([1, 2].includes(deviceScaleFactor), "FONT_COVERAGE_DPR must be 1 or 2.");
const viewports = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];
const report = {
  runId: new Date().toISOString(),
  status: "RUNNING",
  isolation: acceptance,
  deviceScaleFactor,
  viewports,
  steps: [],
};

function record(name, status, detail = {}) {
  report.steps.push({ name, status, ...detail });
}

async function importAdditionalFont(page, file, filename) {
  await page.locator('[data-help-key="advanced.tab.library"]:visible').click();
  await page.waitForFunction(() => document.querySelector(".advanced-tab-content.is-active[data-tab='library']")
    && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving"));
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /导入字体/ }).click(),
  ]);
  await fileChooser.setFiles(file);
  await page.getByRole("button", { name: "保存到素材库", exact: true }).click();
  await page.getByText(new RegExp(`已将 ${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} 保存到`)).waitFor();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await page.waitForFunction(() => document.querySelector(".advanced-tab-content.is-active[data-tab='layout']")
    && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving"));
  await page.locator('.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) [data-layout-type-option="renpy"]').click();
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
}

(async () => {
  let editor;
  let browser;
  try {
    editor = await startEditorAcceptance(output);
    browser = await chromium.launch({ headless: process.env.FONT_COVERAGE_HEADFUL !== "1" });
    const context = await browser.newContext({
      viewport: viewports[0],
      deviceScaleFactor,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    const browserErrors = [];
    const assetResponses = [];
    page.on("pageerror", error => browserErrors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("requestfailed", request => browserErrors.push(
      `${request.method()} ${request.url().slice(0, 160)}: ${request.failure()?.errorText ?? "request failed"}`,
    ));
    page.on("response", response => {
      if (response.url().includes("/api/project/assets/")) {
        assetResponses.push({ status: response.status(), url: response.url().slice(0, 200) });
      }
    });
    await editor.open(page);

    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.library"]:visible').click();
    await page.waitForFunction(() => document.querySelector(".advanced-tab-content.is-active[data-tab='library']")
      && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving"));

    const fontPath = path.join(root,
      "GameCli_framework/node_modules/harfbuzzjs/test/fonts/noto/NotoSans-Regular.ttf");
    assert(fs.existsSync(fontPath), `Expected deterministic Latin-only font fixture at ${fontPath}`);
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /导入字体/ }).click(),
    ]);
    await fileChooser.setFiles(fontPath);
    await page.getByRole("button", { name: "保存到素材库", exact: true }).click();
    await page.getByText(/已将 NotoSans-Regular\.ttf 保存到/, { exact: false }).waitFor();
    record("import-known-latin-only-font-through-asset-library", "PASS", {
      filename: path.basename(fontPath),
    });

    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
    await page.waitForFunction(() => document.querySelector(".advanced-tab-content.is-active[data-tab='layout']")
      && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving"));
    await page.locator('.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) [data-layout-type-option="renpy"]').click();
    await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    if (await page.getByTestId("renpy-title-editor").count() === 0) {
      await page.locator(".runtime-layout-screen-list").getByRole("button", { name: "标题主页", exact: true }).click();
    }
    await page.getByTestId("renpy-title-editor").waitFor();
    const typography = page.locator(".renpy-shared-typography");
    if (!(await typography.evaluate(node => node instanceof HTMLDetailsElement && node.open)))
      await typography.locator("summary").click();
    const selector = page.getByRole("combobox", {
      name: "Ren'Py（进阶）全局界面字体", exact: true,
    });
    const coverage = page.getByTestId("renpy-font-coverage-report");
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="renpy-font-coverage-report"]')
        ?.getAttribute("data-font-coverage") === "system");
    assert.match(await coverage.innerText(), /未指定自定义字体.*系统字体/,
      "未指定字体时必须明确说明目标设备系统字库差异");
    await selector.click();
    await page.getByRole("option", { name: "NotoSans-Regular", exact: true }).click();

    assert.equal(await coverage.count(), 1,
      "选中自定义字体后必须显示真实字符覆盖与系统 CJK 回退状态");
    try {
      await page.waitForFunction(() => {
        const status = document.querySelector('[data-testid="renpy-font-coverage-report"]')
          ?.getAttribute("data-font-coverage");
        return status === "complete" || status === "incomplete" || status === "error";
      }, undefined, { timeout: 15000 });
    } catch {
      const state = await page.evaluate(() => {
        const node = document.querySelector('[data-testid="renpy-font-coverage-report"]');
        const preview = document.querySelector('[data-testid="renpy-title-view"]');
        return { exists: !!node, status: node?.getAttribute("data-font-coverage"),
          sourceKind: node?.getAttribute("data-font-source-kind"), text: node?.textContent,
          previewFont: preview ? getComputedStyle(preview).fontFamily : null,
          page: document.querySelector(".runtime-layout-designer")?.getAttribute("data-active-screen"),
          fontFaces: [...document.fonts].map((face) => ({ family: face.family, status: face.status })) };
      });
      record("font-coverage-loading-diagnostic", "FAILED", {
        state,
        browserErrors,
        assetResponses,
      });
      throw new Error(`字体检测未进入终态：${JSON.stringify(state)}; browser=${JSON.stringify(browserErrors)}; assets=${JSON.stringify(assetResponses)}`);
    }
    const coverageStatus = await coverage.getAttribute("data-font-coverage");
    const sourceKind = await coverage.getAttribute("data-font-source-kind");
    record("font-coverage-diagnostic", "INFO", {
      coverageStatus,
      sourceKind,
      browserErrors,
      assetResponses,
    });
    assert.equal(coverageStatus, "incomplete",
      `Latin-only font must report missing project glyphs; got ${coverageStatus}: ${await coverage.innerText()}`);
    const text = await coverage.innerText();
    assert.match(text, /缺少 \d+ 个：/,
      "拉丁字体必须把项目中的中文字符报告为缺失");
    assert.match(text, /回退到系统字体|系统.*回退|CJK.*fallback/,
      "缺失字形时必须说明 Runtime 使用系统 CJK fallback");
    const authoredFixture = path.basename(acceptance.input).startsWith("authored-font-fixture");
    if (authoredFixture) {
      assert(text.includes("靐"), `font report omitted the title marker from its visible missing-glyph samples: ${text}`);
      const project = JSON.parse(fs.readFileSync(acceptance.input, "utf8"));
      const sourcePath = path.join(root, "editor/src/renpy/fontCoverage.ts");
      const compiled = buildSync({ entryPoints: [sourcePath], bundle: true, platform: "node", format: "cjs", write: false });
      const api = { exports: {} };
      new Function("module", "exports", "require", compiled.outputFiles[0].text)(api, api.exports, require);
      const expected = api.exports.analyzeFontCharacterCoverage(
        fontkit.create(fs.readFileSync(fontPath)).characterSet,
        api.exports.collectRenpyFontCoverageText(project.title, project.author,
          Object.values(project.editor_settings.characterDisplayNames ?? {}), project.nodes,
          project.editor_settings.runtimeUILayoutProfiles.profiles.renpy),
      );
      const counts = text.match(/覆盖 (\d+)\/(\d+) 个不重复字符。/);
      assert(counts, `Could not parse coverage counts: ${text}`);
      assert.equal(Number(counts[2]), expected.totalCharacters,
        "UI coverage must include all authored-page and custom-component text");
      assert.equal(Number(counts[1]), expected.coveredCharacters);
      record("report-glyphs-from-other-pages-title-and-safe-custom-code", "PASS", {
        authoredMarkerInSample: "靐", totalCharacters: expected.totalCharacters,
        missingCharacters: expected.missingCharacters, displayedSampleLimit: 24,
      });
    } else assert.match(text, /隔.*离/,
      "缺字样本应来自隔离工程的真实项目文本");
    const previewFont = await page.getByTestId("renpy-title-view")
      .evaluate((node) => getComputedStyle(node).fontFamily);
    assert.match(previewFont, /AgentVNFont_.*(serif|sans-serif)/,
      "真实预览必须保留自定义字体及系统字体 fallback 字体栈");
    const loadedFontFace = await page.evaluate((fontFamily) => {
      const name = fontFamily.match(/AgentVNFont_[^",]+/)?.[0];
      return name
        ? [...document.fonts].find((face) => face.family === name)?.status ?? "missing"
        : "missing";
    }, previewFont);
    assert.equal(loadedFontFace, "loaded",
      "自定义字体必须由当前隔离后端成功加载到真实预览");
    assert.equal(browserErrors.some((message) => message.includes("/api/project/assets/")), false,
      "当前后端提供的字体素材请求不得落到默认端口或失败");
    if (!authoredFixture) {
      await page.getByTestId("renpy-title-runtime-preview-toggle").click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="title"][data-preview-phase="ready"]')
        .waitFor({ timeout: 30000 });
      const runtimeFontFaces = await page.locator(".renpy-editor-runtime-viewport iframe").evaluate((frame) =>
        [...frame.contentDocument.fonts]
          .filter((face) => face.family.startsWith("AgentVNFont_"))
          .map((face) => ({ family: face.family, status: face.status })));
      assert(runtimeFontFaces.some((face) => face.family.includes("notosans-regular") && face.status === "loaded"),
        `实际 Runtime 预览必须加载所选字体：${JSON.stringify(runtimeFontFaces)}`);
      record("load-project-font-in-real-runtime-preview", "PASS", { runtimeFontFaces });
      await page.getByTestId("renpy-title-static-preview-toggle").click();
      await page.locator(".renpy-editor-runtime-viewport iframe").waitFor({ state: "detached" });
    } else record("runtime-font-iframe", "NOT_IN_SCOPE",
      { reason: "This regression isolates editor font-corpus reporting; independent Runtime preview remains covered by existing evidence." });

    const viewportGeometry = [];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const geometry = await coverage.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });
      assert(geometry.width > 0 && geometry.left >= 0 && geometry.right <= viewport.width + 1,
        `字体状态必须完整留在 ${viewport.width}x${viewport.height} 视口内: ${JSON.stringify(geometry)}`);
      assert(geometry.scrollWidth <= geometry.clientWidth + 1,
        `缺字样本不得撑宽字体状态面板: ${JSON.stringify(geometry)}`);
      assert(geometry.documentWidth <= geometry.viewportWidth + 1,
        `字体状态不得造成横向溢出: ${JSON.stringify(geometry)}`);
      viewportGeometry.push({ ...viewport, ...geometry });
    }
    record("report-missing-project-glyphs-and-runtime-fallback", "PASS", {
      text,
      previewFont,
      loadedFontFace,
      viewportGeometry,
    });

    const woff2Path = path.join(root, "GameCli_framework/node_modules/fontverter/testdata/Roboto-400.woff2");
    await importAdditionalFont(page, woff2Path, "Roboto-400.woff2");
    await selector.click();
    await page.getByRole("option", { name: "Roboto-400", exact: true }).click();
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-testid="renpy-font-coverage-report"]')
        ?.getAttribute("data-font-coverage");
      return status === "complete" || status === "incomplete" || status === "error";
    }, undefined, { timeout: 15000 });
    assert.equal(await coverage.getAttribute("data-font-coverage"), "incomplete",
      "WOFF2 font should be parsed and report missing project glyphs");
    assert.match(await coverage.innerText(), /回退到系统字体/,
      "WOFF2 missing-glyph result should retain the Runtime fallback guidance");
    record("parse-woff2-font-in-browser-worker", "PASS", {
      sourceKind: await coverage.getAttribute("data-font-source-kind"),
      status: await coverage.getAttribute("data-font-coverage"),
    });

    await importAdditionalFont(page, {
      name: "InvalidFont.ttf",
      mimeType: "font/ttf",
      buffer: Buffer.from("not a valid font file"),
    }, "InvalidFont.ttf");
    await selector.click();
    await page.getByRole("option", { name: "InvalidFont", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="renpy-font-coverage-report"]')
        ?.getAttribute("data-font-coverage") === "error", undefined, { timeout: 15000 });
    assert.match(await coverage.innerText(), /无法确认字体覆盖/);
    assert.match(await coverage.innerText(), /系统字体栈回退/,
      "unreadable custom font should explicitly report the fallback behavior");
    record("report-unreadable-font-with-runtime-fallback", "PASS", {
      status: await coverage.getAttribute("data-font-coverage"),
      text: await coverage.innerText(),
    });
    await page.screenshot({ path: path.join(output, "font-coverage-3840x2160.png") });

    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    await editor?.stop().catch(() => {});
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
