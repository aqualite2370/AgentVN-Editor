"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {transformSync}=require("../editor/node_modules/esbuild");
const base=path.resolve("F:/testavn/Sprite-Animation-Defaults-20261116-01"),output=path.join(base,"source-provenance.json");
assert(!fs.existsSync(output));
const root=path.resolve(__dirname,".."),sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files={payload1984:path.join(base,"payload1984/GameCli_framework/src/engine/spriteStageLayout.ts"),
 dailySource:"D:/AgentVN/GameCli_framework/src/engine/spriteStageLayout.ts",currentSource:path.join(root,"GameCli_framework/src/engine/spriteStageLayout.ts")};
function sample(file){const mod={exports:{}};new Function("module","exports",transformSync(fs.readFileSync(file,"utf8"),{loader:"ts",format:"cjs"}).code)(mod,mod.exports);
 return [1,2,3,5,1].map(count=>({count,...mod.exports.resolveSpriteSlotLayout({stage:{width:1920,height:1080,uiScale:1},spriteCount:count,spriteIndex:0,position:"left"})}));}
const report={status:"RUNNING",scope:"ACTUAL_1984_INSTALLER_SOURCE_VS_D_DAILY_VS_CURRENT_SOURCE_NOT_NATIVE_RENDERING",files:{},modelRequests:0,builds:0};
for(const [name,file]of Object.entries(files))report.files[name]={path:file,sha256:sha(file),samples:sample(file)};
assert.equal(report.files.payload1984.sha256,report.files.dailySource.sha256);
assert.notEqual(report.files.payload1984.sha256,report.files.currentSource.sha256);
assert(new Set(report.files.payload1984.samples.map(row=>row.width)).size>1);
assert.equal(new Set(report.files.currentSource.samples.map(row=>row.width)).size,1);
report.status="PASS_CONFIRMED_STALE_1984_BUNDLED_SOURCE_CURRENT_COUNT_INDEPENDENT";
fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
