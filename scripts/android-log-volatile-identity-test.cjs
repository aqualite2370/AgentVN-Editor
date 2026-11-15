"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { matchVolatileIdentityMessage } = require("./lib/android-log-volatile-identity.cjs");
const context = {
  sdk: "35", abi: "x86_64", packageName: "com.agentvn.qa.client1975.renpy", presentationPassed: true,
  hostPids: [2131], rendererNames: { 2200: "com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0" },
  providerLoads: { 2131: { name: "com.google.android.webview", version: "124.0.6367.219", code: "636771938" } },
};
const record = (overrides = {}) => ({ pid: 2131, severity: "W", tag: "lient1975.renpy",
  message: "Unexpected CPU variant for x86: x86_64.", ...overrides });
test("ART process-tag change is accepted only with exact host ownership", () => {
  assert.equal(matchVolatileIdentityMessage(record(), context), "art-x86-variant");
  assert.equal(matchVolatileIdentityMessage(record({ pid: 999 }), context), null);
  assert.equal(matchVolatileIdentityMessage(record({ tag: "lient1974.renpy" }), context), null);
  assert.equal(matchVolatileIdentityMessage(record({ tag: "renpy" }), context), null);
});
test("renderer tag containing a colon must belong to its ActivityManager mapping", () => {
  assert.equal(matchVolatileIdentityMessage(record({ pid: 2200, tag: "ocessService0:0" }), context), "art-x86-variant");
  assert.equal(matchVolatileIdentityMessage(record({ pid: 2201, tag: "ocessService0:0" }), context), null);
  assert.equal(matchVolatileIdentityMessage(record({ pid: 2200, tag: "ocessService0:1" }), context), null);
});
test("CPU fallback needs current platform, exact message, severity and completed function", () => {
  for (const delta of [{ sdk: "34" }, { abi: "arm64-v8a" }, { presentationPassed: false }])
    assert.equal(matchVolatileIdentityMessage(record(), { ...context, ...delta }), null);
  for (const delta of [{ severity: "E" }, { message: "Unexpected CPU variant for x86: unknown." },
    { message: "prefix Unexpected CPU variant for x86: x86_64." }])
    assert.equal(matchVolatileIdentityMessage(record(delta), context), null);
});
test("known CPU list and unavailable JDWP branch have separate exact rules", () => {
  assert.equal(matchVolatileIdentityMessage(record({
    message: "Known variants: atom, sandybridge, silvermont, goldmont, goldmont-plus, goldmont-without-sha-xsaves, tremont, kabylake, default",
  }), context), "art-x86-known-variants");
  assert.equal(matchVolatileIdentityMessage(record({ severity: "E",
    message: "Not starting debugger since process cannot load the jdwp agent.",
  }), context), "art-jdwp-unavailable");
});
test("jank config record binds its dynamic package and actual host PID", () => {
  const jank = record({ tag: "InteractionJankMonitor",
    message: "Initializing without READ_DEVICE_CONFIG permission. enabled=true, interval=1, missedFrameThreshold=3, frameTimeThreshold=64, package=" + context.packageName });
  assert.equal(matchVolatileIdentityMessage(jank, context), "framework-jank-config");
  assert.equal(matchVolatileIdentityMessage({ ...jank, message: jank.message + ".foreign" }, context), null);
  assert.equal(matchVolatileIdentityMessage({ ...jank, pid: 2200 }, context), null);
  assert.equal(matchVolatileIdentityMessage({ ...jank, message: jank.message.replace("64", "65") }, context), null);
});
test("optional dex metadata binds exact loaded provider code and refuses other missing files", () => {
  const dm = record({ tag: "ziparchive",
    message: "Unable to open '/data/app/~~fresh-id/com.google.android.trichromelibrary_636771938-fresh-id==/TrichromeLibrary.dm': No such file or directory" });
  assert.equal(matchVolatileIdentityMessage(dm, context), "provider-optional-dex-metadata");
  for (const suffix of [".apk", ".dex", ".dm/../../secret"])
    assert.equal(matchVolatileIdentityMessage({ ...dm, message: dm.message.replace(".dm", suffix) }, context), null);
  assert.equal(matchVolatileIdentityMessage({ ...dm, message: dm.message.replace("_636771938", "_636771939") }, context), null);
  assert.equal(matchVolatileIdentityMessage(dm, { ...context, providerLoads: {} }), null);
});
test("cache, Entry, ui mode, seed, resource lifetime, contention and rendering remain unclassified", () => {
  for (const message of ["Entry not found", "No service published for: uimode",
    "[ERROR:tile_manager.cc(982)] WARNING: tile memory limits exceeded, some content may not draw",
    "[ERROR:simple_index_file.cc(614)] Could not reconstruct index from disk",
    "[ERROR:variations_seed_loader.cc(37)] Seed missing signature.",
    "ApkAssets: Deleting an ApkAssets object", "Long monitor contention with owner EmojiCompatInitializer"])
    assert.equal(matchVolatileIdentityMessage(record({ message }), context), null);
});
