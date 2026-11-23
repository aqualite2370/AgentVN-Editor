import type { PackageExportMode, PackageTargetPlatform } from "./runtimePackage";

type EnvironmentBusy = "check" | "install" | "import" | null;
type EnvironmentResult = { status?: string; cacheHit?: boolean; manualFix?: string[] };

export type PackageEnvironmentVerificationState =
  | "unchecked"
  | "checking"
  | "passed"
  | "failed";

export function derivePackageEnvironmentVerification(input: {
  busy: EnvironmentBusy;
  result?: EnvironmentResult;
}): {
  state: PackageEnvironmentVerificationState;
  label: string;
  detail: string;
  freshPass: boolean;
} {
  if (input.busy) {
    return {
      state: "checking",
      label: "检测中",
      detail: "正在检测当前构建环境。",
      freshPass: false,
    };
  }
  if (!input.result) {
    return {
      state: "unchecked",
      label: "未检测",
      detail: "尚未检测当前构建环境。",
      freshPass: false,
    };
  }
  if (input.result.status === "PASS") {
    return {
      state: "passed",
      label: "已通过",
      // The desktop host only returns cache hits validated for this editor version.
      detail: input.result.cacheHit
        ? "已复用当前编辑器版本通过的环境检测结果。"
        : "当前构建环境已通过检测。",
      freshPass: true,
    };
  }
  return {
    state: "failed",
    label: "未通过",
    detail: "当前构建环境未通过检测。",
    freshPass: false,
  };
}

export function deriveActivePackageEnvironment<
  TAndroid extends EnvironmentResult,
  TWindows extends EnvironmentResult,
>(input: {
  mode: PackageExportMode;
  targetPlatform: PackageTargetPlatform;
  androidBusy: EnvironmentBusy;
  windowsBusy: EnvironmentBusy;
  androidResult?: TAndroid;
  windowsResult?: TWindows;
  }) {
  const busy = input.targetPlatform === "android" ? input.androidBusy : input.windowsBusy;
  const result = input.targetPlatform === "android" ? input.androidResult : input.windowsResult;
  const verification = derivePackageEnvironmentVerification({ busy, result });
  return {
    busy,
    result,
    verification,
    blocked: input.mode === "standalone_package" && verification.state === "failed",
  };
}

export function shouldPublishPackageEnvironmentMessages(input: {
  mode: PackageExportMode;
  activePlatform: PackageTargetPlatform;
  resultPlatform: PackageTargetPlatform;
  requestId: number;
  latestRequestId: number;
}): boolean {
  return input.mode === "standalone_package"
    && input.activePlatform === input.resultPlatform
    && input.requestId === input.latestRequestId;
}

export function visiblePackageEnvironmentManualFix(result: EnvironmentResult): string[] {
  return result.status === "PASS" ? [] : result.manualFix ?? [];
}
