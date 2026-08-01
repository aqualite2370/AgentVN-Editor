import type { GameManifest, InstallPlan } from "./types";

export function compareSemver(left: string, right: string): number {
  const parse = (value: string) => {
    const parts = value.split(".").map((part) => Number(part));
    if (parts.length < 2 || parts.some((part) => Number.isNaN(part))) return undefined;
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return Number.NaN;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

export function isRuntimeCompatible(requiredRuntimeVersion: string, currentRuntimeVersion: string): boolean {
  const result = compareSemver(currentRuntimeVersion, requiredRuntimeVersion);
  return !Number.isNaN(result) && result >= 0;
}

export function isCartridgeFormatCompatible(cartridgeVersion: string, supportedVersion: string): boolean {
  const result = compareSemver(cartridgeVersion, supportedVersion);
  return !Number.isNaN(result) && result <= 0;
}

export function getCompatibilityWarnings(manifest: GameManifest, runtimeVersion: string): string[] {
  const warnings: string[] = [];
  if (Number.isNaN(compareSemver(manifest.runtime_version, runtimeVersion))) {
    warnings.push("runtime_version format is not valid semver.");
  }
  if (manifest.breaking_save_compatibility) {
    warnings.push("This cartridge marks old saves as potentially incompatible.");
  }
  return warnings;
}

export function compareInstalledVersion(currentVersion: string | undefined, incomingVersion: string): number | undefined {
  if (!currentVersion) return undefined;
  const result = compareSemver(incomingVersion, currentVersion);
  return Number.isNaN(result) ? undefined : result;
}

export function createInstallPlan(currentVersion: string | undefined, incomingVersion: string): InstallPlan {
  const comparison = compareInstalledVersion(currentVersion, incomingVersion);
  if (!currentVersion) return { action: "install_new", incoming_version: incomingVersion, warnings: [] };
  if (comparison === undefined) {
    return { action: "reinstall", current_version: currentVersion, incoming_version: incomingVersion, warnings: ["Version format could not be compared."] };
  }
  if (comparison > 0) return { action: "update", current_version: currentVersion, incoming_version: incomingVersion, warnings: [] };
  if (comparison === 0) return { action: "reinstall", current_version: currentVersion, incoming_version: incomingVersion, warnings: ["Same version already installed."] };
  return { action: "downgrade", current_version: currentVersion, incoming_version: incomingVersion, warnings: ["Incoming version is older than installed version."] };
}

export function canInstallCartridge(plan: InstallPlan): boolean {
  return plan.action !== "reject";
}
