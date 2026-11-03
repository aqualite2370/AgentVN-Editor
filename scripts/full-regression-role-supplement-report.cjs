"use strict";
// Immutable supplemental report. Do not convert evidence audits into product passes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = "D:/AgentVN", dest = `${root}/output/full-regression-stage-summary-20261019-11`;
assert(!fs.existsSync(dest), "Historical output must not be overwritten");
const sources = [];
function read(p) {
  sources.push({ path: p, sha256: sha(p), bytes: fs.statSync(p).size });
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}
const previous = read(`${root}/output/full-regression-stage-summary-20261019-10/evidence-receipt.json`);
assert.equal(previous.evidenceReceiptStatus, "PASS");
assert.equal(previous.groups.length, 18);
assert.deepEqual(previous.counts, { FAILED: 9, BLOCKED: 6, PASS: 3 });
for (const f of previous.sources) assert.equal(sha(f.path), f.sha256, `Old evidence changed: ${f.path}`);
const choiceBase = `${root}/output/installed-choice-role-states-20261019-01`;
const choice = read(`${choiceBase}/player.json`), choiceExec = read(`${choiceBase}/execution.json`);
const choiceAudit = read(`${choiceBase}/audit-01.json`);
assert.equal(choice.status, "PASS"); assert.equal(choice.cells.length, 12);
assert(choice.cells.every(c => c.executed && c.status === "PASS"));
assert.equal(choiceExec.status, "FAILED"); assert.equal(choiceAudit.status, "PASS");
const supplements = [];
for (const name of ["transient-role-states", "authored-transient-role-states"]) {
  const base = `${root}/output/installed-${name}-20261019-01`;
  const p = read(`${base}/player.json`), e = read(`${base}/execution.json`), audit = read(`${base}/audit-01.json`);
  const restore = read(`${base}/profile-restoration.json`);
  assert.equal(p.status, "PASS"); assert.equal(e.status, "PASS"); assert.equal(audit.status, "PASS");
  assert.equal(restore.status, "PASS"); assert.equal(p.cells.length, 12); assert.equal(p.launches.length, 12);
  assert(p.cells.every(c => c.executed && c.status === "PASS" && c.newWrites.length > 0));
  assert(p.launches.every(l => l.cleanup?.method === "REAL_UI_CONFIRMED_NATIVE_DESTROY"));
  assert.equal(p.screenshots.length, 12);
  const metric = audit.groups[0].detail;
  supplements.push({ name, source: p.source, playerReport: `${base}/player.json`, audit: `${base}/audit-01.json`,
    combinations: 12, nativeStarts: 12, confirmedNativeExits: 12, pngs: 12,
    actualSavedFiles: audit.groups[1].detail.genuineSavedFiles, metric,
    coverage: p.coverage, allSixRolesClaim: false });
}
const roleSupplement = supplements[1];
assert.equal(roleSupplement.coverage.authoredTitleDisabledColor, 12);
assert.equal(roleSupplement.coverage.authoredModalDisabledColor, 12);
const extra = [...previous.extraRequirements,
  { id: "CHOICE-NATURAL-SELECTED-DISABLED", status: "PASS",
    scope: "12 installed-library Player combinations natural rollback-selected; normal mode transient disabled. Original wrapper FAILED retained, later Restore/audit PASS; no persistent fixed-choice disable claim." },
  { id: "DEFAULT-THEME-TITLE-MODAL-PENDING", status: "PASS",
    scope: "12 genuine starts and UI confirmed native save/exits. Baseline theme only; not authored colors or independent EXE/setup/Android." },
  { id: "AUTHORED-TITLE-MODAL-DISABLED-COLOR", status: "PASS",
    scope: "12 installed-library combinations, unchanged all-role UI export: actual title disabled color before opaque blackout and actual modal disabled color during real save pending; not full geometry or all-six-role PASS." }];
const receipt = { status: "BLOCKED", evidenceReceiptStatus: "PASS", at: new Date().toISOString(),
  scope: "STAGE11_SUPPLEMENT_NOT_COMPLETE_ACCEPTANCE", groups: previous.groups, counts: previous.counts,
  extraRequirements: extra, previousReceipt: sources[0], retainedHistoricalSourcesChecked: previous.sources.length,
  sources, supplements, choice: { report: `${choiceBase}/player.json`, audit: `${choiceBase}/audit-01.json`,
    rawExecution: "FAILED", separateRecoveryAudit: "PASS", actualCombinations: 12 },
  blockers: previous.blockers, productChanges: 0, newBuilds: 0, modelRequests: 0, deviceOperations: 0,
  fullAcceptance: false, nextDecision: "Existing test-only scope does not authorize product fixes or paid model retries." };
fs.mkdirSync(dest);
fs.writeFileSync(`${dest}/evidence-receipt.json`, JSON.stringify(receipt, null, 2), { flag: "wx" });
const rows = previous.groups.map(g => `| ${g.id} | ${g.requirement} | ${g.status} | ${g.qualification} |`).join("\n");
const extras = extra.map(e => `- ${e.id}：${e.status}。${e.scope}`).join("\n");
const summary = `# AgentVN 完全回测阶段总报告 11

2026-10-19，Asia/Shanghai。**整体 BLOCKED，约定范围未完全回测通过。**
本报告补充分支自然选中态及标题/退出弹窗真实禁用态；不覆盖旧报告，不修产品，不增加收费重试。

## 18 个完整功能组

**3 PASS / 9 FAILED / 6 BLOCKED**，不是完成率。组内限定通过不代替整组，也不表示组内漏测已执行。

| ID | 完整要求 | 状态 | 已验证边界与缺口 |
| --- | --- | --- | --- |
${rows}

## 本次实际新增与更正

1. 分支按钮自然回滚选中态 12 组合及普通模式真实暂态禁用已完成。
   原 execution.json 因最初恢复时 WebView 未退出而 FAILED，原记录保持。
   随后 Restore 成功，独立六组来源/恢复审计 PASS；不是将原会话改成 PASS。
   该产品矩阵发生于前续接，本次只完成恢复审计和报告，没有重跑。
2. 默认主题卡带补测 12 次真实启动、12 次 UI 确认退出、12 份新自动存档；
   12 组合均采到标题/退出弹窗自然禁用。因为缺少作者角色覆盖，只算默认主题证据。
3. 独立使用既有全角色作者 UI 导出卡带，另测 12 次真实启动和确认退出。
   标题配置禁用色 #94b5c3 在黑场完全盖住前真实呈现；
   弹窗配置禁用色 #99bfc3 在实际保存 pending 时真实呈现，12 组合均通过。
   卡带未重写，没有加长保存请求或伪造 DOM 状态。
4. 两次新会话合计 24 次 Player 启动、24 次实际保存后原生退出、24 原生 PNG、
   24 份新存档。每次四原默认 profile/55 独立原哈希恢复，归属进程和端口无残留。
   PNG 拍于保存前，不冒称截图捕获禁用帧；暂态由带可信点击时间的逐帧观察证明。
5. 既有弹窗内容盒/4K导航严格几何 FAILED 不变，不能由本次颜色通过销项。
   标题/普通弹窗操作没有自然持久选中语义，页面导航暂态禁用仍未采样。
   不宣称六类按钮24态全部适用或全部通过。

主矩阵均为 1920×1080、2560×1440、3840×2160 × DPR1/2 × 普通/减少动效。
真实安装源 Player 卡带库模式，不是独立 EXE/setup/Android；真实 WebView 视口模拟，
不是物理4K屏幕。没有新增音频听辨，保留用户先前确认。

详细报告：

- D:\\AgentVN\\output\\installed-choice-role-states-20261019-01\\REPORT.md
- D:\\AgentVN\\output\\installed-transient-role-states-20261019-01\\REPORT.md
- D:\\AgentVN\\output\\installed-authored-transient-role-states-20261019-01\\REPORT.md

## 全部独立要求和未关闭范围

${extras}

“隐忍的成长”最终双平台流程仍 NOT_RUN：前置未通过，不提前用最终工程调试。
正常发布结果弹窗、目录选择、Android构建及签名升级、独立Windows包/升级/saves、
无开发目录环境和各FAILED依赖成功链，仍按总报告10保留 BLOCKED/NOT_RUN，不视为本轮已测。

## 仍需用户决定/外部条件

${previous.blockers.map(b => `- ${b.id}：${b.condition}`).join("\n")}
- 动画 JSON 消费格式/承诺仍需确认；空 frames 的默认动画出现不证明解析素材。
- 当前“只回测、不自动修产品”的授权仍有效。若要继续依赖失败项的完整成功链，需要进入
  明确的修复阶段；此决定不自动授权额外收费模型请求。
- Computer Use 原生通道沿用最后记录的具体阻断，本轮没有重复空探，更没有执行原生选择器流程。

## 实际命令和安全

\`\`\`powershell
node scripts/installed-choice-role-state-audit.cjs
node --check scripts/installed-transient-role-states.cjs
node --check scripts/installed-transient-role-state-session.cjs
node scripts/installed-transient-role-state-session.cjs
node --check scripts/installed-transient-role-state-audit.cjs
node scripts/installed-transient-role-state-audit.cjs
node --check scripts/installed-authored-transient-role-states.cjs
node --check scripts/installed-authored-transient-role-state-session.cjs
node scripts/installed-authored-transient-role-state-session.cjs
node --check scripts/installed-authored-transient-role-state-audit.cjs
node scripts/installed-authored-transient-role-state-audit.cjs
node scripts/full-regression-role-supplement-report.cjs
\`\`\`

以上命令退出0；另对QA PowerShell保护脚本两次语法解析，0错误。
新增六组/六组审计只是来源与恢复核验，不算新增12项产品功能。
本报告重核此前${previous.sources.length}份来源原哈希，未重跑这些套件。

- Editor SHA-256：f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c
- Player SHA-256：71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a
- Dev未重新编译，SHA-256：e2ca7c4b70ff485a047c881fc99503ed4628a701deece9c5c9bd650452952d84
- 运行目录：F:\\AgentVN\\QA\\AgentVN-QA-HostUpgrade-20261018-02\\installed-editor
- 新PNG、日志：F:\\AgentVN\\QA 下两本轮同名目录，未增加盘根散落目录。
- 版本/卡带/PNG/存档路径、生成时间、SHA及原始返回见本报告 evidence-receipt.json
  关联的 player.json、execution.json、audit-01.json。560产品来源保持，仅先前七项授权Editor差异。
- 未修改Editor/Runtime产品，未运行Dev编译、安装或Android操作，未追加模型调用。
  Android清理本片不适用，不据此宣称设备清理通过。

只在所有非延期完整要求取得规定证据后才能报告完全通过。唯一续接索引仍是 plans/ACTIVE_TASKS.md。
`;
fs.writeFileSync(`${dest}/REPORT.md`, summary, { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, evidenceReceiptStatus: "PASS", groups: 18,
  counts: receipt.counts, historicalSourcesChecked: previous.sources.length, newNativeStarts: 24, dest }));
