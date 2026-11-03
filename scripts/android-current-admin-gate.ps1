param(
    [ValidateSet('SelfTest','Launch','Elevated')][string]$Action='SelfTest'
)
# QA only: a genuine non-admin -> RunAs boundary followed by a real symlink
# probe. No APK build, install, SDK repair, model call or UI automation.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$root='F:\AgentVN\QA\Android-Package-20261021-01'
$run=Join-Path $root 'preflight-01'
$request=Join-Path $run 'admin-request.json'
$receipt=Join-Path $run 'admin-result.json'
function Save($file,$value){
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 14),[Text.UTF8Encoding]::new($false))
}
function Read($file){[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8)|ConvertFrom-Json}
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$stream.Dispose();$hash.Dispose()}
}
function Boundary($directory){
    if([IO.Path]::GetFullPath($directory) -cne $run){throw 'Only exact fresh Android preflight root accepted'}
}
if($Action -ceq 'SelfTest'){
    foreach($case in @(@($run,$true),@($root,$false),@('F:\AgentVN',$false),
        @('D:\AgentVN',$false),@(($run+'\nested'),$false),@(($run+'-other'),$false))){
        $accepted=$true;try{Boundary $case[0]}catch{$accepted=$false}
        if($accepted -ne $case[1]){throw 'Admin gate boundary test failed'}
    }
    'PASS: six exact Android permission-root boundaries, no mutations';exit
}
Boundary $run
$setup=Read (Join-Path $run 'preparation.json')
if($setup.status -cne 'PASS' -or $setup.scope -cne 'ANDROID_PERMISSION_GATE_ONLY_NOT_BUILD_OR_DEVICE'){
    throw 'Complete scoped preparation required'
}
foreach($file in $setup.tools){if((Sha $file.path) -cne $file.sha256){throw 'Prepared QA tool changed'}}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$isElevated=([Security.Principal.WindowsPrincipal]::new($identity)).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -ceq 'Launch'){
    if($isElevated){throw 'Genuine non-administrator origin required'}
    if((Test-Path -LiteralPath $request) -or (Test-Path -LiteralPath $receipt)){throw 'Never repeat an existing elevation request'}
    $origin=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
    $state=[ordered]@{status='AWAITING_RUNAS';originIsElevated=$false;originProcessId=$PID
        originCreated=$origin.CreationDate.ToUniversalTime().ToString('o')
        userSid=$identity.User.Value;requestedAt=[DateTime]::UtcNow.ToString('o')
        helperPid=$null;helperCreated=$null;error=$null}
    Save $request $state
    try{
        $helper=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Action','Elevated')
        $state.helperPid=$helper.Id
        $state.helperCreated=$helper.StartTime.ToUniversalTime().ToString('o')
        $state.status='HELPER_STARTED';Save $request $state
        $helper.WaitForExit()
        $state.exitCode=$helper.ExitCode
        if(!(Test-Path -LiteralPath $receipt)){throw 'Elevated helper exited without a permission receipt'}
        $result=Read $receipt
        if($result.status -cne 'PASS'){throw 'Elevated permission probe did not pass'}
        $state.status='PASS'
    }catch{$state.status='BLOCKED';$state.error=$_.Exception.ToString();throw}
    finally{$state.finishedAt=[DateTime]::UtcNow.ToString('o');Save $request $state}
    [pscustomobject]$state|ConvertTo-Json -Depth 6
    exit
}
if(!$isElevated){throw 'Elevated helper lacks a real administrator token'}
if(Test-Path -LiteralPath $receipt){throw 'Existing administrator result must remain immutable'}
$origin=Read $request
if($origin.originIsElevated -or $origin.userSid -cne $identity.User.Value){throw 'Actual same-user non-admin origin required'}
$result=[ordered]@{status='RUNNING';scope=$setup.scope;startedAt=[DateTime]::UtcNow.ToString('o')
    isElevated=$true;processId=$PID;userSid=$identity.User.Value;originProcessId=$origin.originProcessId
    tokenElevationType=$null;probe=$null;apkBuilds=0;apkInstalls=0;modelRequests=0;error=$null}
Save $receipt $result
try{
    $permission=Join-Path $run 'permission'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setup.symlinkTool.path -OutputDir $permission
    $result.exitCode=$LASTEXITCODE
    $result.probe=Read (Join-Path $permission 'acceptance-permission.json')
    if($result.exitCode -ne 0 -or !$result.probe.isElevated -or !$result.probe.success){
        throw 'Actual administrator symbolic-link probe failed'
    }
    if([IO.Path]::GetDirectoryName([string]$result.probe.probeRoot) -cne $permission){
        throw 'Probe path is outside this exact test session'
    }
    if(Test-Path -LiteralPath $result.probe.probeRoot){throw 'Temporary permission probe remains'}
    $result.status='PASS'
}catch{$result.status='BLOCKED';$result.error=$_.Exception.ToString()}
finally{$result.finishedAt=[DateTime]::UtcNow.ToString('o');Save $receipt $result}
if($result.status -cne 'PASS'){exit 2}
