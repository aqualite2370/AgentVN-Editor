"use strict";
const assert = require("node:assert/strict");
const { correlateCacheDeletes, parseStraceEvents } = require("./lib/android-cache-attribution.cjs");
const clock = "PERF_CLOCK_SYNC_BEGIN|1010.000|10.00 1|1010.010\nPERF_CLOCK_SYNC_END|1017.000|17.00 1|1017.010";
const sample = (ns, tid, file) => `sample:\n  time: ${ns}\n  thread_id: ${tid}\n  thread_name: ThreadPoolForeg\n  callchain:\n    file: /apex/libc.so\n    symbol: unlinkat\n    file: ${file}\n    symbol: native-worker\n`;
const webview = "/data/TrichromeLibrary.apk!/lib/x86_64/libmonochrome_64.so";
const trace = '[pid 9] 1011.001 unlinkat(AT_FDCWD, "/data/user/0/com.agentvn.game.test/cache/WebView/Default/HTTP Cache/Code Cache", AT_REMOVEDIR) = 0';
const good = correlateCacheDeletes(sample("11000000000", 9, webview), trace, clock);
assert.equal(good.length, 1); assert.equal(good[0].status, "WEBVIEW_WORKER_DELETE_CORRELATED");
assert.equal(good[0].threadId, "9"); assert.equal(good[0].syscallReturn, 0);
assert.equal(correlateCacheDeletes(sample("11000000000", 8, webview), trace, clock)[0].status, "UNRESOLVED");
assert.equal(correlateCacheDeletes(sample("11000000000", 9, webview).repeat(2), trace, clock)[0].status, "UNRESOLVED");
assert.equal(correlateCacheDeletes(sample("90000000000", 9, webview), trace, clock)[0].status, "UNRESOLVED");
assert.equal(correlateCacheDeletes(sample("11000000000", 9, "/data/libagentvn.so"), trace, clock)[0].status, "OTHER_CALLER_CORRELATED");
assert.equal(correlateCacheDeletes(sample("11000000000", 9, webview), trace.replace("= 0", "= -1 ENOENT"), clock).length, 0);
assert.throws(() => correlateCacheDeletes("", trace, ""), /CLOCK_SYNC/);
assert.equal(typeof parseStraceEvents, "function");
const interleaved = '[pid 9] 1011.001 unlinkat(AT_FDCWD, "/data/user/0/com.agentvn.game.test/cache/WebView/Default/HTTP Cache/Code Cache", AT_REMOVEDIR <unfinished ...>\n'
  + '[pid 8] 1011.002 openat(AT_FDCWD, "/cache/js", O_RDONLY) = -1 ENOENT (No such file or directory)\n'
  + '[pid 9] 1011.003 <... unlinkat resumed> ) = 0\n';
const events = parseStraceEvents(interleaved);
assert.equal(events.length, 2); assert.equal(events[0].threadId, "9");
assert.equal(events[0].time, 1011.001); assert.equal(events[0].endTime, 1011.003);
assert.equal(events[0].syscallReturn, 0); assert.equal(events[1].errno, "ENOENT");
assert.equal(correlateCacheDeletes(sample("11000000000", 9, webview), interleaved, clock)[0].status, "WEBVIEW_WORKER_DELETE_CORRELATED");
assert.equal(parseStraceEvents('[pid 9] 1.001 <... unlinkat resumed> ) = 0').length, 0, "Orphan must not acquire guessed arguments");
assert.throws(() => parseStraceEvents('[pid 9] 1.001 unlinkat(0, <unfinished ...>\n[pid 9] 1.002 <... openat resumed> ) = 0'), /RESUME_MISMATCH/);
console.log("android-cache-attribution: PASS (exact directory, successful syscall, TID/ordinal/time, no false attribution)");
