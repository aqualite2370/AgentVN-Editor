"use strict";
// Terminal-only report generation. Verifies original evidence, preserves old
// failures, and keeps successful functional checks separate from visual FAIL.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process"),{sha256}=require("./lib/installed-acceptance.cjs");
const {classifyVoicePages}=require("./lib/voice-paged-classification.cjs");
const root="D:/AgentVN",base=path.join(root,"output/installed-runtime-voice-paged-20261019-01");
const summary=path.join(root,"output/full-regression-stage-summary-20261019-05");
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sha=p=>sha256(fs.readFileSync(p));
const raw=read(path.join(base,"player-04/report.json")),execution=read(path.join(base,"execution-04.json"));
const audit=read(path.join(base,"audit-04-01.json")),fixture=read(path.join(base,"fixtures.json"));
const exported=read(path.join(base,"export-01/report.json"));
const overlap=read(path.join(base,"supplemental-nvl-overlap-04-agentvn-retry01.json"));
const capacity=read(path.join(base,"capacity-4k-observation-04-retry01.json"));
const classification=classifyVoicePages(raw,capacity),business=classification.status;
assert(raw.finishedAt&&execution.finishedAt);assert(["PASS","FAILED"].includes(raw.status));
assert.equal(audit.status,"PASS");assert.equal(audit.sourceConclusion,raw.status);
assert.equal(execution.status,raw.status);assert.equal(execution.profileRestoration,"PASS");
assert.equal(raw.cells.length,24);assert.equal(raw.onlyCell,null);
assert.equal(audit.checks.length,8);assert(audit.checks.every(c=>c.status==="PASS"));
for(const s of audit.sources)assert.equal(sha(s.path),s.sha256);
assert.equal(overlap.status,"FAILED");assert.equal(overlap.geometry.hits.length,38);
const media=audit.checks.find(c=>c.name.startsWith("Passing source flows")).detail;
const checks=raw.cells.reduce((n,c)=>n+c.checks.length,0),passed=raw.cells.filter(c=>c.status==="PASS").length;
const cellTable=raw.cells.map(c=>{
  const classified=classification.rows.find(r=>r.name===c.name);
  return `| ${c.name} | ${c.status} / ${classified.status} | ${c.checks.length} | ${classified.reason||"完整流程通过"} |`;
}).join("\n");
const productTable=exported.cartridges.map(c=>`| ${c.layout} | \`${c.path}\` | \`${c.sha256}\` | \`${c.layoutSha256}\` |`).join("\n");
const detailed=`# 有声长文本分页与真实进程重启恢复：安装源验收

2026-10-19，Asia/Shanghai。**业务覆盖 ${business}；原始QA矩阵 ${raw.status}；补充NVL布局 FAILED；整体回测 BLOCKED。**
执行时间 ${raw.at}—${raw.finishedAt}（UTC）。独立证据审查不是额外产品流程。

## 当前实际结果

1080p/1440p/4K×DPR1/2×普通/减少动效×AgentVN/Ren’Py：
24个布局流程已尝试，${passed}完整通过，${classification.counts.blocked}个因QA夹具不足而阻断，
${classification.counts.failed}个其它待复核失败，${checks}项顶层检查（含原始失败及部分流程检查）。
通过流程全文核对 ${media.fullyVerifiedPages}页、${media.realProcessRestarts}次真实进程重启；
真实媒体播放${media.realMediaPlays}次，静默观察窗口${media.completedNegativeWindows}个，
每个至少2200ms。${raw.screenshots.length}张原生PNG及${raw.nativeSaves.length}份真实存档副本。
8组独立证据/恢复审查PASS不是“再通过8个用户功能”。

| 真实流程 | 原始QA / 覆盖分类 | 已执行检查数 | 范围与失败原因 |
| --- | --- | --- | --- |
${cellTable}

## 4K夹具不足，不是已证产品分页故障

原报告逐字保留FAILED。4K流程在NVL“Fixture must actually paginate”前置断言停止，
不能计为完整流程通过，也不能据此宣称产品无法分页。
独立只读观察首个4K/DPR1/普通AgentVN：15300字符原文完整放入一页，
页内字符Range与滚动尺寸均容纳；同一夹具不足以强制其分页。
这是单个4K样本的容量实测，不推定其余7组合的字体/视觉全部通过。
其它4K流程记录的同一前置断言失败按QA覆盖不足保留BLOCKED；
NVL页中保存、气泡、真实重启及快读后续步骤没有执行。
这些步骤需要更强、独立命名的4K输入补测；不修改或重启原runner、不重写历史失败。
原被动观察器读取写入中的JSON而BLOCKED；retry01只修QA读取竞态并独立记录成功。
分类器8项自测验证空矩阵/缺步骤不能PASS、其它错误不能归因夹具；
这些都是报告工具检查，新增产品UI用例为0。

## 用户路径与断言

下列完整链只对表中${passed}个完整PASS流程成立；4K已执行的普通对白步骤独立留在原报告，
不能把后续未执行步骤写成已完成。

- 冻结实际安装Editor经真实首页和发布UI导出两布局；工程受控后台导入，
  不冒充原生文件选择器。导出脚本相同，WAV字节与输入完全一致。
- 普通、NVL、气泡的编号极长文本实际逐页显示；每页文字按顺序拼接还原全文，
  控件内字符Range/滚动尺寸、页面边界和横向溢出均断言。NVL姓名与正文分开取样。
- 第2页经真实界面手动保存；Ren’Py另真实快存。记录真实原生保存文件字节，
  菜单返回、页切换和页中读取不重复播放；恢复页码、当前正文和NVL状态。
- 结束当前Player进程，记录终止及端口消失；重新启动同一安装源EXE，
  不重新导入卡带、不更改存档身份。库记录和存档完整对象与字节保持。
- 重启后三种模式从真实存读界面读取原第2页，静默恢复；
  正常推进到新一句后，原生媒体播放仍可成功。每种模式逐页推进，没有跳页内部调用。
- Ren’Py持久化三种快存通过分类页逐项读取；最新快读真实取消及再次确认，
  恢复正确页面且不重播。AgentVN没有快存动作，未伪造该按钮；其手动重启链独立通过。
- 媒体观察器仅委托原始play方法并返回原Promise，记录playing/timeupdate；
  不模拟解码、播放成功、Runtime store、存档响应或动画完成。

## 独立视觉缺陷：NVL-QUICK-OVERLAP-01，FAILED

1080p/DPR1/普通、AgentVN、command2/NVL第2页，38个非空白字符Range矩形
与收起态快捷菜单按钮矩形重叠。真实参数前后保持，F盘原生PNG可复核：
\`${overlap.screenshot.path}\`，SHA \`${overlap.screenshot.sha256}\`。
这不符合控件不覆盖对白的几何要求；结论不夸大为所有分辨率失败、字形自身裁切
或所有相交字符墨迹都被遮住。分页/语音业务PASS不能冲销该FAIL。
Ren’Py同尺寸单时刻8控件无相交只是限定补证，不代证全视觉矩阵。
第一次只读probe正逢真实Player重启关闭目标而BLOCKED，报告保留；
retry01只附着新进程采样，不点击、不更改视口、存档或音频。

## 产物来源与哈希

实际Editor 1.9.9：SHA
\`f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c\`；
实际安装源Player：SHA
\`71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a\`。
工程 \`${fixture.input}\`，SHA \`${fixture.inputSha256}\`。
合成2秒WAV \`${fixture.voice.path}\`，SHA \`${fixture.voice.sha256}\`。
没有新听辨，用户此前音频确认保持来源。

| 布局 | UI导出卡带 | 卡带SHA-256 | layout.json SHA-256 |
| --- | --- | --- | --- |
${productTable}

逐文件生成时间、实际viewport/DPR/media与PNG像素、PID/父PID/创建时间/端口、
原生存档字节及保留路径见fixtures/export/player/execution/audit原始JSON。
大文件实体仅在 \`F:\\AgentVN\\QA\\Runtime-Voice-Paged-20261019-01\`，
检查点在 \`F:\\AgentVN\\Checkpoints\\Runtime-Voice-Paged-Restart-20261019-01\`。

## QA失败保留

- execution01：后台尚未就绪即Observe，异常清理又依赖缺失backend-ready而失败。
  后来核验同一所属后台自动就绪后续接；未重启这批产品进程或伪称从未失败。
- player/execution02：重启文档漏装QA观察器。归属停止后四原profile实际恢复；
  旧wrapper虽结束仍误标RUNNING，作为INCOMPLETE_ABORTED保留，不计产品FAIL或PASS。
  原runner/wrapper逐字节存入检查点，abort02独立回执保留。
- 只修QA就绪等待、显式安装已加载文档观察器和非终态拒绝；观察器5自测、
  证据验证22例及脚本语法/PS解析通过，不另算产品用例。
- 03仅1080p/DPR1/普通的两布局诊断，18检查/98页/2重启/18播放/28窗口，
  独立8组审查PASS。完整04使用同runnerSHA，不把诊断替代完整矩阵。

## 清理与边界

四原默认profile及55原文件与独立备份SHA恢复；本轮原生保存留在另名QA目录，
玩家原数据未被测试卡带替换。实际${raw.launches.length}次Player启动；完整24流程原预期48次，
4K前置阻断导致后续重启未执行，不能声称48次已完成。归属清理见原报告；
测试终止不冒充正常原生退出验收。560产品源码仅先前7授权Editor变化，冻结EXE保持。
本片产品修改/模型请求/新编译均0；Dev未重编未覆盖，\`D:\\AgentVN\\AgentVN Dev.exe\`
保持原SHA \`e2ca7c4b70ff485a047c881fc99503ed4628a701deece9c5c9bd650452952d84\`。

这是实际安装源卡带库Player，不是Windows独立portable/setup或EXE旁saves、
Android、干净无开发目录机器或物理4K显示器。没有Android/APK/ADB操作，
没有Downloads新工程包或最终工程操作。旧18组FAILED/BLOCKED和其它缺陷保持。

## 实际执行命令

\`\`\`powershell
node scripts/installed-runtime-voice-paged-session.cjs
node scripts/installed-runtime-voice-paged-session.cjs --resume-active
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/installed-runtime-voice-paged-abort.ps1
node scripts/voice-runtime-observer-test.cjs
node scripts/installed-runtime-voice-paged-session.cjs --resume-restored=03 --only-cell=1920x1080-dpr1-normal
node scripts/installed-runtime-voice-paged-audit.cjs 03 01
node scripts/installed-runtime-voice-paged-support.cjs
node scripts/installed-runtime-voice-paged-overlap-observe.cjs
node scripts/installed-runtime-voice-paged-session.cjs --resume-restored=04
node scripts/installed-runtime-voice-paged-overlap-observe.cjs 04 agentvn
node scripts/installed-runtime-voice-paged-overlap-observe.cjs 04 agentvn retry01
node scripts/installed-runtime-voice-paged-4k-observe.cjs
node scripts/installed-runtime-voice-paged-4k-observe.cjs retry01
node scripts/voice-paged-classification-test.cjs
node scripts/installed-runtime-voice-paged-audit.cjs 04 01
\`\`\`

首两次因上述QA问题退出1，abort退出0且原矩阵不完整；
03/其audit、工具support、Ren’Py只读probe退出0；
04AgentVN第一次probe因真实重启关闭退出1/BLOCKED，retry01退出1/产品几何FAILED。
完整04原始QA退出1/FAILED，分类业务覆盖${business}，独立audit退出0仅核证据与恢复；
原4K观察器退出1/BLOCKED、retry01退出0/RECORDED，分类器8自测退出0。
不混为全部功能通过。
环境变量在session中显式设置AGENTVN_TEST_PROJECT与独立AGENTVN_WORKSPACE_OUTPUT。
正常用户流程界面动作与受控准备、只读观察、工具审查已分别标明。
`;
assert(!fs.existsSync(path.join(base,"REPORT.md"))&&!fs.existsSync(summary));
fs.writeFileSync(path.join(base,"REPORT.md"),detailed,{flag:"wx"});
const args=["scripts/full-regression-stage-evidence-receipt.cjs",summary,"--current-20261019",
  "--with-runtime-voice-20261019","--with-runtime-voice-paged-20261019"];
const command=spawnSync(process.execPath,args,{cwd:root,encoding:"utf8",windowsHide:true,timeout:60000});
if(fs.existsSync(summary))fs.writeFileSync(path.join(summary,"receipt-command.log"),(command.stdout||"")+(command.stderr||""),{flag:"wx"});
assert.equal(command.status,0,command.stderr||command.stdout);
const receipt=read(path.join(summary,"evidence-receipt.json"));assert.equal(receipt.evidenceReceiptStatus,"PASS");
const groups=receipt.groups.map(g=>`| ${g.id} | ${g.requirement} | ${g.status} | ${g.qualification} |`).join("\n");
const extra=receipt.extraRequirements.map(r=>`- ${r.id}：${r.status}。${r.scope}`).join("\n");
const complete=`# AgentVN 完全回测：当前阶段总报告05

2026-10-19，Asia/Shanghai。**整体BLOCKED，尚未完成约定全回测。**
本报告追加有声长文本及真实进程重启证据，并披露新NVL几何失败；
不删除或重写此前报告04、原始QA失败、产品FAILED、BLOCKED或用户延期。

## 18组完整要求

**3 PASS / 8 FAILED / 7 BLOCKED**是整组账本，不是完成率。
FAILED组还包含未执行依赖步骤，BLOCKED组可能已有部分限定PASS。

| ID | 完整要求 | 当前整组状态 | 实际范围 |
| --- | --- | --- | --- |
${groups}

来源回执本次核${receipt.sources.length}份来源和560产品文件；
不是重新执行${receipt.sources.length}套产品测试。

## 本轮新增

安装源卡带库Player有声分页/重启业务覆盖：${business}，原始QA矩阵${raw.status}保留。
24流程已尝试/${checks}顶层检查，${passed}完整流程通过，${classification.counts.blocked}个4K流程
因NVL夹具不够长而BLOCKED，其后续气泡/重启/快读步骤未执行。全文核${media.fullyVerifiedPages}页，
${media.realProcessRestarts}真实重启、${media.realMediaPlays}实际播放、
${media.completedNegativeWindows}静默窗口，${raw.screenshots.length}PNG/${raw.nativeSaves.length}原生存档副本。
详见 [分页与重启阶段报告](D:/AgentVN/output/installed-runtime-voice-paged-20261019-01/REPORT.md)。
**独立补充NVL-QUICK-OVERLAP-01 FAILED**：AgentVN1080p/DPR1/普通，
38非空白字符矩形与收起态快捷菜单按钮相交；正文页内无裁切不代表不被其它控件覆盖。
本片只测试，不自动修复。

短语音24流程/288检查、288真实播放/288静默窗口，以及剧情业务24流程/180检查，
保留各自范围，不相加冒充独立功能完成或独立Windows/setup/Android通过。
新Dev遮罩授权修复未进入冻结1.9.9安装候选，G12安装版失败不能被Dev PASS撤销。

## 18组之外及延期

${extra}

原生长错误结果弹窗与完整诊断可达性、成功发布链仍未收口。
HOST-02后台残留、HOST-03重载串图、真实Agent/官方GUI/创造焦点及Runtime动效失败均保留。
“隐忍的成长”未执行，必须等待临时工程/安装版/双平台前置全部通过。

## 收费、外部条件及清理

真实DeepSeek两任务各一次请求、HTTP200，共6456tokens，均工具调用失败、toolEvents0；
第三小说任务入口隐藏NOT_RUN。未追加收费重试，不读取原凭据，不重复要求配置。

${receipt.blockers.map(b=>`- ${b.id}：${b.condition}`).join("\n")}

四原profile55SHA恢复，所属进程/端口无残留，560产品文件保持仅先前7授权变化。
冻结安装EditorSHA \`${receipt.safety.installedEditor.sha256}\`；
Dev \`${receipt.safety.dev.path}\`，SHA \`${receipt.safety.dev.sha256}\`，
本片只QA/文档，未重编。Android、旧游戏升级及最终工程未因本片通过而改状态。
各实际业务/工具命令及原失败见阶段报告；来源回执命令如下，退出0只表示回执审查成功：

\`\`\`powershell
node ${args.join(" ")}
\`\`\`

全部非延期必需项通过前，不报告“约定范围完全回测通过”。
`;
fs.writeFileSync(path.join(summary,"REPORT.md"),complete,{flag:"wx"});
console.log(JSON.stringify({business,rawSource:raw.status,visual:"FAILED",overall:"BLOCKED",checks,passed,
  media,sourceCount:receipt.sources.length,report:path.join(base,"REPORT.md"),summary:path.join(summary,"REPORT.md")}));
