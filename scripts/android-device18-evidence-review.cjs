"use strict";
// Read-only attribution of the original device18 tool exception.
// No whitelist, device operation or change to the original verdict.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {scopedRuntimeLog}=require("./android-runtime-log-analysis.cjs");
const base="F:/AgentVN/QA/Android-Exit-20261024-01",attempt=process.argv[2]||"01";
assert.match(attempt,/^\d{2}$/);const out=path.join(base,`evidence-review18-${attempt}`);
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc=p=>({path:path.resolve(p),sha256:sha(p),bytes:fs.statSync(p).size});
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const source=path.join(base,"device-18/runtime/report.json"),r=read(source);
const originalFiles=[source,...r.cells.map(c=>c.logcat.path),r.toolWarnings[0].evidence.path];
const frozen=originalFiles.map(desc),report={status:"RUNNING",at:new Date().toISOString(),
 scope:"READ_ONLY_ORIGINAL_DEVICE18_ATTRIBUTION_NOT_NEW_ACCEPTANCE",modelRequests:0,builds:0,deviceOperations:0,sources:frozen};
function findTimeline(raw,command,pids){
 const lines=raw.split(/\r?\n/),at=line=>line.match(/^\d\d-\d\d (\d\d:\d\d:\d\d\.\d+)/)?.[1];
 const start=command.startedAt.slice(11,23),end=command.at.slice(11,23);
 const matches=lines.map((line,i)=>({line,lineNumber:i+1,time:at(line)})).filter(x=>x.time>=start&&x.time<=end
  &&/Calling main entry com\.android\.commands\.uiautomator\.Launcher/.test(x.line));
 assert.equal(matches.length,1,"Exactly one original tool process in the recorded command window");
 const pid=matches[0].line.trim().split(/\s+/)[2];assert(!pids.includes(pid),"Tool PID must not belong to the game or its renderer");
 const own=lines.map((line,i)=>({line,lineNumber:i+1,time:at(line)})).filter(x=>x.line.trim().split(/\s+/)[2]===pid);
 const take=pattern=>{const match=own.find(x=>pattern.test(x.line));assert(match,`Missing tool attribution: ${pattern}`);return match;};
 const timeline=[matches[0],take(/AccessibilityNodeInfoDumper: Fetch time:/),take(/AndroidRuntime: Shutting down VM/),
  take(/FATAL EXCEPTION: UiAutomation/),take(/AndroidRuntime: java.lang.RuntimeException: Bad file descriptor/),
  take(/AccessibilityInteractionClient\.onAccessibilityEvent/),take(new RegExp(`Sending signal\\. PID: ${pid} SIG: 9`))];
 assert(timeline.every((x,i)=>i===0||x.lineNumber>timeline[i-1].lineNumber));
 assert(timeline.every(x=>x.time>=start&&x.time<=end));return {pid,commandStart:start,commandEnd:end,timeline};
}
try{
 assert.equal(r.status,"BLOCKED_EVIDENCE_REVIEW");assert.equal(r.toolWarnings.length,1);
 const warning=r.toolWarnings[0];assert.equal(warning.code,137);
 const commands=r.commands.filter(c=>c.code===137&&c.args[0]==="shell"&&c.args[1]==="uiautomator");
 assert.equal(commands.length,1);const command=commands[0];assert.equal(command.stderr,"");assert(command.stdout.includes(path.basename(warning.evidence.path)));
 const renpy=r.cells.find(c=>c.layout==="renpy"),raw=fs.readFileSync(renpy.logcat.path,"utf8");
 report.tool={status:"CAUSE_CONFIRMED_TOOL_EXCEPTION",originalExitCode:137,
  command,...findTimeline(raw,command,renpy.logs.pids),
  conclusion:"The original UIAutomator process crashes after VM shutdown with a Binder Bad file descriptor, then sends SIGKILL to itself. This is not a game-process fatal. Do not count the command as a successful tool run."};
 const negative=[
  [raw.replace("FATAL EXCEPTION: UiAutomation","FATAL OMITTED"),command,renpy.logs.pids],
  [raw.replace("Sending signal. PID: 5678 SIG: 9","SIGNAL OMITTED"),command,renpy.logs.pids],
  [raw,command,[...renpy.logs.pids,"5678"]],
  [raw,{...command,startedAt:"2026-10-24T02:28:02.000Z",at:"2026-10-24T02:28:02.500Z"},renpy.logs.pids],
 ];
 for(const args of negative)assert.throws(()=>findTimeline(...args));report.badAttributionRejected=negative.length;
 const xmlPath=warning.evidence.path;
 const check=spawnSync("powershell.exe",["-NoProfile","-Command",
  `$doc=[xml][IO.File]::ReadAllText('${xmlPath.replace(/'/g,"''")}');`+
  `@{root=$doc.DocumentElement.Name;appNodes=@($doc.SelectNodes('//node[@package="${renpy.package}"]')).Count}|ConvertTo-Json -Compress`],
  {windowsHide:true,encoding:"utf8",timeout:15000});assert.equal(check.status,0,check.stderr);
 report.xml=JSON.parse(check.stdout.replace(/^\uFEFF/,""));assert.equal(report.xml.root,"hierarchy");assert.equal(report.xml.appNodes,6);
 assert.deepEqual(scopedRuntimeLog(raw,renpy.package,renpy.logs.pids).fatal,[]);
 const agent=r.cells.find(c=>c.layout==="agentvn"),agentRaw=fs.readFileSync(agent.logcat.path,"utf8");
 const classification=scopedRuntimeLog(agentRaw,agent.package,agent.logs.pids);
 assert.equal(classification.warnings.length,6);assert.equal(classification.fatal.length,0);
 const fake=classification.warnings.filter(line=>/\b4210\b.*Failed to write a new fake index/.test(line));assert.equal(fake.length,2);
 report.cache={status:"BLOCKED_MISSING_SAME_PID_PATH_ATTRIBUTION",provider:"124.0.6367.219",pid:4210,
  originalWarningLines:classification.warnings,originalLineCount:6,policy:"No allowlist or product-cause inference added"};
 for(const f of frozen)assert.equal(sha(f.path),f.sha256);
 report.originalVerdictUnchanged=r.status;report.status="TOOL_CAUSE_CONFIRMED_CACHE_REVIEW_BLOCKED";
}catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
finally{
 report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
 console.log(JSON.stringify({status:report.status,out,error:report.error}));
}
