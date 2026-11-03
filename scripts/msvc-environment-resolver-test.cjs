const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const resolver = path.join(root, "scripts", "resolve-msvc-environment.ps1");
const androidSetup = path.join(root, "scripts", "setup-android-build-env.ps1");
const androidBuild = path.join(root, "scripts", "build-runtime-standalone-android.ps1");
const windowsBuild = path.join(root, "scripts", "build-runtime-standalone-windows.cjs");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-msvc-env-"));
const fakeVsRoot = path.join(fixtureRoot, "VS Build Tools");
const fakeBin = path.join(fakeVsRoot, "VC", "Tools", "MSVC", "fixture", "bin", "Hostx64", "x64");
const fakeLib = path.join(fakeVsRoot, "VC", "Tools", "MSVC", "fixture", "lib", "x64");
const fakeInclude = path.join(fakeVsRoot, "VC", "Tools", "MSVC", "fixture", "include");
const fakeVsDevCmd = path.join(fakeVsRoot, "Common7", "Tools", "VsDevCmd.bat");

try {
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(fakeLib, { recursive: true });
  fs.mkdirSync(fakeInclude, { recursive: true });
  fs.mkdirSync(path.dirname(fakeVsDevCmd), { recursive: true });
  fs.copyFileSync(process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe", path.join(fakeBin, "link.exe"));
  fs.writeFileSync(
    fakeVsDevCmd,
    [
      "@echo off",
      `set "PATH=${fakeBin};%PATH%"`,
      `set "LIB=${fakeLib}"`,
      `set "INCLUDE=${fakeInclude}"`,
      `set "LIBPATH=${fakeLib}"`,
      `set "VCToolsInstallDir=${path.join(fakeVsRoot, "VC", "Tools", "MSVC", "fixture")}\\"`,
      "set \"WindowsSdkDir=C:\\Program Files (x86)\\Windows Kits\\10\\\"",
      "",
    ].join("\r\n"),
    "utf8",
  );

  const result = childProcess.spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolver,
      "-VsDevCmdPath",
      fakeVsDevCmd,
      "-Json",
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(
    result.status,
    0,
    `MSVC environment resolver fixture failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const report = JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ""));
  assert.equal(report.status, "PASS");
  assert.equal(report.linkPath.toLowerCase(), path.join(fakeBin, "link.exe").toLowerCase());
  assert.match(report.environment.Path, /Hostx64[\\/]x64/i);
  assert.equal(report.environment.LIB.toLowerCase(), fakeLib.toLowerCase());
  assert.equal(report.environment.INCLUDE.toLowerCase(), fakeInclude.toLowerCase());

  const setupText = fs.readFileSync(androidSetup, "utf8");
  const androidBuildText = fs.readFileSync(androidBuild, "utf8");
  const windowsBuildText = fs.readFileSync(windowsBuild, "utf8");
  assert.match(setupText, /windows_msvc_linker/);
  assert.match(setupText, /resolve-msvc-environment\.ps1/);
  assert.match(androidBuildText, /resolve-msvc-environment\.ps1/);
  assert.match(androidBuildText, /WINDOWS_MSVC_LINKER_MISSING/);
  assert.match(windowsBuildText, /function resolveMsvcBuildEnvironment\(\)/);
  assert.match(windowsBuildText, /vswhere/);
  assert.match(windowsBuildText, /WINDOWS_MSVC_LINKER_MISSING/);

  console.log("PASS MSVC environment resolution is shared by Android and Windows builds");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
