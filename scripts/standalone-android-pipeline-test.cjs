const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const JSZip = require(path.join(root, "editor", "node_modules", "jszip"));

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function createUnicodeCartridge(filePath) {
  const zip = new JSZip();
  const assetPath = "assets/中文素材.txt";
  const asset = Buffer.from("中文内容", "utf8");
  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "0.2.0",
    game_id: "unicode-pipeline",
    title: "隐忍的成长",
    author: "AgentVN",
    version: "1.0.0",
    entry_script: "script.json",
    entry_scene_id: "start",
    assets: [{
      asset_id: "text.zh",
      asset_type: "data",
      filename: "中文素材.txt",
      path: assetPath,
      mime_type: "text/plain",
      size_bytes: asset.length,
      hash_sha256: sha256(asset),
    }],
  };
  const script = {
    schema_version: "1.1.0",
    game_id: manifest.game_id,
    title: manifest.title,
    entry_scene_id: "start",
    scenes: [{ scene_id: "start", commands: [] }],
  };
  const checksumFiles = [
    ["manifest.json", Buffer.from(JSON.stringify(manifest), "utf8")],
    ["script.json", Buffer.from(JSON.stringify(script), "utf8")],
    [assetPath, asset],
  ];
  const checksum = {
    algorithm: "sha256",
    files: checksumFiles.map(([entryPath, bytes]) => ({
      path: entryPath,
      size_bytes: bytes.length,
      hash_sha256: sha256(bytes),
    })),
  };
  for (const [entryPath, bytes] of checksumFiles) zip.file(entryPath, bytes);
  zip.file("checksum.json", JSON.stringify(checksum));
  fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-android-pipeline-"));
  try {
    const cartridge = path.join(temporary, "中文游戏.vncart");
    const reportPath = path.join(temporary, "诊断", "verify.json");
    await createUnicodeCartridge(cartridge);
    execFileSync(process.execPath, [
      path.join(root, "scripts", "verify-vncart.cjs"),
      "--allow-placeholder-assets",
      "--report",
      reportPath,
      cartridge,
    ], { cwd: root, encoding: "utf8" });

    const bytes = fs.readFileSync(reportPath);
    assert.notDeepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe], "verify report must not be UTF-16LE");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    const report = JSON.parse(text);
    assert.equal(report.title, "隐忍的成长");
    assert.equal(report.cartridge, cartridge);

    const host = fs.readFileSync(path.join(root, "editor", "src-tauri", "src", "main.rs"), "utf8");
    const androidRunner = fs.readFileSync(path.join(root, "scripts", "build-runtime-standalone-android.cjs"), "utf8");
    const legacyRunner = fs.readFileSync(path.join(root, "scripts", "build-runtime-standalone-android.ps1"), "utf8");
    assert.match(host, /build-runtime-standalone-android\.cjs/);
    assert.match(host, /--agentvn-elevated-android-build/);
    assert.match(host, /android-build-status\.json/);
    assert.match(host, /android-build\.done/);
    assert.match(host, /UAC_CANCELLED/);
    assert.match(
      host,
      /fn android_build_requires_default_elevation\(/,
      "Android standalone packaging must expose an explicit default-admin policy",
    );
    assert.match(
      host,
      /android_build_requires_default_elevation\(&probe\)/,
      "Android standalone packaging must evaluate the default-admin policy before direct build",
    );
    assert.match(
      host,
      /Android standalone builds require administrator permission by default/,
      "Android packaging must explain the default administrator requirement",
    );
    assert.match(androidRunner, /Buffer\.concat\(stdout\)\.toString\("utf8"\)/);
    assert.match(androidRunner, /const runId = option\("--RunId"/);
    assert.match(androidRunner, /if \(runId\) childArgs\.push\("-RunId", runId\)/);
    assert.match(legacyRunner, /Test-AndroidSymlinkCapability/);
    assert.match(legacyRunner, /--report", \$VerifyLog/);
    assert.match(legacyRunner, /-ArgumentList @\("run", "build"\)/);
    assert.match(legacyRunner, /dist\\index\.html/);
    assert.doesNotMatch(
      legacyRunner,
      /Invoke-AndroidKotlinCompilePreflight|:app:compileUniversalReleaseKotlin/,
      [
        "A clean `tauri android init` workspace does not contain tauri.settings.gradle.",
        "Do not invoke Gradle directly before `tauri android build`; Tauri's Rust build script",
        "generates tauri.settings.gradle and tauri.build.gradle.kts for the full build.",
      ].join(" "),
    );
    assert.match(
      legacyRunner,
      /"--required-stage",\s*"bootstrap"/,
      "Android packaging must only require the bootstrap project before Tauri build",
    );
    assert.match(
      legacyRunner,
      /Invoke-AndroidGeneratedDiagnostics -Phase "postbuild"/,
      "Android packaging must validate the complete generated project after Tauri build",
    );
    assert.match(
      legacyRunner,
      /"tauri", "--", "android", "build", "--apk", "--ci"/,
      "Android packaging must let the Tauri CLI prepare generated Gradle settings before compiling",
    );
    assert.match(legacyRunner, /RuntimeTauriConfigBackup/);
    assert.match(legacyRunner, /Copy-IfExists \$RuntimeTauriConfigBackup \$RuntimeTauriConfigPath/);
    assert.match(legacyRunner, /for \(\$attempt = 1; \$attempt -le 20;/);
    assert.doesNotMatch(legacyRunner, /\*>\s*\$VerifyLog/);
    assert.match(legacyRunner, /Set-AndroidKotlinCompilerPolicy/);
    assert.match(legacyRunner, /kotlin\.incremental=false/);
    assert.match(legacyRunner, /kotlin\.compiler\.execution\.strategy=in-process/);
    assert.match(
      legacyRunner,
      /function Reset-AndroidCompiledOutputs/,
      "Android packaging must define a clean boundary for stale Gradle/Kotlin bytecode",
    );
    assert.match(
      legacyRunner,
      /Reset-AndroidCompiledOutputs/,
      "Android packaging must clear compiled Android outputs before every Tauri build",
    );
    assert.match(legacyRunner, /src-tauri\\gen\\android\\app\\build/);
    assert.match(legacyRunner, /src-tauri\\gen\\android\\\.gradle/);
    assert.match(legacyRunner, /ANDROID_SIGNING_PASSWORD_UNAVAILABLE/);
    console.log("PASS standalone Android UTF-8, symlink probe, and elevation contract");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
