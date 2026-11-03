"use strict";
const fs = require("node:fs"), path = require("node:path");
const { spawn } = require("node:child_process");
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

// Inspection of our freshly installed test package only. Does not restart adbd,
// change SELinux, remove cache, or create anything in the app's data directory.
function cacheProbeCommand(packageName) {
  if (!/^com\.agentvn\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(packageName))
    throw Error("PACKAGE_INVALID");
  const base = `/data/user/0/${packageName}`;
  const dirs = ["cache", "cache/WebView", "cache/WebView/Default",
    "cache/WebView/Default/HTTP Cache", "cache/WebView/Default/HTTP Cache/Code Cache",
    "cache/WebView/Default/HTTP Cache/Code Cache/js",
    "cache/WebView/Default/HTTP Cache/Code Cache/wasm"].map(dir => quote(`${base}/${dir}`));
  return `su 0 sh -c ${quote([
    "id", "id -Z", "df -k /data",
    "i=0",
    `while [ "$i" -lt 100 ]; do`,
    `echo "SAMPLE|$i|$(date +%s.%N)"`,
    `stat -c 'STATE|%i|%u|%g|%a|%Y|%n' ${dirs.join(" ")} 2>&1`,
    "i=$((i+1))", "sleep 0.05", "done",
    `ls -ldZ ${dirs.join(" ")} 2>&1`,
    "exit 0",
  ].join("\n"))}`;
}

function parseCacheProbe(text) {
  const samples = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SAMPLE|")) {
      const [, iteration, deviceTimestamp] = line.split("|");
      samples.push({ iteration: Number(iteration), deviceTimestamp, directories: [], errors: [] });
    } else if (line.startsWith("STATE|") && samples.length) {
      const fields = line.split("|");
      if (fields.length !== 7 || !/^\d+$/.test(fields[1])) throw Error("INVALID_CACHE_PROBE_STATE");
      const [, inode, uid, gid, mode, modifiedEpoch, directory] = fields;
      samples.at(-1).directories.push({ path: directory, inode, uid: Number(uid),
        gid: Number(gid), mode, modifiedEpoch });
    } else if (samples.length && /stat:/.test(line)) samples.at(-1).errors.push(line);
  }
  const directoryTransitions = [];
  let previous = new Map();
  for (const sample of samples) {
    const current = new Map(sample.directories.map(dir => [dir.path, dir]));
    if (sample !== samples[0]) {
      for (const directory of new Set([...current.keys(), ...previous.keys()])) {
        const before = previous.get(directory) || null, after = current.get(directory) || null;
        if (before?.inode !== after?.inode || before?.mode !== after?.mode || before?.uid !== after?.uid)
          directoryTransitions.push({ path: directory, deviceTimestamp: sample.deviceTimestamp, before, after });
      }
    }
    previous = current;
  }
  return { samples, directoryTransitions };
}

function startCacheProbe({ adb, adbPort, serial, packageName, outputDir, label, spawnProcess = spawn }) {
  const command = cacheProbeCommand(packageName);
  const startedAt = new Date().toISOString();
  const child = spawnProcess(adb, ["-P", String(adbPort), "-s", serial, "shell", command],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", spawnError = null;
  child.stdout.on("data", bytes => { stdout += bytes; });
  child.stderr.on("data", bytes => { stderr += bytes; });
  // A shell observer is bounded even if the surrounding CDP flow fails.
  const timer = setTimeout(() => child.kill(), 20000);
  const completion = new Promise(resolve => {
    child.once("error", error => { spawnError = String(error); });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      try {
        const rawPath = path.join(outputDir, `${label}-cache-probe.txt`);
        fs.writeFileSync(rawPath, stdout + "\nSTDERR:\n" + stderr, "utf8");
        const parsed = parseCacheProbe(stdout);
        resolve({ status: !spawnError && exitCode === 0 && parsed.samples.length === 100
          ? "COLLECTED" : "UNAVAILABLE", startedAt, finishedAt: new Date().toISOString(),
        probePid: child.pid, exitCode, signal, spawnError, rawPath, ...parsed,
        limitation: "Read-only root metadata, not an app-context access test; polling may perturb timing; no causal or acceptance conclusion" });
      } catch (error) { resolve({ status: "FAILED", error: String(error), startedAt }); }
    });
  });
  return { completion };
}

module.exports = { cacheProbeCommand, parseCacheProbe, startCacheProbe };
