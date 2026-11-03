#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const html = path.join(editorRoot, "runtime-layout-controls-harness.html");
const entry = path.join(editorRoot, "src", "__runtime_layout_controls_harness__.tsx");
const url = "http://127.0.0.1:6776/runtime-layout-controls-harness.html";

fs.writeFileSync(
  html,
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/__runtime_layout_controls_harness__.tsx"></script></body></html>`,
);

fs.writeFileSync(
  entry,
  `import React,{useState}from"react";
import{createRoot}from"react-dom/client";
import"./styles/variables.css";
import"./styles/layout.css";
import"./styles/quick-menu-preview.css";

function App(){
  const[e,setE]=useState(false);
  const icon=e?'close':'expand';
  return <main className="runtime-layout-controls-harness" style={{minHeight:'100dvh', overflow:'hidden'}}>
    <div className="runtime-quick-menu-preview-controls" data-testid="runtime-quick-menu-preview-controls" style={{position:'fixed',zIndex:10,top:8,left:8,right:8}}>
      <span>快捷菜单预览</span>
      <div className="runtime-quick-menu-preview-control-group" aria-label="预览状态">
        <button data-help-key="layout.previewControl" data-preview-quick-menu-state="collapsed" aria-pressed={!e} onClick={()=>setE(false)}>收缩</button>
        <button data-help-key="layout.previewControl" data-preview-quick-menu-state="expanded" aria-pressed={e} onClick={()=>setE(true)}>展开</button>
      </div>
    </div>
    <div className="runtime-layout-stage-wrap" style={{height:'100dvh',minHeight:0,padding:'72px 12px 12px'}}>
      <div className="runtime-layout-stage" style={{width:'auto',height:'min(427px, calc(100dvh - 84px))',maxWidth:'calc(100vw - 24px)',aspectRatio:'16 / 9'}}>
                  <div className="runtime-layout-expected-preview"
                    style={{position:'absolute', inset:0}}
                    data-preview-quick-menu-variant="C"
                    data-preview-quick-menu-state={e?'expanded':'collapsed'}
                    data-preview-quick-menu-direction="up"
                    data-preview-quick-menu-icon={icon}>
                    <div className="preview-quick-menu-preview preview-quick-menu-preview-c"
                      data-preview-quick-menu-variant="C"
                      data-preview-quick-menu-state={e?'expanded':'collapsed'}
                      data-preview-quick-menu-direction="up"
                      data-preview-quick-menu-icon={icon}>
                      <button type="button" data-help-key="layout.previewControl" className="preview-quick-menu-toggle" data-preview-quick-menu-icon={icon} data-testid="preview-quick-menu-toggle" aria-label={e ? "收缩快捷菜单预览" : "展开快捷菜单预览"} onClick={()=>setE(!e)}>
                        <span className={'preview-quick-menu-toggle-icon preview-quick-menu-toggle-icon-expand'+(!e?' is-visible':'')}>↗</span>
                        <span className={'preview-quick-menu-toggle-icon preview-quick-menu-toggle-icon-close'+(e?' is-visible':'')}>×</span>
                      </button>
                      <div className="preview-quick-menu-buttons">{Array.from({length:7},(_,i)=><button type="button" data-help-key="layout.previewControl" className="preview-quick-menu-button" key={i} aria-label={'快捷按钮'+(i+1)}>快捷按钮</button>)}</div>
                    </div>
                  </div>
                </div>
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<App/>);`,
);

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

async function wait() {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("harness timeout");
}

async function metrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const value = element?.getBoundingClientRect();
      return value
        ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height }
        : null;
    };
    const expected = document.querySelector(".runtime-layout-expected-preview");
    const preview = document.querySelector(".preview-quick-menu-preview");
    const buttons = document.querySelector(".preview-quick-menu-buttons");
    const toggle = document.querySelector(".preview-quick-menu-toggle");
    const buttonStyle = buttons ? getComputedStyle(buttons) : null;
    const previewStyle = preview ? getComputedStyle(preview) : null;
    const toggleStyle = toggle ? getComputedStyle(toggle) : null;
    const transitionDuration = [
      ...(previewStyle?.transitionDuration?.split(",") ?? []),
      ...(buttonStyle?.transitionDuration?.split(",") ?? []),
      ...(toggleStyle?.transitionDuration?.split(",") ?? []),
    ].map((value) => Number.parseFloat(value) || 0);
    const controls = rect(".runtime-quick-menu-preview-controls");
    const stageWrap = rect(".runtime-layout-stage-wrap");
    const stage = rect(".runtime-layout-stage");
    return {
      variant: expected?.getAttribute("data-preview-quick-menu-variant"),
      state: expected?.getAttribute("data-preview-quick-menu-state"),
      direction: expected?.getAttribute("data-preview-quick-menu-direction"),
      icon: expected?.getAttribute("data-preview-quick-menu-icon"),
      previewVariant: preview?.getAttribute("data-preview-quick-menu-variant"),
      previewState: preview?.getAttribute("data-preview-quick-menu-state"),
      previewIcon: toggle?.getAttribute("data-preview-quick-menu-icon"),
      controls,
      stageWrap,
      stage,
      preview: rect(".preview-quick-menu-preview"),
      previewPointerEvents: expected ? getComputedStyle(expected).pointerEvents : null,
      quickMenuPointerEvents: previewStyle?.pointerEvents ?? null,
      edgeHitClass: expected
        ? document.elementFromPoint(
          expected.getBoundingClientRect().left + 1,
          expected.getBoundingClientRect().top + 1,
        )?.className ?? null
        : null,
      buttons: rect(".preview-quick-menu-buttons"),
      buttonRects: [...document.querySelectorAll(".preview-quick-menu-button")].map((element) => {
        const value = element.getBoundingClientRect();
        return { width: value.width, height: value.height };
      }),
      buttonsVisibility: buttonStyle?.visibility ?? null,
      buttonsOpacity: Number.parseFloat(buttonStyle?.opacity ?? "0"),
      buttonsPointerEvents: buttonStyle?.pointerEvents ?? null,
      toggleExpandOpacity: Number.parseFloat(getComputedStyle(document.querySelector(".preview-quick-menu-toggle-icon-expand") ?? toggle)?.opacity ?? "0"),
      toggleCloseOpacity: Number.parseFloat(getComputedStyle(document.querySelector(".preview-quick-menu-toggle-icon-close") ?? toggle)?.opacity ?? "0"),
      transitionDuration: Math.max(...transitionDuration, 0),
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

function assertGeometry(value, viewport) {
  assert(value.controls && value.stageWrap && value.stage && value.preview, `${viewport}: preview harness geometry missing`, value);
  assert(value.controls.top >= 0 && value.controls.bottom <= value.viewport.height, `${viewport}: preview controls leave the viewport`, value);
  assert(value.stage.top >= value.controls.bottom - 1, `${viewport}: preview stage overlaps its controls`, value);
  assert(
    value.preview.left >= value.stage.left - 1
      && value.preview.top >= value.stage.top - 1
      && value.preview.right <= value.stage.right + 1
      && value.preview.bottom <= value.stage.bottom + 1,
    `${viewport}: preview escapes its stage`,
    value,
  );
  assert(value.documentScrollWidth <= value.documentClientWidth + 1, `${viewport}: layout introduced horizontal overflow`, value);
}

function assertExpanded(value, viewport) {
  assert(value.variant === "C" && value.previewVariant === "C", `${viewport}: preview variant is not fixed to C`, value);
  assert(value.state === "expanded" && value.previewState === "expanded", `${viewport}: real preview did not expand`, value);
  assert(value.icon === "close" && value.previewIcon === "close", `${viewport}: expanded preview icon did not switch to close`, value);
  assert(value.buttonsVisibility === "visible" && value.buttonsOpacity > 0.8, `${viewport}: expanded preview buttons are not visible`, value);
  assert(value.buttonsPointerEvents !== "none", `${viewport}: expanded preview buttons remain pointer-disabled`, value);
  assert(value.buttonRects.length === 7, `${viewport}: expanded C drawer must expose seven actions`, value);
  assert(value.buttonRects.every((rect) => rect.width >= 44 && rect.height >= 44), `${viewport}: expanded C drawer action hit targets are too small`, value);
  assert(value.toggleCloseOpacity > 0.8 && value.toggleExpandOpacity < 0.2, `${viewport}: expanded preview icon visibility is wrong`, value);
  assert(value.transitionDuration > 0, `${viewport}: preview has no observable transition`, value);
  assert(value.previewPointerEvents === "none" && value.quickMenuPointerEvents === "none", `${viewport}: non-control preview layer captures input`, value);
  assert(!String(value.edgeHitClass).includes("preview-quick-menu-button"), `${viewport}: non-control preview content blocks layout interaction`, value);
}

function assertCollapsed(value, viewport) {
  assert(value.state === "collapsed" && value.previewState === "collapsed", `${viewport}: real preview did not collapse`, value);
  assert(value.icon === "expand" && value.previewIcon === "expand", `${viewport}: collapsed preview icon did not switch to expand`, value);
  assert(value.buttonsVisibility === "hidden" && value.buttonsOpacity < 0.2, `${viewport}: collapsed preview buttons remain visible`, value);
  assert(value.buttonsPointerEvents === "none", `${viewport}: collapsed preview buttons remain interactive`, value);
  assert(value.toggleExpandOpacity > 0.8 && value.toggleCloseOpacity < 0.2, `${viewport}: collapsed preview icon visibility is wrong`, value);
}

(async () => {
  const vite = spawn(
    process.execPath,
    [path.join(editorRoot, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "6776"],
    { cwd: editorRoot, windowsHide: true, stdio: "ignore" },
  );
  const browser = await chromium.launch({ headless: true });
  try {
    await wait();
    for (const viewport of [
      { name: "reported-2560x1392", width: 2560, height: 1392 },
      { name: "wide-desktop", width: 1440, height: 900 },
      { name: "reported-757x299", width: 757, height: 299 },
      { name: "narrow-mobile", width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.width < 900,
        hasTouch: viewport.width < 900,
      });
      await page.goto(url);
      await page.evaluate(() => window.scrollTo(0, 0));
      const controls = page.locator('[data-testid="runtime-quick-menu-preview-controls"]');
      assert(await controls.locator('[data-preview-quick-menu-state="collapsed"]').count() === 1, `${viewport.name}: collapsed control missing`);
      assert(await controls.locator('[data-preview-quick-menu-state="expanded"]').count() === 1, `${viewport.name}: expanded control missing`);
      assert(await controls.locator('[data-preview-quick-menu-variant]').count() === 0, `${viewport.name}: removed variant control returned`);
      assertGeometry(await metrics(page), viewport.name);

      await controls.scrollIntoViewIfNeeded();
      await controls.getByRole("button", { name: "展开" }).click();
      await page.waitForTimeout(240);
      const expandedList = await metrics(page);
      assertExpanded(expandedList, viewport.name);

      await page.evaluate(() => window.scrollTo(0, 0));
      await controls.getByRole("button", { name: "收缩" }).click();
      await page.waitForTimeout(240);
      assertCollapsed(await metrics(page), viewport.name);

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByTestId("preview-quick-menu-toggle").click();
      await page.waitForTimeout(240);
      assertExpanded(await metrics(page), viewport.name);

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByTestId("preview-quick-menu-toggle").click();
      await page.waitForTimeout(240);
      assertCollapsed(await metrics(page), viewport.name);

      await page.goto(url);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reducedControls = page.locator('[data-testid="runtime-quick-menu-preview-controls"]');
      await page.evaluate(() => window.scrollTo(0, 0));
      await reducedControls.scrollIntoViewIfNeeded();
      await reducedControls.getByRole("button", { name: "展开" }).click();
      await page.waitForTimeout(30);
      const reducedMotion = await metrics(page);
      assert(reducedMotion.transitionDuration <= 1, `${viewport.name}: reduced-motion preview transition was not disabled`, reducedMotion);

      await page.close();
    }
    console.log("runtime-layout-quick-menu-controls-playwright: PASS");
  } finally {
    await browser.close();
    try {
      execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      vite.kill();
    }
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
