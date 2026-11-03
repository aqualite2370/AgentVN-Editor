const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const scripts = [
  path.join(root, "scripts", "build-runtime-standalone-android.ps1"),
  path.join(root, "scripts", "setup-android-build-env.ps1"),
];

for (const sourceScript of scripts) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-utf8-log-"));
  const harnessPath = path.join(fixtureRoot, "log-harness.ps1");
  const logPath = path.join(fixtureRoot, "中文 日志", "android.log");
  const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$SourceScript,
  [Parameter(Mandatory = $true)][string]$LogPath
)
$ErrorActionPreference = "Stop"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $SourceScript,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) { throw $parseErrors[0].Message }
$functionNames = @("Initialize-Utf8Log", "Add-Utf8Log")
if ([System.IO.Path]::GetFileName($SourceScript) -eq "build-runtime-standalone-android.ps1") {
  $functionNames += "Read-Utf8Text"
}
foreach ($functionName in $functionNames) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  if (-not $functionAst) { throw "Missing UTF-8 log function: $functionName" }
  . ([scriptblock]::Create($functionAst.Extent.Text))
}
$first = [System.Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String("6ZqQ5b+N55qE5oiQ6ZW/IC0g5byA5aeL")
)
$second = [System.Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String("6K+m5patIC0g5a6M5oiQ")
)
Initialize-Utf8Log -Path $LogPath -Value $first
Add-Utf8Log -Path $LogPath -Value $second
$bytes = [System.IO.File]::ReadAllBytes($LogPath)
if (
  $bytes.Length -ge 3 -and
  $bytes[0] -eq 0xEF -and
  $bytes[1] -eq 0xBB -and
  $bytes[2] -eq 0xBF
) {
  throw "UTF-8 log contains a BOM."
}
$text = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes)
if ($text.Contains([char]0xFFFD)) { throw "UTF-8 log contains replacement characters." }
if (-not $text.Contains($first) -or -not $text.Contains($second)) {
  throw "UTF-8 log lost Unicode text."
}
if (Get-Command Read-Utf8Text -ErrorAction SilentlyContinue) {
  $roundTrip = Read-Utf8Text -Path $LogPath
  if (-not $roundTrip.Contains($first) -or -not $roundTrip.Contains($second)) {
    throw "Strict UTF-8 log reader corrupted Unicode text."
  }
}
Write-Output "PASS strict UTF-8 no-BOM log"
`;
  fs.writeFileSync(harnessPath, harness, "utf8");

  try {
    const result = childProcess.spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        harnessPath,
        "-SourceScript",
        sourceScript,
        "-LogPath",
        logPath,
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
      `${path.basename(sourceScript)} UTF-8 log contract failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stdout, /PASS strict UTF-8 no-BOM log/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

console.log("PASS Android build and environment logs use strict UTF-8 without BOM");
