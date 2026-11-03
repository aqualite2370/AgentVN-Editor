param(
    [Parameter(Mandatory=$true)][ValidateSet('Block','Restore')][string]$Action,
    [Parameter(Mandatory=$true)][ValidateSet('retry','discard','native')][string]$Case,
    [Parameter(Mandatory=$true)][ValidateSet('agentvn','renpy')][string]$Layout,
    [ValidateRange(1,2)][int]$SessionNumber=1
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lib\runtime-qa-acl.ps1')
$qaRun='D:\AgentVN\output\installed-runtime-exit-20261018-01'
$qaWork='F:\AgentVN-QA-InstalledRuntimeExit-20261018-01'
if($SessionNumber -eq 2){
    $qaRun=$qaRun -replace '-01$','-02'
    $qaWork=$qaWork -replace '-01$','-02'
}
$qaInstallId='qa_exit_'+$Case+'_'+$Layout+'_20261018'
$qaParent='C:\Users\1\AppData\Roaming\com.agentvn.player\saves'
$qaTarget=[IO.Path]::GetFullPath((Join-Path $qaParent $qaInstallId))
$qaReceipt=Join-Path $qaWork ('acl-'+$Case+'-'+$Layout+'-01.json')
$qaProbe=Join-Path $qaTarget '.qa-acl-probe.tmp'
$qaPreparation=Get-Content -LiteralPath (Join-Path $qaRun 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($qaPreparation.status -ne 'PASS'){throw 'Protected QA session required'}
foreach($qaProfile in $qaPreparation.profiles){
    if(!(Test-Path -LiteralPath $qaProfile.held)){throw 'Original whole profile must remain protected'}
}
if([IO.Path]::GetDirectoryName($qaTarget) -ne $qaParent -or
    [IO.Path]::GetFileName($qaTarget) -ne $qaInstallId){throw 'Exact QA leaf target mismatch'}
foreach($qaDirectory in @($qaParent,$qaTarget)){
    $qaItem=Get-Item -LiteralPath $qaDirectory
    if(!$qaItem.PSIsContainer -or ($qaItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){
        throw 'ACL target/parent must be real directories, not links'
    }
}
if(Test-Path -LiteralPath $qaProbe){throw 'Fresh ACL probe name required'}
$qaUtf8=New-Object Text.UTF8Encoding($false)
function Save-QAReceipt($qaPath,$qaValue){
    if(Test-Path -LiteralPath $qaPath){throw 'Evidence receipt collision'}
    [IO.File]::WriteAllText($qaPath,($qaValue|ConvertTo-Json -Depth 12),$qaUtf8)
}
function Probe-QAWrite {
    $qaStream=$null
    try{
        $qaStream=[IO.File]::Open($qaProbe,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $qaStream.WriteByte(1);$qaStream.Flush()
        return @{allowed=$true}
    }catch{
        $qaCause=$_.Exception.GetBaseException()
        return @{allowed=$false;error=$qaCause.Message;type=$qaCause.GetType().FullName;
            hresult=$qaCause.HResult;accessDenied=($qaCause.HResult -eq -2147024891)}
    }finally{
        if($qaStream){$qaStream.Dispose()}
        if(Test-Path -LiteralPath $qaProbe){[IO.File]::Delete($qaProbe)}
    }
}
if($Action -eq 'Restore'){
    $qaOriginal=Get-Content -LiteralPath $qaReceipt -Raw -Encoding UTF8|ConvertFrom-Json
    if($qaOriginal.target -ne $qaTarget -or $qaOriginal.installId -ne $qaInstallId){throw 'Original ACL receipt target mismatch'}
    $qaAcl=[IO.Directory]::GetAccessControl($qaTarget)
    # Restore only DACL. Marking SACL/owner/group dirty would unnecessarily
    # demand SeSecurityPrivilege and invalidate this ordinary-user test.
    $qaAcl.SetSecurityDescriptorSddlForm($qaOriginal.originalSddl,[Security.AccessControl.AccessControlSections]::Access)
    [IO.Directory]::SetAccessControl($qaTarget,$qaAcl)
    $qaActual=[IO.Directory]::GetAccessControl($qaTarget).Sddl
    $qaComparison=Compare-QAAccessDescriptor $qaOriginal.originalSddl $qaActual
    if(!$qaComparison.permissionsMatch){throw 'Restored DACL bytes/owner/group/protection must exactly match original'}
    $qaProbeResult=Probe-QAWrite
    if(!$qaProbeResult.allowed){throw 'Restored QA directory still refuses real write'}
    $qaResult=@{status='RESTORED';at=(Get-Date).ToUniversalTime().ToString('o');target=$qaTarget;
        installId=$qaInstallId;originalSddl=$qaOriginal.originalSddl;actualSddl=$qaActual;
        comparison=$qaComparison;probe=$qaProbeResult}
    Save-QAReceipt ($qaReceipt+'.restore.json') $qaResult
    Write-Output ($qaResult|ConvertTo-Json -Depth 6)
    exit
}
if(Test-Path -LiteralPath $qaReceipt){throw 'Never overwrite original ACL recovery receipt'}
$qaBefore=[IO.Directory]::GetAccessControl($qaTarget)
$qaIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
$qaPrincipal=New-Object Security.Principal.WindowsPrincipal($qaIdentity)
$qaResult=@{status='PREPARED';at=(Get-Date).ToUniversalTime().ToString('o');target=$qaTarget;
    installId=$qaInstallId;originalSddl=$qaBefore.Sddl;sid=$qaIdentity.User.Value;
    isElevated=$qaPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}
if($qaResult.isElevated){throw 'Windows ordinary-player rejection test must remain non-administrator'}
# Persist recovery metadata BEFORE changing the exact QA-only directory ACL.
Save-QAReceipt $qaReceipt $qaResult
$qaRule=New-Object Security.AccessControl.FileSystemAccessRule(
    $qaIdentity.User,
    [Security.AccessControl.FileSystemRights]::Write,
    ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Deny)
$qaBefore.AddAccessRule($qaRule)
[IO.Directory]::SetAccessControl($qaTarget,$qaBefore)
$qaResult.deniedSddl=[IO.Directory]::GetAccessControl($qaTarget).Sddl
$qaResult.probe=Probe-QAWrite
$qaResult.status=if($qaResult.probe.allowed){'FAILED_NOT_DENIED'}else{'WRITE_DENIED'}
Save-QAReceipt ($qaReceipt+'.block.json') $qaResult
if($qaResult.probe.allowed){throw 'Actual write probe was not denied'}
if(!$qaResult.probe.accessDenied){throw 'Write probe failed for something other than actual access denial'}
Write-Output ($qaResult|ConvertTo-Json -Depth 6)
