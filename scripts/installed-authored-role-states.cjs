"use strict";
// Real supported user actions in the frozen installed Player. Never force a
// disabled/selected DOM state to manufacture coverage.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-layout-author-review-20261019-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const attempt = process.argv[2] || "01"; assert(/^\d{2}$/.test(attempt));
const out = path.join(run, `role-states-${attempt}`);
const pictures = `F:/AgentVN/QA/Layout-Author-20261019-01/role-states-${attempt}`;
assert(!fs.existsSync(out) && !fs.existsSync(pictures)); fs.mkdirSync(out); fs.mkdirSync(pictures);
const prep = read(path.join(run,"preparation.json")), fixture = read(path.join(run,"fixtures.json"));
const exported = read(path.join(run,"export-01/report.json")), saved = read(path.join(run,"save-01/report.json"));
assert.equal(exported.status,"PASS"); assert.equal(saved.status,"PASS");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT),path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT),path.resolve(run));
const roles = saved.authored.settings.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.buttonRoles;
const rgb = c => `rgb(${[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)).join(", ")})`;
const report = {status:"RUNNING",at:new Date().toISOString(),checks:[],matrix:[],launches:[],screenshots:[],pageErrors:[],
  productChanges:0,modelRequests:0,error:null,violations:[],source:{path:exported.cartridge.path,sha256:exported.cartridge.sha256},
  scope:"ACTUAL_INSTALLED_LIBRARY_PLAYER_NATURAL_AUTHORED_ROLE_STATES_NOT_SETUP_ANDROID_OR_FULL_24_STATE_COVERAGE",
  nativePickerClaim:false, remaining:["title selected has no persistent user state",
    "title/navigation transient disabled not sampled","story choice selected/disabled not sampled",
    "modal selected/disabled not sampled","complete six-role state coverage remains unproved"]};
const save = ()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let s;
async function sample(locator,role,state) {
  await locator.waitFor(); await settleRuntime(s.page);
  const actual=await locator.evaluate(n=>{
    const r=n.getBoundingClientRect(),c=getComputedStyle(n);
    const textRects=[],walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      if(!walker.currentNode.textContent.trim())continue;
      const range=document.createRange();range.selectNodeContents(walker.currentNode);
      textRects.push(...[...range.getClientRects()].map(r=>r.toJSON()));
    }
    return {label:n.textContent.trim(),rect:r.toJSON(),color:c.color,disabled:n.disabled,
      state:n.dataset.renpyRoleState,focused:document.activeElement===n,focusVisible:n.matches(":focus-visible"),
      hover:n.matches(":hover"),hit:n.disabled||n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
      clipped:n.scrollWidth>n.clientWidth+1,opacity:+c.opacity,width:innerWidth,height:innerHeight,
      overflow:document.documentElement.scrollWidth-innerWidth,
      scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,font:c.fontSize,
      paddingLeft:c.paddingLeft,paddingRight:c.paddingRight,
      overflowX:c.overflowX,overflowY:c.overflowY,textRects,
      roleWidth:c.getPropertyValue("--renpy-role-width"),roleFont:c.getPropertyValue("--renpy-role-font-size")};
  });
  const r=actual.rect;
  actual.textOutsideButton=actual.textRects.some(t=>t.left<r.left-1||t.right>r.right+1||t.top<r.top-1||t.bottom>r.bottom+1);
  // Retain every original boundary/color assertion. Accumulate failures so
  // independent viewports and focus operations still execute; the run cannot
  // PASS when any sample violates the original contract.
  try{
    assert(actual.hit&&!actual.clipped&&!actual.textOutsideButton&&actual.opacity>0&&actual.overflow<=1&&r.width>0&&r.height>0
      &&r.left>=-1&&r.top>=-1&&r.right<=actual.width+1&&r.bottom<=actual.height+1,JSON.stringify(actual));
    assert.equal(actual.color,rgb(roles[role].states[state].textColor),`${role}/${state}: ${JSON.stringify(actual)}`);
  }catch(e){
    report.violations.push({viewport:{...s.expected},role,expectedState:state,actual,error:String(e.stack||e)});
    save();
  }
  return {role,expectedState:state,...actual};
}
function envelope(a,b) {
  for(const k of ["x","y","width","height"])assert(Math.abs(a.rect[k]-b.rect[k])<=.15,
    `State changed geometry ${k}: ${JSON.stringify([a.rect,b.rect])}`);
}
async function check(name,fn) {
  const row={name,status:"RUNNING"};report.checks.push(row);save();
  try{row.detail=await fn();row.status="PASS";console.log(`PASS ${name}`)}
  catch(e){row.status="FAILED";row.error=String(e.stack||e);throw e}
  finally{save()}
}
async function keyboardReach(locator) {
  for(let i=0;i<70;i++){
    if(await locator.evaluate(n=>document.activeElement===n))return i;
    await s.page.keyboard.press("Tab");
  }
  throw Error("Actual Tab navigation did not reach the intended visible control");
}
async function assertModalGeometry(modal) {
  const actual=await modal.evaluate(n=>{
    const rect=n.getBoundingClientRect().toJSON();
    return {rect,width:innerWidth,height:innerHeight,
      buttons:[...n.querySelectorAll("button")].map(b=>{
        const r=b.getBoundingClientRect();
        return {label:b.textContent.trim()||b.getAttribute("aria-label"),rect:r.toJSON(),
          clipped:b.scrollWidth>b.clientWidth+1,
          hit:b.disabled||b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
      })};
  });
  assert(actual.rect.left>=-1&&actual.rect.top>=-1&&actual.rect.right<=actual.width+1
    &&actual.rect.bottom<=actual.height+1,JSON.stringify(actual));
  for(const b of actual.buttons){
    try{
      assert(b.hit&&!b.clipped&&b.rect.left>=actual.rect.left-1
        &&b.rect.right<=actual.rect.right+1&&b.rect.top>=actual.rect.top-1&&b.rect.bottom<=actual.rect.bottom+1,
      JSON.stringify(b));
    }catch(e){
      report.violations.push({viewport:{...s.expected},role:"modal_action",expectedState:"geometry",
        actual:b,error:String(e.stack||e)});save();
    }
  }
  for(let i=0;i<actual.buttons.length;i++)for(let j=i+1;j<actual.buttons.length;j++){
    const a=actual.buttons[i].rect,b=actual.buttons[j].rect;
    assert(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1
      ||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1,"Modal controls overlap");
  }
  return actual;
}
(async()=>{
  s=new InstalledRuntimeSession({prep,fixture,cartridges:[{...exported.cartridge,layout:"renpy"}],out:pictures,
    report,save,installId:"qa_authored_roles_20261019"});
  await check("Actual installed library Player consumes the unchanged authored all-role cartridge",async()=>{
    await s.start("renpy",false);
    assert.equal(sha(s.launch.library.record.cartridgePath),exported.cartridge.sha256);
    return {exe:s.exe,sha256:sha(s.exe),nativeLibraryPreparation:true,nativePickerClaim:false};
  });
  await check("Natural category/page/modal states, keyboard focus and non-resizing envelopes12 desktop combinations",async()=>{
    for(const [width,height] of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of [1,2])
      for(const reduced of [false,true]){
        await s.viewport({width,height,dpr,reduced});const p=s.page;
        const row={viewport:s.expected,status:"RUNNING",samples:[]};report.matrix.push(row);save();
        await p.mouse.move(0,0);
        const start=p.getByTestId("start-new-game");
        const normal=await sample(start,"title_action","normal");row.samples.push(normal);
        await start.hover();const hover=await sample(start,"title_action","hover");envelope(normal,hover);row.samples.push(hover);
        await p.getByTestId("open-settings").click();await s.ready("settings");await p.mouse.move(0,0);
        const tab=p.locator('.settings-tabs button[data-renpy-role-state="normal"]').first();
        const label=await tab.innerText(),chosen=p.locator(".settings-tabs").getByRole("button",{name:label.trim(),exact:true});
        const idle=await sample(chosen,"category_pagination","normal");row.samples.push(idle);
        await chosen.hover();const tabHover=await sample(chosen,"category_pagination","hover");
        envelope(idle,tabHover);row.samples.push(tabHover);
        await chosen.click();await p.mouse.move(0,0);
        const selected=await sample(chosen,"category_pagination","selected");envelope(idle,selected);row.samples.push(selected);
        assert.equal(await chosen.getAttribute("aria-pressed"),"true");
        const navigation=p.getByTestId("renpy-menu-help");
        const navIdle=await sample(navigation,"page_navigation","normal");row.samples.push(navIdle);
        await navigation.hover();const navHover=await sample(navigation,"page_navigation","hover");
        envelope(navIdle,navHover);row.samples.push(navHover);
        await p.mouse.move(0,0);
        row.navigationTabSteps=await keyboardReach(navigation);
        const navFocus=await sample(navigation,"page_navigation","hover");
        assert(navFocus.focused&&navFocus.focusVisible);
        envelope(navIdle,navFocus);row.samples.push(navFocus);
        await p.keyboard.press("Enter");await s.ready("help");
        const selectedNavigation=p.getByTestId("renpy-menu-help");
        // The pinned design emphasizes focus-visible even on the current
        // page. Test that state separately, then move focus through a real
        // Tab before asserting the unfocused selected appearance.
        const selectedFocus=await sample(selectedNavigation,"page_navigation","hover");
        assert(selectedFocus.focused&&selectedFocus.focusVisible&&selectedFocus.state==="selected");
        row.samples.push(selectedFocus);
        await p.keyboard.press("Tab");
        const navSelected=await sample(selectedNavigation,"page_navigation","selected");
        assert(!navSelected.focused);envelope(selectedFocus,navSelected);row.samples.push(navSelected);
        await p.getByTestId("renpy-menu-save-load").click();await s.ready("save_load");await p.mouse.move(0,0);
        row.samples.push(await sample(p.getByTestId("save-page-previous"),"category_pagination","disabled"));
        const next=p.getByTestId("save-page-next");assert(await next.isEnabled());
        const nextNormal=await sample(next,"category_pagination","normal");row.samples.push(nextNormal);
        await next.hover();const nextHover=await sample(next,"category_pagination","hover");envelope(nextNormal,nextHover);row.samples.push(nextHover);
        await next.click();await p.mouse.move(0,0);
        assert(await p.getByTestId("save-page-previous").isEnabled());
        await p.getByTestId("save-page-previous").click();await p.mouse.move(0,0);
        assert(await p.getByTestId("save-page-previous").isDisabled());
        const auto=p.getByRole("tab",{name:"自动",exact:true});await auto.click();await p.mouse.move(0,0);
        row.samples.push(await sample(auto,"category_pagination","selected"));
        assert.equal(await auto.getAttribute("aria-selected"),"true");
        await p.getByTestId("renpy-menu-exit").click();
        const modal=p.getByRole("dialog",{name:"退出游戏？",exact:true});await modal.waitFor();await p.mouse.move(0,0);
        const exit=modal.getByTestId("confirm-exit-game"),cancel=modal.getByRole("button",{name:"取消",exact:true});
        const modalNormal=await sample(exit,"modal_action","normal");row.samples.push(modalNormal);
        await exit.hover();const modalHover=await sample(exit,"modal_action","hover");envelope(modalNormal,modalHover);row.samples.push(modalHover);
        assert(await cancel.evaluate(n=>document.activeElement===n),"Actual initial modal focus must be cancel");
        await p.mouse.move(0,0);row.modalGeometry=await assertModalGeometry(modal);
        row.modalTabSteps=await keyboardReach(exit);
        const modalFocus=await sample(exit,"modal_action","hover");
        assert(modalFocus.focused&&modalFocus.focusVisible);
        envelope(modalNormal,modalFocus);row.samples.push(modalFocus);
        for(let i=0;i<5;i++){
          await p.keyboard.press("Tab");
          assert(await modal.evaluate(n=>n.contains(document.activeElement)),"Tab escaped actual modal");
        }
        await p.keyboard.press("Shift+Tab");
        assert(await modal.evaluate(n=>n.contains(document.activeElement)));
        await s.shot(`${width}-dpr${dpr}-${reduced?"reduced":"normal"}-modal`);
        await p.keyboard.press("Escape");await modal.waitFor({state:"hidden"});await s.ready("save_load");
        assert(await p.getByTestId("renpy-menu-exit").evaluate(n=>document.activeElement===n),
          "Escape must restore focus to the actual modal opener");
        await p.getByTestId("renpy-menu-return").click();await s.ready("title_menu");
        row.executed=true;
        row.violations=report.violations.filter(v=>JSON.stringify(v.viewport)===JSON.stringify(row.viewport)).length;
        row.status=row.violations?"FAILED":"PASS";save();
        console.log(`${row.status} authored roles ${width} dpr${dpr} reduced=${reduced} violations=${row.violations}`);
      }
    assert.equal(report.matrix.length,12);assert(report.matrix.every(r=>r.executed&&r.samples.length===17));
    assert.equal(report.violations.length,0,"Rendered role-state boundary/color contract violations remain; see raw violations");
    return {combinations:12,actualSamples:report.matrix.reduce((n,r)=>n+r.samples.length,0),
      categoryFourNaturalStates:true,modalNormalHoverKeyboard:true,
      focusVisibleOverridesSelectedAsPinned:true,full24StateClaim:false};
  });
  assert.deepEqual(report.pageErrors,[]);report.status="PASS";
})().catch(async e=>{
  report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;
  if(s?.page)await s.shot("failure").catch(e=>{report.screenshotError=String(e)});
}).finally(async()=>{
  if(s)try{await s.stop()}catch(e){report.cleanupError=String(e);report.status="FAILED";process.exitCode=1}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,matrix:report.matrix.length,error:report.error,out}));
});
