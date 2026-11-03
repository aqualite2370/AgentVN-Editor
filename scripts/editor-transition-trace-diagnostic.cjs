#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance, resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");

const root = path.resolve(__dirname, "..");
const viewportName = process.env.EDITOR_TRACE_VIEWPORT || "4k";
const viewports = {
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "4k": { width: 3840, height: 2160 },
};
const viewport = viewports[viewportName];
if (!viewport) throw new Error(`Unknown EDITOR_TRACE_VIEWPORT: ${viewportName}`);

const configured = resolveAcceptancePaths();
const outputDir = configured.output;
fs.mkdirSync(outputDir, { recursive: true });

function writeJson(name, value) {
  fs.writeFileSync(path.join(outputDir, name), JSON.stringify(value, null, 2));
}

async function readTraceStream(session, streamHandle) {
  let data = "";
  while (true) {
    const chunk = await session.send("IO.read", { handle: streamHandle });
    data += chunk.data ?? "";
    if (chunk.eof) break;
  }
  await session.send("IO.close", { handle: streamHandle }).catch(() => {});
  return data;
}

async function collectTrace(session) {
  let streamHandle;
  const complete = new Promise((resolve) => {
    session.once("Tracing.tracingComplete", (event) => resolve(event.stream));
  });
  await session.send("Tracing.end");
  streamHandle = await complete;
  const traceText = await readTraceStream(session, streamHandle);
  const trace = JSON.parse(traceText);
  writeJson("chrome-trace.json", trace);
  return trace;
}

function eventTimeMs(event) {
  return Number(event.ts) / 1000;
}

function summarizeTrace(trace, window, traceToPerformanceOffsetMs) {
  const events = Array.isArray(trace?.traceEvents) ? trace.traceEvents : [];
  const names = new Set([
    "BeginImplFrame",
    "DrawFrame",
    "ActivateLayerTree",
    "RasterTask",
    "ScheduleStyleRecalculation",
    "UpdateLayoutTree",
    "Paint",
    "CompositeLayers",
    "Commit",
    "BeginMainThreadFrame",
  ]);
  const inWindow = events.filter((event) => {
    const time = eventTimeMs(event) - traceToPerformanceOffsetMs;
    return Number.isFinite(time) && time >= window.start && time <= window.end;
  });
  const byName = {};
  for (const event of inWindow) {
    if (!names.has(event.name)) continue;
    const list = byName[event.name] ?? [];
    list.push({
      ts: eventTimeMs(event) - traceToPerformanceOffsetMs,
      dur: Number.isFinite(Number(event.dur)) ? Number(event.dur) / 1000 : 0,
      ph: event.ph,
      cat: event.cat,
      args: event.args ?? {},
    });
    byName[event.name] = list;
  }
  const implFrames = byName.BeginImplFrame ?? [];
  const frameGaps = implFrames.slice(1).map((event, index) => event.ts - implFrames[index].ts);
  return {
    window,
    eventCounts: Object.fromEntries(Object.entries(byName).map(([name, list]) => [name, list.length])),
    implFrameGapsMs: frameGaps,
    maxImplFrameGapMs: frameGaps.length ? Math.max(...frameGaps) : null,
    minImplFrameGapMs: frameGaps.length ? Math.min(...frameGaps) : null,
    events: byName,
  };
}

async function main() {
  let browser;
  let acceptance;
  let page;
  const pageErrors = [];
  try {
    acceptance = await startEditorAcceptance(outputDir);
    browser = await chromium.launch({
      headless: process.env.EDITOR_TRACE_HEADFUL !== "1",
      args: process.env.EDITOR_TRACE_ANGLE ? [`--use-angle=${process.env.EDITOR_TRACE_ANGLE}`] : [],
    });
    page = await browser.newPage({
      viewport,
      deviceScaleFactor: Number(process.env.EDITOR_TRACE_DPR || 1),
      reducedMotion: "no-preference",
    });
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    await page.route("http://127.0.0.1:8278/api/project/assets/**", async (route) => {
      const url = new URL(route.request().url());
      const backendUrl = new URL(acceptance.backendUrl);
      await route.fulfill({ response: await route.fetch({
        url: `${backendUrl.origin}${url.pathname}${url.search}`,
      }) });
    });
    const cdp = await page.context().newCDPSession(page);
    await acceptance.open(page);
    await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"), undefined, { timeout: 30_000 });
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator(".toolbar-popover.advanced.is-open").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => {
      const popover = document.querySelector(".toolbar-popover.advanced.is-open");
      return popover?.classList.contains("is-entered")
        && (popover.getAnimations({ subtree: true }) ?? []).every((animation) =>
          animation.playState === "finished" || animation.playState === "idle");
    }, undefined, { timeout: 30_000 });

    await cdp.send("Tracing.start", {
      categories: [
        "cc",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "blink.user_timing",
      ].join(","),
      transferMode: "ReturnAsStream",
    });
    await page.evaluate(() => {
      const state = {
        startedAt: performance.now(),
        raf: [],
        animations: [],
        loaves: [],
      };
      const observe = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.loaves.push({
            startTime: entry.startTime,
            duration: entry.duration,
            blockingDuration: entry.blockingDuration,
            scripts: (entry.scripts ?? []).map((script) => ({
              sourceURL: script.sourceURL,
              functionName: script.sourceFunctionName,
              duration: script.duration,
              forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
            })),
          });
        }
      });
      if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
        observe.observe({ type: "long-animation-frame", buffered: false });
      }
      const sample = () => {
        const active = document.querySelector(".advanced-tab-content.is-active");
        const leaving = document.querySelector(".advanced-tab-content.is-leaving");
        const read = (node) => node ? {
          tab: node.dataset.tab,
          opacity: Number(getComputedStyle(node).opacity),
          active: node.classList.contains("is-active"),
          leaving: node.classList.contains("is-leaving"),
          animations: node.getAnimations().map((animation) => ({
            currentTime: animation.currentTime,
            playState: animation.playState,
          })),
        } : null;
        state.raf.push({ at: performance.now(), active: read(active), leaving: read(leaving) });
        if (performance.now() - state.startedAt < 1500) requestAnimationFrame(sample);
      };
      window.__editorTraceState = state;
      requestAnimationFrame(sample);
    });
    const beforeClick = await page.evaluate(() => ({
      at: performance.now(),
      tab: document.querySelector(".advanced-tab-content.is-active")?.dataset.tab ?? null,
    }));
    await page.evaluate(() => {
      const traceStartPerf = performance.now();
      window.__editorTraceStartPerf = traceStartPerf;
      performance.mark("AgentVN.EditorMotionDiagnostic.Start");
      console.timeStamp("AgentVN.EditorMotionDiagnostic.Start");
    });
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').first().click();
    await page.waitForFunction(() => document.querySelector(".advanced-tab-content.is-active")?.dataset.tab === "layout", undefined, { timeout: 30_000 });
    await page.waitForFunction(() => {
      const popover = document.querySelector(".toolbar-popover.advanced");
      return popover
        && !popover.classList.contains("is-morphing")
        && (popover.getAnimations({ subtree: true }) ?? []).every((animation) =>
          animation.playState === "finished" || animation.playState === "idle");
    }, undefined, { timeout: 30_000 });
    await page.waitForTimeout(500);
    const traceEndPerf = await page.evaluate(() => {
      window.__editorTraceEndPerf = performance.now();
      performance.mark("AgentVN.EditorMotionDiagnostic.End");
      console.timeStamp("AgentVN.EditorMotionDiagnostic.End");
      return window.__editorTraceEndPerf;
    });
    const state = await page.evaluate(() => ({
      raf: window.__editorTraceState?.raf ?? [],
      loaves: window.__editorTraceState?.loaves ?? [],
      traceStartPerf: window.__editorTraceStartPerf ?? null,
      traceEndPerf: window.__editorTraceEndPerf ?? null,
      after: performance.now(),
    }));
    const transitionRaf = state.raf.filter((frame) =>
      frame.active?.tab === "layout" && frame.leaving?.tab === "settings");
    const trace = await collectTrace(cdp);
    const traceEvents = Array.isArray(trace?.traceEvents) ? trace.traceEvents : [];
    const traceMarkers = traceEvents
      .filter((event) => event.name === "TimeStamp" || event.name === "UserTiming")
      .filter((event) => JSON.stringify(event.args ?? {}).includes("AgentVN.EditorMotionDiagnostic"))
      .map((event) => ({
        name: event.name,
        ts: eventTimeMs(event),
        phase: event.ph,
        args: event.args ?? {},
      }));
    const markerStart = traceMarkers.find((marker) => JSON.stringify(marker.args).includes(".Start"));
    const markerEnd = traceMarkers.find((marker) => JSON.stringify(marker.args).includes(".End"));
    const traceToPerformanceOffsetMs = markerStart && Number.isFinite(state.traceStartPerf)
      ? markerStart.ts - state.traceStartPerf
      : 0;
    const start = state.traceStartPerf ?? transitionRaf[0]?.at ?? beforeClick.at;
    const end = traceEndPerf ?? state.traceEndPerf ?? transitionRaf.at(-1)?.at ?? state.after;
    writeJson("diagnostic.json", {
      viewport,
      viewportName,
      dpr: Number(process.env.EDITOR_TRACE_DPR || 1),
      beforeClick,
      state,
      transitionRaf,
      traceMarkers,
      traceToPerformanceOffsetMs,
      traceSummary: summarizeTrace(trace, { start, end }, traceToPerformanceOffsetMs),
      service: {
        editorUrl: acceptance.server.url,
        backendPid: acceptance.backendPid,
        vitePid: acceptance.server.pid,
        viteRunId: acceptance.server.runId,
      },
    });
    console.log(`editor-transition-trace-diagnostic: PASS (${outputDir})`);
  } catch (error) {
    if (page) {
      const pageState = await page.evaluate(() => ({
        href: location.href,
        title: document.title,
        text: document.body?.innerText?.slice(0, 5000) ?? "",
        toolbarCount: document.querySelectorAll(".editor-toolbar").length,
        importInputs: [...document.querySelectorAll(".project-import-button input")].map((node) => ({
          disabled: node.disabled,
          accept: node.accept,
        })),
      })).catch(() => null);
      await page.screenshot({ path: path.join(outputDir, "failure.png"), fullPage: false }).catch(() => {});
      writeJson("failure.json", { error: error.stack || String(error), pageErrors, pageState });
    }
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    await acceptance?.stop().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
