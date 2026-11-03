"use strict";
// Real pinned Android/Kotlin Gradle plugins and real Kotlin compilation.
// No APK, Rust build, device, model request or global registry mutation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const root = path.resolve(__dirname, "..");
const out = process.env.AGENTVN_AGP_INTEGRATION_OUTPUT;
assert(out && path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\"));
assert(!fs.existsSync(out), "Never overwrite failed evidence");
const local = process.env.LOCALAPPDATA;
const toolchain = path.join(local, "AgentVN/AndroidToolchain");
const gradleHome = path.join(local, "AgentVN/GradleHome");
const java = path.join(toolchain, "jdk-17/bin/java.exe");
const javap = path.join(toolchain, "jdk-17/bin/javap.exe");
const launcher = path.join(gradleHome,
  "wrapper/dists/gradle-8.14.3-bin/7cldbgy1rszq3xl6tk64vwdm4/gradle-8.14.3/lib/gradle-launcher-8.14.3.jar");
const upstream = path.join(toolchain,
  "cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.2/mobile/android");
const helper = path.join(root, "scripts/android-runtime-activity.gradle");
const withApp = process.argv.includes("--app");
assert(process.argv.slice(2).every(arg => arg === "--app"), "Unknown regression option");
const appPackage = "com.agentvn.qa.codegen";
fs.mkdirSync(out);
const r = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REAL_AGP_8_11_KOTLIN_1_9_25_SOURCE_CONFIGURATION_AND_KOTLIN_COMPILE_NOT_APK_OR_DEVICE",
  sources: [__filename, helper, java, launcher], upstream: [], commands: [], cases: [],
  modelRequests: 0, globalRegistryChanges: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
async function command(label, exe, args, expectedExit = 0) {
  const c = { label, exe, args, startedAt: new Date().toISOString(), status: "RUNNING",
    log: path.join(out, label + ".log") };
  const fd = fs.openSync(c.log, "wx");
  r.commands.push(c); save();
  try {
    const child = spawn(exe, args, { cwd: out, windowsHide: true, env: { ...process.env,
      TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") }, stdio: ["ignore", fd, fd] });
    c.pid = child.pid; save();
    c.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    c.expectedExit = expectedExit;
    assert.equal(c.exitCode, expectedExit, c.log);
    c.status = "PASS";
  } catch (e) { c.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
}
async function main() {
  const module = path.join(out, "tauri-android");
  fs.cpSync(upstream, module, { recursive: true, errorOnExist: true, force: false, filter: f => {
    if (f !== upstream && ["build", ".gradle", ".kotlin"].includes(path.basename(f))) return false;
    const info = fs.lstatSync(f);
    assert(!info.isSymbolicLink(), "Do not follow upstream links");
    if (info.isFile()) r.upstream.push(fileEvidence(f));
    return true;
  } });
  r.sources = r.sources.map(fileEvidence); save();
  if (withApp) {
    // Reproduce a fresh Android workspace with a reused Cargo cache: Wry
    // regenerated its outputs, while TauriActivity is absent. Compile the
    // actual consumer too, rather than proving only the Android library.
    const codegen = path.join(path.dirname(upstream), "android-codegen");
    fs.mkdirSync(path.join(out, "android-codegen"));
    for (const name of fs.readdirSync(codegen)) {
      const source = path.join(codegen, name);
      r.upstream.push(fileEvidence(source));
      fs.copyFileSync(source, path.join(out, "android-codegen", name), fs.constants.COPYFILE_EXCL);
    }
    const wry = path.resolve(upstream, "../../../wry-0.55.1/src/android/kotlin");
    const generated = path.join(out, "app/src/main/java", appPackage.replaceAll(".", "/"), "generated");
    fs.mkdirSync(generated, { recursive: true });
    for (const name of fs.readdirSync(wry).filter(name => name.endsWith(".kt"))) {
      const source = path.join(wry, name);
      r.upstream.push(fileEvidence(source));
      const content = fs.readFileSync(source, "utf8").replaceAll("{{package}}", appPackage)
        .replaceAll("{{package-unescaped}}", appPackage).replaceAll("{{library}}", "agentvn_player_lib")
        .replaceAll("{{class-extension}}", "").replaceAll("{{class-init}}", "");
      assert(!content.includes("{{"), "Unsupported pinned Wry template");
      fs.writeFileSync(path.join(generated, name), content, { flag: "wx" });
    }
    assert(!fs.existsSync(path.join(generated, "TauriActivity.kt")));
    fs.writeFileSync(path.join(path.dirname(generated), "MainActivity.kt"),
      `package ${appPackage}\nclass MainActivity : TauriActivity() {\n  fun verifyPluginManager() = getPluginManager()\n}\n`);
    fs.writeFileSync(path.join(out, "app/src/main/AndroidManifest.xml"),
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>');
    fs.writeFileSync(path.join(out, "app/build.gradle"), `
apply plugin: 'com.android.application'
apply plugin: 'org.jetbrains.kotlin.android'
android {
  namespace '${appPackage}'
  compileSdk 36
  defaultConfig { applicationId '${appPackage}'; minSdk 24 }
  compileOptions {
    sourceCompatibility JavaVersion.VERSION_1_8
    targetCompatibility JavaVersion.VERSION_1_8
  }
  kotlinOptions { jvmTarget = '1.8' }
  buildFeatures { buildConfig true }
}
dependencies {
  implementation project(':tauri-android')
  implementation 'androidx.webkit:webkit:1.14.0'
  implementation 'androidx.appcompat:appcompat:1.7.1'
  implementation 'androidx.activity:activity-ktx:1.10.1'
  implementation 'com.google.android.material:material:1.12.0'
  implementation 'androidx.lifecycle:lifecycle-process:2.10.0'
}
`);
    r.missingGeneratedActivity = { expected: path.join(generated, "TauriActivity.kt"),
      initiallyPresent: false, package: appPackage };
    save();
  }
  fs.mkdirSync(path.join(out, "temporary"));
  fs.writeFileSync(path.join(out, "settings.gradle"), `
rootProject.name = 'agentvn-real-android-source-regression'
include ':tauri-android'
${withApp ? "include ':app'" : ""}
apply from: '${helper.replaceAll("\\", "/")}'
`);
  fs.writeFileSync(path.join(out, "local.properties"),
    "sdk.dir=" + path.join(toolchain, "Sdk").replaceAll("\\", "/") + "\n");
  fs.writeFileSync(path.join(out, "gradle.properties"),
    "android.useAndroidX=true\norg.gradle.workers.max=2\nkotlin.compiler.execution.strategy=in-process\n");
  fs.writeFileSync(path.join(out, "build.gradle"), `
buildscript {
  repositories { google(); mavenCentral() }
  dependencies {
    classpath 'com.android.tools.build:gradle:8.11.0'
    classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25'
  }
}
allprojects { repositories { google(); mavenCentral() } }
tasks.register('verifyAgentvnSource') {
  dependsOn ':tauri-android:compileDebugKotlin'
  ${withApp ? "dependsOn ':app:compileDebugKotlin'" : ""}
  doLast {
    def data = new groovy.json.JsonSlurper().parse(file('agentvn-runtime/plugin-manager-source.json'))
    assert data.declared.size() == 1
    assert data.declared[0].endsWith('AgentVNPluginManager.kt')
    def android = project(':tauri-android').extensions.getByName('android')
    assert android.sourceSets.main.java.class.name.contains('DefaultAndroidSourceDirectorySet')
  }
}
`);
  await command("real-android-gradle", java, ["-cp", launcher, "org.gradle.launcher.GradleMain",
    "--offline", "--no-daemon", "--console", "plain", "--gradle-user-home", gradleHome,
    "--project-cache-dir", path.join(out, "project-cache"), "--project-dir", out, "verifyAgentvnSource"]);
  const proofFile = path.join(out, "agentvn-runtime/plugin-manager-source.json");
  const proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
  assert.equal(proof.sourceSha256, "2b0ef3b8cc92182858456f4b504330d61d23a3fe62a2e4e08c8f5c09cbdb4312");
  assert.equal(fileEvidence(proof.generated).sha256, proof.generatedSha256);
  assert.deepEqual(proof.declared, [proof.generated]);
  r.proof = fileEvidence(proofFile);
  const compilerFile = path.join(out, "agentvn-runtime/compiler-compileDebugKotlin.json");
  const compiler = JSON.parse(fs.readFileSync(compilerFile, "utf8"));
  assert.equal(compiler.task, ":tauri-android:compileDebugKotlin");
  assert.deepEqual(compiler.declared, [proof.generated]);
  assert.equal(compiler.generatedSha256, proof.generatedSha256);
  r.compiler = fileEvidence(compilerFile);
  await command("compiled-plugin-bytecode", javap, ["-p", "-c", "-classpath",
    path.join(module, "build/tmp/kotlin-classes/debug"), "app.tauri.plugin.PluginManager"]);
  const bytecode = fs.readFileSync(r.commands.at(-1).log, "utf8");
  assert.match(bytecode, /destroyedActivity/);
  assert.match(bytecode, /registerForActivityResult/);
  r.cases.push({ name: "Real Android source replacement and Kotlin compilation", status: "PASS" });
  if (withApp) {
    const generated = r.missingGeneratedActivity.expected;
    assert(fs.existsSync(generated), "The fresh app must have its own generated TauriActivity");
    const template = fs.readFileSync(path.join(out, "android-codegen/TauriActivity.kt"), "utf8");
    assert.equal(fs.readFileSync(generated, "utf8"), template.replaceAll("{{package}}", appPackage));
    r.generatedActivity = fileEvidence(generated);
    const sourceFile = path.join(out, "agentvn-runtime/tauri-codegen-source.json");
    const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
    assert.equal(source.sourceSha256, "7c14c42554e4bb4e9bab576307c85c2998e6b3f82397979c547294b26a9e7423");
    assert.equal(source.generated, generated);
    assert.equal(source.generatedSha256, r.generatedActivity.sha256);
    assert.equal(source.packageName, appPackage);
    const inputFile = path.join(out, "agentvn-runtime/app-compiler-compileDebugKotlin.json");
    const input = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    assert.equal(input.task, ":app:compileDebugKotlin");
    assert.deepEqual(input.declared, [generated]);
    assert.equal(input.generatedSha256, r.generatedActivity.sha256);
    r.codegenSource = fileEvidence(sourceFile); r.codegenCompiler = fileEvidence(inputFile);
    await command("compiled-main-activity", javap, ["-p", "-c", "-classpath",
      path.join(out, "app/build/tmp/kotlin-classes/debug"), appPackage + ".MainActivity"]);
    const consumer = fs.readFileSync(r.commands.at(-1).log, "utf8");
    assert(consumer.includes("extends " + appPackage + ".TauriActivity"));
    assert.match(consumer, /getPluginManager/);
    r.cases.push({ name: "Fresh app compiles against regenerated pinned TauriActivity", status: "PASS" });
    const localTemplate = path.join(out, "android-codegen/TauriActivity.kt");
    const classFile = path.join(out, "app/build/tmp/kotlin-classes/debug",
      appPackage.replaceAll(".", "/"), "MainActivity.class");
    const compiledSha = fileEvidence(classFile).sha256;
    const configArgs = ["-cp", launcher, "org.gradle.launcher.GradleMain", "--offline", "--no-daemon",
      "--console", "plain", "--gradle-user-home", gradleHome, "--project-cache-dir",
      path.join(out, "project-cache"), "--project-dir", out, "help"];
    for (const [name, marker] of [
      ["unsupported", "ANDROID_ACTIVITY_CODEGEN_UNSUPPORTED"],
      ["missing", "ANDROID_ACTIVITY_CODEGEN_MISSING"],
    ]) {
      const held = localTemplate + ".retained";
      try {
        if (name === "unsupported") fs.writeFileSync(localTemplate, template + "\n// Unsupported template\n");
        else fs.renameSync(localTemplate, held);
        await command("reject-" + name + "-template", java, configArgs, 1);
        assert(fs.readFileSync(r.commands.at(-1).log, "utf8").includes(marker));
        assert.equal(fileEvidence(classFile).sha256, compiledSha, "Rejected configuration cannot replace compiled app");
        r.cases.push({ name: `${name} template fails before compilation`, status: "PASS" });
      } finally {
        if (fs.existsSync(held)) fs.renameSync(held, localTemplate);
        else fs.writeFileSync(localTemplate, template);
      }
    }
  }
  r.status = "PASS";
}
main().catch(e => { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => {
    for (const f of [...r.sources, ...r.upstream]) {
      if (typeof f === "string") continue;
      assert.equal(fileEvidence(f.path).sha256, f.sha256);
    }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error, cases: r.cases.length }));
  });
