"use strict";
// Supplemental report only: preserve original QA failures and combine only
// complete passing flows, with explicit disclosure of different NVL inputs.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {sha256}=require("./lib/installed-acceptance.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-paged-4k-20261019-01";
const priorBase="D:/AgentVN/output/installed-runtime-voice-paged-20261019-01";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sha=p=>sha256(fs.readFileSync(p));
const raw=read(path.join(base,"player-01/report.json")),execution=read(path.join(base,"execution-01.json"));
const audit=read(path.join(base,"audit-01-01.json")),fixture=read(path.join(base,"fixtures.json"));
const prior=read(path.join(priorBase,"player-04/report.json"));
const oldAudit=read(path.join(priorBase,"audit-04-01.json"));
assert(raw.finishedAt&&execution.finishedAt&&["PASS","FAILED"].includes(raw.status));
assert.equal(audit.status,"PASS");assert.equal(audit.sourceConclusion,raw.status);
assert.equal(execution.status,raw.status);assert.equal(execution.profileRestoration,"PASS");
assert.equal(raw.cells.length,8);assert.equal(prior.cells.length,24);
assert.equal(oldAudit.status,"PASS");assert.equal(prior.status,"FAILED");
assert.equal(audit.checks.length,8);assert(audit.checks.every(c=>c.status==="PASS"));
for(const source of audit.sources)assert.equal(sha(source.path),source.sha256);
const flows=[...prior.cells.filter(c=>c.status==="PASS"),...raw.cells.filter(c=>c.status==="PASS")];
const names=new Set(flows.map(c=>c.name));assert.equal(names.size,flows.length,"Do not count duplicate successful cells");
const required=[];
for(const [w,h]of [[1920,1080],[2560,1440],[3840,2160]])for(const d of [1,2])
  for(const m of ["normal","reduced"])for(const l of ["agentvn","renpy"])required.push(`${w}x${h}-dpr${d}-${m}-${l}`);
assert(flows.every(c=>required.includes(c.name)));
const uncovered=required.filter(name=>!names.has(name));
const combined=uncovered.length?"BLOCKED":"PASS";
const media=audit.checks.find(c=>c.name.startsWith("Passing source flows")).detail;
const receipt={status:combined,at:new Date().toISOString(),scope:"COMPLEMENTARY_INSTALLED_LIBRARY_PLAYER_INPUTS_NOT_ONE_IDENTICAL_FULL_MATRIX",
  sourceConclusion:raw.status,completeCoveredFlows:flows.length,requiredFlows:24,uncovered,
  identicalInputAcrossResolutions:false,originalFailedMatrixPreserved:true,productChanges:0,modelRequests:0,newBuilds:0,
  sources:[path.join(priorBase,"player-04/report.json"),path.join(priorBase,"audit-04-01.json"),
    path.join(base,"player-01/report.json"),path.join(base,"execution-01.json"),
    path.join(base,"audit-01-01.json"),path.join(base,"fixtures.json"),path.join(base,"export-01/report.json"),
    path.join(base,"profile-restoration.json")].map(p=>({path:p,sha256:sha(p)}))};
const destination=path.join(base,"combined-coverage.json"),reportFile=path.join(base,"REPORT.md");
assert(!fs.existsSync(destination)&&!fs.existsSync(reportFile));
const rows=raw.cells.map(c=>`| ${c.name} | ${c.status} | ${c.checks.length} | ${c.error?.split("\n")[0]||"—"} |`).join("\n");
const text=`# 4K有声分页与真实重启：独立补测

2026-10-19。**补测业务 ${raw.status}；互补输入覆盖 ${combined}；整体回测仍BLOCKED。**
不改写原04的8项QA失败，不撤销NVL快捷按钮重叠产品FAILED。
执行时间：${raw.at}—${raw.finishedAt}（UTC）。

## 输入与实际流程

仅3840×2160、DPR1/2、普通/减少动效、两种布局，共8流程。
只将NVL由340段扩为1200段；普通对白、气泡及合成WAV与原输入一致。
新工程ID为${fixture.projectId}，不是用户工程；无模型请求或新听辨。
两卡带由冻结安装Editor实际发布UI导出，资源/脚本字节已核。
后台导入工程和公开原生命令安装卡带是受控准备，不冒充系统文件选择器验收。

| 4K实际流程 | 结果 | 顶层检查数 | 失败 |
| --- | --- | --- | --- |
${rows}

完整PASS流程包括三种呈现逐页重建全文、第二页手动保存/实际读取、
菜单/页切换/读档不重播、新一句正常播放、真正结束Player后重新启动且不重新植入卡带、
重启后三种模式从真实界面读取原第二页；Ren’Py另测持久化快存分类及最新快读取消/确认。
本轮${media.passingFlows}完整流程核${media.fullyVerifiedPages}页，
${media.realProcessRestarts}次真实重启，${media.realMediaPlays}次实际播放，
${media.completedNegativeWindows}个至少2200ms静默观察窗。
实际${raw.launches.length}次Player启动，${raw.screenshots.length}张原生PNG、
${raw.nativeSaves.length}份真实存档副本；逐文件SHA、生成时间、WebView参数见原JSON。

## 互补证据，不改写旧失败

原04中1080p/1440p的16完整流程加本轮4K完整通过流程，
目前覆盖${flows.length}/24个要求组合，互补业务结论${combined}。
这不是“相同输入一次24流程全通过”。原04的8个4K前置断言FAILED继续保留；
${uncovered.length?`尚缺：${uncovered.join("、")}。`:"24个组合各有完整流程证据。"}
补测8组独立审计PASS只核来源、真实文件及恢复，不算8个额外产品功能。

## 运行来源与恢复

安装Editor SHA f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c；
Player SHA 71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a。
工程：${fixture.input}；SHA ${fixture.inputSha256}。
原runner未改，本轮runner运行期间冻结。四原默认profile/55基线哈希恢复，
560产品文件仅先前7项授权变化，所有归属进程和端口无残留。
大文件仅在F:\\AgentVN\\QA\\Runtime-Voice-Paged-4K-20261019-01；
检查点F:\\AgentVN\\Checkpoints\\Runtime-Voice-Paged-4K-20261019-01。

本片没有产品修改、收费调用、新编译、Android或最终工程操作。
Dev D:\\AgentVN\\AgentVN Dev.exe未重编，SHA
e2ca7c4b70ff485a047c881fc99503ed4628a701deece9c5c9bd650452952d84保持。
本结论限实际安装源卡带库Player及WebView模拟视口，
不证明独立Windows portable/setup、EXE旁saves、Android、旧包升级、
无开发目录机器或物理4K显示器。NVL重叠FAILED及18组账本状态保持。
三快存边界需结合exceptions阶段原始证据核对：已有离线坏JSON回退、真实共享锁拒写/重试
和成功双击的一次写入限定PASS，不能因为另一份报告detail为NOT_RUN就说全部未测；
其它显示组合、语义无效档及第二指针输入确在pending区间的证据仍须单列，不自动算通过。

## 实际命令

\`\`\`powershell
node scripts/voice-runtime-observer-test.cjs
node scripts/full-regression-evidence-test.cjs
node scripts/installed-runtime-voice-paged-4k-session.cjs
node scripts/installed-runtime-voice-paged-4k-audit.cjs 01 01
node scripts/installed-runtime-voice-paged-4k-report.cjs
\`\`\`

观察器5例/证据验证22例先通过，属于工具自测。
业务命令结果${raw.status}，审计命令退出0/PASS只表示8组证据与恢复核对通过。
各步骤命令、退出码、日志SHA在execution-01.json；不将未执行或失败步骤转为通过。
`;
fs.writeFileSync(destination,JSON.stringify(receipt,null,2),{flag:"wx"});
fs.writeFileSync(reportFile,text,{flag:"wx"});
console.log(JSON.stringify({business:raw.status,combined,covered:flows.length,uncovered,media,reportFile}));
