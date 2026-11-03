"use strict";
// Read original reports, PNGs, ZIP bytes, ACL receipts, hashes and live process
// ownership. A successful audit never converts the old installation's FAILED.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),JSZip=require("../editor/node_modules/jszip");
const {rows,listeners}=require("./lib/current-native-editor-session.cjs");
const base="F:/AgentVN/QA/Project-Directory-Write-20261024-01";
const attempt=process.argv[2]||"01",buildAttempt=process.argv[3]||"01",supportAttempt=process.argv[4]||"02";
for(const v of [attempt,buildAttempt,supportAttempt])assert.match(v,/^\d{2}$/);
const out=path.join(base,`audit-${attempt}`);assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sha=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const checkFile=f=>assert.equal(sha(f.path),f.sha256,f.path);
const report={status:"RUNNING",at:new Date().toISOString(),scope:"CURRENT_DEV_DIRECTORY_WRITE_FIX_ONLY",
 checks:[],modelRequests:0,originalFrozenInstallationFailurePreserved:true};
function terminal(r){
 assert.equal(r.status,"PASS");assert.equal(r.cases.length,12);assert.deepEqual(r.errors,[]);assert(!r.cleanupError);
 assert.equal(r.restoration.status,"RESTORED");
 assert.equal(r.restoration.before.replace("D:AI(","D:("),r.restoration.sddl.replace("D:AI(","D:("));
 const matrix=new Set();
 for(const c of r.cases){
  assert.equal(c.status,"PASS");assert(c.noFallbackNoPartialNoOverwrite);
  assert(c.summary.includes("PROJECT_EXPORT_DIRECTORY_WRITE_FAILED")&&c.summary.includes(r.restoration.directory));
  assert(!c.summary.includes("请确认素材仍可在素材库中预览"));
  matrix.add([c.width,c.height,c.dpr,c.reduced].join("/"));
 }
 assert.equal(matrix.size,12);assert.equal(r.screenshots.length,12);
 assert(r.sourceFailure.error.includes("无法读取素材")&&!r.sourceFailure.error.includes("PROJECT_EXPORT_DIRECTORY_"));
 assert(r.cleanups.length===1&&r.cleanups.every(c=>c.survivors.length===0&&c.listeners.length===0));
 assert.equal(r.cleanups[0].normalExitClaimed,false);
}
(async()=>{
 const source=path.join(base,"green-01/report.json"),native=read(source);
 terminal(native);report.checks.push({name:"nonempty-native-terminal-matrix-and-explicit-scope",status:"PASS"});
 checkFile(native.executable);for(const f of native.sources)checkFile(f);
 checkFile(native.input);checkFile(native.old);checkFile(native.retryPackage);
 for(const c of native.cases){
  checkFile(c.error);const text=fs.readFileSync(c.error.path,"utf8");
  assert.equal(text.split("== Developer Diagnosis ==")[0],c.summary);
 }
 for(const s of native.screenshots){
  checkFile(s);const b=fs.readFileSync(s.path);
  assert.deepEqual(s.before,s.after);
  assert.equal(b.readUInt32BE(16),s.before.width*s.before.dpr);
  assert.equal(b.readUInt32BE(20),s.before.height*s.before.dpr);
 }
 const zip=await JSZip.loadAsync(fs.readFileSync(native.retryPackage.path));
 const project=JSON.parse(await zip.file("project.json").async("string"));
 assert(project.project_id.startsWith("directory-write-green-")&&project.nodes.length===2&&project.edges.length===1);
 assert(!JSON.stringify(project).includes("projectExportDirectories"));
 const directory=native.restoration.directory;
 assert.deepEqual(fs.readdirSync(directory).sort(),["old.vnproj",path.basename(native.retryPackage.path)].sort());
 report.checks.push({name:"actual-error-PNG-ZIP-and-no-partial-original-bytes",status:"PASS"});
 const build=read(path.join(base,`build-${buildAttempt}/report.json`)),support=read(path.join(base,`support-${supportAttempt}/report.json`));
 assert.equal(build.status,"PASS");assert.equal(support.status,"PASS");
 assert.equal(build.commands.length,4);assert.equal(support.commands.length,4);
 for(const r of [build,support])for(const c of r.commands)assert(c.status==="PASS"&&c.exitCode===0);
 assert.deepEqual(build.commands.map(c=>c.label),["editor-typecheck","editor-build","gamecli-build","full-dev"]);
 for(const f of build.sources)checkFile(f);
 for(const r of build.bundled) {checkFile(r.source);checkFile(r.copy);assert.equal(r.source.sha256,r.copy.sha256);}
 checkFile(build.dev);checkFile(build.player);assert.equal(build.dev.sha256,native.executable.sha256);
 const checkpoint=read("F:/AgentVN/Checkpoints/Project-Directory-Write-20261024-01/manifest.json");
 for(const f of checkpoint.copies)assert.equal(sha(f.copy),f.sha256);
 for(const f of checkpoint.artifacts.slice(1))checkFile(f);
 const frozen=read(checkpoint.artifacts[1].path);
 for(const f of [frozen.executable,...frozen.resources])checkFile(f);
 report.checks.push({name:"build-order-current-source-bundle-and-frozen-1922-unchanged",status:"PASS"});
 const actual=rows(),remaining=(native.known||[]).filter(p=>actual.some(q=>q.ProcessId===p.ProcessId&&q.Created===p.Created));
 assert.equal(remaining.length,0);
 for(const launch of native.launches)assert.equal(listeners(launch.ports).length,0);
 report.checks.push({name:"original-owned-processes-and-ports-cleaned",status:"PASS"});
 report.negativeCases=[];
 for(const [name,mutate]of [
  ["empty-matrix",r=>r.cases=[]],["missing-cell",r=>r.cases.pop()],
  ["failed-cell",r=>r.cases[0].status="FAILED"],["duplicate-cell",r=>r.cases[1]={...r.cases[0]}],
  ["missing-restore",r=>r.restoration.status="DENIED"],
  ["asset-misclassification",r=>r.cases[0].summary+="请确认素材仍可在素材库中预览"],
  ["surviving-process",r=>r.cleanups[0].survivors.push({pid:1})],
  ["missing-source-check",r=>r.sourceFailure.error="PROJECT_EXPORT_DIRECTORY_WRITE_FAILED"]
 ]){
  const invalid=structuredClone(native);mutate(invalid);assert.throws(()=>terminal(invalid));report.negativeCases.push(name);
 }
 report.checks.push({name:"eight-incomplete-or-failed-evidence-matrices-rejected",status:"PASS"});
 report.status="PASS";report.native={path:source,sha256:sha(source)};report.dev=build.dev;
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
 .finally(()=>{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));});
