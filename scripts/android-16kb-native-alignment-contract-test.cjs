const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const sourceCargoConfig = path.join(root, "GameCli_framework", "src-tauri", ".cargo", "config.toml");
const bundledCargoConfig = path.join(
  root,
  "editor",
  "src-tauri",
  "bundle-workspace",
  "GameCli_framework",
  "src-tauri",
  ".cargo",
  "config.toml",
);
const sourceBuildScript = path.join(root, "scripts", "build-runtime-standalone-android.ps1");
const bundledBuildScript = path.join(
  root,
  "editor",
  "src-tauri",
  "bundle-workspace",
  "scripts",
  "build-runtime-standalone-android.ps1",
);

const expectedTargets = [
  "aarch64-linux-android",
  "armv7-linux-androideabi",
  "i686-linux-android",
  "x86_64-linux-android",
];
const requiredFlags = [
  "-Wl,-z,max-page-size=16384",
  "-Wl,-z,common-page-size=16384",
];

function read(filePath) {
  assert.equal(fs.existsSync(filePath), true, `missing Android Cargo config: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

function assertConfig(filePath) {
  const text = read(filePath);
  for (const target of expectedTargets) {
    assert.match(text, new RegExp(`\\[target\\.${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`), `${filePath} must configure ${target}`);
  }
  for (const flag of requiredFlags) {
    assert.match(text, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${filePath} must link Android native libraries with ${flag}`);
  }
}

assertConfig(sourceCargoConfig);
assertConfig(bundledCargoConfig);

const sourceBytes = fs.readFileSync(sourceCargoConfig);
const bundledBytes = fs.readFileSync(bundledCargoConfig);
assert.deepEqual(
  bundledBytes,
  sourceBytes,
  "bundled Android Cargo config must stay byte-for-byte identical to the source runtime config",
);

const sourceBuildText = fs.readFileSync(sourceBuildScript, "utf8");
const bundledBuildText = fs.readFileSync(bundledBuildScript, "utf8");
for (const flag of requiredFlags) {
  assert.match(
    sourceBuildText,
    new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `standalone Android build must pass ${flag} through RUSTFLAGS`,
  );
}
assert.deepEqual(
  bundledBuildText,
  sourceBuildText,
  "bundled standalone Android build script must stay byte-for-byte identical to the source script",
);

console.log("PASS Android 16 KB ELF native alignment contract");
