"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `export { parseRenpyGUIParameters, renpyGUIErrors } from './shared/cartridge/renpyGui';`,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(
  loaded,
  loaded.exports,
  requireEditor,
);

const source = `
# 文字列和注释中的内容不能被当作赋值执行
define gui.template_version = "8.5.3.26051504"
define gui.interface_text_size = 24
define gui.navigation_font_size = gui.interface_text_size + 2
define gui.navigation_xpos = 52
define gui.navigation_spacing = gui.interface_text_size / 4
define gui.file_slot_cols = 4
define gui.slot_spacing = 18
define gui.button_borders = Borders(6, 8, 10, 12)
define gui.button_tile = True
define gui.idle_color = "#bbbbbb"
define gui.hover_color = "#ffffff"
define gui.button_text_idle_color = gui.idle_color
define gui.button_text_hover_color = gui.hover_color
define gui.button_text_selected_color = "#00ccdd"
define gui.button_text_insensitive_color = "#777777"
"""
define gui.navigation_xpos = 999
"""
define gui.navigation_spacing = dangerous_function()
define gui.unknown_setting = 9
`;
const result = loaded.exports.parseRenpyGUIParameters(source);

assert.deepEqual(result.values, {
  shared: {
    fontSize: 26, x: 52, spacing: 6,
    buttonBorders: { left: 6, top: 8, right: 10, bottom: 12 },
    buttonTile: true,
    buttonTextColors: {
      normal: "#bbbbbb", hover: "#ffffff", selected: "#00ccdd", disabled: "#777777",
    },
  },
  save_load: { saveColumns: 4, saveGap: 18 },
}, "白名单数值与按钮四态颜色可安全映射，但注释和多行字符串中的伪赋值不能影响结果");
assert(result.issues.some((issue) => issue.code === "unsupported_expression"
  && issue.parameter === "gui.navigation_spacing"),
"任意 Python 表达式必须报告为不支持，绝不能执行");
assert(result.issues.some((issue) => issue.code === "unsupported_parameter"
  && issue.parameter === "gui.unknown_setting"),
"未映射的 GUI 参数必须显式列为未导入");
assert.equal(result.complete, false, "存在不支持项时不得报告完整导入");
const malformedBorders = loaded.exports.parseRenpyGUIParameters(
  "define gui.button_borders = Borders(1, 2, 3)",
);
assert.equal(malformedBorders.values.shared, undefined,
  "边界参数必须恰好包含 left/top/right/bottom 四个数值");
assert(malformedBorders.issues.some((issue) => issue.code === "unsupported_expression"
  && issue.parameter === "gui.button_borders"),
"格式错误或不安全的 Borders 表达式必须列为未支持内容");
const executableBorders = loaded.exports.parseRenpyGUIParameters(
  "define gui.button_borders = Borders(1, 2, 3, __import__('os').system('unsafe'))",
);
assert.equal(executableBorders.values.shared, undefined,
  "Borders 导入绝不能执行 Python 表达式");
assert.deepEqual(executableBorders.issues.map((issue) => issue.code), ["unsupported_expression"]);

const malicious = loaded.exports.parseRenpyGUIParameters(
  "define gui.navigation_xpos = __import__('os').system('echo unsafe')",
);
assert.deepEqual(malicious.values, {});
assert.equal(malicious.issues[0]?.code, "unsupported_expression");
assert.deepEqual(loaded.exports.renpyGUIErrors({
  shared: { buttonImages: {
    normal: "asset:gui_button_normal",
    hover: "asset:gui_button_hover",
    selected: "asset:gui_button_selected",
    disabled: "asset:gui_button_disabled",
  } },
}), [], "Ren’Py 按钮状态图片只能接受四种卡带素材引用");
assert.deepEqual(loaded.exports.renpyGUIErrors({
  shared: { buttonImages: { hover: "asset:renpy_gui_悬停按钮_1234abcd" } },
}), [], "合法的中文 GUI 路径素材 ID 必须能作为卡带内按钮状态引用");
assert.deepEqual(loaded.exports.renpyGUIErrors({
  shared: { buttonTextColors: {
    normal: "#bbbbbb", hover: "rgba(255, 255, 255, .8)", selected: "#00ccdd", disabled: "#777777",
  } },
}), [], "Ren’Py 按钮文字状态色必须接受安全的静态 CSS 颜色");
assert(loaded.exports.renpyGUIErrors({
  shared: { buttonTextColors: { hover: "url(javascript:alert(1))" } },
}).length > 0, "按钮颜色导入必须拒绝可执行或不安全 CSS 表达式");
assert.deepEqual(loaded.exports.renpyGUIErrors({
  shared: {
    buttonBorders: { left: 6, top: 8, right: 10, bottom: 12 },
    buttonTile: true,
  },
}), [], "共享按钮边缘必须接受有界静态四边值和平铺布尔值");
assert(loaded.exports.renpyGUIErrors({
  shared: { buttonBorders: { left: -1, top: 8, right: 10, bottom: 12 } },
}).length > 0, "共享按钮边界不得接受负切片值");
assert(loaded.exports.renpyGUIErrors({
  shared: { buttonBorders: { left: 6, top: 8, right: 10, bottom: 12, center: 1 } },
}).length > 0, "共享按钮边界不得接受未声明的额外字段");
assert(loaded.exports.renpyGUIErrors({
  shared: { buttonImages: { hovered: "asset:../outside" } },
}).length > 0, "未知状态和越界素材引用必须被布局校验拒绝");
assert(loaded.exports.renpyGUIErrors({
  title: { buttonImages: { hover: "asset:title_hover" } },
}).some((path) => path === "renpy.title.buttonImages"),
"仅共享按钮状态资源已接入 Runtime；页面级状态覆盖必须拒绝而非静默忽略");
console.log("PASS Ren’Py GUI static whitelist contract");
