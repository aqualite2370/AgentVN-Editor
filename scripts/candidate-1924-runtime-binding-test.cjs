"use strict";
// Read-only exact installation/output binding; no Player or profile operations.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {candidateEvidence}=require("./lib/candidate-1924-runtime-session.cjs");
const {quickCandidate}=require("./lib/candidate-1924-quick-adapter.cjs");
assert(process.env.AGENTVN_EXIT_CANDIDATE_CONFIG,"Explicit candidate required");
const options=quickCandidate(),out=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/candidate-${options.stamp}-save-01`;
const evidence=candidateEvidence(options.installation,out);
assert.equal(evidence.candidateVersion,options.version);
assert.equal(evidence.candidateBindings.length,6);
assert.equal(evidence.player.sha256,require("./candidate-1930-exit.cjs")
  .validateInstallation(options.installation).resources.find(f=>path.basename(f.path)==="agentvn-player.exe").sha256);
const bad=[
  ["D:/AgentVN/installation.json",out],
  ["F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json",out],
  [options.installation,"D:/AgentVN"],
  [options.installation,out+"/nested"],
  [options.installation,out+"0"],
  [options.installation,out+"/../neighbour"],
  [options.installation,"F:/AgentVN/QA/Native-Runtime-State-20261020-01/candidate-1924-save-01"],
  [options.installation,"F:/AgentVN/QA/Elsewhere/candidate-"+options.stamp+"-save-01"],
];
for(const args of bad)assert.throws(()=>candidateEvidence(...args));
const flow=fs.readFileSync(path.join(__dirname,"candidate-1924-save-playwright.cjs"),"utf8");
const audit=fs.readFileSync(path.join(__dirname,"candidate-1924-save-audit.cjs"),"utf8");
for(const marker of [
  'assert.equal(report.cases.length,48)',
  'assert.equal(report.screenshots.length,48)',
  'assert.equal(report.traces.length,96)',
  'assert(row.moving>=2',
  'a.duration===(params.reduced?220:420)',
  'if(profileRun&&fs.existsSync',
])assert(flow.includes(marker),marker);
for(const marker of [
  'assert.equal(r.cases.length,48)',
  'assert.equal(r.traces.length,96)',
  'assert.equal(r.screenshots.length,48)',
  'assert.equal(restored.deletedUserFiles,0)',
  'assert.deepEqual(r.evidence,candidateEvidence(options.installation,run))',
])assert(audit.includes(marker),marker);
console.log(JSON.stringify({status:"PASS",version:options.version,rejected:bad.length,
  geometryCases:48,pageTraces:96,productLaunches:0,profileOperations:0}));
