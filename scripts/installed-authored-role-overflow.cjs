"use strict";
// Read-only rendered geometry probe: no styles, DOM states or game data changed.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {InstalledRuntimeSession,sha}=require("./lib/installed-runtime-session.cjs");
const run="D:/AgentVN/output/installed-layout-author-review-20261019-01";
const attempt=process.argv[2]||"01";assert(/^\d{2}$/.test(attempt));
const out=path.join(run,`role-overflow-${attempt}`);
const pictures=`F:/AgentVN/QA/Layout-Author-20261019-01/role-overflow-${attempt}`;
assert(!fs.existsSync(out)&&!fs.existsSync(pictures));fs.mkdirSync(out);fs.mkdirSync(pictures);
const read=p=>JSON.parse(fs.readFileSync(path.join(run,p),"utf8").replace(/^\uFEFF/,""));
const prep=read("preparation.json"),fixture=read("fixtures.json"),exported=read("export-01/report.json");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT),path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT),path.resolve(run));
const report={status:"RUNNING",at:new Date().toISOString(),launches:[],screenshots:[],pageErrors:[],
  cases:[],error:null,productChanges:0,modelRequests:0,
  scope:"READ_ONLY_1080P_4K_TEXT_RANGE_AND_ACTUAL_CLIP_ANCESTORS_NOT_REPLACEMENT_FOR12_MATRIX"};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let s;
async function probe(locator){
  return locator.evaluate(n=>{
    const r=n.getBoundingClientRect(),c=getComputedStyle(n);
    const ancestors=[];
    for(let a=n;a;a=a.parentElement){
      const css=getComputedStyle(a),rect=a.getBoundingClientRect();
      if(a===n||css.overflowX!=="visible"||css.overflowY!=="visible"||css.clipPath!=="none")
        ancestors.push({tag:a.tagName,className:a.className,rect:rect.toJSON(),overflowX:css.overflowX,
          overflowY:css.overflowY,clipPath:css.clipPath,padding:css.padding,transform:css.transform});
    }
    const range=document.createRange();range.selectNodeContents(n);
    const textRects=[...range.getClientRects()].map(r=>r.toJSON());
    const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
    ctx.font=c.font;const m=ctx.measureText(n.textContent.trim());
    const canvasInk={width:m.width,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent};
    return {label:n.textContent,rect:r.toJSON(),textRects,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,
      color:c.color,font:c.font,fontSize:c.fontSize,lineHeight:c.lineHeight,alignItems:c.alignItems,
      padding:c.padding,boxSizing:c.boxSizing,canvasInk,ancestors,
      parentScale:getComputedStyle(n.parentElement).getPropertyValue("--renpy-menu-scale")};
  });
}
(async()=>{
  s=new InstalledRuntimeSession({prep,fixture,cartridges:[{...exported.cartridge,layout:"renpy"}],
    out:pictures,report,save,installId:"qa_authored_roles_20261019"});
  await s.start("renpy",false);
  for(const [width,height]of [[1920,1080],[3840,2160]]){
    await s.viewport({width,height,dpr:1,reduced:false});
    await s.page.getByTestId("open-settings").click();await s.ready("settings");
    await s.page.mouse.move(0,0);
    const row={viewport:s.expected,navigation:await probe(s.page.getByTestId("renpy-menu-help"))};
    report.cases.push(row);save();await s.shot(`${width}-navigation`);
    await s.page.getByTestId("renpy-menu-exit").click();
    const modal=s.page.getByRole("dialog",{name:"退出游戏？",exact:true});await modal.waitFor();
    await s.page.mouse.move(0,0);
    row.modal=await probe(modal.getByTestId("confirm-exit-game"));
    assert(row.modal.scrollWidth>row.modal.clientWidth);
    assert(row.navigation.ancestors.length>0&&row.navigation.textRects.length>0);
    save();await s.shot(`${width}-modal`);
    await s.page.keyboard.press("Escape");await modal.waitFor({state:"hidden"});
    await s.page.getByTestId("renpy-menu-return").click();await s.ready("title_menu");
  }
  assert.equal(sha(exported.cartridge.path),exported.cartridge.sha256);
  assert.deepEqual(report.pageErrors,[]);report.status="PASS";
})().catch(async e=>{
  report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;
  if(s?.page)await s.shot("failure").catch(()=>{});
}).finally(async()=>{
  if(s)try{await s.stop()}catch(e){report.status="FAILED";report.cleanupError=String(e);process.exitCode=1}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,cases:report.cases.length,error:report.error,out}));
});
