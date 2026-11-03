const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const apkArgIndex = process.argv.indexOf("--apk");
const apkPath = apkArgIndex >= 0 ? path.resolve(process.argv[apkArgIndex + 1]) : process.env.AGENTVN_ANDROID_APK ? path.resolve(process.env.AGENTVN_ANDROID_APK) : "";
const tauri = JSON.parse(fs.readFileSync(path.join(root, "GameCli_framework", "src-tauri", "tauri.conf.json"), "utf8"));
const properties = fs.readFileSync(path.join(root, "GameCli_framework", "src-tauri", "gen", "android", "app", "tauri.properties"), "utf8");
const gradle = fs.readFileSync(path.join(root, "GameCli_framework", "src-tauri", "gen", "android", "app", "build.gradle.kts"), "utf8");
const strings = fs.readFileSync(path.join(root, "GameCli_framework", "src-tauri", "gen", "android", "app", "src", "main", "res", "values", "strings.xml"), "utf8");
const manifest = fs.readFileSync(path.join(root, "GameCli_framework", "src-tauri", "gen", "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}
function pngSize(file) {
  const data = fs.readFileSync(file);
  assert(data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a, "icon is not a PNG", file);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), bytes: data.length };
}

assert(typeof tauri.productName === "string" && typeof tauri.version === "string" && typeof tauri.identifier === "string", "Tauri release metadata fields are missing", tauri);
assert(properties.includes("tauri.android.versionName=") && properties.includes("tauri.android.versionCode="), "Android tauri.properties does not expose runtime release metadata");
assert(gradle.includes("namespace =") && gradle.includes("applicationId =") && gradle.includes("versionCode = tauriProperties") && gradle.includes("versionName = tauriProperties"), "Gradle does not consume runtime Android metadata");
assert(strings.includes('name="app_name">') && strings.includes('name="main_activity_title">'), "Android labels are missing");
assert(manifest.includes('android:icon="@mipmap/ic_launcher"') && manifest.includes('android:label="@string/app_name"'), "Android manifest does not reference canonical launcher metadata");

const icons = [];
for (const [density, size] of Object.entries(densities)) {
  for (const name of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
    const file = path.join(root, "GameCli_framework", "src-tauri", "gen", "android", "app", "src", "main", "res", `mipmap-${density}`, name);
    assert(fs.existsSync(file), "launcher icon density resource is missing", file);
    const expectedSize = name === "ic_launcher_foreground.png" ? Math.round(size * 2.25) : size;
    const actual = pngSize(file);
    assert(actual.width === expectedSize && actual.height === expectedSize && actual.bytes > 100, "launcher icon dimensions or bytes are invalid", { file, expected: expectedSize, actual });
    icons.push({ density, name, ...actual });
  }
}
let apk = null;
if (apkPath) {
  assert(fs.existsSync(apkPath), "APK passed to metadata contract does not exist", apkPath);
  const { spawnSync } = require("child_process");
  const inspection = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "inspect-android-apk.cjs"), apkPath],
    { encoding: "utf8", windowsHide: true },
  );
  assert(inspection.status === 0, "final APK inspection failed", {
    stdout: inspection.stdout,
    stderr: inspection.stderr,
  });
  apk = { inspection: inspection.stdout.trim() };
}
console.log(`Android metadata contract: PASS\n${JSON.stringify({ ok: true, template: { dynamicIdentity: true }, icons, apk }, null, 2)}`);
