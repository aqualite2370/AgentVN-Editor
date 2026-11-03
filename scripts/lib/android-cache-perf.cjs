"use strict";
const fs = require("node:fs"), path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
function directoryFor({ runId, label = "test" }) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw Error("RUN_ID_INVALID");
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(label)) throw Error("LABEL_INVALID");
  return `/data/local/tmp/agentvn-perf-${runId}-${label}`;
}
function cachePerfScript(config) {
  const { packageName } = config, directory = directoryFor(config);
  const fileSyscalls = config.fileTrace
    ? "unlink,unlinkat,rmdir,mkdir,mkdirat,newfstatat,stat,statx,openat,rename,renameat,renameat2"
    : "unlink,unlinkat,rmdir";
  if (!/^com\.agentvn\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(packageName)) throw Error("PACKAGE_INVALID");
  return [
    '[ "$(uname -m)" = x86_64 ] || { echo PERF_ARCH_UNSUPPORTED; exit 2; }',
    `mkdir '${directory}' || exit 3`,
    `simpleperf report-sample --help > '${directory}/report-help.txt' 2>&1`,
    "echo PERF_WATCH_READY",
    "i=0", 'while [ "$i" -lt 500 ]; do', `p=$(pidof ${packageName})`,
    `if [ -n "$p" ]; then actual=$(tr '\\000' '\\n' < /proc/$p/cmdline | head -1); [ "$actual" = '${packageName}' ] && break; p=; fi`,
    'i=$((i+1))', "sleep 0.01", "done",
    '[ -n "$p" ] || { echo PERF_PID_NOT_FOUND; exit 4; }', 'echo "PERF_APP_PID|$p"',
    'echo "PERF_CLOCK_SYNC_BEGIN|$(date +%s.%N)|$(cat /proc/uptime)|$(date +%s.%N)"',
    `timeout -s INT 10 simpleperf record -p "$p" -e raw_syscalls:sys_enter --tp-filter 'id == 263 || id == 84 || id == 87' --call-graph dwarf,8192 --no-callchain-joiner --clockid monotonic --duration 7 --size-limit 8M --no-dump-kernel-symbols -o '${directory}/perf.data' > '${directory}/perf-stdout.txt' 2> '${directory}/perf-stderr.txt' &`,
    "profiler=$!",
    `timeout -s INT 8 strace -f -ttt -s 4096 -e trace=${fileSyscalls} -p "$p" > '${directory}/strace.txt' 2>&1 &`,
    "tracer=$!", 'wait "$profiler"; echo "PERF_EXIT|$?"',
    'wait "$tracer"; echo "STRACE_EXIT|$?"',
    'echo "PERF_CLOCK_SYNC_END|$(date +%s.%N)|$(cat /proc/uptime)|$(date +%s.%N)"',
    `timeout -s INT 8 simpleperf report-sample --show-callchain -i '${directory}/perf.data' > '${directory}/report-sample.txt' 2>&1`,
    'echo "REPORT_EXIT|$?"', "exit 0",
  ].join("\n");
}
function parseCachePerf(text) {
  const value = name => text.match(new RegExp(`${name}\\|(\\d+)`))?.[1];
  return { appPid: value("PERF_APP_PID") || null,
    perfExitCode: value("PERF_EXIT") === undefined ? null : Number(value("PERF_EXIT")),
    straceExitCode: value("STRACE_EXIT") === undefined ? null : Number(value("STRACE_EXIT")),
    reportExitCode: value("REPORT_EXIT") === undefined ? null : Number(value("REPORT_EXIT")) };
}
function isPerfData(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.subarray(0, 8).toString("ascii") === "PERFILE2";
}
function startCachePerf(config, { spawnProcess = spawn, runProcess = spawnSync, writeFile = fs.writeFileSync } = {}) {
  const script = cachePerfScript(config), remote = directoryFor(config);
  const { adb, adbPort, serial, outputDir, label } = config;
  const base = ["-P", String(adbPort), "-s", serial];
  const child = spawnProcess(adb, [...base, "shell", "su", "0", "sh"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let raw = "", spawnError, readyResolve;
  const startedAt = new Date().toISOString(), ready = new Promise(resolve => { readyResolve = resolve; });
  child.stdout.on("data", bytes => { raw += bytes; if (raw.includes("PERF_WATCH_READY")) readyResolve(true); });
  child.stderr.on("data", bytes => { raw += bytes; });
  child.stdin.on("error", error => { spawnError = String(error); });
  const timer = setTimeout(() => { readyResolve(false); child.kill(); }, 35000);
  const completion = new Promise(resolve => {
    child.once("error", error => { spawnError = String(error); });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer); readyResolve(false);
      const files = [];
      let cleanupStatus = "FAILED", cleanupError, captureError;
      const names = ["perf.data", "perf-stdout.txt", "perf-stderr.txt", "strace.txt", "report-sample.txt", "report-help.txt"];
      try {
        for (const name of names) {
          const result = runProcess(adb, [...base, "exec-out", "su", "0", "cat", `${remote}/${name}`],
            { windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
          const local = path.join(outputDir, `${label}-${name}`);
          if (result.status === 0 && !result.error) writeFile(local, result.stdout);
          files.push({ name, path: result.status === 0 ? local : null, exitCode: result.status,
            error: result.error ? String(result.error) : null, stderr: String(result.stderr || ""),
            bytes: result.status === 0 ? result.stdout.length : 0,
            ...(name === "perf.data" ? { validPerfData: isPerfData(result.stdout) } : {}) });
        }
      } catch (error) { captureError = String(error.stack || error); }
      finally {
        try {
        const removed = runProcess(adb, [...base, "shell", "su", "0", "rm", "-f", ...names.map(name => `${remote}/${name}`)],
          { encoding: "utf8", windowsHide: true, timeout: 10000 });
        const dir = runProcess(adb, [...base, "shell", "su", "0", "rmdir", remote],
          { encoding: "utf8", windowsHide: true, timeout: 10000 });
        cleanupStatus = removed.status === 0 && !removed.error && dir.status === 0 && !dir.error ? "PASS" : "FAILED";
        cleanupError = cleanupStatus === "PASS" ? null : `${removed.stderr}:${dir.stderr}`;
        } catch (error) { cleanupError = String(error.stack || error); }
      }
      const rawPath = path.join(outputDir, `${label}-cache-perf.txt`);
      try { writeFile(rawPath, raw, "utf8"); } catch (error) { captureError ||= String(error); }
      const parsed = parseCachePerf(raw);
      resolve({ status: cleanupStatus !== "PASS" ? "FAILED"
        : !spawnError && !captureError && exitCode === 0 && parsed.perfExitCode === 0 && parsed.reportExitCode === 0
          && files.every(file => file.exitCode === 0 && !file.error)
          && files.find(file => file.name === "perf.data")?.validPerfData ? "COLLECTED_REQUIRES_REVIEW" : "UNAVAILABLE",
      startedAt, finishedAt: new Date().toISOString(), observerPid: child.pid, rawPath, files,
      exitCode, signal, spawnError, captureError, cleanupStatus, cleanupError, ...parsed,
      limitation: "Exact app only; perf and ptrace can perturb scheduling. Samples need PID/TID/time/path correlation; not uninstrumented acceptance" });
    });
  });
  child.stdin.end(script + "\n");
  return { ready, completion };
}
module.exports = { cachePerfScript, parseCachePerf, isPerfData, startCachePerf };
