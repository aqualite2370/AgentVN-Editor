const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const prepareScript = path.join(root, "scripts", "prepare-editor-runtime-resources.ps1");
const windowsBuildScript = path.join(root, "scripts", "build-editor-windows.ps1");
const devBuildScript = path.join(root, "scripts", "build-dev-launcher.ps1");
const bundledScriptManifestPath = path.join(root, "scripts", "standalone-build-scripts.json");
const bundledWorkspace = path.join(
  root,
  "editor",
  "src-tauri",
  "bundle-workspace",
  "scripts",
);
const manifestBytes = fs.readFileSync(bundledScriptManifestPath);
assert.notDeepEqual(
  [...manifestBytes.subarray(0, 3)],
  [0xef, 0xbb, 0xbf],
  "bundled script manifest must be UTF-8 without BOM",
);
const bundledScriptManifest = JSON.parse(
  new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
);
assert.equal(bundledScriptManifest.schemaVersion, 1);
assert.ok(Array.isArray(bundledScriptManifest.scripts));
const requiredAndroidScripts = [
  "ensure-android-generated-project.cjs",
  "capture-android-build-diagnostics.ps1",
  "normalize-android-opening-audio.cjs",
  "inspect-android-apk.cjs",
];
for (const scriptName of requiredAndroidScripts) {
  assert.ok(
    bundledScriptManifest.scripts.includes(scriptName),
    `bundled script manifest must include ${scriptName}`,
  );
}
assert.equal(
  new Set(bundledScriptManifest.scripts.map((name) => name.toLowerCase())).size,
  bundledScriptManifest.scripts.length,
  "bundled script manifest must not contain duplicate entries",
);

for (const scriptPath of [prepareScript]) {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(
    source,
    /standalone-build-scripts\.json/,
    `${path.basename(scriptPath)} must use the shared bundled script manifest`,
  );
}
assert.match(fs.readFileSync(windowsBuildScript, "utf8"), /prepare-editor-runtime-resources\.ps1/,
  "Release must delegate resource preparation to the same entry point as Dev and direct Tauri");
const devBuildSource = fs.readFileSync(devBuildScript, "utf8");
assert.match(
  devBuildSource,
  /prepare-editor-runtime-resources\.ps1[\s\S]*-SkipGameCliPlayer/,
  "Dev compilation must refresh bundled standalone resources before cargo build",
);

const result = childProcess.spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    prepareScript,
    "-SkipGameCliPlayer",
  ],
  {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  },
);

assert.equal(
  result.status,
  0,
  `runtime resource preparation failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
);
for (const scriptName of bundledScriptManifest.scripts) {
  const bundledScript = path.join(bundledWorkspace, scriptName);
  const sourceScript = path.join(root, "scripts", scriptName);
  assert.equal(
    fs.existsSync(bundledScript),
    true,
    `bundled workspace is missing ${scriptName}`,
  );
  assert.ok(
    fs.statSync(bundledScript).size > 0,
    `bundled script must not be empty: ${scriptName}`,
  );
  assert.deepEqual(
    fs.readFileSync(bundledScript),
    fs.readFileSync(sourceScript),
    `bundled script must exactly match its source: ${scriptName}`,
  );
}

console.log("PASS bundled workspace includes all Android build helpers");
