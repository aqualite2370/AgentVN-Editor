const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(ROOT, "editor", "src", "components", "advanced", "RuntimeLayoutDesigner.tsx"),
  "utf8",
);

const checks = [
  {
    name: "普通组件背景使用内联素材选择器",
    pass: /className="runtime-layout-component-background-image"[\s\S]*?variant="inline"/m.test(source),
  },
  {
    name: "自定义按钮背景使用内联素材选择器",
    pass: /helpKey="layout\.customButton\.image"[\s\S]*?variant="inline"/m.test(source),
  },
  {
    name: "设置页背景使用内联素材选择器",
    pass: /helpKey="settings\.runtimeVisual\.settingsPanel"[\s\S]*?variant="inline"/m.test(source),
  },
  {
    name: "组件锁定时背景素材选择器禁用",
    pass: (source.match(/disabled=\{selectedLocked\}/g) ?? []).length >= 2,
  },
  {
    name: "旧路径背景会反查素材 ID",
    pass: source.includes("assetIdForUILayoutImageReference") && source.includes("asset.metadata.filePath"),
  },
  {
    name: "布局背景不再使用普通下拉选项",
    pass: !source.includes("backgroundImageOptions") && !/helpKey="layout\.backgroundImage"[\s\S]{0,180}<RichSelect/m.test(source),
  },
];

for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"} ${check.name}`);
}

if (checks.some((check) => !check.pass)) process.exitCode = 1;
