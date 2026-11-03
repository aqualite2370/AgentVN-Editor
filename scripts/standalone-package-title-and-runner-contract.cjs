const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const removedPowerShellSources = [
  "scripts/build-runtime-standalone-windows.ps1",
  "editor/src-tauri/bundle-workspace/scripts/build-runtime-standalone-windows.ps1",
];
const directSources = [
  "scripts/build-runtime-standalone-windows.cjs",
  "editor/src-tauri/bundle-workspace/scripts/build-runtime-standalone-windows.cjs",
];

for (const relativePath of removedPowerShellSources) {
  if (fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`${relativePath}: obsolete Windows standalone PowerShell runner must be removed`);
  }
}

for (const relativePath of directSources) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const requireText = (pattern, message) => {
    if (!pattern.test(source)) throw new Error(`${relativePath}: ${message}`);
  };
  requireText(/spawn\(file,\s*commandArgs/, "direct runner must pass argument arrays without shell interpolation");
  requireText(/Buffer\.concat\(stdout\)\.toString\("utf8"\)/, "direct runner must decode Node/npm output as UTF-8");
  requireText(/writeJson\(manifestPath/, "direct runner must write a UTF-8 manifest itself");
  requireText(/assertInside\(outputDir/, "direct runner must enforce output containment");
  requireText(/assertWindowsGuiSubsystem/, "direct runner must retain the Windows GUI subsystem check");
  requireText(/restoreRuntimeState/, "direct runner must restore the runtime workspace");
  requireText(/applyRuntimeIdentity\(releaseIdentity\)/, "direct runner must apply cartridge release identity metadata");
  requireText(/safeFileStem\(`\$\{gameTitle\}-\$\{releaseIdentity\.versionName\}`\)/, "direct runner must use a safe game-title file stem");
  requireText(/PreparedInPlace/, "direct runner must accept Rust-prepared cartridge contents in place");
  requireText(/DisposableWorkspace/, "direct runner must avoid restoring a disposable Rust workspace");
  if (/powershell(?:\.exe)?/i.test(source)) {
    throw new Error(`${relativePath}: production direct runner must not invoke PowerShell`);
  }
}

const editorHost = fs.readFileSync(path.join(root, "editor/src-tauri/src/main.rs"), "utf8");
if (!/use_direct_node_runner/.test(editorHost) || !/build-runtime-standalone-windows\.cjs/.test(editorHost)) {
  throw new Error("Editor host must prefer the direct Windows standalone runner.");
}
if (!/let script_name = if platform == "windows" \{\s*"build-runtime-standalone-windows\.cjs"/.test(editorHost)) {
  throw new Error("Editor Windows packaging must not fall back to the PowerShell runner.");
}
if (!/prepare_standalone_cartridge_safely/.test(editorHost) || !/standalone-cartridge-safety\.json/.test(editorHost)) {
  throw new Error("Editor host must validate and unpack the cartridge in Rust before the Windows build.");
}

console.log("standalone package title and runner contract: PASS");
