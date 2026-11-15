"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out), "Use a new explicit evidence directory");
fs.mkdirSync(out, { recursive: true });
const input = path.join(out, "recovery-fixture.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture("editor_recovery_" + Date.now())));
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const report = { status: "RUNNING", scope: "SOURCE_FULL_APP_REAL_ISOLATED_BACKEND_NOT_INSTALLED", cases: [], errors: [], models: 0 };
let service, browser, page;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function test(name, fn) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { await fn(row); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = e.stack || String(e); if (page) await page.screenshot({path:path.join(out, `${report.cases.length}-failed.png`)}).catch(()=>{}); }
  save(); console.log(JSON.stringify(row));
}
async function graph() {
  return page.evaluate(async () => {
    const {useEditorStore} = await import("/src/store/editorStore.ts");
    const s = useEditorStore.getState();
    return JSON.parse(JSON.stringify({ nodes: s.nodes.map(n=>({id:n.id,data:n.data})), edges:s.edges, selected:s.selectedNodeId, dirty:s.dirty,
      generation:s.projectLoadGeneration, past:s.graphHistory.past.length, future:s.graphHistory.future.length }));
  });
}
async function settle() {
  await page.waitForFunction(async () => !(await import("/src/store/editorStore.ts")).useEditorStore.getState().dirty, undefined, {timeout:30000});
}
(async () => {
  save(); service = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, {isolateBackendWorkingDirectory:true});
  report.service = {url:service.url,backendUrl:service.backendUrl,backendPid:service.backendPid,vitePid:service.server.pid};
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1920,height:1080}});
  page = await context.newPage(); page.setDefaultTimeout(25000);
  page.on("pageerror", e=>report.errors.push(String(e)));
  await service.open(page);
  let sceneId, beforeUndo;
  await test("真实新场景及事件→导入素材→返回→数据库重开保持", async row => {
    await page.locator(".node-palette [data-help-key='palette.scene']").click();
    sceneId = (await graph()).selected;
    await page.locator(".inspector-panel input[data-help-key='field.title']").fill("保存可靠性场景");
    const launcher = page.locator(".command-workbench-launcher button");
    if (await launcher.isVisible()) await launcher.click();
    const workbench = page.locator(".floating-command-workbench");
    await workbench.waitFor();
    await workbench.getByRole("button",{name:"旁白",exact:true}).click();
    await workbench.locator("[data-testid='workbench-add-command']").click();
    await workbench.locator("[data-testid='workbench-add-command']").click();
    await workbench.locator("[data-help-key='workbench.close']").click();
    await workbench.waitFor({state:"hidden"});
    const g = await graph();
    assert(g.nodes.find(n=>n.id===sceneId).data.scene.commands.length>=2);
    await page.locator("[data-workspace-surface='options']").click();
    await page.locator("nav [data-help-key='advanced.tab.library']").click();
    const file = page.locator(".asset-library-panel input[type='file'][multiple]");
    await file.setInputFiles({name:"recovery.svg",mimeType:"image/svg+xml",buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>')});
    await page.locator("[data-help-key='asset.confirmImport']").click();
    await page.locator("[data-workspace-surface='edit']").click();
    await settle();
    assert.deepEqual((await graph()).nodes,g.nodes);
    const p = await page.evaluate(async()=> (await import("/src/store/projectStore.ts")).useProjectStore.getState().projectId);
    const persisted = await (await fetch(`${service.backendUrl}/api/project/projects/${encodeURIComponent(p)}`)).json();
    assert.deepEqual(persisted.data.nodes.map(n=>({id:n.id,data:n.data})),g.nodes);
    assert(persisted.data.asset_manifest.some(a=>a.metadata?.originalFileName==="recovery.svg" || a.name?.includes("recovery") || a.asset_id?.includes("recovery")));
    await page.reload({waitUntil:"domcontentloaded",timeout:60000});
    await page.locator(".recent-project-open").first().click();
    await page.locator(".editor-toolbar").waitFor();
    assert.deepEqual((await graph()).nodes,g.nodes);
    row.nodeId=sceneId; row.events=g.nodes.find(n=>n.id===sceneId).data.scene.commands.length;
  });
  await test("Ctrl+Z撤销先确认，取消不改图；确认撤销单步，Ctrl+Y重做", async () => {
    await page.locator(".node-palette [data-help-key='palette.scene']").click();
    beforeUndo=await graph();
    await page.locator(".flow-surface").click({position:{x:15,y:15}});
    await page.keyboard.press("Control+z");
    const dialog = page.getByTestId("editor-undo-confirmation");
    await dialog.waitFor({timeout:3000});
    assert.deepEqual((await graph()).nodes,beforeUndo.nodes);
    await dialog.getByRole("button",{name:"取消",exact:true}).click();
    await dialog.waitFor({state:"hidden"});
    assert.deepEqual((await graph()).nodes,beforeUndo.nodes);
    await page.keyboard.press("Control+z");
    await dialog.getByRole("button",{name:"确认撤销",exact:true}).click();
    await dialog.waitFor({state:"hidden"});
    assert.equal((await graph()).nodes.length,beforeUndo.nodes.length-1);
    await page.keyboard.press("Control+y");
    assert.deepEqual((await graph()).nodes,beforeUndo.nodes);
  });
  await test("选项保留history兼容键，入口显示时间线并挂载工程恢复面板", async () => {
    await page.locator("[data-workspace-surface='options']").click();
    const tab = page.locator("nav [data-help-key='advanced.tab.history']");
    assert.equal((await tab.textContent()).trim(),"时间线");
    await tab.click();
    await page.locator(".advanced-tab-content:not([inert]) .project-timeline-panel").waitFor();
  });
  const backups=[],nativeCalls=[],backupWaiters=new Set();let failBackup=false;
  const waitForBackup=predicate=>{
    const existing=backups.find(predicate);if(existing)return Promise.resolve(existing);
    return new Promise((resolve,reject)=>{
      const done=()=>{const found=backups.find(predicate);if(found){clearTimeout(timer);backupWaiters.delete(done);resolve(found);}};
      const timer=setTimeout(()=>{backupWaiters.delete(done);reject(Error("Expected automatic recovery point not written"));},30000);
      backupWaiters.add(done);
    });
  };
  await page.exposeFunction("qaTimelineInvoke",async(command,args)=>{
    nativeCalls.push({command,args:command==="write_project_backup"?{trigger:args.trigger,bytes:Buffer.byteLength(args.projectJson)}:
      ["append_frontend_error","write_error_report"].includes(command)?{bytes:Buffer.byteLength(args.message||"")}:args});
    if(command==="write_project_backup"){
      if(failBackup)throw Error("QA_BACKUP_DISK_DENIED");
      const value=JSON.parse(args.projectJson),stamp=Date.now()+backups.length;
      const entry={file_name:`qa-${stamp}.vnproj`,project_id:value.project_id,title:value.title,timestamp_ms:stamp,
        node_count:value.nodes.length,edge_count:value.edges.length,trigger:args.trigger};
      backups.unshift({entry,value});for(const waiter of backupWaiters)waiter();return entry;
    }
    if(command==="list_project_backups")return backups.filter(b=>b.entry.project_id===args.projectId).map(b=>b.entry).slice(0,10);
    if(command==="read_project_backup"){
      const found=backups.find(b=>b.entry.file_name===args.fileName);assert(found);return JSON.stringify(found.value);
    }
    if(command==="append_frontend_error")return "";
    if(command==="write_error_report"){
      const file=path.join(out,`controlled-error-${nativeCalls.length}.txt`);fs.writeFileSync(file,args.message);return file;
    }
    throw Error("Unexpected controlled native call "+command);
  });
  await page.evaluate(()=>{window.__TAURI_INTERNALS__={invoke:(command,args)=>window.qaTimelineInvoke(command,args)};});
  await test("受控原生IPC：自动恢复点、确认恢复、恢复前备份及真实后端落盘",async row=>{
    await page.locator("[data-workspace-surface='edit']").click();
    await page.locator(".node-palette [data-help-key='palette.scene']").click();
    const firstId=(await graph()).selected;
    await settle();
    const checkpoint=structuredClone(await waitForBackup(b=>b.entry.trigger==="auto_save"&&b.value.nodes.some(n=>n.id===firstId)));
    await page.locator(".node-palette [data-help-key='palette.scene']").click();
    const newer=await graph();await settle();
    await waitForBackup(b=>b.entry.trigger==="auto_save"&&b.value.nodes.some(n=>n.id===newer.selected));
    await page.locator("[data-workspace-surface='options']").click();
    await page.locator("nav [data-help-key='advanced.tab.history']").click();
    const panel=page.locator(".advanced-tab-content:not([inert]) .project-timeline-panel");
    await panel.locator("[data-help-key='timeline.refresh']").click();
    await panel.locator("[data-help-key='timeline.entry']").first().waitFor();
    const index=backups.findIndex(b=>b.entry.file_name===checkpoint.entry.file_name);
    await panel.locator("[data-help-key='timeline.entry']").nth(index).click();
    const dialog=page.getByTestId("timeline-restore-confirmation");await dialog.waitFor();
    assert.deepEqual((await graph()).nodes,newer.nodes);
    await dialog.getByRole("button",{name:"恢复备份",exact:true}).click();
    await dialog.waitFor({state:"hidden"});
    assert.equal((await graph()).nodes.length,checkpoint.value.nodes.length);
    const before=backups.find(b=>b.entry.trigger==="before_restore");assert(before);
    assert.deepEqual(before.value.nodes.map(n=>n.id),newer.nodes.map(n=>n.id));
    const persisted=await(await fetch(`${service.backendUrl}/api/project/projects/${encodeURIComponent(checkpoint.entry.project_id)}`)).json();
    assert.deepEqual(persisted.data.nodes.map(n=>n.id),checkpoint.value.nodes.map(n=>n.id));
    row.boundary="CONTROLLED_NATIVE_TIMELINE_IPC_REAL_BACKEND_NOT_NATIVE_FILESYSTEM";
  });
  await test("受控备份拒写阻止恢复，保留图和确认面板",async()=>{
    await page.locator("[data-workspace-surface='options']").click();
    await page.locator("nav [data-help-key='advanced.tab.history']").click();
    const panel=page.locator(".advanced-tab-content:not([inert]) .project-timeline-panel");
    await panel.locator("[data-help-key='timeline.refresh']").click();
    await panel.locator("[data-help-key='timeline.entry']").first().click();
    const dialog=page.getByTestId("timeline-restore-confirmation");await dialog.waitFor();
    const before=await graph();failBackup=true;
    await dialog.getByRole("button",{name:"恢复备份",exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent.includes("QA_BACKUP_DISK_DENIED"));
    assert.deepEqual((await graph()).nodes,before.nodes);assert(await dialog.isVisible());
    failBackup=false;await dialog.getByRole("button",{name:"取消",exact:true}).click();await dialog.waitFor({state:"hidden"});
  });
  report.nativeCalls=nativeCalls;report.backups=backups.map(b=>({entry:b.entry,nodeIds:b.value.nodes.map(n=>n.id)}));
  report.status = report.cases.length===5 && report.cases.every(c=>c.status==="PASS") && !report.errors.length ? "PASS":"FAILED";
})().catch(e=>{report.status="FAILED";report.error=String(e);})
.finally(async()=>{await browser?.close();await service?.stop();report.cleanup="OWNED_BROWSER_AND_SERVICES_STOPPED";report.finishedAt=new Date().toISOString();save();console.log(report.status);if(report.status!=="PASS")process.exitCode=1;});
