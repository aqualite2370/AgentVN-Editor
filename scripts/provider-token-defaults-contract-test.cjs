const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");
const ts = require("../editor/node_modules/typescript");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function compileTs(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const testModule = new Module(filename, module);
  testModule.filename = filename;
  testModule.paths = Module._nodeModulePaths(path.dirname(filename));
  testModule._compile(compiled, filename);
  return testModule.exports;
}

const { estimateTextTokens, tokensToApproxChars } = compileTs("editor/src/utils/contextBudget.ts");
assert.equal(estimateTextTokens("汉".repeat(700)), 1000, "700 Chinese characters should estimate to 1000 tokens");
assert.equal(tokensToApproxChars(1000), 700, "1000 tokens should map back to about 700 Chinese characters");

const providerDefaults = compileTs("editor/src/providers/providerDefaults.ts");
assert.deepEqual(providerDefaults.createDefaultModelParameters("deepseek-v4-flash"), {
  temperature: 0.2,
  top_p: 0.9,
  max_tokens: 4096,
  structured_mode: "tools",
  request_timeout_seconds: 300,
  context_budget_tokens: 24000,
  thinking_mode: false,
});
assert.deepEqual(providerDefaults.createDefaultModelParameters("deepseek-v4-pro"), {
  temperature: 0.2,
  top_p: 0.9,
  max_tokens: 8192,
  structured_mode: "tools",
  request_timeout_seconds: 300,
  context_budget_tokens: 48000,
  thinking_mode: false,
});
assert.deepEqual(providerDefaults.createDefaultModelParameters("custom-reasoner"), {
  temperature: 0.2,
  top_p: 0.9,
  max_tokens: 8192,
  structured_mode: "auto",
  request_timeout_seconds: 600,
  context_budget_tokens: 48000,
  thinking_mode: true,
});
assert.deepEqual(providerDefaults.createDefaultModelParameters("other-chat-model"), {
  temperature: 0.4,
  top_p: 1,
  max_tokens: 4096,
  structured_mode: "auto",
  request_timeout_seconds: 300,
  context_budget_tokens: 24000,
  thinking_mode: false,
});
assert.equal(providerDefaults.getModelParameterProfile("deepseek-v4-flash").id, "deepseek-v4-flash");
assert.equal(providerDefaults.getModelParameterProfile("deepseek-v4-pro").id, "deepseek-v4-pro");
assert.equal(providerDefaults.getModelParameterProfile("some-thinking-model").id, "reasoning");
assert.equal(providerDefaults.getModelParameterProfile("unknown-model").id, "generic-text");
assert.equal(providerDefaults.getModelParameterProfile("gpt-5.4").id, "openai");
assert.equal(providerDefaults.getModelParameterProfile("claude-sonnet-4").id, "anthropic");
assert.equal(providerDefaults.getModelParameterProfile("gemini-2.5-flash").id, "gemini");
assert.equal(providerDefaults.getModelParameterProfile("qwen-plus").id, "qwen");
assert.equal(providerDefaults.getModelParameterProfile("kimi-k3").id, "kimi");
assert.equal(providerDefaults.getModelParameterProfile("glm-5").id, "glm");
for (const modelName of [
  "deepseek-v4-flash",
  "gpt-5.4",
  "claude-sonnet-4",
  "gemini-2.5-flash",
  "qwen-plus",
  "kimi-k3",
  "glm-5",
]) {
  const profile = providerDefaults.getModelParameterProfile(modelName);
  assert.match(profile.source_url, /^https:\/\//, `${modelName} profile should retain its official documentation source`);
  assert.ok(profile.basis_label, `${modelName} profile should explain whether values are official or compatibility defaults`);
}

const providerPanel = read("editor/src/components/advanced/ProviderSettingsPanel.tsx");
const providerRegistry = read("editor/src/providers/providerRegistry.ts");
assert.match(
  providerPanel,
  /getModelParameterProfile\([^)]*\)\.label/,
  "the context-token field should show the model profile selected by the built-in rules",
);
assert.match(
  providerPanel,
  /createDefaultModelParameters\(/,
  "newly discovered and manually added models should use the shared model-profile rules",
);
assert.match(
  providerPanel,
  /matched\?\.default_parameters \?\? createDefaultModelParameters\(discovered\.model_id\)/,
  "model discovery should preserve saved parameters and only profile newly discovered models",
);
assert.match(
  providerPanel,
  /应用推荐预设/,
  "saved models should expose an explicit action for applying the currently matched profile",
);
assert.match(
  providerRegistry,
  /function defaultParameters\(\)[\s\S]*?return createDefaultModelParameters\(\);/,
  "the provider registry should use the shared DeepSeek V4 Flash baseline",
);
assert.doesNotMatch(
  providerRegistry,
  /applyModelParameterProfile/,
  "loading a saved model must not overwrite user-customized parameters with a model profile",
);

for (const relativePath of [
  "editor/src/novel-import/novelProcessing.ts",
  "editor/src/novel-import/chapterSplitter.ts",
  "editor/src/novel-import/chapterQuickSplitter.ts",
  "editor/src/novel-import/novelProcessJobAdapter.ts",
]) {
  const source = read(relativePath);
  assert.match(
    source,
    /estimateTextTokens|estimateTokensFromCjkCharCount/,
    `${relativePath} should use the shared token estimate`,
  );
  assert.doesNotMatch(
    source,
    /charCount\s*\/\s*1\.6|charCount\s*\*\s*0\.72|nonAsciiCount\s*\*\s*0\.72|\/\s*1\.5/,
    `${relativePath} should not keep a legacy token ratio`,
  );
}

console.log("provider-token-defaults-contract-test: ok");
