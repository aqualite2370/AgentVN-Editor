"use strict";
// Real Gradle settings/project callbacks and SourceDirectorySet; the Kotlin
// plugin is a typed marker, not an Android build or Kotlin compilation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const root = path.resolve(__dirname, ".."), out = process.env.AGENTVN_GRADLE_INTEGRATION_OUTPUT;
assert(out && path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\"));
assert(!fs.existsSync(out), "Preserve existing failure evidence");
fs.mkdirSync(out);
const helper = path.join(root, "scripts/android-runtime-activity.gradle");
const upstream = path.join(process.env.LOCALAPPDATA,
  "AgentVN/AndroidToolchain/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.2/mobile/android/src/main/java/app/tauri/plugin/PluginManager.kt");
const java = path.join(process.env.LOCALAPPDATA, "AgentVN/AndroidToolchain/jdk-17/bin/java.exe");
const launcher = path.join(process.env.LOCALAPPDATA,
  "AgentVN/GradleHome/wrapper/dists/gradle-8.14.3-bin/7cldbgy1rszq3xl6tk64vwdm4/gradle-8.14.3/lib/gradle-launcher-8.14.3.jar");
const r = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REAL_GRADLE_CALLBACK_AND_SOURCE_CONFIGURATION_WITH_MARKER_PLUGIN_NOT_ANDROID_COMPILATION",
  sources: [__filename, helper, upstream, java, launcher].map(fileEvidence), modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
async function main() {
  save();
  const module = path.join(out, "tauri-android");
  fs.mkdirSync(path.join(module, "src/main/java/app/tauri/plugin"), { recursive: true });
  fs.copyFileSync(upstream, path.join(module, "src/main/java/app/tauri/plugin/PluginManager.kt"));
  const marker = new JSZip();
  marker.file("META-INF/gradle-plugins/org.jetbrains.kotlin.android.properties",
    "implementation-class=org.gradle.api.plugins.JavaPlugin\n");
  fs.writeFileSync(path.join(out, "marker-plugin.jar"),
    await marker.generateAsync({ type: "nodebuffer", compression: "STORE" }));
  fs.writeFileSync(path.join(out, "settings.gradle"), `
rootProject.name = 'agentvn-helper-integration'
include ':tauri-android'
apply from: '${helper.replaceAll("\\", "/")}'
`);
  fs.writeFileSync(path.join(module, "build.gradle"), `
buildscript { dependencies { classpath files('../marker-plugin.jar') } }
def kotlinFiles = objects.sourceDirectorySet('testKotlin', 'Actual Gradle source set')
kotlinFiles.srcDir('src/main/java')
def javaFiles = objects.sourceDirectorySet('testJava', 'Actual Gradle source set')
javaFiles.srcDir('src/main/java')
def androidJava = new Expando(sourceFiles: javaFiles,
  exclude: { String pattern -> javaFiles.exclude(pattern) },
  srcDir: { Object directory -> javaFiles.srcDir(directory) })
extensions.add('kotlin', new Expando(sourceSets: new Expando(
  getByName: { String name -> assert name == 'main'; new Expando(kotlin: kotlinFiles) })))
extensions.add('android', new Expando(sourceSets: new Expando(
  getByName: { String name -> assert name == 'main'; new Expando(java: androidJava) })))
apply plugin: 'org.jetbrains.kotlin.android'
`);
  fs.writeFileSync(path.join(out, "build.gradle"), `
tasks.register('verifyAgentvnHelper') {
  doLast {
    def proof = file('agentvn-runtime/plugin-manager-source.json')
    assert proof.isFile() : 'Actual settings apply did not install the PluginManager replacement'
    def data = new groovy.json.JsonSlurper().parse(proof)
    assert data.declared.size() == 1
    assert data.declared[0].endsWith('AgentVNPluginManager.kt')
    assert new File(data.generated).isFile()
  }
}
`);
  const args = ["-cp", launcher, "org.gradle.launcher.GradleMain", "--offline", "--no-daemon",
    "--console", "plain", "--gradle-user-home", path.join(out, "gradle-home"),
    "--project-cache-dir", path.join(out, "project-cache"), "--project-dir", out, "verifyAgentvnHelper"];
  const result = spawnSync(java, args, { cwd: out, windowsHide: true, encoding: "utf8", timeout: 60000 });
  const log = path.join(out, "gradle.log");
  fs.writeFileSync(log, (result.stdout || "") + "\n" + (result.stderr || ""), { flag: "wx" });
  r.command = { exe: java, args, exitCode: result.status, error: result.error?.message, log: fileEvidence(log) };
  save();
  assert.equal(result.status, 0, log);
  const proof = path.join(out, "agentvn-runtime/plugin-manager-source.json"), p = read(proof);
  assert.equal(fileEvidence(p.source).sha256, p.sourceSha256);
  assert.equal(fileEvidence(p.generated).sha256, p.generatedSha256);
  assert.equal(p.sourceSha256, fileEvidence(upstream).sha256);
  assert.deepEqual(p.declared, [p.generated]);
  r.proof = fileEvidence(proof);
  const negative = path.join(out, "missing-project");
  fs.mkdirSync(negative);
  fs.writeFileSync(path.join(negative, "settings.gradle"),
    `rootProject.name = 'agentvn-missing-project'\napply from: '${helper.replaceAll("\\", "/")}'\n`);
  fs.writeFileSync(path.join(negative, "build.gradle"), "");
  const badArgs = [...args];
  badArgs[badArgs.indexOf("--project-dir") + 1] = negative;
  badArgs[badArgs.length - 1] = "help";
  const rejected = spawnSync(java, badArgs,
    { cwd: negative, windowsHide: true, encoding: "utf8", timeout: 60000 });
  const rejectedLog = path.join(out, "missing-project.log");
  fs.writeFileSync(rejectedLog, (rejected.stdout || "") + "\n" + (rejected.stderr || ""), { flag: "wx" });
  r.missingProject = { exitCode: rejected.status, log: fileEvidence(rejectedLog) };
  save();
  assert.equal(rejected.status, 1, "Missing Runtime plugin configuration must fail the build");
  assert.match(fs.readFileSync(rejectedLog, "utf8"), /ANDROID_ACTIVITY_RESTORATION_NOT_CONFIGURED/);
  r.cases = 2;
  r.status = "PASS";
}
main().catch(e => { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => {
    for (const f of r.sources) assert.equal(fileEvidence(f.path).sha256, f.sha256);
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error }));
  });
