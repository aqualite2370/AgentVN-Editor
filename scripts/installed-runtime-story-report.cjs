"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const attempt = process.argv[2] || "03", audit = process.argv[3] || "01";
assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const source = path.join(base, `installed-story-1922-${attempt}`);
const r = read(path.join(source, "session.json"));
const aFile = `${source}-audit-${audit}/report.json`, a = read(aFile);
assert.equal(a.status, "PASS"); assert.equal(a.businessStatus, r.status);
assert.equal(a.source.sha256, sha(path.join(source, "session.json")));
assert.equal(r.status, "PASS"); assert.equal(r.cells.length, 12);
const flows = r.cells.map(c => read(c.report.path));
const cross = read(r.crossLayout.path), all = [...flows, cross];
const failed = ["01", "02"].map(n => {
  const p = path.join(base, `installed-story-1922-${n}`, "session.json");
  const value = read(p); assert.equal(value.status, "FAILED");
  return { attempt: n, path: p, sha256: sha(p), error: value.error };
});
const metrics = {
  cells: r.cells.length, layoutCases: flows.flatMap(f => f.matrix).length,
  businessChecks: all.reduce((n, f) => n + f.checks.length, 0),
  screenshots: all.reduce((n, f) => n + f.screenshots.length, 0),
  saveSnapshots: all.reduce((n, f) => n + f.nativeSaves.length, 0),
  crossLayoutFiles: cross.checks[0].detail.files.length,
  processes: r.knownProcesses.length, ports: r.absentPorts.length,
  inheritedCells: r.reusedCells?.count || 0, freshCells: r.cells.filter(c => !c.reusedFrom).length,
};
const output = path.join(base, `STORY-1922-20261023-${attempt}.md`);
assert(!fs.existsSync(output));
const lines = [
  "# 当前安装版剧情能力限定验收（2026-10-23）", "",
  "业务状态：PASS（限定范围）。独立证据审计：PASS。全项目完全回测仍未通过。", "",
  "## 真实产物与执行边界", "",
  `- Editor安装版本1.9.22，实际安装根：\`${path.dirname(r.executable.path)}\`。`,
  "- 随包Player的PE版本为1.9.1；安装版本与Player版本分别记录，不声称新Player发行。",
  `- 实际Player SHA-256：\`${r.executable.sha256}\`。`,
  `- 当前安装Editor真实界面导出来源：\`${r.originalExport.path}\`（SHA-256 \`${r.originalExport.sha256}\`）。`,
  "- 工程从已核旧临时夹具复制，经本轮安装后端公开API导入；不代证原生文件选择器。",
  "- AgentVN沿用46已完成实际下载，47仅新导出Ren’Py；两卡带剧情script字节一致，立绘字节逐一核对。",
  "- Player使用卡带库模式，公开原生命令只准备库；其后使用真实WebView点击/键盘推进、保存与读取。",
  "- 分辨率为真实WebView的视口模拟，非物理4K显示器验收。",
  "- 本机Codex显式物理临时Roaming；原目录先保留、finally恢复，Local为Junction隔离；不代证普通用户无隔离默认路径。",
  "- 归属终止收尾，未声称正常原生关窗；产品改动0、构建0、模型请求0。", "",
  "## 结果", "",
  `- 1080p/1440p/4K × DPR1/2 × 普通/减少动效：${metrics.cells}组合、两布局${metrics.layoutCases}显示案例。`,
  `- ${metrics.businessChecks}项完整业务检查通过；${metrics.screenshots}张原始PNG核实前后视口/DPR/media、尺寸和SHA。`,
  `- ${metrics.inheritedCells}组合严格引用02原始业务证据，${metrics.freshCells}组合03新执行；未重跑已完成组合，未抹除02总控失败。`,
  "- 普通模式显式覆盖角色气泡；角色NVL、旁白工程默认、节点NVL覆盖均通过。",
  "- 长文缩至可读下限后分页；逐页拼接与输入逐字一致，各页无横/纵溢出。",
  "- NVL累积一次、清页、分支离开、手动存读档及新检查点回退/前滚恢复通过。",
  "- 气泡跟随角色与镜头、离场fallback、固定边缘及长文分页、存读档通过。",
  "- Ren’Py九项单行可命中；七次真实快存只保留最近六条、不改手存，快读确认/取消及分页槽ID通过。",
  `- ${metrics.saveSnapshots}份原生存档快照及跨进程${metrics.crossLayoutFiles}文件字节已核；新进程AgentVN能读取Ren’Py快存及气泡手存。`,
  `- ${metrics.processes}记录归属进程及${metrics.ports}端口已不存在；两原目录身份与原Roaming九文件哈希恢复。`, "",
  "## 原失败保持", "",
  `- 01：Junction目录内保存finalize/os error3，两布局复现；报告 \`${failed[0].path}\`，SHA \`${failed[0].sha256}\`。`,
  "- 该失败尚未分段定因，物理目录通过不代表Junction问题已修复。",
  `- 02：七组业务PASS，总控退出采样path.resolve(null)失败；报告 \`${failed[1].path}\`，SHA \`${failed[1].sha256}\`。`,
  "- 03仅修QA采样：同创建身份且已验证路径的进程退出瞬间缺路径可记录；首次未知路径和错误路径仍拒绝。", "",
  "## 实际命令", "", "```powershell",
  "node scripts/installed-runtime-story-export-1922.cjs 47 --resume-agentvn=46",
  "node scripts/installed-runtime-story-1922.cjs 01 47",
  "node scripts/native-runtime-story-profile-test.cjs",
  "node scripts/installed-runtime-story-1922.cjs 02 47 --physical-roaming",
  "node scripts/runtime-story-observer-test.cjs",
  `node scripts/installed-runtime-story-1922.cjs ${attempt} 47 --physical-roaming --resume-cells=02`,
  `node scripts/installed-runtime-story-audit-test.cjs ${source}/session.json`,
  `node scripts/installed-runtime-story-audit.cjs ${attempt} ${audit}`,
  "node scripts/native-runtime-state-audit-test.cjs",
  "node scripts/native-runtime-quick-audit-test.cjs", "```", "",
  "## 未由本片验收", "",
  "- NVL满页/长条/分支空间、分页语音去重、快存损坏最新/拒写/并发和其它快捷栏全部业务。",
  "- standalone/setup、Android、旧游戏覆盖升级、原生库导入选择器与正常关闭。",
  "- Editor同尺寸时长单位、Android退出pending、工程包拒写提示等既有FAILED继续开放。",
  "- 最终工程留至全部前置收口；音频沿用用户既有确认，本轮无新人工听辨。",
  "- 本轮仅QA与文档；未运行Dev构建，根Dev仍为检查点既有产物。", "",
  "## 原始证据", "",
  `- session：\`${path.join(source, "session.json")}\`，SHA \`${sha(path.join(source, "session.json"))}\`。`,
  `- audit：\`${aFile}\`，SHA \`${sha(aFile)}\`。`,
  `- 各组合截图与保存快照详见session.cells内report及artifacts路径。`, "",
];
fs.writeFileSync(output, lines.join("\n"), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", output, sha256: sha(output), metrics }));
