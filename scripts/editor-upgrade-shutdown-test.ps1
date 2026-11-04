$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$hook=Get-Content -LiteralPath (Join-Path $root 'editor\src-tauri\installer-hooks.nsh') -Raw
$executableHook=($hook -split "`r?`n"|Where-Object {$_ -notmatch '^\s*;'} ) -join "`n"
if($executableHook -match 'taskkill|/F /T|/IM '){throw 'Upgrade must not forcibly terminate Editor/WebView processes'}
$source=Join-Path $root 'editor\src-tauri\installer-close-for-upgrade.ps1'
if(!(Test-Path -LiteralPath $source)){throw 'Missing graceful upgrade coordinator'}
. $source
function Assert($value,$message){if(!$value){throw $message}}
$install='F:\AgentVN\QA\Upgrade coordinator\installed-editor'
$foreign='F:\AgentVN\QA\Other editor'
function Row($id,$name,$directory){
    [pscustomobject]@{ProcessId=$id;Name=$name;ExecutablePath=(Join-Path $directory $name);CreationDate=[DateTime]'2026-11-03T12:00:00Z'}
}
$script:closed=@();$script:tick=0
$a=Row 101 'agentvn-editor.exe' $install
$b=Row 102 'creator-backend.exe' $install
$other=Row 201 'agentvn-editor.exe' $foreign
$result=Wait-AgentVNUpgradeShutdown -InstallDirectory $install -TimeoutSeconds 3 -ReadProcesses {
    if($script:tick -eq 0){@($a,$b,$other)}elseif($script:tick -eq 1){@($b,$other)}else{@($other)}
} -RequestClose {param($p) $script:closed+= $p.ProcessId} -Delay {param($ms) $script:tick++} -Clock {
    ([DateTime]'2026-11-03T12:00:00Z').AddMilliseconds($script:tick*500)
}
Assert ($result.status -eq 'PASS') 'Expected graceful completion'
Assert ($script:closed.Count -eq 1 -and $script:closed[0] -eq 101) 'Do not close another installation or a backend as a window'
$script:tick=0;$script:closed=@()
try{
    Wait-AgentVNUpgradeShutdown -InstallDirectory $install -TimeoutSeconds 1 -ReadProcesses {@($a)} `
      -RequestClose {param($p) $script:closed+=$p.ProcessId} -Delay {param($ms) $script:tick++} `
      -Clock {([DateTime]'2026-11-03T12:00:00Z').AddMilliseconds($script:tick*500)}|Out-Null
    throw 'MISSING_TIMEOUT'
}catch{Assert ($_.Exception.Message -match 'UPGRADE_CLOSE_TIMEOUT') 'A blocked window must prevent installation'}
Assert ($script:closed.Count -eq 1) 'Repeated close requests must not dismiss confirmation dialogs'
$script:tick=0;$script:closed=@()
$unknown=Row 301 'agentvn-editor.exe' $install;$unknown.ExecutablePath=$null
try{
    Wait-AgentVNUpgradeShutdown -InstallDirectory $install -ReadProcesses {@($unknown)}|Out-Null
    throw 'MISSING_IDENTITY_FAILURE'
}catch{Assert ($_.Exception.Message -match 'UPGRADE_IDENTITY_UNAVAILABLE') 'Cannot terminate an unidentified process'}
$script:tick=0;$script:closed=@()
$new=Row 103 'agentvn-editor.exe' $install
$result=Wait-AgentVNUpgradeShutdown -InstallDirectory $install -TimeoutSeconds 3 -ReadProcesses {
    if($script:tick -eq 0){@($a)}elseif($script:tick -eq 1){@($new)}else{@()}
} -RequestClose {param($p) $script:closed+=$p.ProcessId} -Delay {param($ms) $script:tick++} -Clock {
    ([DateTime]'2026-11-03T12:00:00Z').AddMilliseconds($script:tick*500)
}
Assert ($script:closed.Count -eq 2) 'A replacement host must also exit before overwriting'
$script:tick=0;$script:closed=@()
$result=Wait-AgentVNUpgradeShutdown -InstallDirectory $install -ReadProcesses {@($other)} `
    -RequestClose {throw 'Foreign window was touched'} -Delay {param($ms) $script:tick++}
Assert ($result.status -eq 'PASS') 'Fresh install can proceed with another directory open'
Assert ($hook -match 'ExecToStack' -and $hook -match 'Abort' -and $hook -match 'installer-close-for-upgrade.ps1') 'Hook must enforce shutdown result'
'PASS: 6 upgrade shutdown cases; no actual processes started or terminated'
