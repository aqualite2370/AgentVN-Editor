"use strict";
const http = require("node:http");
const assert = require("node:assert/strict");
// Controlled only at the external model boundary; never mock AgentVN APIs.
async function controlledAssistantProvider() {
  const requests = [], held = new Map(), holds = new Set();
  let activeCreation = 0, maxActiveCreation = 0;
  const sockets = new Set();
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
    try {
      const chunks=[];for await(const chunk of request)chunks.push(chunk);
      const payload=JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const text=JSON.stringify(payload.messages), current=String(payload.messages?.at(-1)?.content??"");
      const marker=current.match(/用户本次需求：\s*((?:QUEUE|HISTORY|INTERRUPTED|RESUME|PEER|BATCH)_[A-Z]+)/)?.[1]
        ?? [...text.matchAll(/(?:QUEUE|HISTORY|INTERRUPTED|RESUME|PEER|BATCH)_[A-Z]+/g)].at(-1)?.[0] ?? "NO_MARKER";
      const creation=Boolean(payload.tools?.length);
      const entry={marker,creation,tools:(payload.tools??[]).map(item=>item.function.name),stream:payload.stream===true,startedAt:Date.now(),finishedAt:null};requests.push(entry);
      if(creation){activeCreation++;maxActiveCreation=Math.max(maxActiveCreation,activeCreation);}
      try {
        if(holds.has(marker))await new Promise(resolve=>held.set(marker,resolve));
        if(response.destroyed)return;
        if(payload.stream){
          response.writeHead(200,{"content-type":"text/event-stream"});
          response.write(`data: ${JSON.stringify({id:"controlled-inquiry",object:"chat.completion.chunk",created:1,model:"controlled-model",choices:[{index:0,delta:{role:"assistant",content:`${marker} 这是安装版历史验收回答。`},finish_reason:null}]})}\n\n`);
          response.end('data: {"id":"controlled-inquiry","object":"chat.completion.chunk","created":1,"model":"controlled-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
        } else {
          const proposal={components:[{name:`${marker}组件`,description:"受控模型边界验证真实安装版队列和历史",screen_id:"title",html:`<div class="root"><button class="button" type="button" data-action="open_about">${marker}</button></div>`,css:".root { padding: 8px; }.button { color: #ffffff; background-color: #222222; padding: 8px; }"}],edits:[]};
          if(marker==="BATCH_A")proposal.components=["关于","帮助"].map((name,index)=>({...proposal.components[0],name:`BATCH_A${name}`,html:`<div class="root"><button class="button" type="button" data-action="${index?"open_help":"open_about"}">${name}</button></div>`}));
          const message=creation?{role:"assistant",content:null,tool_calls:[{id:"controlled-call",type:"function",function:{name:"submit_assistant_component_draft",arguments:JSON.stringify(proposal)}}]}:{role:"assistant",content:`${marker} 这是安装版历史验收回答。`};
          response.writeHead(200,{"content-type":"application/json"});response.end(JSON.stringify({id:"controlled-result",object:"chat.completion",created:1,model:"controlled-model",choices:[{index:0,finish_reason:creation?"tool_calls":"stop",message}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
        }
      }finally{if(creation)activeCreation--;entry.finishedAt=Date.now();}
    }catch(error){if(!response.headersSent)response.writeHead(500,{"content-type":"application/json"});response.end(JSON.stringify({error:{message:String(error),type:"controlled_test_error"}}));}
  });
  server.on("connection",socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  return {url:`http://127.0.0.1:${server.address().port}/v1`,requests,
    get maxConcurrentCreation(){return maxActiveCreation;},hold(marker){holds.add(marker);},
    release(marker){holds.delete(marker);held.get(marker)?.();held.delete(marker);},
    async stop(){for(const resolve of held.values())resolve();held.clear();holds.clear();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));return{stopped:true,requests:requests.length,maxConcurrentCreation:maxActiveCreation};}
  };
}
module.exports={controlledAssistantProvider};
