const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require(path.join(__dirname, "..", "editor", "node_modules", "esbuild"));

const root = path.resolve(__dirname, "..");
const mapperEntry = path.join(root, "editor", "src", "packaging", "packageBuildResultDialog.ts");

async function loadMapper() {
  const build = await esbuild.build({
    entryPoints: [mapperEntry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    write: false,
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", build.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

function buildResult(status, overrides = {}) {
  return {
    ok: status === "PASS",
    status,
    message: status === "PASS" ? "构建完成。" : status === "BLOCKED" ? "缺少构建环境。" : "编译失败。",
    artifacts: status === "PASS" ? [{ kind: "exe", path: "D:\\release\\game.exe" }] : [],
    warnings: status === "PASS" ? ["保留了一项警告"] : [],
    verifyReportPath: "",
    buildLogPath: status === "PASS" ? "" : "D:\\cache\\build.log",
    manifestPath: "",
    diagnosticsDir: status === "PASS" ? "" : "D:\\cache\\diagnostics",
    diagnosticsArchivePath: "",
    failureCode: status === "PASS" ? undefined : "BUILD_FAILED",
    ...overrides,
  };
}

async function main() {
  const mapper = await loadMapper();
  const pass = mapper.createPackageBuildResultDialogModel({
    result: buildResult("PASS"),
    targetPlatform: "windows",
    outputDir: "D:\\release",
  });
  assert.equal(pass.tone, "success");
  assert.equal(pass.title, "Windows 软件构建成功");
  assert.deepEqual(pass.action, { kind: "output", label: "打开输出目录", path: "D:\\release" });
  assert.ok(pass.details.some((item) => item.label === "生成产物" && item.value === "1 项"));
  assert.ok(pass.details.some((item) => item.label === "构建警告" && item.value === "1 条"));

  const blocked = mapper.createPackageBuildResultDialogModel({
    result: buildResult("BLOCKED"),
    targetPlatform: "android",
    outputDir: "D:\\release",
  });
  assert.equal(blocked.tone, "warning");
  assert.equal(blocked.title, "Android 软件构建被阻断");
  assert.equal(blocked.action.kind, "diagnostics");

  const fail = mapper.createPackageBuildResultDialogModel({
    result: buildResult("FAIL", { diagnosticsDir: "" }),
    targetPlatform: "windows",
    outputDir: "D:\\release",
  });
  assert.equal(fail.tone, "error");
  assert.equal(fail.action, undefined);
  assert.ok(fail.details.some((item) => item.label === "失败代码"));

  const exception = mapper.createPackageBuildExceptionDialogModel("android", new Error("upload failed"));
  assert.equal(exception.tone, "error");
  assert.equal(exception.message, "upload failed");

  const blockedRepair = mapper.createPackageBuildBlockedDialogModel("windows", "环境修复失败");
  assert.equal(blockedRepair.tone, "warning");
  assert.equal(blockedRepair.action, undefined);

  const panel = fs.readFileSync(path.join(root, "editor", "src", "cartridge", "ExportCartridgePanel.tsx"), "utf8");
  const dialog = fs.readFileSync(path.join(root, "editor", "src", "components", "common", "OperationResultDialog.tsx"), "utf8");
  const standalone = fs.readFileSync(path.join(root, "editor", "src", "packaging", "standalonePackage.ts"), "utf8");
  const tauri = fs.readFileSync(path.join(root, "editor", "src-tauri", "src", "main.rs"), "utf8");

  for (const token of [
    "setPackageResultDialog(undefined)",
    "createPackageBuildResultDialogModel",
    "createPackageBuildBlockedDialogModel",
    "createPackageBuildExceptionDialogModel",
    'testId="package-build-result-dialog"',
    'runMode === "standalone_package"',
  ]) {
    assert.ok(panel.includes(token), `导出面板缺少结果弹窗契约：${token}`);
  }
  for (const token of [
    'data-toolbar-popover-keepopen="true"',
    'event.key === "Escape"',
    "focusableElements",
    "operation-result-context-action",
  ]) {
    assert.ok(dialog.includes(token), `通用结果弹窗缺少交互契约：${token}`);
  }
  assert.ok(standalone.includes("open_standalone_package_output_directory"));
  assert.ok(tauri.includes("validated_standalone_output_directory"));
  assert.ok(tauri.includes("open_standalone_package_output_directory"));

  console.log("package build result dialog contract: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
