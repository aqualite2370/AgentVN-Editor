"use strict";
const assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs");
const {buildSync}=require("../editor/node_modules/esbuild");
const root=path.resolve(__dirname,".."),mod={exports:{}};
const source=buildSync({stdin:{resolveDir:root,loader:"ts",contents:`
export * from './editor/src/utils/spriteAnimationDefaults';
export { compileCharacterAnimation } from './shared/animation/characterAnimation';
export { defaultCommand } from './editor/src/utils/commandTools';
export { exportScript, applyProjectRuntimeSettingsToScript } from './editor/src/utils/exportScript';
export { builtInAnimationPresets } from './editor/src/animation/presets';
`},bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text;
new Function("module","exports","require",source)(mod,mod.exports,require);
const api=mod.exports,results=[];
function test(name,fn){try{fn();results.push({name,status:"PASS"});}catch(e){results.push({name,status:"FAILED",error:e.stack});}}
const enter=api.spriteDefaultFromPreset(api.builtInAnimationPresets.find(p=>p.preset_id==="sprite_slide_in_left"),"enter",false);
const exit=api.spriteDefaultFromPreset(api.builtInAnimationPresets.find(p=>p.preset_id==="sprite_fade_out"),"exit",true);
const defaults={enter,exit};
test("global entry and exit compile to actual Runtime keyframes and blocking",()=>{
 assert.equal(api.compileCharacterAnimation(enter).params.character_animation_phase,"enter");
 assert.equal(api.compileCharacterAnimation(exit).params.character_animation_phase,"exit");
 assert.equal(api.compileCharacterAnimation(exit).blocking,true);
 assert(api.compileCharacterAnimation(enter).params.keyframes[0].x<0);
});
test("new event inherits global entry, hide inherits independent exit",()=>{
 const command=api.defaultCommand("sprite");assert.equal(command.animation_source,"project");
 assert.deepEqual(api.resolveSpriteAnimation(command,defaults).animation_config,enter);
 assert.deepEqual(api.resolveSpriteAnimation({...command,visible:false},defaults).animation_config,exit);
});
test("old explicit, manual none and legacy overrides survive",()=>{
 for(const command of [{animation_config:{kind:"none",phase:"enter"}}, {animation:"fade_in"}, {animation_source:"manual"}]){
  const input={type:"sprite",character_id:"a",sprite_id:"x",visible:true,...command};
  assert.equal(api.resolveSpriteAnimation(input,defaults).animation_config,input.animation_config);
 }
});
test("unconfigured old project keeps its prior event",()=>{
 const command=api.defaultCommand("sprite");assert.deepEqual(api.resolveSpriteAnimation(command).animation_config,command.animation_config);
});
test("batch changes only requested phase; preserves IDs, links and emphasis",()=>{
 const nodes=[{id:"one",data:{scene:{scene_id:"scene",commands:[
  {...api.defaultCommand("sprite"),animation_source:"manual"},
  {...api.defaultCommand("sprite"),visible:false,animation_config:exit},
  {...api.defaultCommand("sprite"),animation_config:{kind:"preset",phase:"emphasis",preset_id:"sprite_shake"}},
  {type:"animation",animation_id:"sprite_fade_in",target:"sprite:all",params:{},blocking:false}
 ]}}}];
 const original=structuredClone(nodes);const result=api.useGlobalSpriteAnimation(nodes,"enter");
 assert.equal(result.count,1);assert.equal(result.nodes[0].id,"one");
 assert.deepEqual(result.nodes[0].data.scene.commands.slice(1),nodes[0].data.scene.commands.slice(1));assert.deepEqual(nodes,original);
 assert.equal(result.nodes[0].data.scene.commands[0].animation_source,"project");
});
test("runtime serialization strips editor inheritance and freezes defaults",()=>{
 const script={scenes:[{scene_id:"s",commands:[api.defaultCommand("sprite")]}]};
 const settings={defaultSpriteScale:1,spriteAnimationDefaults:defaults,speakerFocus:{},rollback:{enabled:true,hard_limit:100,log_length:128,pause_as_checkpoint:false,fixed_choice_mode:"selected_marked"}};
 const exported=api.applyProjectRuntimeSettingsToScript(script,settings);
 assert(!JSON.stringify(exported).includes("animation_source"));assert(!JSON.stringify(exported).includes("spriteAnimationDefaults"));
 assert.deepEqual(exported.scenes[0].commands[0].animation_config,enter);
 exported.scenes[0].commands[0].animation_config.keyframes[0].x=-999;assert.notEqual(enter.keyframes[0].x,-999);
 assert.equal(script.scenes[0].commands[0].animation_source,"project");
});
test("loop, CSS, invalid phase/duration rejected without mutation",()=>{
 const preset=api.builtInAnimationPresets[0];
 assert.throws(()=>api.spriteDefaultFromPreset({...preset,loop:true},"enter",false));
 assert.throws(()=>api.spriteDefaultFromPreset({...preset,keyframes:[{offset:0,custom_css:"color:red"}]},"enter",false));
 assert.throws(()=>api.validateSpriteAnimationDefaults({enter:exit}));
 assert.throws(()=>api.validateSpriteAnimationDefaults({enter:{...enter,duration_ms:20000}}));
});
const report={status:results.every(r=>r.status==="PASS")?"PASS":"FAILED",cases:results};
if(process.argv[2]){assert(!fs.existsSync(process.argv[2]));fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));if(report.status!=="PASS")process.exitCode=1;
