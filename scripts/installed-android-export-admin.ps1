param(
  [Parameter(Mandatory=$true)][string]$SessionRoot,
  [Parameter(Mandatory=$true)][string]$EvidenceDir,
  [Parameter(Mandatory=$true)][string]$FixtureFile,
  [Parameter(Mandatory=$true)][string]$ProjectFile,
  [string]$FinalProjectProof = '',
  [switch]$Elevated
)
$ErrorActionPreference = 'Stop'
$session = [IO.Path]::GetFullPath($SessionRoot)
$evidence = [IO.Path]::GetFullPath($EvidenceDir)
$project = [IO.Path]::GetFullPath($ProjectFile)
foreach ($childPath in @($evidence, $project)) {
  if (-not $childPath.StartsWith($session + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Android export inputs and evidence must belong to the isolated installed session'
  }
}
$statusFile = Join-Path $evidence 'admin-launch.json'
$utf8 = New-Object Text.UTF8Encoding($false)
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
function Save-Status {
  [IO.File]::WriteAllText($statusFile, ($status | ConvertTo-Json -Depth 10), $utf8)
}
if (-not $Elevated) {
  if ($isElevated) { throw 'Must originate from the real non-admin boundary' }
  if (Test-Path -LiteralPath $statusFile) { throw 'RUN_DIRECTORY_ALREADY_USED' }
  $status = [ordered]@{ status='AWAITING_RUNAS'; originIsElevated=$false; originProcessId=$PID;
    requestedAt=(Get-Date).ToUniversalTime().ToString('o') }
  Save-Status
  try {
    $arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'),
      '-SessionRoot',('"' + $session + '"'),'-EvidenceDir',('"' + $evidence + '"'),
      '-FixtureFile',('"' + [IO.Path]::GetFullPath($FixtureFile) + '"'),
      '-ProjectFile',('"' + $project + '"'),'-Elevated')
    if ($FinalProjectProof) { $arguments += @('-FinalProjectProof',('"' + [IO.Path]::GetFullPath($FinalProjectProof) + '"')) }
    $helper = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments -PassThru
    Write-Output ("Administrator helper PID: " + $helper.Id)
    exit 0
  } catch {
    $status.status = 'BLOCKED'
    $status.error = $_.Exception.Message
    Save-Status
    throw
  }
}
$status = [IO.File]::ReadAllText($statusFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
if (-not $isElevated -or $status.originIsElevated) { throw 'ANDROID_ADMIN_REQUIRED' }
$status | Add-Member -NotePropertyName isElevated -NotePropertyValue $true
$status | Add-Member -NotePropertyName elevatedProcessId -NotePropertyValue $PID
$status.status = 'RUNNING'
Save-Status
try {
  $sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $permission = Join-Path $evidence 'permission'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'android-acceptance-preflight.ps1') -OutputDir $permission
  if ($LASTEXITCODE -ne 0) { throw 'ANDROID_SYMLINK_REQUIRED' }
  $fixture = [IO.File]::ReadAllText($FixtureFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
  $env:INSTALLED_ACCEPTANCE_ANDROID_PERMISSION_DIR = $permission
  $env:INSTALLED_ACCEPTANCE_PROJECT_TITLE = [string]$fixture.title
  # Empty removes inherited authorization in ordinary small-fixture runs.
  $env:INSTALLED_ACCEPTANCE_FINAL_PROJECT_PROOF = $FinalProjectProof
  $env:AGENTVN_TEST_PROJECT = $project
  $env:AGENTVN_WORKSPACE_OUTPUT = $evidence
  $env:PSModulePath = 'C:\Users\1\Documents\WindowsPowerShell\Modules;C:\Program Files\WindowsPowerShell\Modules;C:\WINDOWS\system32\WindowsPowerShell\v1.0\Modules'
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & node.exe (Join-Path $sourceRoot 'scripts\installed-editor-android-export-playwright.cjs') $session 1> (Join-Path $evidence 'export-stdout.log') 2> (Join-Path $evidence 'export-stderr.log')
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  $status | Add-Member -NotePropertyName exitCode -NotePropertyValue $code
  $status.status = if ($code -eq 0) { 'BUILD_PASS_DEVICE_PENDING' } else { 'CHECK_EXPORT_REPORT' }
} catch {
  $status.status = 'BLOCKED'
  $status | Add-Member -NotePropertyName error -NotePropertyValue $_.Exception.Message
} finally {
  $status | Add-Member -NotePropertyName finishedAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o'))
  Save-Status
}
