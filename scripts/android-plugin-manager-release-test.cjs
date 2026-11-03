"use strict";
// Actual production-generated rules + pinned R8 + inherited JNI lookup.
// No APK build/device, global registry changes, or model calls.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const out = process.env.AGENTVN_PLUGIN_RELEASE_OUTPUT, root = path.resolve(__dirname, "..");
assert(out && path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const r = { status: "RUNNING", startedAt: new Date().toISOString(), commands: [], cases: [],
  scope: "PINNED_R8_INHERITED_NATIVE_LOOKUP_NOT_APK_OR_DEVICE_ACCEPTANCE",
  sources: [__filename, path.join(root, "scripts/build-runtime-standalone-android.ps1")].map(fileEvidence) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
function command(label, exe, args, env = {}, requireSuccess = true) {
  const result = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: "utf8",
    env: { ...process.env, ...env, TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") }, timeout: 90000 });
  const log = path.join(out, label + ".log");
  fs.writeFileSync(log, (result.stdout || "") + "\n" + (result.stderr || ""), { flag: "wx" });
  r.commands.push({ label, exe, args, status: result.status, log: fileEvidence(log) }); save();
  if (requireSuccess) assert.equal(result.status, 0, log);
  return result;
}
try {
  fs.mkdirSync(path.join(out, "temporary")); save();
  const generated = path.join(out, "generated");
  command("production-policy", process.execPath, ["scripts/android-managed-exit-test.cjs"],
    { AGENTVN_MANAGED_EXIT_OUTPUT: generated });
  const policy = path.join(generated, "proguard-agentvn-runtime.pro"), rules = fs.readFileSync(policy, "utf8");
  const report = JSON.parse(fs.readFileSync(path.join(generated, "report.json"), "utf8"));
  assert.equal(report.status, "PASS"); r.policy = fileEvidence(policy);
  const upstream = path.join(process.env.LOCALAPPDATA,
    "AgentVN/AndroidToolchain/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.2/mobile/android-codegen/TauriActivity.kt");
  const source = fs.readFileSync(upstream, "utf8");
  const getter = source.match(/  fun getPluginManager\(\): PluginManager \{\s+return PluginManager\s+\}/)?.[0];
  assert(getter); r.upstream = fileEvidence(upstream);
  const javaHome = path.join(process.env.LOCALAPPDATA, "AgentVN/AndroidToolchain/jdk-17");
  const java = path.join(javaHome, "bin/java.exe");
  const gradleHome = process.env.GRADLE_USER_HOME || path.join(process.env.LOCALAPPDATA, "AgentVN/GradleHome");
  const builder = path.join(gradleHome, "caches/modules-2/files-2.1/com.android.tools.build/builder/8.11.0");
  const jars = fs.readdirSync(builder).flatMap(d => fs.readdirSync(path.join(builder, d))
    .filter(f => f === "builder-8.11.0.jar").map(f => path.join(builder, d, f)));
  assert.equal(jars.length, 1);
  assert.match(command("r8-version", java, ["-cp", jars[0], "com.android.tools.r8.R8", "--version"]).stdout, /^R8 8\.11\.18\b/);
  const manager = path.join(out, "Manager.kt"), activity = path.join(out, "Activity.kt"), classes = path.join(out, "classes");
  fs.writeFileSync(manager, "package app.tauri.plugin\nobject PluginManager\n");
  fs.writeFileSync(activity, `package com.agentvn.qa.lifecycle
import app.tauri.plugin.PluginManager
open class TauriActivity {
${getter}
}
class MainActivity : TauriActivity()
object NativeLookupProbe {
  @JvmStatic fun main(args: Array<String>) {
    val activity = Class.forName(args[0]).getConstructor().newInstance()
    val method = activity.javaClass.getMethod(args[1])
    check(method.returnType.name == "app.tauri.plugin.PluginManager")
    check(method.invoke(activity) === PluginManager)
    println("NATIVE_LOOKUP_OK")
  }
}
`);
  const compile = report.commands.find(c => c.label === "compile"), args = [...compile.args];
  const di = args.indexOf("-d");
  args.splice(di + 1, args.length - di - 1, classes, manager, activity);
  const classpath = args[args.indexOf("-classpath") + 1];
  const stdlib = classpath.split(path.delimiter).find(f => /kotlin-stdlib-[\d.]+\.jar$/.test(f)); assert(stdlib);
  command("compile-inherited-getter", java, args);
  const archive = path.join(out, "input.jar");
  command("archive", path.join(javaHome, "bin/jar.exe"), ["cf", archive, "-C", classes, "."]);
  for (const keep of [false, true]) {
    const name = keep ? "generated-rules" : "negative-stale-upstream-rule";
    const rulesFile = path.join(out, name + ".pro"), output = path.join(out, name + ".jar");
    fs.writeFileSync(rulesFile, `
-keep class com.agentvn.qa.lifecycle.MainActivity { public <init>(); }
-keep class com.agentvn.qa.lifecycle.NativeLookupProbe { public static void main(java.lang.String[]); }
-keep class app.tauri.plugin.PluginManager { *; }
-keep class stale.previous.release.TauriActivity { public app.tauri.plugin.PluginManager getPluginManager(); }
-dontwarn org.jetbrains.annotations.**
${keep ? rules : ""}
`);
    command(name + "-r8", java, ["-cp", jars[0], "com.android.tools.r8.R8", "--classfile", "--release",
      "--lib", javaHome, "--lib", stdlib, "--pg-conf", rulesFile, "--output", output, archive]);
    const result = command(name + "-lookup", java, ["-cp", output + path.delimiter + stdlib,
      "com.agentvn.qa.lifecycle.NativeLookupProbe", "com.agentvn.qa.lifecycle.MainActivity", "getPluginManager"], {}, false);
    const c = { name, status: "RUNNING", lookupExitCode: result.status }; r.cases.push(c); save();
    if (keep) { assert.equal(result.status, 0, "Actual generated rules must protect the inherited JNI getter");
      assert.match(result.stdout, /NATIVE_LOOKUP_OK/); }
    else { assert.notEqual(result.status, 0); assert.match(result.stderr, /NoSuchMethodException/); }
    c.status = "PASS"; save();
  }
  r.status = "PASS";
} catch (error) { r.status = "FAILED"; r.error = String(error.stack || error); process.exitCode = 1; }
finally {
  for (const source of r.sources) {
    if (fileEvidence(source.path).sha256 !== source.sha256) {
      r.status = "FAILED"; r.error = "Source changed during R8 regression: " + source.path; process.exitCode = 1;
    }
  }
  r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, error: r.error }));
}
