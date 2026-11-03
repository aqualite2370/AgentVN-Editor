"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("../../editor/node_modules/jszip");
const { startOwnedViteServer } = require("./owned-vite-server.cjs");
const { currentAcceptanceViewports } = require("./current-acceptance-viewports.cjs");

const pages = [
  { id: "title", label: "标题主页", scope: "title", content: ".main-menu-title-hero-background", component: "title_hero" },
  { id: "preferences", label: "选项", scope: "preferences", action: "settings", content: ".settings-renpy", component: "settings_group" },
  { id: "save_load", label: "存档/读档", scope: "save_load", action: "save-load", content: ".save-grid", component: "save_grid" },
  { id: "history", label: "历史", scope: "history", action: "history", content: ".history-list", component: "history_list" },
  { id: "about", label: "关于", scope: "about", action: "about", content: ".about-card", component: "about_panel" },
  { id: "help", label: "帮助", scope: "help", action: "help", content: ".help-card", component: "help_panel" },
  { id: "gallery", label: "画廊", scope: "gallery", action: "gallery", content: ".gallery-grid", component: "gallery_grid" },
].map((entry, index) => ({ ...entry, font: 23 + index, spacing: 7 + index,
  left: 40 + index * 2, color: `#${(0x24384c + index * 0x040302).toString(16)}` }));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const rgb = hex => `rgb(${[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;

async function waitPage(page, scope) {
  await page.waitForFunction(scope => {
    const owner = document.querySelector("[data-runtime-transition-phase]");
    return !!document.querySelector(`[data-ui-screen="${scope}"]`)
      && owner?.dataset.runtimeTransitionPhase === "idle";
  }, scope);
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function armTransition(page) {
  await page.evaluate(() => {
    let active = false;
    const frames = [];
    window.__menuExportFrames = frames;
    const started = performance.now();
    const sample = () => {
      const owner = document.querySelector("[data-runtime-transition-phase]");
      const phase = owner?.dataset.runtimeTransitionPhase;
      if (phase !== "idle") active = true;
      const menuScreens = ["settings", "save_load", "history", "about", "help", "gallery"];
      const sharedMenu = menuScreens.includes(owner?.dataset.runtimeTransitionFrom)
        && menuScreens.includes(owner?.dataset.runtimeTransitionTo);
      const surface = document.querySelector(sharedMenu
        ? "[data-runtime-motion-surface]" : ".runtime-screen-transition-current");
      const snapshots = [...document.querySelectorAll("[data-runtime-transition-snapshot]")];
      frames.push({
        at: performance.now() - started, phase, style: owner?.dataset.runtimeTransitionStyle,
        duration: Number(owner?.dataset.runtimeTransitionDuration),
        blackout: !!document.querySelector(".game-launch-blackout"),
        opacity: surface ? Number(getComputedStyle(surface).opacity) : null,
        surface: sharedMenu ? "menu-content" : "full-frame",
        snapshot: snapshots.map(node => ({ opacity: Number(getComputedStyle(node).opacity),
          inert: node.inert, hidden: node.getAttribute("aria-hidden"),
          pointerEvents: getComputedStyle(node).pointerEvents })),
        navigationCount: document.querySelectorAll("[data-testid='renpy-menu-navigation']").length,
        currentCount: document.querySelectorAll(".runtime-screen-transition-current").length,
      });
      if ((!active || phase !== "idle") && performance.now() - started < 12000)
        requestAnimationFrame(sample);
      else window.__menuExportFramesFinished = true;
    };
    window.__menuExportFramesFinished = false;
    requestAnimationFrame(sample);
  });
}

async function finishTransition(page) {
  await page.waitForFunction(() => window.__menuExportFramesFinished);
  const frames = await page.evaluate(() => window.__menuExportFrames);
  const fading = frames.filter(frame => frame.phase === "crossfading");
  assert(fading.length >= 2 && fading.some(frame => frame.opacity > .01 && frame.opacity < .99),
    `菜单页必须有真实淡入淡出中间帧，不能硬切：${JSON.stringify({
      frames: frames.length, fading: fading.length, samples: fading.slice(0, 8),
    })}`);
  assert(frames.every(frame => !frame.blackout && !["covering", "swap", "revealing"].includes(frame.phase)),
    "非剧情菜单互切不得出现黑场");
  assert(fading.every(frame => frame.currentCount === 1
    && frame.snapshot.every(copy => copy.inert && copy.hidden === "true" && copy.pointerEvents === "none")),
  "转场只能有一个功能页，离场副本不可接管交互");
  assert(fading.every(frame => frame.duration > 0), "必须使用真实Runtime转场预算");
  return { frameCount: frames.length, fadingFrames: fading.length,
    duration: fading[0].duration, frames };
}

async function runtimeGeometry(page, definition) {
  // ResizeObserver updates logical scale before the browser starts transitions
  // created by that update. A page-navigation idle flag is not resize readiness.
  // Sample actual presentation until finite animations and geometry settle;
  // authored values are still asserted below, never used as a readiness filter.
  const settlement = await page.evaluate(({ content, isTitle, width, height }) =>
    new Promise((resolve, reject) => {
      const started = performance.now();
      let previous, stableFrames = 0, samples = [];
      const sample = () => {
        const frame = document.querySelector(".runtime-layout-frame");
        const host = document.querySelector(isTitle ? ".renpy-title-view" : "[data-renpy-menu-frame]");
        const nav = document.querySelector(isTitle ? ".renpy-title-navigation" : ".renpy-menu-navigation");
        const panel = document.querySelector(content);
        const rect = node => node?.getBoundingClientRect().toJSON();
        const css = host && getComputedStyle(host);
        const navCss = nav && getComputedStyle(nav);
        const animations = host ? host.getAnimations({ subtree: true }).filter(animation =>
          ["running", "pending"].includes(animation.playState)
          && animation.effect?.getComputedTiming().iterations !== Infinity) : [];
        const state = {
          frame: rect(frame), host: rect(host), panel: rect(panel), navigation: rect(nav),
          scale: Number(isTitle ? host?.dataset.renpyScale : host?.dataset.renpyMenuScale),
          configuredGap: css?.getPropertyValue("--renpy-nav-gap"),
          configuredX: css?.getPropertyValue("--renpy-nav-x"),
          gap: navCss?.gap,
          buttons: nav ? [...nav.querySelectorAll("button")].map(button => ({
            rect: rect(button), font: getComputedStyle(button).fontSize,
          })) : [],
          running: animations.map(animation => ({
            property: animation.transitionProperty, playState: animation.playState,
          })),
        };
        const frameWidth = Math.min(width, height * 16 / 9);
        const frameHeight = frameWidth * 9 / 16;
        const ready = host && nav && panel && innerWidth === width && innerHeight === height
          && Math.abs(state.frame?.width - frameWidth) <= 1
          && Math.abs(state.frame?.height - frameHeight) <= 1 && !animations.length
          && document.querySelector("[data-runtime-transition-phase]")?.dataset.runtimeTransitionPhase === "idle";
        const current = JSON.stringify(state);
        stableFrames = ready && current === previous ? stableFrames + 1 : 0;
        previous = current;
        samples.push({ elapsedMs: performance.now() - started, ...state });
        if (samples.length > 4) samples.shift();
        if (stableFrames >= 3) resolve({ elapsedMs: performance.now() - started, stableFrames, samples });
        else if (performance.now() - started > 5000)
          reject(new Error(`Exported menu resize did not settle: ${JSON.stringify({ width, height, samples })}`));
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }), { content: definition.content, isTitle: definition.id === "title", ...page.viewportSize() });
  const actual = await page.evaluate(({ content, isTitle }) => {
    const panel = document.querySelector(content);
    const host = document.querySelector(isTitle ? ".renpy-title-view" : "[data-renpy-menu-frame]");
    const navigation = document.querySelector(isTitle ? ".renpy-title-navigation" : ".renpy-menu-navigation");
    const scale = Number(isTitle ? host?.dataset.renpyScale : host?.dataset.renpyMenuScale);
    const css = getComputedStyle(host);
    const rect = node => node.getBoundingClientRect().toJSON();
    const navStyle = getComputedStyle(navigation);
    return {
      scale, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      host: rect(host), panel: rect(panel), background: getComputedStyle(panel).backgroundColor,
      navigation: rect(navigation), font: parseFloat(getComputedStyle(navigation.querySelector("button")).fontSize),
      gap: parseFloat(navStyle.gap), navX: parseFloat(css.getPropertyValue("--renpy-nav-x")),
      navigationStyle: {
        configuredGap: css.getPropertyValue("--renpy-nav-gap").trim(),
        configuredX: css.getPropertyValue("--renpy-nav-x").trim(),
        transitionProperty: navStyle.transitionProperty,
        transitionDuration: navStyle.transitionDuration,
        animations: navigation.getAnimations().map(animation => ({
          property: animation.transitionProperty, playState: animation.playState,
          timing: animation.effect?.getComputedTiming(),
        })),
      },
      contentLeft: parseFloat(css.getPropertyValue("--renpy-content-left")),
      overflow: document.documentElement.scrollWidth - innerWidth,
      contentOverflow: panel.scrollWidth - panel.clientWidth,
      outlet: isTitle ? null : rect(host.querySelector("[data-testid='renpy-menu-content']")),
      title: isTitle ? null : rect(host.querySelector("[data-testid='renpy-menu-title']")),
      buttons: [...navigation.querySelectorAll("button")].map(button => {
        const bounds = rect(button);
        return { label: button.textContent, bounds,
          clipped: button.scrollWidth > button.clientWidth + 1,
          hit: button.disabled || button.contains(document.elementFromPoint(
            bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)) };
      }),
    };
  }, { content: definition.content, isTitle: definition.id === "title" });
  actual.settlement = settlement;
  assert.equal(actual.background, rgb(definition.color), `${definition.label}应消费导出的区域背景`);
  assert(Math.abs(actual.font / actual.scale - definition.font) < .1,
    `${definition.label}应消费本页字号：${JSON.stringify(actual)}`);
  assert(Math.abs(actual.gap / actual.scale - definition.spacing) < .1,
    `${definition.label}本页导航间距未消费：${JSON.stringify({ expected: definition.spacing, actual })}`);
  assert(Math.abs(actual.navX / actual.scale - 48) < .1, `${definition.label}应继承共享导航位置`);
  if (actual.outlet) {
    assert(Math.abs(actual.contentLeft / actual.scale - definition.left) < .1,
      `${definition.label}菜单内容边距未消费`);
    assert(actual.navigation.right <= actual.outlet.left + 1, "导航不能覆盖菜单正文");
    assert(actual.title.bottom <= actual.outlet.top + 1, "页面标题不能覆盖正文");
  }
  assert(actual.overflow <= 1 && actual.contentOverflow <= 1, "导出菜单不得横向溢出");
  for (const rect of [actual.panel, ...actual.buttons.map(button => button.bounds)]) {
    assert(rect.width > 0 && rect.height > 0 && rect.left >= actual.host.left - 1
      && rect.right <= actual.host.right + 1 && rect.top >= actual.host.top - 1
      && rect.bottom <= actual.host.bottom + 1, `${definition.label}区域或导航被裁切`);
  }
  assert(actual.buttons.every(button => !button.clipped && button.hit), "页面导航必须完整可见且可点击");
  for (let index = 1; index < actual.buttons.length; index++)
    assert(actual.buttons[index - 1].bounds.bottom <= actual.buttons[index].bounds.top + 1,
      "页面导航操作不得重叠");
  return actual;
}

async function runMenuPageExport({ page, browser, backendUrl, output, report, root, title,
  original, deviceScaleFactor, motionPreference, verifyGeometry }) {
  const readProfiles = async () => (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
    .data.project_metadata.settings.runtimeUILayoutProfiles;
  await page.getByRole("group", { name: "布局类型", exact: true })
    .getByRole("button", { name: "Ren'Py（进阶）", exact: true }).click();
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  const sidebar = page.locator(".renpy-title-editor .runtime-layout-sidebar");
  await sidebar.getByRole("spinbutton", { name: "共享导航左边距", exact: true }).fill("48");
  const authoring = [];
  for (const entry of pages) {
    await sidebar.getByRole("button", { name: entry.label, exact: true }).click();
    await page.locator(`.renpy-title-editor[data-editor-page="${entry.id}"]`).waitFor();
    const label = entry.id === "title" ? "标题页" : entry.label;
    for (const [property, value] of [["字号", entry.font], ["间距", entry.spacing]]) {
      await page.getByRole("button", { name: `覆盖${label}${property}`, exact: true }).click();
      await page.getByRole("spinbutton", { name: `${label}导航${property}`, exact: true }).fill(String(value));
    }
    if (entry.id !== "title") {
      const local = page.getByTestId("renpy-menu-frame-page");
      if (!await local.evaluate(node => node.open)) await local.locator("summary").click();
      await local.getByRole("button", { name: `覆盖${label}内容左边距`, exact: true }).click();
      await local.getByRole("spinbutton", { name: `${label}菜单内容左边距`, exact: true }).fill(String(entry.left));
    }
    await page.getByTestId("renpy-page-region-editor").locator(`[data-component-id="${entry.component}"]`).click();
    const styles = page.getByTestId("renpy-page-style-editor");
    await styles.getByLabel("页面背景色", { exact: true }).fill(entry.color);
    // The inherited field displays 1 but has no saved override. Exercise a
    // real change before returning to 1 rather than relying on a no-op fill.
    await styles.getByLabel("页面不透明度", { exact: true }).fill("0.9");
    await styles.getByLabel("页面不透明度", { exact: true }).fill("1");
    authoring.push({ page: entry.id, geometry: await verifyGeometry(page) });
  }
  await page.getByRole("button", { name: "保存布局", exact: true }).click();
  await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
  const saved = await readProfiles();
  assert.equal(saved.activeType, "renpy");
  assert.deepEqual(saved.profiles.agentvn, original, "菜单编辑不得污染另一种布局");
  for (const entry of pages) {
    assert.equal(saved.profiles.renpy.renpy[entry.id].fontSize, entry.font);
    assert.equal(saved.profiles.renpy.renpy[entry.id].spacing, entry.spacing);
    const component = saved.profiles.renpy.screens.find(screen => screen.screen_id === entry.id)
      .components.find(component => component.component_id === entry.component);
    assert.equal(component.style.backgroundColor, entry.color);
    assert.equal(component.style.opacity, 1);
  }
  report.cases.push({ case: "seven-menu-pages-real-authoring-save", authoring, status: "PASS" });
  console.log("PASS seven-menu-pages-real-authoring-save");

  await page.locator('[data-workspace-surface="edit"]:visible').click();
  const projectDownload = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: "保存工程", exact: true }).click();
  const downloadedProject = await projectDownload;
  const portablePath = path.join(output, downloadedProject.suggestedFilename());
  await downloadedProject.saveAs(portablePath);
  assert.equal(await downloadedProject.failure(), null);
  await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".project-home").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
  await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some(node => !node.disabled));
  await page.locator(".project-import-button input").first().setInputFiles(portablePath);
  await page.locator(".editor-toolbar").waitFor();
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
  assert.deepEqual(await readProfiles(), saved, "真实保存工程并重开必须保留七页覆盖和另一布局");
  report.cases.push({ case: "menu-page-portable-project-reopen", status: "PASS" });
  console.log("PASS menu-page-portable-project-reopen");

  await page.locator('[data-workspace-surface="publish"]:visible').click();
  const publishing = page.locator(".cartridge-export-panel");
  await publishing.waitFor({ state: "visible" });
  await publishing.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
  await publishing.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
  const warning = publishing.getByRole("checkbox", { name: /我已检查全部警告/ });
  if (await warning.count()) await warning.check();
  const cartridgeDownload = page.waitForEvent("download", { timeout: 60000 });
  await publishing.locator(".package-primary-action").click();
  const download = await cartridgeDownload;
  const cartridgePath = path.join(output, download.suggestedFilename());
  await download.saveAs(cartridgePath);
  assert.equal(await download.failure(), null);
  const archive = await JSZip.loadAsync(fs.readFileSync(cartridgePath));
  const layoutBytes = await archive.file("ui/layout.json").async("nodebuffer");
  const embedded = JSON.parse(layoutBytes.toString("utf8"));
  assert.equal(embedded.layout_type, "renpy");
  assert.deepEqual(embedded.renpy, saved.profiles.renpy.renpy, "卡带必须携带活动布局的七页参数");
  report.artifacts = [portablePath, cartridgePath].map(file => ({
    path: file, sha256: sha(fs.readFileSync(file)), bytes: fs.statSync(file).size,
    modifiedAt: fs.statSync(file).mtime.toISOString(), source: "real Editor UI download",
  }));
  report.layoutArtifact = { archive: cartridgePath, entry: "ui/layout.json", sha256: sha(layoutBytes) };
  console.log(`PASS menu-page-cartridge-export ${report.layoutArtifact.sha256}`);
  await publishing.getByRole("button", { name: "关闭发布与打包", exact: true }).click();

  let server, player;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      logFile: path.join(output, "menu-export-gamecli.log") });
    report.menuPlayerServer = { url: server.url, pid: server.pid, runId: server.runId };
    player = await browser.newPage({ viewport: { width: 1920, height: 1080 },
      deviceScaleFactor, reducedMotion: motionPreference });
    const errors = [];
    player.on("pageerror", error => errors.push(String(error)));
    player.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await server.run(async () => {
      await player.goto(`${server.url}?mode=library`);
      await player.getByTestId("game-state-library").waitFor();
      await player.getByTestId("web-cartridge-file").setInputFiles(cartridgePath);
      await player.locator(".cartridge-spine").filter({ hasText: title }).waitFor();
      await player.locator(".launch-panel").getByRole("button", { name: "启动卡带", exact: true }).click();
      await player.getByTestId("game-state-title").waitFor();
      await player.locator(".boot-overlay").waitFor({ state: "detached" });
      const motionModes = process.env.PROFILE_REDUCED_ONLY === "1"
        ? ["reduce"] : ["no-preference", "reduce"];
      for (const reducedMotion of motionModes) {
        await player.emulateMedia({ reducedMotion });
        for (const [width, height] of currentAcceptanceViewports()) {
          await player.setViewportSize({ width, height });
          await waitPage(player, "title");
          const matrix = [{ page: "title", geometry: await runtimeGeometry(player, pages[0]) }];
          await armTransition(player);
          await player.getByTestId("open-settings").click();
          await waitPage(player, "preferences");
          let transition = await finishTransition(player);
          for (const entry of pages.slice(1)) {
            if (entry.id !== "preferences") {
              await armTransition(player);
              await player.getByTestId(`renpy-menu-${entry.action}`).click();
              await waitPage(player, entry.scope);
              transition = await finishTransition(player);
            }
            matrix.push({ page: entry.id, geometry: await runtimeGeometry(player, entry), transition });
          }
          assert.equal(await player.getByTestId("gallery-item-menu-gallery").count(), 1,
            "同一卡带必须生成真实画廊条目，不能用空页面代测");
          await armTransition(player);
          await player.getByTestId("renpy-menu-return").click();
          await waitPage(player, "title");
          const returning = await finishTransition(player);
          assert(await player.getByTestId("game-state-title").evaluate(node => node.contains(document.activeElement)),
            "菜单返回后焦点必须属于标题页");
          if (width === 1920 && reducedMotion === "no-preference")
            await player.screenshot({ path: path.join(output, "exported-menu-title.png") });
          report.cases.push({ case: "exported-seven-menu-runtime-pages", width, height,
            dpr: deviceScaleFactor, reducedMotion, matrix, returning, status: "PASS" });
          console.log(`PASS exported-seven-menu-runtime-pages ${width}x${height} DPR${deviceScaleFactor} ${reducedMotion}`);
        }
      }
      assert.deepEqual(errors, [], "导出的菜单卡带运行不得产生浏览器错误");
    });
  } catch (error) {
    await player?.screenshot({ path: path.join(output, "menu-export-player-failure.png") }).catch(() => {});
    report.menuPlayerFailure = await player?.evaluate(() => ({
      text: document.body.innerText.slice(0, 6000),
      transition: document.querySelector("[data-runtime-transition-phase]")?.outerHTML.slice(0, 1500),
      frames: window.__menuExportFrames,
      settledNavigation: (() => {
        const host = document.querySelector(".renpy-title-view");
        const navigation = document.querySelector(".renpy-title-navigation");
        if (!host || !navigation) return null;
        const css = getComputedStyle(navigation);
        return { scale: Number(host.dataset.renpyScale),
          configuredGap: host.style.getPropertyValue("--renpy-nav-gap"),
          gap: css.gap, rect: navigation.getBoundingClientRect().toJSON(),
          transitionProperty: css.transitionProperty, transitionDuration: css.transitionDuration,
          animations: navigation.getAnimations().map(animation => ({
            property: animation.transitionProperty, playState: animation.playState,
          })) };
      })(),
    })).catch(() => null);
    throw error;
  } finally {
    await player?.close();
    await server?.stop();
  }
}
module.exports = { runMenuPageExport };
