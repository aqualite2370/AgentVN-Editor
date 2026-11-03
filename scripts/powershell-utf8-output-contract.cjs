const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const productionScripts = [
  "scripts/build-game-shell-windows.ps1",
  "scripts/package-installers.ps1",
  "scripts/build-runtime-standalone-android.ps1",
  "scripts/setup-android-build-env.ps1",
];

for (const relativePath of productionScripts) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.doesNotMatch(
    source,
    /(?:Set-Content|Add-Content|Out-File)[^\r\n]*-Encoding\s+UTF8/i,
    `${relativePath} must not use Windows PowerShell 5.1 UTF-8 writers that add a BOM`,
  );
}

console.log("PASS production PowerShell outputs avoid UTF-8 BOM writers");
