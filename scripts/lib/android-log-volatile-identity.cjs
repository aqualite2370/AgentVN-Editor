"use strict";

// Classify only exact source-backed emitters after a caller has verified the
// source SHA and actual session. A logger tag is not a stable process identity.
function matchVolatileIdentityMessage(record, context) {
  if (context.sdk !== "35" || !context.presentationPassed) return null;
  const host = context.hostPids.map(Number).includes(record.pid);
  const rendererName = context.rendererNames[record.pid];
  const processName = host ? context.packageName : rendererName;
  const processLogger = Boolean(processName && record.tag.length >= 8
    && processName.endsWith(record.tag));
  if (processLogger) {
    if (context.abi === "x86_64" && record.severity === "W") {
      if (record.message === "Unexpected CPU variant for x86: x86_64.") return "art-x86-variant";
      if (record.message === "Known variants: atom, sandybridge, silvermont, goldmont, goldmont-plus, goldmont-without-sha-xsaves, tremont, kabylake, default")
        return "art-x86-known-variants";
    }
    if (record.severity === "E"
      && record.message === "Not starting debugger since process cannot load the jdwp agent.")
      return "art-jdwp-unavailable";
  }
  if (!host || record.severity !== "W") return null;
  if (record.tag === "InteractionJankMonitor"
    && record.message === "Initializing without READ_DEVICE_CONFIG permission. enabled=true, interval=1, missedFrameThreshold=3, frameTimeThreshold=64, package=" + context.packageName)
    return "framework-jank-config";
  const provider = context.providerLoads[record.pid];
  if (record.tag === "ziparchive" && provider?.name === "com.google.android.webview"
    && provider.version === "124.0.6367.219" && provider.code === "636771938"
    && /^Unable to open '\/data\/app\/~~[A-Za-z0-9_+=-]+\/com\.google\.android\.trichromelibrary_636771938-[A-Za-z0-9_+=-]+\/TrichromeLibrary\.dm': No such file or directory$/.test(record.message))
    return "provider-optional-dex-metadata";
  return null;
}

module.exports = { matchVolatileIdentityMessage };
