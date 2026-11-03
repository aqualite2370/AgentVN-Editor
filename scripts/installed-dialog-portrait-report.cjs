"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict"), { sha } = require("./lib/installed-runtime-session.cjs");
const author = "D:/AgentVN/output/installed-dialog-portrait-20261019-02", base = "D:/AgentVN/output/installed-dialog-portrait-20261019-03";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const raw = read(`${base}/player-01.json`), audit = read(`${base}/audit-01.json`), editor = read(`${author}/editor-01.json`);
assert.equal(audit.status, "PASS"); assert.equal(audit.sourceConclusion, raw.status); assert.equal(raw.status, "FAILED");
assert.equal(raw.cells.length, 24); assert.equal(editor.status, "PASS"); assert(!fs.existsSync(`${base}/REPORT.md`));
for (const s of audit.sources) assert.equal(sha(s.path), s.sha256);
const text = `# 安装版专用对白头像消费回测

2026-10-19，Asia/Shanghai。**产品 FAILED：DIALOG-PORTRAIT-01。**
独立证据/恢复审计9组PASS不等于功能通过。

## 完整入口和结果

1. 隔离小工程的对白最初没有portrait，唯一头像使用先前实际UI原位替换得到的相同升级字节。
2. 实际安装Editor1.9.9：首页打开工程→真实场景→对白事件→“头像素材”选择器→选择升级头像。
3. 原生保存.vnproj、返回首页重开，绑定与图片字节保持。绑定仅发生在第一句，对照句未绑定。
4. 真实发布UI分别导出AgentVN与Ren’Py（进阶）两个卡带，脚本哈希相同；
   第一条dialog.portrait=qa_portrait，包内头像SHA均为
   6ee60904616cc7d555748f43fd6439969fb5e2ae466a04193e9f9c89d066fb59。
5. 实际安装源Player公开原生库导入并真实界面启动卡带。两布局各12组合，
   当前场景/command0/完整对白实际可见，但没有任何头像图片，也不存在CSS背景图、canvas或SVG图片替代渲染。
6. 真实推进到无头像的第二句作对照。未用通用show_image、编辑器缩略图或资源网络加载代证对白头像。

| 显示组合 | AgentVN | Ren’Py（进阶） |
| --- | --- | --- |
${[[1920,1080],[2560,1440],[3840,2160]].flatMap(([w,h]) => [1,2].flatMap(d => [false,true].map(m =>
  `| ${w}×${h} / DPR${d} / ${m ? "减少动效" : "普通"} | FAILED：头像缺失 | FAILED：头像缺失 |`))).join("\n")}

编辑/保存/重开/双布局UI导出5检查PASS；专用头像24显示组合FAILED。
本片不是重跑11种素材替换，也不是原生工程文件选择器、Windows独立setup或Android验收。
G16从整组BLOCKED更新为FAILED，同时保留原生入口与animation JSON边界等剩余缺口。

## QA失败原文保留

- 01会话：作者前三步PASS，卡带下载取证因混合Windows路径失败。
  保留原editor-01.json及旧runner。独立读取其WebView历史：received_bytes=0、interrupt_reason=1；
  02只将QA下载目录正规化后，两次实际UI下载成功。这不是头像产品PASS或FAIL。
- 02会话：作者完整5步PASS；Player首次尝试在短句等待处超时，0个头像断言执行。
  测试中的“未完成则点击”与自然完成存在推进竞态；保留原失败和旧runner，
  不将该超时归为头像产品缺陷。03改为等待短句自然完成，复用02两个实际卡带，
  没有重复编辑/模型/导出。随后24次专用断言真正执行并失败。

原01、02原始FAILED不改写；03源FAILED为已复现头像缺陷，不与QA同步失败混为一谈。

## 实际身份、证据和清理

冻结安装目录：
F:\\AgentVN\\QA\\AgentVN-QA-HostUpgrade-20261018-02\\installed-editor。
Editor SHA f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c。
Player SHA 71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a。
Dev未重编，保留e2ca7c4b70ff485a047c881fc99503ed4628a701deece9c5c9bd650452952d84。

原始：01/02/03各自execution、preparation、profile-restoration；
02/editor-01.json为作者证据，03/player-01.json为24实际观察，03/audit-01.json为独立终审。
大文件：F:\\AgentVN\\QA\\Dialog-Portrait-20261019-01、-02、-03。
检查点：F:\\AgentVN\\Checkpoints\\Dialog-Portrait-20261019-01（含两份失败runner快照）。
本片共${audit.groups.find(g => g.name.startsWith("Native screenshot")).detail.totalNativePngs}原生PNG，
其中玩家24张；截图前后实际参数及PNG=viewport×DPR已核。
这些是实际WebView的视口模拟，不是物理4K显示器；截图只是行为/DOM/包字节的辅助证据。

三会话均finally恢复四原默认profile，55文件SHA核独立备份；归属进程/端口无残留。
560产品文件只保留先前7项已授权Editor变更，没有本片产品修复、重编、收费模型或Android操作。
两份本轮Downloads工程包核F盘独立副本与原字节后精确删除，可从F盘恢复；
源卡带和其余历史资料未删。“隐忍的成长”未使用。

## 实际命令

\`\`\`powershell
node scripts/installed-dialog-portrait-oracle-test.cjs
node scripts/installed-dialog-portrait-session.cjs
node scripts/installed-dialog-portrait-session.cjs 02
node scripts/installed-dialog-portrait-session.cjs 03 --player-only
node scripts/installed-dialog-portrait-audit.cjs
node scripts/installed-dialog-portrait-report.cjs
\`\`\`

oracle11工具用例PASS，不是11个产品测试。01退出1（QA下载），02退出1（QA同步）；
03退出1（24产品缺陷）；独立audit退出0/9组PASS，仅代表证据和恢复可信。
另外执行六个新增JS语法检查及两PS解析PASS，不替代上述行为。
本片按只回测权限记录缺陷，未自动修复；整体不得报告完成。
`;
fs.writeFileSync(`${base}/REPORT.md`, text, { flag: "wx" });
console.log(JSON.stringify({ sourceConclusion: raw.status, audited: audit.status, productCells: raw.cells.length, report: `${base}/REPORT.md` }));
