"use strict";
// Generate reports only AFTER terminal UI results and independent restoration
// audit. No acceptance status is inferred from the report generator itself.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process"),{sha256}=require("./lib/installed-acceptance.cjs");
const root="D:/AgentVN",base=path.join(root,"output/installed-runtime-voice-20261019-01");
const summary=path.join(root,"output/full-regression-stage-summary-20261019-04");
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sha=p=>sha256(fs.readFileSync(p));
const raw=read(path.join(base,"player-01/report.json")),audit=read(path.join(base,"audit-01-02.json"));
const execution=read(path.join(base,"execution-01.json")),fixture=read(path.join(base,"fixtures.json"));
const exported=read(path.join(base,"export-01/report.json"));
assert.equal(raw.status,"PASS");assert.equal(audit.status,"PASS");assert.equal(audit.sourceConclusion,"PASS");
assert.equal(execution.status,"PASS");assert.equal(execution.profileRestoration,"PASS");
assert.equal(raw.cells.length,24);assert.equal(audit.checks.length,8);
assert(raw.cells.every(c=>c.status==="PASS"&&c.checks.length===12));
assert(audit.checks.every(c=>c.status==="PASS"));
for(const f of audit.sources)assert.equal(sha(f.path),f.sha256);
const media=audit.checks.find(c=>c.name.startsWith("Successful flows")).detail;
const table=exported.cartridges.map(c=>`| ${c.layout} | \`${c.path}\` | \`${c.sha256}\` |`).join("\n");
const checks=raw.cells.reduce((n,c)=>n+c.checks.length,0);
const voiceReport=`# 安装源 Runtime 语音触发与恢复验收

2026-10-19，Asia/Shanghai。**本片限定范围 PASS；完整回测仍 BLOCKED。**

实际业务执行：${raw.at}—${raw.finishedAt}（UTC）。
两布局 × 1080p/1440p/4K × DPR1/2 × 普通/减少动效：
24 个完整布局流程、${checks} 个顶层业务检查全部 PASS。
实际 ${media.realMediaPlays} 次媒体播放成功并观察到媒体时钟前进；
${media.negativeWindows} 个不短于 2200ms 的静默观察窗口均未额外触发播放。
${raw.screenshots.length} 张原生 PNG 和 ${raw.nativeSaves.length} 份真实存档副本已独立核验。
独立审计 ${audit.checks.length} 组 PASS 是证据与恢复检查，不另算产品业务用例。

## 实际完成的用户流程

- 真实安装 Editor 首页进入隔离小工程；通过实际发布界面导出两种布局。
  工程先经真实随包后台公开导入接口受控准备，不冒充原生工程文件选择器。
- 逐布局、逐显示组合执行普通/NVL/气泡三种模式；新对白正常播放一次。
- 真实菜单、手动保存、菜单返回不重复播放；实际磁盘存档副本保留原字节。
- 推进后从真实存读档界面读取，正文/页面恢复而不重播。
- 读档后正常推进仍能播放；实际 PageUp/PageDown 恢复而不重播，NVL 累积内容一致。
- 浏览器读取真实播放源并核 SHA；原始 play Promise 成功、playing 事件及 timeupdate>0
  共同证明不是仅调用方法或模拟成功。观测包装器实际调用原生 play 并返回原 Promise，
  不模拟播放成功或保存响应。

## 来源与产物

运行 Player：\`${raw.sources.find(f=>f.path.endsWith("agentvn-player.exe")).path}\`，
SHA-256 \`71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a\`。
Editor 为冻结实际 NSIS 1.9.9，SHA-256
\`f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c\`。

隔离工程：\`${fixture.input}\`，SHA \`${fixture.inputSha256}\`。
合成 WAV：\`${fixture.voice.path}\`，16kHz/单声道/2秒/64044字节，
SHA \`${fixture.voice.sha256}\`。这是非人声探针，不是新的音频听辨。

| UI导出布局 | 实际卡带路径 | SHA-256 |
| --- | --- | --- |
${table}

两卡带脚本 SHA 一致；每包 WAV 均与输入相同。
完整生成时间、WAV/脚本/layout/卡带 SHA、运行 PID/父PID/创建时间/端口和
每张截图的实际 viewport/DPR/media/物理像素见 fixtures/export/player/execution/audit 原始 JSON。
大文件在 \`F:\\AgentVN\\QA\\Runtime-Voice-20261019-01\`，旧报告未覆盖。

## 工具失败保留及修正

\`observer-preflight-01.json\` 保留 FAILED：旧审计错误要求首句播放时必须已有剧情 DOM；
实际首句播放早于动画剧情页挂载，因此原命令/场景字段缺失。没有补写原字段或重跑主矩阵。
独立固定首个完成流程，结合真实开始动作、首个已提交 command0 快照、
仅一次播放和实际 WAV 字节核首句；其余 11 次仍严格核 DOM 命令与场景。
\`observer-preflight-02.json\` 同一输入与非法变体 13 项 PASS；
终审核固定输入与最终首个流程深度相同。此修正不是产品修复或 13 项新业务测试。
原工具在 F 盘本片检查点保留。
原终审 \`audit-01-01.json\` 另保留 FAILED：恢复后仍查原默认profile中的本轮卡带，
但该QA目录已合法另名保留。02仅按恢复回执核精确保留路径与24卡带SHA，
不把QA卡带移回用户目录、不重跑27分钟业务或修改原记录。

## 安全收口

四原 Editor/Player Roaming/Local profile 全部恢复，55 原文件 SHA 与独立备份一致。
24 个所属 Player、先前 Editor/后台与本片端口无残留；仅归属终止不冒充正常窗口关闭。
560 产品源码仅保留先前七项授权 Editor 变化；本片产品变化/模型请求/新编译均为0。
Dev 未重编，\`D:\\AgentVN\\AgentVN Dev.exe\` 未覆盖，
SHA \`e2ca7c4b70ff485a047c881fc99503ed4628a701deece9c5c9bd650452952d84\` 保持。
本片未生成 Downloads 工程包；UI卡带下载定向到 F 盘本片目录。
无 Android/APK/ADB 操作，未进入“隐忍的成长”。

## 必须保留的边界

这是实际安装源**卡带库 Player**，不是独立 portable/setup、EXE旁saves、
无开发目录机器或 Android。库插入为公开原生命令受控准备，不是 OS 文件选择器验收。
显示矩阵为真实 WebView 内模拟，不冒称物理4K显示器。
短语音三模式恢复不代证有声极长文本逐页、真实进程重启后的有声快读或设备音频硬件。
夹具故意没有背景命令，截图中的说明性背景占位不是用户工程画面或新背景缺陷。
用户已确认的音频结论保持来源，不声称本轮新听辨。
原18组3PASS/8FAILED/7BLOCKED、NVL满页分支、作者继承/严格几何、资源裁剪等不因此销项。

## 实际命令与结果

\`\`\`powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\installed-preview-session.ps1 -Suite runtime-voice -Action Prepare
node scripts/installed-runtime-voice-fixtures.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\installed-preview-session.ps1 -Suite runtime-voice -Action Launch
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\installed-preview-session.ps1 -Suite runtime-voice -Action Observe
node scripts/installed-runtime-abilities-export.cjs D:\\AgentVN\\output\\installed-runtime-voice-20261019-01\\export-01 D:\\AgentVN\\output\\installed-runtime-voice-20261019-01\\fixtures.json
node scripts/installed-runtime-voice-matrix.cjs 01
node scripts/installed-runtime-voice-observation-replay.cjs capture
node scripts/installed-runtime-voice-observation-replay.cjs test
node scripts/installed-runtime-voice-support-checks.cjs
node scripts/installed-runtime-voice-audit.cjs 01 01
node scripts/installed-runtime-voice-audit.cjs 01 02
\`\`\`

capture 按旧错误 oracle 退出1并保留，audit01因QA恢复路径退出1并保留；
test 13项及audit02八组退出0，其它业务/会话命令均退出0。
support 为六语法、22证据校验例和两PS解析，
不是新的产品流程。matrix 的 finally 实际执行 Restore，命令及原始日志均有记录。
显式环境变量：\`AGENTVN_TEST_PROJECT=${fixture.input}\`，
\`AGENTVN_WORKSPACE_OUTPUT=${base}\`；导出另指定本轮 run/work 变量。
`;
fs.writeFileSync(path.join(base,"REPORT.md"),voiceReport,{flag:"wx"});
assert(!fs.existsSync(summary),"Never overwrite a prior summary");
const args=["scripts/full-regression-stage-evidence-receipt.cjs",summary,
  "--current-20261019","--with-runtime-voice-20261019"];
const receiptRun=spawnSync(process.execPath,args,{cwd:root,encoding:"utf8",windowsHide:true,timeout:60000});
if(fs.existsSync(summary))fs.writeFileSync(path.join(summary,"receipt-command.log"),
  (receiptRun.stdout||"")+(receiptRun.stderr||""),{flag:"wx"});
assert.equal(receiptRun.status,0,receiptRun.stderr||receiptRun.stdout);
const receipt=read(path.join(summary,"evidence-receipt.json"));assert.equal(receipt.evidenceReceiptStatus,"PASS");
const groups=receipt.groups.map(g=>`| ${g.id} | ${g.requirement} | ${g.status} | ${g.qualification} |`).join("\n");
const extra=receipt.extraRequirements.map(g=>`- ${g.id}：${g.status}。${g.scope}`).join("\n");
const globalReport=`# AgentVN 完全回测：当前阶段总报告04

2026-10-19，Asia/Shanghai。**整体 BLOCKED，全部规划回测尚未完成。**
本报告续接03快照；历史 PASS、FAILED、BLOCKED、工具失败及原报告均保留。

## 当前总览

18个缺口组：**3 PASS / 8 FAILED / 7 BLOCKED**，不是完成率。
其中 FAILED 组仍有后续未执行步骤，BLOCKED 组也可能已有部分通过；
不得把“出现过PASS”当整组收口。

| ID | 完整要求 | 当前整组结论 | 实际通过、失败及未执行范围 |
| --- | --- | --- | --- |
${groups}

完整逐项范围、步骤、命令和证据见 [主账本](D:/AgentVN/plans/FULL_REGRESSION_20261017.md)。
本次来源回执核对 ${receipt.sources.length} 份来源及560产品源码（仅先前七项授权变化），
不是重新运行 ${receipt.sources.length} 套测试。

## 本次新增的真实证据

安装源卡带库 Player，两布局×12组合，24完整流程/${checks}顶层检查 PASS。
实际 ${media.realMediaPlays} 次播放均成功并有媒体时钟前进，
${media.negativeWindows} 个静默观察窗口未重播；
普通/NVL/气泡分别覆盖真实菜单、原生手动保存、读取、正常再推进及PageUp/PageDown。
${raw.screenshots.length}PNG/${raw.nativeSaves.length}原生存档副本已核像素/SHA；
8组独立审计PASS，四原profile55SHA恢复，进程/端口清理完成。
详情 [语音阶段报告](D:/AgentVN/output/installed-runtime-voice-20261019-01/REPORT.md)。
这是短语音恢复证据，不是独立Windows/setup、Android或新听辨。

此前完整剧情业务矩阵24布局流程/180检查、作者页/普通对白/六角色限定证据、
官方GUI和真实模型的已证失败、NSIS/MSI覆盖及迁移子证据均保留原范围。
新Dev遮罩修复没有进入冻结1.9.9安装候选，不能用Dev PASS撤销G12安装版FAILED。

## 18组以外仍须单独追踪

${extra}

此外，原生长错误结果弹窗、完整诊断可达性与发布成功链仍未收口。
HOST-01 主题月亮图标仍 FAILED（x/y各偏2px并越出thumb），没有因本片语音通过而销项；
HOST-02 正常关闭后台残留、HOST-03 后端重载串图，以及创造焦点、Editor/Runtime动效、
官方GUI条件参数和真实Agent失败均按原证据保留，不混同环境阻断。
“隐忍的成长”未执行；全部临时工程/安装版/双平台前置通过后才允许最终综合验收。

## 真实模型、安装与仍需外部条件的流程

两项真实DeepSeek已各提交一次、各一次HTTP200，共6456tokens，
均受限工具调用失败，toolEvents0；审核/合并/重开/导出消费未执行。
小说真实入口隐藏，第三项模型 NOT_RUN。不自动重试付费任务，
不再要求重复配置已清除的隔离凭据，不读取原用户密钥。

${receipt.blockers.map(b=>`- ${b.id}：${b.condition}`).join("\n")}

缺的是真实原生输入能力，不是用户未授权。可信旧游戏与签名升级链不能由重编伪旧版替代。
宿主本机实际安装测试不代证无开发目录机器。现阶段只测不修，
其它产品失败需要用户另行决定修复范围；不绕过失败路径或重建碰运气。

## 文件、清理及命令

实际安装Editor SHA \`${receipt.safety.installedEditor.sha256}\`。
Dev：\`${receipt.safety.dev.path}\`，SHA \`${receipt.safety.dev.sha256}\`；
本片仅QA/报告，未重编或覆盖Dev。无本轮Android或最终工程操作。
原D盘MSI程序在先前授权测试已卸载，历史DB与F独立原备份一致；
不能继续声称等待同一MSI授权或要求已卸载EXE存在。

\`\`\`powershell
node scripts/installed-runtime-voice-matrix.cjs 01
node scripts/installed-runtime-voice-observation-replay.cjs capture
node scripts/installed-runtime-voice-observation-replay.cjs test
node scripts/installed-runtime-voice-support-checks.cjs
node scripts/installed-runtime-voice-audit.cjs 01 01
node scripts/installed-runtime-voice-audit.cjs 01 02
node scripts/full-regression-stage-evidence-receipt.cjs ${summary} --current-20261019 --with-runtime-voice-20261019
\`\`\`

capture保留QA oracle失败，audit01保留恢复后查旧路径的工具失败；
后续回放校验、矩阵、audit02与最后来源回执退出0。
来源回执自身只作证据/恢复审查，新增产品测试数0；本片新业务数为上述${checks}。
原始失败/阻断及NOT_RUN未改为通过，全部非延期门槛通过前不报告整体完成。
`;
fs.writeFileSync(path.join(summary,"REPORT.md"),globalReport,{flag:"wx"});
console.log(JSON.stringify({voiceStage:"PASS",overall:"BLOCKED",checks,mediaPlays:media.realMediaPlays,
  receiptSources:receipt.sources.length,voiceReport:path.join(base,"REPORT.md"),summary:path.join(summary,"REPORT.md")}));
