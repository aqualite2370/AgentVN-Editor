"use strict";
// Runs the exact shipped Gradle transform, then executes its real generated
// lifecycle methods against typed Activity/launcher/plugin doubles on a JVM.
// This proves ownership, not Android's real launcher or native WebView.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = process.env.AGENTVN_PLUGIN_REBIND_OUTPUT;
assert(out && path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const source = path.join(process.env.LOCALAPPDATA, "AgentVN/AndroidToolchain/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.2/mobile/android/src/main/java/app/tauri/plugin/PluginManager.kt");
const helper = path.join(root, "scripts/android-runtime-activity.gradle");
const r = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_SHIPPED_PLUGIN_TRANSFORM_JVM_DOUBLES_NOT_ANDROID_ACCEPTANCE",
  sources: [source, helper].map(f => ({ path: f, sha256: sha(f) })), commands: [], cases: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
function run(label, exe, args, expected = 0) {
  const v = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: "utf8", timeout: 90000 });
  fs.writeFileSync(path.join(out, label + ".log"), (v.stdout || "") + "\n" + (v.stderr || ""));
  r.commands.push({ label, exe, args, exitCode: v.status, error: v.error?.message }); save();
  assert.equal(v.status, expected, label); return v.stdout;
}
function method(text, name) {
  const start = text.indexOf("  fun " + name + "(");
  assert(start >= 0, name);
  const open = text.indexOf("{", start);
  let at = open + 1, depth = 1;
  while (depth && at < text.length) { if (text[at] === "{") depth++; if (text[at] === "}") depth--; at++; }
  assert.equal(depth, 0); return text.slice(start, at);
}
try {
  save();
  const javaHome = path.join(process.env.LOCALAPPDATA, "AgentVN/AndroidToolchain/jdk-17");
  const java = path.join(javaHome, "bin/java.exe");
  const groovyLib = path.join(process.env.LOCALAPPDATA, "AgentVN/GradleHome/wrapper/dists/gradle-8.14.3-bin/7cldbgy1rszq3xl6tk64vwdm4/gradle-8.14.3/lib");
  const driver = path.join(out, "transform.groovy"), generated = path.join(out, "AgentVNPluginManager.kt");
  fs.writeFileSync(driver, `
def script = new GroovyShell().parse(new File(args[0]))
script.run()
def source = new File(args[1]).getText("UTF-8")
new File(args[2]).setText(script.agentvnPluginManager(source), "UTF-8")
`);
  const args = ["-cp", [path.join(groovyLib, "groovy-3.0.24.jar"), path.join(groovyLib, "groovy-json-3.0.24.jar")].join(path.delimiter),
    "groovy.ui.GroovyMain", driver, helper, source, generated];
  run("transform", java, args);
  const malformed = path.join(out, "unsupported.kt");
  fs.writeFileSync(malformed, fs.readFileSync(source, "utf8") + "\n// unreviewed version\n");
  const badArgs = [...args]; badArgs[badArgs.length - 2] = malformed;
  run("reject-unreviewed-upstream", java, badArgs, 1);
  const negative = process.env.AGENTVN_PLUGIN_REBIND_NEGATIVE === "1";
  r.fixture = negative ? "UNCHANGED_UPSTREAM_NEGATIVE" : "ACTUAL_SHIPPED_TRANSFORM";
  const text = fs.readFileSync(negative ? source : generated, "utf8");
  const fixture = path.join(out, "PluginRebind.kt");
  const activity = path.join(out, "Activity.kt");
  fs.writeFileSync(activity, `package android.app\nopen class Activity(val label: String)\n`);
  fs.writeFileSync(fixture, `
import android.app.Activity
class Intent
class IntentSenderRequest
class ActivityResult(val label: String)
class WebView(val label: String)
class Contract<I, O>
class ActivityResultLauncher<I>(val owner: AppCompatActivity, val index: Int) {
  fun launch(input: I) { owner.launches.add(index) }
}
object ActivityResultContracts {
  fun StartActivityForResult() = Contract<Intent, ActivityResult>()
  fun StartIntentSenderForResult() = Contract<IntentSenderRequest, ActivityResult>()
  fun RequestMultiplePermissions() = Contract<Array<String>, Map<String, Boolean>>()
}
open class AppCompatActivity(label: String): Activity(label) {
  val callbacks = mutableListOf<(Any) -> Unit>()
  val launches = mutableListOf<Int>()
  fun <I, O> registerForActivityResult(contract: Contract<I, O>, callback: (O) -> Unit): ActivityResultLauncher<I> {
    val index = callbacks.size
    @Suppress("UNCHECKED_CAST")
    callbacks.add { value -> callback(value as O) }
    return ActivityResultLauncher(this, index)
  }
}
open class Plugin(val owner: Activity) {
  val destroyed = mutableListOf<Activity>()
  var loads = 0
  open fun triggerOnDestroy(activity: AppCompatActivity) { destroyed.add(activity) }
  fun load(view: WebView) { loads++ }
}
class GoodPlugin(activity: Activity): Plugin(activity)
class BadPlugin(activity: Activity): Plugin(activity) {
  companion object { var fail = false }
  init { check(!fail) { "constructor-failed" } }
}
class PluginHandle(manager: PluginManager, val name: String, val instance: Plugin,
  val config: String, val jsonMapper: Any) {
  var loaded = false
  fun load(view: WebView) { instance.load(view); loaded = true }
}
object PluginManager {
  fun interface RequestPermissionsCallback { fun onResult(permissions: Map<String, Boolean>) }
  fun interface ActivityResultCallback { fun onResult(result: ActivityResult) }
  lateinit var activity: AppCompatActivity
  private val plugins = hashMapOf<String, PluginHandle>()
  private var destroyedActivity: AppCompatActivity? = null
  private lateinit var startActivityForResultLauncher: ActivityResultLauncher<Intent>
  private lateinit var startIntentSenderForResultLauncher: ActivityResultLauncher<IntentSenderRequest>
  private lateinit var requestPermissionsLauncher: ActivityResultLauncher<Array<String>>
  private var requestPermissionsCallback: RequestPermissionsCallback? = null
  private var startActivityForResultCallback: ActivityResultCallback? = null
  private var startIntentSenderForResultCallback: ActivityResultCallback? = null
  ${["onActivityCreate", "onDestroy", "onWebViewCreated", "startActivityForResult", "startIntentSenderForResult", "requestPermissions"].map(n => method(text, n)).join("\n")}
  fun seed(name: String, plugin: Plugin): PluginHandle {
    val handle = PluginHandle(this, name, plugin, "config-" + name, Any())
    plugins[name] = handle
    return handle
  }
  fun get(name: String) = plugins.getValue(name)
}
fun pass(name: String) { println("PASS:" + name) }
fun main() {
  val a = AppCompatActivity("A")
  PluginManager.onActivityCreate(a)
  PluginManager.onActivityCreate(a)
  check(a.callbacks.size == 3)
  pass("same-instance-does-not-register-twice")
  val original = PluginManager.seed("dialog", GoodPlugin(a))
  PluginManager.onWebViewCreated(WebView("A"))
  var oldResult = 0
  PluginManager.startActivityForResult(Intent()) { oldResult++ }
  val b = AppCompatActivity("B")
  PluginManager.onActivityCreate(b)
  val replacement = PluginManager.get("dialog")
  check(replacement !== original && replacement.instance.owner === b)
  check(replacement.name == original.name && replacement.config == original.config && replacement.jsonMapper === original.jsonMapper)
  check(original.instance.destroyed == listOf(a))
  check(b.callbacks.size == 3 && !replacement.loaded)
  pass("replacement-before-old-destroy-recreates-plugins-and-launchers")
  PluginManager.onDestroy(a)
  check(replacement.instance.destroyed.isEmpty())
  pass("late-old-destroy-cannot-destroy-replacement")
  var newResult = 0
  PluginManager.startActivityForResult(Intent()) { newResult++ }
  a.callbacks[0](ActivityResult("late"))
  check(oldResult == 0 && newResult == 0)
  b.callbacks[0](ActivityResult("new"))
  check(newResult == 1 && b.launches == listOf(0))
  pass("old-result-cannot-complete-new-request")
  var sender = 0; var permissions = 0
  PluginManager.startIntentSenderForResult(IntentSenderRequest()) { sender++ }
  PluginManager.requestPermissions(arrayOf("p")) { permissions++ }
  a.callbacks[1](ActivityResult("old")); a.callbacks[2](mapOf("p" to true))
  check(sender == 0 && permissions == 0)
  b.callbacks[1](ActivityResult("new")); b.callbacks[2](mapOf("p" to true))
  check(sender == 1 && permissions == 1 && b.launches == listOf(0, 1, 2))
  pass("sender-and-permission-callbacks-belong-to-current-activity")
  PluginManager.onWebViewCreated(WebView("B"))
  PluginManager.onWebViewCreated(WebView("B"))
  check(replacement.loaded && replacement.instance.loads == 1)
  pass("replacement-plugins-load-on-real-webview-once")
  PluginManager.onDestroy(b); PluginManager.onDestroy(b)
  check(replacement.instance.destroyed == listOf(b))
  b.callbacks[0](ActivityResult("after-destroy"))
  check(newResult == 1)
  val c = AppCompatActivity("C")
  PluginManager.onActivityCreate(c)
  check(PluginManager.get("dialog").instance.owner === c)
  check(replacement.instance.destroyed == listOf(b))
  pass("destroy-before-reopen-cleans-once")
  val stable = PluginManager.seed("bad", BadPlugin(c))
  BadPlugin.fail = true
  val d = AppCompatActivity("D")
  try { PluginManager.onActivityCreate(d); error("must reject failed constructor") }
  catch (e: java.lang.reflect.InvocationTargetException) {}
  check(PluginManager.activity === c && PluginManager.get("bad") === stable)
  check(stable.instance.destroyed.isEmpty() && d.callbacks.isEmpty())
  pass("failed-constructor-does-not-partially-commit")
}
`);
  const lifecycle = path.join(out, "generated-lifecycle");
  const generation = spawnSync(process.execPath, ["scripts/android-managed-exit-test.cjs"], {
    cwd: root, env: { ...process.env, AGENTVN_MANAGED_EXIT_OUTPUT: lifecycle },
    windowsHide: true, encoding: "utf8", timeout: 90000,
  });
  fs.writeFileSync(path.join(out, "lifecycle.log"), (generation.stdout || "") + "\n" + (generation.stderr || ""));
  assert.equal(generation.status, 0, "Fresh actual lifecycle compiler fixture");
  const prior = JSON.parse(fs.readFileSync(path.join(lifecycle, "report.json")));
  assert.equal(prior.status, "PASS");
  const compilerArgs = [...prior.commands.find(c => c.label === "compile").args];
  const classes = path.join(out, "classes"), di = compilerArgs.indexOf("-d");
  compilerArgs[di + 1] = classes; compilerArgs.splice(di + 2, 1, fixture, activity);
  run("compile", java, compilerArgs);
  const cp = compilerArgs[compilerArgs.indexOf("-classpath") + 1];
  const result = run("test", java, ["-cp", classes + path.delimiter + cp, "PluginRebindKt"]);
  r.cases = result.trim().split(/\r?\n/).map(line => { assert.match(line, /^PASS:/); return { name: line.slice(5), status: "PASS" }; });
  assert.equal(r.cases.length, 8);
  assert.equal(sha(source), r.sources[0].sha256, "Global Cargo registry source must remain unchanged");
  r.generated = { path: generated, sha256: sha(generated) }; r.status = "PASS";
} catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, cases: r.cases.length, error: r.error })); }
