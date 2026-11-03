"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, "..");
const output = path.join(process.env.AGENTVN_WORKSPACE_OUTPUT
  || "F:/AgentVN/QA/Renpy-Page-Crossfade", "renpy-page-crossfade",
  new Date().toISOString().replace(/[:.]/g, "-"));
const compiled = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(compiled, compiled.exports);
const report = { status: "RUNNING", headless: process.env.RENPY_FADE_HEADFUL !== "1", cases: [] };
function fixture(renpy) {
  const id = "renpy-page-crossfade";
  return {
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.9.0",
      game_id: id, title: "页面交接验收", author: "QA", version: "1.0.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [{
        asset_id: "gallery-art", asset_type: "ui", path: "assets/gallery.svg",
        filename: "gallery.svg", mime_type: "image/svg+xml", size_bytes: 100, preload: false,
      }],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    script: { schema_version: "1.1.0", game_id: id, title: "页面交接验收", entry_scene_id: "main",
      characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
        commands: [{ type: "gallery_anchor", anchor_id: "gallery-entry", title: "测试画廊",
          asset_id: "gallery-art", description: "真实画廊导航验收。" },
        { type: "narration", text: "进入和离开剧情保留黑场。" }] }] },
    uiSkin: renpy ? compiled.exports.createRenpyUILayout() : undefined,
    assetUrls: { "gallery-art": "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#16303a"/></svg>') },
  };
}
async function idle(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-transition-phase]")
    ?.getAttribute("data-runtime-transition-phase") === "idle");
}
async function capture(page, action, target) {
  await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="renpy-menu-navigation"]');
    window.__pageFade = { frames: [], rail, rect: rail?.getBoundingClientRect().toJSON(), done: false };
    const sample = () => {
      const owner = document.querySelector("[data-runtime-transition-phase]");
      const functionalLayer = owner?.querySelector(".runtime-screen-transition-current");
      const surface = functionalLayer?.getAnimations().length
        ? functionalLayer : owner?.querySelector("[data-runtime-motion-surface]") ?? functionalLayer;
      const snapshot = owner?.querySelector("[data-runtime-transition-snapshot]");
      const activeRail = document.querySelector('[data-testid="renpy-menu-navigation"]');
      const titleLayer = owner?.querySelector(".runtime-screen-transition-current");
      const titles = [...(titleLayer?.querySelectorAll(
        '[data-testid="renpy-menu-title"], .about-card .about-page-title') ?? [])]
        .filter(node => !node.closest("[data-runtime-transition-snapshot]"));
      const title = titles?.[0];
      const oldTitle = snapshot?.querySelector(".renpy-menu-title, .about-card .about-page-title");
      const renderedOpacity = node => {
        let opacity = node ? 1 : 0;
        while (node && node !== owner) {
          opacity *= Number(getComputedStyle(node).opacity);
          node = node.parentElement;
        }
        return opacity;
      };
      window.__pageFade.frames.push({ at: performance.now(),
        visibility: document.visibilityState,
        phase: owner?.getAttribute("data-runtime-transition-phase"),
        style: owner?.getAttribute("data-runtime-transition-style"),
        duration: Number(owner?.getAttribute("data-runtime-transition-duration")),
        screen: owner?.getAttribute("data-runtime-presented-screen"),
        black: owner ? Number(getComputedStyle(owner, "::before").opacity) : 0,
        launchBlack: Number(getComputedStyle(document.querySelector(".game-launch-blackout") ?? document.body).opacity),
        hasLaunchBlack: !!document.querySelector(".game-launch-blackout"),
        opacity: surface ? Number(getComputedStyle(surface).opacity) : 1,
        snapshotOpacity: snapshot ? Number(getComputedStyle(snapshot).opacity) : 0,
        snapshotInert: snapshot?.inert,
        snapshotHidden: snapshot?.getAttribute("aria-hidden"),
        focusedSnapshot: !!snapshot?.contains(document.activeElement),
        functionalLayers: owner?.querySelectorAll(".runtime-screen-transition-current").length,
        snapshotCount: owner?.querySelectorAll("[data-runtime-transition-snapshot]").length,
        surfaceRect: surface?.getBoundingClientRect().toJSON(),
        snapshotRect: snapshot?.getBoundingClientRect().toJSON(),
        railSame: activeRail === window.__pageFade.rail,
        railRect: activeRail?.getBoundingClientRect().toJSON(),
        titleText: title?.textContent, titleOpacity: renderedOpacity(title),
        titleCount: titles?.length ?? 0, titleInsideAbout: Boolean(title?.closest(".about-card")),
        titleInSurface: Boolean(surface?.contains(title)),
        oldTitleText: oldTitle?.textContent, oldTitleOpacity: renderedOpacity(oldTitle),
        overflow: document.documentElement.scrollWidth - innerWidth });
      if (!window.__pageFade.done) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await action();
  const scope = target === "title_menu" || target === "main_menu" ? "title" : target;
  await page.locator(`.runtime-screen-transition-current [data-ui-screen="${scope}"]`).waitFor();
  await idle(page);
  if (target === "player") await page.waitForSelector(".game-launch-blackout", {state: "detached", timeout: 30000});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => { window.__pageFade.done = true; return window.__pageFade; });
}
function assertContentFade(trace, duration) {
  assert(trace.frames.every(frame => frame.black < .01 && !frame.hasLaunchBlack),
    "非剧情页不得出现黑场");
  const fade = trace.frames.filter(frame => frame.phase === "crossfading");
  assert(fade.length > 2 && fade.every(frame => frame.style === "crossfade"
    && frame.duration === duration), "必须完整复用黑场总时长且具备实际中间帧");
  assert(fade.some(frame => frame.opacity > .1 && frame.opacity < .9
    && frame.snapshotOpacity > .1), "画面应交叠淡入淡出");
  assert(fade.every(frame => frame.snapshotInert && frame.snapshotHidden === "true"
    && !frame.focusedSnapshot && frame.functionalLayers === 1 && frame.snapshotCount === 1
    && frame.overflow <= 1), "离场层不可交互且只有一个功能页和一个快照");
  assert(fade.every(frame => frame.opacity + frame.snapshotOpacity >= .99),
    "淡入淡出不能产生无画面空帧");
  const end = trace.frames.find(frame => frame.at > fade[0].at && frame.phase === "idle");
  assert(end && end.at-fade[0].at >= duration-100, "视觉动画不能被提前截断");
}
(async () => {
  fs.mkdirSync(output, {recursive: true});
  let server, browser, page;
  try {
    server = await startOwnedViteServer({root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 0,
      logFile: path.join(output, "server.log")});
    report.service = {pid: server.pid, runId: server.runId, url: server.url};
    browser = await chromium.launch({headless: report.headless, args: [
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows", "--disable-features=CalculateNativeWinOcclusion",
    ]});
    const sizes = process.env.RENPY_FADE_FAST === "1" ? [[1920,1080]] : [[1920,1080],[2560,1440],[3840,2160]];
    for (const [width,height] of sizes) for (const dpr of process.env.RENPY_FADE_FAST === "1" ? [1] : [1,2])
      for (const reduced of process.env.RENPY_FADE_FAST === "1" ? [false] : [false,true]) {
        page = await browser.newPage({viewport: {width,height}, deviceScaleFactor: dpr,
          reducedMotion: reduced ? "reduce" : "no-preference"});
        await page.bringToFront();
        const errors = [];
        page.on("pageerror", error => errors.push(String(error)));
        await page.goto(`${server.url}/?mode=preview`);
        await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
        await page.evaluate(payload => window.postMessage({
          type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "page-fade",
          revision: 1, requestId: "init", runId: "init", screen: "title_menu", ...payload,
        }, "*"), fixture(true));
        await page.getByTestId("game-state-title").waitFor(); await idle(page);
        const entry = await capture(page, () => page.getByTestId("open-settings").click(), "preferences");
        report.cases.push({name: "title-menu-full-frame-crossfade",width,height,dpr,reduced,
          trace:entry,status:"CHECKING"});
        const entryFade = entry.frames.filter(frame => frame.phase === "crossfading");
        const duration = reduced ? 816 : 1632;
        assertContentFade(entry,duration);
        assert(entryFade.length > 2 && entryFade.every(frame => frame.black < .01 && !frame.hasLaunchBlack));
        assert(entryFade.every(frame => frame.snapshotInert && frame.snapshotRect.x <= 1
          && frame.snapshotRect.y <= 1 && Math.abs(frame.snapshotRect.width-width) <= 1
          && Math.abs(frame.snapshotRect.height-height) <= 1),
        "标题与共享菜单互切必须保留完整旧画面，不能把标题快照压缩进内容栏");
        assert(entryFade.every(frame => frame.surfaceRect.x <= 1
          && Math.abs(frame.surfaceRect.width-width) <= 1),
        "不同页面框架互切应过渡完整画面");
        report.cases.at(-1).status="PASS";
        const trace = await capture(page, () => page.getByTestId("renpy-menu-about").click(), "about");
        report.cases.push({name: "menu-crossfade", width,height,dpr,reduced,trace,status:"CHECKING"});
        assert(trace.frames.every(frame => frame.black < .01 && !frame.hasLaunchBlack),
          "Renpy非剧情页面互切不得出现黑色遮幕");
        const fade = trace.frames.filter(frame => frame.phase === "crossfading");
        assert(fade.length > 2 && fade.every(frame => frame.style === "crossfade" && frame.duration === duration),
          "淡入淡出必须统一黑场完整时长且有真实中间帧");
        assert(fade.some(frame => frame.opacity > .1 && frame.opacity < .9 && frame.snapshotOpacity > .1),
          "旧画面与新画面必须连续交叠，而非秒切");
        assert(fade.some(frame => frame.titleText === "关于" && frame.oldTitleText === "设置"
          && frame.titleCount === 1 && frame.titleInsideAbout && frame.titleInSurface
          && frame.titleOpacity > .1 && frame.titleOpacity < .9 && frame.oldTitleOpacity > .1),
          "关于的唯一标题须位于内容容器中，并与正文同层淡入淡出");
        assert(fade.every(frame => frame.snapshotInert && frame.railSame && frame.overflow <= 1),
          "离场层必须inert，导航不重建且不溢出");
        for (const frame of fade) for (const key of ["x","y","width","height"])
          assert(Math.abs(frame.railRect[key] - trace.rect[key]) <= 1, `导航${key}变化`);
        assert.equal(await page.locator("[data-runtime-transition-snapshot]").count(), 0, "终态不得残留旧层");
        assert(await page.getByTestId("renpy-menu-help").evaluate(button => {
          const r = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
        }), "真实导航必须可点击");
        report.cases.at(-1).status = "PASS";
        const paths = [];
        for (const [testId,target] of [
          ["renpy-menu-help","help"],["renpy-menu-history","history"],
          ["renpy-menu-save-load","save_load"],["renpy-menu-gallery","gallery"],
          ["renpy-menu-settings","preferences"],
        ]) {
          const next = await capture(page, () => page.getByTestId(testId).click(), target);
          paths.push({testId,target,trace:next});
          try {
            assertContentFade(next,duration);
            if (target === "help") assert(next.frames.some(frame => frame.phase === "crossfading"
              && frame.oldTitleText === "关于" && frame.titleText === "帮助"
              && frame.titleCount === 1 && frame.titleInSurface
              && frame.oldTitleOpacity > .1 && frame.titleOpacity > .1 && frame.titleOpacity < .9),
            "离开关于时，容器内旧标题与新页面标题须连续交接");
          } catch (error) {
            report.cases.push({name:`menu-page-fade-failed-${target}`,width,height,dpr,reduced,
              trace:next,status:"FAILED",error:String(error.stack || error)});
            throw error;
          }
          const fading = next.frames.filter(frame => frame.phase === "crossfading");
          assert(fading.every(frame => frame.railSame),"菜单子页导航不得重建");
          for (const frame of fading) for (const key of ["x","y","width","height"])
            assert(Math.abs(frame.railRect[key]-next.rect[key]) <= 1,`子页导航${key}变化`);
        }
        report.cases.push({name:"all-menu-pages-crossfade",width,height,dpr,reduced,
          paths,status:"PASS"});
        const interruption = await capture(page, async () => {
          await page.getByTestId("renpy-menu-about").click();
          await page.waitForFunction(() => {
            const surface = document.querySelector("[data-runtime-motion-surface]");
            return document.querySelector("[data-runtime-transition-phase]")
              ?.getAttribute("data-runtime-transition-phase") === "crossfading"
              && Number(getComputedStyle(surface).opacity) > .15
              && Number(getComputedStyle(surface).opacity) < .8;
          });
          await page.getByTestId("renpy-menu-settings").click();
          await page.getByTestId("renpy-menu-help").click();
        }, "help");
        assert(interruption.frames.every(frame => frame.black < .01 && !frame.hasLaunchBlack));
        assert(interruption.frames.filter(frame => frame.phase === "crossfading")
          .every(frame => frame.functionalLayers === 1 && frame.snapshotCount === 1
            && frame.snapshotInert && !frame.focusedSnapshot && frame.railSame),
        "反向/重定向不能残留功能页、抢回焦点或重建导航");
        assert.equal(await page.locator("[data-runtime-transition-snapshot]").count(),0);
        assert(await page.getByTestId("renpy-menu-help").evaluate(button => button === document.activeElement),
          "最终用户点击的导航应保有焦点");
        report.cases.push({name:"reverse-and-redirect",width,height,dpr,reduced,
          trace:interruption,status:"PASS"});
        const frameRedirect = await capture(page, async () => {
          await page.getByTestId("renpy-menu-return").click();
          await page.waitForFunction(() => {
            const owner=document.querySelector("[data-runtime-transition-phase]");
            const layer=owner?.querySelector(".runtime-screen-transition-current");
            const opacity=layer ? Number(getComputedStyle(layer).opacity) : 1;
            return owner?.getAttribute("data-runtime-transition-phase")==="crossfading"
              && owner.getAttribute("data-runtime-presented-screen")==="title_menu"
              && opacity>.15 && opacity<.8;
          });
          await page.getByTestId("open-settings").click();
        },"preferences");
        assert(frameRedirect.frames.every(frame=>frame.black<.01 && !frame.hasLaunchBlack));
        assert(frameRedirect.frames.filter(frame=>frame.phase==="crossfading")
          .every(frame=>frame.functionalLayers===1 && frame.snapshotCount===1
            && frame.snapshotInert && !frame.focusedSnapshot && frame.overflow<=1),
        "跨框架反向须保持单一功能页/呈现快照及正确输入归属");
        assert.equal(await page.locator("[data-runtime-transition-snapshot]").count(),0);
        assert(await page.getByTestId("renpy-menu-navigation").evaluate(nav=>nav.contains(document.activeElement)),
          "跨框架重定向后焦点必须属于当前菜单");
        report.cases.push({name:"full-frame-interrupted-reversal",width,height,dpr,reduced,
          trace:frameRedirect,status:"PASS"});
        const returning = await capture(page, () => page.getByTestId("renpy-menu-return").click(), "title_menu");
        assertContentFade(returning,duration);
        assert(returning.frames.filter(frame => frame.phase === "crossfading").every(frame =>
          frame.snapshotRect.x <= 1 && Math.abs(frame.snapshotRect.width-width) <= 1),
        "返回标题页应过渡完整画面");
        assert(await page.getByTestId("renpy-title-view").evaluate(view => view.contains(document.activeElement)),
          "框架替换后焦点必须进入标题页");
        report.cases.push({name:"menu-title-full-frame-crossfade",width,height,dpr,reduced,
          trace:returning,status:"PASS"});
        const launch = await capture(page, () => page.getByTestId("start-new-game").click(), "player");
        assert(launch.frames.some(frame => frame.hasLaunchBlack && frame.launchBlack > .95),
          "进入剧情必须保留完整黑场");
        report.cases.push({name:"gameplay-keeps-blackout",width,height,dpr,reduced,trace:launch,status:"PASS"});
        const leaving = await capture(page, () => page.keyboard.press("Escape"), "main_menu");
        assert(leaving.frames.some(frame => frame.black >= .99 && frame.style === "blackout"),
          "离开剧情必须保留全局黑场");
        assert(leaving.frames.some(frame => frame.phase === "revealing" && frame.black > .05 && frame.black < .95),
          "离开剧情后应有真实黑场揭幕");
        report.cases.push({name:"leaving-gameplay-keeps-blackout",width,height,dpr,reduced,
          trace:leaving,status:"PASS"});
        await page.screenshot({path:path.join(output,`${width}x${height}-dpr${dpr}-${reduced?"reduced":"normal"}.png`)});
        assert.deepEqual(errors, []);
        await page.close(); page = undefined;
      }
    assert.equal(report.cases.length,process.env.RENPY_FADE_FAST === "1" ? 8 : 96);
    assert(report.cases.every(row => row.status === "PASS"));
    report.status = "PASS";
  } catch (error) {
    report.status="FAILED"; report.error=String(error.stack||error);
    await page?.screenshot({path:path.join(output,"failure.png")}).catch(()=>{});
    process.exitCode=1;
  } finally {
    await browser?.close(); await server?.stop();
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(`Evidence: ${output}`);
    console.log(report.status, report.error ?? "");
  }
})().catch(error=>{console.error(error);process.exitCode=1});
