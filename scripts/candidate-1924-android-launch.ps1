param([ValidateSet('SelfTest','Launch','Elevated')][string]$Action='SelfTest')
$ErrorActionPreference='Stop'
$repo='D:\AgentVN'
$run='F:\AgentVN\QA\Android-Package-20261021-01\administrator-13'
$editor='F:\AgentVN\QA\Android-Package-20261021-01\editor-13'
$checkpoint='F:\AgentVN\Checkpoints\Android-Package-1924-20261025-01'
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))}
function Read($file){[IO.File]::ReadAllText($file)|ConvertFrom-Json}
function Sha($file){
  $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
  try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
  finally{$stream.Dispose();$hash.Dispose()}
}
function Boundary($value){if([IO.Path]::GetFullPath($value) -cne $run){throw 'Exact administrator-13 directory required'}}
$tools=@($PSCommandPath,(Join-Path $PSScriptRoot 'candidate-1924-android-package.cjs'),
  (Join-Path $PSScriptRoot 'candidate-1924-android-package-cache.ps1'),
  (Join-Path $PSScriptRoot 'installed-android-package-current.cjs'),
  (Join-Path $PSScriptRoot 'android-current-cache-session.ps1'),
  (Join-Path $PSScriptRoot 'android-current-webview-policy.ps1'),
  (Join-Path $PSScriptRoot 'android-acceptance-preflight.ps1'),
  (Join-Path $PSScriptRoot 'lib\installed-release-session.cjs'),
  (Join-Path $PSScriptRoot 'lib\android-game-upgrade-fixture.cjs'))
Boundary $run
if($Action -ceq 'SelfTest'){
  foreach($bad in @('F:\AgentVN','D:\AgentVN',($run+'\nested'),($run+'-other'))){
    $accepted=$true;try{Boundary $bad}catch{$accepted=$false}
    if($accepted){throw 'Unsafe launch directory accepted'}
  }
  $tokens=$null;$errors=$null
  $null=[Management.Automation.Language.Parser]::ParseFile($PSCommandPath,[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'Launch syntax invalid'}
  'PASS: exact launch path, four rejected boundaries, syntax; no launch';exit
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$isElevated=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$originFile=Join-Path $run 'origin.json';$resultFile=Join-Path $run 'result.json'
if($Action -ceq 'Launch'){
  if($isElevated){throw 'Real non-admin origin required'}
  foreach($file in @($run,$editor,$checkpoint)){if(Test-Path -LiteralPath $file){throw "Fresh session required: $file"}}
  $null=New-Item -ItemType Directory -Path $run,$checkpoint
  $origin=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
  $state=@{status='AWAITING_RUNAS';originIsElevated=$false;originProcessId=$PID
    originCreated=$origin.CreationDate.ToUniversalTime().ToString('o');userSid=$identity.User.Value
    requestedAt=[DateTime]::UtcNow.ToString('o');attempt='13';editorDirectory=$editor;tools=@()}
  foreach($tool in $tools){
    $state.tools+=@{path=$tool;sha256=(Sha $tool)}
    Copy-Item -LiteralPath $tool -Destination (Join-Path $checkpoint ([IO.Path]::GetFileName($tool)))
  }
  foreach($tool in @('D:\AgentVN\AGENTS.md','D:\AgentVN\plans\ACTIVE_TASKS.md','D:\AgentVN\plans\FULL_REGRESSION_20261017.md')){
    Copy-Item -LiteralPath $tool -Destination (Join-Path $checkpoint ([IO.Path]::GetFileName($tool)))
  }
  $candidate=Read 'F:\AgentVN\QA\Editor-1.9.24-20261024-01\installation.json'
  $state.frozen=@($candidate.package,$candidate.executable)+@($candidate.resources)
  foreach($file in $state.frozen){if((Sha $file.path) -cne $file.sha256){throw 'Frozen candidate changed'}}
  Save $originFile $state
  try{
    $child=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
      '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Action','Elevated')
    $state.helperPid=$child.Id;$state.helperCreated=$child.StartTime.ToUniversalTime().ToString('o')
    $state.status='HELPER_STARTED'
  }catch{$state.status='BLOCKED';$state.error=$_.Exception.ToString();throw}
  finally{Save $originFile $state}
  $state|Select-Object status,originProcessId,helperPid,helperCreated|ConvertTo-Json
  exit
}
if(!$isElevated){throw 'Actual elevated token required'}
if(Test-Path -LiteralPath $resultFile){throw 'Do not overwrite prior administrator result'}
$origin=Read $originFile
if($origin.originIsElevated -or $origin.userSid -cne $identity.User.Value){throw 'Same-user non-admin origin required'}
foreach($file in @($origin.tools)+@($origin.frozen)){if((Sha $file.path) -cne $file.sha256){throw 'Sources changed after launch'}}
$current=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$result=@{status='RUNNING';startedAt=[DateTime]::UtcNow.ToString('o');isElevated=$true;processId=$PID
  created=$current.CreationDate.ToUniversalTime().ToString('o');userSid=$identity.User.Value
  originProcessId=$origin.originProcessId;attempt='13';editorDirectory=$editor;probe=$null;error=$null}
Save $resultFile $result
try{
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'android-acceptance-preflight.ps1') -OutputDir (Join-Path $run 'permission')
  if($LASTEXITCODE -ne 0){throw 'Elevated symlink probe failed'}
  $result.probe=Read (Join-Path $run 'permission\acceptance-permission.json')
  if(!$result.probe.success -or !$result.probe.isElevated -or (Test-Path -LiteralPath $result.probe.probeRoot)){throw 'Probe evidence or cleanup invalid'}
  Save $resultFile $result
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $arguments=@(('"'+(Join-Path $PSScriptRoot 'candidate-1924-android-package.cjs')+'"'),'13',
    '--physical-package-cache','--physical-environment-cache',('"--administrator-launch='+$run+'"'),'--native-upgrade')
  $child=Start-Process $node -WorkingDirectory $repo -WindowStyle Hidden -PassThru -ArgumentList $arguments `
    -RedirectStandardOutput (Join-Path $run 'stdout.log') -RedirectStandardError (Join-Path $run 'stderr.log')
  $result.nodeProcessId=$child.Id;$result.nodeCreated=$child.StartTime.ToUniversalTime().ToString('o');Save $resultFile $result
  $null=$child.Handle;$child.WaitForExit();$child.Refresh()
  $result.exitCode=$child.ExitCode;$result.status=if($child.ExitCode -eq 0){'BUILD_PASS_DEVICE_PENDING'}else{'CHECK_EDITOR_REPORT'}
}catch{$result.status='BLOCKED';$result.error=$_.Exception.ToString()}
finally{
  if((Test-Path -LiteralPath (Join-Path $run 'webview-policy.json')) -and
    !(Test-Path -LiteralPath (Join-Path $run 'webview-policy-restoration.json'))){
    try{
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'android-current-webview-policy.ps1') -Action Restore -RunDirectory $run
      if($LASTEXITCODE -ne 0){throw 'WebView policy restoration failed'}
      $result.policyRestoration='PASS'
    }catch{$result.status='FAILED';$result.cleanupError=$_.Exception.ToString()}
  }
  $result.finishedAt=[DateTime]::UtcNow.ToString('o');Save $resultFile $result
}
if($result.status -cne 'BUILD_PASS_DEVICE_PENDING'){exit 2}
