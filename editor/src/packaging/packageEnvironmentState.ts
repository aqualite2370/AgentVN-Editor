import type { PackageExportMode, PackageTargetPlatform } from "./runtimePackage";

type EnvironmentBusy = "check" | "install" | null;
type EnvironmentResult = { status?: string; manualFix?: string[] };

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
  return {
    busy,
    result,
    blocked: input.mode === "standalone_package" && result?.status === "BLOCKED",
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
