"use strict";
function parseStraceEvents(text) {
  const pending = new Map(), events = [];
  for (const raw of text.split(/\r?\n/)) {
    const header = raw.match(/^\[pid\s+(\d+)\]\s+(\d+\.\d+)\s+(.*)$/);
    if (!header) continue;
    const [, threadId, timestamp, body] = header;
    const resumed = body.match(/^<\.\.\. (\w+) resumed>(.*)$/);
    let record = { threadId, time: Number(timestamp), endTime: Number(timestamp), body, raw };
    if (resumed) {
      const first = pending.get(threadId);
      if (!first) continue;
      if (first.name !== resumed[1]) throw Error("STRACE_RESUME_MISMATCH");
      pending.delete(threadId);
      record = { threadId, time: first.time, endTime: Number(timestamp),
        body: first.body + resumed[2].trimStart(), raw: first.raw + "\n" + raw };
    } else if (body.endsWith("<unfinished ...>")) {
      if (pending.has(threadId)) throw Error("STRACE_PENDING_OVERLAP");
      pending.set(threadId, { ...record, name: body.match(/^(\w+)\(/)?.[1],
        body: body.replace(/\s*<unfinished \.\.\.>$/, "") });
      continue;
    }
    const call = record.body.match(/^(\w+)\([^\r\n]*\)\s+=\s+(-?\d+)(?:\s+([A-Z][A-Z0-9_]+))?/);
    if (!call) continue;
    events.push({ ...record, syscallName: call[1], syscall: record.body.split(/\s+=\s+/)[0],
      syscallReturn: Number(call[2]), errno: call[3] || null });
  }
  return events.sort((a, b) => a.time - b.time);
}
function correlateCacheDeletes(perfText, traceText, clockText) {
  const clocks = [...clockText.matchAll(/PERF_CLOCK_SYNC_(?:BEGIN|END)\|(\d+\.\d+)\|(\d+\.\d+)[^|]*\|(\d+\.\d+)/g)]
    .map(match => ({ low: Number(match[1]) - Number(match[2]) - 0.01,
      high: Number(match[3]) - Number(match[2]) }));
  if (clocks.length !== 2) throw Error("CLOCK_SYNC_REQUIRED");
  const low = Math.max(...clocks.map(c => c.low)), high = Math.min(...clocks.map(c => c.high));
  if (low > high) throw Error("CLOCK_SYNC_INCONSISTENT");
  const samples = perfText.split(/^sample:\r?$/m).slice(1).map((text, index) => ({
    index, time: Number(text.match(/^\s+time: (\d+)/m)?.[1]) / 1e9,
    threadId: text.match(/^\s+thread_id: (\d+)/m)?.[1],
    threadName: text.match(/^\s+thread_name: (.+)/m)?.[1]?.trim(),
    frames: [...text.matchAll(/^\s+file: (.+)\r?\n\s+symbol: (.+)/gm)]
      .map(match => ({ module: match[1].trim(), symbol: match[2].trim() })),
  }));
  const syscalls = parseStraceEvents(traceText).filter(item => /^(unlinkat|unlink|rmdir)$/.test(item.syscallName))
    .map((item, index) => ({ index, ...item }));
  const roots = syscalls.filter(call => call.syscallReturn === 0
    && /"\/data\/user\/0\/com\.agentvn\.[^"]+\/cache\/WebView\/Default\/HTTP Cache\/Code Cache"/.test(call.syscall));
  return roots.map(call => {
    const threadCalls = syscalls.filter(item => item.threadId === call.threadId);
    const threadSamples = samples.filter(item => item.threadId === call.threadId);
    const ordinal = threadCalls.findIndex(item => item.index === call.index);
    const sample = threadSamples[ordinal];
    const deltas = threadCalls.map((item, index) => item.time - (threadSamples[index]?.time || 0));
    const valid = threadCalls.length === threadSamples.length && sample
      && deltas.every(delta => delta >= low - 0.003 && delta <= high + 0.003);
    if (!valid) return { ...call, status: "UNRESOLVED",
      reason: "Need complete same-TID syscall/sample sequence within independently measured clock bounds",
      syscallCount: threadCalls.length, sampleCount: threadSamples.length, clockBounds: { low, high }, deltas };
    const user = sample.frames.filter(frame => frame.module !== "[kernel.kallsyms]"
      && !frame.module.endsWith("/libc.so") && !frame.module.endsWith("/libc++.so"));
    const webview = user.length > 0 && user.every(frame => frame.module.includes("/libmonochrome_64.so"));
    return { ...call, status: webview ? "WEBVIEW_WORKER_DELETE_CORRELATED" : "OTHER_CALLER_CORRELATED",
      threadName: sample.threadName, ordinal, syscallCount: threadCalls.length,
      sampleCount: threadSamples.length, clockBounds: { low, high }, deltas,
      sampleTime: sample.time, frames: sample.frames,
      limitation: "Module and asynchronous worker attribution; stripped binary does not prove named cleanup routine or original warning's initiating cause" };
  });
}
module.exports = { correlateCacheDeletes, parseStraceEvents };
