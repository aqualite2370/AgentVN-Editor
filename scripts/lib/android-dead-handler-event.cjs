"use strict";

const { parseThreadtime } = require("./android-log-relay.cjs");

// A logged throwable is not necessarily an uncaught exception. Keep the whole
// original group, including incomplete/foreign-thread fragments, for review.
function collectDeadHandlerEvents(raw, ownedPids, maxSpanMs = 100) {
  if (!Number.isFinite(maxSpanMs) || maxSpanMs < 0 || maxSpanMs > 1000)
    throw Error("INVALID_HANDLER_EVENT_WINDOW");
  const owners = new Set(ownedPids.map(Number));
  const records = raw.split(/\r?\n/).flatMap((line, index) => {
    const parsed = parseThreadtime(line);
    return parsed ? [{ ...parsed, line, lineNumber: index + 1 }] : [];
  });
  const groups = [];
  for (let i = 0; i < records.length; i++) {
    const first = records[i];
    const match = /^Handler \(android\.view\.Choreographer\$FrameHandler\) \{([a-f0-9]+)\} sending message to a Handler on a dead thread$/.exec(first.message);
    if (!match || first.tag !== "MessageQueue" || first.severity !== "W" || !owners.has(first.pid))
      continue;
    const members = [first];
    for (let j = i + 1; j < records.length && members.length < 64; j++) {
      const next = records[j];
      if (next.timeMs < first.timeMs || next.timeMs - first.timeMs > maxSpanMs) break;
      if (next.pid !== first.pid || next.tid !== first.tid) continue;
      if (next.tag !== "MessageQueue" || next.severity !== "W") break;
      if (members.length === 1) {
        if (next.message !== "java.lang.IllegalStateException: " + first.message) break;
      } else if (!/^\s+at [A-Za-z0-9_.$]+\(.*\)$/.test(next.message)) break;
      members.push(next);
    }
    const frames = members.slice(2).map(row => row.message.trim());
    const requiredFrames = [
      "android.os.MessageQueue.enqueueMessage",
      "android.os.Handler.enqueueMessage",
      "android.os.Handler.sendMessageAtTime",
      "android.view.Choreographer$FrameDisplayEventReceiver.onVsync",
      "android.view.DisplayEventReceiver.dispatchVsync",
      "android.os.MessageQueue.nativePollOnce",
      "android.os.MessageQueue.next",
      "android.os.Looper.loopOnce",
      "android.os.Looper.loop",
      "android.os.HandlerThread.run",
    ];
    const observedMethods = frames.map(frame => /^at ([^(]+)\(/.exec(frame)?.[1]);
    const complete = members.length === requiredFrames.length + 2
      && observedMethods.every((method, index) => method === requiredFrames[index]);
    groups.push({ pid: first.pid, tid: first.tid, handler: match[1], complete,
      members, observedMethods, requiredMethods: requiredFrames,
      status: complete ? "COMPLETE_LOGGED_WARNING_STACK" : "INCOMPLETE_OR_DIFFERENT_STACK" });
  }
  return groups;
}

module.exports = { collectDeadHandlerEvents };
