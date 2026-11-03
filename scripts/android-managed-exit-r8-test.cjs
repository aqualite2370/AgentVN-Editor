"use strict";
// Actual release R8 on production-generated lifecycle methods and keep rules.
// JVM/optimizer scope only; native ART/HWUI still need real APK acceptance.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), out = process.env.AGENTVN_MANAGED_R8_OUTPUT;
assert(out && path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\"));
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const r = { status: "RUNNING", startedAt: new Date().toISOString(), commands: [],
  scope: "ACTUAL_RELEASE_R8_GENERATED_JNI_ENTRYPOINT_NOT_ANDROID_ACCEPTANCE" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
function run(label, exe, args, env = {}) {
  const result = spawnSync(exe, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true,
    encoding: "utf8", timeout: 90000 });
  fs.writeFileSync(path.join(out, label + ".log"), (result.stdout || "") + "\n" + (result.stderr || ""));
  r.commands.push({ label, exe, args, exitCode: result.status, error: result.error?.message }); save();
  assert.equal(result.status, 0, path.join(out, label + ".log"));
  return result.stdout;
}
try {
  save();
  const generated = path.join(out, "generated");
  run("generate-and-jvm", process.execPath, ["scripts/android-managed-exit-test.cjs"], {
    AGENTVN_MANAGED_EXIT_OUTPUT: generated,
  });
  const actualRulesPath = path.join(generated, "proguard-agentvn-runtime.pro");
  assert(fs.existsSync(actualRulesPath), "Generated release rules must preserve the JNI-only exit method");
  const actualRules = fs.readFileSync(actualRulesPath, "utf8");
  assert.match(actualRules, /-keepclassmembers class com\.agentvn\.qa\.lifecycle\.MainActivity\s*\{/);
  for (const signature of ["public void finishConfirmedRuntime();", "public void enableRuntimeRestoration();",
    "public void showRuntimeRestoreError(java.lang.String);", "private native boolean runtimeActivityCreated(int);",
    "private native void runtimeActivityDestroyed(int, boolean);"]) assert(actualRules.includes(signature), signature);
  // Only the fixture's package differs. Rule text and method signature come
  // from the real policy generator, not a duplicated positive keep rule.
  const rules = actualRules.replaceAll("com.agentvn.qa.lifecycle.MainActivity", "MainActivity");
  const gradleHome = process.env.GRADLE_USER_HOME || path.join(process.env.LOCALAPPDATA, "AgentVN/GradleHome");
  const builder = path.join(gradleHome, "caches/modules-2/files-2.1/com.android.tools.build/builder/8.11.0");
  const jars = fs.readdirSync(builder).flatMap(h => fs.readdirSync(path.join(builder, h))
    .filter(n => n === "builder-8.11.0.jar").map(n => path.join(builder, h, n)));
  assert.equal(jars.length, 1);
  const javaHome = path.join(process.env.LOCALAPPDATA, "AgentVN/AndroidToolchain/jdk-17");
  const generatedReport = JSON.parse(fs.readFileSync(path.join(generated, "report.json")));
  assert.equal(generatedReport.status, "PASS"); assert.equal(generatedReport.cases.length, 11);
  const compile = generatedReport.commands.find(c => c.label === "compile");
  const classpath = compile.args[compile.args.indexOf("-classpath") + 1];
  const stdlib = classpath.split(path.delimiter).find(f => /kotlin-stdlib-[\d.]+\.jar$/.test(f));
  assert(stdlib);
  // Keep the generated method bodies. Only Android framework primitives are
  // doubles; unlike the behavior JVM, JNI callbacks retain their actual
  // external signatures so the optimizer must preserve native registration.
  const source = fs.readFileSync(path.join(generated, "MainActivity.kt"), "utf8");
  function method(name) {
    const start = source.indexOf("  fun " + name + "(");
    assert(start >= 0); const open = source.indexOf("{", start);
    let at = open + 1, depth = 1;
    while (depth && at < source.length) { if (source[at] === "{") depth++; if (source[at] === "}") depth--; at++; }
    assert.equal(depth, 0); return source.slice(start, at);
  }
  let fixture = fs.readFileSync(path.join(generated, "LifecycleUnderTest.kt"), "utf8");
  fixture = fixture.replace(/  private fun runtimeActivityDestroyed\(id: Int, changing: Boolean\) \{[\s\S]*?\n  \}/,
    `  private external fun runtimeActivityDestroyed(id: Int, changingConfiguration: Boolean)
  private external fun runtimeActivityCreated(id: Int): Boolean
  private fun requestRuntimeRestoration() { runtimeActivityCreated(id) }
  fun runOnUiThread(action: () -> Unit) { action() }
  val isDestroyed = false
  ${method("enableRuntimeRestoration")}
  ${method("showRuntimeRestoreError")}`);
  fixture = fixture.replace("private var runtimeRestoreDialog: TestDialog?", "private var runtimeRestoreDialog: AlertDialog?");
  fixture += `
class AlertDialog {
  val isShowing = false
  fun dismiss() {}
  class Builder(owner: Any) {
    fun setTitle(value: String) = this
    fun setMessage(value: String) = this
    fun setCancelable(value: Boolean) = this
    fun setPositiveButton(value: String, action: (Any?, Any?) -> Unit) = this
    fun setNegativeButton(value: String, action: (Any?, Any?) -> Unit) = this
    fun show() = AlertDialog()
  }
}
`;
  const optimizerSource = path.join(out, "OptimizerLifecycle.kt"), optimizerClasses = path.join(out, "optimizer-classes");
  fs.writeFileSync(optimizerSource, fixture);
  const compileArgs = [...compile.args], di = compileArgs.indexOf("-d");
  compileArgs[di + 1] = optimizerClasses; compileArgs[di + 2] = optimizerSource;
  run("compile-native-signatures", path.join(javaHome, "bin/java.exe"), compileArgs);
  const archive = path.join(out, "input.jar");
  run("archive", path.join(javaHome, "bin/jar.exe"), ["cf", archive, "-C", optimizerClasses, "."]);
  r.compilerVersion = run("r8-version", path.join(javaHome, "bin/java.exe"),
    ["-cp", jars[0], "com.android.tools.r8.R8", "--version"]).trim();
  assert.match(r.compilerVersion, /^R8 8\.11\.18\b/);
  r.cases = [];
  for (const keep of [false, true]) {
    const name = keep ? "generated-keep" : "negative-no-keep", rulesFile = path.join(out, name + ".pro");
    fs.writeFileSync(rulesFile, `-keep class MainActivity { public <init>(); public void onDestroy(); }
-keep class * { native <methods>; }
-dontwarn org.jetbrains.annotations.**
${keep ? rules : ""}
`);
    const output = path.join(out, name + ".jar");
    run(name, path.join(javaHome, "bin/java.exe"), ["-cp", jars[0], "com.android.tools.r8.R8",
      "--classfile", "--release", "--lib", javaHome, "--lib", stdlib,
      "--pg-conf", rulesFile, "--output", output, archive]);
    const javap = run(name + "-javap", path.join(javaHome, "bin/javap.exe"), ["-p", "-classpath", output, "MainActivity"]);
    const methodRetained = /public final void finishConfirmedRuntime\(\)/.test(javap);
    assert.equal(methodRetained, keep, "JNI method reachability must be protected by actual generated rules");
    const enableRetained = /public final void enableRuntimeRestoration\(\)/.test(javap);
    const errorRetained = /public final void showRuntimeRestoreError\(java.lang.String\)/.test(javap);
    assert.equal(enableRetained, keep); assert.equal(errorRetained, keep);
    assert.match(javap, /private final native boolean runtimeActivityCreated\(int\)/);
    assert.match(javap, /private final native void runtimeActivityDestroyed\(int, boolean\)/);
    r.cases.push({ name, methodRetained, enableRetained, errorRetained, status: "PASS" }); save();
  }
  r.status = "PASS";
} catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, error: r.error })); }
