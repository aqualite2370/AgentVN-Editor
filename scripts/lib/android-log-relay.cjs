"use strict";

function parseThreadtime(line) {
  // Threadtime uses ": " between tag and body. Renderer tags themselves can
  // contain ":" (ocessService0:0); taking the first bare colon corrupts both.
  const m = /^(\d\d)-(\d\d)\s+(\d\d):(\d\d):(\d\d)\.(\d{3,6})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^\r\n]+?):[ \t](.*)$/.exec(line);
  if (!m) return null;
  return { pid: +m[7], tid: +m[8], severity: m[9], tag: m[10].trim(), message: m[11],
    timeMs: Date.UTC(2000, +m[1] - 1, +m[2], +m[3], +m[4], +m[5], +m[6].slice(0, 3)) };
}

// Each original can explain at most one relay. Ambiguity remains unclassified.
function pairStderrRelays(lines, ownedPids, maxDelayMs = 250) {
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0 || maxDelayMs > 1000) throw new Error("INVALID_RELAY_WINDOW");
  const owners = new Set(ownedPids.map(Number));
  const records = lines.map(parseThreadtime);
  const candidates = records.map((relay, relayIndex) => {
    if (!relay || !owners.has(relay.pid) || relay.severity !== "I" || relay.tag !== "RustStdoutStderr") return [];
    return records.flatMap((native, nativeIndex) => {
      // tao drains stdout/stderr on its own thread. TID equality is invalid.
      if (!native || nativeIndex === relayIndex || native.pid !== relay.pid
        || native.tag !== "chromium" || !/[WEF]/.test(native.severity)
        || native.message !== relay.message) return [];
      const delayMs = relay.timeMs - native.timeMs;
      return delayMs >= 0 && delayMs <= maxDelayMs ? [{ nativeIndex, delayMs }] : [];
    });
  });
  const uses = new Map();
  for (const list of candidates) for (const c of list) uses.set(c.nativeIndex, (uses.get(c.nativeIndex) || 0) + 1);
  return candidates.flatMap((list, relayIndex) => list.length === 1 && uses.get(list[0].nativeIndex) === 1
    ? [{ relayIndex, nativeIndex: list[0].nativeIndex, delayMs: list[0].delayMs,
      native: records[list[0].nativeIndex], relay: records[relayIndex] }] : []);
}

module.exports = { parseThreadtime, pairStderrRelays };
