const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectSettings = fs.readFileSync(
  path.join(root, "editor/src/components/advanced/ProjectSettingsPanel.tsx"),
  "utf8",
);
const layoutDesigner = fs.readFileSync(
  path.join(root, "editor/src/components/advanced/RuntimeLayoutDesigner.tsx"),
  "utf8",
);
const aboutScreen = fs.readFileSync(
  path.join(root, "GameCli_framework/src/components/shell/AboutScreen.tsx"),
  "utf8",
);

for (const [name, source] of [
  ["项目设置", projectSettings],
  ["运行时布局设计器", layoutDesigner],
]) {
  if (!source.includes('aboutFields.length === 0 && <p className="runtime-about-fields-empty">暂无字段</p>')) {
    throw new Error(`${name}缺少字段列表空状态。`);
  }
}

if (!aboutScreen.includes("暂无字段，请前往编辑器设置文本。")) {
  throw new Error("GameCLI 关于页缺少编辑器设置引导。 ");
}
if (aboutScreen.includes("fallbackFields")) {
  throw new Error("GameCLI 关于页仍会填充默认字段。 ");
}

console.log("about fields empty-state contract: PASS");
