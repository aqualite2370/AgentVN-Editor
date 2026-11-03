"use strict";
// Executes the actual generated lifecycle methods on a JVM. Android's ART exit
// and HWUI behavior still require the separate uninstrumented APK regression.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const out = process.env.AGENTVN_MANAGED_EXIT_OUTPUT;
assert(out && !fs.existsSync(out), "Use a fresh explicit F:/AgentVN/QA output");
assert(path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "GENERATED_KOTLIN_JVM_LIFECYCLE_AND_RUST_WIRING_NOT_ANDROID_ACCEPTANCE", commands: [], cases: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function run(label, exe, args) {
  const r = spawnSync(exe, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 90000 });
  const log = path.join(out, label + ".log");
  fs.writeFileSync(log, (r.stdout || "") + "\n" + (r.stderr || ""));
  report.commands.push({ label, exe, args, code: r.status, error: r.error?.message, log }); save();
  return r;
}
function method(source, name) {
  const signature = new RegExp(`(?:override\\s+)?fun ${name}\\([^)]*\\)\\s*(?::\\s*\\w+\\s*)?\\{`).exec(source);
  assert(signature, `Generated MainActivity must implement ${name}`);
  const start = signature.index, open = source.indexOf("{", start);
  let depth = 1, at = open + 1;
  while (depth && at < source.length) {
    if (source[at] === "{") depth++;
    if (source[at] === "}") depth--;
    at++;
  }
  assert.equal(depth, 0);
  return source.slice(start, at);
}
function jar(group, name, version) {
  const base = path.join(process.env.USERPROFILE, ".gradle/caches/modules-2/files-2.1", group, name, version);
  assert(fs.existsSync(base), `Missing existing Kotlin compiler dependency: ${base}`);
  const files = fs.readdirSync(base).flatMap(hash => fs.readdirSync(path.join(base, hash))
    .filter(f => f === `${name}-${version}.jar`).map(f => path.join(base, hash, f)));
  assert.equal(files.length, 1); return files[0];
}
try {
  save();
  const harness = path.join(out, "generate-policy.ps1");
  const manifest = path.join(out, "AndroidManifest.xml"), activity = path.join(out, "MainActivity.kt");
  const gradle = path.join(out, "build.gradle.kts");
  fs.writeFileSync(manifest, '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".MainActivity"/></application></manifest>');
  fs.writeFileSync(activity, "package test\nclass MainActivity\n");
  fs.writeFileSync(gradle, "android {\n    kotlinOptions {\n        jvmTarget = \"1.8\"\n    }\n}\n");
  fs.writeFileSync(harness, `
$ErrorActionPreference = "Stop"
$taskTokens = $null
$taskErrors = $null
$taskAst = [System.Management.Automation.Language.Parser]::ParseFile(
  '${root.replaceAll("'", "''")}\\scripts\\build-runtime-standalone-android.ps1', [ref]$taskTokens, [ref]$taskErrors)
if ($taskErrors.Count) { throw "Build script parse failure" }
foreach ($taskName in @("Write-Utf8Atomic", "Add-Utf8Log", "Apply-AndroidRuntimePolicy")) {
  $taskFunction = $taskAst.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $taskName
  }, $true)
  if (-not $taskFunction) { throw "Missing policy function" }
  . ([scriptblock]::Create($taskFunction.Extent.Text))
}
$AndroidManifestPath = '${manifest.replaceAll("'", "''")}'
$AndroidMainActivityPath = '${activity.replaceAll("'", "''")}'
$AndroidGradlePath = '${gradle.replaceAll("'", "''")}'
$BuildLog = '${path.join(out, "policy.log").replaceAll("'", "''")}'
$ReleaseApplicationId = "com.agentvn.qa.lifecycle"
Apply-AndroidRuntimePolicy
Apply-AndroidRuntimePolicy
`);
  assert.equal(run("generate", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness]).status, 0);
  const source = fs.readFileSync(activity, "utf8");
  const finish = method(source, "finishConfirmedRuntime"), destroy = method(source, "onDestroy");
  assert.match(source, /private var confirmedRuntimeExit = false/);
  const java = path.join(process.env.LOCALAPPDATA, "AgentVN/AndroidToolchain/jdk-17/bin/java.exe");
  const stdlib = jar("org.jetbrains.kotlin", "kotlin-stdlib", "2.0.21");
  const compiler = [
    jar("org.jetbrains.kotlin", "kotlin-compiler-embeddable", "2.0.21"), stdlib,
    jar("org.jetbrains.kotlin", "kotlin-script-runtime", "2.0.21"),
    jar("org.jetbrains.kotlin", "kotlin-reflect", "1.6.10"),
    jar("org.jetbrains.intellij.deps", "trove4j", "1.0.20200330"),
    jar("org.jetbrains", "annotations", "13.0"),
    jar("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm", "1.6.4"),
  ];
  const fixture = path.join(out, "LifecycleUnderTest.kt"), classes = path.join(out, "classes");
  fs.writeFileSync(fixture, `
var nextId = 1
open class TauriActivity {
  var isFinishing = false
  var isChangingConfigurations = false
  var failFinish = false
  var failDestroy = false
  open fun onDestroy() {
    println("super-destroy")
    if (failDestroy) error("super destroy failure")
  }
  fun finish() {
    println("finish")
    if (failFinish) error("finish failure")
    isFinishing = true
  }
}
class MainActivity : TauriActivity() {
  companion object { var runtimeRestorationReady = true }
  val id = nextId++
  private var confirmedRuntimeExit = false
  private var runtimeWebView: WebView? = WebView()
  private var runtimeRestoreDialog: TestDialog? = null
  private fun runtimeActivityDestroyed(id: Int, changing: Boolean) {
    println("native-destroy:$id:$changing")
  }
  ${finish}
  ${destroy}
}
class TestDialog { fun dismiss() {} }
class ViewGroup { fun removeView(view: WebView) { println("webview-detached"); view.parent = null } }
class WebView {
  var parent: Any? = ViewGroup()
  fun destroy() { check(parent == null); println("webview-destroyed") }
}
fun main(args: Array<String>) {
  val a = MainActivity()
  when (args.single()) {
    "confirmed" -> { a.finishConfirmedRuntime(); a.onDestroy() }
    "unconfirmed" -> { a.isFinishing = true; a.onDestroy() }
    "configuration" -> { a.finishConfirmedRuntime(); a.isChangingConfigurations = true; a.onDestroy() }
    "not-finishing" -> { a.finishConfirmedRuntime(); a.isFinishing = false; a.onDestroy() }
    "finish-failure" -> {
      a.failFinish = true
      try { a.finishConfirmedRuntime() } catch (e: IllegalStateException) { println("finish-error") }
      a.isFinishing = true
      a.onDestroy()
    }
    "duplicate" -> { a.finishConfirmedRuntime(); a.finishConfirmedRuntime() }
    "destroy-failure" -> { a.finishConfirmedRuntime(); a.failDestroy = true; a.onDestroy() }
    "reopen-before-old-destroy" -> {
      a.finishConfirmedRuntime()
      val replacement = MainActivity()
      println("replacement-created")
      a.onDestroy()
      // Mirrors device13: the replacement exists before the old Activity's
      // delayed destruction. Old cleanup must not terminate its JVM/process.
      check(!replacement.isFinishing)
      println("replacement-usable")
    }
    "reopen-after-old-destroy" -> {
      a.finishConfirmedRuntime(); a.onDestroy()
      val replacement = MainActivity()
      check(!replacement.isFinishing)
      println("replacement-usable")
      replacement.finishConfirmedRuntime(); replacement.onDestroy()
    }
    "not-ready" -> {
      MainActivity.runtimeRestorationReady = false
      try { a.finishConfirmedRuntime(); error("must fail") }
      catch (e: IllegalStateException) { println("not-ready") }
      check(!a.isFinishing)
    }
    "finish-retry" -> {
      a.failFinish = true
      try { a.finishConfirmedRuntime() } catch (e: IllegalStateException) { println("finish-error") }
      a.failFinish = false
      a.finishConfirmedRuntime(); a.onDestroy()
    }
    else -> error("unknown case")
  }
  println("survived")
}
`);
  assert.equal(run("compile", java, ["-cp", compiler.join(path.delimiter),
    "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect",
    "-classpath", stdlib + path.delimiter + compiler[5], "-d", classes, fixture]).status, 0);
  const cases = {
    confirmed: ["finish", "super-destroy", "webview-detached", "webview-destroyed", "native-destroy:1:false", "survived"],
    unconfirmed: ["super-destroy", "webview-detached", "webview-destroyed", "native-destroy:1:false", "survived"],
    configuration: ["finish", "super-destroy", "native-destroy:1:true", "survived"],
    "not-finishing": ["finish", "super-destroy", "webview-detached", "webview-destroyed", "native-destroy:1:false", "survived"],
    "finish-failure": ["finish", "finish-error", "super-destroy", "webview-detached", "webview-destroyed", "native-destroy:1:false", "survived"],
    duplicate: ["finish", "survived"],
    "destroy-failure": ["finish", "super-destroy"],
    "reopen-before-old-destroy": ["finish", "replacement-created", "super-destroy", "webview-detached", "webview-destroyed", "native-destroy:1:false", "replacement-usable", "survived"],
    "reopen-after-old-destroy": ["finish", "super-destroy", "webview-detached", "webview-destroyed", "native-destroy:1:false", "replacement-usable", "finish", "super-destroy", "webview-detached", "webview-destroyed", "native-destroy:2:false", "survived"],
    "not-ready": ["not-ready", "survived"],
    "finish-retry": ["finish", "finish-error", "finish", "super-destroy", "webview-detached", "webview-destroyed", "native-destroy:1:false", "survived"],
  };
  for (const [name, lines] of Object.entries(cases)) {
    const r = run(name, java, ["-cp", classes + path.delimiter + stdlib, "LifecycleUnderTestKt", name]);
    const test = { name, status: "FAILED", expected: lines, actual: r.stdout.trim().split(/\r?\n/) };
    report.cases.push(test); save();
    assert.equal(r.status, name === "destroy-failure" ? 1 : 0, name);
    assert.deepEqual(test.actual, lines, name);
    test.status = "PASS"; test.lines = lines; save();
  }
  const rust = fs.readFileSync(path.join(root, "GameCli_framework/src-tauri/src/lib.rs"), "utf8");
  assert.match(rust, /call_method\(activity, "finishConfirmedRuntime", "\(\)V", &\[\]\)/,
    "confirmed JNI must authorize only the finishing Activity");
  assert.match(rust, /#\[cfg\(target_os = "android"\)\]\s*match _event\s*\{\s*tauri::RunEvent::ExitRequested \{ api, \.\. \} => api\.prevent_exit\(\)/,
    "Android must prevent Tao entering the unsafe C exit after last-window destroy");
  assert.match(rust, /\.build\(tauri::generate_context!\(\)\)\s*\.expect\([^;]+?\)\s*\.run\(/s);
  assert(!/\b(?:process::exit|_exit|killProcess)\s*\(/.test(rust));
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report)); }
