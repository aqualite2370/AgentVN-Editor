"use strict";
const fs = require("node:fs"), path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
function debuggerConfig(input) {
  if (input.mode !== undefined && !["cache", "lifecycle-exit"].includes(input.mode))
    throw Error("MODE_INVALID");
  if (!/^com\.agentvn\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(input.packageName))
    throw Error("PACKAGE_INVALID");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input.runId)) throw Error("RUN_ID_INVALID");
  for (const port of [input.localPort, input.remotePort])
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("PORT_INVALID");
  return { ...input, remoteDirectory: `/data/local/tmp/agentvn-cache-${input.runId}`,
    cacheDirectory: `/data/user/0/${input.packageName}/cache/WebView/Default/HTTP Cache/Code Cache` };
}
function debuggerWatchScript(config) {
  const c = debuggerConfig(config);
  return ["echo DEBUGGER_WATCH_READY", "i=0", 'while [ "$i" -lt 500 ]; do', `p=$(pidof ${c.packageName})`,
    `if [ -n "$p" ]; then actual=$(tr '\\000' '\\n' < /proc/$p/cmdline | head -1); [ "$actual" = '${c.packageName}' ] && break; echo "DEBUGGER_IDENTITY_WAIT|$p|$actual"; p=; fi`,
    'i=$((i+1))', 'sleep 0.01', 'done',
    '[ -n "$p" ] || { echo DEBUGGER_PID_NOT_FOUND; exit 1; }',
    `test "$(tr '\\000' '\\n' < /proc/$p/cmdline | head -1)" = '${c.packageName}' || exit 2`,
    'echo "DEBUGGER_APP_PID|$p"',
    `timeout -s INT 12 '${c.remoteDirectory}/lldb-server' gdbserver :${c.remotePort} --attach "$p" 2>&1`,
    'code=$?', 'echo "DEBUGGER_SERVER_EXIT|$code"',
    `if [ "$(tr '\\000' '\\n' < /proc/$p/cmdline | head -1)" = '${c.packageName}' ]; then kill -CONT "$p"; fi`,
    'exit "$code"',
  ].join("\n");
}
function parseDebuggerOutput(text) {
  // An async LLDB prompt can share the line with the next actual Python print.
  // Strip that prompt only; "(lldb) script print(...)" remains a command echo.
  text = text.replace(/^\(lldb\) /gm, "");
  const forward = text.match(/DEBUGGER_FORWARD_CLEANUP\|(\d+)/);
  const files = text.match(/DEBUGGER_FILE_CLEANUP\|(\d+)\|(\d+)/);
  return { hits: text.split(/\r?\n/).filter(line => line.startsWith("CACHE_DELETE|"))
    .map(line => JSON.parse(line.slice("CACHE_DELETE|".length))),
  lifecycleHits: text.split(/\r?\n/).filter(line => line.startsWith("LIFECYCLE_EXIT|"))
    .map(line => JSON.parse(line.slice("LIFECYCLE_EXIT|".length))),
  lifecycleReady: /^LIFECYCLE_DEBUGGER_READY\|\d+\r?$/m.test(text),
  naturallyExited: /^LIFECYCLE_DEBUGGER_EXITED\|-?\d+\r?$/m.test(text),
  watcherRecovered: /^DEBUGGER_WATCHER_RECOVERED\|true\r?$/m.test(text),
  detached: text.includes("CACHE_DEBUGGER_DETACHED|true") || text.includes("LIFECYCLE_DEBUGGER_DETACHED|true"),
  cleanupStatus: !forward || !files ? "UNVERIFIED"
    : [forward[1], files[1], files[2]].every(code => code === "0") ? "PASS" : "FAILED" };
}
function debuggerResult(raw, code, mode, error) {
  const parsed = parseDebuggerOutput(raw);
  const collected = mode === "lifecycle-exit"
    ? parsed.lifecycleReady && parsed.lifecycleHits.length && (parsed.detached || parsed.naturallyExited)
    : parsed.detached && parsed.hits.length;
  return { status: parsed.cleanupStatus === "FAILED" ? "FAILED"
    : !error && code === 0 && collected && parsed.cleanupStatus === "PASS"
      ? parsed.watcherRecovered ? "COLLECTED_WITH_WATCHER_RECOVERY" : "COLLECTED" : "UNAVAILABLE",
    exitCode: code, error, ...parsed };
}
async function finishDebuggerWatcher(watcher, done, timeoutMs = 2000) {
  let timer;
  const expired = Symbol("watcher deadline");
  const first = await Promise.race([done, new Promise(resolve => {
    timer = setTimeout(() => resolve(expired), timeoutMs);
  })]);
  clearTimeout(timer);
  if (first !== expired) return { recovered: false, exitCode: first };
  // This is the exact child handle started by this observer, never a global ADB
  // server, emulator, or an application process.
  if (watcher.exitCode === null && watcher.signalCode === null) watcher.kill();
  watcher.stdout?.destroy(); watcher.stderr?.destroy();
  const last = await Promise.race([done, new Promise(resolve => {
    timer = setTimeout(() => resolve(expired), 3000);
  })]);
  clearTimeout(timer);
  if (last === expired) throw Error("DEBUGGER_OWNED_TRANSPORT_CLEANUP_TIMEOUT");
  return { recovered: true, exitCode: last };
}
function debuggerInstallCommands(config, server) {
  const c = debuggerConfig(config);
  return [["shell", "mkdir", c.remoteDirectory],
    ["push", server, `${c.remoteDirectory}/lldb-server`],
    ["shell", "chmod", "700", `${c.remoteDirectory}/lldb-server`]];
}
function startCacheDebugger(input) {
  const config = debuggerConfig(input);
  const configPath = path.join(config.outputDir, `${config.label}-debugger-config.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const child = spawn(process.execPath, [__filename, configPath],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let raw = "";
  let readyResolve, attachedResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const attached = new Promise(resolve => { attachedResolve = resolve; });
  const readyTimer = setTimeout(() => readyResolve(false), 14000);
  const attachedTimer = setTimeout(() => attachedResolve(false), 16000);
  child.stdout.on("data", bytes => {
    raw += bytes;
    if (raw.includes("DEBUGGER_WATCH_READY")) { clearTimeout(readyTimer); readyResolve(true); }
    if (/^(?:\(lldb\) )?LIFECYCLE_DEBUGGER_READY\|\d+\r?$/m.test(raw)) {
      clearTimeout(attachedTimer); attachedResolve(true);
    }
  });
  child.stderr.on("data", bytes => { raw += bytes; });
  const completion = new Promise(resolve => {
    let error;
    child.once("error", failure => { error = String(failure); });
    child.once("close", code => {
      clearTimeout(readyTimer); readyResolve(false); clearTimeout(attachedTimer); attachedResolve(false);
      const rawPath = path.join(config.outputDir, `${config.label}-cache-debugger.txt`);
      fs.writeFileSync(rawPath, raw, "utf8");
      let result;
      try { result = debuggerResult(raw, code, config.mode, error); }
      catch (failure) { result = { status: "UNAVAILABLE", exitCode: code, error: String(failure) }; }
      resolve({ ...result, rawPath,
      limitation: "Debugger attach and breakpoints perturb startup; attribution only, not acceptance" });
    });
  });
  return { completion, ready, attached };
}
async function worker(config) {
  const c = debuggerConfig(config), startedAt = Date.now();
  console.log("DEBUGGER_TOOL_SHA256|" + require("node:crypto").createHash("sha256")
    .update(fs.readFileSync(__filename)).digest("hex"));
  const ndk = c.ndk;
  const toolRoot = path.join(ndk, "toolchains/llvm/prebuilt/windows-x86_64");
  const lldb = path.join(toolRoot, "bin/lldb.exe");
  const server = path.join(toolRoot, "lib/clang/18/lib/linux/x86_64/lldb-server");
  for (const file of [lldb, server]) if (!fs.existsSync(file)) throw Error(`DEBUGGER_TOOL_MISSING:${file}`);
  const adbArgs = ["-P", String(c.adbPort), "-s", c.serial];
  function adb(args, tolerate = false) {
    const result = spawnSync(c.adb, [...adbArgs, ...args],
      { encoding: "utf8", windowsHide: true, timeout: 12000 });
    if (!tolerate && (result.error || result.status !== 0))
      throw Error(`ADB_DEBUGGER:${result.error || result.status}:${result.stdout}:${result.stderr}`);
    return result;
  }
  let watcher, forwarded = false, pushed = false, raw = "", watcherDone;
  try {
    await new Promise((resolve, reject) => {
      const listener = require("node:net").createServer();
      listener.once("error", reject);
      listener.listen(c.localPort, "127.0.0.1", () => listener.close(resolve));
    });
    for (const args of debuggerInstallCommands(c, server)) {
      adb(args); pushed = true;
    }
    adb(["forward", `tcp:${c.localPort}`, `tcp:${c.remotePort}`]); forwarded = true;
    watcher = spawn(c.adb, [...adbArgs, "shell", "su 0 sh"],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    watcher.stdout.on("data", bytes => { raw += bytes; process.stdout.write(bytes); });
    watcher.stderr.on("data", bytes => { raw += bytes; process.stderr.write(bytes); });
    watcherDone = new Promise(resolve => watcher.once("close", resolve));
    watcher.stdin.end(debuggerWatchScript(c) + "\n");
    while (!raw.includes("DEBUGGER_APP_PID|") && Date.now() - startedAt < 16000) {
      if (watcher.exitCode !== null) throw Error(`DEBUGGER_SERVER_EARLY_EXIT:${raw}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!raw.includes("DEBUGGER_APP_PID|")) throw Error(`DEBUGGER_SERVER_TIMEOUT:${raw}`);
    // lldb-server buffers its listening banner when redirected. The watcher
    // identity marker precedes exec; allow that exec to settle, then connect.
    await new Promise(resolve => setTimeout(resolve, 200));
    const appPid = raw.match(/DEBUGGER_APP_PID\|(\d+)/)[1];
    const maps = adb(["shell", "su", "0", "cat", `/proc/${appPid}/maps`]).stdout;
    fs.writeFileSync(path.join(c.outputDir, `${c.label}-debugger-maps.txt`), maps, "utf8");
    const libc = maps.match(/^([a-f0-9]+)-[a-f0-9]+\s+\S+\s+0+\s+\S+\s+\d+\s+([^\r\n]+\/libc\.so)$/m);
    if (!libc) throw Error("DEBUGGER_LIBC_MAPPING_MISSING");
    c.localLibc = path.join(c.outputDir, `${c.label}-libc.so`);
    c.libcBase = libc[1];
    adb(["pull", libc[2], c.localLibc]);
    fs.writeFileSync(c.configPath, JSON.stringify(c, null, 2), "utf8");
    const moduleDirectory = __dirname.replaceAll("\\", "/");
    const args = ["--batch", "-o", `script import sys, lldb; sys.path.insert(0, ${JSON.stringify(moduleDirectory)}); import android_cache_debugger as probe; probe.entry(lldb.debugger, ${JSON.stringify(c.configPath.replaceAll("\\", "/"))})`];
    const result = await new Promise(resolve => {
      const client = spawn(lldb, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      client.stdout.on("data", bytes => process.stdout.write(bytes));
      client.stderr.on("data", bytes => process.stderr.write(bytes));
      const timer = setTimeout(() => client.kill(), 10500);
      client.once("error", error => console.error(error));
      client.once("close", code => { clearTimeout(timer); resolve(code); });
    });
    if (result !== 0) throw Error(`LLDB_EXIT:${result}`);
  } finally {
    let watcherFailure;
    if (watcherDone) {
      try {
        const outcome = await finishDebuggerWatcher(watcher, watcherDone);
        console.log(`DEBUGGER_WATCHER_RECOVERED|${outcome.recovered}`);
      } catch (error) { watcherFailure = error; }
    }
    if (forwarded) {
      const result = adb(["forward", "--remove", `tcp:${c.localPort}`], true);
      console.log(`DEBUGGER_FORWARD_CLEANUP|${result.status}`);
    }
    if (pushed) {
      const result = adb(["shell", "rm", `${c.remoteDirectory}/lldb-server`], true);
      const directory = adb(["shell", "rmdir", c.remoteDirectory], true);
      console.log(`DEBUGGER_FILE_CLEANUP|${result.status}|${directory.status}`);
    }
    if (watcherFailure) throw watcherFailure;
  }
}
if (require.main === module) {
  const configPath = process.argv[2], config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  worker({ ...config, configPath }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { debuggerConfig, debuggerWatchScript, debuggerInstallCommands, parseDebuggerOutput,
  debuggerResult, startCacheDebugger, finishDebuggerWatcher };
