#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = resolveAcceptancePaths().output;
const report = {
  runId,
  scope: "editor-options-assistant-cdp-cpu-profile",
  viewport: { width: 3840, height: 2160 },
  deviceScaleFactor: Number(process.env.EDITOR_PROFILE_DPR || 1),
  gpu: process.env.EDITOR_PROFILE_GPU === "1",
  samples: [],
  status: "RUNNING",
};

function aggregateProfile(profile) {
  const names = new Map(profile.nodes.map(node => [node.id, {
    functionName: node.callFrame.functionName || "(anonymous)",
    url: node.callFrame.url || "",
    lineNumber: node.callFrame.lineNumber,
    columnNumber: node.callFrame.columnNumber,
    hitCount: node.hitCount || 0,
  }]));
  const totals = new Map();
  for (let index = 0; index < (profile.samples?.length ?? 0); index += 1) {
    const node = names.get(profile.samples[index]);
    if (!node) continue;
    const key = `${node.url}\n${node.functionName}\n${node.lineNumber}:${node.columnNumber}`;
    const current = totals.get(key) ?? { ...node, sampledMs: 0 };
    current.sampledMs += (profile.timeDeltas?.[index] ?? 0) / 1000;
    totals.set(key, current);
  }
  return [...totals.values()].sort((a, b) => b.sampledMs - a.sampledMs).slice(0, 40);
}

async function settleTarget(page, target) {
  await page.waitForFunction(expected => (
    document.querySelector(`[data-workspace-surface="${expected}"]`)?.getAttribute("aria-current") === "page"
    && document.querySelector(`[data-workspace-task="${expected}"]`)
  ), target, { timeout: 15_000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const env = await startEditorAcceptance(output);
  report.owner = { editorPid: env.server.pid, runId: env.server.runId, url: env.url, backendUrl: env.backendUrl };
  let browser;
  try {
    const args = report.gpu
      ? ["--use-angle=d3d11", "--enable-gpu-rasterization", "--enable-zero-copy"]
      : [];
    browser = await chromium.launch({ args });
    const page = await browser.newPage({
      viewport: report.viewport,
      deviceScaleFactor: report.deviceScaleFactor,
    });
    page.setDefaultTimeout(30_000);
    page.on("pageerror", error => report.pageErrors = [...(report.pageErrors ?? []), error.stack || error.message]);
    await env.server.run(async () => {
      await env.open(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await settleTarget(page, "options");
      await page.locator(".advanced-tools-panel").waitFor({ state: "visible" });
      await page.waitForFunction(() => document.querySelector('[data-workspace-surface="assistant"]'));

      await page.evaluate(() => {
        const state = window.__editorClickPerf = { active: null, events: [], loafs: [] };
        document.addEventListener("click", event => {
          if (!state.active || !(event.target instanceof Element)
            || !event.target.closest("[data-workspace-surface]")) return;
          state.active.capture = performance.now();
        }, true);
        document.addEventListener("click", event => {
          if (!state.active || !(event.target instanceof Element)
            || !event.target.closest("[data-workspace-surface]")) return;
          state.active.bubble = performance.now();
          state.events.push({ ...state.active });
          state.active = null;
        });
        if ("PerformanceObserver" in window
          && PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
          new PerformanceObserver(list => {
            state.loafs.push(...list.getEntries().map(entry => ({
              startTime: entry.startTime,
              duration: entry.duration,
              blockingDuration: entry.blockingDuration,
              scripts: entry.scripts.map(script => ({
                invoker: script.invoker,
                sourceURL: script.sourceURL,
                sourceFunctionName: script.sourceFunctionName,
                duration: script.duration,
              })),
            })));
          }).observe({ type: "long-animation-frame", buffered: true });
        }
      });

      const client = await page.context().newCDPSession(page);
      await client.send("Profiler.enable");
      await client.send("Profiler.setSamplingInterval", { interval: 1000 });
      for (let index = 0; index < 6; index += 1) {
        const from = index % 2 === 0 ? "options" : "assistant";
        const to = index % 2 === 0 ? "assistant" : "options";
        if (index > 0) await settleTarget(page, from);
        const target = page.locator(`[data-workspace-surface="${to}"]:visible`);
        const box = await target.boundingBox();
        if (!box) throw new Error(`Transition target is not hittable: ${to}`);
        await page.evaluate(() => {
          window.__editorClickPerf.active = { startedAt: performance.now() };
        });
        await client.send("Profiler.start");
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        const stopped = await client.send("Profiler.stop");
        const event = await page.evaluate(() => window.__editorClickPerf.events.at(-1) ?? null);
        report.samples.push({
          index,
          from,
          to,
          clickHandlerMs: event && Number.isFinite(event.capture) && Number.isFinite(event.bubble)
            ? event.bubble - event.capture
            : null,
          profileWindowMs: (stopped.profile.endTime - stopped.profile.startTime) / 1000,
          event,
          topCpuSamples: aggregateProfile(stopped.profile),
        });
        await settleTarget(page, to);
      }
      report.longAnimationFrames = await page.evaluate(() => window.__editorClickPerf.loafs);
      await client.detach();
    });
    report.status = "DIAGNOSTIC_COMPLETE";
    report.note = "Isolated temporary project and Chromium CDP CPU sampling; not Tauri/WebView2 or release acceptance.";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    await env.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "cpu-profile.json"), JSON.stringify(report, null, 2));
    console.log(`${report.status}: ${path.join(output, "cpu-profile.json")}`);
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
