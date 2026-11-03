#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = resolveAcceptancePaths().output;
const viewports = [
  { name: "1080p", width: 1920, height: 1080, minPaletteWidth: 280 },
  { name: "4k", width: 3840, height: 2160, minPaletteWidth: 320 },
  { name: "narrow", width: 390, height: 844, minPaletteWidth: 0 },
];
const report = {
  runId,
  scope: "editor-node-palette-width-layout-and-real-node-creation",
  status: "RUNNING",
  results: [],
};

async function inspect(page) {
  return page.evaluate(() => {
    const palette = document.querySelector(".node-palette");
    const flow = document.querySelector(".flow-surface");
    const workspace = document.querySelector(".editor-workspace");
    const rect = node => {
      const box = node?.getBoundingClientRect();
      return box ? {
        left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        width: box.width, height: box.height,
      } : null;
    };
    const buttons = [...(palette?.querySelectorAll("button") ?? [])].map(button => {
      const box = rect(button);
      const style = getComputedStyle(button);
      const text = button.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const range = document.createRange();
      range.selectNodeContents(button);
      const textBox = range.getBoundingClientRect();
      return {
        text,
        rect: box,
        disabled: button.disabled,
        borderRadius: style.borderRadius,
        background: style.backgroundColor,
        textClipped: Boolean(textBox.width > 0 && box && (
          textBox.left < box.left || textBox.right > box.right
          || textBox.top < box.top || textBox.bottom > box.bottom
        )),
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      palette: rect(palette),
      paletteScroll: palette ? {
        clientWidth: palette.clientWidth,
        scrollWidth: palette.scrollWidth,
        clientHeight: palette.clientHeight,
        scrollHeight: palette.scrollHeight,
      } : null,
      flow: rect(flow),
      workspace: rect(workspace),
      documentHorizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      buttons,
      nodeCount: document.querySelectorAll(".react-flow__node").length,
    };
  });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let env;
  let browser;
  try {
    env = await startEditorAcceptance(output);
    report.owner = {
      editorPid: env.server.pid,
      runId: env.server.runId,
      url: env.url,
      backendUrl: env.backendUrl,
    };
    browser = await chromium.launch();
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const errors = [];
      page.on("pageerror", error => errors.push(error.stack || error.message));
      page.on("console", message => {
        if (message.type() === "error") errors.push(message.text());
      });
      try {
        await env.server.run(async () => {
          await env.open(page);
          await page.locator(".node-palette").waitFor({ state: "visible" });
          await page.locator('[data-help-key="palette.choice"]').waitFor({ state: "visible" });
          const before = await inspect(page);
          await page.screenshot({ path: path.join(output, `${viewport.name}-before.png`) });

          assert(before.palette, `${viewport.name}: node palette is missing`);
          if (viewport.minPaletteWidth > 0) {
            assert(
              before.palette.width >= viewport.minPaletteWidth,
              `${viewport.name}: node palette is too narrow for the requested desktop workspace design`,
              { expectedMinimum: viewport.minPaletteWidth, actual: before.palette.width },
            );
            assert(
              before.buttons.every(button => !button.textClipped && button.rect?.left >= before.palette.left
                && button.rect?.right <= before.palette.right),
              `${viewport.name}: node actions or labels are clipped by the palette`,
              before,
            );
          } else {
            assert(
              before.paletteScroll.scrollWidth > before.paletteScroll.clientWidth,
              "narrow viewport should preserve the horizontal node-action rail",
              before,
            );
            assert(
              !before.documentHorizontalOverflow,
              "narrow viewport must not introduce page-level horizontal overflow",
              before,
            );
          }

          const choice = page.locator('[data-help-key="palette.choice"]');
          await choice.click();
          await page.waitForFunction(previousCount => (
            document.querySelectorAll(".react-flow__node").length === previousCount + 1
          ), before.nodeCount);
          const after = await inspect(page);
          assert(after.nodeCount === before.nodeCount + 1,
            `${viewport.name}: clicking a node action must create exactly one node`,
            { before, after });
          assert(errors.length === 0, `${viewport.name}: browser errors`, errors);
          await page.screenshot({ path: path.join(output, `${viewport.name}-after.png`) });
          report.results.push({ viewport, before, after, errors });
        });
      } finally {
        await page.close();
      }
    }
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    await env?.stop().catch(() => {});
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`${report.status}: ${path.join(output, "report.json")}`);
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
