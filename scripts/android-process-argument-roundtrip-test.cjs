const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildScript = path.join(root, "scripts", "build-runtime-standalone-android.ps1");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-process-args-"));
const captureScript = path.join(fixtureRoot, "capture-args.cjs");
const requestPath = path.join(fixtureRoot, "request.json");
const reportPath = path.join(fixtureRoot, "captured.json");
const commandReportPath = path.join(fixtureRoot, "captured-command.json");
const logPath = path.join(fixtureRoot, "diagnostics", "process.log");
const harnessPath = path.join(fixtureRoot, "invoke-command.ps1");
const commandDirectory = path.join(fixtureRoot, "tool %PATH% 中文");
const commandPath = path.join(commandDirectory, "capture arguments.cmd");
const values = [
  String.raw`C:\缓存 工作区\文件.txt`,
  "D:\\folder with spaces\\trailing\\",
  'quote"value',
  "percent%PATH%value",
  "bang!value",
  "\\\\server\\共享 目录\\文件.txt",
  "",
  "plain",
];
const commandValues = ["中文 空格", "plain"];

fs.writeFileSync(
  captureScript,
  `const fs = require("node:fs");\nfs.writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)), "utf8");\n`,
  "utf8",
);
fs.writeFileSync(requestPath, JSON.stringify({ values, commandValues }), "utf8");
fs.mkdirSync(commandDirectory, { recursive: true });
fs.writeFileSync(
  commandPath,
  `@echo off\r\n"${process.execPath}" "${captureScript}" "${commandReportPath}" %*\r\n`,
  "utf8",
);
fs.writeFileSync(
  harnessPath,
  String.raw`
param(
  [Parameter(Mandatory = $true)][string]$BuildScript,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$CaptureScript,
  [Parameter(Mandatory = $true)][string]$RequestPath,
  [Parameter(Mandatory = $true)][string]$ReportPath,
  [Parameter(Mandatory = $true)][string]$CommandPath,
  [Parameter(Mandatory = $true)][string]$LogPath
)
$ErrorActionPreference = "Stop"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $BuildScript,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) { throw $parseErrors[0].Message }
foreach ($functionName in @(
  "Initialize-Utf8Log",
  "Add-Utf8Log",
  "Remove-AnsiEscape",
  "Join-ProcessArguments",
  "Invoke-LoggedCommand"
)) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  if (-not $functionAst) { throw "Missing process function: $functionName" }
  . ([scriptblock]::Create($functionAst.Extent.Text))
}
$requestBytes = [System.IO.File]::ReadAllBytes($RequestPath)
$request = (New-Object System.Text.UTF8Encoding($false, $true)).
  GetString($requestBytes) |
  ConvertFrom-Json
Initialize-Utf8Log -Path $LogPath -Value "argument roundtrip"
$arguments = @($CaptureScript, $ReportPath) + @($request.values)
$exitCode = Invoke-LoggedCommand -FilePath $NodePath -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $CaptureScript) -LogPath $LogPath
if ($exitCode -ne 0) { throw "Argument capture process failed: $exitCode" }
$commandExitCode = Invoke-LoggedCommand -FilePath $CommandPath -ArgumentList @($request.commandValues) -WorkingDirectory (Split-Path -Parent $CommandPath) -LogPath $LogPath
if ($commandExitCode -ne 0) { throw "Command-script argument capture failed: $commandExitCode" }
`,
  "utf8",
);

try {
  const result = childProcess.spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      harnessPath,
      "-BuildScript",
      buildScript,
      "-NodePath",
      process.execPath,
      "-CaptureScript",
      captureScript,
      "-RequestPath",
      requestPath,
      "-ReportPath",
      reportPath,
      "-CommandPath",
      commandPath,
      "-LogPath",
      logPath,
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const commandLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  assert.equal(
    result.status,
    0,
    `argument harness failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\nlog:\n${commandLog}`,
  );
  const captured = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.deepEqual(captured, values, "Windows child-process arguments must round-trip exactly");
  const commandCaptured = JSON.parse(fs.readFileSync(commandReportPath, "utf8"));
  assert.deepEqual(
    commandCaptured,
    commandValues,
    "Windows command scripts must work from paths containing spaces, Unicode and percent signs",
  );
  console.log("PASS Android command arguments preserve Unicode, spaces, quotes, UNC and empty values");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
