"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {transformSync}=require("../editor/node_modules/esbuild");
const root=path.resolve(__dirname,".."),out=path.resolve(process.argv[2]||"");
assert(out.startsWith("F:\\testavn\\Sprite-Position-"));assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const source=path.join(root,"GameCli_framework/src/engine/spriteStageLayout.ts"),mod={exports:{}};
new Function("module","exports",transformSync(fs.readFileSync(source,"utf8"),{loader:"ts",format:"cjs"}).code)(mod,mod.exports);
const api=mod.exports,results=[];
function test(name,fn){try{fn();results.push({name,status:"PASS"});}catch(e){results.push({name,status:"FAILED",error:e.stack});}}
const sprite=(id,position)=>({character_id:id,sprite_id:id,position,visible:true});
function layouts(stage,sprites){
  if(api.resolveSpriteStageLayouts)return api.resolveSpriteStageLayouts(stage,sprites);
  const indices=api.resolveSpriteSlotIndices(sprites);
  return new Map(sprites.map(s=>[s.character_id,api.resolveSpriteSlotLayout({
    stage,spriteCount:sprites.length,spriteIndex:indices.get(s.character_id),position:s.position})]));
}
for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]]){
  const stage={width,height,uiScale:height/1080};
  for(const position of ["left","center","right"])test(`${width} ${position} anchor unchanged for 1/2/3/2/1`,()=>{
    const owner=sprite("owner",position),others=["left","center","right"].filter(p=>p!==position).map(p=>sprite(p,p));
    const baseline=layouts(stage,[owner]).get("owner");
    for(const group of [[others[0],owner],[...others,owner],[owner,others[1]],[owner]]){
      assert.deepEqual(layouts(stage,group).get("owner"),baseline,"Unchanged author position must retain all geometry");
    }
  });
  test(`${width} distinct side anchors survive duplicate center additions`,()=>{
    const right=sprite("right","right"),left=sprite("left","left");
    const baseline=layouts(stage,[right,left]);
    const many=layouts(stage,[right,left,...["a","b","c"].map(id=>sprite(id,"center"))]);
    assert.deepEqual(many.get("right"),baseline.get("right"));assert.deepEqual(many.get("left"),baseline.get("left"));
  });
  test(`${width} duplicate positions retain automatic distribution and independent size`,()=>{
    const sprites=Array.from({length:5},(_,i)=>sprite("s"+i,"center"));
    const actual=[...layouts(stage,sprites).values()],single=layouts(stage,[sprites[0]]).get("s0");
    assert.equal(new Set(actual.map(r=>r.left)).size,5);
    for(const r of actual){assert.equal(r.width,single.width);assert.equal(r.height,single.height);
      assert(r.left>=0&&r.left+r.width<=width+1e-7);}
  });
  test(`${width} unknown position auto-fallback and author canonical change remain effective`,()=>{
    const left=layouts(stage,[sprite("owner","left")]).get("owner");
    const right=layouts(stage,[sprite("owner","right")]).get("owner");
    assert(left.left<right.left);
    const unknown=[...layouts(stage,[sprite("x","mystery"),sprite("y","mystery")]).values()];
    assert(unknown[0].left<unknown[1].left);
  });
}
test("hidden entries do not influence canonical ownership",()=>{
  const stage={width:1920,height:1080,uiScale:1},r=sprite("owner","right");
  assert.deepEqual(layouts(stage,[r,{...sprite("old","right"),visible:false}]).get("owner"),layouts(stage,[r]).get("owner"));
});
const report={status:results.every(r=>r.status==="PASS")?"PASS":"FAILED",source:{path:source,
  sha256:crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex")},cases:results};
fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,cases:results.length,failed:results.filter(r=>r.status==="FAILED").map(r=>r.name)}));
if(report.status!=="PASS")process.exitCode=1;
