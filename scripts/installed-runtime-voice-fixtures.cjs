"use strict";
// Controlled project + generated WAV; never edits product or calls a model.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {sha256}=require("./lib/installed-acceptance.cjs");
const run="D:/AgentVN/output/installed-runtime-voice-20261019-01";
const work="F:/AgentVN/QA/Runtime-Voice-20261019-01";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const prep=read(path.join(run,"preparation.json"));
assert.equal(prep.status,"PASS"); assert(prep.profiles.every(p=>fs.existsSync(p.held)));
assert(!fs.existsSync(path.join(run,"fixtures.json")));
const base=read("D:/AgentVN/output/installed-runtime-abilities-20261018-01/fixtures-02.json");
assert.equal(sha256(fs.readFileSync(base.input)),base.inputSha256);
const p=read(base.input);p.project_id="installed-runtime-voice-20261019-01";
p.title="语音恢复去重隔离验收20261019";
const rate=16000,samples=rate*2,wav=Buffer.alloc(44+samples*2);
wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);
wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(1800*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
const assetId="qa_restore_voice";
p.asset_manifest.push({asset_id:assetId,asset_type:"voice",metadata:{
  display_name:"合成语音触发探针（非听辨）",filename:"本轮语音探针.wav",mime_type:"audio/wav",
  duration_ms:2000,size_bytes:wav.length,data_url:`data:audio/wav;base64,${wav.toString("base64")}`}});
const dialogs=[];
for(const mode of ["dialog","nvl","bubble"])for(let i=1;i<=3;i++)
  dialogs.push({text:`VOICE_${mode.toUpperCase()}_${i}：合成音仅测真实触发及恢复，不是音频听辨。`,
    voice:assetId,mode});
p.nodes=p.nodes.slice(0,2);
p.nodes[1].data.scene.scene_id="voice_restore";
p.nodes[1].data.scene.title="语音恢复去重";
p.nodes[1].data.scene.commands=dialogs.map(d=>({type:"dialog",character_id:"hero",
  text:d.text,voice:d.voice,presentation_mode:d.mode}));
const input=path.join(work,"语音恢复隔离小工程.vnproj");
fs.writeFileSync(input,JSON.stringify(p),{flag:"wx"});
const wavPath=path.join(work,"本轮语音探针.wav");fs.writeFileSync(wavPath,wav,{flag:"wx"});
fs.writeFileSync(path.join(run,"fixtures.json"),JSON.stringify({status:"PASS",at:new Date().toISOString(),
  input,inputSha256:sha256(fs.readFileSync(input)),projectId:p.project_id,title:p.title,
  spriteSha256:base.spriteSha256,voice:{assetId,sha256:sha256(wav),path:wavPath,dialogs,
    sampleRate:rate,seconds:2,synthetic:true,listeningAcceptanceClaim:false},
  modelRequests:0,productChanges:0},null,2),{flag:"wx"});
console.log("PASS: isolated 9-line / 3-mode voice fixture, generated WAV, no model requests");
