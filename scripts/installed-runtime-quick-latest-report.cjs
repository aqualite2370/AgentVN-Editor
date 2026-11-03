"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict"), { sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-runtime-quick-latest-20261019-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
assert(!fs.existsSync(`${base}/REPORT.md`));
const raw = read(`${base}/player-01.json`), audit = read(`${base}/audit-01.json`), execution = read(`${base}/execution-01.json`);
assert.equal(audit.status, "PASS"); assert.equal(audit.sourceConclusion, raw.status); assert(execution.finishedAt);
for (const s of audit.sources) assert.equal(sha(s.path), s.sha256);
const text = `# 最近有效快存：可区分状态补证

2026-10-19。产品源结论 **${raw.status}**，独立终审 **${audit.status}**。

## 为什么追加

先前quick-gaps35检查/12组合确证了跳过无效档、pending双击保护和共享锁拒写重试。
但语义回退用例的多个有效档都在command0；即使读错为更早有效档也可能通过。
因此原结果只证明“任意有效”，不足以证明“最近有效”。
总报告07及原报告保持原文，当前更正以本报告及后续总报告为准，不掩盖QA证据不足。
这不是新产品缺陷，不重新运行并发或拒写矩阵。

## 真实流程

同一冻结实际安装Player、相同可追溯隔离卡带；每个独立QA身份真实界面保存：

1. 较早有效：command0，短对白。
2. 最近有效：command1，独有MID_ADAPT文本。
3. 最新：command2，超长对白。停进程后仅将该档scene_id改为不存在场景。

真实进程启动，原生列表仍有三档；取消快读保持command0。
确认后必须恢复command1/MID文本，不能为command0或command2。
finally停进程、恢复最新档原始字节，独立终审核保留副本与实际QA存档路径。
重启公开原生库导入卡带，不冒称“不重新导入”的恢复。

| 显示组合 | 较早/最近有效/无效最新 | 实际恢复 | 结果 |
| --- | --- | --- | --- |
${raw.cells.map(c => `| ${c.name} | ${c.distinct ? [c.distinct.oldest.command_index, c.distinct.latestValid.command_index, c.distinct.latest.command_index].join(" / ") : "未完成"} | ${c.restored?.command ?? "NOT_RUN"} | ${c.status} |`).join("\n")}

${raw.cells.length}条完整流程、${raw.launches.length}次真实Player启动；
${raw.screenshots.length}张原生PNG、${raw.nativeSaves.length}份真实存档副本，均独立核SHA及截图viewport×DPR。
四原默认profile/55哈希恢复；12次受控语义注入原字节恢复，所属进程端口无残留。
560产品文件仅先前7项授权Editor变化，冻结Editor/Player/Dev保持，无新编译或收费请求。

范围为安装源卡带库Player及WebView逻辑视口，不是独立Windows/setup/Android、运行中破坏、
原生选择器或物理4K屏幕验收。整体18组仍3PASS/8FAILED/7BLOCKED。

## 文件与命令

原始记录：本目录player-01.json、execution-01.json、audit-01.json。
大文件：F:\\AgentVN\\QA\\Runtime-Quick-Latest-20261019-01。
检查点：F:\\AgentVN\\Checkpoints\\Runtime-Quick-Latest-20261019-01。
runner SHA：${execution.runner.sha256}。

\`\`\`powershell
node --check scripts/installed-runtime-quick-latest-playwright.cjs
node --check scripts/installed-runtime-quick-latest-session.cjs
node scripts/installed-runtime-quick-latest-evidence-test.cjs
node scripts/installed-runtime-quick-latest-session.cjs
node scripts/installed-runtime-quick-latest-audit.cjs
node scripts/installed-runtime-quick-latest-report.cjs
\`\`\`

9项工具自测拒绝不可区分位置、恢复较早/无效档、无效时间顺序、缺候选或错误文本；
不算9项额外产品功能。终审${audit.checks.length}组只核证据与恢复，不替代12真实流程。
`;
fs.writeFileSync(`${base}/REPORT.md`, text, { flag: "wx" });
console.log(JSON.stringify({ status: raw.status, audited: audit.status, flows: raw.cells.length, report: `${base}/REPORT.md` }));
