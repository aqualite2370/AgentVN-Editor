"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");
const { createHash } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const native = process.env.RENPY_FRAME_NATIVE === "1";
const output = path.join(native ? "F:/AgentVN/QA/Native-Runtime-State-20261020-01"
  : "F:/AgentVN/QA/Runtime-Renpy-Menu-Frame-20261028-01",
  ...(native ? ["renpy-navigation-" + new Date().toISOString().replace(/[:.]/g, "-")]
    : [new Date().toISOString().replace(/[:.]/g, "-")]));
const fast = process.env.RENPY_FRAME_FAST === "1";
if (native) assert(fast, "Native supplement uses the explicit 1080p DPR1 six-variant smoke; browser matrix remains separate");
const sizes = currentAcceptanceViewports(fast ? [[1920, 1080]] : undefined);
const compiled = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(compiled, compiled.exports);
const defaults = { menuNavigationWidth: 280, menuTopPadding: 120, menuBottomPadding: 30,
  menuContentLeft: 40, menuContentRight: 20, menuContentTop: 10, menuTitleX: 50, menuTitleFontSize: 50 };
const custom = { menuNavigationWidth: 310, menuTopPadding: 140, menuBottomPadding: 40,
  menuContentLeft: 32, menuContentRight: 24, menuContentTop: 12, menuTitleX: 56, menuTitleFontSize: 44 };
const report = { status: "RUNNING", scope: native
  ? "CURRENT_NATIVE_PREVIEW_PLAYER_NOT_RELEASE_INSTALLATION_OR_ANDROID"
  : "E4 shared Ren'Py menu frame, not installed acceptance",
  startedAt: new Date().toISOString(),
  reference: "official template 8.5.3.26051504, 1280x720; default title/rail/margins and independent bottom return",
  cases: [] };
const variants = ["default", "custom", "large-role", "appearance", "image", "code"];
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
report.sources = ["GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/uiSkin/PresentedControl.tsx"].map(file => ({ path: file, sha256: sha(path.join(root, file)) }));
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
function fixture(variant) {
  const uiSkin = compiled.exports.createRenpyUILayout();
  if (variant !== "default") {
    uiSkin.renpy = { shared: { ...custom },
      about: { menuContentLeft: 48, menuTitleFontSize: 46 } };
    if (variant === "large-role") uiSkin.renpy.shared.buttonRoles = { page_navigation: {
      geometry: { width: 360, height: 50, fontSize: 24 },
      states: { normal: { backgroundColor: "#304050", textColor: "#e0efff" } },
    } };
  }
  if (["appearance", "image", "code"].includes(variant)) {
    const nav = uiSkin.screens.find(s => s.screen_id === "game_menu").components
      .find(c => c.component_type === "game_menu_nav");
    // This legacy free-layout rectangle must not replace the structured rail.
    nav.rect = { x: 85, y: 85, width: 10, height: 10, anchor: "bottom_right" };
    nav.style = { backgroundColor: "#363f5e", borderRadius: 4, shadow: "none" };
    const aboutNav = { ...structuredClone(nav), component_id: "about_navigation",
      style: { ...nav.style, backgroundColor: "#29485f" } };
    uiSkin.screens.find(s => s.screen_id === "about").components.push(aboutNav);
    if (variant === "image") {
      nav.style.backgroundImage = "asset:gallery-art"; nav.style.backgroundFit = "contain";
      aboutNav.style.backgroundImage = "asset:gallery-art"; aboutNav.style.backgroundFit = "stretch";
    }
    if (variant === "code") {
      uiSkin.advancedPresentationEnabled = true;
      nav.presentation = { version: 1, html: '<div class="root"><slot name="content"></slot></div>',
        css: ".root { background-color: #25472e; border-radius: 5px; }" };
      aboutNav.stateStyles = { normal: { backgroundColor: "#3b2962" } };
    }
  }
  return { uiSkin,
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.14.0",
      game_id: `menu-frame-${variant}`, title: "菜单框架小卡带", author: "QA", version: "1.0.0",
      language: "zh-CN", entry_script: "script.json", entry_scene_id: "main",
      assets: [{ asset_id: "gallery-art", asset_type: "ui", path: "assets/gallery.svg",
        filename: "gallery.svg", mime_type: "image/svg+xml", size_bytes: 120, preload: false }] },
    script: { schema_version: "1.1.0", game_id: `menu-frame-${variant}`, title: "菜单框架小卡带",
      entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "临时场景",
        chapter: 1, tags: [], commands: [{ type: "gallery_anchor", anchor_id: "gallery",
          title: "验收画廊", asset_id: "gallery-art" },
        { type: "narration", text: "菜单框架独立回归。" }] }] },
    assetUrls: { "gallery-art": "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#304050"/></svg>') },
  };
}
async function idle(page, expectedScreen) {
  await page.waitForFunction(expected => {
    const owner = document.querySelector("[data-runtime-transition-phase]");
    return owner?.getAttribute("data-runtime-transition-phase") === "idle"
      && owner.getAttribute("data-runtime-presented-screen") === expected
      && owner.getAttribute("data-runtime-committed-screen") === expected
      && !document.querySelector("[data-runtime-transition-snapshot]");
  }, expectedScreen);
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a =>
      a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  });
}
async function readFrame(page) {
  return page.locator("[data-renpy-menu-frame]").evaluate(frame => {
    const rect = node => node?.getBoundingClientRect().toJSON();
    const sharedTitle = frame.querySelector("[data-testid='renpy-menu-title']");
    const title = sharedTitle ?? frame.querySelector(".about-card .about-page-title");
    const nav = frame.querySelector("[data-testid='renpy-menu-navigation']");
    const returning = frame.querySelector("[data-testid='renpy-menu-return']");
    const outlet = frame.querySelector("[data-testid='renpy-menu-content']");
    const css = getComputedStyle(frame);
    const buttons = [...frame.querySelectorAll(".renpy-menu-navigation-action")].map(node => {
      const r = node.getBoundingClientRect();
      return { text: node.textContent, r: r.toJSON(), hit: node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
        clipped: node.scrollWidth > node.clientWidth+1 || node.scrollHeight > node.clientHeight+1 };
    });
    return { frame: rect(frame), title: rect(title), titleText: title?.textContent,
      titleFont: title ? parseFloat(getComputedStyle(title).fontSize) : null,
      titleInsideAbout: Boolean(title?.closest(".about-card")),
      sharedTitleCount: frame.querySelectorAll("[data-testid='renpy-menu-title']").length,
      returnPlacement: returning?.closest("[data-return-placement]")?.dataset.returnPlacement,
      nav: rect(nav), return: rect(returning), returnInNav: !!nav?.contains(returning),
      material: nav ? { background: getComputedStyle(nav).backgroundColor,
        image: getComputedStyle(nav).backgroundImage, fit: getComputedStyle(nav).backgroundSize,
        opacity: getComputedStyle(nav).opacity, radius: getComputedStyle(nav).borderRadius,
        component: nav.dataset.uiComponentId, slot: nav.dataset.controlSlotCount,
        navCount: frame.querySelectorAll(".renpy-menu-navigation").length,
        codeCount: nav.querySelectorAll("[data-control-node]").length } : null,
      outlet: rect(outlet), scale: Number(frame.dataset.renpyMenuScale),
      telemetry: { inline: frame.getAttribute("style"),
        variables: Object.fromEntries(["--renpy-menu-scale", "--renpy-menu-title-x",
          "--renpy-menu-title-font", "--renpy-menu-top", "--renpy-menu-rail", "--renpy-nav-font"]
          .map(key => [key, css.getPropertyValue(key)])),
        titleVariables: title ? Object.fromEntries(["--renpy-menu-title-x", "--renpy-menu-title-font"]
          .map(key => [key, getComputedStyle(title).getPropertyValue(key)])) : null,
        snapshot: Boolean(frame.closest("[data-runtime-transition-snapshot]")),
        frameCount: document.querySelectorAll("[data-renpy-menu-frame]").length,
        transition: document.querySelector("[data-runtime-transition-phase]")?.getAttribute("data-runtime-transition-phase") },
      safe: { left: parseFloat(css.paddingLeft), right: parseFloat(css.paddingRight),
        top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom) },
      buttons, duplicateTitles: [...frame.querySelectorAll(".renpy-menu-content > header h2")]
        .filter(node => node.getClientRects().length > 0).length,
      overflow: document.documentElement.scrollWidth-innerWidth };
  });
}
async function validateAppearance(page, row, variant, scope) {
  if (!["appearance", "image", "code"].includes(variant)) return;
  const m = row.material;
  assert.equal(m.navCount, 1, "A material cannot create a second navigation/controller");
  assert.equal(m.component, scope === "about" ? "about_navigation" : "game_menu_nav");
  if (variant === "code") {
    assert.equal(m.background, scope === "about" ? "rgb(59, 41, 98)" : "rgb(37, 71, 46)",
      "Safe code and normal state keep their explicit priority over graphical base styles");
    assert.equal(m.slot, scope === "about" ? undefined : "1");
  } else {
    assert.equal(m.background, scope === "about" ? "rgba(41, 72, 95, 0.78)" : "rgba(54, 63, 94, 0.78)",
      "Saved navigation background must appear on the actual shared/page-specific rail");
    assert.equal(m.opacity, "1");
  }
  if (variant === "image") {
    assert.match(m.image, /^url\("data:image\/svg\+xml,/);
    assert.equal(m.fit, scope === "about" ? "100% 100%" : "contain");
    const image = await page.locator(".renpy-menu-navigation").evaluate(async node => {
      const source = getComputedStyle(node).backgroundImage.slice(5, -2);
      const image = new Image(); image.src = source;
      await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight };
    });
    assert.deepEqual(image, { width: 64, height: 32 });
  }
}
function validateFrame(row, expected, label, largeRole) {
  const { frame: f, safe, scale: s } = row;
  const close = (actual, target, reason) => assert(Math.abs(actual-target) <= 1.1,
    `${reason}: actual=${actual}, expected=${target}, scale=${s}`);
  assert(row.title, "菜单缺少可见标题");
  assert.equal(row.titleText, label);
  assert.equal(row.returnInNav, false, "返回必须独立于居中导航");
  if (label === "关于") {
    assert(row.titleInsideAbout && row.sharedTitleCount === 0, "关于标题须在内容容器内且不重复");
    assert(row.title.x >= row.outlet.x && row.title.right <= row.outlet.right
      && row.title.y >= row.outlet.y && row.title.bottom <= row.outlet.bottom, "关于标题须完整落在内容容器内");
  } else {
    assert(!row.titleInsideAbout && row.sharedTitleCount === 1);
    close(row.title.x, f.x+safe.left+expected.menuTitleX*s, "标题左边距");
    close(row.titleFont, expected.menuTitleFontSize*s, "标题字体");
  }
  close(row.outlet.y, f.y+safe.top+(expected.menuTopPadding+expected.menuContentTop)*s, "内容顶部留白");
  close(row.outlet.right, f.right-safe.right-expected.menuContentRight*s, "内容右边距");
  close(row.outlet.bottom, f.bottom-safe.bottom-expected.menuBottomPadding*s, "内容底部留白");
  close(row.return.x, f.x+safe.left+40*s, "返回与导航共享左锚点");
  assert.equal(row.returnPlacement, label === "设置" ? "bottom" : "top");
  if (label === "设置") close(row.return.bottom, f.bottom-safe.bottom-expected.menuBottomPadding*s, "设置底部返回");
  else close(row.return.top, f.top+safe.top, "其它页面左上返回");
  if (!largeRole) close(row.outlet.x, f.x+safe.left+(expected.menuNavigationWidth+expected.menuContentLeft)*s, "导航预留轨道");
  else assert(row.outlet.x > row.nav.right, "显式宽按钮不能侵入内容轨道");
  assert.equal(row.duplicateTitles, 0, "共享标题不能与旧页标题重复展示");
  assert(row.overflow <= 1, "菜单横向溢出");
  for (const node of [row.title, row.nav, row.return, row.outlet, ...row.buttons.map(b=>b.r)]) {
    assert(node.width > 0 && node.height > 0 && node.x >= f.x-1 && node.y >= f.y-1
      && node.right <= f.right+1 && node.bottom <= f.bottom+1, `元素越界: ${JSON.stringify(node)}`);
  }
  for (const button of row.buttons) assert(button.hit && !button.clipped, `按钮裁切或不可点击: ${button.text}`);
  if (label !== "关于") assert(row.title.bottom <= row.outlet.y+1, "标题与内容重叠");
  if (label === "设置") assert(row.nav.bottom < row.return.y, "居中导航与底部返回重叠");
  else assert(row.return.bottom <= row.nav.y, "左上返回与居中导航重叠");
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(__filename, path.join(output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  let server, browser, page, nativePage, nativeCdp, nativeChild, nativeIdentity, profileAttempted = false;
  const owned = new Map();
  const ownership = native ? require("./lib/current-native-editor-session.cjs") : undefined;
  const tree = native ? require("./lib/owned-process-tree.cjs").ownedProcessTree : undefined;
  function rememberNative() {
    if (!nativeChild) return;
    for (const p of tree(ownership.rows(), nativeChild.pid, nativeIdentity?.Created))
      owned.set(`${p.ProcessId}:${p.Created}`, p);
  }
  function profiles(action) {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action,
      "-RunDirectory", output, ...(process.argv.includes("--codex-cache-view") ? ["-CodexCacheView"] : [])],
    { cwd: root, windowsHide: true, encoding: "utf8", timeout: 120000 });
    assert.equal(result.status, 0, `${action}: ${result.stdout}\n${result.stderr}`);
  }
  try {
    if (native) {
      const exe = path.join(root, "editor/src-tauri/binaries/agentvn-player.exe");
      report.executable = { path: exe, sha256: sha(exe), modifiedAt: fs.statSync(exe).mtime.toISOString() };
      profileAttempted = true; profiles("Prepare");
      const port = await new Promise((resolve, reject) => {
        const probe = require("node:net").createServer(); probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => { const port = probe.address().port;
          probe.close(error => error ? reject(error) : resolve(port)); });
      });
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(key)) delete env[key];
      Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(output, "webview"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` });
      const fd = fs.openSync(path.join(output, "player.log"), "wx");
      try { nativeChild = spawn(exe, ["--mode", "preview"], { cwd: path.dirname(exe),
        env, windowsHide: true, stdio: ["ignore", fd, fd] }); }
      finally { fs.closeSync(fd); }
      nativeChild.on("error", error => { report.launchError = String(error); });
      nativeIdentity = ownership.rows().find(p => p.ProcessId === nativeChild.pid); assert(nativeIdentity);
      assert.equal(path.resolve(nativeIdentity.ExecutablePath).toLowerCase(), exe.toLowerCase());
      report.service = { pid: nativeChild.pid, port, identity: nativeIdentity }; rememberNative(); save();
      await ownership.until(async () => {
        assert(!report.launchError, report.launchError); assert.equal(nativeChild.exitCode, null);
        try { return (await fetch(`http://127.0.0.1:${port}/json/version`,
          { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
      }, "owned native preview CDP");
      rememberNative();
      assert(ownership.listeners([port]).every(l => [...owned.values()].some(p => p.ProcessId === l.OwningProcess)));
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      nativePage = await ownership.until(() => browser.contexts().flatMap(c => c.pages())
        .find(p => p.url().startsWith("http://tauri.localhost")), "native Runtime document");
      nativeCdp = await nativePage.context().newCDPSession(nativePage);
    } else {
      server = await startOwnedViteServer({ root: path.join(root,"GameCli_framework"),
        configFile: path.join(root,"GameCli_framework/vite.config.cjs"), port:0, logFile:path.join(output,"server.log") });
      report.service = { pid:server.pid, url:server.url, runId:server.runId };
      browser = await chromium.launch({ headless: process.env.RENPY_FRAME_HEADFUL !== "1" });
    }
    for (const [width,height] of sizes) for (const dpr of fast ? [1] : [1,2])
      for (const reduced of process.env.RENPY_FRAME_REDUCED_ONLY === "1" ? [true] : fast ? [false] : [false,true])
        for (const variant of variants) {
          const execute = async () => {
          if (native) {
            page = nativePage; await page.reload();
            await nativeCdp.send("Emulation.setDeviceMetricsOverride",
              { width, height, deviceScaleFactor: dpr, mobile: false });
            await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
          } else page = await browser.newPage({ viewport:{width,height}, deviceScaleFactor:dpr,
              reducedMotion:reduced ? "reduce" : "no-preference" });
          const metrics = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
          assert.deepEqual(await metrics(), { width, height, dpr, reduced });
          const errors=[]; page.on("pageerror", error=>errors.push(String(error)));
          if (!native) await page.goto(`${server.url}/?mode=preview`);
          await page.waitForFunction(()=>document.querySelector("#root")?.childElementCount);
          await page.evaluate(payload=>window.postMessage({ type:"agentvn.live-preview.init",protocolVersion:2,
            sessionId:"menu-frame",revision:1,requestId:"init",runId:"init",screen:"title_menu",...payload },"*"),fixture(variant));
          await page.getByTestId("open-settings").waitFor(); await idle(page, "title_menu");
          await page.getByTestId("open-settings").click(); await idle(page, "settings");
          const settings = await readFrame(page);
          report.cases.push({width,height,dpr,reduced,variant,screen:"settings",geometry:settings,status:"CHECKING"});
          validateFrame(settings,variant==="default" ? defaults:custom,"设置",variant==="large-role");
          await validateAppearance(page, settings, variant, "settings");
          report.cases.at(-1).status="PASS";
          save();
          for (const [testId,label,scope] of [["renpy-menu-about","关于","about"],
            ["renpy-menu-help","帮助","help"],["renpy-menu-history","历史","history"],
            ["renpy-menu-save-load","存档 / 读档","save_load"],["renpy-menu-gallery","画廊","gallery"]]) {
            await page.getByTestId(testId).click(); await idle(page, scope);
            const geometry=await readFrame(page);
            const expected=variant==="default" ? defaults
              : {...custom,...(scope==="about" ? {menuContentLeft:48,menuTitleFontSize:46}:{})};
            report.cases.push({width,height,dpr,reduced,variant,screen:scope,geometry,status:"CHECKING"});
            validateFrame(geometry,expected,label,variant==="large-role");
            await validateAppearance(page, geometry, variant, scope);
            report.cases.at(-1).status="PASS";
            save();
          }
          const before = await metrics();
          const file = path.join(output,`${width}x${height}-dpr${dpr}-${reduced?"reduced":"normal"}-${variant}.png`);
          const capture = native ? await require("./lib/current-native-capture.cjs")
            .captureInstalledWebview(page, nativeCdp, file, { width, height, dpr, reduced }) : undefined;
          const png = native ? fs.readFileSync(file) : await page.screenshot({ path: file });
          const after = await metrics();
          assert.deepEqual(before, after); assert.deepEqual(before, { width, height, dpr, reduced });
          assert.equal(png.readUInt32BE(16), width*dpr); assert.equal(png.readUInt32BE(20), height*dpr);
          (report.screenshots ??= []).push({ path: file, sha256: sha(file), before, after, nativeCapture: capture });
          await page.getByTestId("renpy-menu-return").click();
          await page.getByTestId("game-state-title").waitFor(); await idle(page, "title_menu");
          assert.deepEqual(errors,[]);
          if (!native) await page.close();
          else rememberNative();
          page=undefined;
          console.log(`PASS ${width}x${height} DPR${dpr} reduced=${reduced} ${variant} six pages`);
          };
          if (native) await execute(); else await server.run(execute);
        }
    assert.equal(report.cases.length,sizes.length*(fast?1:4)*variants.length*6);
    assert(report.cases.every(row=>row.status==="PASS"));
    report.status="PASS";
  } catch(error) {
    report.status="FAILED"; report.error=String(error.stack||error); process.exitCode=1;
    await page?.screenshot({path:path.join(output,"failure.png")}).catch(()=>{});
  } finally {
    try { await browser?.close(); await server?.stop(); }
    catch (error) { report.status = "FAILED"; report.serviceCleanupError = String(error); process.exitCode = 1; }
    if (native) {
      try {
        rememberNative();
        report.ownedProcesses = [...owned.values()];
        report.stops = [...owned.values()].reverse().map(p => ({ pid: p.ProcessId, created: p.Created,
          result: require("./lib/owned-process-stop.cjs").stopOwnedProcess(p, ownership.ps) }));
        const now = ownership.rows();
        assert(!now.some(p => owned.has(`${p.ProcessId}:${p.Created}`)));
        if (report.service?.port) assert.equal(ownership.listeners([report.service.port]).length, 0);
        report.nativeCleanup = { status: "PASS", normalExitClaimed: false,
          method: "EXACT_OWNED_PROCESS_TERMINATION_NOT_NORMAL_CLOSE" };
      } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
      if (profileAttempted && fs.existsSync(path.join(output, "profile-protection.json"))) try {
        profiles("Restore");
        report.profileRestoration = JSON.parse(fs.readFileSync(path.join(output, "profile-restoration.json"), "utf8"));
        assert.equal(report.profileRestoration.status, "PASS");
      } catch (error) { report.status = "FAILED"; report.profileRestoreError = String(error.stack || error); process.exitCode = 1; }
      if (report.executable) try { assert.equal(sha(report.executable.path), report.executable.sha256); }
      catch (error) { report.status = "FAILED"; report.executableChanged = String(error); process.exitCode = 1; }
    }
    report.finishedAt = new Date().toISOString();
    report.tool = { path: __filename, sha256: sha(__filename) };
    report.cleanup = { browserClosed: true, ownedServiceStopped: true, normalCloseAcceptance: false };
    save();
    console.log(`Evidence: ${output}\n${report.status} ${report.error||""}`);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
