const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "scripts", "build-runtime-standalone-android.ps1"), "utf8");
const runner = fs.readFileSync(path.join(root, "scripts", "build-runtime-standalone-android.cjs"), "utf8");
const host = fs.readFileSync(path.join(root, "editor", "src-tauri", "src", "main.rs"), "utf8");

const probeIndex = script.indexOf("$SymlinkProbe = Test-AndroidSymlinkCapability");
const tokenIndex = script.indexOf("$SkipEnvironmentCheck -and $SymlinkProbe.isElevated");
const authoritativeTokenIndex = script.indexOf("$SymlinkProbe.isElevated -ne $true");
const authoritativeReportIndex = script.indexOf(
  "Write-Utf8Atomic -Path $EnvReport -Value $EnvResult",
  authoritativeTokenIndex,
);
const staleReportIndex = script.indexOf(
  "Write-Utf8Atomic -Path $EnvReport -Value $EnvResult",
);
if (probeIndex < 0 || authoritativeTokenIndex < probeIndex) {
  throw new Error("actual elevated token validation must follow the workspace symlink probe");
}
if (staleReportIndex < 0 || authoritativeReportIndex < 0 || staleReportIndex !== authoritativeReportIndex) {
  throw new Error(
    "the normal cached environment report must not be published before the authoritative elevated symlink probe",
  );
}
if (!runner.includes("AGENTVN_ANDROID_ELEVATED_HELPER")) {
  throw new Error("elevated runner marker is missing");
}
if (!script.includes('SkipEnvironmentCheck is restricted to the elevated Android helper')) {
  throw new Error("SkipEnvironmentCheck must be restricted to the elevated helper");
}
if (!script.includes('The environment cache is only a toolchain shortcut')) {
  throw new Error("elevated helper must publish the authoritative environment result");
}
if (!host.includes("probe.is_elevated == windows_process_is_elevated()")) {
  throw new Error("an elevated cached probe must not suppress UAC in a non-elevated parent process");
}
if (!host.includes("if !windows_process_is_elevated()")) {
  throw new Error("elevated helper must reject a non-administrator token before starting the Android runner");
}
console.log("PASS Android elevation helper uses authoritative elevated probe");
