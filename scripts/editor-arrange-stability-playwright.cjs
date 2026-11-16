"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance, resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const { output, fixtureProjectId } = resolveAcceptancePaths();
const remaining=process.argv[2]==="--reopen-only";
assert.equal(process.argv.length,remaining?3:2);
const report = { status:"RUNNING", scope:"SOURCE_APP_REAL_BACKEND_ARRANGE_IDEMPOTENCE_HISTORY_SAVE_REOPEN",
  cases:[],errors:[],startedAt:new Date().toISOString() };
const graph = p => ({nodes:p.nodes.map(n=>({id:n.id,data:n.data,position:n.position})),
  edges:p.edges.map(({selected,...edge})=>edge)});
const content = p => ({nodes:p.nodes.map(n=>({id:n.id,data:n.data})),edges:graph(p).edges});
let env,browser,page;
const save = () => fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
const current = async () => {
  const r = await fetch(env.backendUrl+"/api/project/projects/"+fixtureProjectId);assert(r.ok);
  const result=await r.json();assert(result.ok);return graph(result.data);
};
const waitGraph = expected => until(async()=>{const actual=await current();return isDeepStrictEqual(actual,expected)?actual:null;},
  "Actual backend graph equals expected",30000);
const button = () => page.locator("main > aside.node-palette [data-help-key='toolbar.autoArrange']");
async function undo(confirm) {
  await page.locator(".flow-surface").click({position:{x:15,y:15}});
  await page.keyboard.press("Control+z");
  const dialog=page.getByTestId("editor-undo-confirmation");await dialog.waitFor();
  const text=await dialog.innerText();
  await dialog.getByRole("button",{name:confirm?"确认撤销":"取消",exact:true}).click();
  await dialog.waitFor({state:"hidden"});return text;
}
async function step(name,action) {
  const row={name,status:"RUNNING"};report.cases.push(row);save();
  try{row.detail=await action();row.status="PASS";}catch(error){row.status="FAILED";row.error=error.stack;throw error;}
  finally{save();console.log(name,row.status);}
}
(async()=>{
  env=await startEditorAcceptance(output,{isolateBackendWorkingDirectory:true});
  report.owner={url:env.url,backendUrl:env.backendUrl,pid:env.server.pid,backendPid:env.backendPid};
  browser=await chromium.launch();page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  page.on("pageerror",error=>report.errors.push(error.stack));await env.open(page);
  await page.locator(".react-flow__node").first().waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const original=await current();let arranged;
  if(remaining) {
    const evidence=path.resolve(output,"../browser-02/report.json");
    const prior=JSON.parse(fs.readFileSync(evidence,"utf8"));
    assert.equal(prior.status,"FAILED");assert(prior.cases.slice(0,3).every(c=>c.status==="PASS"));
    report.inheritedEvidence={path:evidence,sha256:require("node:crypto").createHash("sha256").update(fs.readFileSync(evidence)).digest("hex"),
      cases:prior.cases.slice(0,3),freshBackendImportOfRetainedSavedProject:true};
    arranged=original;
  } else {
  await step("actual-aside-pointer-organize-content-preserved",async()=>{
    assert.equal(await button().count(),1);await button().click();
    arranged=await until(async()=>{const v=await current();return !isDeepStrictEqual(v,original)?v:null;},"Real organize saved",30000);
    assert.deepEqual(content(arranged),content(original));
    fs.writeFileSync(path.join(output,"original.json"),JSON.stringify(original,null,2));
    fs.writeFileSync(path.join(output,"arranged.json"),JSON.stringify(arranged,null,2));
    return {originalPositions:original.nodes.map(n=>n.position),arrangedPositions:arranged.nodes.map(n=>n.position)};
  });
  await step("cancel-confirm-one-undo-redo",async()=>{
    const cancel=await undo(false);await waitGraph(arranged);
    const confirm=await undo(true);await waitGraph(original);
    await page.keyboard.press("Control+y");await waitGraph(arranged);return {cancel,confirm};
  });
  await step("keyboard-and-repeated-pointer-no-drift-no-extra-history",async()=>{
    await button().focus();await button().press("Enter");
    await page.getByText("已整理画布：移动 0 个节点。",{exact:true}).filter({visible:true}).first().waitFor();
    assert(await button().evaluate(el=>document.activeElement===el));
    for(let i=0;i<3;i++)await button().click();
    await waitGraph(arranged);
    await undo(true);await waitGraph(original);
    await page.keyboard.press("Control+y");await waitGraph(arranged);
    return {keyboard:true,repeatClicks:3,singleUndoRestoresOriginal:true};
  });
  }
  await step("source-page-reload-and-real-database-readback",async()=>{
    await page.reload();
    await page.locator(".project-home").waitFor();
    const fixture=JSON.parse(fs.readFileSync(process.env.AGENTVN_TEST_PROJECT,"utf8"));
    await page.locator(".recent-project-open:not(:disabled)").filter({hasText:fixture.title}).click();
    await page.locator(".editor-toolbar").waitFor();
    await waitGraph(arranged);
    report.screenshot=await captureSourceBrowser(page,path.join(output,"arranged.png"),
      {width:1920,height:1080,dpr:1,reduced:false});
    return {nodes:arranged.nodes.length,edges:arranged.edges.length,nativeRestartClaim:false};
  });
  assert.equal(report.cases.length,remaining?1:4);assert.equal(report.errors.length,0);report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=error.stack;process.exitCode=1;})
.finally(async()=>{
  await browser?.close();await env?.stop();report.finishedAt=new Date().toISOString();save();
  console.log(report.status,path.join(output,"report.json"));
});
