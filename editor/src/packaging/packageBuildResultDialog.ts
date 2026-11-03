import type { OperationResultDetail, OperationResultTone } from "../components/common/OperationResultDialog";
import type { PackageTargetPlatform } from "./runtimePackage";
import type { StandalonePackageBuildResult } from "./standalonePackage";

export interface PackageBuildResultDialogAction {
  kind: "output" | "diagnostics";
  label: string;
  path: string;
}

export interface PackageBuildResultDialogModel {
  tone: OperationResultTone;
  label: string;
  title: string;
  message: string;
  details: OperationResultDetail[];
  action?: PackageBuildResultDialogAction;
}

const platformLabels: Record<PackageTargetPlatform, string> = {
  windows: "Windows",
  android: "Android",
};

function cleanPath(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

export function createPackageBuildResultDialogModel(input: {
  result: StandalonePackageBuildResult;
  targetPlatform: PackageTargetPlatform;
  outputDir: string;
}): PackageBuildResultDialogModel {
  const { result, targetPlatform } = input;
  const platform = platformLabels[targetPlatform];
  const outputDir = cleanPath(input.outputDir);
  const diagnosticsDir = cleanPath(result.diagnosticsDir);
  const details: OperationResultDetail[] = [];

  if (result.status === "PASS") {
    if (outputDir) details.push({ label: "输出目录", value: outputDir });
    details.push({ label: "生成产物", value: `${result.artifacts.length} 项` });
    details.push({ label: "构建警告", value: `${result.warnings.length} 条` });
    return {
      tone: "success",
      label: "构建完成",
      title: `${platform} 软件构建成功`,
      message: result.message,
      details,
      action: outputDir ? { kind: "output", label: "打开输出目录", path: outputDir } : undefined,
    };
  }

  if (result.failureCode) details.push({ label: "失败代码", value: result.failureCode });
  if (cleanPath(result.buildLogPath)) details.push({ label: "构建日志", value: result.buildLogPath });
  if (diagnosticsDir) details.push({ label: "诊断目录", value: diagnosticsDir });
  if (result.warnings.length > 0) details.push({ label: "构建警告", value: `${result.warnings.length} 条` });

  const blocked = result.status === "BLOCKED";
  return {
    tone: blocked ? "warning" : "error",
    label: blocked ? "构建被阻断" : "构建失败",
    title: `${platform} 软件构建${blocked ? "被阻断" : "失败"}`,
    message: result.message,
    details,
    action: diagnosticsDir
      ? { kind: "diagnostics", label: "打开诊断目录", path: diagnosticsDir }
      : undefined,
  };
}

export function createPackageBuildBlockedDialogModel(
  targetPlatform: PackageTargetPlatform,
  message: string,
): PackageBuildResultDialogModel {
  return {
    tone: "warning",
    label: "构建被阻断",
    title: `${platformLabels[targetPlatform]} 软件构建被阻断`,
    message,
    details: [],
  };
}

export function createPackageBuildExceptionDialogModel(
  targetPlatform: PackageTargetPlatform,
  error: unknown,
): PackageBuildResultDialogModel {
  return {
    tone: "error",
    label: "构建失败",
    title: `${platformLabels[targetPlatform]} 软件构建失败`,
    message: error instanceof Error ? error.message : String(error || "导出失败"),
    details: [],
  };
}
