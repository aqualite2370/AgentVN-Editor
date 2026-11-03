const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const apkPath = path.resolve(option("--apk"));
const outputDir = path.resolve(option("--output", path.join(root, "output", "android-emulator-smoke")));
const sdkRoot = path.resolve(option("--sdk", "D:\\Android_dev\\Sdk"));
const serial = option("--serial", "emulator-5554");
const requestedPackageName = option("--package");
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const reportPath = path.join(outputDir, "runtime-smoke-report.json");

function fail(message, failureCode) {
  const report = {
    schemaVersion: 1,
    artifactPath: apkPath,
    artifactSha256: fs.existsSync(apkPath) ? crypto.createHash("sha256").update(fs.readFileSync(apkPath)).digest("hex") : undefined,
    platform: "android",
    device: serial,
    coldStart: {},
    screens: [],
    clicks: [],
    layout: [],
    resources: [],
    audio: [],
    consoleErrors: [],
    nativeErrors: [],
    status: "FAIL",
    failureCode,
    message,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stderr.write(`${failureCode}: ${message}\n`);
  process.exit(1);
}

function run(commandArgs, options = {}) {
  const result = spawnSync(adb, ["-s", serial, ...commandArgs], {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "adb command failed").trim());
  return result.stdout || "";
}

function capture(commandArgs, filePath) {
  const result = spawnSync(adb, ["-s", serial, ...commandArgs], {
    windowsHide: true,
    stdio: ["ignore", fs.openSync(filePath, "w"), "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr ? result.stderr.toString("utf8") : "adb capture failed");
  }
}

function findAapt() {
  const buildToolsRoot = path.join(sdkRoot, "build-tools");
  if (!fs.existsSync(buildToolsRoot)) return undefined;
  const versions = fs.readdirSync(buildToolsRoot)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = path.join(
      buildToolsRoot,
      version,
      process.platform === "win32" ? "aapt.exe" : "aapt",
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function packageNameFromApk() {
  if (requestedPackageName) return requestedPackageName;
  const aapt = findAapt();
  if (!aapt) throw new Error("aapt is required to resolve the installed APK package name.");
  const result = spawnSync(aapt, ["dump", "badging", apkPath], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`aapt failed to inspect APK metadata: ${result.stderr || result.stdout}`);
  const match = /^package:\s+name='([^']+)'/m.exec(result.stdout || "");
  if (!match?.[1]) throw new Error("APK package name was not present in aapt badging output.");
  return match[1];
}

if (!apkPath || !fs.existsSync(apkPath)) fail(`APK not found: ${apkPath}`, "APK_MISSING");
fs.mkdirSync(outputDir, { recursive: true });

try {
  const deviceState = run(["get-state"]).trim();
  if (deviceState !== "device") fail(`Emulator is not online: ${deviceState}`, "EMULATOR_NOT_READY");
  run(["logcat", "-c"]);
  const installOutput = run(["install", "-r", apkPath]);
  fs.writeFileSync(path.join(outputDir, "install.log"), installOutput, "utf8");
  const packageName = packageNameFromApk();
  run(["shell", "am", "force-stop", packageName]);
  run(["shell", "monkey", "-p", packageName, "1"]);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    const focus = run(["shell", "dumpsys", "activity", "activities"]);
    const foregroundLines = focus
      .split(/\r?\n/)
      .filter((line) => /topResumedActivity=|ResumedActivity:|mCurrentFocus=|mFocusedApp=/.test(line));
    if (foregroundLines.some((line) => line.includes(packageName))) break;
  }
  if (Date.now() - startedAt >= 15000) fail(`Installed APK did not reach the foreground: ${packageName}`, "APK_NOT_FOREGROUND");
  run(["shell", "sleep", "2"]);
  capture(["exec-out", "screencap", "-p"], path.join(outputDir, "cold-start.png"));
  run(["shell", "uiautomator", "dump", "/sdcard/window.xml"]);
  run(["pull", "/sdcard/window.xml", path.join(outputDir, "window.xml")]);
  const logcat = run(["logcat", "-d", "-v", "threadtime"]);
  fs.writeFileSync(path.join(outputDir, "logcat.txt"), logcat, "utf8");
  const nativeErrors = logcat.split(/\r?\n/).filter((line) => /FATAL EXCEPTION|AndroidRuntime:E|agentvn-resource.*failed/i.test(line));
  const uiXml = fs.readFileSync(path.join(outputDir, "window.xml"), "utf8");
  const hasWebView = uiXml.includes("android.webkit.WebView");
  const report = {
    schemaVersion: 1,
    artifactPath: apkPath,
    artifactSha256: crypto.createHash("sha256").update(fs.readFileSync(apkPath)).digest("hex"),
    platform: "android",
    device: serial,
    coldStart: { packageName, hasWebView, installOutput: installOutput.trim() },
    screens: [],
    clicks: [],
    layout: [{ event: "uiautomator", hasWebView, xmlPath: path.join(outputDir, "window.xml") }],
    resources: [],
    audio: [],
    consoleErrors: [],
    nativeErrors,
    status: hasWebView && nativeErrors.length === 0 ? "PASS" : "FAIL",
    failureCode: hasWebView && nativeErrors.length === 0 ? null : "PACKAGED_RESOURCE_SMOKE_FAILED",
    message: hasWebView && nativeErrors.length === 0
      ? "WebView cold-start smoke passed; DOM hit testing is covered by android-apk-runtime-qa."
      : undefined,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "PASS" ? 0 : 1;
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), "EMULATOR_SMOKE_FAILED");
}
