"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { parseThreadtime } = require("./lib/android-log-relay.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const folder = "F:/testavn/Client-Presentation-Android-1975-20261116-device-01";
const reportPath = path.join(folder, "report.json"), logPath = path.join(folder, "failure-logcat.txt");
const output = "F:/testavn/Client-Presentation-Android-1975-20261116-04/startup-failure-timeline-01.json";
assert(!fs.existsSync(output));
const inputs = [reportPath, logPath].map(file => ({ path: file, sha256: sha(file) }));
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
assert.equal(report.status, "FAILED"); assert.match(report.error, /Target page, context or browser has been closed/);
assert.equal(report.touches.length, 0);
const c = report.cases[0], pid = +c.pid, raw = fs.readFileSync(logPath, "utf8");
const entries = raw.split(/\r?\n/).map((line, index) => ({ line, lineNumber: index + 1, ...parseThreadtime(line) }))
  .filter(row => row.tag);
const hostStarts = entries.filter(row => row.tag === "ActivityManager"
  && row.message.startsWith(`Start proc ${pid}:${c.package}/`));
assert.equal(hostStarts.length, 1);
const windows = entries.filter(row => row.tag === "CoreBackPreview"
  && row.message.includes(`${c.package}/${c.package}.MainActivity}`))
  .map(row => ({ ...row, window: /^Window\{([a-f0-9]+)/.exec(row.message)?.[1],
    callbackRemoved: row.message.endsWith("Setting back callback null") }));
assert.equal(new Set(windows.map(row => row.window)).size, 2);
const first = windows.find(row => !row.callbackRemoved);
const removed = windows.find(row => row.window === first.window && row.callbackRemoved);
const replacement = windows.find(row => row.window !== first.window && !row.callbackRemoved);
assert(first && removed && replacement);
assert(first.timeMs < removed.timeMs && removed.timeMs < replacement.timeMs);
const relaunchDraw = entries.find(row => row.tag === "WindowManager"
  && row.message.includes("finishDrawing of relaunch:")
  && row.message.includes(`Window{${replacement.window} u0 ${c.package}/${c.package}.MainActivity}`));
assert(relaunchDraw && relaunchDraw.timeMs >= replacement.timeMs);
const displayed = entries.find(row => row.tag === "ActivityTaskManager"
  && row.message.startsWith(`Displayed ${c.package}/.MainActivity`) && row.timeMs > relaunchDraw.timeMs);
assert(displayed);
const continuedHost = entries.filter(row => row.pid === pid && row.timeMs > displayed.timeMs);
assert(continuedHost.length > 0);
const scoped = scopedRuntimeLog(raw, c.package, [pid]); assert.deepEqual(scoped.fatal, []);
const result = { status: "ACTIVITY_RELAUNCH_PROVEN_CDP_TARGET_ID_AND_TRIGGER_NOT_CAPTURED",
  at: new Date().toISOString(), inputs, originalStatus: report.status, originalError: report.error,
  hostPid: pid, hostStart: hostStarts[0], firstWindow: first, removal: removed,
  replacementWindow: replacement, relaunchDraw, displayed,
  continuedHost: { records: continuedHost.length, first: continuedHost[0], last: continuedHost.at(-1) },
  capturedFatal: scoped.fatal, inputCount: 0, deviceStarts: 0, builds: 0, modelRequests: 0,
  boundary: "The original package relaunches its window while the same host PID remains active. No CDP target/session destruction event was captured; the initiating configuration is unknown. This supports, but does not prove, a replaced-target explanation and does not certify original functional completion." };
for (const input of inputs) assert.equal(sha(input.path), input.sha256);
fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: result.status, originalWindow: first.window,
  newWindow: replacement.window, hostPid: pid, continuedRecords: continuedHost.length, output }));
