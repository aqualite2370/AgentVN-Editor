"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { inspectPluginBridge } = require("./android-runtime-lifecycle-dex-audit.cjs");
const base = "F:/AgentVN/QA/Android-Exit-20261024-01/lifecycle-dex-audit-07-01";
const broken = fs.readFileSync(path.join(base, "agentvn-classes.dex.txt"), "utf8");
const working = fs.readFileSync(path.join(base, "renpy-classes.dex.txt"), "utf8");
assert.throws(() => inspectPluginBridge(broken, "com.agentvn.qa.exitagentvn20261024"),
  /Required inherited JNI getter/, "The actual device15 failing APK must be rejected");
const actual = inspectPluginBridge(working, "com.agentvn.qa.exitrenpy20261024");
assert.equal(actual.method, "getPluginManager");
const fixture = `Class #0 -
 Class descriptor : 'Lcom/test/MainActivity;'
 Superclass : 'Lcom/test/TauriActivity;'
Class #1 -
 Class descriptor : 'Lcom/test/TauriActivity;'
    #0 :
      name : 'getPluginManager'
      type : '()Lapp/tauri/plugin/PluginManager;'
      access : 0x0011 (PUBLIC FINAL)
      insns size : 3 16-bit code units
Class #2 -
 Class descriptor : 'Lapp/tauri/plugin/PluginManager;'
`;
inspectPluginBridge(fixture, "com.test");
const mutations = [
  f => f.replace("name : 'getPluginManager'", "name : 'renamed'"),
  f => f.replace("type : '()Lapp/tauri/plugin/PluginManager;'", "type : '()V'"),
  f => f.replace("0x0011", "0x0019"),
  f => f.replace("0x0011", "0x0411"),
  f => f.replace("0x0011", "0x0111"),
  f => f.replace("size : 3", "size : 0"),
  f => f.replace("Superclass : 'Lcom/test/TauriActivity;'", "Superclass : 'Ljava/lang/Object;'"),
];
mutations.forEach(change => assert.throws(() => inspectPluginBridge(change(fixture), "com.test")));
console.log(JSON.stringify({ status: "PASS", realApkCases: 2, invalidFixturesRejected: mutations.length,
  scope: "QA_RELEASE_DEX_BRIDGE_VALIDATOR_NOT_DEVICE_ACCEPTANCE" }));
