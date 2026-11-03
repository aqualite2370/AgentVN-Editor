"use strict";
// The real Card + real position controller in a browser. Only native IPC is
// controlled here. Actual file/force-kill acceptance remains a separate gate.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "");
const input = path.resolve(process.env.AGENTVN_TEST_PROJECT || "");
assert(process.env.AGENTVN_WORKSPACE_OUTPUT && !fs.existsSync(out));
assert(process.env.AGENTVN_TEST_PROJECT && input.endsWith(".vnproj") && fs.existsSync(input));
assert.equal(JSON.parse(fs.readFileSync(input)).project_id, "editor_isolated_small");
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], errors: [],
  scope: "REAL_COMPONENT_AND_CONTROLLER_BROWSER_WITH_CONTROLLED_NATIVE_IPC_NOT_INSTALLED_ACCEPTANCE",
  input: { path: input }, cleanup: {} };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let owner, browser;
function html() {
  return `<!doctype html><meta charset="utf-8">
  <link rel="stylesheet" href="/src/styles/variables.css?direct">
  <link rel="stylesheet" href="/src/styles/layout.css?direct">
  <style>
  body{margin:0;overflow:hidden;background:var(--bg)}
  .editor-workspace-toolbar{position:fixed;top:16px;left:16px;right:16px;height:80px}
  .workspace-status-bar{position:fixed;bottom:16px;left:16px;right:16px;height:24px}
  #root{--task-line:var(--line);--task-accent:var(--accent)}
  </style>
  <div class="editor-workspace-toolbar">真实任务卡片持久化组件回归</div>
  <div class="workspace-status-bar">隔离组件验收，不代表安装版</div><div id="root"></div>
  <script type="module">
  import RefreshRuntime from '/@react-refresh';
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
  window.__vite_plugin_react_preamble_installed__=true;
  const io=window.cardIO={disk:new Map(),calls:[],failWrite:false,holdRead:null,holdWrite:null,releases:[]};
  const copy=v=>JSON.parse(JSON.stringify(v));
  const pause=()=>new Promise(resolve=>io.releases.push(resolve));
  window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
    io.calls.push({command,...copy(args)});
    if(command==="read_novel_task_card_position"){
      const value=copy(io.disk.get(args.projectId)??null);
      if(io.holdRead===args.projectId){io.holdRead=null;await pause();}
      return value;
    }
    if(command==="write_novel_task_card_position"){
      if(io.holdWrite===args.projectId){io.holdWrite=null;await pause();}
      if(io.failWrite)throw Error("controlled native write refusal");
      const value={schemaVersion:1,projectId:args.projectId,position:args.position};
      io.disk.set(args.projectId,copy(value));return value;
    }
    throw Error("Unexpected native capability: "+command);
  }};
  const {default:React}=await import('/node_modules/.vite/deps/react.js');
  const {default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
  const {NovelTaskCard}=await import('/src/components/novel-import/NovelTaskCard.tsx');
  await import('/src/components/novel-import/novel-task-floating.css');
  const app=ReactDOM.createRoot(document.getElementById("root"));let generation=0;
  window.mountCard=id=>app.render(React.createElement(NovelTaskCard,{
    key:++generation,projectId:id,label:"处理中",tone:"running",inactive:false,onOpen:()=>window.cardOpens++,
    job:{novelTitle:"工程 "+id,totalChunks:4,completedChunks:2,progressPercent:50,status:"running"}
  }));
  window.cardOpens=0;window.harnessReady=true;
  </script>`;
}
async function main() {
  owner = await startOwnedViteServer({ root: path.join(root, "editor"), logFile: path.join(out, "vite.log") });
  report.service = { url: owner.url, pid: owner.pid, runId: owner.runId }; save();
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const row = { width, height, dpr, reduced, status: "RUNNING", checks: [] }; report.cases.push(row); save();
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
      reducedMotion: reduced ? "reduce" : "no-preference" });
    try {
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      page.on("pageerror", error => report.errors.push(String(error)));
      await context.route("**/*", route => {
        const url = route.request().url();
        if (url === owner.url + "/__card-position-harness")
          return route.fulfill({ contentType: "text/html", body: html() });
        if (url.startsWith(owner.url + "/") || /^(blob|data):/.test(url)) return route.continue();
        throw Error(`Unexpected network: ${url}`);
      });
      await owner.run(async () => {
        await page.goto(owner.url + "/__card-position-harness");
        await page.waitForFunction(() => window.harnessReady);
        const card = page.getByTestId("novel-task-mini-entry");
        const key = id => `agentvn.novelTask.position.${encodeURIComponent(id)}`;
        const settle = async () => {
          // Native persistence can finish before the presentation reaches its
          // destination. Observe real animation/RAF state, not a fixed delay
          // or a disk acknowledgement, before asserting exact final geometry.
          await page.evaluate(() => { window.__cardPositionSettled = { value: "", frames: 0 }; });
          await page.waitForFunction(() => {
            const card = document.querySelector('[data-testid="novel-task-mini-entry"]');
            if (!card) return false;
            const value = JSON.stringify(card.getBoundingClientRect().toJSON());
            const sample = window.__cardPositionSettled;
            sample.frames = sample.value === value ? sample.frames + 1 : 0;
            sample.value = value;
            return card.getAttribute("data-position-persistence") === "saved"
              && card.getAnimations().every(animation => !animation.pending
                && animation.playState !== "running")
              && sample.frames >= 3;
          });
        };
        const mount = async id => {
          await page.evaluate(id => window.mountCard(id), id);
          await page.waitForFunction(id => document.querySelector('[data-testid="novel-task-mini-entry"]')
            ?.getAttribute("data-project-id") === id, id);
        };
        async function drag(dx = -150, dy = -65) {
          const before = await card.boundingBox(), grip = await card.getByRole("button", { name: "拖动小说任务卡片" }).boundingBox();
          await page.mouse.move(grip.x + 40, grip.y + 14); await page.mouse.down();
          await page.mouse.move(grip.x + 44, grip.y + 14);
          assert.deepEqual(await card.boundingBox(), before, "Sub-threshold must not move");
          await page.mouse.move(grip.x + 40 + dx, grip.y + 14 + dy, { steps: 6 }); await page.mouse.up();
          assert.equal(await page.evaluate(() => window.cardOpens), 0);
          return { before, moved: await card.boundingBox() };
        }
        await mount("A"); await settle();
        assert.equal(await card.getAttribute("data-position-storage"), "native");
        const initial = await card.boundingBox();
        const first = await drag(); await settle();
        assert(first.before.x - first.moved.x > 100);
        const saved = await page.evaluate(() => window.cardIO.disk.get("A"));
        assert(saved.position.x >= 0 && saved.position.x <= 1);
        row.checks.push("real-drag-threshold-and-native-commit");
        await page.evaluate(() => { window.cardIO.holdRead = "A"; window.mountCard("A"); });
        await page.waitForFunction(() => window.cardIO.releases.length === 1);
        const delayed = await drag(-80, -40);
        assert.equal(await card.getAttribute("data-position-persistence"), "pending");
        await page.evaluate(() => window.cardIO.releases.shift()()); await settle();
        const afterDelayed = await card.boundingBox();
        assert(Math.abs(afterDelayed.x - delayed.moved.x) < 1 && Math.abs(afterDelayed.y - delayed.moved.y) < 1,
          "Late native read must not overwrite a newer drag");
        row.checks.push("late-initial-read-cannot-jump-current-drag");
        await page.evaluate(() => { window.cardIO.holdWrite = "A"; });
        await drag(-50, -30);
        await page.waitForFunction(() => window.cardIO.releases.length === 1);
        await mount("B"); await settle();
        const bBefore = await card.boundingBox();
        await page.evaluate(() => window.cardIO.releases.shift()());
        await page.waitForFunction(() => window.cardIO.disk.get("A")?.position);
        assert.deepEqual(await card.boundingBox(), bBefore, "A write completion cannot reposition B");
        assert.equal(await card.getAttribute("data-project-id"), "B");
        row.checks.push("unmounted-project-write-does-not-change-next-project");
        await mount("A"); await settle();
        const diskBefore = await page.evaluate(() => window.cardIO.disk.get("A"));
        await page.evaluate(() => { window.cardIO.failWrite = true; });
        const failed = await drag(-40, -25);
        await page.getByRole("alert").waitFor();
        assert.equal(await card.getAttribute("data-position-persistence"), "error");
        assert.deepEqual(await page.evaluate(() => window.cardIO.disk.get("A")), diskBefore);
        const retry = page.getByRole("button", { name: "重试保存任务卡片位置" });
        assert(await retry.isVisible()); await page.evaluate(() => { window.cardIO.failWrite = false; });
        await retry.click(); await settle(); assert(!await page.getByRole("alert").isVisible());
        assert.deepEqual(await card.boundingBox(), failed.moved);
        row.checks.push("visible-write-error-preserves-old-bytes-and-real-retry");
        await card.getByRole("button", { name: "恢复任务卡片默认位置" }).click(); await settle();
        assert.deepEqual(await card.boundingBox(), initial);
        await page.evaluate(key => localStorage.setItem(key, '{"x":0.1,"y":0.1}'), key("A"));
        await mount("A"); await settle();
        assert.deepEqual(await card.boundingBox(), initial, "Reset tombstone must beat stale cache");
        assert.equal(await page.evaluate(key => localStorage.getItem(key), key("A")), null);
        row.checks.push("durable-reset-tombstone-beats-stale-browser-cache");
        await page.evaluate(() => { window.cardIO.disk.set("C", { schemaVersion: 9, projectId: "C", position: null }); });
        await mount("C"); await page.getByRole("alert").waitFor();
        const writes = await page.evaluate(() => window.cardIO.calls.filter(c => c.command === "write_novel_task_card_position").length);
        await page.evaluate(() => { window.cardIO.disk.set("C", { schemaVersion: 1, projectId: "C", position: { x: .4, y: .6 } }); });
        await page.getByRole("button", { name: "重试读取任务卡片位置" }).click(); await settle();
        assert.equal(await page.evaluate(() => window.cardIO.calls.filter(c => c.command === "write_novel_task_card_position").length), writes,
          "Read error must retry read, not overwrite damaged/native data");
        row.checks.push("damaged-native-record-shows-error-read-retry-not-write");
        const geometry = await card.evaluate(node => {
          const r = node.getBoundingClientRect(), button = node.querySelector(".novel-task-card-open"), b = button.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom,
            hit: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
            overflow: document.documentElement.scrollWidth - innerWidth,
            actual: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
              reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
        });
        assert(geometry.x >= 12 && geometry.y >= 12 && geometry.right <= width - 12 && geometry.bottom <= height - 12);
        assert(geometry.hit && geometry.overflow <= 1);
        assert.deepEqual(geometry.actual, { width, height, dpr, reduced });
        row.geometry = geometry;
        if (dpr === 1 && !reduced) {
          row.screenshot = path.join(out, `${width}x${height}-card.png`);
          await page.screenshot({ path: row.screenshot });
        }
        row.status = "PASS"; console.log(`PASS card position ${width}x${height} DPR${dpr} ${reduced ? "reduced" : "normal"}`);
      });
    } finally { await context.close(); save(); }
  }
  assert.equal(report.cases.length, 12); assert(report.cases.every(row => row.status === "PASS" && row.checks.length === 6));
  assert.equal(report.errors.length, 0); report.status = "PASS";
}
main().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
}).finally(async () => {
  if (browser) { await browser.close(); report.cleanup.browserClosed = true; }
  if (owner) { await owner.stop(); report.cleanup.serverStopped = true; }
  report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${out}`);
});
