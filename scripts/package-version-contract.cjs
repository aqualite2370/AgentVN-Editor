const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const installer = fs.readFileSync(path.join(root, "scripts", "package-installers.ps1"), "utf8");
const bat = fs.readFileSync(path.join(root, "package-installers.bat"), "utf8");
const editorHome = fs.readFileSync(path.join(root, "editor", "src", "components", "project", "ProjectHome.tsx"), "utf8");

for (const token of ["Resolve-PackageVersion", "Set-PackageVersion", "Restore-PackageVersion", "PackageVersion", "Player installer icon synced from editor icon"]) {
  if (!installer.includes(token)) throw new Error(`Installer version/icon flow missing ${token}`);
}
if (!bat.includes("set /p") || !bat.includes("-Version \"%VERSION%\"")) throw new Error("BAT must prompt for and forward the package version");
if (!editorHome.includes('import { version as editorVersion } from "../../../src-tauri/tauri.conf.json"')
  || !editorHome.includes("当前版本[{editorVersion}]")) {
  throw new Error("Homepage version must follow the actual Tauri build configuration");
}

console.log("PASS package version and editor icon contract");
