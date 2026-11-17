param([switch]$Elevated)
$ErrorActionPreference='Stop'
$base='F:\testavn\Windows-Isolated-1987-20261117-01'
if(!$Elevated){
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
if(!([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator required'}
$failed=Get-Content -LiteralPath "$base\account-retirement-01.json" -Raw|ConvertFrom-Json
if($failed.status -cne 'FAILED' -or $failed.error -notmatch 'Product QA cleanup not terminal' -or
  $failed.userFilesDeleted -ne 0){throw 'Unexpected prior retirement failure'}
$source="$base\harness\scripts\final-project-qa-retire-1956.ps1"
$text=Get-Content -LiteralPath $source -Raw -Encoding UTF8
$guard='if(!$run.finishedAt -or $run.cleanupStatus -cne ''PASS''){throw ''Product QA cleanup not terminal''}'
if($text.Split(@($guard),[StringSplitOptions]::None).Count -ne 2){throw 'Exact retirement guard required'}
$replacement=@'
if($run.status -cne 'PASS' -or $run.cleanupStatus -cne 'PASS'){throw 'Product QA cleanup not terminal'}
$completionFile=Join-Path $base 'job-01\completion.json'
$completion=Get-Content -LiteralPath $completionFile -Raw -Encoding UTF8|ConvertFrom-Json
if($completion.status -cne 'PASS' -or $completion.exitCode -ne 0 -or !$completion.finishedAt -or
  $completion.sid -cne $controller.account.sid -or $controller.jobs.Count -ne 1 -or
  $controller.jobs[0].status -cne 'PASS' -or $controller.jobs[0].sha256 -cne $completion.runnerSha256 -or
  (Sha $completion.runner) -cne $completion.runnerSha256){throw 'Verified child completion required'}
$result.completionEvidence=@{path=$completionFile;sha256=(Sha $completionFile);finishedAt=$completion.finishedAt}
$result.originalProductReport=@{path=$runFile;sha256=(Sha $runFile);unchanged=$true}
$result.priorFailedRetirement=@{path=(Join-Path $base 'account-retirement-01.json');sha256=(Sha (Join-Path $base 'account-retirement-01.json'))}
'@
$text=$text.Replace($guard,$replacement).Replace(
  '$file=Join-Path $base ''account-retirement-01.json''',
  '$file=Join-Path $base ''account-retirement-02.json''')
& ([scriptblock]::Create($text)) -SessionRoot $base -Elevated
