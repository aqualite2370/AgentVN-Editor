const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const batPath = path.join(root, "start_androiddev.bat");
const scriptPath = path.join(__dirname, "start-androiddev.ps1");
const bat = fs.readFileSync(batPath, "utf8");
const script = fs.readFileSync(scriptPath, "utf8");

assert.match(bat, /start-androiddev\.ps1/i);
assert.match(script, /Read-Host "Enter APK path/);
assert.match(script, /D:\\Android_dev\\Sdk/);
assert.match(script, /AgentVN_API35/);
assert.match(script, /emulator-5554/);
assert.match(script, /"-no-snapshot"/);
assert.match(script, /"-no-boot-anim"/);
assert.match(script, /"-gpu", "swiftshader_indirect"/);
assert.match(script, /"-accel", "on"/);
assert.match(script, /"install", "-r", \$apk/);
assert.match(script, /"shell", "am", "force-stop", \$packageName/);
assert.match(script, /"shell", "monkey", "-p", \$packageName, "1"/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-start-androiddev-"));
const sdkRoot = path.join(tempRoot, "Sdk");
const platformTools = path.join(sdkRoot, "platform-tools");
const emulatorDir = path.join(sdkRoot, "emulator");
const buildTools = path.join(sdkRoot, "build-tools", "36.0.0");
for (const directory of [platformTools, emulatorDir, buildTools]) {
  fs.mkdirSync(directory, { recursive: true });
}

const logPath = path.join(tempRoot, "adb.log");
const fakeAdb = path.join(platformTools, "adb.cmd");
const fakeAapt = path.join(buildTools, "aapt.cmd");
const fakeEmulator = path.join(emulatorDir, "emulator.exe");
const apkPath = path.join(tempRoot, "隐忍的成长.apk");

fs.writeFileSync(fakeAdb, [
  "@echo off",
  `set "LOG=${logPath}"`,
  "echo %*>>\"%LOG%\"",
  "echo %* | findstr /c:\"get-state\" >nul && (echo device & exit /b 0)",
  "echo %* | findstr /c:\"getprop sys.boot_completed\" >nul && (echo 1 & exit /b 0)",
  "echo %* | findstr /c:\"install -r\" >nul && (echo Success & exit /b 0)",
  "echo %* | findstr /c:\"shell monkey -p com.agentvn.fixture\" >nul && (echo LAUNCH_OK>>\"%LOG%\" & exit /b 0)",
  "exit /b 0",
  "",
].join("\r\n"));
fs.writeFileSync(fakeAapt, [
  "@echo off",
  "echo %* | findstr /r \"[^ -~]\" >nul && exit /b 7",
  "echo package: name='com.agentvn.fixture' versionCode='1' versionName='1.0'",
  "",
].join("\r\n"));
fs.writeFileSync(fakeEmulator, "");
fs.writeFileSync(apkPath, "fixture");

const result = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-ApkPath", apkPath,
    "-SdkRoot", sdkRoot,
    "-AdbPath", fakeAdb,
    "-AaptPath", fakeAapt,
    "-EmulatorPath", fakeEmulator,
    "-BootTimeoutSeconds", "2",
  ],
  { cwd: root, encoding: "utf8", windowsHide: true },
);

try {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const log = fs.readFileSync(logPath, "utf8");
  assert.match(log, /install -r/);
  assert.equal(log.includes("隐忍的成长"), false, "Androiddev must pass an ASCII staging path to adb");
  assert.match(log, /shell am force-stop com\.agentvn\.fixture/);
  assert.match(log, /LAUNCH_OK/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("start-androiddev contract test passed");
