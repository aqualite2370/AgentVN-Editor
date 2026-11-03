const { chromium } = require("../editor/node_modules/playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultNovelPath = "C:/Users/1/Downloads/1.txt";
const editorUrl = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const backendUrl = process.env.AGENTVN_BACKEND_URL || "http://127.0.0.1:8278";
const outRoot = path.join(root, "output", "playwright");
const screenshotDir = path.join(outRoot, "novel-import-layout-audit");
const resultPath = path.join(outRoot, "novel-import-layout-audit.json");
const failurePath = path.join(outRoot, "novel-import-layout-audit-failures.md");

function parseArgs(argv) {
  const args = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const eqIndex = item.indexOf("=");
    if (eqIndex !== -1) {
      args.set(item.slice(0, eqIndex), item.slice(eqIndex + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(item, next);
      index += 1;
    } else {
      flags.add(item);
    }
  }
  return { args, flags };
}

const { args, flags } = parseArgs(process.argv.slice(2));
const novelPath = path.resolve(args.get("--novel") || defaultNovelPath);
const runBranch = flags.has("--branch") || args.get("--branch") === "true";
const headed = flags.has("--headed");
const fullRun = flags.has("--full");
// The matrix layout lane validates the workbench itself. AI generation is an
// external, provider-dependent workflow and is covered by the dedicated novel
// job acceptance; keeping it out of this geometry audit makes the lane bounded.
const layoutOnly = flags.has("--layout-only");
const stopAtQuality = !fullRun;
const viewportArg = args.get("--viewport") || args.get("--viewports");
const viewportSpecs = viewportArg ? viewportArg.split(",") : ["1440x1000", "1280x720", "390x844"];
const viewports = viewportSpecs.map((spec) => {
  const [width, height] = spec.toLowerCase().split("x").map((value) => Number.parseInt(value, 10));
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error(`Invalid viewport: ${spec}`);
  return { label: `${width}x${height}`, width, height };
});

fs.mkdirSync(screenshotDir, { recursive: true });

function redact(value) {
  return String(value ?? "")
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/"api_key"\s*:\s*"[^"]+"/gi, "\"api_key\":\"***\"")
    .replace(/api[_-]?key=([^&\s]+)/gi, "api_key=***");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function loadProviderState() {
  const appDataRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || root, "AppData", "Roaming");
  const systemDbPath = process.env.DATABASE_PATH || path.join(appDataRoot, "com.agentvn.editor", "backend", "vn_engine.db");
  const legacyDbPath = path.join(root, "backend", "data", "vn_engine.db");
  const dbPath = fs.existsSync(systemDbPath) ? systemDbPath : legacyDbPath;
  const script = String.raw`
import sqlite3, json, sys
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
state = {}
for key in ['provider_connections','provider_models','provider_selections','provider_secrets']:
    row = conn.execute('select value from editor_shared_state where key=?', (key,)).fetchone()
    if row:
        state[key] = json.loads(row['value'])
    elif key in ['provider_connections','provider_models']:
        state[key] = []
    else:
        state[key] = {}
state['project_graph'] = {'nodes': [], 'edges': [], 'viewport': {'x': 0, 'y': 0, 'zoom': 1}, 'memoryMode': 'hybrid'}
state['project_metadata'] = {}
state['recent_projects'] = []
print(json.dumps(state, ensure_ascii=False))
`;
  return JSON.parse(execFileSync("python", ["-c", script, dbPath], { cwd: root, encoding: "utf8" }));
}

function selectedModelLabel(state) {
  const selected = state.provider_selections?.text_generation;
  const model = state.provider_models?.find((item) => item.provider_id === selected);
  const connection = state.provider_connections?.find((item) => item.connection_id === model?.connection_id);
  return {
    provider_id: selected || null,
    connection: connection?.name || connection?.connection_id || null,
    model: model?.model_name || model?.display_name || null,
  };
}

async function clickFirst(page, selectors, label, options = {}) {
  for (const selector of selectors) {
    const locator = typeof selector === "string" ? page.locator(selector).first() : selector;
    if (await locator.isVisible({ timeout: options.timeout ?? 1200 }).catch(() => false)) {
      await locator.click({ force: true, timeout: options.timeout ?? 15000 });
      await page.waitForTimeout(options.afterMs ?? 500);
      return true;
    }
  }
  throw new Error(`Could not find clickable target: ${label}`);
}

async function waitForTransientOverlay(page, timeout = 15000) {
  await page
    .waitForFunction(
      () => {
        const overlays = Array.from(document.querySelectorAll(".project-entry-loading-overlay, .app-transition-stage.is-switching"));
        return !overlays.some((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity || "1") > 0.01 && rect.width > 0 && rect.height > 0;
        });
      },
      null,
      { timeout },
    )
    .catch(() => {});
}

async function clickVisibleEnabled(page, selectors, label, timeout = 30000) {
  const clicked = await page
    .waitForFunction(
      (targetSelectors) => {
        function isVisibleEnabled(element) {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number.parseFloat(style.opacity || "1") > 0.01 &&
            !element.disabled &&
            element.getAttribute("aria-disabled") !== "true"
          );
        }

        for (const selector of targetSelectors) {
          const target = Array.from(document.querySelectorAll(selector)).find(isVisibleEnabled);
          if (target) {
            target.click();
            return true;
          }
        }
        return false;
      },
      selectors,
      { timeout },
    )
    .catch(() => false);

  if (!clicked) throw new Error(`Could not find enabled clickable target: ${label}`);
}

async function ensureNovelImportOpen(page) {
  await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1000);
  await waitForTransientOverlay(page);
  const workspace = page.locator(".editor-workspace").first();
  if (!(await workspace.isVisible({ timeout: 2500 }).catch(() => false))) {
    const home = page.locator(".project-home").first();
    if (await home.isVisible({ timeout: 2500 }).catch(() => false)) {
      await clickVisibleEnabled(page, ['[data-help-key="home.createProject"]', '[data-help-key="home.openDraft"]'], "project entry");
    }
    await waitForTransientOverlay(page);
    await workspace.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(800);
  }
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"), null, { timeout: 30000 });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:workspace-open-surface", {
      detail: { surface: "import" },
    }));
  });
  await page.locator('[data-testid="novel-import-workbench"]').waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".novel-import-wizard").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => {
    const workbench = document.querySelector('[data-testid="novel-import-workbench"]');
    return workbench instanceof HTMLElement && getComputedStyle(workbench).pointerEvents !== "none";
  }, null, { timeout: 15000 });
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

async function auditPage(page, run, viewport, stage, options = {}) {
  const screenshotName = `${String(run.samples.length + 1).padStart(3, "0")}-${viewport.label}-${safeName(stage)}.png`;
  const screenshotPath = path.join(screenshotDir, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
  const requiredSelectors = options.requiredSelectors || [];
  const data = await page.evaluate(
    ({ stageName, requiredSelectorsForStage }) => {
      const selectorDefinitions = [
        { key: "wizard", selector: ".novel-import-wizard", role: "container" },
        { key: "heartbeat", selector: ".novel-operation-heartbeat", role: "status" },
        { key: "main", selector: ".novel-ai-layout > main", role: "main-scroll" },
        { key: "statusPanel", selector: ".novel-ai-status-panel", role: "status-panel" },
        { key: "modelStream", selector: ".novel-model-stream-panel", role: "drawer" },
        { key: "validationPanel", selector: ".novel-validation-panel", role: "drawer" },
        { key: "resultPanel", selector: ".novel-ai-result-panel", role: "drawer" },
        { key: "runFeedback", selector: ".novel-run-feedback", role: "feedback" },
        { key: "qualityPanel", selector: ".novel-quality-panel", role: "quality" },
        { key: "startAi", selector: '[data-help-key="novel.aiStart"]', role: "action" },
        { key: "confirmOutline", selector: '[data-help-key="novel.confirmOutline"]', role: "action" },
        { key: "retryQuality", selector: '[data-help-key="novel.retryQuality"]', role: "action" },
        { key: "continueQualityRisk", selector: '[data-help-key="novel.continueQualityRisk"]', role: "action" },
      ];
      const blockers = [
        ".novel-operation-heartbeat",
        ".novel-ai-status-panel",
        ".novel-model-stream-panel",
        ".novel-validation-panel",
        ".novel-ai-result-panel",
        ".novel-run-feedback",
        ".novel-quality-panel",
      ];
      const importantTextSelectors = [
        ".novel-next-action-banner strong",
        ".novel-quality-header strong",
        ".novel-quality-branch-warning",
        ".novel-step-error-hint",
        ".novel-run-feedback .inline-warning",
      ];
      const viewportBox = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const failures = [];

      function rectOf(element) {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          x: rect.x,
          y: rect.y,
        };
      }

      function intersects(a, b) {
        const left = Math.max(a.left, b.left);
        const top = Math.max(a.top, b.top);
        const right = Math.min(a.right, b.right);
        const bottom = Math.min(a.bottom, b.bottom);
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        return { left, top, right, bottom, width, height, area: width * height };
      }

      function inViewport(rect) {
        return intersects(rect, viewportBox).area > 0;
      }

      function clipRectFor(element) {
        let clip = viewportBox;
        let node = element.parentElement;
        while (node && node !== document.documentElement) {
          const style = window.getComputedStyle(node);
          const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
          const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
          const canClipX = clipsX && (node.scrollWidth > node.clientWidth + 1 || /(hidden|clip)/.test(style.overflowX));
          const canClipY = clipsY && (node.scrollHeight > node.clientHeight + 1 || /(hidden|clip)/.test(style.overflowY));
          if (canClipX || canClipY) {
            clip = intersects(clip, rectOf(node));
          }
          node = node.parentElement;
        }
        return clip;
      }

      function inClipViewport(element, rect) {
        return intersects(rect, clipRectFor(element)).area > 0;
      }

      function centerInClipViewport(element, rect) {
        const clip = clipRectFor(element);
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return x >= viewportBox.left && x <= viewportBox.right && y >= viewportBox.top && y <= viewportBox.bottom && x >= clip.left && x <= clip.right && y >= clip.top && y <= clip.bottom;
      }

      function visible(element, rect, style) {
        if (element.closest(".novel-expand-control:not(.is-expanded) .novel-expand-content")) return false;
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0.01
        );
      }

      function compactText(element) {
        return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180);
      }

      function describeNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
        const element = node;
        const parts = [element.tagName.toLowerCase()];
        if (element.id) parts.push(`#${element.id}`);
        if (element.dataset?.helpKey) parts.push(`[data-help-key="${element.dataset.helpKey}"]`);
        const className = String(element.className || "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 4)
          .map((item) => `.${item}`)
          .join("");
        if (className) parts.push(className);
        return {
          selector_hint: parts.join(""),
          text: compactText(element).slice(0, 90),
        };
      }

      function cssSelector(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return "";
        if (element.dataset?.helpKey) return `[data-help-key="${CSS.escape(element.dataset.helpKey)}"]`;
        if (element.id) return `#${CSS.escape(element.id)}`;
        const path = [];
        let node = element;
        while (node && node.nodeType === Node.ELEMENT_NODE && path.length < 5) {
          let part = node.tagName.toLowerCase();
          if (node.classList.length) {
            part += `.${Array.from(node.classList).slice(0, 2).map((item) => CSS.escape(item)).join(".")}`;
          }
          const parent = node.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((item) => item.tagName === node.tagName);
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
          }
          path.unshift(part);
          node = node.parentElement;
        }
        return path.join(" > ");
      }

      function describeElement(element, key, selector, role) {
        if (!element) return { key, selector, role, present: false };
        const style = window.getComputedStyle(element);
        const rect = rectOf(element);
        const item = {
          key,
          selector,
          role,
          present: true,
          visible: visible(element, rect, style),
          in_viewport: inViewport(rect),
          in_clip_viewport: inClipViewport(element, rect),
          rect,
          scroll: {
            client_width: element.clientWidth,
            client_height: element.clientHeight,
            scroll_width: element.scrollWidth,
            scroll_height: element.scrollHeight,
          },
          style: {
            display: style.display,
            position: style.position,
            z_index: style.zIndex,
            overflow_x: style.overflowX,
            overflow_y: style.overflowY,
            pointer_events: style.pointerEvents,
            opacity: style.opacity,
            transform: style.transform,
            white_space: style.whiteSpace,
          },
          disabled: "disabled" in element ? Boolean(element.disabled) : false,
          text: compactText(element),
          selector_hint: cssSelector(element),
        };
        return item;
      }

      const elements = selectorDefinitions.map((definition) =>
        describeElement(document.querySelector(definition.selector), definition.key, definition.selector, definition.role),
      );
      const elementBySelector = new Map(elements.map((item) => [item.selector, item]));
      for (const selector of requiredSelectorsForStage) {
        const item = elementBySelector.get(selector) || describeElement(document.querySelector(selector), selector, selector, "required");
        if (!item.present) {
          failures.push({ type: "missing-required", stage: stageName, selector });
        } else if (!item.visible || !item.in_viewport || !item.in_clip_viewport) {
          failures.push({ type: "required-not-visible", stage: stageName, selector, element: item });
        }
      }

      const scope = document.querySelector(".novel-import-wizard");
      const interactiveCandidates = scope
        ? Array.from(scope.querySelectorAll('button, [role="button"], label[data-help-key="novel.importFile"], input[type="checkbox"]'))
        : [];
      const interactiveEntries = interactiveCandidates
        .map((element, index) => ({ element, item: describeElement(element, `interactive-${index}`, cssSelector(element), "interactive") }))
        .filter(({ element, item }) => item.present && item.visible && item.in_viewport && item.in_clip_viewport && centerInClipViewport(element, item.rect));
      const interactives = interactiveEntries.map(({ item }) => item);

      function hitTest(element, item) {
        const rect = item.rect;
        const clip = clipRectFor(element);
        const insetX = Math.min(8, Math.max(1, rect.width / 4));
        const insetY = Math.min(8, Math.max(1, rect.height / 4));
        const points = [
          { name: "center", x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          { name: "top-left", x: rect.left + insetX, y: rect.top + insetY },
          { name: "top-right", x: rect.right - insetX, y: rect.top + insetY },
          { name: "bottom-left", x: rect.left + insetX, y: rect.bottom - insetY },
          { name: "bottom-right", x: rect.right - insetX, y: rect.bottom - insetY },
        ];
        const safeAncestorSelectors = [
          ".novel-import-wizard",
          ".novel-ai-layout",
          ".novel-outline-review",
          ".novel-ai-scan-panel",
          ".novel-blueprint-generation",
          ".novel-ai-landing",
          ".novel-import-actions",
          ".toolbar-popover.advanced.is-open",
        ].join(",");
        const unsafeAncestorSelectors = [
          ".novel-ai-status-panel",
          ".novel-model-stream-panel",
          ".novel-secondary-drawer",
          ".novel-validation-panel",
          ".novel-ai-result-panel",
          ".novel-run-feedback",
          ".novel-quality-panel",
        ].join(",");
        function isSafeAncestorHit(hit) {
          if (!hit || !hit.contains || !hit.contains(element)) return false;
          if (hit.matches?.(unsafeAncestorSelectors)) return false;
          return Boolean(hit.matches?.(safeAncestorSelectors));
        }
        const hits = [];
        for (const point of points) {
          if (point.x < 0 || point.y < 0 || point.x > window.innerWidth || point.y > window.innerHeight) {
            hits.push({ ...point, ok: false, reason: "outside-viewport" });
            continue;
          }
          if (point.x < clip.left || point.x > clip.right || point.y < clip.top || point.y > clip.bottom) {
            hits.push({ ...point, ok: true, skipped: true, reason: "outside-current-clip" });
            continue;
          }
          const hit = document.elementFromPoint(point.x, point.y);
          const stack = document.elementsFromPoint(point.x, point.y).slice(0, 6).map(describeNode).filter(Boolean);
          const ok = Boolean(hit && (hit === element || element.contains(hit) || isSafeAncestorHit(hit)));
          hits.push({ ...point, ok, hit: describeNode(hit), stack });
        }
        const testedHits = hits.filter((hitResult) => !hitResult.skipped);
        const centerHit = testedHits.find((hitResult) => hitResult.name === "center");
        const shouldReportFailures = centerHit ? !centerHit.ok : !testedHits.some((hitResult) => hitResult.ok);
        if (shouldReportFailures) {
          for (const hitResult of testedHits.filter((nextHit) => !nextHit.ok)) {
            failures.push({
              type: "covered-hit-target",
              stage: stageName,
              selector: item.selector,
              text: item.text,
              point: hitResult.name,
              expected: describeNode(element),
              hit: hitResult.hit,
              stack: hitResult.stack,
              element: item,
            });
          }
        }
        return hits;
      }

      const interactiveDetails = [];
      for (const { element, item } of interactiveEntries) {
        const hits = hitTest(element, item);
        const clipsX = item.scroll.scroll_width > item.scroll.client_width + 2;
        const clipsY = item.scroll.scroll_height > item.scroll.client_height + 2;
        if (clipsX || clipsY) {
          failures.push({
            type: "interactive-clipped",
            stage: stageName,
            selector: item.selector,
            text: item.text,
            clips_x: clipsX,
            clips_y: clipsY,
            element: item,
          });
        }
        interactiveDetails.push({ ...item, hit_tests: hits });
      }

      const blockerElements = blockers
        .flatMap((selector) => Array.from(scope ? scope.querySelectorAll(selector) : []).map((element) => ({ selector, element })))
        .filter(({ element }) => {
          const style = window.getComputedStyle(element);
          return visible(element, rectOf(element), style) && inViewport(rectOf(element));
        });
      for (const { element, item } of interactiveEntries) {
        for (const blocker of blockerElements) {
          if (blocker.element === element || blocker.element.contains(element) || element.contains(blocker.element)) continue;
          const blockerRect = rectOf(blocker.element);
          const intersection = intersects(item.rect, blockerRect);
          if (intersection.area > 4) {
            failures.push({
              type: "overlaps-status-or-drawer",
              stage: stageName,
              selector: item.selector,
              blocker: blocker.selector,
              intersection,
              element: item,
              blocker_element: describeElement(blocker.element, blocker.selector, blocker.selector, "blocker"),
            });
          }
        }
      }

      const importantText = importantTextSelectors
        .flatMap((selector) => Array.from(scope ? scope.querySelectorAll(selector) : []).map((element, index) => ({ selector, element, index })))
        .map(({ selector, element, index }) => describeElement(element, `${selector}-${index}`, selector, "important-text"))
        .filter((item) => item.present && item.visible && item.in_viewport);
      for (const item of importantText) {
        const clipsX = item.scroll.scroll_width > item.scroll.client_width + 2;
        const clipsY = item.scroll.scroll_height > item.scroll.client_height + 2;
        const scrollableY = ["auto", "scroll"].includes(item.style.overflow_y);
        const scrollableX = ["auto", "scroll"].includes(item.style.overflow_x);
        if ((clipsX && !scrollableX) || (clipsY && !scrollableY)) {
          failures.push({
            type: "important-text-clipped",
            stage: stageName,
            selector: item.selector,
            text: item.text,
            clips_x: clipsX,
            clips_y: clipsY,
            element: item,
          });
        }
      }

      return {
        stage: stageName,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scroll: {
          x: window.scrollX,
          y: window.scrollY,
          body_scroll_height: document.body.scrollHeight,
          document_scroll_height: document.documentElement.scrollHeight,
        },
        elements,
        interactives: interactiveDetails,
        important_text: importantText,
        failures,
      };
    },
    { stageName: stage, requiredSelectorsForStage: requiredSelectors },
  );
  const sample = {
    at: new Date().toISOString(),
    viewport: viewport.label,
    stage,
    screenshot: screenshotPath,
    ...data,
  };
  run.samples.push(sample);
  if (sample.failures.length > 0) run.failures.push(...sample.failures.map((failure) => ({ ...failure, viewport: viewport.label, screenshot: screenshotPath })));
  return sample;
}

async function waitWithAudits(page, run, viewport, label, timeoutMs, condition, options = {}) {
  const started = Date.now();
  let nextAuditAt = Date.now();
  let index = 0;
  while (Date.now() - started < timeoutMs) {
    const result = await condition();
    if (result) return result;
    if (Date.now() >= nextAuditAt) {
      await auditPage(page, run, viewport, `${label}-${String(index).padStart(2, "0")}`);
      index += 1;
      nextAuditAt = Date.now() + (options.intervalMs ?? 2500);
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function getInlineErrors(page) {
  const errors = await page.locator(".inline-error").allTextContents().catch(() => []);
  return errors.map((item) => item.trim()).filter(Boolean);
}

async function scrollIntoAuditView(page, selector) {
  const locator = page.locator(selector).first();
  if (await locator.isVisible().catch(() => false)) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(150);
  }
}

async function runViewport(browser, providerState, viewport) {
  const run = {
    viewport: viewport.label,
    samples: [],
    api_events: [],
    console_errors: [],
    failures: [],
    status: "running",
  };
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  await page.route("**/api/project/state", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: providerState }),
    });
  });

  page.on("console", (message) => {
    if (message.type() === "error") run.console_errors.push(redact(message.text()));
  });
  page.on("pageerror", (error) => run.console_errors.push(redact(error.stack || error.message)));
  page.on("request", (request) => {
    if (request.url().startsWith(`${backendUrl}/api/novel/import/`)) {
      run.api_events.push({ type: "request", method: request.method(), path: new URL(request.url()).pathname, at: new Date().toISOString() });
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(`${backendUrl}/api/novel/import/`)) {
      run.api_events.push({ type: "response", status: response.status(), path: new URL(response.url()).pathname, at: new Date().toISOString() });
    }
  });

  try {
    await ensureNovelImportOpen(page);
    await auditPage(page, run, viewport, "open-novel-import");

    await page.locator('[data-help-key="novel.importFile"] input[type="file"], input[type="file"][data-help-key="novel.importFile"]').first().setInputFiles(novelPath);
    await page.waitForTimeout(800);
    const largeDialog = page.locator(".novel-large-dialog");
    if (await largeDialog.isVisible().catch(() => false)) {
      const continueDirect = largeDialog.locator('[data-help-key="novel.continueDirect"]').first();
      if (!(await continueDirect.isVisible().catch(() => false))) {
        throw new Error("The selected novel requires chapter splitting and cannot enter the direct AI layout audit.");
      }
      await continueDirect.click();
      await largeDialog.waitFor({ state: "hidden", timeout: 30000 });
    } else {
      const continueDirect = page.locator('[data-help-key="novel.continueDirect"]').first();
      if (await continueDirect.isVisible({ timeout: 3000 }).catch(() => false)) {
        await clickVisibleEnabled(page, ['[data-help-key="novel.continueDirect"]'], "confirm direct novel import", 15000);
        await page.waitForTimeout(300);
      }
    }
    await scrollIntoAuditView(page, '[data-help-key="novel.aiStart"]');
    await auditPage(page, run, viewport, "after-upload", { requiredSelectors: ['[data-help-key="novel.aiStart"]'] });

    if (layoutOnly) {
      run.status = run.failures.length ? "failed" : "passed";
      return run;
    }

    if (runBranch) {
      const branchToggle = page.locator('[data-help-key="novel.branchSuggestions"]').first();
      if (await branchToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
        await branchToggle.setChecked(true);
        await page.waitForTimeout(300);
      }
      await scrollIntoAuditView(page, '[data-help-key="novel.aiStart"]');
      await auditPage(page, run, viewport, "after-branch-toggle", { requiredSelectors: ['[data-help-key="novel.aiStart"]'] });
    }

    await clickVisibleEnabled(page, ['[data-help-key="novel.aiStart"]'], "start AI analysis", 30000);
    await page.waitForTimeout(500);
    await auditPage(page, run, viewport, "after-start");

    await waitWithAudits(
      page,
      run,
      viewport,
      "scan",
      420000,
      async () => {
        const errors = await getInlineErrors(page);
        if (errors.length) throw new Error(`Novel scan failed: ${errors.join("\n")}`);
        const confirm = page.locator('[data-help-key="novel.confirmOutline"]').first();
        return (await confirm.isVisible().catch(() => false)) ? "outline-ready" : "";
      },
    );
    await scrollIntoAuditView(page, '[data-help-key="novel.confirmOutline"]');
    await auditPage(page, run, viewport, "outline-ready", { requiredSelectors: ['[data-help-key="novel.confirmOutline"]'] });

    await scrollIntoAuditView(page, '[data-help-key="novel.confirmOutline"]');
    await page.locator('[data-help-key="novel.confirmOutline"]').click({ force: true });
    await page.waitForTimeout(500);
    await auditPage(page, run, viewport, "after-confirm-outline");

    let planningRecoveryAttempts = 0;
    await waitWithAudits(
      page,
      run,
      viewport,
      "planning",
      420000,
      async () => {
        const errors = await getInlineErrors(page);
        if (errors.length) {
          const resume = page.locator('[data-help-key="novel.resumeBlueprint"]').first();
          if (planningRecoveryAttempts < 1 && (await resume.isVisible().catch(() => false))) {
            planningRecoveryAttempts += 1;
            await resume.click({ force: true });
            await page.waitForTimeout(1000);
            return "";
          }
          throw new Error(`Novel planning failed: ${errors.join("\n")}`);
        }
        const quality = page.locator(".novel-quality-panel").first();
        if (await quality.isVisible().catch(() => false)) return "quality-ready";
        if (!stopAtQuality) {
          const report = page.locator(".novel-import-report-panel").first();
          if (await report.isVisible().catch(() => false)) return "report-ready";
        }
        return "";
      },
    );
    await scrollIntoAuditView(page, ".novel-quality-panel");
    await auditPage(page, run, viewport, "quality-ready", { requiredSelectors: [".novel-quality-panel"] });

    const retryQualityButton = page.locator('[data-help-key="novel.retryQuality"]').first();
    const continueRiskButton = page.locator('[data-help-key="novel.continueQualityRisk"]').first();
    const hasRetryQuality = await retryQualityButton.isVisible().catch(() => false);
    const hasContinueRisk = await continueRiskButton.isVisible().catch(() => false);
    if (hasRetryQuality || hasContinueRisk) {
      await scrollIntoAuditView(page, hasContinueRisk ? '[data-help-key="novel.continueQualityRisk"]' : '[data-help-key="novel.retryQuality"]');
      const requiredQualityActions = [];
      if (hasRetryQuality) requiredQualityActions.push('[data-help-key="novel.retryQuality"]');
      if (hasContinueRisk) requiredQualityActions.push('[data-help-key="novel.continueQualityRisk"]');
      await auditPage(page, run, viewport, "quality-actions", { requiredSelectors: requiredQualityActions });
    }

    if (!stopAtQuality) {
      const continueButton = page.locator('[data-help-key="novel.continueQualityRisk"]').first();
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click({ force: true });
        await page.waitForTimeout(500);
        await auditPage(page, run, viewport, "after-continue-quality-risk");
      }
      await waitWithAudits(
        page,
        run,
        viewport,
        "report",
        540000,
        async () => {
          const errors = await getInlineErrors(page);
          if (errors.length) throw new Error(`Novel generation failed: ${errors.join("\n")}`);
          const report = page.locator(".novel-import-report-panel").first();
          return (await report.isVisible().catch(() => false)) ? "report-ready" : "";
        },
      );
      await scrollIntoAuditView(page, ".novel-import-report-panel");
      await auditPage(page, run, viewport, "report-ready", { requiredSelectors: [".novel-import-report-panel"] });
    }

    run.status = run.failures.length ? "failed" : "passed";
  } catch (error) {
    run.status = "failed";
    run.error = redact(error.stack || error.message);
    await auditPage(page, run, viewport, "error").catch(() => {});
  } finally {
    await context.close();
  }
  return run;
}

function writeFailureSummary(result) {
  const lines = ["# Novel Import Layout Audit", ""];
  lines.push(`- Status: ${result.ok ? "PASS" : "FAIL"}`);
  lines.push(`- Novel: ${result.novel_path}`);
  lines.push(`- Result: ${resultPath}`);
  lines.push(`- Screenshots: ${screenshotDir}`);
  lines.push("");
  for (const run of result.runs) {
    lines.push(`## ${run.viewport} - ${run.status}`);
    if (run.error) lines.push(`- Error: ${run.error}`);
    const failures = run.failures || [];
    if (failures.length === 0) {
      lines.push("- No layout failures.");
      lines.push("");
      continue;
    }
    for (const failure of failures.slice(0, 30)) {
      lines.push(`- ${failure.type} at ${failure.stage}`);
      if (failure.selector) lines.push(`  - selector: \`${failure.selector}\``);
      if (failure.blocker) lines.push(`  - blocker: \`${failure.blocker}\``);
      if (failure.text) lines.push(`  - text: ${redact(failure.text)}`);
      if (failure.hit?.selector_hint) lines.push(`  - hit: \`${failure.hit.selector_hint}\``);
      if (failure.screenshot) lines.push(`  - screenshot: ${failure.screenshot}`);
    }
    if (failures.length > 30) lines.push(`- ${failures.length - 30} more failures omitted from summary; see JSON.`);
    lines.push("");
  }
  fs.writeFileSync(failurePath, lines.join("\n"), "utf8");
}

(async () => {
  if (!fs.existsSync(novelPath)) throw new Error(`Novel file does not exist: ${novelPath}`);
  const providerState = loadProviderState();
  const browser = await chromium.launch({ headless: !headed });
  const result = {
    ok: false,
    at: new Date().toISOString(),
    editor_url: editorUrl,
    backend_url: backendUrl,
    novel_path: novelPath,
    branch: runBranch,
    stop_at_quality: stopAtQuality,
    layout_only: layoutOnly,
    provider: selectedModelLabel(providerState),
    viewports: viewports.map((item) => item.label),
    runs: [],
  };
  try {
    for (const viewport of viewports) {
      const run = await runViewport(browser, providerState, viewport);
      result.runs.push(run);
      writeJson(resultPath, { ...result, ok: result.runs.every((item) => item.status === "passed") });
      writeFailureSummary({ ...result, ok: result.runs.every((item) => item.status === "passed") });
    }
    result.ok = result.runs.every((run) => run.status === "passed");
    writeJson(resultPath, result);
    writeFailureSummary(result);
    if (!result.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  const result = {
    ok: false,
    at: new Date().toISOString(),
    error: redact(error.stack || error.message),
    novel_path: novelPath,
    result_path: resultPath,
    failure_path: failurePath,
  };
  writeJson(resultPath, result);
  writeFailureSummary({ ...result, runs: [] });
  console.error(result.error);
  process.exitCode = 1;
});
