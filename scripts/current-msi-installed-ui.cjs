"use strict";
// Actual installed MSI, physical default profiles held externally. No Vite,
// frontend store writes, synthetic save success, or physical-close claims.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { sha256, settleEditor } = require("./lib/installed-acceptance.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const root = "F:/AgentVN/QA/Current-MSI-Upgrade-20261021-01/session-01";
const [phase, launchFile, destination] = process.argv.slice(2);
assert(["create", "restart"].includes(phase));
assert(launchFile && destination && !fs.existsSync(destination), "Fresh explicit evidence required");
assert(path.resolve(destination).startsWith(path.resolve(root) + path.sep));
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT,
  "Explicit isolated small project/output required");
fs.mkdirSync(destination, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const launch = read(launchFile);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), phase, checks: [], screenshots: [],
  scope: "REAL_CURRENT_MSI_DEFAULT_SHORTCUT_UI_SAVE_AND_RESTART_NOT_CLEAN_MACHINE_OR_PHYSICAL_INPUT",
  testProject: process.env.AGENTVN_TEST_PROJECT, workspaceOutput: process.env.AGENTVN_WORKSPACE_OUTPUT,
  launch, realModelRequests: 0, physicalInput: false, knownProcesses: [], cleanup: {status:"NOT_RUN"} };
const reportFile = path.join(destination, "report.json");
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const identity = p => `${p.ProcessId}:${p.Created}`;
const known = new Map();
let browser, editor, page, cdp;
const expected = { width:1920, height:1080, dpr:1, reduced:false };
function remember() {
  const live = rows();
  assert(editor, "Capture owned editor before process operations");
  for(const p of ownedProcessTree(live, editor.ProcessId, editor.Created)) known.set(identity(p), p);
  report.knownProcesses = [...known.values()]; save(); return live;
}
async function current() {
  const response = await fetch("http://127.0.0.1:8278/api/project/state", {signal:AbortSignal.timeout(15000)});
  assert(response.ok); const body=await response.json(); assert(body.ok);
  return {metadata:body.data.project_metadata, graph:body.data.project_graph};
}
async function shot(name) {
  await settleEditor(page);
  await page.locator(".project-entry-loading-overlay").waitFor({state:"detached"});
  const visible=await page.locator("button:visible").count(); assert(visible>0);
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert(geometry.scroll<=geometry.width+1,"Viewport overflow");
  report.screenshots.push(await captureInstalledWebview(page,cdp,path.join(destination,name+".png"),expected));
  save();
}
(async()=>{
  assert.equal(launch.status,"PASS"); assert.equal(launch.actualVersion,"1.9.16");
  assert.equal(path.resolve(launch.installRoot),path.resolve("D:/agentvntest/AgentVN Editor"));
  assert.equal(sha256(fs.readFileSync(path.join(launch.installRoot,"agentvn-editor.exe"))),launch.executableSha256);
  assert(!launch.dataDirectoryOverride&&!launch.webviewDirectoryOverride&&!launch.manualBackendSpawn);
  const protection=read(path.join(root,"profile-protection.json"));
  assert.equal(protection.records.length,2);
  for(const record of protection.records) assert(fs.existsSync(record.held)&&fs.existsSync(record.original));
  assert.equal(read(path.join(root,"HoldLegacy.json")).status,"PASS");
  const candidates=rows().filter(p=>p.Name==="agentvn-editor.exe");
  assert.equal(candidates.length,1); editor=candidates[0];
  assert.equal(path.resolve(editor.ExecutablePath),path.resolve(path.join(launch.installRoot,"agentvn-editor.exe")));
  remember();
  await until(()=>listeners([8278,launch.cdpPort]).length>=2,"Actual host-owned backend/CDP listeners",60000);
  const live=remember(), owned=[...known.values()];
  const ports=listeners([8278,launch.cdpPort]);
  assert(ports.length>=2&&ports.every(l=>owned.some(p=>p.ProcessId===l.OwningProcess)));
  const backends=live.filter(p=>p.Name==="creator-backend.exe");
  assert.equal(backends.length,2);
  for(const p of backends) {
    assert(owned.some(o=>identity(o)===identity(p)));
    assert.equal(path.resolve(p.ExecutablePath),path.resolve(path.join(launch.installRoot,"creator-backend.exe")));
  }
  report.portOwners=ports;
  report.backend={path:backends[0].ExecutablePath,sha256:sha256(fs.readFileSync(backends[0].ExecutablePath))};
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes("tauri.localhost")),"Installed document");
  page.setDefaultTimeout(30000); report.url=page.url(); report.pageErrors=[];
  page.on("pageerror",e=>report.pageErrors.push(String(e)));
  cdp=await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await page.emulateMedia({reducedMotion:"no-preference"});
  report.displayScope="Actual native WebView viewport simulation, not a physical 1080p display";
  if(phase==="create") {
    await page.getByRole("region",{name:"创建或打开项目",exact:true})
      .getByRole("button",{name:"新建项目",exact:true}).click();
    await page.getByRole("button",{name:"选项",exact:true}).waitFor();
    await page.locator(".project-entry-loading-overlay").waitFor({state:"detached"});
    await settleEditor(page);
    await page.getByRole("button",{name:"选项",exact:true}).click();
    const title="MSI真实安装_20261021_en-US", author="当前候选隔离回测", summary="实际MSI当前版本保存和重启";
    await page.getByRole("textbox",{name:"项目名称",exact:true}).fill(title);
    await page.getByRole("textbox",{name:"项目作者",exact:true}).fill(author);
    await page.getByRole("button",{name:"编辑",exact:true}).click();
    await page.getByRole("textbox",{name:/^场景摘要(?: 场景摘要)?$/}).fill(summary);
    const theme=page.locator(".theme-tone-switch:visible");
    if(/切换到深色主题/.test(await theme.getAttribute("aria-label"))) await theme.click();
    const downloads="C:/Users/1/Downloads";
    const before=new Set(fs.readdirSync(downloads));
    await page.getByRole("button",{name:"保存工程",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"工程已导出",exact:true});await dialog.waitFor();
    const text=await dialog.innerText(), exported=text.match(/C:\\Users\\1\\Downloads\\[^\r\n]+\.vnproj/)?.[0];
    assert(exported&&!before.has(path.basename(exported)),"Only a new native Downloads artifact is owned");
    assert.equal(path.dirname(path.resolve(exported)),path.resolve(downloads));
    const bytes=fs.readFileSync(exported),zip=await JSZip.loadAsync(bytes);
    const project=JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(project.title,title);assert.equal(project.author,author);
    assert.equal(project.nodes.find(n=>n.id==="node_scene_opening").data.scene.summary,summary);
    const retained=path.join(destination,"native-export.vnproj");fs.writeFileSync(retained,bytes,{flag:"wx"});
    report.package={source:exported,retained,sha256:sha256(bytes),bytes:bytes.length,absentBefore:true,sourceRemoved:false};
    await dialog.getByRole("button",{name:"OK",exact:true}).click();
    report.project=await until(async()=>{
      const state=await current();
      return state.metadata.title===title&&state.metadata.author===author
        &&state.graph.nodes.find(n=>n.id==="node_scene_opening")?.data.scene.summary===summary?state:false;
    },"Actual backend persistence");
    report.theme=await page.evaluate(()=>localStorage.getItem("agentvn.themeTone"));assert(report.theme);
    report.checks.push("Real default shortcut/new project/options metadata/scene edit/native vnproj bytes/persisted backend/dark theme");
    await shot("actual-msi-created");
  }else {
    const baseline=read(path.join(root,"ui-create-01/report.json"));assert.equal(baseline.status,"PASS");
    await page.getByText(baseline.project.metadata.title,{exact:true}).first().waitFor();
    await shot("actual-msi-restart-home");
    await page.getByRole("button",{name:"继续上次编辑",exact:true}).click();
    await page.locator('.react-flow__node[data-id="node_scene_opening"]').waitFor();
    await page.locator(".project-entry-loading-overlay").waitFor({state:"detached"});
    const state=await current();
    for(const key of ["projectId","title","author"])assert.equal(state.metadata[key],baseline.project.metadata[key]);
    assert.deepEqual(state.graph,baseline.project.graph);
    assert.equal(await page.evaluate(()=>localStorage.getItem("agentvn.themeTone")),baseline.theme);
    assert.match(await page.locator(".theme-tone-switch:visible").getAttribute("aria-label"),/切换到浅色主题/);
    report.project=state;report.checks.push("Default shortcut new native process restores same project identity/full graph/theme");
    await shot("actual-msi-restarted-editor");
  }
  const hostLog=path.join(launch.installRoot,"error_log/editor-desktop.log");
  const log=fs.readFileSync(hostLog,"utf8");
  const lines=log.split(/\r?\n/).filter(s=>s.includes("Packaged backend data dir: "));
  assert(lines.at(-1)?.includes("C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend"));
  assert(log.includes("Using bundled editor frontend."));
  fs.copyFileSync(hostLog,path.join(destination,"host.log"),fs.constants.COPYFILE_EXCL);
  report.actualDatabase={path:launch.databasePath,sha256:sha256(fs.readFileSync(launch.databasePath)),latestHostLine:lines.at(-1)};
  assert(fs.existsSync(launch.webviewRoot));assert(!fs.existsSync(path.join(launch.installRoot,"data")));
  report.checks.push("Host starts its packaged backend/default Roaming DB/default Local WebView; no install-local data recreated");
  assert.equal(report.pageErrors.length,0);report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
  .finally(async()=>{
    await browser?.close().catch(()=>{});
    try {
      if(editor) {
        remember();
        const stopped=[];
        // Exact PID + creation + executable identity, not image-name killing.
        for(const p of [...known.values()]){
          const current=rows().find(a=>identity(a)===identity(p));
          if(!current)continue;
          assert.equal(current.ExecutablePath,p.ExecutablePath);
          ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';`+
            `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
          stopped.push(identity(p));
        }
        const live=rows(), survivors=[...known.values()].filter(p=>live.some(a=>identity(a)===identity(p)));
        const remaining=listeners([8278,launch.cdpPort]);
        report.cleanup={status:survivors.length||remaining.length?"FAILED":"PASS",stopped,survivors,ports:remaining,
          method:"Exact owned termination; not normal native close or physical input"};
        assert.equal(report.cleanup.status,"PASS");
      }
    }catch(e){report.cleanup.status="FAILED";report.cleanup.error=String(e.stack||e);report.status="FAILED";process.exitCode=1;}
    report.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({status:report.status,checks:report.checks,cleanup:report.cleanup.status,error:report.error},null,2));
  });
