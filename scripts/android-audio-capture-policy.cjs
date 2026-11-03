"use strict";
function captureProcessTimeoutMs(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('capture duration must be positive');
  // API-35 emulator audio can deliver streamAudio packets much slower than
  // wall-clock under graphics load. Keep a generous, bounded gRPC deadline
  // and 5s for cancellation/report flush outside it.
  return (Math.max(seconds * 16, seconds + 150) + 5) * 1000;
}
module.exports = { captureProcessTimeoutMs };
