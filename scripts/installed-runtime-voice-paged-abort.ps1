$ErrorActionPreference='Stop'
$taskRun='D:\AgentVN\output\installed-runtime-voice-paged-20261019-01'
$taskExecution=Get-Content -LiteralPath (Join-Path $taskRun 'execution-02.json') -Raw -Encoding UTF8|ConvertFrom-Json
$taskCommand=@($taskExecution.commands|Where-Object {$_.label -eq 'player'})
if($taskCommand.Count -ne 1 -or $taskCommand[0].exitCode -ne $null){throw 'One live owned runner required'}
$taskRunnerPid=[int]$taskCommand[0].pid
$taskRunner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$taskRunnerPid)
if(!$taskRunner -or $taskRunner.Name -ne 'node.exe' -or
  $taskRunner.CommandLine -notmatch 'scripts/installed-runtime-voice-paged-playwright\.cjs 02'){
  throw 'Unexpected runner identity'
}
$taskRaw=Get-Content -LiteralPath (Join-Path $taskRun 'player-02\report.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($taskRaw.status -ne 'RUNNING' -or !@($taskRaw.cells|Where-Object {
  $_.error -match "Cannot read properties of undefined \(reading 'calls'\)"
}).Count){throw 'Expected known observer initialization failure required'}
$taskBefore=@(Get-CimInstance Win32_Process)
$taskOwned=@($taskRunnerPid)
do{
  $taskNew=@($taskBefore|Where-Object {$_.ParentProcessId -in $taskOwned -and $_.ProcessId -notin $taskOwned})
  $taskOwned+=@($taskNew|ForEach-Object {$_.ProcessId})
}while($taskNew.Count)
$taskReceipt=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');
  reason='QA_OBSERVER_NOT_INSTALLED_IN_ALREADY_LOADED_RESTART_PAGE_NOT_PRODUCT_FAILURE';
  operation='ATTRIBUTED_TEST_RUNNER_TREE_CANCELLATION';runnerPid=$taskRunnerPid;
  before=@($taskBefore|Where-Object {$_.ProcessId -in $taskOwned}|Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate);
  sourceStatus='INCOMPLETE_ABORTED';productStatus='UNPROVEN'}
$taskUtf8=New-Object Text.UTF8Encoding($false)
$taskDestination=Join-Path $taskRun 'abort-02.json'
if(Test-Path -LiteralPath $taskDestination){throw 'Evidence collision'}
[IO.File]::WriteAllText($taskDestination,($taskReceipt|ConvertTo-Json -Depth 8),$taskUtf8)
Copy-Item -LiteralPath (Join-Path $taskRun 'player-02\report.json') -Destination (Join-Path $taskRun 'player-02-at-abort.json')
& taskkill.exe /PID $taskRunnerPid /T /F
if($LASTEXITCODE -ne 0){throw 'Owned tree cancellation failed'}
$taskDeadline=[DateTime]::UtcNow.AddSeconds(10)
do{
  $taskRemaining=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in $taskOwned})
  if($taskRemaining.Count){Start-Sleep -Milliseconds 100}
}while($taskRemaining.Count -and [DateTime]::UtcNow -lt $taskDeadline)
$taskReceipt.remaining=@($taskRemaining|Select-Object ProcessId,Name,ExecutablePath)
$taskReceipt.status=if($taskRemaining.Count){'FAILED'}else{'PASS'}
$taskReceipt.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
[IO.File]::WriteAllText($taskDestination,($taskReceipt|ConvertTo-Json -Depth 8),$taskUtf8)
if($taskRemaining.Count){throw 'Owned process residue'}
Write-Output 'PASS: exact failed QA runner tree cancelled; source matrix remains incomplete'
