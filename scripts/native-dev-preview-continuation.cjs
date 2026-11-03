"use strict";
// Current Dev / actual external Player and separate node iframe. Not installed Release.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const root = path.resolve(__dirname, ".."), label = process.env.AGENTVN_QA_PREVIEW_LABEL || "Native-Dev-Preview-20261020-01";
assert(/^Native-Dev-Preview-(?:Repair-)?20261020-\d{2}$/.test(label));
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output", label.toLowerCase());
const input = path.join(qa, "原生预览 隔离临时工程.vnproj");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedAt: fs.statSync(f).mtime.toISOString() });
const writeNew = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { flag: "wx" });
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/agentvn-player.exe", "editor/src-tauri/binaries/creator-backend.exe"];
const sources = ["editor/src/components/advanced/PreviewWindowControls.tsx", "editor/src/preview/previewWindow.ts",
  "editor/src/components/editor/PreviewPanel.tsx", "editor/src-tauri/src/main.rs",
  "editor/src-tauri/src/preview_process.rs", "editor/src-tauri/src/owned_process.rs",
  "GameCli_framework/src/app/App.tsx", "GameCli_framework/src-tauri/src/lib.rs"];
const pause = ms => new Promise(r => setTimeout(r, ms));
function ps(command) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", command],
    { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr); return r.stdout.replace(/^\uFEFF/, "").trim();
}
const processes = () => JSON.parse(ps("ConvertTo-Json -Compress -Depth 4 -InputObject @(" +
  "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine," +
  "@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"));
const identity = p => `${p.ProcessId}:${p.Created}`;
const listeners = ports => JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(" +
  `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(${ports.join(",")})}` +
  " | Select-Object LocalPort,OwningProcess)"));
async function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const n = s.address().port; s.close(e => e ? reject(e) : resolve(n)); }); });
}
async function until(fn, name, timeout = 60000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = String(e); }
    await pause(200);
  }
  throw Error(`Deadline ${name}: ${last || "false"}`);
}
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); assert(r.ok, `${url} ${r.status}`); return r.json();
}
async function prepare() {
  for (const dir of [qa, checkpoint, summary]) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const saved = [];
  for (const f of ["scripts/native-dev-preview-continuation.cjs", "scripts/native-dev-preview-profile.ps1",
    "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md", ...sources]) {
    const to = path.join(checkpoint, f); fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, f), to, fs.constants.COPYFILE_EXCL); saved.push(describe(to));
  }
  const p = fixture("native-dev-preview-20261020-01");
  p.title = "当前Dev 外部与节点预览"; p.nodes[1].data.scene.commands = [
    { type: "narration", text: "当前Dev预览第一句：实际导出与真实Player。" },
    { type: "narration", text: "当前Dev预览第二句：节点预览独立验证。" },
  ];
  writeNew(input, p);
  writeNew(path.join(summary, "preparation.json"), { status: "PASS", at: new Date().toISOString(),
    saved, input: describe(input), products: products.map(f => describe(path.join(root, f))),
    sources: sources.map(f => describe(path.join(root, f))),
    existingBinaryCheckpoint: "F:/AgentVN/Checkpoints/Project-Import-Atomic-20261020-01",
    nativeAvailability: { at: "2026-10-20T05:02:39.280Z", status: "BLOCKED", method: "sky.list_apps",
      error: "Computer Use native pipe unavailable, os error 2", inputSent: false } });
  console.log(`PASS prepared ${qa}`);
}
async function geometry(locator) {
  const g = await locator.evaluate(n => {
    const r = n.getBoundingClientRect(), buttons = [...n.querySelectorAll("button")].filter(b =>
      b.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !b.closest("details:not([open])"));
    return { rect: r.toJSON(), width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth,
      focusUnavailable: !!document.activeElement?.closest('[inert],[aria-hidden="true"]'),
      buttons: buttons.map(b => { const a = b.getBoundingClientRect(); return { text: b.textContent.trim(),
        rect: a.toJSON(), disabled: b.disabled, hit: b.contains(document.elementFromPoint(a.x+a.width/2, a.y+a.height/2)) }; }) };
  });
  assert(g.rect.width > 0 && g.rect.height > 0 && g.rect.left >= -1 && g.rect.top >= -1);
  assert(g.rect.right <= g.width+1 && g.rect.bottom <= g.height+1 && g.overflow <= 1);
  assert(!g.focusUnavailable);
  for (const b of g.buttons.filter(b => !b.disabled)) {
    assert(b.hit && b.rect.left >= -1 && b.rect.top >= -1 && b.rect.right <= g.width+1 && b.rect.bottom <= g.height+1, JSON.stringify(b));
  }
  for (let i=0;i<g.buttons.length;i++) for(let j=i+1;j<g.buttons.length;j++) {
    const a=g.buttons[i].rect,b=g.buttons[j].rect;
    assert(!(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 &&
      Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1), "Overlapping controls");
  }
  return g;
}
async function display(page, cdp, m) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: m.width, height: m.height, deviceScaleFactor: m.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: m.reduced ? "reduce" : "no-preference" });
}
async function capture(page, cdp, file, m) {
  const sample = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const check = a => { assert.equal(a.width,m.width); assert.equal(a.height,m.height);
    assert.equal(a.reduced,m.reduced); assert(Math.abs(a.dpr-m.dpr)<=1e-6); };
  const before=await sample();check(before);
  const b=Buffer.from((await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64");
  const after=await sample();check(after);assert.deepEqual(after,before);
  assert.equal(b.readUInt32BE(16),m.width*m.dpr);assert.equal(b.readUInt32BE(20),m.height*m.dpr);
  fs.writeFileSync(file,b,{flag:"wx"});return {...describe(file),before,after};
}
async function run() {
  const out=path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT||"");
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT||""),path.resolve(input));
  assert(out.startsWith(path.resolve(qa)+path.sep)&&!fs.existsSync(out),"Fresh F-drive run required");
  fs.mkdirSync(out);fs.copyFileSync(__filename,path.join(out,"executed-test.cjs"),fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(path.join(root,"scripts/native-dev-preview-profile.ps1"),path.join(out,"executed-profile.ps1"),fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(path.join(root,"scripts/lib/owned-process-tree.cjs"),path.join(out,"executed-owned-process-tree.cjs"),fs.constants.COPYFILE_EXCL);
  const baseline=process.env.AGENTVN_QA_PREVIEW_BASELINE || path.join(summary,"preparation.json");
  assert(path.resolve(baseline)===path.resolve(path.join(summary,"preparation.json")) ||
    (path.resolve(baseline).startsWith(path.resolve(qa)+path.sep)&&path.basename(baseline)==="verified-build.json"));
  const prep=read(baseline), project=read(input),ownershipReview=process.argv.includes("--close-ownership");
  const report={status:"RUNNING",at:new Date().toISOString(),scope:"CURRENT_NATIVE_DEV_EXTERNAL_PLAYER_AND_NODE_PREVIEW_NOT_RELEASE_OR_PHYSICAL_INPUT",
    setup:"Public backend fixture import; actual homepage/top buttons; no store injection",
    viewportMethod:"Actual WebView2 CDP emulation, not physical 4K",executable:prep.products[0],
    sources:prep.sources,tools:[describe(path.join(out,"executed-test.cjs")),describe(path.join(out,"executed-profile.ps1")),
      describe(path.join(out,"executed-owned-process-tree.cjs"))],
    baseline:describe(baseline),ownershipReview,
    checks:[],cases:[],players:[],known:[],modelRequests:0,productChanges:0,newBuilds:0};
  const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
  const known=new Map();let host,browser,page,playerBrowser,player,playerCdp,cdp,profileJournal=false;
  let sentinel,sentinelBrowser;
  const remember=()=>{
    if(!host)return [];
    const rows=processes(),tree=ownedProcessTree(rows,host.pid,report.host.created);
    if(tree[0])report.host.created=tree[0].Created;
    for(const p of tree)known.set(identity(p),p);
    if(sentinel){
      const independent=ownedProcessTree(rows,sentinel.pid,report.sentinelCreated);
      if(independent[0])report.sentinelCreated=independent[0].Created;
      for(const p of independent)known.set(identity(p),p);
    }
    report.known=[...known.values()];save();return tree;
  };
  const step=async(name,fn)=>{
    const c={name,status:"RUNNING"};report.checks.push(c);save();
    try{c.detail=await fn();c.status="PASS";console.log(`PASS ${name}`);}
    catch(e){c.status="FAILED";c.error=String(e.stack||e);throw e;}finally{save();}
  };
  const profile=action=>{
    const r=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
      path.join(out,"executed-profile.ps1"),"-Action",action,"-RunDirectory",out],
      {encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
    fs.writeFileSync(path.join(out,`profile-${action.toLowerCase()}.log`),(r.stdout||"")+(r.stderr||""),{flag:"wx"});
    assert.equal(r.status,0,r.stderr);
  };
  const ports=[await freePort(),await freePort(),await freePort()];
  const [backendPort,editorPort,playerPort]=ports;ports.push(6767);
  report.ports={backendPort,editorPort,playerPort,vite:6767};
  const status=()=>page.getByTestId("preview-window-status");
  const top=async(surface)=>{await page.locator(`[data-workspace-surface="${surface}"]:visible`).click();await settleEditor(page);};
  async function openPlayer() {
    assert.equal(processes().filter(p=>p.Name==="agentvn-player.exe").length,0);
    await page.locator('[data-help-key="preview.open"]:visible').click();
    await status().filter({hasText:"运行中"}).waitFor({timeout:60000});
    const tree=remember(), matches=tree.filter(p=>p.Name==="agentvn-player.exe");
    assert.equal(matches.length,1);const p=matches[0];
    assert.equal(p.ParentProcessId,host.pid);assert.equal(sha(p.ExecutablePath),prep.products[2].sha256);
    const match=p.CommandLine.match(/--preview-root\s+(?:"([^"]+)"|(\S+))/);assert(match);
    const dir=match[1]||match[2],scriptFile=path.join(dir,"script.json"),script=read(scriptFile);
    assert.equal(script.game_id,project.project_id);
    assert(script.scenes.some(s=>s.commands.some(c=>c.type==="narration"&&c.text===project.nodes[1].data.scene.commands[0].text)));
    const info={...p,executable:describe(p.ExecutablePath),previewRoot:dir,script:describe(scriptFile),
      manifest:describe(path.join(dir,"manifest.json")),layout:fs.existsSync(path.join(dir,"ui/layout.json"))?describe(path.join(dir,"ui/layout.json")):null};
    report.players.push(info);save();
    await until(()=>json(`http://127.0.0.1:${playerPort}/json/version`),"owned Player CDP");
    const listener=listeners([playerPort]);assert(listener.length && listener.every(l=>tree.some(p=>p.ProcessId===l.OwningProcess)));
    playerBrowser=await chromium.connectOverCDP(`http://127.0.0.1:${playerPort}`);
    player=playerBrowser.contexts()[0].pages()[0];assert(player);player.setDefaultTimeout(30000);
    playerCdp=await player.context().newCDPSession(player);
    await player.getByTestId("start-new-game").waitFor();await settleRuntime(player);
    await player.getByTestId("start-new-game").click();await player.getByTestId("game-state-playing").waitFor();
    await settleRuntime(player);
    await player.locator(".dialog-box").filter({hasText:project.nodes[1].data.scene.commands[0].text}).waitFor();
    return info;
  }
  async function closePlayer() {
    const playerTree=remember().filter(p=>p.Name==="agentvn-player.exe");
    await page.locator('[data-help-key="preview.close"]:visible').click();
    await status().filter({hasText:"已关闭"}).waitFor();
    await playerBrowser?.close().catch(()=>{});playerBrowser=null;
    await until(()=>!processes().some(p=>playerTree.some(a=>identity(a)===identity(p)))&&!listeners([playerPort]).length,"Player process close",15000);
  }
  try {
    for(const p of [...prep.products,...prep.sources,prep.input])assert.equal(sha(p.path),p.sha256);
    assert.equal(prep.products[0].sha256,prep.products[1].sha256);
    assert.equal(processes().filter(p=>/^(AgentVN Dev|agentvn-editor|agentvn-player)\.exe$/i.test(p.Name)).length,0,"Another user session active");
    assert.equal(listeners(ports).length,0,"Unknown service/port occupied");
    profileJournal=true;profile("Prepare");
    const data=path.join(out,"data"),webview=path.join(out,"editor-webview"),temp=path.join(out,"temporary");
    fs.mkdirSync(path.join(data,"backend"),{recursive:true});fs.mkdirSync(temp);
    writeNew(path.join(data,"backend/database-migration-decision.json"),{approved:false,sources:[]});
    const env={...process.env};for(const k of Object.keys(env))if(/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/.test(k))delete env[k];
    Object.assign(env,{AGENTVN_EDITOR_DATA_DIR:data,AGENTVN_BACKEND_PORT:String(backendPort),AGENTVN_LEGACY_DATABASE_PATHS:"",
      VITE_BACKEND_URL:`http://127.0.0.1:${backendPort}`,WEBVIEW2_USER_DATA_FOLDER:webview,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${editorPort}`,
      AGENTVN_GAMECLI_PREVIEW_CDP_PORT:String(playerPort),TEMP:temp,TMP:temp,
      AGENTVN_TEST_PROJECT:input,AGENTVN_WORKSPACE_OUTPUT:out});
    const log=fs.openSync(path.join(out,"host.log"),"wx");
    host=spawn(prep.products[0].path,[],{cwd:out,env,windowsHide:true,stdio:["ignore",log,log]});fs.closeSync(log);
    report.host={pid:host.pid,data,webview};save();
    await until(async()=>{assert.equal(host.exitCode,null);return(await json(`http://127.0.0.1:${backendPort}/api/health`)).project_container_protocol>=2;},"auto backend");
    await until(()=>json(`http://127.0.0.1:${editorPort}/json/version`),"Editor CDP");
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${editorPort}`);
    page=await until(()=>browser.contexts()[0].pages().find(p=>p.url().includes(":6767")),"Dev page");
    page.setDefaultTimeout(30000);await page.locator(".project-home").waitFor({timeout:60000});
    const tree=remember(),owned=listeners([backendPort,editorPort,6767]);assert.equal(owned.length,3);
    assert(owned.every(l=>tree.some(p=>p.ProcessId===l.OwningProcess)));report.initialListeners=owned;
    assert(tree.some(p=>p.Name==="msedgewebview2.exe"&&p.CommandLine.includes(webview)));
    await page.context().route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/,r=>{
      if(r.request().method()!=="POST")return r.continue();report.modelRequests++;return r.abort();
    });
    const response=await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`,{method:"POST",
      headers:{"Content-Type":"application/octet-stream","X-AgentVN-Filename":encodeURIComponent(path.basename(input))},body:fs.readFileSync(input)});
    assert(response.ok,await response.text());await page.reload();
    await page.locator('[data-help-key="home.recentProject"]').click();await settleEditor(page);
    cdp=await page.context().newCDPSession(page);
    const matrix=[1920,2560,3840].flatMap(width=>[1,2].flatMap(dpr=>[false,true].map(reduced=>({width,height:width*9/16,dpr,reduced}))));
    const cases=process.argv.includes("--smoke")?matrix.slice(0,1):matrix;
    await display(page,cdp,cases[0]);
    await step("Real top preview confirmation does not prematurely launch external Player",async()=>{
      await top("preview");await page.getByTestId("preview-launch-panel").waitFor();
      await status().filter({hasText:"已关闭"}).waitFor();
      assert.equal(await page.getByTestId("preview-launch-panel").locator("iframe").count(),0);
      assert.equal(processes().filter(p=>p.Name==="agentvn-player.exe").length,0);
      return geometry(page.getByTestId("preview-launch-panel"));
    });
    await step("Real confirmation launch exports matching isolated script and starts owned Player",openPlayer);
    if(ownershipReview) {
      report.scope="CURRENT_DEV_OWNED_PREVIEW_CLOSE_WITH_SAME_PATH_UNRELATED_REAL_PLAYER_NOT_DISPLAY_MATRIX";
      await step("Closing owned preview must preserve unrelated real Player with identical preview-root",async()=>{
        const sentinelPort=await freePort();ports.push(sentinelPort);report.ports.sentinelPort=sentinelPort;
        const sentinelProfile=path.join(out,"unrelated-player-webview");
        const log=fs.openSync(path.join(out,"unrelated-player.log"),"wx"),own=report.players[0];
        const sentinelEnv={...env,WEBVIEW2_USER_DATA_FOLDER:sentinelProfile,
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${sentinelPort}`};
        sentinel=spawn(own.ExecutablePath,["--mode","preview","--preview-root",own.previewRoot],
          {cwd:path.dirname(own.ExecutablePath),env:sentinelEnv,windowsHide:true,stdio:["ignore",log,log]});
        fs.closeSync(log);
        await until(()=>json(`http://127.0.0.1:${sentinelPort}/json/version`),"independent Player CDP");
        remember();
        const sentinelIdentity=processes().find(p=>p.ProcessId===sentinel.pid);assert(sentinelIdentity);
        assert.notEqual(sentinelIdentity.ParentProcessId,host.pid);
        assert.equal(sentinelIdentity.ExecutablePath.toLowerCase(),own.ExecutablePath.toLowerCase());
        assert(sentinelIdentity.CommandLine.includes(own.previewRoot));
        sentinelBrowser=await chromium.connectOverCDP(`http://127.0.0.1:${sentinelPort}`);
        const sentinelPage=sentinelBrowser.contexts()[0].pages()[0];assert(sentinelPage);
        await sentinelPage.getByTestId("start-new-game").waitFor();await settleRuntime(sentinelPage);
        report.sentinel={...sentinelIdentity,port:sentinelPort,profile:sentinelProfile,previewRoot:own.previewRoot,
          source:"Second real Player directly owned by QA, not the Editor; deliberately same executable and preview path"};
        report.ownershipChecks=[{name:"Distinct parent and process identity, identical Player executable and preview path",status:"PASS"}];save();
        await closePlayer();
        const remaining=processes().find(p=>identity(p)===identity(sentinelIdentity));
        assert(remaining,"Unrelated real Player was killed by the Editor's preview close");
        assert.equal(sentinel.exitCode,null,"Independent Player terminated");
        assert((await json(`http://127.0.0.1:${sentinelPort}/json/version`)).webSocketDebuggerUrl);
        assert(await sentinelPage.getByTestId("start-new-game").isEnabled());
        report.ownershipChecks.push({name:"Owned preview closed while unrelated same-path Player stays alive and usable",status:"PASS"});
        // Close this QA-owned control through its real exit confirmation.
        await sentinelPage.evaluate(()=>{void window.__TAURI_INTERNALS__.invoke("plugin:window|close",{label:"main"});});
        const dialog=sentinelPage.getByRole("dialog",{name:"退出游戏？",exact:true});await dialog.waitFor();
        await dialog.getByTestId("confirm-exit-game").click().catch(e=>{if(!/closed/i.test(String(e)))throw e;});
        await until(()=>sentinel.exitCode!==null,"control Player's confirmed exit",15000);
        await sentinelBrowser.close().catch(()=>{});sentinelBrowser=null;
        report.ownershipChecks.push({name:"QA control Player exits through its own confirmation",status:"PASS"});
        return {owned:identity(own),unrelated:identity(sentinelIdentity),samePath:own.previewRoot,checks:report.ownershipChecks};
      });
    }
    for(const m of ownershipReview?[]:cases) {
      const row={...m,key:`${m.width}-dpr${m.dpr}-${m.reduced?"reduce":"normal"}`,status:"RUNNING"};report.cases.push(row);save();
      await display(page,cdp,m);await display(player,playerCdp,m);
      await settleEditor(page);await settleRuntime(player);
      row.confirmation=await geometry(page.getByTestId("preview-launch-panel"));
      row.external=await geometry(player.locator(".dialog-box"));
      row.externalScreenshot=await capture(player,playerCdp,path.join(out,`${row.key}-external.png`),m);
      row.externalText=await player.locator(".dialog-box").innerText();
      assert(row.externalText.includes(project.nodes[1].data.scene.commands[0].text));
      row.status="EXTERNAL_PASS";save();
    }
    if(!ownershipReview)await step("Editor closes actual Player; explicit relaunch creates a new process",async()=>{
      const first=report.players[0];await closePlayer();assert(await page.locator('[data-help-key="preview.close"]:visible').isDisabled());
      const second=await openPlayer();assert.notEqual(identity(first),identity(second));await closePlayer();
      return {first:identity(first),second:identity(second),relaunch:true};
    });
    await top("edit");
    let nodePanel,frame;
    if(!ownershipReview) {
      await page.locator('.react-flow__node[data-id="scene"]').click();
      if(!await page.locator(".preview-panel.is-expanded").isVisible())await page.locator('[data-help-key="preview.openPanel"]').click();
      nodePanel=page.locator(".preview-panel.is-expanded");await nodePanel.waitFor();
      frame=page.frameLocator('iframe[title="GameCLI 内嵌预览"]');
    }
    for(const row of report.cases) {
      await display(page,cdp,row);await settleEditor(page);
      await nodePanel.getByRole("button",{name:"播放",exact:true}).click();
      await frame.getByTestId("game-state-playing").waitFor();
      await frame.locator(".dialog-box").filter({hasText:project.nodes[1].data.scene.commands[0].text}).waitFor();
      row.node=await geometry(nodePanel);
      assert.equal(processes().filter(p=>p.Name==="agentvn-player.exe").length,0);
      await nodePanel.getByRole("button",{name:"设置",exact:true}).click();await frame.getByTestId("settings-screen").waitFor();
      await nodePanel.getByRole("button",{name:"播放",exact:true}).click();await frame.getByTestId("game-state-playing").waitFor();
      await frame.locator(".dialog-box").filter({hasText:project.nodes[1].data.scene.commands[0].text}).waitFor();
      row.nodeText=await frame.locator(".dialog-box").innerText();
      row.nodeScreenshot=await capture(page,cdp,path.join(out,`${row.key}-node.png`),row);
      row.status="PASS";save();console.log(`PASS external + independent node ${row.key}`);
    }
    assert.equal(report.cases.length,ownershipReview?0:process.argv.includes("--smoke")?1:12);
    if(ownershipReview){assert.equal(report.ownershipChecks.length,3);assert(report.ownershipChecks.every(c=>c.status==="PASS"));}
    assert(report.cases.every(c=>c.status==="PASS"));assert.equal(report.modelRequests,0);
    await step("Normal Editor WM_CLOSE releases all owned processes without force",async()=>{
      await page.locator('[data-help-key="toolbar.home"]:visible').click();await page.locator(".project-home").waitFor();
      remember();const h=[...known.values()].find(p=>p.ProcessId===host.pid);assert(h);
      assert.equal(ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${h.ProcessId}';`+
        `if($p.CreationDate.ToUniversalTime().ToString('o') -ne '${h.Created}'){throw 'PID reused'};`+
        `(Get-Process -Id ${h.ProcessId}).CloseMainWindow()`),"True");
      await until(()=>host.exitCode!==null,"normal Editor exit",30000);
      await browser.close().catch(()=>{});browser=null;
      await until(()=>{const now=processes();return ![...known.values()].some(p=>now.some(a=>identity(a)===identity(p)));},"natural descendants exit",15000);
      return {method:"Process.CloseMainWindow WM_CLOSE, not physical input",exitCode:host.exitCode};
    });
    for(const p of [...prep.products,...prep.sources,prep.input])assert.equal(sha(p.path),p.sha256);
    report.status="PASS";
  } catch(e) {
    report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;
    if(page)report.errorBody=await page.locator("body").innerText().catch(()=>"");
  } finally {
    try {
      remember();await sentinelBrowser?.close().catch(()=>{});await playerBrowser?.close().catch(()=>{});await browser?.close().catch(()=>{});
      const killed=[];
      for(const p of [...known.values()].reverse()) {
        if(!processes().some(a=>identity(a)===identity(p)))continue;
        ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';`+
          `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
        killed.push(identity(p));
      }
      const now=processes(),survivors=[...known.values()].filter(p=>now.some(a=>identity(a)===identity(p)));
      const left=listeners(ports);report.cleanup={status:!survivors.length&&!left.length?"PASS":"FAILED",killed,survivors,listeners:left};
      assert.equal(report.cleanup.status,"PASS");
      if(profileJournal&&fs.existsSync(path.join(out,"profile-protection.json"))){profile("Restore");report.profileRestoration=describe(path.join(out,"profile-restoration.json"));}
      for(const p of [...prep.products,...prep.sources,prep.input])assert.equal(sha(p.path),p.sha256);
    } catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";process.exitCode=1;}
    const hostLog=path.join(out,"host.log");
    if(fs.existsSync(hostLog)) {
      const text=fs.readFileSync(hostLog,"utf8");
      if(text.includes("CommandNotFoundException")&&text.includes("gamecli-preview")) {
        report.productDiagnostics=[{id:"PREVIEW-CLOSE-ARGS-01",status:"FAILED",
          observed:"Native preview close fallback emits PowerShell CommandNotFoundException for preview directory argument",
          impact:"Primary owned Child close and relaunch tested separately; fallback scoping not certified",
          evidence:describe(hostLog)}];
        if(report.status==="PASS")report.status="CORE_FLOW_PASS_WITH_PRODUCT_DIAGNOSTIC";
        process.exitCode=1;
      }
    }
    report.finishedAt=new Date().toISOString();report.known=[...known.values()];save();
    console.log(JSON.stringify({status:report.status,out,cases:report.cases.length,error:report.error,cleanupError:report.cleanupError}));
  }
}
(async()=>{if(process.argv[2]==="prepare")await prepare();else{assert.equal(process.argv[2],"run");await run();}})()
  .catch(e=>{console.error(e);process.exitCode=1;});
