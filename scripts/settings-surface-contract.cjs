const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/shell.css"), "utf8");
const settings = fs.readFileSync(path.join(root, "GameCli_framework/src/components/shell/SettingsScreen.tsx"), "utf8");
const renpyCss = fs.readFileSync(path.join(root, "GameCli_framework/src/components/shell/renpy-menu.css"), "utf8");
for (const token of ["settings-renpy.has-settings-panel-background::before", "backdrop-filter: blur(14px)", "settings-tabs", "settings-content"]) {
  if (!css.includes(token)) throw new Error(`设置页层次样式缺少 ${token}`);
}
if (!settings.includes("--settings-category-envelope") || !renpyCss.includes("var(--settings-category-envelope"))
  throw new Error("有界设置面板必须在布局中为作者的分类按钮几何保留完整包络；实际宽角色已复现裁切。");
console.log("settings surface contract: PASS");
