"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-runtime-quick-gaps-20261019-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
assert(!fs.existsSync(`${base}/REPORT.md`));
const raw = read(`${base}/player-01.json`), audit = read(`${base}/audit-01.json`), execution = read(`${base}/execution-01.json`);
assert.equal(audit.status, "PASS"); assert.equal(audit.sourceConclusion, raw.status); assert(execution.finishedAt);
for (const s of audit.sources) assert.equal(sha(s.path), s.sha256);
const rows = raw.cells.map((c, index) => `| ${c.name} | ${c.checks[0]?.status || "NOT_RUN"} | ${
  index ? c.checks[1]?.status || "NOT_RUN" : "此前同候选限定PASS，本轮不重复"} | ${
  c.checks.at(-1)?.status || "NOT_RUN"} | ${c.status} |`).join("\n");
const timings = raw.cells.filter(c => c.checks[0]?.status === "PASS").map(c => c.checks[0].detail.timing);
const checks = raw.cells.reduce((n, c) => n + c.checks.length, 0);
const text = `# 快存剩余边界补测

2026-10-19。源业务结论 **${raw.status}**；独立证据/恢复终审 **${audit.status}**。
真实安装目录内冻结Player，卡带库模式；不是独立Windows portable/setup、EXE旁saves、Android或物理4K显示器验收。

## 真实用户流程

复用已核安装Editor导出的隔离小工程卡带，不再次导出相同输入。
12个独立QA安装身份；每组真实界面关闭自动存档、设置文字速度、六次点击快存建立六档基线。

- 并发：真实双击，第二可信pointerdown发生在实际busy=true且按钮disabled期间；
  仅第一次click提交，落盘只替换一档，结束后再点击可成功保存。不修改产品、不人为延迟。
- 拒写：11个新组合通过真实Windows读共享锁拒绝原子替换，旧六档SHA不变、无tmp；
  解锁后真实UI重试仅替换目标。1080p/DPR1/普通沿用同候选此前已证明样本，不重跑。
  这是共享锁拒写，不声称ACL、独立客户端安装目录或Android拒写。
- 最新档语义无效：Player停后仅把最新档scene_id改为不存在场景，保留合法JSON及其它字段；
  真进程启动后原生列表仍保留六档，快读跳过该档。取消不改变当前command1，
  确认回到最近有效command0。finally停进程并恢复原字节。
  重启使用公开原生库导入，明确不冒称“不重新导入”的重启测试。

## 显示矩阵

| WebView组合 | 真实pending内第二pointer | 拒写保留/重试 | 语义无效最新档回退 | 整组 |
| --- | --- | --- | --- | --- |
${rows}

本轮${raw.cells.length}组合、${checks}项新真实UI检查；
${raw.screenshots.length}张原生PNG、${raw.nativeSaves.length}份真实存档副本、
${raw.launches.length}次Player启动、${raw.locks.length}次共享锁、${raw.faults.length}次受控语义破坏。
已通过pending区间范围${timings.length ? Math.min(...timings.map(t => t.pendingMs)).toFixed(2) : "N/A"}–
${timings.length ? Math.max(...timings.map(t => t.pendingMs)).toFixed(2) : "N/A"}ms；
逐次原始指针/busy事件均在player-01.json，并非以固定等待冒充时序证据。

## 来源与恢复

- frozen Player SHA-256：71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a。
- runner SHA-256：${raw.runner.sha256}。
- 四原默认profile完整归还，55文件哈希与独立备份匹配；所有语义破坏原字节恢复、共享锁释放，
  归属Player/锁进程和debugger端口均无残留。终审${audit.checks.length}组只是证据核验，不是额外产品用例。
- 560产品文件仅先前7项已授权Editor变化，无本轮产品修改；Dev SHA不变，本片未重编。
- 日志/PNG/存档副本：F:\\AgentVN\\QA\\Runtime-Quick-Gaps-20261019-01。
  检查点：F:\\AgentVN\\Checkpoints\\Runtime-Quick-Gaps-20261019-01。
- 此前exceptions-01/02整体FAILED、历史NOT_RUN和跨来源更正均保持原位；这里只补限定缺口。

## 实际命令

\`\`\`powershell
node --check scripts/installed-runtime-quick-gaps-playwright.cjs
node --check scripts/installed-runtime-quick-gaps-session.cjs
node scripts/installed-runtime-quick-observation-test.cjs
node scripts/installed-runtime-quick-gaps-session.cjs
node scripts/installed-runtime-quick-gaps-audit.cjs 01
node scripts/installed-runtime-quick-gaps-report.cjs
\`\`\`

时序oracle10自测及两PS解析通过属于工具检查；产品会话与终审见原始execution/player/audit JSON。
整体18组验收仍未通过；本片不修复既有FAILED，不新增收费调用/听辨/Android或最终工程操作。
`;
fs.writeFileSync(`${base}/REPORT.md`, text, { flag: "wx" });
console.log(JSON.stringify({ sourceConclusion: raw.status, audit: audit.status, cells: raw.cells.length, checks, report: `${base}/REPORT.md` }));
