"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = "D:/AgentVN", dest = `${root}/output/full-regression-stage-summary-20261019-12`;
assert(!fs.existsSync(dest)); const sources = [];
function read(p) {
  sources.push({ path: p, sha256: sha(p), bytes: fs.statSync(p).size });
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}
const prior = read(`${root}/output/full-regression-stage-summary-20261019-11/evidence-receipt.json`);
assert.equal(prior.evidenceReceiptStatus, "PASS"); assert.equal(prior.groups.length, 18);
for (const s of prior.sources) assert.equal(sha(s.path), s.sha256);
const base = `${root}/output/installed-navigation-role-states-20261019-01`;
const player = read(`${base}/player.json`), execution = read(`${base}/execution.json`), audit = read(`${base}/audit-01.json`);
const restore = read(`${base}/profile-restoration.json`);
for (const r of [player, execution, audit, restore]) assert.equal(r.status, "PASS");
assert.equal(player.cells.length, 12); assert(player.cells.every(c => c.executed && c.status === "PASS"));
assert.equal(player.launches.length, 1); assert.equal(player.screenshots.length, 12);
const roleBase = `${root}/output/installed-layout-author-review-20261019-01`;
const earlier = read(`${roleBase}/role-states-04/report.json`);
const ordinary = read(`${roleBase}/ordinary-consume-03/report.json`);
const choice = read(`${root}/output/installed-choice-role-states-20261019-01/player.json`);
const authored = read(`${root}/output/installed-authored-transient-role-states-20261019-01/player.json`);
assert.equal(earlier.status, "FAILED"); assert.equal(earlier.matrix.length, 12);
assert(earlier.matrix.every(c => c.executed && c.samples.length === 17));
assert.equal(ordinary.status, "PASS"); assert.equal(ordinary.playerMatrix.length, 12);
assert(ordinary.playerMatrix.every(c => c.status === "PASS"
  && ["normal","hover","selected","disabled"].every(s => c.states[s])));
assert.equal(choice.status, "PASS"); assert.equal(choice.cells.length, 12);
assert.equal(authored.status, "PASS"); assert.equal(authored.cells.length, 12);
const coverage = [
  { role: "标题操作", states: "普通、悬停；真实启动禁用色", unsupported: "无自然持久选中状态",
    geometry: "仅对应已测控件；不代证任意用户配置", evidence: ["role-states-04", "installed-authored-transient-role-states"] },
  { role: "页面导航", states: "普通、悬停、选中、键盘焦点；本轮补真实返回禁用色", unsupported: "无新增强制状态",
    geometry: "4K严格文字Range边界FAILED保持", evidence: ["role-states-04", "installed-navigation-role-states"] },
  { role: "分类／分页", states: "普通、悬停、选中、禁用；真实翻页与分类", unsupported: "不代证所有偏好功能",
    geometry: "限定原样本", evidence: ["role-states-04"] },
  { role: "剧情选项", states: "普通、悬停、回滚自然选中；普通动效的真实暂态禁用", unsupported: "减少动效路径未采到相同暂态，不伪造固定禁用选项",
    geometry: "选中与普通矩形及文本边界限定PASS", evidence: ["ordinary-consume-03", "installed-choice-role-states"] },
  { role: "快捷栏", states: "普通、悬停、自动选中、无历史可回退时禁用", unsupported: "颜色不代证八项完整业务",
    geometry: "限定普通对白样本；NVL重叠FAILED独立保持", evidence: ["ordinary-consume-03"] },
  { role: "弹窗操作", states: "普通、悬停、键盘焦点；真实保存pending禁用色", unsupported: "普通确认动作无持久选中语义",
    geometry: "内容盒严格溢出FAILED保持，不夸大为已证字形裁切", evidence: ["role-states-04", "installed-authored-transient-role-states"] },
];
const receipt = { status: "BLOCKED", evidenceReceiptStatus: "PASS", at: new Date().toISOString(),
  scope: "STAGE12_NAVIGATION_COLOR_AND_NATURAL_ROLE_STATE_MAP_NOT_COMPLETE_ACCEPTANCE",
  groups: prior.groups, counts: prior.counts, extraRequirements: prior.extraRequirements,
  newRequirement: { id: "AUTHORED-NAVIGATION-DISABLED-COLOR", status: "PASS",
    scope: "12 actual installed-library combinations, natural settings return to playing, authored disabled color before opaque cover; previous strict geometry failure retained." },
  sources, previousSourcesHashChecked: prior.sources.length, roleCoverage: coverage,
  navigationMetrics: audit.groups[0].detail, allRoleGeometryPass: false, all24StatesApplicableClaim: false,
  blockers: prior.blockers, productChanges: 0, newBuilds: 0, modelRequests: 0, fullAcceptance: false };
fs.mkdirSync(dest);
fs.writeFileSync(`${dest}/evidence-receipt.json`, JSON.stringify(receipt, null, 2), { flag: "wx" });
const rows = coverage.map(r => `| ${r.role} | ${r.states} | ${r.unsupported} | ${r.geometry} |`).join("\n");
const groups = prior.groups.map(g => `| ${g.id} | ${g.requirement} | ${g.status} | ${g.qualification} |`).join("\n");
fs.writeFileSync(`${dest}/REPORT.md`, `# AgentVN 完全回测阶段总报告 12

2026-10-19，Asia/Shanghai。**整体BLOCKED，未完成约定范围完全回测。**
18完整组仍为3 PASS／9 FAILED／6 BLOCKED。没有产品修复、新编译或收费模型重试。

## 本轮新增：导航真实禁用态

报告11仍列“导航禁用未采样”。只读核查发现从剧情打开设置、真实点击返回时，
closeMenu会进入resumeActiveGame，存在自然禁用窗口，因此没有将其误归为外部阻断。
同一冻结安装源Player、同一全角色作者UI导出卡带、一次Player启动，执行12显示组合：
1920×1080／2560×1440／3840×2160 × DPR1/2 × 普通/减少动效。

12组合均采到真实点击后的返回按钮disabled/state=disabled，
作者色#95b7c3在黑场完全覆盖之前实际呈现；${audit.groups[0].detail.exactReturnButtonColorSamples}个精确颜色样本，
${audit.groups[0].detail.frames}个逐帧记录。按钮矩形与切换前差异≤0.2 CSS px，控件没有离开视口。
12原生PNG参数/尺寸/哈希核验；PNG拍于返回前，不冒称拍到禁用态。
最终均恢复到同场景command0，未添加新剧情、未伪造DOM/store或延长IPC。

四默认profile及55原始独立SHA已恢复，所属PID/端口无残留。
末尾为精确归属停止，不宣称又完成一次正常原生退出测试。
独立4组审计PASS仅核来源/恢复；既有严格几何FAILED仍保持。
详细报告：D:\\AgentVN\\output\\installed-navigation-role-states-20261019-01\\REPORT.md。

## 六类按钮：真实可达状态与限制

| 角色 | 实际证据 | 不得扩大的语义 | 几何结论 |
| --- | --- | --- | --- |
${rows}

以上是自然状态分布，不声称六类×四态全部适用，也不把不存在的持久选中状态强造出来。
原role-states-04严格FAILED及旧报告保持，颜色分项通过不等于整体按钮布局通过。
Player卡带库证据不代证独立Windows EXE/setup/Android；WebView模拟视口不称物理4K屏幕。

## 全部18组当前结论

| ID | 完整要求 | 状态 | 已验证范围及缺口 |
| --- | --- | --- | --- |
${groups}

报告11所有独立缺陷、快存/语音限定证据、两项用户延期、动画JSON契约、
分工程目录及长错误结果弹窗阻断继续保持，见关联evidence-receipt.json及报告11。
本轮只更正其“导航禁用未采样”叶项，不通过改写原文消除历史缺口。
最终“隐忍的成长”仍NOT_RUN，全部前置未通过，不提前用于调试。

## 实际命令及安全

\`\`\`powershell
node --check scripts/installed-navigation-role-states.cjs
node --check scripts/installed-navigation-role-state-session.cjs
node scripts/installed-navigation-role-state-session.cjs
node --check scripts/installed-navigation-role-state-audit.cjs
node scripts/installed-navigation-role-state-audit.cjs
node scripts/full-regression-role-coverage-report.cjs
\`\`\`

全部退出0；另对QA PowerShell保护脚本语法解析0错误。
本次源核对不是重跑旧套件；前一报告${prior.sources.length}份来源哈希保持。
产品560来源仅先前七授权Editor差异，冻结Editor/Player/Dev不变。
Dev未重编译；D:\\AgentVN\\AgentVN Dev.exe仍是既有产物，不作为本轮新交付。
卡带/PNG/EXE路径、SHA与时间见原始player.json、execution.json、audit-01.json。
大文件和检查点统一在F:\\AgentVN的QA／Checkpoints同名目录，没有新增盘根散放。
没有新增模型请求、Android操作或音频听辨；用户先前音频结论保留。

## 继续完整成功链所需条件

${prior.blockers.map(b => `- ${b.id}：${b.condition}`).join("\n")}

另外需确认遗留动画JSON的支持格式/消费承诺。当前“测试为主，不自动修产品”边界仍有效，
不能把自动续接当作产品修复或额外收费授权。尚未满足前不得宣布整体完成。
`, { flag: "wx" });
console.log(JSON.stringify({ status: "BLOCKED", evidenceReceiptStatus: "PASS", counts: prior.counts,
  newNavigationCombinations: 12, naturalRoleRows: coverage.length, dest }));
