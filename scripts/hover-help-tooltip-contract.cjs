#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorUrl = "http://127.0.0.1:6767/";
const projectStateUrl = "http://127.0.0.1:8278/api/project/state";
const outputDir = path.join(root, "output", "playwright", "hover-help-tooltip");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) throw new Error("Refusing outside-root path: " + resolved);
  return resolved;
}

function resetOutputDir() {
  fs.rmSync(assertInsideRoot(outputDir), { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
}

async function isListening(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function startEditorServer() {
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd: path.join(root, "editor"),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logFile = path.join(outputDir, "editor-vite.log");
  const writeLog = (data) => fs.appendFileSync(logFile, data.toString());
  child.stdout.on("data", writeLog);
  child.stderr.on("data", writeLog);
  return child;
}

function stopServer(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function ensureEditorServer() {
  if (await isListening(editorUrl)) return undefined;
  const child = startEditorServer();
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await isListening(editorUrl)) return child;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Editor dev server did not start at " + editorUrl);
}

function emptySharedState() {
  return {
    project_graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, memoryMode: "hybrid" },
    project_metadata: {},
    recent_projects: [],
    provider_connections: [],
    provider_models: [],
    provider_selections: {},
    provider_secrets: {},
  };
}

async function tooltipSnapshot(page) {
  return await page.locator(".hover-help-card").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const arrowStyle = window.getComputedStyle(node, "::after");
    return {
      parentIsBody: node.parentElement === document.body,
      role: node.getAttribute("role"),
      text: node.textContent || "",
      className: node.className,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      zIndex: Number(style.zIndex),
      borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderColor: style.borderColor,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter || "",
      transitionProperty: style.transitionProperty,
      transitionDuration: style.transitionDuration,
      animationName: style.animationName,
      arrowDisplay: arrowStyle.display,
      arrowBorderStyle: arrowStyle.borderStyle,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

function assertTooltipInViewport(snapshot) {
  assert.ok(snapshot.rect.x >= 0, "tooltip should not overflow left");
  assert.ok(snapshot.rect.y >= 0, "tooltip should not overflow top");
  assert.ok(snapshot.rect.right <= snapshot.viewport.width, "tooltip should not overflow right");
  assert.ok(snapshot.rect.bottom <= snapshot.viewport.height, "tooltip should not overflow bottom");
}

async function main() {
  resetOutputDir();
  const server = await ensureEditorServer();
  let browser;
  try {
    const sharedState = emptySharedState();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.route(projectStateUrl, async (route) => {
      if (route.request().method() === "POST") {
        Object.assign(sharedState, JSON.parse(route.request().postData() || "{}"));
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: sharedState }),
      });
    });

    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    const createButton = page.locator('[data-help-key="home.createProject"]').first();
    await createButton.waitFor({ state: "visible", timeout: 20000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-help-key="home.createProject"]');
      return button && !button.disabled;
    }, null, { timeout: 20000 });
    await page.evaluate(() => {
      document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
        element.style.pointerEvents = "none";
      });
    });
    await page.waitForTimeout(100);

    await createButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent("mouseover", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        relatedTarget: document.body,
      }));
    });
    await page.waitForTimeout(300);
    await page.locator(".hover-help-card[role='tooltip']").waitFor({ state: "visible", timeout: 5000 });
    const hover = await tooltipSnapshot(page);
    assert.equal(hover.parentIsBody, true, "hover tooltip should be portaled to document.body");
    assert.equal(hover.role, "tooltip");
    assert.ok(hover.text.length > 10, "tooltip should keep help copy");
    assert.ok(hover.zIndex >= 3000, "tooltip should render above editor overlays");
    assert.match(hover.borderRadius, /^12px/, "tooltip should keep AgentVN card radius and visual tone");
    assert.ok(hover.backgroundImage.includes("linear-gradient"), "tooltip should keep AgentVN gradient surface");
    assert.ok(hover.backdropFilter.includes("blur"), "tooltip should keep AgentVN glass treatment");
    assert.match(hover.transitionProperty, /width|height|max-width|max-height|min-width/, "tooltip surface should transition size for slow expansion");
    assert.ok(hover.animationName.includes("hover-card-fade-in"), "tooltip surface should use the expected smooth enter motion");
    assert.ok(hover.arrowBorderStyle !== "none", "tooltip arrow should be present");
    assertTooltipInViewport(hover);

    const followProbe = await createButton.evaluate(async (element) => {
      const first = document.querySelector(".hover-help-card");
      if (!(first instanceof HTMLElement)) throw new Error("tooltip missing before follow probe");
      const initial = first.getBoundingClientRect();
      const targetPointer = { x: 900, y: 300 };
      element.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        clientX: targetPointer.x,
        clientY: targetPointer.y,
      }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const during = first.getBoundingClientRect();
      await new Promise((resolve) => setTimeout(resolve, 650));
      const later = first.getBoundingClientRect();
      return {
        initial: { x: initial.x, y: initial.y },
        during: { x: during.x, y: during.y },
        later: { x: later.x, y: later.y },
        expectedTarget: {
          x: Math.min(Math.max(targetPointer.x + 14, 12), window.innerWidth - initial.width - 12),
          y: Math.min(Math.max(targetPointer.y + 14, 12), window.innerHeight - initial.height - 12),
        },
      };
    });
    assert.ok(followProbe.during.x > followProbe.initial.x, "tooltip should start following pointer movement");
    assert.ok(followProbe.during.x < followProbe.expectedTarget.x - 4, "tooltip should lag behind instead of snapping to the pointer target");
    assert.ok(
      followProbe.during.x < followProbe.initial.x + (followProbe.expectedTarget.x - followProbe.initial.x) * 0.14,
      "tooltip should keep a visibly slower two-frame lag after pointer movement",
    );
    assert.ok(followProbe.later.x > followProbe.during.x, "tooltip should keep easing toward the pointer target");

    await page.evaluate(() => {
      const row = document.createElement("div");
      row.id = "hover-help-hot-swap-row";
      row.style.cssText = "position:fixed;left:100px;top:520px;display:flex;gap:6px;z-index:20;";
      const first = document.createElement("button");
      first.type = "button";
      first.id = "hover-help-hot-swap-first";
      first.dataset.helpTitle = "Hot swap first";
      first.dataset.help = "First short help.";
      first.textContent = "First";
      first.style.cssText = "width:96px;height:44px;";
      const second = document.createElement("button");
      second.type = "button";
      second.id = "hover-help-hot-swap-second";
      second.dataset.helpTitle = "Hot swap second";
      second.dataset.help = "Second help text is deliberately longer so the existing tooltip container must resize while it keeps following the pointer.";
      second.textContent = "Second";
      second.style.cssText = "width:96px;height:44px;";
      row.append(first, second);
      document.body.appendChild(row);
    });
    const hotFirst = page.locator("#hover-help-hot-swap-first");
    const hotSecond = page.locator("#hover-help-hot-swap-second");
    await hotFirst.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent("mouseover", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        relatedTarget: document.body,
      }));
    });
    await page.waitForTimeout(300);
    await page.locator(".hover-help-card[role='tooltip']").waitFor({ state: "visible", timeout: 5000 });
    const firstHotSwap = await tooltipSnapshot(page);
    assert.equal(await page.locator(".hover-help-card").count(), 1, "hot-swap setup should have exactly one tooltip");
    assert.ok(firstHotSwap.text.includes("First short help."), "hot-swap setup should show first help text");
    await hotFirst.evaluate((first) => {
      const second = document.querySelector("#hover-help-hot-swap-second");
      if (!(second instanceof HTMLElement)) throw new Error("second hot-swap target missing");
      const secondRect = second.getBoundingClientRect();
      first.dispatchEvent(new MouseEvent("mouseout", {
        bubbles: true,
        clientX: secondRect.left + secondRect.width / 2,
        clientY: secondRect.top + secondRect.height / 2,
        relatedTarget: second,
      }));
      second.dispatchEvent(new MouseEvent("mouseover", {
        bubbles: true,
        clientX: secondRect.left + secondRect.width / 2,
        clientY: secondRect.top + secondRect.height / 2,
        relatedTarget: first,
      }));
    });
    await page.waitForTimeout(50);
    const hotSwap = await tooltipSnapshot(page);
    assert.equal(await page.locator(".hover-help-card").count(), 1, "hot-swap should keep a single tooltip instance");
    assert.ok(!hotSwap.className.includes("is-closing"), "hot-swap should not put the persistent tooltip into closing phase");
    assert.ok(hotSwap.text.includes("Second help text is deliberately longer"), "hot-swap should update tooltip text immediately");
    assert.ok(hotSwap.rect.width >= firstHotSwap.rect.width, "hot-swap container should keep or grow its width for longer text");
    const hotSwapCopyMotion = await page.locator(".hover-help-copy").evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        filter: style.filter,
      };
    });
    assert.ok(hotSwapCopyMotion.animationName.includes("hover-help-copy-fill"), "hot-swap copy should replay blurred fill motion");
    assert.match(hotSwapCopyMotion.animationDuration, /0\.225s|225ms/, "hot-swap copy fill should keep the shortened spring-like timing");
    assertTooltipInViewport(hotSwap);

    await hotSecond.evaluate((element) => {
      element.dispatchEvent(new MouseEvent("mouseout", {
        bubbles: true,
        clientX: 4,
        clientY: 4,
        relatedTarget: document.body,
      }));
    });
    await page.locator(".hover-help-card").waitFor({ state: "detached", timeout: 5000 });

    await page.evaluate(() => {
      const section = document.createElement("section");
      section.id = "hover-help-non-button-key";
      section.dataset.helpKey = "novel.validationSummary";
      section.textContent = "Non-button data-help-key target";
      section.style.cssText = "position:fixed;left:80px;top:96px;width:220px;height:34px;";
      document.body.appendChild(section);
    });
    const nonButtonKey = page.locator("#hover-help-non-button-key");
    await nonButtonKey.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent("mouseover", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        relatedTarget: document.body,
      }));
    });
    await page.waitForTimeout(300);
    await page.locator(".hover-help-card[role='tooltip']").waitFor({ state: "visible", timeout: 5000 });
    const nonButton = await tooltipSnapshot(page);
    assert.equal(nonButton.parentIsBody, true, "non-button data-help-key tooltip should be portaled to document.body");
    assert.ok(nonButton.text.length > 10, "non-button data-help-key should resolve catalog help copy");
    assertTooltipInViewport(nonButton);
    await nonButtonKey.evaluate((element) => {
      element.dispatchEvent(new MouseEvent("mouseout", {
        bubbles: true,
        clientX: 4,
        clientY: 4,
        relatedTarget: document.body,
      }));
    });
    await page.locator(".hover-help-card").waitFor({ state: "detached", timeout: 5000 });

    await createButton.focus();
    await page.locator(".hover-help-card[role='tooltip']").waitFor({ state: "visible", timeout: 5000 });
    const describedBy = await createButton.getAttribute("aria-describedby");
    assert.match(describedBy || "", /agentvn-hover-help-tooltip/, "focused control should reference the tooltip");
    await page.keyboard.press("Escape");
    await page.locator(".hover-help-card").waitFor({ state: "detached", timeout: 5000 });
    const afterEscapeDescribedBy = await createButton.getAttribute("aria-describedby");
    assert.ok(!afterEscapeDescribedBy || !afterEscapeDescribedBy.includes("agentvn-hover-help-tooltip"), "Escape should clear tooltip aria-describedby");

    await page.evaluate(() => {
      const wrapper = document.createElement("div");
      wrapper.id = "hover-help-clipping-host";
      wrapper.style.cssText = "position:fixed;left:16px;top:160px;width:64px;height:40px;overflow:hidden;z-index:10;background:rgba(255,0,0,0.04);";
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.helpTitle = "Portal clipping trigger";
      button.dataset.help = "This tooltip must be mounted under body so it remains visible outside the clipped host.";
      button.textContent = "Clip";
      button.style.cssText = "width:60px;height:36px;";
      wrapper.appendChild(button);
      document.body.appendChild(wrapper);
    });
    await page.locator("#hover-help-clipping-host button").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent("mouseover", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        relatedTarget: document.body,
      }));
    });
    await page.waitForTimeout(300);
    await page.locator(".hover-help-card[role='tooltip']").waitFor({ state: "visible", timeout: 5000 });
    const clipped = await tooltipSnapshot(page);
    assert.equal(clipped.parentIsBody, true, "clipped-host tooltip should still be portaled to document.body");
    assert.ok(clipped.rect.right > 80, "tooltip should extend outside the clipped host instead of being cut off");
    assertTooltipInViewport(clipped);

    const report = { hover, clipped };
    fs.writeFileSync(path.join(outputDir, "hover-help-tooltip-contract.json"), JSON.stringify(report, null, 2), "utf8");
    console.log("Hover help tooltip contract: passed");
  } finally {
    if (browser) await browser.close();
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
