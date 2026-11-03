"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process");
const quickGaps=process.argv.includes("--with-quick-gaps-20261019");
const quickLatest=process.argv.includes("--with-quick-latest-20261019");
const portrait=process.argv.includes("--with-dialog-portrait-20261019");
assert(!quickLatest||quickGaps);
assert(!portrait||quickLatest);
const number=portrait?"09":quickLatest?"08":quickGaps?"07":"06";
const root="D:/AgentVN",dest=path.join(root,`output/full-regression-stage-summary-20261019-${number}`);
assert(!fs.existsSync(dest),"Previous stage reports are immutable");
const args=["scripts/full-regression-stage-evidence-receipt.cjs",dest,"--current-20261019",
  "--with-runtime-voice-20261019","--with-runtime-voice-paged-20261019",
  "--with-runtime-voice-paged-4k-20261019","--with-quick-source-review-20261019"];
if(quickGaps)args.push("--with-quick-gaps-20261019");
if(quickLatest)args.push("--with-quick-latest-20261019");
if(portrait)args.push("--with-dialog-portrait-20261019");
const command=spawnSync(process.execPath,args,{cwd:root,encoding:"utf8",windowsHide:true,timeout:60000});
if(fs.existsSync(dest))fs.writeFileSync(path.join(dest,"receipt-command.log"),(command.stdout||"")+(command.stderr||""),{flag:"wx"});
assert.equal(command.status,0,command.stderr||command.stdout);
const receipt=JSON.parse(fs.readFileSync(path.join(dest,"evidence-receipt.json"),"utf8"));
assert.equal(receipt.evidenceReceiptStatus,"PASS");
const groups=receipt.groups.map(g=>`| ${g.id} | ${g.requirement} | ${g.status} | ${g.qualification} |`).join("\n");
const extra=receipt.extraRequirements.map(r=>`- ${r.id}：${r.status}。${r.scope}`).join("\n");
const quickText=quickGaps?`
本轮补测${receipt.quickGapSupplement.combinations}组合、${receipt.quickGapSupplement.checks}项新真实UI检查，
源结论${receipt.quickGapSupplement.sourceConclusion}。语义无效最新档与真实pending内第二pointer
各12组合；共享锁拒写11新组合加此前同候选1080p限定证据，未重复已证明链。
保存失败保留六档、恢复后重试；并发输入只写一档、终态可再保存。
${receipt.quickGapSupplement.screenshots}张原生PNG及${receipt.quickGapSupplement.nativeSaveCopies}份存档副本独立核验，
四原默认profile/55哈希已恢复，归属进程/端口无残留。旧FAILED原位保留。
详见 [快存补测报告](D:/AgentVN/output/installed-runtime-quick-gaps-20261019-01/REPORT.md)。
这是安装源卡带库Player证据，不是独立Windows/setup/Android或原生选择器通过。
${quickLatest?`
07之后再审发现：六个有效候选均command0，原35检查只能证明跳过无效档，不能唯一证明选最近有效档。
原07与35检查报告不改写；新增独立12组合三位置补证：
较早有效command0、最近有效command1、最新无效command2，实际恢复必须是command1/MID文本。
该补证源${receipt.quickLatestEvidence.sourceConclusion}，通过${receipt.quickLatestEvidence.passingCombinations}/12；
9项判定器自测包含拒绝不可区分状态，6组独立终审PASS只是证据/恢复核验。
见 [最近有效档补证](D:/AgentVN/output/installed-runtime-quick-latest-20261019-01/REPORT.md)。
`:`
注意：有效候选共享command0，最近有效档的身份尚未唯一证明；该完整账项仍BLOCKED。
`}
`:`其它显示组合、语义无效档和第二pointer明确发生在pending区间仍未证明，
三项完整范围BLOCKED，见 [跨来源更正](D:/AgentVN/output/installed-quick-gap-review-20261019-01/REPORT.md)。`;
const text=`# AgentVN 完全回测：当前阶段总报告${number}

2026-10-19，Asia/Shanghai。**整体BLOCKED，约定范围未完全回测通过。**
本报告追加4K补测及快存跨来源更正，不覆盖历史报告、原始FAILED、BLOCKED或用户延期。

## 18组要求

${receipt.counts.PASS||0} PASS / ${receipt.counts.FAILED||0} FAILED / ${receipt.counts.BLOCKED||0} BLOCKED不是完成率；组内限定PASS不能代替整组验收。

| ID | 完整要求 | 状态 | 限定范围及缺口 |
| --- | --- | --- | --- |
${groups}

## 本次新增与更正

4K补测8完整流程/72检查PASS：268页全文、8次真实进程重启、
72次真实媒体播放、112个至少2200ms静默窗口、48原生PNG和36真实存档副本。
独立8组来源/恢复审查PASS不是8个额外产品功能。
结合原04中1080p/1440p的16完整流程，分页/重启24组合各有完整业务证据。
4K采用更长NVL输入，不声称相同输入一次全矩阵PASS；原04的8项QA前置失败仍保留。
详见 [4K阶段报告](D:/AgentVN/output/installed-runtime-voice-paged-4k-20261019-01/REPORT.md)。
NVL-QUICK-OVERLAP-01仍FAILED，不因分页、存档和语音通过而撤销。

快存三项在另一份business报告detail中的NOT_RUN不能当作整体未测：
同一冻结Player已有离线坏JSON回退、真实共享锁拒写/六档保留/重试、
成功双击一次写入的1080p限定证据。5项来源/留存字节核对PASS，新增产品用例0。
${quickText}
${portrait?`
## 新增：专用对白头像真实链

实际安装Editor对白头像选择→原生保存→首页重开→两布局真实UI导出5检查PASS，
两个卡带含正确绑定及相同升级头像字节。但安装源Player两布局24显示组合专用头像均缺失，
登记DIALOG-PORTRAIT-01，G16从BLOCKED改为FAILED；原通用图片消费PASS不代证。
01的QA下载路径失败与02的短句同步超时原文/runner均保留；
03复用02已核导出，没有重复作者/模型/导出，实际执行24断言。
独立9组审计PASS只是证据与恢复可信。三会话四原profile55哈希恢复，
29原生PNG（玩家24），两本轮Downloads工程包核F副本后精确清理，可恢复。
见 [专用头像报告](D:/AgentVN/output/installed-dialog-portrait-20261019-03/REPORT.md)。
`:``}

## 独立缺陷与剩余范围

${extra}

原生长错误结果弹窗/完整诊断可达性、发布成功链仍未收口。
原FAILED报告与当时运行的QA工具版本保持；未获授权不自动修产品。
“隐忍的成长”未执行，仍须等全部临时工程、安装版和双平台前置通过。

## 外部条件、收费与清理

${receipt.blockers.map(b=>`- ${b.id}：${b.condition}`).join("\n")}

真实DeepSeek两任务各一次请求、均HTTP200，共6456tokens，toolEvents0且工具调用失败；
第三小说任务入口隐藏，模型请求NOT_RUN。没有追加收费重试或重新要求配置凭据。

四原默认profile55基线哈希恢复，所有本轮归属进程/端口无残留。
560产品文件仅先前7项授权Editor变化，未更改Runtime产品；安装候选未重建。
Editor SHA ${receipt.safety.installedEditor.sha256}；
Dev ${receipt.safety.dev.path} SHA ${receipt.safety.dev.sha256}，本片只QA/文档，未重编。
新Dev遮罩修复未进入冻结安装候选，不能用Dev PASS撤销安装版G12失败。
大文件集中F:\\AgentVN，历史兼容链接保留；本轮无Android/最终工程操作。

本回执核${receipt.sources.length}份来源，不是重新执行${receipt.sources.length}套产品测试。
具体命令/原始结果在各阶段报告及execution JSON；总回执命令退出0只表示来源审查通过：

\`\`\`powershell
node ${args.join(" ")}
\`\`\`

全体非延期要求通过前，不报告整体完成。
`;
fs.writeFileSync(path.join(dest,"REPORT.md"),text,{flag:"wx"});
console.log(JSON.stringify({overall:"BLOCKED",sourceReceipt:"PASS",sources:receipt.sources.length,
  counts:receipt.counts,report:path.join(dest,"REPORT.md")}));
