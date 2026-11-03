"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const crypto=require("node:crypto"),path=require("node:path");
const {ownedProcessTree}=require("./lib/owned-process-tree.cjs");
const file="F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01/green-owner-01/report.json";
const raw=JSON.parse(fs.readFileSync(file,"utf8"));
const original=fs.readFileSync("F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01/green-owner-01/executed-test.cjs","utf8");
const start=original.indexOf("  const remember=()=>{"),end=original.indexOf("\n  const step=",start);
assert(start>=0&&end>start);
const observed=vm.runInNewContext(original.slice(start,end)+"\nremember();",{
  host:{pid:raw.host.pid},processes:()=>raw.known,known:new Map(),identity:p=>`${p.ProcessId}:${p.Created}`,
  report:{},save:()=>{},sentinel:null});
const misclassified=raw.known.find(p=>p.ProcessId===55672);assert(misclassified);
assert(observed.some(p=>p.ProcessId===misclassified.ProcessId),"Original exact observer must reproduce the VCTIP misclassification");
const fixed=ownedProcessTree(raw.known,raw.host.pid);
assert(!fixed.some(p=>p.ProcessId===misclassified.ProcessId));
const row=(pid,parent,time)=>({ProcessId:pid,ParentProcessId:parent,Created:`2026-10-20T05:26:${time}.0000000Z`});
const roots=[row(1,99,"10"),row(2,1,"11"),row(3,2,"12"),row(4,2,"09"),row(5,4,"13")];
assert.deepEqual(ownedProcessTree(roots,1).map(p=>p.ProcessId),[1,2,3]);
assert.deepEqual(ownedProcessTree(roots,1,"2026-10-20T05:26:09.0000000Z"),[]);
assert.deepEqual(ownedProcessTree(roots,9),[]);
assert.deepEqual(ownedProcessTree([row(1,1,"10"),row(2,1,"10")],1).map(p=>p.ProcessId),[1,2]);
assert.throws(()=>ownedProcessTree([{ProcessId:1,Created:"invalid"}],1),/creation identity/);
const out="F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01/observer-selftest-01";
assert(!fs.existsSync(out));fs.mkdirSync(out);
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
fs.copyFileSync(__filename,path.join(out,"executed-test.cjs"),fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(out,"report.json"),JSON.stringify({status:"PASS",at:new Date().toISOString(),
  exactPriorObserverMisclassificationReproduced:true,realMisclassifiedProcess:misclassified,
  fixedExcludesMisclassifiedProcess:true,additionalGuards:5,productChanged:false,
  helper:{path:path.resolve("scripts/lib/owned-process-tree.cjs"),sha256:sha("scripts/lib/owned-process-tree.cjs")}},null,2),{flag:"wx"});
console.log("owned process tree: PASS (exact prior observer red reproduced; real VCTIP orphan rejected; five identity/ancestry guards)");
