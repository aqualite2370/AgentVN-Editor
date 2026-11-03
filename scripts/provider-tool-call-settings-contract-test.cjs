const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const panel = fs.readFileSync(
  path.join(root, "editor/src/components/advanced/ProviderSettingsPanel.tsx"),
  "utf8",
);
const types = fs.readFileSync(path.join(root, "editor/src/providers/types.ts"), "utf8");
const registry = fs.readFileSync(path.join(root, "editor/src/providers/providerRegistry.ts"), "utf8");
const defaults = fs.readFileSync(path.join(root, "editor/src/providers/providerDefaults.ts"), "utf8");

// UI terminology was simplified independently of the provider protocol.
// Preserve all three modes, compatibility states and explicit consent.
for (const text of [
  "推荐模式",
  "自动兼容",
  "基础兼容",
  "尚未检查",
  "兼容性已通过",
  "兼容性检查失败",
  "配置已变更，需重新检查",
  "尚未验证当前模型能否稳定完成剧情生成。",
  "应用测试建议",
]) {
  assert(panel.includes(text), `模型设置页缺少 Tool Call 标注：${text}`);
}
const modeOptions = panel.slice(panel.indexOf("const providerStructuredModeOptions ="), panel.indexOf("];", panel.indexOf("const providerStructuredModeOptions =")));
for (const mode of ["tools", "auto", "json_object"])
  assert(modeOptions.includes(`value: "${mode}"`), `结构化模式 ${mode} 必须仍有真实选择入口`);
assert(panel.includes("options={providerStructuredModeOptions}"), "真实控件必须消费三种结构化模式");

assert(panel.includes("window.confirm("), "点击模型检查前必须显示适配测试确认提示");
assert(!panel.includes("已自动保存推荐模式"), "适配测试不得静默修改结构化模式");
assert(types.includes("structured_compatibility?: StructuredCompatibilityStatus"), "模型类型必须持久化适配状态");
assert(registry.includes("structured_compatibility:"), "模型注册表必须保留适配状态");
assert.equal((defaults.match(/structured_mode: "tools"/g) || []).length >= 2, true, "DeepSeek V4 Flash/Pro 必须默认 tools");

console.log("provider-tool-call-settings-contract-test: ok");
