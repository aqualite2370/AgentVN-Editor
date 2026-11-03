"use strict";
// Existing compressed frontend + real UI/exported cartridges. Only native IO
// and its completion timing are controlled. Never launches a native window.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt || "", /^(smoke|matrix|recovery-smoke|recovery-matrix)-\d{2}$/);
const recovery=attempt.startsWith("recovery-");
const sourceMode=process.argv.includes("--source");
const out = path.resolve(`F:/AgentVN/QA/Runtime-Hidden-Saves-20261026-01/${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const dist = path.join(root, "GameCli_framework/dist");
const sourceReport = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/hide-installed-1930-01/report.json";
const sha = data => crypto.createHash("sha256").update(data).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const description = file => ({ path: file, sha256: sha(fs.readFileSync(file)) });
const source = read(sourceReport);
assert.equal(source.status, "PASS");
assert.equal(sha(fs.readFileSync(sourceReport)), "ef439dd0528cfcce2bc25a91b59816e9dfeb46bfb9b532c6c96969ec23c48d19");
const owner = crypto.randomUUID();
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: sourceMode ? "SOURCE_RUNTIME_RECOVERY_HEADLESS_SOFTWARE_CONTROLLED_NATIVE_IO_NOT_INSTALLED_NATIVE"
    : recovery ? "COMPRESSED_RUNTIME_RECOVERY_HEADLESS_SOFTWARE_CONTROLLED_NATIVE_IO_NOT_INSTALLED_NATIVE"
    : "EXISTING_COMPRESSED_RUNTIME_HEADLESS_SOFTWARE_CONTROLLED_NATIVE_IO_NOT_INSTALLED_NATIVE",
  desktopInput: 0, modelRequests: 0, productChanges: 0, nativeWindowLaunches: 0,
  fixtures: source.artifacts.map(a => { assert.equal(sha(fs.readFileSync(a.path)), a.sha256); return a; }),
  cases: [], screenshots: [], errors: [], sources: [description(__filename), description(sourceReport),
    ...["components/shell/ExitGameDialog.tsx","utils/runtimeSaveQueue.ts","utils/runtimeExitFlow.ts","store/runtimeStore.ts"]
      .map(f=>description(path.join(root,"GameCli_framework/src",f)))],
  boundaries: { nativeFilesystem: false, nativeExit: false, installedUpgrade: false, Android: false,
    sameTickInputs: "DOM click dispatch through actual handlers, explicitly controlled timing",
    settings: "isolated browser localStorage preset; no source-store access",
    renderer: "forced software; no hardware animation acceptance" } };
const saveReport = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const snapshotDist = () => fs.readdirSync(dist, { recursive: true }).sort()
  .filter(p => /\.(?:js|css|html|json)$/.test(p)).map(p => description(path.join(dist, p)));
const beforeDist = snapshotDist(); report.frontend = beforeDist;
const matrix = attempt.includes("matrix") ? [[1920,1080],[2560,1440],[3840,2160]].flatMap(([width,height]) =>
  [1,2].flatMap(dpr => [false,true].map(reduced => ({width,height,dpr,reduced}))))
  : [{width:1920,height:1080,dpr:1,reduced:false}];
let browser, server, sourceServer, page;
async function assertOwner() {
  if(sourceServer) return sourceServer.assertAlive();
  assert.deepEqual(await(await fetch(`${report.service.url}/owner/${owner}`)).json(),{owner,pid:process.pid});
}
function nativeBoundary({ saves, autoSaveEnabled }) {
  localStorage.setItem("vn.runtime.settings.preview_gamecli", JSON.stringify({
    autoSaveEnabled, textSpeedCps: 0, textSpeed: 0, autoForwardTime: .1,
    skipUnread: true, waitForVoice: false, autoForwardAfterClick: true,
  }));
  const io = window.__boundaryIO = { writes: [], saves, pending: [], mode: "ok",
    exits: 0, sequence: 0, callbacks: {}, listeners: {}, events: [] };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(_event, id) { delete io.listeners[id]; },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: {currentWindow:{label:"main"}},
    transformCallback(fn) { const id=++io.sequence; io.callbacks[id]=fn; return id; },
    unregisterCallback(id) { delete io.callbacks[id]; },
    async invoke(command, args={}) {
      if (command==="list_saves") return structuredClone(io.saves);
      if (command==="read_save") return structuredClone(io.saves.find(s=>s.save_kind===args.kind && s.slot===args.slot)||null);
      if (command==="get_save_storage_info") return {portable:false,sourceDirectory:null,targetDirectory:"controlled-IO",
        availableFiles:[],conflictFiles:[],skippedFiles:[],copiedFiles:[]};
      if (command==="list_gallery_unlocks") return [];
      if (command==="append_frontend_error") { io.events.push({command,args}); return; }
      if (command==="write_save") {
        io.writes.push(structuredClone(args));
        if (io.mode==="fail") throw Error("受控存档写入失败");
        if (io.mode==="hold") await new Promise((resolve,reject)=>io.pending.push({resolve,reject}));
        io.saves=[structuredClone(args.save),...io.saves.filter(s=>!(s.save_kind===args.kind&&s.slot===args.slot))];
        return;
      }
      if (command==="exit_runtime") { io.exits++; return; }
      if (command==="plugin:event|listen") {const id=++io.sequence;io.listeners[id]=args;return id;}
      if (command==="plugin:event|unlisten") {delete io.listeners[args.eventId];return;}
      if (command==="plugin:window|set_title") return;
      throw Error(`Unexpected controlled native command: ${command}`);
    },
  };
}
async function idle() {
  await page.waitForFunction(()=>document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition")==="idle"&&!document.querySelector(".boot-overlay,.game-launch-blackout"));
}
async function position() {
  return page.locator(".story-player").evaluate(e=>({
    scene:e.getAttribute("data-current-scene-id"), index:Number(e.getAttribute("data-current-command-index")),
    text:document.querySelector(".dialog-box")?.textContent,
  }));
}
async function nativeClose() {
  await page.evaluate(()=>{
    const io=window.__boundaryIO;
    const listener=Object.values(io.listeners).find(l=>l.event==="tauri://close-requested");
    if(!listener) throw Error("No real native-close listener");
    io.callbacks[listener.handler]({event:"tauri://close-requested",id:100,payload:null});
  });
  await page.getByRole("dialog",{name:"退出游戏？",exact:true}).waitFor();
}
async function expand(layout) {
  if(layout==="agentvn" && await page.getByTestId("quick-menu-toggle").getAttribute("aria-expanded")!=="true") {
    await page.getByTestId("quick-menu-toggle").click();
    await page.waitForFunction(()=>document.querySelector(".quick-menu-action-layer")?.inert===false);
  }
}
function hideButton(layout) {
  return layout==="renpy"?page.getByTestId("renpy-quick-hide"):page.getByRole("button",{name:"隐藏界面",exact:true});
}
async function initialize(context,layout,enabled,saves=[]) {
  page=await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror",error=>report.errors.push(String(error)));
  await page.addInitScript(nativeBoundary,{saves,autoSaveEnabled:enabled});
  await page.goto(`${report.service.url}/?mode=preview`);
  await page.waitForFunction(()=>document.querySelector("#root")?.childElementCount);
  // Use the public complete-cartridge preview protocol. Unlike live layout
  // previews it deliberately enters fixed mode with real save queues enabled.
  const fixture=report.fixtures.find(f=>f.layout===layout);
  await page.evaluate(base64=>window.postMessage({type:"agentvn.runtime.preview",
    cartridgeBase64:base64,fileName:"boundary.vncart",previewNonce:"boundary-initial"},"*"),
  fs.readFileSync(fixture.path).toString("base64"));
  await page.getByTestId("start-new-game").waitFor(); await idle();
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor(); await idle();
  await page.waitForFunction(()=>document.querySelector(".story-player")?.getAttribute("data-is-typing")==="false");
  await page.waitForFunction(()=>Object.values(window.__boundaryIO.listeners).some(l=>l.event==="tauri://close-requested"));
}
async function checkSnapshot(before,kind) {
  const saves=await page.evaluate(()=>window.__boundaryIO.saves);
  const saved=saves.find(s=>s.save_kind===kind);
  assert(saved,`Actual ${kind} write completed`);
  assert.equal(saved.scene_id,before.scene); assert.equal(saved.command_index,before.index);
  assert(saved.dialog?.text && before.text.includes(saved.dialog.text),"Saved dialogue matches the visible current sentence");
  assert.equal(saved.history.at(-1)?.text,saved.dialog.text,"History must include the current sentence exactly");
  assert(!JSON.stringify(saved).includes("isUiHidden"),"Temporary visibility must not enter snapshots");
  return saved;
}
async function operation(row,name,fn) {
  const entry={name,status:"RUNNING"}; row.operations.push(entry); saveReport();
  try {entry.detail=await fn(); entry.status="PASS";}
  catch(error){entry.status="FAILED";entry.error=String(error.stack||error);throw error;}
  finally {
    if(page)entry.io=await page.evaluate(()=>({
      writes:window.__boundaryIO.writes.map(w=>({kind:w.kind,slot:w.slot,save:w.save})),
      saves:window.__boundaryIO.saves,pending:window.__boundaryIO.pending.length,
      exitCalls:window.__boundaryIO.exits,events:window.__boundaryIO.events,
    })).catch(()=>undefined);
    saveReport();
  }
}
async function manualFailure(context,layout) {
  await initialize(context,layout,false);
  const before=await position();
  await expand(layout);
  if(layout==="renpy") await page.getByTestId("renpy-quick-save-load").click();
  else await page.getByRole("button",{name:"打开存档读档",exact:true}).click();
  await idle();
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await page.evaluate(()=>{window.__boundaryIO.mode="hold";});
  await page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
  await page.waitForFunction(()=>window.__boundaryIO.pending.length===1);
  // The slot is disabled while writing. Give the native-close simulation a
  // real, still-enabled focus owner; restoring a disabled slot is impossible.
  await page.getByRole("button",{name:"保存",exact:true}).focus();
  assert(await page.getByRole("button",{name:"保存",exact:true})
    .evaluate(button=>!button.disabled&&button===document.activeElement));
  await nativeClose();await page.getByTestId("confirm-exit-game").click();
  await page.evaluate(()=>{window.__boundaryIO.pending.splice(0)
    .forEach(p=>p.reject(Error("受控已在途写入失败")));});
  await page.getByTestId("discard-exit-save").waitFor();
  assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0);
  return before;
}
async function dialogGeometry() {
  const result=await page.getByRole("dialog",{name:"退出游戏？",exact:true}).evaluate(panel=>{
    const rect=panel.getBoundingClientRect();
    return {inside:rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,
      focused:panel.contains(document.activeElement),
      buttons:[...panel.querySelectorAll("button")].map(button=>{
        const r=button.getBoundingClientRect();
        return {label:button.textContent,disabled:button.disabled,
          hit:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
          clipped:button.scrollWidth>button.clientWidth+1};
      })};
  });
  assert(result.inside&&result.focused);
  assert(result.buttons.every(b=>!b.clipped&&(b.disabled||b.hit)));
  return result;
}
async function recoveryCell(m,layout) {
  const row={...m,layout,status:"RUNNING",operations:[]};report.cases.push(row);saveReport();
  const context=await browser.newContext({viewport:{width:m.width,height:m.height},
    deviceScaleFactor:m.dpr,reducedMotion:m.reduced?"reduce":"no-preference"});
  try {
    const failedPosition=await manualFailure(context,layout);
    await operation(row,"disabled autosave returns to manual save; failed resave stays open; successful resave permits exit",async()=>{
      const before=failedPosition;
      const geometry=await dialogGeometry();
      assert.equal(await page.getByTestId("retry-exit-save").count(),0,
        "Disabled autosave cannot offer a retry that merely drains an empty queue");
      await page.getByRole("button",{name:"返回游戏重新保存",exact:true}).click();
      await page.getByRole("dialog",{name:"退出游戏？",exact:true}).waitFor({state:"hidden"});
      assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0);
      assert(await page.getByRole("button",{name:"保存",exact:true}).evaluate(button=>button===document.activeElement),
        "Closing the exit dialog restores the enabled pre-dialog focus owner");
      assert(await page.getByTestId("save-slot-manual-1").locator(".save-card-main").isVisible());
      await page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
      await page.waitForFunction(()=>window.__boundaryIO.pending.length===1);
      await nativeClose();await page.getByTestId("confirm-exit-game").click();
      await page.evaluate(()=>{window.__boundaryIO.pending.splice(0)
        .forEach(p=>p.reject(Error("受控已在途写入失败")));});
      await page.getByTestId("discard-exit-save").waitFor();
      assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0,"Repeated failure still blocks exit");
      await page.getByRole("button",{name:"返回游戏重新保存",exact:true}).click();
      await page.getByRole("dialog",{name:"退出游戏？",exact:true}).waitFor({state:"hidden"});
      await page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
      await page.waitForFunction(()=>window.__boundaryIO.pending.length===1);
      await nativeClose();await page.getByTestId("confirm-exit-game").dblclick();
      assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0);
      await page.evaluate(()=>{const io=window.__boundaryIO;io.mode="ok";io.pending.splice(0).forEach(p=>p.resolve());});
      await page.waitForFunction(()=>window.__boundaryIO.exits===1);
      const saved=await checkSnapshot(before,"manual");
      const writes=await page.evaluate(()=>window.__boundaryIO.writes);
      assert.equal(writes.length,3);assert(writes.every(w=>w.kind==="manual"&&w.slot===1));
      assert.equal(saved.slot,1);
      return {before,geometry,failedAttempts:2,successfulSaves:1,retryExitCalls:0,finalExitCalls:1,autoWrites:0};
    });
    await page.close();await manualFailure(context,layout);
    await operation(row,"disabled autosave discard requires second confirmation and supports cancel",async()=>{
      await page.getByTestId("discard-exit-save").click();
      await page.getByRole("dialog",{name:"确认放弃保存？",exact:true}).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog",{name:"确认放弃保存？",exact:true}).waitFor({state:"hidden"});
      assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0);
      await page.getByTestId("discard-exit-save").click();
      await page.getByTestId("confirm-discard-exit").click();
      await page.waitForFunction(()=>window.__boundaryIO.exits===1);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.writes.length),1);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.saves.length),0);
      return {cancelStayedOpen:true,confirmedDiscard:true,autoWrites:0};
    });
    await page.close();await initialize(context,layout,true);
    await operation(row,"enabled autosave retry really writes and waits; duplicate submit merged",async()=>{
      const before=await position();
      await page.evaluate(()=>{window.__boundaryIO.mode="hold";});
      await nativeClose();await page.getByTestId("confirm-exit-game").click();
      await page.waitForFunction(()=>window.__boundaryIO.pending.length===1);
      await page.evaluate(()=>{window.__boundaryIO.pending.splice(0)
        .forEach(p=>p.reject(Error("受控已在途写入失败")));});
      await page.getByTestId("retry-exit-save").waitFor();
      const geometry=await dialogGeometry();
      await page.getByTestId("retry-exit-save").dblclick();
      await page.waitForFunction(()=>window.__boundaryIO.pending.length===1);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.writes.length),2);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0);
      assert(await page.getByTestId("confirm-exit-game").isDisabled(),
        "Retry clears the error state, but the pending exit action remains disabled");
      await page.evaluate(()=>{const io=window.__boundaryIO;io.mode="ok";io.pending.splice(0).forEach(p=>p.resolve());});
      await page.waitForFunction(()=>window.__boundaryIO.exits===1);
      await checkSnapshot(before,"auto");
      return {before,geometry,actualRetryWrites:1,exitCalls:1};
    });
    await page.close();await initialize(context,layout,false);
    await operation(row,"disabled autosave with no pending task never forces a save",async()=>{
      await nativeClose();await page.getByTestId("confirm-exit-game").click();
      await page.waitForFunction(()=>window.__boundaryIO.exits===1);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.writes.length),0);
      return {exitCalls:1,writes:0};
    });
    const display=()=>page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
      reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
    const before=await display();assert.deepEqual(before,m);
    const file=path.join(out,`${layout}-${m.width}-${m.dpr}-${m.reduced}.png`);
    const bytes=await page.screenshot({path:file});const after=await display();
    assert.deepEqual(after,before);
    assert.equal(bytes.readUInt32BE(16),m.width*m.dpr);assert.equal(bytes.readUInt32BE(20),m.height*m.dpr);
    report.screenshots.push({...description(file),before,after,width:m.width*m.dpr,height:m.height*m.dpr});
    row.status="PASS";console.log(`PASS recovery ${layout} ${m.width} DPR${m.dpr} reduced=${m.reduced} (4 flows)`);
  }catch(error){
    row.status="FAILED";row.error=String(error.stack||error);
    if(page) {
      await page.screenshot({path:path.join(out,`failure-${layout}-${m.width}-${m.dpr}-${m.reduced}.png`)}).catch(()=>{});
      row.diagnostic=await page.evaluate(()=>({body:document.body.innerText,io:{
        writes:window.__boundaryIO?.writes,saves:window.__boundaryIO?.saves,exits:window.__boundaryIO?.exits}})).catch(()=>null);
    }
    throw error;
  }finally{await context.close();page=undefined;saveReport();}
}
async function testCell(m,layout) {
  const row={...m,layout,status:"RUNNING",operations:[]};report.cases.push(row);saveReport();
  const context=await browser.newContext({viewport:{width:m.width,height:m.height},
    deviceScaleFactor:m.dpr,reducedMotion:m.reduced?"reduce":"no-preference"});
  try {
    await initialize(context,layout,true);
    await operation(row,"same-tick auto/skip/hide and held-key release",async()=>{
      await expand(layout); const before=await position();
      const armed=await page.evaluate(layout=>{
        const find=id=>document.querySelector(`[data-ui-component-id="${id}"] button,button[data-ui-component-id="${id}"]`);
        const get=(id,fallback)=>document.querySelector(`[data-testid="${id}"]`)||find(fallback);
        const auto=get("renpy-quick-auto","quick_auto_button"),skip=get("renpy-quick-skip","quick_skip_button");
        const hide=get("renpy-quick-hide","quick_hide_ui_button");
        if(!auto||!skip||!hide)throw Error("Missing production actions");
        document.dispatchEvent(new KeyboardEvent("keydown",{key:"Control",bubbles:true}));
        auto.click();skip.click();hide.click();
        document.dispatchEvent(new KeyboardEvent("keyup",{key:"Control",bubbles:true}));
        return {layout,dispatched:["Control down","auto","skip","hide","Control up"]};
      },layout);
      await page.waitForFunction(()=>document.querySelector(".story-interface")?.inert===true);
      await page.waitForTimeout(850); // Negative assertion beyond the real 60ms skip/300ms minimum auto timers.
      assert.deepEqual(await position(),before,"Hidden UI suspends already-armed advancement");
      const resumed=await page.evaluate(async()=>{
        document.dispatchEvent(new KeyboardEvent("keydown",{key:"h",bubbles:true}));
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const find=id=>document.querySelector(`[data-testid="renpy-quick-${id}"]`)
          ||document.querySelector(`button[data-ui-component-id="quick_${id}_button"]`);
        const auto=find("auto"),skip=find("skip");
        const states={auto:auto?.getAttribute("aria-pressed"),skip:skip?.getAttribute("aria-pressed")};
        auto.click();skip.click();return states;
      });
      assert.deepEqual(resumed,{auto:"true",skip:"true"},"Restore preserves prior toggle modes");
      await page.waitForFunction(()=>document.querySelector(".story-interface")?.inert===false);
      assert.deepEqual(await position(),before,"Restore event does not advance");
      return {before,armed,resumed,negativeObservationMs:850};
    });
    let hiddenSave;
    await operation(row,"hidden-time exit waits for actual controlled write, duplicate submit merged",async()=>{
      await expand(layout); await hideButton(layout).click();
      await page.waitForFunction(()=>document.querySelector(".story-interface")?.inert===true);
      const before=await position();
      await page.evaluate(()=>{window.__boundaryIO.mode="hold";});
      await nativeClose();
      await page.getByTestId("confirm-exit-game").dblclick();
      await page.waitForFunction(()=>window.__boundaryIO.pending.length===1);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0);
      assert.equal(await page.getByTestId("confirm-exit-game").isDisabled(),true);
      assert.equal(await page.locator(".story-interface").getAttribute("aria-hidden"),"true");
      await page.evaluate(()=>{const io=window.__boundaryIO;io.mode="ok";io.pending.splice(0).forEach(p=>p.resolve());});
      await page.waitForFunction(()=>window.__boundaryIO.exits===1);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.writes.length),1);
      hiddenSave=await checkSnapshot(before,"auto");
      return {before,snapshot:hiddenSave,exitCalls:1,writeCalls:1};
    });
    await page.close();
    await initialize(context,layout,false,[hiddenSave]);
    await operation(row,"hidden-time save reload does not restore temporary hidden state",async()=>{
      assert.equal(await page.locator(".story-interface").getAttribute("aria-hidden"),"false");
      // Read the recorded auto slot through the actual load UI, not a store API.
      await expand(layout);
      if(layout==="renpy")await page.getByTestId("renpy-quick-save-load").click();
      else await page.getByRole("button",{name:"打开存档读档",exact:true}).click();
      await idle();
      await page.getByRole("tab",{name:"自动",exact:true}).click();
      await page.getByTestId(`save-slot-auto-${hiddenSave.slot}`).locator(".save-card-main").click();
      await page.getByTestId("game-state-playing").waitFor(); await idle();
      assert.equal(await page.locator(".story-interface").getAttribute("aria-hidden"),"false");
      assert.equal((await position()).index,hiddenSave.command_index);
      return {readSlot:hiddenSave.slot,sameCommand:true,hidden:false};
    });
    await operation(row,"autosave disabled waits for existing manual write without creating auto",async()=>{
      const before=await position(); await expand(layout);
      if(layout==="renpy")await page.getByTestId("renpy-quick-save-load").click();
      else await page.getByRole("button",{name:"打开存档读档",exact:true}).click();
      await idle(); await page.getByRole("tab",{name:"手动",exact:true}).click();
      await page.getByRole("button",{name:"保存",exact:true}).click();
      await page.evaluate(()=>{window.__boundaryIO.mode="hold";});
      await page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
      await page.waitForFunction(()=>window.__boundaryIO.pending.length===1);
      await nativeClose(); await page.getByTestId("confirm-exit-game").click();
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0);
      await page.evaluate(()=>{const io=window.__boundaryIO;io.mode="ok";io.pending.splice(0).forEach(p=>p.resolve());});
      await page.waitForFunction(()=>window.__boundaryIO.exits===1);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.writes.length),1,"No forced auto with autosave disabled");
      const saved=await checkSnapshot(before,"manual");
      assert.equal(saved.slot,1);
      return {before,kind:"manual",writeCalls:1,exitCalls:1};
    });
    await page.close(); await initialize(context,layout,false);
    await operation(row,"failed in-flight manual write blocks exit and supports explicit retry",async()=>{
      await expand(layout);
      if(layout==="renpy")await page.getByTestId("renpy-quick-save-load").click();
      else await page.getByRole("button",{name:"打开存档读档",exact:true}).click();
      await idle(); await page.getByRole("button",{name:"保存",exact:true}).click();
      await page.evaluate(()=>{window.__boundaryIO.mode="hold";});
      await page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
      await page.waitForFunction(()=>window.__boundaryIO.pending.length===1);
      await nativeClose(); await page.getByTestId("confirm-exit-game").click();
      await page.evaluate(()=>{window.__boundaryIO.pending.splice(0).forEach(p=>p.reject(Error("受控已在途写入失败")));});
      await page.getByTestId("return-to-save").waitFor();
      assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0);
      assert.match(await page.getByRole("dialog",{name:"退出游戏？",exact:true}).innerText(),/受控已在途写入失败/);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.saves.length),0);
      assert.equal(await page.getByTestId("retry-exit-save").count(),0);
      await page.getByTestId("return-to-save").click();
      await page.getByRole("dialog",{name:"退出游戏？",exact:true}).waitFor({state:"hidden"});
      assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0,"Returning to resave cannot close the game");
      await page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
      await page.waitForFunction(()=>window.__boundaryIO.pending.length===1);
      await nativeClose();await page.getByTestId("confirm-exit-game").click();
      assert.equal(await page.evaluate(()=>window.__boundaryIO.exits),0);
      await page.evaluate(()=>{const io=window.__boundaryIO;io.mode="ok";io.pending.splice(0).forEach(p=>p.resolve());});
      await page.waitForFunction(()=>window.__boundaryIO.exits===1);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.writes.length),2);
      assert.equal(await page.evaluate(()=>window.__boundaryIO.saves.length),1);
      assert(await page.evaluate(()=>window.__boundaryIO.writes.every(w=>w.kind==="manual")));
      return {blockedBeforeRetry:true,afterExplicitRetry:"manual-resaved-before-exit",unexpectedAutoWrites:0};
    });
    const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
      reduced:matchMedia("(prefers-reduced-motion: reduce)").matches,
      invalidFocus:Boolean(document.activeElement?.closest("[inert],[aria-hidden=true]")),
      overflow:document.documentElement.scrollWidth-innerWidth}));
    assert.deepEqual({width:actual.width,height:actual.height,dpr:actual.dpr,reduced:actual.reduced},m);
    assert(!actual.invalidFocus&&actual.overflow<=1);
    const file=path.join(out,`${layout}-${m.width}-${m.dpr}-${m.reduced}.png`);
    const bytes=await page.screenshot({path:file});
    assert.equal(bytes.readUInt32BE(16),m.width*m.dpr);assert.equal(bytes.readUInt32BE(20),m.height*m.dpr);
    assert.deepEqual(await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
      reduced:matchMedia("(prefers-reduced-motion: reduce)").matches})),m);
    report.screenshots.push({...description(file),before:actual,width:m.width*m.dpr,height:m.height*m.dpr});
    row.status="PASS";console.log(`PASS ${layout} ${m.width} DPR${m.dpr} reduced=${m.reduced} (${row.operations.length} operations)`);
  } catch(error){
    row.status="FAILED";row.error=String(error.stack||error);
    if(page) {
      await page.screenshot({path:path.join(out,`failure-${layout}-${m.width}-${m.dpr}-${m.reduced}.png`)}).catch(()=>{});
      row.diagnostic=await page.evaluate(()=>({url:location.href,body:document.body.innerText,
        display:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
        events:window.__boundaryIO?.events})).catch(()=>null);
    }
    throw error;
  }
  finally {await context.close();page=undefined;saveReport();}
}
async function main() {
  saveReport();
  const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",
    ".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon"};
  if(sourceMode) {
    sourceServer=await startOwnedViteServer({root:path.join(root,"GameCli_framework"),
      configFile:path.join(root,"GameCli_framework/vite.config.cjs"),logFile:path.join(out,"source-server.log")});
    report.service={url:sourceServer.url,pid:sourceServer.pid,owner:sourceServer.runId,
      ownerPath:`/__agentvn_acceptance_owner/${sourceServer.runId}`,mode:"source-owned-vite"};
  }else {
    server=http.createServer((req,res)=>{
    const url=new URL(req.url,"http://localhost");
    if(url.pathname===`/owner/${owner}`){res.setHeader("content-type","application/json");
      res.end(JSON.stringify({owner,pid:process.pid}));return;}
    const file=path.resolve(dist,"."+decodeURIComponent(url.pathname==="/"?"/index.html":url.pathname));
    if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader("content-type",mime[path.extname(file)]||"application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
    report.service={url:`http://127.0.0.1:${server.address().port}`,owner,pid:process.pid,createdAt:new Date().toISOString(),
      ownerPath:`/owner/${owner}`,mode:"compressed-static"};
  }
  await assertOwner();
  browser=await chromium.launch({headless:true,args:["--disable-gpu","--use-angle=swiftshader"]});
  const diagnostics=await browser.newBrowserCDPSession();
  report.renderer=(await diagnostics.send("SystemInfo.getInfo")).gpu;
  await diagnostics.detach();
  for(const m of matrix)for(const layout of ["renpy","agentvn"]) {
    await (recovery?recoveryCell:testCell)(m,layout);
    await assertOwner();
  }
  assert.equal(report.cases.length,matrix.length*2);
  assert(report.cases.every(c=>c.status==="PASS"&&c.operations.length===(recovery?4:5)&&c.operations.every(o=>o.status==="PASS")));
  assert.deepEqual(report.errors,[]);
  assert.deepEqual(snapshotDist(),beforeDist,"Frozen frontend must not be rebuilt or modified");
  report.status="PASS";
}
main().catch(async error=>{
  report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;
  if(page)await page.screenshot({path:path.join(out,"failure.png")}).catch(()=>{});
}).finally(async()=>{
  try {
    await browser?.close();
    await sourceServer?.stop();
    if(server)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    if(report.service) {
      let unavailable=false;
      try{await fetch(`${report.service.url}${report.service.ownerPath}`,{signal:AbortSignal.timeout(700)});}
      catch{unavailable=true;}
      assert(unavailable,"Owned static service must stop");
    }
    report.cleanupStatus="PASS";
  }catch(error){report.status="FAILED";report.cleanupStatus="FAILED";report.cleanupError=String(error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();saveReport();
  console.log(JSON.stringify({status:report.status,cells:report.cases.length,
    operations:report.cases.reduce((n,c)=>n+c.operations.filter(o=>o.status==="PASS").length,0),
    cleanup:report.cleanupStatus,error:report.error,out}));
});
