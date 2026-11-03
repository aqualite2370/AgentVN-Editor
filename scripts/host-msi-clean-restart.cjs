"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const [launchFile, destination] = process.argv.slice(2);
assert(launchFile && destination && !fs.existsSync(destination), "Fresh restart report required");
fs.mkdirSync(destination, {recursive:true});
const launch=JSON.parse(fs.readFileSync(launchFile,"utf8"));
const baseline=JSON.parse(fs.readFileSync(path.join(path.dirname(launchFile),"created-ui-data.json"),"utf8"));
const report={status:"RUNNING",scope:"NEW_MSI_DEFAULT_SHORTCUT_REAL_PROCESS_RESTART",
  startedAt:new Date().toISOString(),launch,checks:[],screenshots:[],
  realModelRequests:0,testProject:process.env.AGENTVN_TEST_PROJECT,workspaceOutput:process.env.AGENTVN_WORKSPACE_OUTPUT};
let browser;
(async()=>{
  assert(report.testProject && report.workspaceOutput, "Explicit isolated project/output required");
  assert.equal(baseline.status,"PASS"); assert.equal(launch.actualVersion,"1.9.9");
  assert(!launch.dataDirectoryOverride && !launch.webviewDirectoryOverride && !launch.manualBackendSpawn);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const deadline=Date.now()+30000;
  let page;
  do {
    page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
    if(!page) await new Promise(resolve=>setTimeout(resolve,100));
  } while(!page && Date.now()<deadline);
  assert(page); page.setDefaultTimeout(25000);
  await page.getByRole("button",{name:"继续上次编辑",exact:true}).waitFor();
  // The resume button can render before async recent-project hydration.
  // Wait for the actual baseline record, not an arbitrary startup delay.
  await page.getByText(baseline.project.metadata.title,{exact:true}).first().waitFor();
  const text=await page.locator("body").innerText();
  report.homeText=text;
  const cdp=await page.context().newCDPSession(page);
  const expected=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
    reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
  report.screenshots.push(await captureInstalledWebview(page,cdp,path.join(destination,"restart-home.png"),expected));
  assert(text.includes(baseline.project.metadata.title) && text.includes("1.9.9"));
  report.checks.push("Actual new process homepage lists UI-created project and candidate version");
  await page.getByRole("button",{name:"继续上次编辑",exact:true}).click();
  await page.locator('.react-flow__node[data-id="node_scene_opening"]').waitFor();
  const response=await fetch("http://127.0.0.1:8278/api/project/state");
  assert(response.ok); const state=await response.json(); assert(state.ok);
  const actual={metadata:state.data.project_metadata,graph:state.data.project_graph};
  for(const key of ["projectId","title","author"]) assert.equal(actual.metadata[key],baseline.project.metadata[key],key);
  assert.deepEqual(actual.graph,baseline.project.graph);
  report.checks.push("Persisted project identity, all nodes, edges and commands survive real process restart");
  const theme=page.locator(".theme-tone-switch:visible");
  assert.match(await theme.getAttribute("aria-label"),/切换到浅色主题/);
  assert.equal(await page.evaluate(()=>localStorage.getItem("agentvn.themeTone")),baseline.localStorage["agentvn.themeTone"]);
  report.checks.push("Theme survives default WebView process restart");
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert(geometry.scroll<=geometry.width+1);
  report.checks.push("Actual restart editor has no horizontal viewport overflow");
  report.screenshots.push(await captureInstalledWebview(page,cdp,path.join(destination,"restarted-editor.png"),expected));
  report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
  .finally(async()=>{await browser?.close().catch(()=>{});report.finishedAt=new Date().toISOString();
    fs.writeFileSync(path.join(destination,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
    console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error},null,2));});
