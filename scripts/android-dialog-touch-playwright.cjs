"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createRequire } = require("node:module");
const { chromium } = require("../editor/node_modules/playwright");
const output = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT ||
  `output/playwright/android-dialog-touch/${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", scope: "Real Chromium regression of Android touch executor; no device claim",
  cases: [], startedAt: new Date().toISOString() };
const source = fs.readFileSync(path.join(__dirname, "android-apk-runtime-qa.cjs"), "utf8");
const context = vm.createContext({ require: createRequire(__filename), __dirname, console, Buffer,
  setTimeout, clearTimeout, AbortSignal, process: { platform: "win32", pid: process.pid,
    argv: ["node", "qa", "--apk", "isolated.apk", "--package", "com.test", "--output", output] } });
vm.runInContext(source.slice(0, source.indexOf("\nmain().catch(")) + `
  globalThis.commands = [];
  run = args => { commands.push(args); return ""; };
  delay = async () => {};
  globalThis.api = { tapSelector, report };`, context);
let browser, page;
async function test(name, action) {
  const row = { name, status: "RUNNING" }; report.cases.push(row);
  try { row.evidence = await action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true });
  // Replay the failed device's fractional geometry and its sibling quick bar.
  // The dialog backdrop intentionally contains space for the eight actions.
  await page.setContent(`<style>
    html,body{margin:0} #root{width:915px;height:412px;position:relative}
    .dialog-box{position:absolute;left:91.279762px;top:296.63095px;width:732.44049px;height:115.357147px}
    .dialog-text{position:absolute;left:88px;top:32px}
    .quick-bar{position:absolute;left:303px;top:354px;width:309px;height:20px;z-index:2}
    button{width:35px;height:20px;padding:0}
    .cover{position:absolute;inset:0;z-index:9}
  </style><div id="root"><div class="dialog-box" role="button" tabindex="0">
    <span class="dialog-text">第一句：确认背景、立绘、普通对白与八项快捷栏。</span>
  </div><div class="quick-bar"><button>回退</button><button>历史</button><button>快进</button>
    <button>自动</button><button>存档</button><button>快存</button><button>快读</button><button>设置</button>
  </div></div>`);
  context.api.report.viewport = { physical: { width: 2400, height: 1080 } };
  const cdp = { evaluate: expression => page.evaluate(expression) };
  await page.evaluate(() => {
    window.dialogClicks = 0; window.actionClicks = 0;
    document.querySelector(".dialog-box").onclick = () => window.dialogClicks++;
    document.querySelector(".quick-bar").onclick = () => window.actionClicks++;
  });
  await test("center occlusion must select a genuinely hittable dialogue point", async () => {
    const center = await page.locator(".dialog-box").evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { hit: element.contains(hit), occluder: hit?.outerHTML };
    });
    assert.equal(center.hit, false, "Replay must preserve the original hit:false");
    await context.api.tapSelector(cdp, ".dialog-box", "replayed full-story advance");
    const command = context.commands.at(-1);
    await page.touchscreen.tap(Number(command[3]) * 915 / 2400, Number(command[4]) * 412 / 1080);
    assert.equal(await page.evaluate(() => window.dialogClicks), 1);
    assert.equal(await page.evaluate(() => window.actionClicks), 0, "Never trigger a quick-bar action instead");
    return { center, touch: context.api.report.touches.at(-1) };
  });
  await test("complete occlusion still fails without issuing a touch", async () => {
    await page.evaluate(() => document.querySelector("#root").insertAdjacentHTML("beforeend", '<div class="cover"></div>'));
    const count = context.commands.length;
    await assert.rejects(context.api.tapSelector(cdp, ".dialog-box", "fully covered"), /clipped or occluded/);
    assert.equal(context.commands.length, count);
    await page.locator(".cover").evaluate(element => element.remove());
  });
  await test("clipped dialogue still fails even when an exposed point is hittable", async () => {
    await page.locator("#root").evaluate(element => { element.style.height = "340px"; element.style.overflow = "hidden"; });
    await assert.rejects(context.api.tapSelector(cdp, ".dialog-box", "clipped"), /clipped or occluded/);
    await page.locator("#root").evaluate(element => { element.style.height = "412px"; element.style.overflow = "visible"; });
  });
  await test("ordinary action buttons retain strict center actionability", async () => {
    await context.api.tapSelector(cdp, ".quick-bar button:nth-child(2)", "history");
    const command = context.commands.at(-1);
    await page.touchscreen.tap(Number(command[3]) * 915 / 2400, Number(command[4]) * 412 / 1080);
    assert.equal(await page.evaluate(() => window.actionClicks), 1);
    await page.locator(".quick-bar button:nth-child(2)").evaluate(element => element.disabled = true);
    await assert.rejects(context.api.tapSelector(cdp, ".quick-bar button:nth-child(2)", "disabled"), /disabled/);
    await page.locator(".quick-bar button:nth-child(2)").evaluate(element => element.disabled = false);
  });
  await test("a descendant action is never accepted as dialogue advancement", async () => {
    await page.locator(".dialog-box").evaluate(element =>
      element.insertAdjacentHTML("beforeend", '<span class="nested-action" role="button" style="position:absolute;inset:0">Other action</span>'));
    await assert.rejects(context.api.tapSelector(cdp, ".dialog-box", "nested action"), /clipped or occluded/);
    await page.locator(".nested-action").evaluate(element => element.remove());
  });
  await page.evaluate(() => {
    const root = document.querySelector("#root"), frame = document.createElement("div");
    frame.className = "frame"; frame.style.cssText = "position:absolute;inset:0;transform-origin:0 0";
    while (root.firstChild) frame.append(root.firstChild);
    root.append(frame);
  });
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
    for (const dpr of [1, 2]) {
      await test(`physical-pixel target rounding ${width}x${height} DPR=${dpr}`, async () => {
        await page.setViewportSize({ width, height });
        await page.evaluate(({ width, height }) => {
          Object.assign(document.querySelector("#root").style, { width: `${width}px`, height: `${height}px` });
          document.querySelector(".frame").style.transform = `scale(${width / 915},${height / 412})`;
        }, { width, height });
        context.api.report.viewport = { physical: { width: width * dpr, height: height * dpr } };
        const before = await page.evaluate(() => [window.dialogClicks, window.actionClicks]);
        await context.api.tapSelector(cdp, ".dialog-box", "scaled dialogue");
        const command = context.commands.at(-1);
        await page.touchscreen.tap(Number(command[3]) / dpr, Number(command[4]) / dpr);
        assert.deepEqual(await page.evaluate(() => [window.dialogClicks, window.actionClicks]), [before[0] + 1, before[1]]);
        return { physical: context.api.report.viewport.physical, touch: context.api.report.touches.at(-1) };
      });
    }
  }
  await page.screenshot({ path: path.join(output, "geometry.png") });
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
}).finally(async () => {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, output, error: report.error }));
});
