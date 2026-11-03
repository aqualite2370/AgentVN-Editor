const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_MAIN = path.join(ROOT, "editor", "src-tauri", "src", "main.rs");
const PLAYER_MAIN = path.join(ROOT, "GameCli_framework", "src-tauri", "src", "main.rs");
const BACKEND_BUILD = path.join(ROOT, "scripts", "build-backend-sidecar.ps1");
const GUI_ASSERTION_SCRIPT = path.join(ROOT, "scripts", "assert-windows-gui-subsystem.ps1");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertGuiEntry(filePath, label) {
  const source = read(filePath);
  assert(
    source.includes('#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]'),
    `${label} must use the Windows GUI subsystem in debug and release builds.`,
  );
}

function readPeSubsystem(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert(bytes.length >= 0x40, `${filePath} is too small to be a PE executable.`);
  assert(bytes.toString("ascii", 0, 2) === "MZ", `${filePath} is not a Windows PE executable.`);
  const peOffset = bytes.readUInt32LE(0x3c);
  assert(bytes.toString("ascii", peOffset, peOffset + 4) === "PE\u0000\u0000", `${filePath} has an invalid PE signature.`);
  const optionalHeaderOffset = peOffset + 24;
  return bytes.readUInt16LE(optionalHeaderOffset + 68);
}

assertGuiEntry(EDITOR_MAIN, "AgentVN Editor");
assertGuiEntry(PLAYER_MAIN, "AgentVN Player");

const editorSource = read(EDITOR_MAIN);
assert(editorSource.includes("CREATE_NO_WINDOW"), "Editor must define the Windows CREATE_NO_WINDOW process flag.");
assert(editorSource.includes("fn background_command"), "Editor must use one background process factory.");
const rawCommandConstructors = editorSource.match(/Command::new\(/g) ?? [];
assert(
  rawCommandConstructors.length === 1,
  `Editor child processes must use background_command; found ${rawCommandConstructors.length} raw Command::new calls.`,
);

const backendBuildSource = read(BACKEND_BUILD);
assert(
  (backendBuildSource.match(/--noconsole/g) ?? []).length >= 2,
  "Packaged backend must remain a PyInstaller --noconsole executable for both uv and python build paths.",
);
assert(
  read(GUI_ASSERTION_SCRIPT).includes("WINDOWS_GUI (2)"),
  "Builds must verify the PE subsystem before publishing Windows executables.",
);

const binaryArgs = process.argv.slice(2);
for (const binaryPath of binaryArgs) {
  const resolved = path.resolve(binaryPath);
  assert(fs.existsSync(resolved), `Required executable does not exist: ${resolved}`);
  const subsystem = readPeSubsystem(resolved);
  assert(subsystem === 2, `${resolved} uses PE subsystem ${subsystem}; expected 2 (WINDOWS_GUI).`);
}

console.log(`windows-no-console-contract-test: ok${binaryArgs.length ? ` (${binaryArgs.length} binaries)` : ""}`);
