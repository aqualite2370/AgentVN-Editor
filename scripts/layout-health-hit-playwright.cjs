"use strict";
// Actual Editor routes, isolated backend, real pointer hit tests. No CSS injection.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const attempt = process.argv[2];
assert.match(attempt, /^(red|green|matrix)-\d{2}$/);
const out = `F:/AgentVN/QA/Layout-Health-Hit-20261022-01/${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const root = path.resolve(__dirname, ".."), moduleObject = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(moduleObject, moduleObject.exports);
const p = fixture(`layout-health-${attempt}`), renpy = moduleObject.exports.createRenpyUILayout();
p.editor_settings = { runtimeUILayout: renpy, runtimeUILayoutProfiles: { version: 1,
  activeType: "renpy", profiles: { renpy, agentvn: moduleObject.exports.getDefaultUISkinLayout() } } };
const input = path.join(out, "布局健康隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sources = ["editor/src/styles/layout.css", "editor/src/components/advanced/RuntimeLayoutDesigner.tsx"];
const report = { status: "RUNNING", scope: "SOURCE_REAL_BROWSER_NOT_RELEASE_OR_DEVICE",
  startedAt: new Date().toISOString(), cases: [], screenshots: [], errors: [], modelRequests: 0,
  sources: sources.map(file => ({ path: file, sha256: sha(path.join(root, file)) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let env, browser, activePage;
async function measure(page) {
  return page.getByTestId("runtime-layout-health-status").evaluate(button => {
    const rect = button.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const owner = button.closest(".runtime-layout-designer");
    const clips = [];
    for (let a = button.parentElement; a; a = a.parentElement) {
      const style = getComputedStyle(a), r = a.getBoundingClientRect();
      if (/(clip|hidden|auto|scroll)/.test(style.overflowX + style.overflowY)) {
        const left = r.left + a.clientLeft, top = r.top + a.clientTop;
        clips.push({ className: a.className, rect: { left, top, right: left + a.clientWidth, bottom: top + a.clientHeight } });
      }
    }
    return { rect: rect.toJSON(), hit: button === hit || button.contains(hit), hitClass: hit?.className,
      clips, rows: getComputedStyle(owner).gridTemplateRows, owner: owner.getBoundingClientRect().toJSON(),
      pageOverflow: document.documentElement.scrollWidth - innerWidth };
  });
}
async function health(page) {
  const button = page.getByTestId("runtime-layout-health-status");
  await page.waitForFunction(() => document.querySelector('[data-testid="runtime-layout-health-status"]')?.dataset.healthState !== "pending");
  const before = await measure(page);
  report.currentMeasurement = before; save();
  assert(before.hit, `Health button is not hit-testable: ${JSON.stringify(before)}`);
  assert(before.pageOverflow <= 1);
  for (const clip of before.clips) assert(before.rect.left >= clip.rect.left - 1
    && before.rect.right <= clip.rect.right + 1 && before.rect.top >= clip.rect.top - 1
    && before.rect.bottom <= clip.rect.bottom + 1, `Health control clipped by ${clip.className}`);
  await button.click({ timeout: 5000 });
  await page.locator(".runtime-layout-status ul,.runtime-layout-status p").waitFor();
  const expanded = await measure(page); assert(expanded.hit);
  await button.click({ timeout: 5000 });
  await page.locator(".runtime-layout-status ul,.runtime-layout-status p").waitFor({ state: "hidden" });
  return { before, expanded, after: await measure(page) };
}
(async () => {
  save(); env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.owner = { pid: env.server.pid, backendPid: env.backendPid, url: env.url, backendUrl: env.backendUrl }; save();
  browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const matrix = process.argv.includes("--matrix") ? [[1920,1080],[2560,1440],[3840,2160]].flatMap(([width,height]) =>
    [1,2].flatMap(dpr => [false,true].map(reduced => ({width,height,dpr,reduced}))))
    : [{width:1920,height:1080,dpr:1,reduced:false}];
  for (const m of matrix) {
    const context = await browser.newContext({ viewport: {width:m.width,height:m.height},
      deviceScaleFactor:m.dpr,reducedMotion:m.reduced?"reduce":"no-preference" });
    const page = activePage = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => report.errors.push(String(error)));
    await env.server.run(async () => {
      await env.open(page); await settleEditor(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
      for (const label of ["标题主页","关于","帮助","存档/读档"]) {
        const row = { ...m, page:label, status:"RUNNING" }; report.cases.push(row); save();
        await page.getByRole("navigation",{name:"布局页面",exact:true}).getByRole("button",{name:label,exact:true}).click();
        await settleEditor(page);
        row.measurements = await health(page); row.status = "PASS"; save();
      }
      await page.getByTestId("renpy-player-layout-entry").click(); await settleEditor(page);
      await page.locator('[data-layout-type-option="agentvn"]:visible').click(); await settleEditor(page);
      await page.waitForFunction(() => document.querySelector(".runtime-layout-designer")?.dataset.layoutType === "agentvn");
      const row = { ...m, page:"AgentVN播放页",status:"RUNNING" }; report.cases.push(row); save();
      row.measurements = await health(page); row.status = "PASS"; save();
      const actual = await page.evaluate(() => ({ width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
        reduced:matchMedia("(prefers-reduced-motion: reduce)").matches }));
      assert.deepEqual(actual,m);
      const file = path.join(out,`${m.width}-${m.dpr}-${m.reduced}.png`), bytes = await page.screenshot({path:file});
      assert.equal(bytes.readUInt32BE(16),m.width*m.dpr); assert.equal(bytes.readUInt32BE(20),m.height*m.dpr);
      report.screenshots.push({path:file,sha256:sha(file),actual}); save();
    });
    await context.close(); activePage = undefined;
  }
  assert.equal(report.cases.length,matrix.length*5);
  assert(report.cases.every(c=>c.status==="PASS")); assert.deepEqual(report.errors,[]);
  for (const source of report.sources) assert.equal(sha(path.join(root,source.path)),source.sha256);
  report.status="PASS";
})().catch(async error => {
  report.status="FAILED"; report.error=String(error.stack||error); process.exitCode=1;
  await activePage?.screenshot({path:path.join(out,"failure.png")}).catch(()=>{});
}).finally(async () => {
  await browser?.close(); await env?.stop();
  report.cleanup="PASS";
  for (const url of [env?.url,env?.backendUrl].filter(Boolean)) {
    try { await fetch(url,{signal:AbortSignal.timeout(700)}); report.cleanup="FAILED"; } catch {}
  }
  if(report.cleanup!=="PASS"){report.status="FAILED";process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,cases:report.cases.length,out,error:report.error}));
});
