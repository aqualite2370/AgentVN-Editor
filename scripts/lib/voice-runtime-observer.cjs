"use strict";
// Serializable, no closure dependencies. This is observational only: original
// method receiver, arguments and original Promise are preserved.
function installActualVoiceObserver(){
  if(window.__QA_VOICE__)return;
  const q=window.__QA_VOICE__={calls:[],events:[]},original=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(...args){
    const audio=this,id=q.calls.length+1,state=document.querySelector('[data-testid="game-state-playing"]');
    const call={id,source:audio.currentSrc||audio.src,at:performance.now(),settlement:"pending",
      command:state?.getAttribute("data-current-command-index")};q.calls.push(call);
    for(const event of ["playing","timeupdate","ended","error"])
      audio.addEventListener(event,()=>q.events.push({id,event,at:performance.now(),time:audio.currentTime,
        duration:Number.isFinite(audio.duration)?audio.duration:null,error:audio.error?.code||null}));
    const promise=Reflect.apply(original,audio,args);
    promise.then(()=>{call.settlement="resolved"},e=>{call.settlement="rejected";call.error=String(e)});return promise;
  };
}
module.exports={installActualVoiceObserver};
