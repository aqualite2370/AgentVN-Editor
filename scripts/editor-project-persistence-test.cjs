"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),Module=require("node:module");
const root=path.resolve(__dirname,".."),out=path.resolve(process.argv[2]||"");
assert(process.argv[2]&&!fs.existsSync(out),"Use a new evidence directory");fs.mkdirSync(out,{recursive:true});
const report={scope:"ACTUAL_STORES_AND_BACKEND_WRITE_QUEUE_CONTROLLED_TRANSPORT_AND_NATIVE_IPC",status:"RUNNING",cases:[],models:0};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const records=new Map();
global.window={location:{search:""},localStorage:{getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)},
  dispatchEvent(){},addEventListener(){},removeEventListener(){},setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clearTimeout,matchMedia:()=>({matches:false})};
global.localStorage=window.localStorage;global.document={addEventListener(){},removeEventListener(){}};
global.CustomEvent=class {constructor(type,init){this.type=type;this.detail=init?.detail;}};
const built=require("../editor/node_modules/esbuild").buildSync({stdin:{resolveDir:root,loader:"ts",contents:`
  export * from "./editor/src/utils/editorProjectPersistence";
  export {useEditorStore} from "./editor/src/store/editorStore";
  export {useProjectStore} from "./editor/src/store/projectStore";
  export {backendClient} from "./editor/src/api/backendClient";
`},bundle:true,platform:"node",format:"cjs",write:false,define:{"import.meta.env":"{}"},nodePaths:[path.join(root,"editor/node_modules")]});
const compiled=new Module(path.join(out,"entry.cjs"),module);compiled.filename=path.join(out,"entry.cjs");compiled.paths=Module._nodeModulePaths(root);
compiled._compile(built.outputFiles[0].text,compiled.filename);
const api=compiled.exports,store=api.useEditorStore,project=api.useProjectStore,client=api.backendClient;
const {fixture}=require("./lib/editor-ui-acceptance.cjs");
let calls=[],backupCalls=[],transport,ipc,remote;
client.request=async(route,options)=>{
  assert.equal(route,"/api/project/state");const payload=JSON.parse(options.body);calls.push(payload);
  if(transport)return transport(payload);
  remote=structuredClone(payload);return {data:remote};
};
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
  if(command==="write_project_backup"){const snapshot=JSON.parse(args.projectJson);backupCalls.push({snapshot,trigger:args.trigger});
    if(ipc)return ipc(command,args);return {project_id:snapshot.project_id,file_name:"backup.vnproj"};}
  if(command==="append_frontend_error")return "";
  throw Error("Unexpected native command "+command);
}};
const tick=()=>new Promise(setImmediate);
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await tick();}throw Error("Controlled operation not reached");}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const wire=value=>JSON.parse(JSON.stringify(value));
function load(id="a"){const f=fixture(id);store.getState().importProject(f);project.getState().loadProjectMetadata(f);store.setState({dirty:true});return f;}
function edit(text){const n=store.getState().nodes.find(n=>n.data.nodeKind==="scene");store.getState().updateNodeData(n.id,{label:text});}
function reset(){transport=undefined;ipc=undefined;calls=[];backupCalls=[];load();}
async function test(name,fn){reset();const row={name,status:"RUNNING"};report.cases.push(row);save();try{await fn();row.status="PASS";}catch(e){row.status="FAILED";row.error=e.stack;}save();}
(async()=>{
 await test("保存确认只对应提交修订，新节点修改保持dirty",async()=>{
   const wait=deferred();transport=async payload=>{await wait.promise;return {data:payload};};
   const task=api.persistEditorProject();await until(()=>calls.length===1);edit("new");
   wait.resolve();await task;assert(store.getState().dirty);transport=undefined;
   await api.persistEditorProject();assert.equal(store.getState().dirty,false);assert(calls[1].project_graph.nodes.some(n=>n.data.label==="new"));
 });
 await test("memoryMode变化不能被旧保存清除dirty",async()=>{
   const wait=deferred();transport=async payload=>{await wait.promise;return {data:payload};};
   const task=api.persistEditorProject();await until(()=>calls.length);store.getState().updateMemoryMode("none");
   wait.resolve();await task;assert(store.getState().dirty);assert.equal(store.getState().memoryMode,"none");
 });
 for(const type of ["title","assets","settings"])await test(`迟到响应不覆盖新${type}`,async()=>{
   const wait=deferred();transport=async payload=>{await wait.promise;return {data:{...payload,project_metadata:{...payload.project_metadata,assetManifest:[],settings:{},title:"old"}}};};
   const task=api.persistEditorProject();await until(()=>calls.length);
   let expected;if(type==="title"){project.getState().setMetadata({title:"new title"});expected=project.getState().title;}
   if(type==="assets"){project.getState().setAssetManifest([{asset_id:"new",kind:"background",name:"新增",metadata:{url:"/new.png"}}]);expected=project.getState().assetManifest;}
   if(type==="settings"){project.getState().setDefaultSpriteScale(1.3);expected=project.getState().settings;}
   wait.resolve();await task;
   assert.equal(type==="title"?project.getState().title:type==="assets"?project.getState().assetManifest:project.getState().settings,expected);
   assert(store.getState().dirty);
 });
 for(const reload of ["A→B→A","A重新载入"])await test(`${reload}使旧成功响应过期`,async()=>{
   const wait=deferred();transport=async payload=>{await wait.promise;return {data:payload};};
   const task=api.persistEditorProject();const rejection=assert.rejects(task,api.EditorSaveSupersededError);await until(()=>calls.length);
   if(reload==="A→B→A")load("b");load("a");edit("new generation");
   const latest=store.getState().nodes;wait.resolve();await rejection;
   assert.equal(store.getState().nodes,latest);assert(store.getState().dirty);
 });
 await test("队列头读取最新图与元数据，非调用时旧快照",async()=>{
   const wait=deferred();transport=async payload=>{if(calls.length===1)await wait.promise;return {data:payload};};
   const first=api.persistEditorProject();await until(()=>calls.length===1);
   const second=api.persistEditorProject();edit("queued latest");project.getState().setMetadata({title:"queued title"});
   wait.resolve();await Promise.all([first,second]);assert.equal(calls.length,2);
   assert(calls[1].project_graph.nodes.some(n=>n.data.label==="queued latest"));assert.equal(calls[1].project_metadata.title,"queued title");assert(!store.getState().dirty);
 });
 await test("排队期间工程切换的请求不提交空写入",async()=>{
   const wait=deferred();transport=async payload=>{await wait.promise;return {data:payload};};
   const first=api.persistEditorProject(),r1=assert.rejects(first,api.EditorSaveSupersededError);await until(()=>calls.length===1);
   const second=api.persistEditorProject(),r2=assert.rejects(second,api.EditorSaveSupersededError);load("b");
   wait.resolve();await Promise.all([r1,r2]);assert.equal(calls.length,1);assert.equal(project.getState().projectId,"b");
 });
 await test("保存失败保留dirty，显式重试保存最新内容",async()=>{
   transport=async()=>{throw Error("disk denied");};await assert.rejects(api.persistEditorProject(),/disk denied/);assert(store.getState().dirty);
   edit("retry");transport=undefined;await api.persistEditorProject();assert(!store.getState().dirty);
 });
 for(const kind of ["graph","title","settings","assets"])await test(`恢复首次保存等待期间${kind}变化不得被覆盖`,async()=>{
   edit("confirmed baseline");const wait=deferred();
   transport=async payload=>{if(calls.length===1)await wait.promise;remote=structuredClone(payload);return {data:payload};};
   const task=api.restoreEditorTimelineProject(fixture("a"));const outcome=task.then(()=>null,error=>error);
   await until(()=>calls.length===1);
   if(kind==="graph")edit("new during first save");
   if(kind==="title")project.getState().setMetadata({title:"author changed after confirmation"});
   if(kind==="settings")project.getState().setDefaultSpriteScale(1.35);
   if(kind==="assets")project.getState().setAssetManifest([{asset_id:"new",kind:"background",name:"新背景",metadata:{url:"/new.png"}}]);
   const graph=store.getState().nodes,metadata=project.getState(),generation=store.getState().projectLoadGeneration;
   wait.resolve();const error=await outcome;assert(error instanceof api.EditorSaveSupersededError,"Newer edits must abort restoration");
   assert.equal(store.getState().nodes,graph);assert.equal(project.getState().title,metadata.title);
   assert.equal(project.getState().settings,metadata.settings);assert.equal(project.getState().assetManifest,metadata.assetManifest);
   assert.equal(store.getState().projectLoadGeneration,generation);assert.equal(backupCalls.length,0);
   assert.deepEqual(remote.project_graph.nodes,wire(graph));assert.equal(remote.project_metadata.title,metadata.title);
   assert.deepEqual(remote.project_metadata.settings,wire(metadata.settings));assert.deepEqual(remote.project_metadata.assetManifest,wire(metadata.assetManifest));
 });
 await test("恢复在共享队列中等待时出现新编辑，中止而不接受更晚基线",async()=>{
   const wait=deferred();transport=async payload=>{if(calls.length===1)await wait.promise;remote=structuredClone(payload);return {data:payload};};
   const first=api.persistEditorProject();await until(()=>calls.length===1);
   const task=api.restoreEditorTimelineProject(fixture("a"));const outcome=task.then(()=>null,error=>error);
   edit("new while queued");const graph=store.getState().nodes;wait.resolve();await first;
   assert(await outcome instanceof api.EditorSaveSupersededError);assert.equal(store.getState().nodes,graph);
   assert.deepEqual(remote.project_graph.nodes,wire(graph));assert.equal(backupCalls.length,0);
 });
 await test("恢复首次保存仅物化内嵌素材时允许继续，备份保留真实资源引用",async()=>{
   project.getState().setAssetManifest([{asset_id:"inline",kind:"background",name:"内嵌背景",
     metadata:{url:"",data_url:"data:image/png;base64,aGVsbG8="}}]);
   transport=async payload=>{
     const response=structuredClone(payload);
     if(calls.length===1)response.project_metadata.assetManifest[0].metadata={url:"/api/assets/materialized.png"};
     remote=response;return {data:response};
   };
   await api.restoreEditorTimelineProject(fixture("a"));
   assert.equal(backupCalls.length,1);assert.equal(backupCalls[0].snapshot.asset_manifest[0].metadata.url,"/api/assets/materialized.png");
   assert.equal(store.getState().nodes.length,fixture("a").nodes.length);
 });
 await test("相同JSON设置重新物化不误阻止恢复",async()=>{
   const wait=deferred();transport=async payload=>{if(calls.length===1)await wait.promise;remote=structuredClone(payload);return {data:payload};};
   const task=api.restoreEditorTimelineProject(fixture("a"));await until(()=>calls.length===1);
   project.setState({settings:wire(project.getState().settings)});wait.resolve();await task;
   assert.equal(backupCalls.length,1);assert.equal(calls.length,2);
 });
 await test("恢复先保存和before_restore备份，再队列提交与本地载入",async()=>{
   edit("before restore");const generation=store.getState().projectLoadGeneration;
   await api.restoreEditorTimelineProject(fixture("a"));assert.equal(backupCalls.length,1);assert.equal(backupCalls[0].trigger,"before_restore");
   assert(backupCalls[0].snapshot.nodes.some(n=>n.data.label==="before restore"));assert.equal(store.getState().projectLoadGeneration,generation+1);
   assert.equal(calls.length,2);assert(!store.getState().nodes.some(n=>n.data.label==="before restore"));
 });
 await test("恢复前备份失败不替换当前图或持久图",async()=>{
   edit("keep");const nodes=store.getState().nodes;ipc=async()=>{throw Error("backup denied");};
   await assert.rejects(api.restoreEditorTimelineProject(fixture("a")),/backup denied/);
   assert.equal(calls.length,1);assert.equal(store.getState().nodes,nodes);assert(remote.project_graph.nodes.some(n=>n.data.label==="keep"));
 });
 await test("备份期间作者再编辑则中止恢复",async()=>{
   const wait=deferred();ipc=()=>wait.promise;const task=api.restoreEditorTimelineProject(fixture("a")),rejection=assert.rejects(task,api.EditorSaveSupersededError);
   await until(()=>backupCalls.length);edit("during backup");wait.resolve({file_name:"backup"});await rejection;assert.equal(calls.length,1);assert(store.getState().nodes.some(n=>n.data.label==="during backup"));
 });
 await test("恢复写入在途出现新修改，拒绝覆盖并重新持久化新内容",async()=>{
   const wait=deferred();transport=async payload=>{if(calls.length===2)await wait.promise;remote=structuredClone(payload);return {data:payload};};
   const task=api.restoreEditorTimelineProject(fixture("a")),rejection=assert.rejects(task,api.EditorSaveSupersededError);await until(()=>calls.length===2);
   edit("new during restore");wait.resolve();await rejection;
   assert.equal(calls.length,3);assert(store.getState().nodes.some(n=>n.data.label==="new during restore"));assert(remote.project_graph.nodes.some(n=>n.data.label==="new during restore"));
 });
 await test("不接受其他工程的恢复内容",async()=>{
   await assert.rejects(api.restoreEditorTimelineProject(fixture("other")),/不属于当前工程/);assert.equal(calls.length,0);assert.equal(backupCalls.length,0);
 });
 report.status=report.cases.length>=15&&report.cases.every(c=>c.status==="PASS")?"PASS":"FAILED";
})().catch(e=>{report.status="FAILED";report.error=e.stack;}).finally(()=>{save();console.log(JSON.stringify(report));if(report.status!=="PASS")process.exitCode=1;});
