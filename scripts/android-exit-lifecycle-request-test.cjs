"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { validateRequest } = require("./android-exit-device.cjs");
const q = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Android-Exit-20261024-01/device-05/request.json", "utf8"));
q.tools = q.tools.map(f => fileEvidence(f.path));
assert.doesNotThrow(() => validateRequest(q));
const diagnostic = { ...q, scope: "SOURCE_APK_BOUNDED_NATIVE_LIFECYCLE_DIAGNOSTIC",
  lifecycleDebugger: { mode: "lifecycle-exit", plan: "close-without-reopen",
    ndk: "C:\\Users\\1\\AppData\\Local\\AgentVN\\AndroidToolchain\\Sdk\\ndk\\27.2.12479018",
    localPort: 61991, remotePort: 38471 } };
assert.doesNotThrow(() => validateRequest(diagnostic));
for (const change of [
  v => { v.scope = q.scope; },
  v => { delete v.lifecycleDebugger; },
  v => { v.lifecycleDebugger.plan = "force-stop"; },
  v => { v.lifecycleDebugger.localPort = q.adbPort; },
  v => { v.lifecycleDebugger.mode = "cache"; },
  v => { v.lifecycleDebugger.ndk = path.dirname(v.lifecycleDebugger.ndk); },
]) {
  const bad = structuredClone(diagnostic); change(bad); assert.throws(() => validateRequest(bad));
}
assert.throws(() => validateRequest({ ...q, lifecycleDebugger: diagnostic.lifecycleDebugger }));
console.log("android-exit-lifecycle-request: PASS (separate attribution scope, exact plan/toolchain, port isolation, zero ADB/model)");
