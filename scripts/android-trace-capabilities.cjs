"use strict";
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { spawnSync } = require("node:child_process");
const { collectTraceCapabilities } = require("./lib/android-trace-capabilities.cjs");
const { perfSelfcheckScript, parseSelfcheck } = require("./lib/android-perf-selfcheck.cjs");
const { captureWebViewBinary } = require("./lib/android-webview-binary.cjs");
const args = process.argv.slice(2), get = name => args[args.indexOf(name) + 1];
const out = path.resolve(get("--output")), port = Number(get("--adb-port"));
const adb = path.join(path.resolve(get("--sdk")), "platform-tools/adb.exe");
const serial = get("--serial"), bootId = get("--boot-id");
const file = path.join(out, "trace-capabilities.json");
if (fs.existsSync(file)) throw Error("PRESERVE_EVIDENCE");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("ADB_PORT_INVALID");
if (!/^emulator-\d+$/.test(serial)) throw Error("SERIAL_INVALID");
let owned = false;
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  isElevated: false, adbPort: port, runnerPid: process.pid,
  scope: "read-only-tracing-capabilities-no-app-install-or-launch",
  cleanupStatus: "NOT_RUN", uninstallStatus: "NOT_APPLICABLE_NO_INSTALL",
  apkCleanupStatus: "NOT_APPLICABLE_NO_STAGING", cleanupError: null };
const execute = (command, input) => spawnSync(adb, ["-P", String(port), "-s", serial, ...command],
  { input, encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
async function main() {
  try {
    const token = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
    { encoding: "utf8", windowsHide: true, timeout: 10000 });
    report.isElevated = token.status === 0 && token.stdout.trim().toLowerCase() === "true";
    if (!report.isElevated) throw Error("ANDROID_ADMIN_REQUIRED");
    const permission = JSON.parse(fs.readFileSync(path.join(out, "acceptance-permission.json"), "utf8"));
    if (!permission.success || !permission.isElevated) throw Error("SYMLINK_PROBE_REQUIRED");
    await new Promise((resolve, reject) => {
      const listener = net.createServer(); listener.once("error", reject);
      listener.listen(port, "127.0.0.1", () => listener.close(resolve));
    });
    owned = true;
    const start = execute(["start-server"]);
    report.adbStartup = { exitCode: start.status, stdout: start.stdout, stderr: start.stderr };
    if (start.status !== 0 || start.error) throw Error(`ADB_START:${start.error || start.stderr}`);
    Object.assign(report, collectTraceCapabilities({ expectedBootId: bootId, execute }));
    if (args.includes("--webview-package")) {
      report.webviewBinary = captureWebViewBinary({
        packageName: get("--webview-package"), outputFile: path.join(out, "TrichromeLibrary.apk"),
        sourceApk: args.includes("--webview-source-apk") ? get("--webview-source-apk") : undefined,
      }, { execute: command => spawnSync(adb, ["-P", String(port), "-s", serial, ...command],
        { encoding: "utf8", windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024 }) });
    }
    if (args.includes("--perf-selfcheck")) {
      const self = spawnSync(adb, ["-P", String(port), "-s", serial, "shell", "su", "0", "sh"],
        { input: perfSelfcheckScript(get("--run-id")) + "\n", encoding: "utf8",
          windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      report.selfcheck = { ...parseSelfcheck(self.stdout || ""), exitCode: self.status,
        stdout: self.stdout, stderr: self.stderr, error: self.error ? String(self.error) : null,
        scope: "only short-lived sleep processes and exact tool-owned temporary perf files" };
      if (report.selfcheck.cleanupStatus !== "PASS") {
        report.status = "FAILED"; report.cleanupError = "PERF_SELFCHECK_CLEANUP_UNVERIFIED";
      }
    }
  } catch (error) {
    report.status = "BLOCKED"; report.error = String(error.stack || error);
  } finally {
    if (owned) {
      const stopped = execute(["kill-server"]);
      report.adbShutdown = { exitCode: stopped.status, stdout: stopped.stdout, stderr: stopped.stderr,
        error: stopped.error ? String(stopped.error) : null };
      report.cleanupStatus = stopped.status === 0 && !stopped.error ? "PASS" : "FAILED";
      if (report.cleanupStatus !== "PASS") {
        report.status = "FAILED"; report.cleanupError = `OWNED_ADB_STOP_FAILED:${stopped.stderr}`;
      }
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
    console.log(`${report.status}: ${file}`);
    if (report.status !== "CAPABILITIES_RECORDED") process.exitCode = 1;
  }
}
main();
