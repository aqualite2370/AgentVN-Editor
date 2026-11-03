const fs = require("fs");
const path = require("path");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "playwright", "non-ai-smoke");
const EDITOR_URL = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const GAMECLI_URL = process.env.AGENTVN_GAMECLI_URL || "http://127.0.0.1:6868/";
const CARTRIDGE = path.join(ROOT, "output", "cartridges", "agentvn-sample-0.1.0.vncart");
const JSZip = require("../editor/node_modules/jszip");

fs.mkdirSync(OUT, { recursive: true });

const report = {
  ok: true,
  at: new Date().toISOString(),
  scope: [
    "Included: editor home, project creation, scene fields, node palette, current five-surface navigation, options panels, export buttons, GameCli library/runtime shell, responsive style checks.",
    "Excluded: assistant chat, provider/model settings, asset generation, novel AI import, any model invocation.",
  ],
  checks: [],
  warnings: [],
  failures: [],
  screenshots: [],
};

function add(status, area, name, detail = "", evidence = "") {
  const item = { status, area, name, detail, evidence };
  report.checks.push(item);
  if (status === "FAIL") {
    report.ok = false;
    report.failures.push(item);
  } else if (status === "WARN") {
    report.warnings.push(item);
  }
  return item;
}

async function shot(page, name) {
  const file = path.join(OUT, `${String(report.screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots.push(file);
  return file;
}

async function clickIfVisible(page, selector, area, name, timeout = 2500) {
  const locator = page.locator(selector).first();
  if (!(await locator.isVisible({ timeout }).catch(() => false))) {
    add("WARN", area, name, `Not visible: ${selector}`);
    return false;
  }
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ force: true });
  add("PASS", area, name, `Clicked ${selector}`);
  await page.waitForTimeout(450);
  return true;
}

async function fillIfVisible(page, selector, value, area, name, timeout = 2500) {
  const locator = page.locator(selector).first();
  if (!(await locator.isVisible({ timeout }).catch(() => false))) {
    add("WARN", area, name, `Not visible: ${selector}`);
    return false;
  }
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.fill(value);
  add("PASS", area, name, `Filled ${selector}`);
  await page.waitForTimeout(150);
  return true;
}

async function auditLayout(page, label) {
  const metrics = await page.evaluate((auditLabel) => {
    const activePopover = document.querySelector(".toolbar-popover.is-open");
    function rectOf(el) {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }
    function nodeName(el) {
      if (!el) return "";
      const parts = [el.tagName.toLowerCase()];
      if (el.id) parts.push(`#${el.id}`);
      if (el.getAttribute("data-help-key")) parts.push(`[data-help-key="${el.getAttribute("data-help-key")}"]`);
      if (el.getAttribute("data-testid")) parts.push(`[data-testid="${el.getAttribute("data-testid")}"]`);
      const cls = String(el.className || "").split(/\s+/).filter(Boolean).slice(0, 3).map((v) => `.${v}`).join("");
      if (cls) parts.push(cls);
      return parts.join("");
    }
    const controls = Array.from(document.querySelectorAll("button,a,input,select,textarea,label,[role='button']"))
      .filter((el) => !el.matches("input[type='file'].visually-hidden"))
      .map((el, index) => {
        const style = getComputedStyle(el);
        const rect = rectOf(el);
        let hitRect = { ...rect };
        for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const ancestorStyle = getComputedStyle(ancestor);
          const clipsX = ["hidden", "clip", "auto", "scroll"].includes(ancestorStyle.overflowX);
          const clipsY = ["hidden", "clip", "auto", "scroll"].includes(ancestorStyle.overflowY);
          if (!clipsX && !clipsY) continue;
          const clipRect = rectOf(ancestor);
          hitRect = {
            left: Math.max(hitRect.left, clipsX ? clipRect.left : hitRect.left),
            top: Math.max(hitRect.top, clipsY ? clipRect.top : hitRect.top),
            right: Math.min(hitRect.right, clipsX ? clipRect.right : hitRect.right),
            bottom: Math.min(hitRect.bottom, clipsY ? clipRect.bottom : hitRect.bottom),
            width: 0,
            height: 0,
          };
          hitRect.width = Math.max(0, hitRect.right - hitRect.left);
          hitRect.height = Math.max(0, hitRect.bottom - hitRect.top);
        }
        const inActiveSurface = !activePopover || activePopover.contains(el);
        const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
        const visible = inActiveSurface && inViewport && rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number.parseFloat(style.opacity || "1") > 0.02;
        const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
        let hitOk = true;
        let hit = "";
        if (visible && hitRect.width >= 8 && hitRect.height >= 8) {
          const x = Math.min(window.innerWidth - 1, Math.max(1, hitRect.left + hitRect.width / 2));
          const y = Math.min(window.innerHeight - 1, Math.max(1, hitRect.top + hitRect.height / 2));
          const target = document.elementFromPoint(x, y);
          hit = nodeName(target);
          hitOk = Boolean(target && (target === el || el.contains(target) || target.contains(el)));
        }
        return {
          index,
          node: nodeName(el),
          text: text.slice(0, 80),
          visible,
          rect,
          disabled: Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true",
          unnamed: visible && !text && !el.getAttribute("aria-label") && !el.getAttribute("title"),
          small: visible && (rect.width < 32 || rect.height < 32),
          hitOk,
          hit,
        };
      });
    const visibleElements = Array.from(document.querySelectorAll("body *")).filter((el) => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const overflowText = visibleElements
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.overflowX === "visible" && el.scrollWidth > el.clientWidth + 4 && (el.textContent || "").trim().length > 0;
      })
      .slice(0, 20)
      .map((el) => ({
        node: nodeName(el),
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
    return {
      label: auditLabel,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      body: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      },
      horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 3,
      controlCount: controls.filter((c) => c.visible).length,
      smallControls: controls.filter((c) => c.visible && c.small).slice(0, 25),
      unnamedControls: controls.filter((c) => c.unnamed).slice(0, 25),
      obscuredControls: controls.filter((c) => c.visible && !c.hitOk).slice(0, 25),
      overflowText,
    };
  }, label);
  const file = path.join(OUT, `${label}-metrics.json`);
  fs.writeFileSync(file, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  if (metrics.horizontalScroll) add("FAIL", "layout", `${label}: horizontal scroll`, `${metrics.body.scrollWidth}/${metrics.body.clientWidth}`, file);
  else add("PASS", "layout", `${label}: no horizontal page scroll`, `${metrics.body.scrollWidth}/${metrics.body.clientWidth}`, file);
  if (metrics.obscuredControls.length) add("FAIL", "layout", `${label}: obscured controls`, `${metrics.obscuredControls.length} center-hit failures`, file);
  else add("PASS", "layout", `${label}: visible controls center-hit`, `${metrics.controlCount} controls sampled`, file);
  if (metrics.overflowText.length) add("WARN", "layout", `${label}: text overflow candidates`, `${metrics.overflowText.length} candidates`, file);
  else add("PASS", "layout", `${label}: no visible text overflow candidates`, "", file);
  if (metrics.unnamedControls.length) add("WARN", "a11y", `${label}: unnamed controls`, `${metrics.unnamedControls.length} candidates`, file);
  else add("PASS", "a11y", `${label}: controls have names`, "", file);
  if (metrics.smallControls.length) add("WARN", "a11y", `${label}: compact controls`, `${metrics.smallControls.length} controls under 32px in one dimension`, file);
  return metrics;
}

async function mockNonAiBackend(page) {
  const state = {
    provider_connections: [],
    provider_models: [],
    provider_selections: {},
    provider_secrets: {},
    project_graph: null,
    project_metadata: {},
    recent_projects: [],
    projects: new Map(),
  };
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", service: "agentvn-backend", mocked: true }),
    });
  });
  await page.route("**/api/project/state", async (route) => {
    if (route.request().method() === "POST") {
      const posted = route.request().postDataJSON?.() || {};
      Object.assign(state, posted);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: route.request().method() === "GET" ? null : state }),
    });
  });
  await page.route("**/api/project/catalog", async (route) => {
    const summaries = [...state.projects.values()].map((project) => ({
      project_id: project.project_id,
      title: project.title,
      author: project.author,
      created_at: project.created_at,
      updated_at: project.updated_at,
      node_count: Array.isArray(project.nodes) ? project.nodes.length : 0,
      edge_count: Array.isArray(project.edges) ? project.edges.length : 0,
      size_bytes: JSON.stringify(project).length,
      size_source: "measured",
      schema_version: project.schema_version,
      has_detail: true,
      project,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: summaries }),
    });
  });
  await page.route("**/api/project/projects/**", async (route) => {
    const method = route.request().method();
    const projectId = new URL(route.request().url()).pathname.split("/").pop();
    if (!projectId) {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false }) });
      return;
    }
    if (method === "PUT") {
      const project = route.request().postDataJSON?.() || {};
      state.projects.set(projectId, project);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: project }),
      });
      return;
    }
    if (method === "GET") {
      const project = state.projects.get(projectId);
      await route.fulfill({
        status: project ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(project ? { ok: true, data: project } : { ok: false, detail: "missing project" }),
      });
      return;
    }
    if (method === "DELETE") {
      state.projects.delete(projectId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, deleted: true }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/memory/mode", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ memory_mode: "off" }),
    });
  });
}

async function waitForBootOverlay(page) {
  await page.locator(".boot-overlay").waitFor({ state: "hidden", timeout: 45000 });
}

async function runEditor(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, acceptDownloads: true });
  const page = await context.newPage();
  await mockNonAiBackend(page);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await page.locator('[data-help-key="home.createProject"]:not(:disabled)').first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await shot(page, "editor-home-desktop");
  await auditLayout(page, "editor-home-desktop");
  await clickIfVisible(page, '[data-help-key="home.createProject"]', "editor", "create project");
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await shot(page, "editor-canvas-desktop");
  await fillIfVisible(page, '[data-help-key="field.title"]', "Smoke Scene Title", "editor", "edit scene title");
  await fillIfVisible(page, '[data-help-key="field.summary"]', "Non-AI smoke test summary.", "editor", "edit scene summary");
  for (const key of ["palette.scene", "palette.choice", "palette.modifier", "palette.condition", "palette.end"]) {
    await clickIfVisible(page, `[data-help-key="${key}"]`, "editor", `create node ${key}`);
  }
  const surfaceLabels = await page.locator('[data-testid="workspace-surface-nav"] button[data-workspace-surface]').allTextContents();
  if (JSON.stringify(surfaceLabels) === JSON.stringify(["编辑", "选项", "AI", "预览", "发布"])) {
    add("PASS", "editor", "current task navigation", "Verified 编辑、选项、AI、预览、发布.");
  } else {
    add("FAIL", "editor", "current task navigation", `Unexpected labels: ${JSON.stringify(surfaceLabels)}`);
  }
  const saveButton = page.locator('[data-help-key="toolbar.saveProject"]').first();
  if (await saveButton.isVisible().catch(() => false)) {
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await saveButton.click({ force: true });
    const download = await downloadPromise;
    if (download) {
      const target = path.join(OUT, await download.suggestedFilename());
      await download.saveAs(target);
      add("PASS", "editor", "save project download", "Downloaded project JSON.", target);
    } else {
      add("WARN", "editor", "save project download", "No download event observed.");
    }
  }
  const saveConfirmation = page.locator('[data-testid="project-save-confirmation"]');
  if (await saveConfirmation.isVisible().catch(() => false)) {
    await saveConfirmation.locator(".project-save-confirm-ok").click({ force: true });
    await saveConfirmation.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
    add("PASS", "editor", "dismiss save confirmation", "Closed the modal before layout hit-testing.");
  }
  await clickIfVisible(page, '[data-workspace-surface="options"]', "editor", "open options surface");
  await page.locator(".toolbar-popover:visible").waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  for (const key of ["advanced.tab.settings", "advanced.tab.layout", "advanced.tab.library", "advanced.tab.animation", "advanced.tab.preview"]) {
    await clickIfVisible(page, `[data-help-key="${key}"]`, "editor", `open ${key}`);
    await auditLayout(page, `editor-${key.replace(/\./g, "-")}`);
  }
  add("PASS", "editor", "AI workflows excluded", "Excluded AI execution from this non-AI smoke lane.");
  await shot(page, "editor-options-final");
  await auditLayout(page, "editor-desktop-final");
  if (errors.length) add("WARN", "editor", "browser console/page errors", errors.slice(0, 8).join(" | "));
  else add("PASS", "editor", "browser console/page errors", "No console error or pageerror captured.");
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mobile.newPage();
  await mockNonAiBackend(mpage);
  await mpage.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  await mpage.locator("body").waitFor({ state: "visible", timeout: 30000 });
  await mpage.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await mpage.locator('[data-help-key="home.createProject"]:not(:disabled)').first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await shot(mpage, "editor-home-mobile");
  await auditLayout(mpage, "editor-home-mobile");
  await clickIfVisible(mpage, '[data-help-key="home.createProject"]', "editor-mobile", "create project mobile");
  await mpage.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 30000 });
  await mpage.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await clickIfVisible(mpage, '[data-workspace-surface="options"]', "editor-mobile", "open options mobile");
  await mpage.locator(".toolbar-popover:visible").waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  await clickIfVisible(mpage, '[data-help-key="advanced.tab.layout"]', "editor-mobile", "open layout mobile");
  await shot(mpage, "editor-layout-mobile");
  await auditLayout(mpage, "editor-layout-mobile");
  await mobile.close();
}

async function runGameCli(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(GAMECLI_URL, { waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor({ state: "visible", timeout: 30000 });
  await page.getByTestId("game-state-library").waitFor({ state: "visible", timeout: 30000 });
  await waitForBootOverlay(page);
  await shot(page, "gamecli-library-desktop");
  await auditLayout(page, "gamecli-library-desktop");
  if (fs.existsSync(CARTRIDGE)) {
    const input = page.getByTestId("web-cartridge-file");
    if (await input.count()) {
      await input.setInputFiles(CARTRIDGE);
      await page.waitForTimeout(1200);
      add("PASS", "gamecli", "import cartridge file", CARTRIDGE);
      await shot(page, "gamecli-after-import");
    }
  } else {
    add("WARN", "gamecli", "import cartridge file", `Missing ${CARTRIDGE}`);
  }
  const spines = page.locator(".cartridge-spine");
  if ((await spines.count().catch(() => 0)) > 0) {
    await spines.first().click({ force: true });
    add("PASS", "gamecli", "select cartridge", "Selected first visible cartridge.");
    const launch = page.locator(".launch-actions button").first();
    if (await launch.isVisible().catch(() => false)) {
      await launch.click({ force: true });
      const launched = await page.locator(".story-player, .main-menu, [data-testid='game-state-title']").first().waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false);
      if (launched) {
        await waitForBootOverlay(page);
        add("PASS", "gamecli", "launch imported cartridge", "Runtime opened title/player shell.");
      } else {
        add("FAIL", "gamecli", "launch imported cartridge", "Timed out waiting for title/player after imported cartridge launch.");
        await shot(page, "gamecli-import-launch-timeout");
      }
    } else {
      add("WARN", "gamecli", "launch cartridge", "Launch button not visible after selecting cartridge.");
    }
  } else {
    add("WARN", "gamecli", "select cartridge", "No cartridge spine visible.");
  }
  await context.close();

  const fixedContext = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  // Serve a known cartridge through the real embedded-directory loader. The
  // dev library build intentionally has no public embedded cartridge.
  const zip = await JSZip.loadAsync(fs.readFileSync(CARTRIDGE));
  await fixedContext.route("**/embedded-cartridge/**", async route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/embedded-cartridge/")[1]);
    const file = zip.file(name);
    if (!file) return route.fulfill({ status: 404, body: "Missing fixture resource" });
    const contentType = name.endsWith(".json") ? "application/json" : name.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
    await route.fulfill({ contentType, body: await file.async("nodebuffer") });
  });
  const fixed = await fixedContext.newPage();
  await fixed.goto(`${GAMECLI_URL}?mode=fixed`, { waitUntil: "domcontentloaded" });
  await fixed.locator(".story-player, .main-menu, [data-testid='game-state-title']").first().waitFor({ state: "visible", timeout: 45000 });
  await waitForBootOverlay(fixed);
  add("PASS", "gamecli", "open fixed embedded runtime", "Loaded ?mode=fixed with embedded cartridge.");
  await shot(fixed, "gamecli-fixed-title");
  await fixed.getByTestId("open-settings").click();
  await fixed.getByTestId("settings-screen").waitFor();
  await shot(fixed, "gamecli-fixed-settings");
  await auditLayout(fixed, "gamecli-fixed-settings-desktop");
  await fixed.getByTestId("settings-finish").click();
  await fixed.getByTestId("open-about").click();
  await fixed.getByTestId("about-screen").waitFor();
  await shot(fixed, "gamecli-fixed-about");
  await auditLayout(fixed, "gamecli-fixed-about-desktop");
  await fixed.getByTestId("back-to-main-menu").click();
  await fixed.getByTestId("start-new-game").click();
  await fixed.getByTestId("game-state-playing").waitFor();
  await waitForBootOverlay(fixed);
  await fixed.locator(".dialog-text").waitFor();
  await auditLayout(fixed, "gamecli-fixed-playing-desktop");
  await fixedContext.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mobile.newPage();
  await mpage.goto(GAMECLI_URL, { waitUntil: "domcontentloaded" });
  await mpage.locator("body").waitFor({ state: "visible", timeout: 30000 });
  await waitForBootOverlay(mpage);
  await shot(mpage, "gamecli-mobile");
  await auditLayout(mpage, "gamecli-mobile");
  await mobile.close();
}

function writeReport() {
  const json = path.join(OUT, "non-ai-smoke-report.json");
  fs.writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const byStatus = (status) => report.checks.filter((c) => c.status === status);
  const lines = [
    "# AgentVN Non-AI Smoke Audit",
    "",
    `- Time: ${report.at}`,
    `- Overall: ${report.ok ? "PASS" : "FAIL"}`,
    `- Checks: ${report.checks.length}`,
    `- Failures: ${report.failures.length}`,
    `- Warnings: ${report.warnings.length}`,
    "",
    "## Scope",
    ...report.scope.map((s) => `- ${s}`),
    "",
    "## Failures",
    ...(report.failures.length ? report.failures.map((c) => `- [${c.area}] ${c.name}: ${c.detail}${c.evidence ? ` (${c.evidence})` : ""}`) : ["- None"]),
    "",
    "## Warnings",
    ...(report.warnings.length ? report.warnings.map((c) => `- [${c.area}] ${c.name}: ${c.detail}${c.evidence ? ` (${c.evidence})` : ""}`) : ["- None"]),
    "",
    "## Passed Checks",
    ...byStatus("PASS").map((c) => `- [${c.area}] ${c.name}: ${c.detail}${c.evidence ? ` (${c.evidence})` : ""}`),
    "",
    "## Screenshots",
    ...report.screenshots.map((s) => `- ${s}`),
    "",
    `JSON: ${json}`,
    "",
  ];
  const md = path.join(OUT, "non-ai-smoke-report.md");
  fs.writeFileSync(md, lines.join("\n"), "utf8");
  return { json, md };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await runEditor(browser);
    await runGameCli(browser);
  } catch (error) {
    add("FAIL", "runner", "non-ai smoke script", error.stack || error.message || String(error));
  } finally {
    await browser.close().catch(() => {});
    const files = writeReport();
    console.log(JSON.stringify({ ok: report.ok, failures: report.failures.length, warnings: report.warnings.length, files }, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
})();
