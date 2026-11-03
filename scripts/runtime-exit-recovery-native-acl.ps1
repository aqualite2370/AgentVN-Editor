param(
    [Parameter(Mandatory=$true)][ValidateSet('Block','Restore')][string]$Action,
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [Parameter(Mandatory=$true)][string]$InstallId
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lib\runtime-qa-acl.ps1')
$qaRun=[IO.Path]::GetFullPath($RunDirectory)
if([IO.Path]::GetDirectoryName($qaRun) -cne 'F:\AgentVN\QA\Native-Runtime-State-20261020-01' -or
    [IO.Path]::GetFileName($qaRun) -notmatch '^exit-recovery-20261027-\d{2}$'){
    throw 'Exact native recovery session required'
}
if($InstallId -notmatch '^qa_recovery_20261027_\d{2}_(agentvn|renpy)_(manual|auto|discard)$'){
    throw 'Exact QA game identity required'
}
$qaJournal=Get-Content -LiteralPath (Join-Path $qaRun 'profile-protection.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$qaRoaming=@($qaJournal.records | Where-Object {$_.storage -eq 'NativeRoaming'})
if($qaRoaming.Count -ne 1 -or !(Test-Path -LiteralPath $qaRoaming[0].held)){
    throw 'Original roaming profile must be protected'
}
$qaParent=Join-Path $qaRoaming[0].original 'saves'
$qaTarget=[IO.Path]::GetFullPath((Join-Path $qaParent $InstallId))
if([IO.Path]::GetDirectoryName($qaTarget) -cne $qaParent){throw 'ACL leaf mismatch'}
foreach($qaDirectory in @($qaRoaming[0].original,$qaParent,$qaTarget)){
    $qaItem=Get-Item -LiteralPath $qaDirectory
    if(!$qaItem.PSIsContainer -or ($qaItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){
        throw 'Physical QA directories required'
    }
}
$qaReceipt=Join-Path $qaRun ('acl-'+$InstallId+'.json')
$qaProbe=Join-Path $qaTarget '.recovery-write-probe.tmp'
if(Test-Path -LiteralPath $qaProbe){throw 'Fresh probe required'}
function Save-Receipt($qaFile,$qaValue){
    if(Test-Path -LiteralPath $qaFile){throw 'Never overwrite recovery evidence'}
    [IO.File]::WriteAllText($qaFile,($qaValue|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
function Probe-Write {
    try{
        [IO.File]::WriteAllText($qaProbe,'QA exact leaf write probe')
        return @{allowed=$true}
    }catch{
        $qaCause=$_.Exception.GetBaseException()
        return @{allowed=$false;hresult=$qaCause.HResult;error=$qaCause.Message;
            accessDenied=($qaCause.HResult -eq -2147024891)}
    }finally{
        if(Test-Path -LiteralPath $qaProbe){[IO.File]::Delete($qaProbe)}
    }
}
if($Action -eq 'Restore'){
    $qaSaved=Get-Content -LiteralPath $qaReceipt -Raw -Encoding UTF8 | ConvertFrom-Json
    if($qaSaved.target -cne $qaTarget -or $qaSaved.installId -cne $InstallId){throw 'ACL identity mismatch'}
    $qaAcl=[IO.Directory]::GetAccessControl($qaTarget)
    $qaAcl.SetSecurityDescriptorSddlForm($qaSaved.originalSddl,[Security.AccessControl.AccessControlSections]::Access)
    [IO.Directory]::SetAccessControl($qaTarget,$qaAcl)
    $qaComparison=Compare-QAAccessDescriptor $qaSaved.originalSddl ([IO.Directory]::GetAccessControl($qaTarget).Sddl)
    $qaProbeResult=Probe-Write
    if(!$qaComparison.permissionsMatch -or !$qaProbeResult.allowed){throw 'ACL restore/write verification failed'}
    Save-Receipt ($qaReceipt+'.restore.json') @{status='RESTORED';target=$qaTarget;
        comparison=$qaComparison;probe=$qaProbeResult}
    'PASS restored exact QA leaf'; return
}
$qaIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
$qaPrincipal=[Security.Principal.WindowsPrincipal]::new($qaIdentity)
if($qaPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    throw 'Player ACL acceptance must be non-elevated'
}
$qaAcl=[IO.Directory]::GetAccessControl($qaTarget)
Save-Receipt $qaReceipt @{target=$qaTarget;installId=$InstallId;originalSddl=$qaAcl.Sddl;
    isElevated=$false;sid=$qaIdentity.User.Value}
$qaRule=[Security.AccessControl.FileSystemAccessRule]::new($qaIdentity.User,
    [Security.AccessControl.FileSystemRights]::Write,
    ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
    [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Deny)
$qaAcl.AddAccessRule($qaRule)
[IO.Directory]::SetAccessControl($qaTarget,$qaAcl)
$qaProbeResult=Probe-Write
Save-Receipt ($qaReceipt+'.block.json') @{status='WRITE_DENIED';target=$qaTarget;probe=$qaProbeResult;isElevated=$false}
if($qaProbeResult.allowed -or !$qaProbeResult.accessDenied){throw 'Actual access-denied required'}
'PASS actual ordinary-user write denied'
