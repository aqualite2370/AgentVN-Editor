"use strict";
const fs = require("node:fs"), path = require("node:path");
const { spawn } = require("node:child_process");
function cacheStackScript(packageName) {
  if (!/^com\.agentvn\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(packageName))
    throw Error("PACKAGE_INVALID");
  const directory = `/data/user/0/${packageName}/cache/WebView/Default/HTTP Cache/Code Cache`;
  return [
    "id", "id -Z",
    "strace -k -e trace=unlinkat /system/bin/true 2>&1", "support=$?",
    'echo "STACK_SUPPORT|$support"', '[ "$support" -eq 0 ] || exit 0',
    "i=0", 'while [ "$i" -lt 500 ]; do', `p=$(pidof ${packageName})`,
    '[ -n "$p" ] && break', "i=$((i+1))", "sleep 0.02", "done",
    '[ -n "$p" ] || { echo TRACE_PID_NOT_FOUND; exit 0; }',
    'echo "TRACE_APP_PID|$p"',
    `timeout -s INT 7 strace -k -f -ttt -e trace=unlinkat,rmdir -P '${directory}' -p "$p" 2>&1`,
    'echo "TRACE_EXIT|$?"', "exit 0",
  ].join("\n");
}
function parseCacheStack(text) {
  return {
    stackSupport: text.includes("STACK_SUPPORT|0"),
    appPid: text.match(/TRACE_APP_PID\|(\d+)/)?.[1] || null,
    traceExitCode: text.match(/TRACE_EXIT\|(\d+)/)?.[1] === undefined
      ? null : Number(text.match(/TRACE_EXIT\|(\d+)/)[1]),
    successfulDirectoryDeletes: text.split(/\r?\n/).filter(line =>
      /(?:unlinkat|rmdir)\(.*\/HTTP Cache\/Code Cache".*\)\s*=\s*0/.test(line)),
    stackFrames: text.split(/\r?\n/).filter(line => /^\s*>\s*\//.test(line)),
  };
}
function startCacheStack({ adb, adbPort, serial, packageName, outputDir, label, spawnProcess = spawn }) {
  const script = cacheStackScript(packageName), startedAt = new Date().toISOString();
  const child = spawnProcess(adb, ["-P", String(adbPort), "-s", serial, "shell", "su 0 sh"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", spawnError = null;
  child.stdout.on("data", bytes => { stdout += bytes; });
  child.stderr.on("data", bytes => { stderr += bytes; });
  child.stdin.on?.("error", error => { spawnError ||= String(error); });
  const timer = setTimeout(() => child.kill(), 22000);
  const completion = new Promise(resolve => {
    child.once("error", error => { spawnError = String(error); });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      try {
        const rawPath = path.join(outputDir, `${label}-cache-stack.txt`);
        fs.writeFileSync(rawPath, stdout + "\nSTDERR:\n" + stderr, "utf8");
        const parsed = parseCacheStack(stdout);
        resolve({ status: !spawnError && exitCode === 0 && parsed.stackSupport
          && parsed.appPid && parsed.stackFrames.length ? "COLLECTED" : "UNAVAILABLE",
        startedAt, finishedAt: new Date().toISOString(), probePid: child.pid,
        exitCode, signal, spawnError, rawPath, ...parsed,
        limitation: "Bounded ptrace can perturb scheduling; attribution only, not uninstrumented acceptance" });
      } catch (error) { resolve({ status: "FAILED", error: String(error), startedAt }); }
    });
  });
  child.stdin.end(script + "\n");
  return { completion };
}
module.exports = { cacheStackScript, parseCacheStack, startCacheStack };
