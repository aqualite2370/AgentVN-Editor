#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const { chromium } = require(path.join(ROOT, "editor", "node_modules", "playwright"));
const PORT = Number(process.env.AGENTVN_EDGE_COLOR_SPACING_PORT || 6772);
const EDITOR_URL = "http://127.0.0.1:" + PORT + "/";
const VITE = path.join(ROOT, "editor", "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const OUT = path.join(ROOT, "output", "playwright", "editor-edge-color-spacing");
const WORK = path.join(OUT, "_work");
const PROJECT_PATH = path.join(WORK, "edge-color-spacing.vnproj");
const REPORT = path.join(OUT, "report.json");

let server;
let serverOut;

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  ensure(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function killPort(port) {
  if (process.platform !== "win32") return;
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-NetTCPConnection -LocalPort " + port + " -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | % { if ($_ -gt 0) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }",
    ], { windowsHide: true, stdio: "ignore" });
  } catch (_) {}
}

async function reachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch (_) {
    return false;
  }
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90000) {
    if (await reachable(EDITOR_URL)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Editor dev server not reachable: " + EDITOR_URL);
}

function startServer() {
  ensure(path.join(OUT, "logs"));
  const logFile = path.join(OUT, "logs", "editor-vite.log");
  serverOut = fs.openSync(logFile, "a");
  const cmd = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : VITE;
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", VITE, "--host", "127.0.0.1", "--port", String(PORT)]
    : ["--host", "127.0.0.1", "--port", String(PORT)];
  server = spawn(cmd, args, {
    cwd: path.join(ROOT, "editor"),
    stdio: ["ignore", serverOut, serverOut],
    shell: false,
    windowsHide: true,
  });
}

function stopServer() {
  try { if (server) server.kill(); } catch (_) {}
  try { if (serverOut !== undefined) fs.closeSync(serverOut); } catch (_) {}
}

function base(nodeKind, label) {
  return {
    nodeKind,
    label,
    description: label,
    memoryMode: "hybrid",
    aiSettings: { authorGoal: "", generationOutline: "", autoExtractMemory: false, autoApplyMemory: false },
    previewState: { currentCommandIndex: 0, isPlaying: false },
    editorMeta: { collapsedInspectorSections: [], source: "manual" },
  };
}

function scene(id, label, commands) {
  return {
    id,
    type: "sceneNode",
    position: { x: 0, y: 0 },
    data: {
      ...base("scene", label),
      scene: { scene_id: id, title: label, summary: label, commands, tags: [], chapter: 1 },
    },
  };
}

function node(id, kind, data) {
  return {
    id,
    type: kind + "Node",
    position: { x: 0, y: 0 },
    data: { ...base(kind, id), ...data },
  };
}

function createProject() {
  const now = new Date().toISOString();
  const choices = [
    { choice_id: "left", text: "左", target_scene_id: "scene_left", conditions: [] },
    { choice_id: "right", text: "右", target_scene_id: "scene_right", conditions: [] },
  ];
  const nodes = [
    node("start", "start", { loadingAnimation: { kind: "default" } }),
    scene("scene_intro", "入口场景", [{ type: "choice", choices }]),
    node("condition_check", "condition", {
      condition: {
        expression: "flag == true",
        trueLabel: "真",
        falseLabel: "假",
        mode: "builder",
        key: "flag",
        operator: "truthy",
        value: true,
        valueType: "boolean",
      },
    }),
    node("loop_patrol", "loop", {
      loop: {
        variableKey: "patrol_count",
        initialValue: 0,
        step: 1,
        continueCondition: { key: "patrol_count", operator: "less_than", value: 3 },
        loopLabel: "继续巡逻",
        exitLabel: "离开巡逻",
      },
    }),
    scene("scene_loop_body", "循环体", [{ type: "narration", text: "继续" }]),
    scene("scene_loop_exit", "循环出口", [{ type: "narration", text: "退出" }]),
    scene("scene_left", "左分支", [{ type: "narration", text: "左" }]),
    scene("scene_right", "右分支", [{ type: "narration", text: "右" }]),
    node("animation_flash", "animation", {
      animation: { type: "animation", animation_id: "flash", target: "dialog", blocking: false, params: { duration_ms: 240 } },
    }),
    node("end", "end", { ending: { ending_id: "done", ending_title: "完成" } }),
  ];
  const edges = [
    { id: "edge_start_intro", source: "start", target: "scene_intro", sourceHandle: "default" },
    { id: "edge_intro_left", source: "scene_intro", target: "scene_left", sourceHandle: "left" },
    { id: "edge_intro_right", source: "scene_intro", target: "scene_right", sourceHandle: "right" },
    { id: "edge_left_condition", source: "scene_left", target: "condition_check", sourceHandle: "default" },
    { id: "edge_condition_loop", source: "condition_check", target: "loop_patrol", sourceHandle: "true" },
    { id: "edge_condition_end", source: "condition_check", target: "end", sourceHandle: "false" },
    { id: "edge_loop_body", source: "loop_patrol", target: "scene_loop_body", sourceHandle: "loop" },
    { id: "edge_loop_exit", source: "loop_patrol", target: "scene_loop_exit", sourceHandle: "exit" },
    { id: "edge_body_loop", source: "scene_loop_body", target: "loop_patrol", sourceHandle: "default" },
    { id: "edge_right_animation", source: "scene_right", target: "animation_flash", sourceHandle: "default" },
    { id: "edge_animation_end", source: "animation_flash", target: "end", sourceHandle: "default" },
  ];
  return {
    schema_version: "1.0.0",
    project_id: "edge_color_spacing_acceptance",
    title: "Edge Color Spacing Acceptance",
    author: "Codex Playwright",
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.85 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {},
    created_at: now,
    updated_at: now,
  };
}

function prepareProject() {
  fs.rmSync(OUT, { recursive: true, force: true });
  ensure(WORK);
  saveProjectContainerSync(PROJECT_PATH, createProject(), { container: "zip" });
}

function rgbOf(hex) {
  const normalized = hex.replace("#", "");
  const value = parseInt(normalized, 16);
  return "rgb(" + ((value >> 16) & 255) + ", " + ((value >> 8) & 255) + ", " + (value & 255) + ")";
}

function normalizeCssColor(value) {
  const trimmed = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return rgbOf(trimmed);
  return trimmed;
}

async function collectEvidence(page) {
  return page.evaluate(() => {
    const edgePaths = Array.from(document.querySelectorAll(".react-flow__edge .orthogonal-edge-path")).map((path) => {
      const style = getComputedStyle(path);
      const parent = path.closest(".react-flow__edge");
      return {
        edgeId: parent ? parent.getAttribute("data-id") : "",
        className: path.getAttribute("class") || "",
        stroke: style.stroke,
        dash: style.strokeDasharray,
        width: style.strokeWidth,
      };
    });

    const nodeBoxes = Array.from(document.querySelectorAll(".react-flow__node")).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.getAttribute("data-id") || "",
        className: node.getAttribute("class") || "",
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        transform: node.style.transform || "",
        flowX: (() => {
          const match = (node.style.transform || "").match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
          return match ? Number(match[1]) : NaN;
        })(),
        flowY: (() => {
          const match = (node.style.transform || "").match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
          return match ? Number(match[2]) : NaN;
        })(),
      };
    });

    const nodeStyle = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return { borderTopColor: style.borderTopColor };
    };

    return {
      edgePaths,
      nodeBoxes,
      loopNodeStyle: nodeStyle(".loop-node"),
      minimapNodes: Array.from(document.querySelectorAll(".react-flow__minimap svg rect, .react-flow__minimap svg path")).length,
      cssVars: (() => {
        const style = getComputedStyle(document.documentElement);
        return {
          loop: style.getPropertyValue("--loop").trim(),
          loopExit: style.getPropertyValue("--loop-exit").trim(),
        };
      })(),
    };
  });
}

function findEdge(evidence, role) {
  return evidence.edgePaths.find((edge) => edge.className.includes("edge-role-" + role));
}

function findKind(evidence, kind) {
  return evidence.edgePaths.find((edge) => edge.className.includes("edge-kind-" + kind));
}

function sameRowGaps(nodes) {
  const rows = new Map();
  for (const node of nodes) {
    const y = Number.isFinite(node.flowY) ? node.flowY : node.top;
    const key = Math.round(y / 20) * 20;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(node);
  }
  const gaps = [];
  for (const row of rows.values()) {
    row.sort((a, b) => (Number.isFinite(a.flowX) ? a.flowX : a.left) - (Number.isFinite(b.flowX) ? b.flowX : b.left));
    for (let index = 1; index < row.length; index += 1) {
      const previous = row[index - 1];
      const current = row[index];
      const previousRight = (Number.isFinite(previous.flowX) ? previous.flowX : previous.left) + previous.width;
      const currentLeft = Number.isFinite(current.flowX) ? current.flowX : current.left;
      gaps.push(currentLeft - previousRight);
    }
  }
  return gaps;
}

function rowVerticalGaps(nodes) {
  const rows = Array.from(new Set(nodes
    .map((node) => Number.isFinite(node.flowY) ? node.flowY : node.top)
    .filter((value) => Number.isFinite(value))))
    .sort((a, b) => a - b);
  const gaps = [];
  for (let index = 1; index < rows.length; index += 1) {
    gaps.push(rows[index] - rows[index - 1]);
  }
  return gaps;
}

async function main() {
  prepareProject();
  killPort(PORT);
  startServer();
  const assertions = [];
  const errors = [];
  function check(name, pass, details) {
    assertions.push({ name, pass: Boolean(pass), details });
    if (!pass) throw new Error(name + " failed: " + JSON.stringify(details));
  }

  const browser = await chromium.launch({ headless: true });
  let context;
  try {
    await waitForServer();
    context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
    await page.locator('.project-import-button[aria-disabled="false"]').first().waitFor({ state: "visible", timeout: 60000 });
    const importInput = page.locator('.project-import-button[aria-disabled="false"] input').first();
    await importInput.waitFor({ state: "attached", timeout: 60000 });
    await importInput.setInputFiles(PROJECT_PATH);
    await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60000 });
    await page.locator("[data-help-key='toolbar.autoArrange']").click();
    await page.waitForTimeout(1200);
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(900);
    await page.locator(".react-flow__edge .orthogonal-edge-path").first().waitFor({ state: "attached", timeout: 30000 });

    const screenshot = path.join(OUT, "editor-edge-color-spacing.png");
    await page.screenshot({ path: screenshot, fullPage: true });

    const evidence = await collectEvidence(page);
    const loopContinue = findEdge(evidence, "loop-continue");
    const loopExit = findEdge(evidence, "loop-exit");
    const loopEntry = findEdge(evidence, "loop-entry");
    const conditionTrue = findEdge(evidence, "condition-true");
    const conditionFalse = findEdge(evidence, "condition-false");
    const startEdge = findKind(evidence, "start");
    const sceneEdge = findKind(evidence, "scene");
    const animationEdge = findKind(evidence, "animation");

    check("loop continue edge exists", Boolean(loopContinue), loopContinue);
    check("loop exit edge exists", Boolean(loopExit), loopExit);
    check("loop entry edge exists", Boolean(loopEntry), loopEntry);
    check("condition true edge exists", Boolean(conditionTrue), conditionTrue);
    check("condition false edge exists", Boolean(conditionFalse), conditionFalse);
    check("start/scene/animation edge kinds exist", Boolean(startEdge && sceneEdge && animationEdge), { startEdge, sceneEdge, animationEdge });

    const expectedLoopColor = normalizeCssColor(evidence.cssVars.loop);
    const expectedLoopExitColor = normalizeCssColor(evidence.cssVars.loopExit);
    check("loop continue uses loop color", loopContinue.stroke === expectedLoopColor, { loopContinue, expected: expectedLoopColor });
    check("loop exit uses loop-exit color", loopExit.stroke === expectedLoopExitColor, { loopExit, expected: expectedLoopExitColor });
    check("condition true and false are visually distinct", conditionTrue.stroke !== conditionFalse.stroke, { conditionTrue, conditionFalse });
    check("node kind colors are visually distinct", new Set([startEdge.stroke, sceneEdge.stroke, animationEdge.stroke, conditionTrue.stroke, loopContinue.stroke, loopExit.stroke]).size >= 5, {
      start: startEdge.stroke,
      scene: sceneEdge.stroke,
      animation: animationEdge.stroke,
      condition: conditionTrue.stroke,
      loop: loopContinue.stroke,
      loopExit: loopExit.stroke,
    });
    check("loop exit has different dash rhythm", loopExit.dash !== loopContinue.dash, { loopExitDash: loopExit.dash, loopContinueDash: loopContinue.dash });
    check("loop node has dedicated loop border color", evidence.loopNodeStyle && evidence.loopNodeStyle.borderTopColor === expectedLoopColor, { loopNodeStyle: evidence.loopNodeStyle, expected: expectedLoopColor });

    const gaps = sameRowGaps(evidence.nodeBoxes).filter((gap) => Number.isFinite(gap) && gap > 0);
    const minGap = Math.min(...gaps);
    check("auto-arranged same-row node gaps are relaxed", minGap >= 95, { minGap, gaps: gaps.slice(0, 10) });

    const verticalGaps = rowVerticalGaps(evidence.nodeBoxes);
    const minVerticalGap = Math.min(...verticalGaps);
    check("auto-arranged vertical node rhythm is relaxed", minVerticalGap >= 300, { minVerticalGap, verticalGaps, nodes: evidence.nodeBoxes.map((node) => ({ id: node.id, flowY: node.flowY })) });
    check("editor console has no errors", errors.length === 0, errors);

    writeJson(REPORT, {
      status: "passed",
      assertions,
      screenshot,
      project: PROJECT_PATH,
      evidence,
      errors,
    });
    console.log("PASS editor edge color/spacing Playwright acceptance");
    console.log(REPORT);
  } catch (error) {
    writeJson(REPORT, {
      status: "failed",
      assertions,
      project: PROJECT_PATH,
      errors,
      failure: String(error && error.stack || error),
    });
    throw error;
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    stopServer();
  }
}

main().catch((error) => {
  console.error(error);
  stopServer();
  process.exit(1);
});

