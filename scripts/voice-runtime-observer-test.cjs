"use strict";
// Regression for the QA observation seam, not real product/audio acceptance.
const assert=require("node:assert/strict"),vm=require("node:vm");
const {installActualVoiceObserver}=require("./lib/voice-runtime-observer.cjs");
function documentContext(){
  const listeners=new Map(),promise=Promise.resolve();
  const calls=[];
  class Media{
    constructor(){this.src="actual-source";this.currentTime=1;this.duration=2}
    play(...args){calls.push({receiver:this,args});return promise}
    addEventListener(event,fn){listeners.set(event,fn)}
  }
  const ctx=vm.createContext({window:{},HTMLMediaElement:Media,document:{querySelector:()=>null},performance:{now:()=>1}});
  return {ctx,Media,listeners,promise,calls,install:()=>vm.runInContext(`(${installActualVoiceObserver.toString()})()`,ctx)};
}
(async()=>{
  const initial=documentContext();
  assert.equal(initial.ctx.window.__QA_VOICE__,undefined,"addInitScript alone does not cover an existing page");
  initial.install();assert(initial.ctx.window.__QA_VOICE__);console.log("PASS explicit install observes already loaded document");
  const audio=new initial.Media(),returned=audio.play("unchanged");
  assert.equal(returned,initial.promise);assert.equal(initial.calls[0].receiver,audio);
  assert.deepEqual(initial.calls[0].args,["unchanged"]);await returned;await Promise.resolve();
  assert.equal(initial.ctx.window.__QA_VOICE__.calls[0].settlement,"resolved");
  console.log("PASS exact native method receiver/arguments/original Promise preserved");
  const wrapped=initial.Media.prototype.play;initial.install();assert.equal(initial.Media.prototype.play,wrapped);
  assert.equal(initial.ctx.window.__QA_VOICE__.calls.length,1);console.log("PASS duplicate install is idempotent");
  initial.listeners.get("playing")();initial.listeners.get("timeupdate")();
  assert.equal(initial.ctx.window.__QA_VOICE__.events.length,2);console.log("PASS actual emitted events are observed");
  const next=documentContext();next.install();assert.equal(next.ctx.window.__QA_VOICE__.calls.length,0);
  assert.notEqual(next.Media.prototype.play,wrapped);console.log("PASS new navigation/process document starts a fresh observer");
  console.log(JSON.stringify({status:"PASS",cases:5,scope:"QA_OBSERVER_NOT_PRODUCT_AUDIO"}));
})().catch(e=>{console.error(e);process.exitCode=1});
